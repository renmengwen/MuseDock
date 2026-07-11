const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const aiTextModel = require('../../ai/aiTextModel');
const { createTemplateRegistry, DEFAULT_ROOT_DIR, validateTemplateCompatibility } = require('./templateRegistry');
const templateSelectorAgent = require('./templateSelectorAgent');
const templateInputAgent = require('./templateInputAgent');
const contentGraphAgent = require('./contentGraphAgent');
const frameHtmlAgent = require('./frameHtmlAgent');
const frameFallbackBuilder = require('./frameFallbackBuilder');
const { runFrameHtmlPhase, isProviderMissingText, groupBeatsForSceneHtml } = require('./frameHtmlPhase');
const { buildRawHtmlFrameProject } = require('./rawHtmlFrameBuilder');
const { buildMixedFrameProject } = require('./mixedFrameBuilder');
const { buildVisualPlan, assignMotionOrchestration } = require('./visualPlanService');
const { matchVisualBeatsToRenderers } = require('./visualRouteMatcher');
const {
  runGeneratedImagePhase,
  hydrateGeneratedAssetsFromProject,
  enforceAssetFirstRawHtmlRouting,
} = require('./generatedImagePhase');
const environmentDoctor = require('./environmentDoctor');
const projectStore = require('./projectStore');
const {
  normalizeProject,
  markCheckpointStage,
  markCheckpointFrame,
  appendCheckpointModelCall,
} = require('./projectSchema');
const { validateHtmlVideoProject } = require('./validationGate');
const projectOrchestrator = require('./projectOrchestrator');
const editPatchService = require('./editPatchService');
const { syncRawHtmlFrameTextPatch } = require('./rawHtmlTextPatch');
const { parseJsonOnlyResponse } = require('./templateInputAgent');
const defaultVisualQaService = require('../visualQaService');
const defaultLayoutQaService = require('./layoutQaService');
const { computeSceneSpecSpeechHash, audioMatchesSceneSpec } = require('../sceneSpecHash');
const { applyManifestToProjectAudio } = require('../ttsService');
const { createDiagnostic, normalizeDiagnostics, failureFromDiagnostics } = require('./diagnostics');
const { mapSceneSpecToContentGraph, buildFramesFromGraph } = require('./sceneSpecMapper');
const { matchScenesToTemplates } = require('./sceneTemplateMatcher');
const { resolveNodeSceneId, validateGraphMatchesSceneSpec } = require('./sceneGraphBinding');
const { topoSort } = require('./contentGraph');
const sfxLibrary = require('./sfxLibrary');
const sfxPlannerAgent = require('./sfxPlannerAgent');
const sfxEventService = require('./sfxEventService');
const { AGENTS, STAGES } = require('../agentStages');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function hasManifestSceneAudio(audioManifest = {}) {
  return (Array.isArray(audioManifest.scenes) ? audioManifest.scenes : [])
    .some(scene => firstNonEmptyString(scene?.path, scene?.relative_path, scene?.relativePath));
}

function resolveExistingNarrationAudio(creativeContext = {}, sceneSpec = null) {
  const audio = objectOrEmpty(creativeContext.audio);
  const audioPath = firstNonEmptyString(audio.path, audio.narration_path, audio.narrationPath, audio.combined_path);
  if (!audioPath || !sceneSpec) {
    return { reusable: false, audio, path: null, reason: 'missing_path_or_scene_spec' };
  }
  if (!audioMatchesSceneSpec({ ...audio, path: audioPath }, sceneSpec)) {
    return { reusable: false, audio, path: audioPath, reason: 'scene_spec_mismatch' };
  }
  return { reusable: true, audio, path: audioPath, reason: 'matched' };
}

function audioWithResolvedPath(audio = {}) {
  const safeAudio = objectOrEmpty(audio);
  const pathValue = firstNonEmptyString(
    safeAudio.path,
    safeAudio.narration_path,
    safeAudio.narrationPath,
    safeAudio.combined_path,
  );
  return pathValue ? { ...safeAudio, path: pathValue } : safeAudio;
}

function mergeResumeAudioIntoCreativeContext(creativeContext = {}, project = {}, resumeProject = null, sceneSpec = null) {
  const current = objectOrEmpty(creativeContext);
  const candidates = [
    audioWithResolvedPath(current.audio),
    audioWithResolvedPath(project.audio),
    audioWithResolvedPath(resumeProject?.audio),
  ];
  const matched = candidates.find(audio => audioMatchesSceneSpec(audio, sceneSpec || {}));
  if (!matched) return current;
  if (matched === candidates[0]) return current;
  return { ...current, audio: matched };
}

function failure(message, diagnostics, extra = {}) {
  return failureFromDiagnostics(message, diagnostics, {
    render_mode: 'html-video',
    ...extra,
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function stableSceneSpecValue(value) {
  if (Array.isArray(value)) return value.map(stableSceneSpecValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableSceneSpecValue(value[key])]),
  );
}

function computeSceneSpecCheckpointHash(sceneSpec = {}) {
  return sha256(JSON.stringify(stableSceneSpecValue(sceneSpec || {})));
}

function rawHtmlBuildFrameIdFromError(error) {
  const message = String(error?.message || '');
  return message.match(/缺少帧\s+([^\s]+)\s+的 raw HTML 路径/)?.[1]
    || message.match(/内容图节点\s+([^\s]+)\s+未匹配到 scene_spec/)?.[1]
    || '';
}

async function report(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  try {
    await onProgress(event);
  } catch (_) {
    // 进度回调不能影响主生成流程。
  }
}

function getModel(services = {}) {
  return services.aiTextModel || aiTextModel;
}

function responseModelInfo(response = {}) {
  const model = objectOrEmpty(response.model);
  return {
    provider: firstNonEmptyString(model.provider, response.provider),
    model_id: firstNonEmptyString(model.model_id, model.id, response.model_id, response.modelId),
  };
}

function createAuditedModel(model, projectDir) {
  if (!model || typeof model.callTextModel !== 'function' || !projectDir) return model;
  let auditWriteQueue = Promise.resolve();
  return {
    ...model,
    callTextModel: async request => {
      const audit = objectOrEmpty(request?.audit);
      const { audit: _audit, ...forwardRequest } = objectOrEmpty(request);
      if (audit.agent && audit.stage) {
        Object.defineProperty(forwardRequest, 'audit', {
          value: audit,
          enumerable: false,
        });
      }
      const startedAt = Date.now();
      let response;
      let thrownError = null;
      try {
        response = await model.callTextModel(forwardRequest);
        return response;
      } catch (error) {
        thrownError = error;
        throw error;
      } finally {
        if (audit.agent && audit.stage) {
          auditWriteQueue = auditWriteQueue.catch(() => {}).then(async () => {
            await projectStore.writeProjectJson(projectDir, project => appendCheckpointModelCall(project, {
              ...audit,
              model: responseModelInfo(response),
              usage: objectOrEmpty(response?.usage),
              duration_ms: Date.now() - startedAt,
              success: !thrownError && response?.success !== false,
              error: thrownError ? firstNonEmptyString(thrownError.message) : (response?.success === false ? firstNonEmptyString(response?.message, response?.error) : ''),
            }));
          });
          await auditWriteQueue.catch(() => {});
        }
      }
    },
  };
}

async function callTextModel(model, prompt, options = {}) {
  const response = await model.callTextModel({
    ...objectOrEmpty(options),
    messages: [{ role: 'user', content: prompt }],
  });
  if (!response || response.success === false) {
    return {
      success: false,
      message: response?.message || 'AI 调用失败。',
      text: '',
    };
  }
  return { success: true, text: response.text || response.content || '' };
}

const SAFE_PROJECT_ID = /^[A-Za-z0-9_.-]+$/;

function existingProjectDir(rootDir, workflowId, runId) {
  const safeWorkflowId = String(workflowId || '').trim();
  const safeRunId = String(runId || '').trim();
  if (!rootDir || !SAFE_PROJECT_ID.test(safeWorkflowId) || !SAFE_PROJECT_ID.test(safeRunId)) return '';
  return path.resolve(rootDir, safeWorkflowId, 'agent_runs', `${safeRunId}-html-video`);
}

async function loadExistingProject(projectDir) {
  if (!projectDir) return null;
  try {
    return await projectStore.loadProject(projectDir);
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
    return null;
  }
}

function stripIgnoredHtmlRegions(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');
}

function htmlHasTextKey(html, key) {
  const tags = stripIgnoredHtmlRegions(html).match(/<[A-Za-z][^>]*>/g) || [];
  const pattern = new RegExp(`\\bdata-text-key\\s*=\\s*(['"])${key}\\1`, 'i');
  return tags.some(tag => pattern.test(tag));
}

function attachVisualStrategy(project, creativeContext) {
  if (!project) return project;
  project.visual_strategy = creativeContext?.visual_strategy || project.visual_strategy || null;
  project.continuity_mode = creativeContext?.continuity_mode || project.continuity_mode || 'beat_mp4';
  return project;
}

function resumeArtifactsMatch(project = {}, sceneSpec = null, template = {}, generationMode = '') {
  const currentHash = computeSceneSpecCheckpointHash(sceneSpec || {});
  const checkpointHash = String(project.generation_checkpoint?.scene_spec_hash || '').trim();
  if (!checkpointHash || !currentHash || checkpointHash !== currentHash) return false;
  const projectTemplateId = String(project.template_id || '').trim();
  if (generationMode === 'per_scene') {
    // per_scene 不设全片模板（template_id 恒为 null），复用按 scene_spec_hash 判定；
    // 工程若记录了全片模板 id 或别的 generation_mode，说明发生了模式切换，禁止复用
    const projectMode = String(project.generation_mode || '').trim();
    if (projectMode && projectMode !== 'per_scene') return false;
    return !projectTemplateId;
  }
  const templateId = String(template?.id || '').trim();
  return Boolean(projectTemplateId && templateId && projectTemplateId === templateId);
}

function shouldReuseFrameHtml({ projectDir, checkpointFrame, scene, node, target, resumeAllowed = true } = {}) {
  if (!resumeAllowed) return { reuse: false };
  const frame = objectOrEmpty(checkpointFrame);
  if (frame.status !== 'done' || !frame.html_path) return { reuse: false };
  let html;
  try {
    const absolutePath = projectStore.resolveProjectPath(projectDir, frame.html_path);
    if (!fs.existsSync(absolutePath)) return { reuse: false };
    html = fs.readFileSync(absolutePath, 'utf8');
  } catch {
    return { reuse: false };
  }
  const extracted = frameHtmlAgent.extractHtmlDocument(html);
  if (!extracted.success) return { reuse: false };
  const validation = frameHtmlAgent.validateHtmlTargetResolution(extracted.html, target || {});
  if (!validation.success) return { reuse: false };
  for (const key of ['headline', 'subtitle', 'body']) {
    if (!htmlHasTextKey(extracted.html, key)) {
      return { reuse: false };
    }
  }
  return {
    reuse: true,
    html,
    html_path: frame.html_path,
    scene_id: scene?.id || resolveNodeSceneId(node) || node?.id || '',
  };
}

function invalidateFrameHtmlDependents(project, sceneId) {
  if (!project) return project;
  // beat 展开后同一场景可能对应多个帧（渲染检查点按帧键控），场景 HTML 变更需要一并失效
  const dependentFrameIds = new Set([sceneId]);
  for (const frame of Array.isArray(project.frames) ? project.frames : []) {
    if (!frame) continue;
    if (frame.scene_id === sceneId || frame.id === sceneId) {
      dependentFrameIds.add(String(frame.id || sceneId));
    }
  }
  for (const frameId of dependentFrameIds) {
    markCheckpointFrame(project, 'render', frameId, {
      status: 'pending',
      mp4_path: '',
      output_hash: '',
      diagnostic_code: '',
    });
  }
  markCheckpointStage(project, 'compose', {
    status: 'pending',
    output_path: '',
    output_audio_path: '',
    diagnostic_code: '',
  });
  markCheckpointStage(project, 'duration_verify', {
    status: 'pending',
    expected_duration_sec: undefined,
    actual_duration_sec: undefined,
    diagnostic_code: '',
  });
  markCheckpointStage(project, 'visual_inspect', {
    status: 'pending',
    report_path: null,
    diagnostic_code: '',
  });
  project.exports = [];
  project.render_outputs = [];
  project.status = 'draft';
  return project;
}

function invalidateFrameHtmlResumeState(project) {
  if (!project) return project;
  markCheckpointStage(project, 'frame_html', { status: 'pending' });
  if (project.generation_checkpoint?.stages?.frame_html) {
    project.generation_checkpoint.stages.frame_html.frames = {};
  }
  if (project.generation_checkpoint?.stages?.render) {
    project.generation_checkpoint.stages.render.frames = {};
    project.generation_checkpoint.stages.render.status = 'pending';
  }
  markCheckpointStage(project, 'compose', {
    status: 'pending',
    output_path: '',
    output_audio_path: '',
    diagnostic_code: '',
  });
  markCheckpointStage(project, 'duration_verify', {
    status: 'pending',
    expected_duration_sec: undefined,
    actual_duration_sec: undefined,
    diagnostic_code: '',
  });
  markCheckpointStage(project, 'visual_inspect', {
    status: 'pending',
    report_path: null,
    diagnostic_code: '',
  });
  project.exports = [];
  project.render_outputs = [];
  project.status = 'draft';
  return project;
}

function hasUsableContentGraph(graph = {}) {
  return Array.isArray(graph.nodes) && graph.nodes.length > 0;
}

/**
 * 把 beat 级路由决策按 scene 聚合成 frame_html 阶段可用的跳过判断：
 * 只有场景内全部 beat 都是 template_inputs 才算 template_inputs（可跳过场景 HTML 生成），
 * 任一 beat 走 raw_html 或决策缺失，该场景都需要生成 HTML 供 raw beat 复用。
 */
function aggregateBeatRoutingByScene(visualPlan, visualDecisions) {
  const bySceneId = new Map();
  const beats = Array.isArray(visualPlan?.beats) ? visualPlan.beats : [];
  for (const beat of beats) {
    if (!beat || !beat.id) continue;
    const sceneId = String(beat.scene_id || '').trim();
    if (!sceneId) continue;
    const decision = visualDecisions instanceof Map ? visualDecisions.get(beat.id) : null;
    const isTemplateBeat = decision?.source_mode === 'template_inputs' && Boolean(decision.template_id);
    const current = bySceneId.get(sceneId) || {
      scene_id: sceneId,
      source_mode: 'template_inputs',
      template_id: null,
      beat_count: 0,
      template_beat_count: 0,
    };
    current.beat_count += 1;
    if (isTemplateBeat) {
      current.template_beat_count += 1;
      if (!current.template_id) current.template_id = decision.template_id;
    } else {
      current.source_mode = 'raw_html';
    }
    bySceneId.set(sceneId, current);
  }
  return bySceneId;
}

/**
 * enforceAssetFirstRawHtmlRouting 只覆写 scene 级决策；
 * 这里把覆写扇出到该场景的全部 beat（template beat 或缺决策 beat 改为 raw_html 并带覆写原因），
 * 已经是 raw_html 的 beat 保留原有 fallback 信息。返回是否有变更。
 */
function fanOutAssetFirstOverridesToBeats({ perSceneDecisions, visualPlan, visualDecisions } = {}) {
  if (!(perSceneDecisions instanceof Map) || !(visualDecisions instanceof Map)) return false;
  const beats = Array.isArray(visualPlan?.beats) ? visualPlan.beats : [];
  if (!beats.length) return false;
  const overriddenSceneIds = new Set();
  for (const [sceneId, decision] of perSceneDecisions) {
    if (decision?.source_mode === 'raw_html'
      && ['asset_first_generated_subject', 'required_asset_ref'].includes(decision?.override_reason)) {
      overriddenSceneIds.add(sceneId);
    }
  }
  if (!overriddenSceneIds.size) return false;
  let changed = false;
  for (const beat of beats) {
    if (!beat || !beat.id || !overriddenSceneIds.has(String(beat.scene_id || '').trim())) continue;
    const beatDecision = visualDecisions.get(beat.id) || null;
    if (beatDecision && beatDecision.source_mode !== 'template_inputs') continue;
    const { inputs: _inputs, ...rest } = beatDecision || {};
    visualDecisions.set(beat.id, {
      beat_id: beat.id,
      scene_id: beat.scene_id,
      ...rest,
      source_mode: 'raw_html',
      template_id: null,
      duration_strategy: 'raw_html',
      ...(beatDecision?.source_mode === 'template_inputs' ? { fallback_from: 'template_inputs' } : {}),
      fallback_reason: '该场景已选择视觉素材，已改用自由 HTML 以确保素材进入画面。',
      override_reason: 'required_asset_ref',
    });
    changed = true;
  }
  return changed;
}

// R4：帧统计（overlay_check/text_blocks/cards/graphics）必须合并进 attachVisualRouting
// 闭包引用的 visualDecisions/renderDecisions 源对象，直接写 project.render_decisions
// 会在下一次 attachVisualRouting 重挂时被覆盖抹掉。
function mergeFrameStatsIntoDecisions({ visualDecisions, renderDecisions, statsByBeatId = {} }) {
  const applyTo = decision => {
    const stats = decision && statsByBeatId[decision.beat_id];
    if (stats) Object.assign(decision, stats); // { overlay_check, text_blocks, cards, graphics }
  };
  if (visualDecisions instanceof Map) for (const decision of visualDecisions.values()) applyTo(decision);
  if (Array.isArray(renderDecisions)) for (const decision of renderDecisions) applyTo(decision);
}

/**
 * 把已产出的生成图确定性地绑定到场景 asset_refs（返回克隆，不改入参）：
 * 仅用于路由输入（模板匹配/视觉计划），不回写原始 sceneSpec，
 * 以免影响 scene_spec_hash 的重试复用判定。绑定按 asset id 排序保证确定性。
 */
function bindGeneratedAssetsToSceneSpec(sceneSpec = {}, creativeContext = {}) {
  const assets = Array.isArray(creativeContext?.asset_context?.assets)
    ? creativeContext.asset_context.assets
    : [];
  const bySceneId = new Map();
  for (const asset of assets) {
    if (asset?.source !== 'generated') continue;
    const sceneId = String(asset?.generation?.scene_id || '').trim();
    const assetId = String(asset?.id || asset?.asset_id || '').trim();
    if (!sceneId || !assetId) continue;
    if (!bySceneId.has(sceneId)) bySceneId.set(sceneId, []);
    bySceneId.get(sceneId).push(assetId);
  }
  if (!bySceneId.size || !Array.isArray(sceneSpec?.scenes)) return sceneSpec;
  return {
    ...sceneSpec,
    scenes: sceneSpec.scenes.map(scene => {
      const sceneId = String(scene?.id || scene?.scene_id || '').trim();
      const assetIds = (bySceneId.get(sceneId) || []).slice().sort();
      if (!assetIds.length) return scene;
      const refs = Array.isArray(scene.asset_refs) ? [...scene.asset_refs] : [];
      for (const assetId of assetIds) {
        if (refs.some(ref => String(ref?.asset_id || ref?.id || '') === assetId)) continue;
        refs.push({ asset_id: assetId, usage: 'subject', reason: 'AI 生图主视觉' });
      }
      return { ...scene, asset_refs: refs };
    }),
  };
}

function contentGraphMatchesSceneSpec(graph = {}, sceneSpec = null) {  if (!sceneSpec) return true;
  const direct = validateGraphMatchesSceneSpec(graph, sceneSpec);
  if (direct.ok) return true;
  const expected = (Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [])
    .map(scene => String(scene?.id || '').trim())
    .filter(Boolean);
  if (!expected.length || !Array.isArray(graph?.nodes)) return false;
  const actual = [];
  for (const nodeId of (() => {
    try { return topoSort(graph); } catch { return graph.nodes.map(node => node.id); }
  })()) {
    const node = (graph.nodes || []).find(item => item?.id === nodeId) || {};
    const sceneId = resolveNodeSceneId(node);
    if (sceneId && actual[actual.length - 1] !== sceneId) actual.push(sceneId);
  }
  return expected.length === actual.length && expected.every((sceneId, index) => sceneId === actual[index]);
}

function loadCheckpointContentGraph(projectDir, project = {}) {
  const graphPath = String(project.generation_checkpoint?.stages?.content_graph?.path || '').trim();
  if (!graphPath) return null;
  try {
    const absolutePath = projectStore.resolveProjectPath(projectDir, graphPath);
    if (!fs.existsSync(absolutePath)) return null;
    const graph = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    return hasUsableContentGraph(graph) ? graph : null;
  } catch {
    return null;
  }
}

function resolveResumeContentGraph(projectDir, project = {}, sceneSpec = null, template = {}, generationMode = '') {
  if (!project) return null;
  if (!resumeArtifactsMatch(project, sceneSpec, template, generationMode)) return null;
  if (hasUsableContentGraph(project.content_graph) && contentGraphMatchesSceneSpec(project.content_graph, sceneSpec)) {
    return project.content_graph;
  }
  const checkpointGraph = loadCheckpointContentGraph(projectDir, project);
  return checkpointGraph && contentGraphMatchesSceneSpec(checkpointGraph, sceneSpec) ? checkpointGraph : null;
}

function providerMissingTextDiagnostic() {
  return createDiagnostic({
    code: 'provider_missing_text',
    stage: 'ai-content-graph',
    sub_stage: 'content_graph',
    retryable: true,
    repair_action: 'retry_content_graph',
    fallback_allowed: true,
    user_message: 'content graph 生成时模型返回空内容，将重试内容图生成。',
  });
}

const CONTENT_GRAPH_SCENE_SPEC_MISMATCH_MESSAGE = '画面结构与旁白脚本不一致，已停止渲染。请重新生成画面结构后再导出。';

function contentGraphSceneSpecMismatchDiagnostic(graphBinding = {}, options = {}) {
  return createDiagnostic({
    code: 'content_graph_scene_spec_mismatch',
    stage: 'ai-content-graph',
    sub_stage: 'content_graph',
    user_message: options.user_message || CONTENT_GRAPH_SCENE_SPEC_MISMATCH_MESSAGE,
    details: graphBinding,
    fallback_allowed: false,
    retryable: options.retryable !== false,
    repair_action: 'retry_content_graph',
    ...(options.severity ? { severity: options.severity } : {}),
  });
}

function graphAiFailureDiagnostic(graphAi) {
  if (isProviderMissingText(graphAi?.message)) {
    return providerMissingTextDiagnostic();
  }
  return createDiagnostic({
    code: 'content_graph_failed',
    stage: 'ai-content-graph',
    sub_stage: 'content_graph',
    user_message: graphAi?.message || 'content graph 生成失败。',
    retryable: true,
    repair_action: 'retry_content_graph',
  });
}

function ensureGraphAiHasText(graphAi) {
  if (graphAi?.success && !String(graphAi.text || '').trim()) {
    return { success: false, message: '返回结果缺少文本内容。', text: '' };
  }
  return graphAi;
}

async function retryContentGraphAfterMismatch({
  model,
  sceneSpec,
  creativeContext,
  target,
  originalPrompt,
  diagnostics,
  graphBinding,
  onProgress,
} = {}) {
  diagnostics.push(contentGraphSceneSpecMismatchDiagnostic(graphBinding, {
    severity: 'warning',
    user_message: 'content graph 与字幕脚本不一致，已丢弃该结果并重试。',
  }));
  await report(onProgress, {
    type: 'html_video_graph_scene_spec_mismatch',
    stage: 'project',
    sub_stage: 'content_graph',
    message: 'content graph 与字幕脚本不一致，正在按脚本结构重试内容图生成...',
    data: graphBinding,
  });
  const retryPrompt = contentGraphAgent.buildRetryPrompt(sceneSpec, creativeContext, target, originalPrompt, 1);
  return ensureGraphAiHasText(await callTextModel(model, retryPrompt, {
    stream: false,
    audit: {
      agent: AGENTS.contentGraph,
      stage: STAGES.contentGraph,
      sub_stage: 'content_graph',
      attempt: 2,
    },
  }));
}

async function generateContentGraphWithRetry({ model, sceneSpec, creativeContext, target, onProgress, project, projectDir } = {}) {
  const originalPrompt = contentGraphAgent.buildContentGraphPrompt({
    sceneSpec,
    creativeContext,
    target,
  });
  let graphAi = ensureGraphAiHasText(await callTextModel(model, originalPrompt, {
    audit: {
      agent: AGENTS.contentGraph,
      stage: STAGES.contentGraph,
      sub_stage: 'content_graph',
      attempt: 1,
    },
  }));
  const diagnostics = [];
  let retriedForProviderMissing = false;

  if (!graphAi.success && isProviderMissingText(graphAi.message)) {
    diagnostics.push(providerMissingTextDiagnostic());
    await report(onProgress, {
      type: 'html_video_graph_retry_started',
      stage: 'project',
      sub_stage: 'content_graph',
      message: 'content graph 生成时模型返回空内容，正在使用短提示词重试...',
      data: {},
    });
    const retryPrompt = contentGraphAgent.buildRetryPrompt(sceneSpec, creativeContext, target, originalPrompt, 1);
    graphAi = ensureGraphAiHasText(await callTextModel(model, retryPrompt, {
      stream: false,
      audit: {
        agent: AGENTS.contentGraph,
        stage: STAGES.contentGraph,
        sub_stage: 'content_graph',
        attempt: 2,
      },
    }));
    retriedForProviderMissing = true;
    if (!graphAi.success && sceneSpec) {
      await report(onProgress, {
        type: 'html_video_graph_fallback_scene_spec',
        stage: 'project',
        sub_stage: 'content_graph',
        message: 'content graph 重试仍为空，已使用字幕脚本生成内容图。',
        data: {},
      });
      return {
        success: true,
        contentGraph: mapSceneSpecToContentGraph(sceneSpec),
        diagnostics,
        inputHash: sha256(originalPrompt),
      };
    }
  }

  if (!graphAi.success) {
    return {
      success: false,
      message: graphAi.message || 'content graph 生成失败。',
      diagnostics: [graphAiFailureDiagnostic(graphAi)],
      inputHash: sha256(originalPrompt),
    };
  }

  let graphParsed = contentGraphAgent.parseContentGraphResponse(graphAi.text, sceneSpec, { creativeContext });
  if (!graphParsed.success) {
    if (retriedForProviderMissing && sceneSpec) {
      await report(onProgress, {
        type: 'html_video_graph_fallback_scene_spec',
        stage: 'project',
        sub_stage: 'content_graph',
        message: 'content graph 重试仍无效，已使用字幕脚本生成内容图。',
        data: {},
      });
      return {
        success: true,
        contentGraph: mapSceneSpecToContentGraph(sceneSpec),
        diagnostics,
        inputHash: sha256(originalPrompt),
      };
    }
    return {
      ...graphParsed,
      diagnostics: normalizeDiagnostics(graphParsed.diagnostics, {
        code: 'content_graph_invalid',
        stage: 'ai-content-graph',
        sub_stage: 'content_graph',
        user_message: graphParsed.message || 'content graph 解析失败。',
        details: { errors: graphParsed.errors || [] },
        retryable: true,
        repair_action: 'retry_content_graph',
      }),
      inputHash: sha256(originalPrompt),
    };
  }
  if (sceneSpec) {
    const graphBinding = validateGraphMatchesSceneSpec(graphParsed.graph, sceneSpec);
    if (!graphBinding.ok) {
      graphAi = await retryContentGraphAfterMismatch({
        model,
        sceneSpec,
        creativeContext,
        target,
        originalPrompt,
        diagnostics,
        graphBinding,
        onProgress,
      });
      if (!graphAi.success) {
        return {
          success: false,
          message: graphAi.message || CONTENT_GRAPH_SCENE_SPEC_MISMATCH_MESSAGE,
          diagnostics: [
            ...diagnostics,
            contentGraphSceneSpecMismatchDiagnostic(graphBinding),
          ],
          inputHash: sha256(originalPrompt),
        };
      }
      graphParsed = contentGraphAgent.parseContentGraphResponse(graphAi.text, sceneSpec, { creativeContext });
      if (!graphParsed.success) {
        return {
          ...graphParsed,
          diagnostics: normalizeDiagnostics(graphParsed.diagnostics, {
            code: 'content_graph_invalid',
            stage: 'ai-content-graph',
            sub_stage: 'content_graph',
            user_message: graphParsed.message || 'content graph 重试解析失败。',
            details: { errors: graphParsed.errors || [] },
            retryable: true,
            repair_action: 'retry_content_graph',
          }),
          inputHash: sha256(originalPrompt),
        };
      }
      const retryBinding = validateGraphMatchesSceneSpec(graphParsed.graph, sceneSpec);
      if (!retryBinding.ok) {
        return {
          success: false,
          message: CONTENT_GRAPH_SCENE_SPEC_MISMATCH_MESSAGE,
          diagnostics: [
            ...diagnostics,
            contentGraphSceneSpecMismatchDiagnostic(retryBinding),
          ],
          inputHash: sha256(originalPrompt),
        };
      }
    }
  }
  return {
    success: true,
    contentGraph: graphParsed.graph,
    diagnostics,
    inputHash: sha256(originalPrompt),
  };
}

function reorderCompactIndex(compactIndex = [], preferredTemplateId = '') {
  const preferredId = String(preferredTemplateId || '').trim();
  const items = Array.isArray(compactIndex) ? compactIndex : [];
  if (!preferredId) return items;
  const preferred = items.find(item => item && item.id === preferredId);
  if (!preferred) return items;
  return [
    preferred,
    ...items.filter(item => item && item.id !== preferredId),
  ];
}

async function requestTemplateSelection({
  model,
  compactIndex,
  creativeContext,
  target,
  sceneSpec,
  preferredTemplateId = '',
  lockTemplate = false,
} = {}) {
  const preferredId = firstNonEmptyString(preferredTemplateId, target?.preferredTemplateId, target?.preferred_template_id);
  const preferred = (Array.isArray(compactIndex) ? compactIndex : [])
    .find(item => item && item.id === preferredId);
  const selectionIndex = preferred ? reorderCompactIndex(compactIndex, preferredId) : compactIndex;

  if (lockTemplate === true && preferred) {
    return {
      success: true,
      template_id: preferred.id,
      reason: '使用锁定模板。',
      confidence: 1,
    };
  }

  const promptTarget = preferred && lockTemplate !== true
    ? {
      ...objectOrEmpty(target),
      preferredTemplateId: preferredId,
      templateSelectionPolicy: '优先选择该模板，除非内容明显不适合。',
    }
    : target;
  const prompt = templateSelectorAgent.buildTemplateSelectionPrompt({
    sceneSpec: sceneSpec || {
      title: creativeContext?.brief?.title || creativeContext?.input?.raw_text || creativeContext?.input?.title || 'html-video',
      creative_context_summary: creativeContext?.brief?.summary || creativeContext?.source_context?.summary || '',
    },
    compactIndex: selectionIndex,
    target: promptTarget,
  });
  const ai = await callTextModel(model, prompt, {
    audit: {
      agent: AGENTS.templateSelector,
      stage: STAGES.templateSelection,
      sub_stage: 'template_select',
      attempt: 1,
    },
  });
  if (!ai.success) return ai;
  return templateSelectorAgent.parseTemplateSelectionResponse(ai.text, { compactIndex: selectionIndex });
}

async function requestTemplateInputs({ model, template, creativeContext, sceneSpec }) {
  const prompt = templateInputAgent.buildTemplateInputPrompt({
    sceneSpec: sceneSpec || {
      title: creativeContext?.brief?.title || creativeContext?.input?.raw_text || creativeContext?.input?.title || 'html-video',
      brief: creativeContext?.brief || {},
    },
    template,
    creativeContext,
  });
  const ai = await callTextModel(model, prompt, {
    audit: {
      agent: AGENTS.templateInput,
      stage: STAGES.templateInputs,
      sub_stage: 'template_inputs',
      attempt: 1,
    },
  });
  if (!ai.success) return ai;
  return templateInputAgent.parseTemplateInputResponse(ai.text, { template });
}

function durationFromTarget(target, template) {
  const output = objectOrEmpty(template.output);
  const value = target.duration_sec ?? target.durationSec ?? target.duration ?? output.duration_sec ?? output.duration ?? 6;
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : 6;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function resolveRenderTarget(target = {}, sceneSpec = {}) {
  const aspectRatio = target.aspect_ratio
    || target.aspectRatio
    || sceneSpec.aspect_ratio
    || sceneSpec.aspectRatio
    || '';
  const durationSec = firstPositiveNumber(
    target.duration_sec,
    target.durationSec,
    target.duration,
    target.target_duration_sec,
    target.targetDurationSec,
    sceneSpec.target_duration_sec,
    sceneSpec.targetDurationSec,
  );
  return {
    ...target,
    aspect_ratio: aspectRatio,
    aspectRatio,
    duration_sec: durationSec || target.duration_sec || target.durationSec || target.duration,
  };
}

function resolveTemplateRenderTarget(target = {}, template = {}) {
  const output = objectOrEmpty(template.output);
  const outputResolution = objectOrEmpty(output.resolution);
  const targetResolution = objectOrEmpty(target.resolution);
  const width = firstPositiveNumber(target.width, targetResolution.width, outputResolution.width);
  const height = firstPositiveNumber(target.height, targetResolution.height, outputResolution.height);
  const fps = firstPositiveNumber(target.fps, output.fps);
  const durationSec = firstPositiveNumber(
    target.duration_sec,
    target.durationSec,
    target.duration,
    output.duration_sec,
    output.duration,
  );
  return {
    ...target,
    ...(width && height ? {
      width,
      height,
      resolution: { width, height },
    } : {}),
    ...(fps ? { fps } : {}),
    ...(durationSec ? {
      duration_sec: durationSec,
      durationSec,
    } : {}),
  };
}

function buildTemplateIndexOptions(renderTarget = {}, sceneSpec = {}) {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const isMultiScene = scenes.length > 1;
  return {
    aspectRatio: renderTarget.aspect_ratio || renderTarget.aspectRatio,
    durationSec: isMultiScene
      ? undefined
      : (renderTarget.duration_sec || renderTarget.durationSec || renderTarget.duration),
  };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function resolveLockTemplate(options = {}, target = {}) {
  if (hasOwn(options, 'lockTemplate')) return options.lockTemplate === true;
  if (hasOwn(options, 'lock_template')) return options.lock_template === true;
  return target.lockTemplate === true || target.lock_template === true;
}

function resolvePreferredTemplateId(preferredTemplateId, target = {}) {
  return firstNonEmptyString(preferredTemplateId, target.preferredTemplateId, target.preferred_template_id);
}

function validatePreferredTemplate({ registry, preferredTemplateId, options }) {
  const id = String(preferredTemplateId || '').trim();
  if (!id) return { id: '', template: null, compatible: false, missing: false, validation: null };
  const template = registry.getTemplate(id);
  if (!template) {
    return { id, template: null, compatible: false, missing: true, validation: null };
  }
  const validation = validateTemplateCompatibility(template, options);
  return {
    id,
    template,
    compatible: validation.ok,
    missing: false,
    validation,
  };
}

function resolveGenerationMode(target = {}) {
  return target.html_video_generation_mode
    || target.htmlVideoGenerationMode
    || target.generation_mode
    || 'per_scene';
}

function hasSceneSpecScenes(sceneSpec) {
  return Boolean(sceneSpec && Array.isArray(sceneSpec.scenes) && sceneSpec.scenes.length > 0);
}

function buildInitialProject({ workflowId, runId, sceneSpec, template, templateInputs, target }) {
  const duration = durationFromTarget(target, template);
  const output = objectOrEmpty(template.output);
  const templateSchema = objectOrEmpty(objectOrEmpty(template.inputs).schema);
  const contentGraph = mapSceneSpecToContentGraph(sceneSpec || {});
  const mappedFrames = buildFramesFromGraph({
    sceneSpec: sceneSpec || {},
    contentGraph,
    templateId: template.id,
    templateInputs,
    templateSchema,
  });
  const frames = mappedFrames.length ? mappedFrames : [{
    id: 'frame_01',
    scene_id: 'scene_01',
    order: 1,
    template_id: template.id,
    inputs: templateInputs,
    duration_sec: duration,
  }];
  let cursor = 0;
  const items = frames.map(frame => {
    const durationSec = Number(frame.duration_sec || duration);
    const item = {
      id: `item_${frame.id}`,
      kind: 'frame',
      frame_id: frame.id,
      start_sec: cursor,
      duration_sec: durationSec,
    };
    cursor += durationSec;
    return item;
  });
  return normalizeProject({
    project_id: `${workflowId}_${runId}`,
    workflow_id: workflowId,
    run_id: runId,
    template_id: template.id,
    template_inputs: templateInputs,
    output,
    template_schema: templateSchema,
    content_graph: contentGraph,
    frames,
    timeline: {
      tracks: [
        { id: 'main', type: 'video', items },
        { id: 'voice', type: 'audio', items: [] },
        { id: 'music', type: 'audio', items: [] },
      ],
    },
  });
}

async function materializeCreativeContextAssets(projectDir, creativeContext = {}) {
  const assetContext = objectOrEmpty(creativeContext.asset_context);
  const assets = Array.isArray(assetContext.assets) ? assetContext.assets : [];
  if (!assets.length) return creativeContext;
  await fsp.mkdir(path.join(projectDir, 'assets'), { recursive: true });
  const nextAssets = [];
  const diagnostics = Array.isArray(assetContext.diagnostics) ? [...assetContext.diagnostics] : [];
  for (const asset of assets) {
    const sourcePath = String(asset.local_path || '').trim();
    const hasSourceFile = Boolean(sourcePath && fs.existsSync(sourcePath));
    const fallbackName = path.posix.basename(String(asset.path || `asset-${nextAssets.length + 1}.jpg`).replace(/\\/g, '/'));
    const fileName = fallbackName && !fallbackName.includes('..') ? fallbackName : `asset-${nextAssets.length + 1}.jpg`;
    const targetRelative = `assets/${fileName}`;
    const targetPath = projectStore.resolveProjectPath(projectDir, targetRelative);
    if (hasSourceFile) {
      await fsp.copyFile(sourcePath, targetPath).catch(error => {
        diagnostics.push(createDiagnostic({
          code: 'source_asset_materialize_failed',
          stage: 'project',
          sub_stage: 'assets',
          user_message: `来源图片 ${asset.id || asset.path || ''} 复制到 html-video 工程失败：${error.message}`,
          severity: 'warning',
        }));
      });
    }
    if (!fs.existsSync(targetPath)) {
      diagnostics.push(createDiagnostic({
        code: 'source_asset_materialize_missing',
        stage: 'project',
        sub_stage: 'assets',
        user_message: hasSourceFile
          ? `来源图片 ${asset.id || asset.path || ''} 未进入 html-video 工程。`
          : `来源图片 ${asset.id || asset.path || ''} 缺少本地文件，未进入 html-video 工程。`,
        severity: 'warning',
      }));
      continue;
    }
    nextAssets.push({
      ...asset,
      path: targetRelative,
      frame_src: `../${targetRelative}`,
    });
  }
  creativeContext.asset_context = {
    ...assetContext,
    assets: nextAssets,
    diagnostics,
  };
  return creativeContext;
}

function projectAssetsFromCreativeContext(creativeContext = {}) {
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  return assets.map((asset, index) => ({
    id: asset.id || `source_asset_${index + 1}`,
    type: asset.type || 'image',
    path: asset.path,
    source: asset.source || '',
    url: asset.url || '',
    alt: asset.alt || '',
    attribution: asset.attribution || null,
    generation: asset.generation || null,
  })).filter(asset => asset.path);
}

function normalizeAssetToken(value = '') {
  return String(value || '').replace(/\\/g, '/').trim();
}

function expandContentGraphToVisualBeats({ graph = {}, visualPlan = {}, visualDecisions = null } = {}) {
  const beats = Array.isArray(visualPlan?.beats) ? visualPlan.beats.filter(beat => beat && beat.id) : [];
  if (!beats.length || !Array.isArray(graph?.nodes) || !graph.nodes.length) return graph;
  const orderedNodeIds = (() => {
    try {
      return topoSort(graph);
    } catch {
      return graph.nodes.map(node => node.id);
    }
  })();
  const nodeById = new Map(graph.nodes.map(node => [String(node.id || ''), node]));
  const nodeBySceneId = new Map();
  for (const nodeId of orderedNodeIds) {
    const node = nodeById.get(String(nodeId)) || {};
    const sceneId = resolveNodeSceneId(node);
    if (sceneId && !nodeBySceneId.has(sceneId)) nodeBySceneId.set(sceneId, node);
  }
  const nodes = [];
  for (const beat of beats) {
    const sceneId = String(beat.scene_id || '').trim();
    const base = nodeBySceneId.get(sceneId);
    if (!base) continue;
    const decision = visualDecisions instanceof Map ? visualDecisions.get(beat.id) : null;
    const metadata = objectOrEmpty(base.metadata);
    // beat refs 为空数组时回落 base 节点素材引用，避免空数组吞掉 content graph/scene 上已绑定的素材
    const beatAssetRefs = Array.isArray(beat.asset_refs) ? beat.asset_refs.filter(Boolean) : [];
    const baseAssetRefs = Array.isArray(base.asset_refs) ? base.asset_refs.filter(Boolean) : [];
    nodes.push({
      ...cloneJson(base),
      id: beat.id,
      scene_id: sceneId,
      beat_id: beat.id,
      kind: beat.kind || base.kind || 'text',
      label: firstNonEmptyString(beat.visual_text?.headline, base.label, sceneId),
      text: firstNonEmptyString(
        Array.isArray(beat.visual_text?.cards) ? beat.visual_text.cards.join(' / ') : '',
        Array.isArray(beat.visual_text?.keywords) ? beat.visual_text.keywords.join(' / ') : '',
        base.text,
      ),
      data: {
        ...objectOrEmpty(base.data),
        visual_text: cloneJson(beat.visual_text || {}),
      },
      durationSec: beat.duration_sec,
      duration_sec: beat.duration_sec,
      asset_refs: cloneJson(beatAssetRefs.length ? beatAssetRefs : baseAssetRefs),
      metadata: {
        ...metadata,
        scene_id: sceneId,
        beat_id: beat.id,
        beat_index: beat.beat_index,
        beat_count: beat.beat_count,
        visual_text: cloneJson(beat.visual_text || {}),
        source_mode: decision?.source_mode || '',
        // R3：剥离 source_scene 后整 beat 下传（含 visual_base/motion_overlay/continuity，模块 2 已写入）
        visual_beat: cloneJson((({ source_scene, ...rest }) => rest)(beat)),
      },
      html_path: '',
      htmlPath: '',
    });
  }
  if (!nodes.length) return graph;
  const edges = nodes.slice(1).map((node, index) => ({
    from: nodes[index].id,
    to: node.id,
    kind: 'sequence',
  }));
  return {
    ...graph,
    nodes,
    edges,
    expanded_from_scene_graph: true,
  };
}

// scene_html（asset_first 专用）：按 scene 分组把 content graph 展开为 scene 级节点，
// 一个 scene 一个 node（id = scene:<scene_id>），组内 beat 编排字段整体挂在 metadata 下随 node 传递；
// html_path 置空，由 frameHtmlPhase 生成整场景 HTML 后回写（与 beat 节点同一回写路径）。
function expandContentGraphToSceneEntries(graph = {}, visualPlan = {}) {
  const beats = Array.isArray(visualPlan?.beats) ? visualPlan.beats.filter(beat => beat && beat.id) : [];
  if (!beats.length || !Array.isArray(graph?.nodes) || !graph.nodes.length) return graph;
  const baseBySceneId = new Map();
  for (const node of graph.nodes) {
    const sceneId = String(resolveNodeSceneId(node) || node?.id || '').trim();
    if (sceneId && !baseBySceneId.has(sceneId)) baseBySceneId.set(sceneId, node);
  }
  const nodes = [];
  for (const group of groupBeatsForSceneHtml(beats)) {
    const base = baseBySceneId.get(group.scene_id) || {};
    nodes.push({
      ...cloneJson(base),
      id: `scene:${group.scene_id}`,
      scene_id: group.scene_id,
      beat_id: '',
      kind: base.kind || group.beats[0]?.kind || 'text',
      duration_sec: group.duration_sec,
      durationSec: group.duration_sec,
      asset_refs: cloneJson(group.beats.flatMap(beat => (Array.isArray(beat.asset_refs) ? beat.asset_refs.filter(Boolean) : []))),
      metadata: {
        ...objectOrEmpty(base.metadata),
        scene_id: group.scene_id,
        beat_windows: group.beats.map(beat => ({ id: beat.id, start_sec: beat.start_sec, end_sec: beat.end_sec })),
        visual_beats: cloneJson(group.beats.map(({ source_scene, ...rest }) => rest)),
        source_mode: 'raw_html',
      },
      html_path: '',
      htmlPath: '',
    });
  }
  if (!nodes.length) return graph;
  const edges = nodes.slice(1).map((node, index) => ({
    from: nodes[index].id,
    to: node.id,
    kind: 'sequence',
  }));
  return {
    ...graph,
    nodes,
    edges,
    expanded_from_scene_graph: true,
  };
}

function referenceVariants(value = '') {
  const normalized = normalizeHtmlAssetReference(value);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  if (normalized.startsWith('./')) variants.add(normalized.slice(2));
  if (!normalized.startsWith('../') && !normalized.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    variants.add(`../${normalized}`);
  }
  return [...variants];
}

function assetReferenceTokens(asset = {}) {
  const assetPath = normalizeAssetToken(asset.path);
  return [...new Set([
    normalizeAssetToken(asset.frame_src),
    assetPath,
    assetPath ? `../${assetPath}` : '',
    normalizeAssetToken(asset.url),
  ].filter(Boolean))];
}

function normalizeHtmlAssetReference(value = '') {
  const text = normalizeAssetToken(value).split(/[?#]/)[0];
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function extractHtmlAssetReferences(html = '') {
  const references = new Set();
  const searchable = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const attrPattern = /\b(?:src|href|poster|data-src)=["']([^"']+)["']/gi;
  for (const match of searchable.matchAll(attrPattern)) {
    const value = normalizeHtmlAssetReference(match[1]);
    if (value) references.add(value);
  }
  const cssPattern = /url\(["']?([^"')]+)["']?\)/gi;
  for (const match of searchable.matchAll(cssPattern)) {
    const value = normalizeHtmlAssetReference(match[1]);
    if (value) references.add(value);
  }
  return references;
}

function htmlReferencesAsset(referenceSet, tokens = []) {
  const references = new Set();
  for (const ref of referenceSet) {
    for (const variant of referenceVariants(ref)) references.add(variant);
  }
  for (const rawToken of tokens) {
    for (const token of referenceVariants(rawToken)) {
      if (references.has(token)) return true;
    }
  }
  return false;
}

function readFrameHtml(projectDir, frame = {}) {
  const htmlPath = firstNonEmptyString(frame.html_path, frame.htmlPath);
  if (!htmlPath) return '';
  try {
    const absolutePath = projectStore.resolveProjectPath(projectDir, htmlPath);
    if (!fs.existsSync(absolutePath)) return '';
    return fs.readFileSync(absolutePath, 'utf8').replace(/\\/g, '/');
  } catch {
    return '';
  }
}

function mergedTrackableAssets(project = {}, creativeContext = {}) {
  const seen = new Set();
  const result = [];
  const push = asset => {
    const id = firstNonEmptyString(asset?.id, asset?.asset_id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    result.push({ ...asset, id });
  };
  (Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : []).forEach(push);
  (Array.isArray(project?.assets) ? project.assets : []).forEach(push);
  return result;
}

function requiredAssetRefsById(project = {}, assets = []) {
  const byId = new Map();
  const ensure = (assetId, sceneId, usage) => {
    if (!assetId) return;
    const current = byId.get(assetId) || { asset_id: assetId, expected_in_frames: [], usages: [] };
    if (sceneId && !current.expected_in_frames.includes(sceneId)) current.expected_in_frames.push(sceneId);
    if (usage && !current.usages.includes(usage)) current.usages.push(usage);
    byId.set(assetId, current);
  };
  for (const asset of assets) {
    if (asset?.source !== 'generated') continue;
    ensure(firstNonEmptyString(asset.id, asset.asset_id), firstNonEmptyString(asset.generation?.scene_id), 'generated');
  }
  for (const node of (Array.isArray(project?.content_graph?.nodes) ? project.content_graph.nodes : [])) {
    const sceneId = firstNonEmptyString(resolveNodeSceneId(node), node?.id);
    for (const ref of (Array.isArray(node?.asset_refs) ? node.asset_refs : [])) {
      const assetId = firstNonEmptyString(ref?.asset_id, ref?.id);
      ensure(assetId, sceneId, firstNonEmptyString(ref?.usage));
    }
  }
  return byId;
}

function buildAssetUsageReport({ project = {}, projectDir = '', creativeContext = {} } = {}) {
  const assets = mergedTrackableAssets(project, creativeContext);
  if (!assets.length) {
    return {
      status: 'empty',
      assets: [],
      used_asset_ids: [],
      unused_asset_ids: [],
      required_asset_ids: [],
      missing_required_asset_ids: [],
      summary: '没有可追踪的视觉素材。',
    };
  }
  const frames = Array.isArray(project.frames) ? project.frames : [];
  const requiredById = requiredAssetRefsById(project, assets);
  const frameHtmlEntries = frames.map(frame => ({
    id: firstNonEmptyString(frame.scene_id, frame.id),
    references: extractHtmlAssetReferences(readFrameHtml(projectDir, frame)),
  }));
  const reportAssets = assets.map((asset, index) => {
    const assetId = firstNonEmptyString(asset.id, `asset_${index + 1}`);
    const tokens = assetReferenceTokens(asset);
    const required = requiredById.get(assetId) || null;
    const usedInFrames = frameHtmlEntries
      .filter(frame => frame.id && htmlReferencesAsset(frame.references, tokens))
      .map(frame => frame.id);
    return {
      asset_id: assetId,
      path: asset.path || '',
      frame_src: asset.frame_src || '',
      source: asset.source || '',
      required: Boolean(required),
      expected_in_frames: required?.expected_in_frames || [],
      usage: required?.usages || [],
      used: usedInFrames.length > 0,
      used_in_frames: usedInFrames,
      usage_count: usedInFrames.length,
    };
  });
  const usedAssetIds = reportAssets.filter(asset => asset.used).map(asset => asset.asset_id);
  const unusedAssetIds = reportAssets.filter(asset => !asset.used).map(asset => asset.asset_id);
  const requiredAssetIds = reportAssets.filter(asset => asset.required).map(asset => asset.asset_id);
  const missingRequiredAssetIds = reportAssets
    .filter(asset => asset.required && !asset.used)
    .map(asset => asset.asset_id);
  return {
    status: 'ready',
    assets: reportAssets,
    used_asset_ids: usedAssetIds,
    unused_asset_ids: unusedAssetIds,
    required_asset_ids: requiredAssetIds,
    missing_required_asset_ids: missingRequiredAssetIds,
    summary: missingRequiredAssetIds.length
      ? `有 ${missingRequiredAssetIds.length} 个必用视觉素材未进入最终 HTML。`
      : (usedAssetIds.length
        ? `最终 HTML 使用了 ${usedAssetIds.length} 张视觉素材。`
        : '最终 HTML 未引用已准备的视觉素材。'),
  };
}

async function attachAssetUsageReport({ project = {}, projectDir = '', creativeContext = {} } = {}) {
  const assetUsageReport = buildAssetUsageReport({ project, projectDir, creativeContext });
  project.asset_usage_report = assetUsageReport;
  if (creativeContext.asset_context) creativeContext.asset_context.asset_usage_report = assetUsageReport;
  return projectDir ? projectStore.saveProject(projectDir, project) : project;
}

function missingRequiredAssetIds(project = {}) {
  return Array.isArray(project?.asset_usage_report?.missing_required_asset_ids)
    ? project.asset_usage_report.missing_required_asset_ids.filter(Boolean)
    : [];
}

function isBlockingVisualQaIssue(issue = {}) {
  return ['blank_opening_frame', 'blank_segment_boundary'].includes(String(issue.code || ''));
}

function applyMediaOptionsToProject(project, mediaOptions = {}) {
  if (mediaOptions.generateCaptions !== false) return project;
  for (const frame of Array.isArray(project?.frames) ? project.frames : []) {
    frame.generate_captions = false;
    frame.captions = [];
  }
  return project;
}

function mediaOptionEnabled(key, target = {}, projectOptions = {}) {
  const snakeKey = key === 'generateAudio' ? 'generate_audio' : 'generate_captions';
  if (typeof projectOptions[key] === 'boolean') return projectOptions[key];
  if (typeof projectOptions[snakeKey] === 'boolean') return projectOptions[snakeKey];
  if (typeof target[key] === 'boolean') return target[key];
  if (typeof target[snakeKey] === 'boolean') return target[snakeKey];
  return true;
}

function normalizeFrameHtmlConcurrency(target = {}, projectOptions = {}) {
  const number = Number(projectOptions.frameHtmlConcurrency ?? projectOptions.frame_html_concurrency ?? target.frameHtmlConcurrency ?? target.frame_html_concurrency);
  if (!Number.isFinite(number)) return 1;
  return Math.min(5, Math.max(1, Math.round(number)));
}

function summarizeVisualRoute(project = {}) {
  const frames = Array.isArray(project.frames) ? project.frames : [];
  const decisions = Array.isArray(project.render_decisions) ? project.render_decisions : [];
  const styleProfile = objectOrEmpty(project.visual_plan?.style_profile);
  return {
    total_beats: Array.isArray(project.visual_plan?.beats) ? project.visual_plan.beats.length : frames.length,
    template_inputs: frames.filter(frame => frame.source_mode === 'template_inputs').length,
    raw_html: frames.filter(frame => frame.source_mode === 'raw_html').length,
    fallback: decisions.filter(decision => decision.fallback_from || decision.fallback_reason).length,
    style_profile_id: styleProfile.id || '',
  };
}

function resolveRegistry(input) {
  if (input) return input;
  return createTemplateRegistry({ rootDir: DEFAULT_ROOT_DIR });
}

async function runEnvironmentDoctor(services) {
  const doctor = services.environmentDoctor || environmentDoctor.diagnoseEnvironment;
  return doctor();
}

async function generateHtmlVideo(options = {}) {
  const {
    workflowId,
    runId,
    rootDir,
    sceneSpec: inputSceneSpec = null,
    creativeContext: inputCreativeContext = {},
    target = {},
    templateRegistry,
    services = {},
    skipValidation = false,
    runLayoutQa = false,
    onProgress = null,
    preferredTemplateId = '',
    projectOptions = {},
  } = options;
  let creativeContext = inputCreativeContext || {};
  let sceneSpec = inputSceneSpec
    || objectOrEmpty(creativeContext).scene_spec
    || objectOrEmpty(creativeContext).sceneSpec
    || null;
  if (!hasSceneSpecScenes(sceneSpec)) {
    const persistedSceneSpec = await projectStore.loadSceneSpec(existingProjectDir(rootDir, workflowId, runId));
    if (hasSceneSpecScenes(persistedSceneSpec)) sceneSpec = persistedSceneSpec;
  }
  const mediaOptions = {
    generateAudio: mediaOptionEnabled('generateAudio', target, projectOptions),
    generateCaptions: mediaOptionEnabled('generateCaptions', target, projectOptions),
  };
  const frameHtmlConcurrency = normalizeFrameHtmlConcurrency(target, projectOptions);
  const reuseContentGraphRequested = options.reuseContentGraph === true || projectOptions?.reuseContentGraph === true;
  const regenerateFrameHtmlRequested = options.regenerateFrameHtml === true || projectOptions?.regenerateFrameHtml === true;
  const registry = resolveRegistry(templateRegistry);
  const diagnostics = [];
  let model = getModel(services);
  const renderTarget = resolveRenderTarget(target, sceneSpec || {});
  const generationMode = resolveGenerationMode(renderTarget);
  const templateIndexOptions = buildTemplateIndexOptions(renderTarget, sceneSpec || {});
  const effectivePreferredTemplateId = resolvePreferredTemplateId(preferredTemplateId, target);
  const effectiveLockTemplate = resolveLockTemplate(options, target);
  const preferredTemplate = validatePreferredTemplate({
    registry,
    preferredTemplateId: effectivePreferredTemplateId,
    options: templateIndexOptions,
  });
  if (effectiveLockTemplate && effectivePreferredTemplateId && !preferredTemplate.compatible) {
    const aspectRatio = templateIndexOptions.aspectRatio || renderTarget.aspect_ratio || renderTarget.aspectRatio || '未指定';
    const message = `默认模板 ${effectivePreferredTemplateId} 不支持当前画面比例 ${aspectRatio}。`;
    return failure(message, [
      createDiagnostic({
        code: 'locked_template_invalid',
        stage: 'template',
        sub_stage: 'template_select',
        user_message: message,
        details: {
          template_id: effectivePreferredTemplateId,
          aspect_ratio: aspectRatio,
          missing: preferredTemplate.missing,
          reasons: preferredTemplate.validation?.reasons || [],
        },
        fallback_allowed: false,
      }),
    ]);
  }

  let compactIndex = registry.buildCompactIndex(templateIndexOptions);
  if (effectivePreferredTemplateId && !effectiveLockTemplate && !preferredTemplate.compatible) {
    diagnostics.push(createDiagnostic({
      code: 'preferred_template_unavailable',
      stage: 'template',
      sub_stage: 'template_select',
      user_message: `首选模板 ${effectivePreferredTemplateId} 不可用，已回退为普通模板选择。`,
      details: {
        template_id: effectivePreferredTemplateId,
        missing: preferredTemplate.missing,
        reasons: preferredTemplate.validation?.reasons || [],
      },
      severity: 'warning',
      fallback_allowed: true,
    }));
  } else if (effectivePreferredTemplateId && preferredTemplate.compatible) {
    compactIndex = reorderCompactIndex(compactIndex, effectivePreferredTemplateId);
  }

  if (!compactIndex.length && generationMode !== 'per_scene') {
    return failure('没有可用的 html-video 模板。', [
      createDiagnostic({ code: 'template_missing', stage: 'template', sub_stage: 'template_select', user_message: '没有可用的 html-video 模板。' }),
    ]);
  }

  let projectDir = existingProjectDir(rootDir, workflowId, runId);
  const resumeProject = await loadExistingProject(projectDir);
  if (!resumeProject) {
    projectDir = await projectStore.createProjectDir({ rootDir, workflowId, runId });
  }
  model = createAuditedModel(model, projectDir);
  // 尽早广播工程目录：任务运行中前端轮询依赖它水合生成图等工程内素材
  await report(onProgress, {
    type: 'html_video_project_dir_ready',
    stage: 'project',
    sub_stage: 'validate_project',
    message: 'html-video 工程目录已就绪。',
    data: { html_video_project_path: projectDir, project_dir: projectDir },
  });
  if (hasSceneSpecScenes(sceneSpec)) {
    await projectStore.saveSceneSpec(projectDir, sceneSpec);
  }

  let selection = { success: true, template_id: null, reason: '' };
  let template = null;
  let perSceneDecisions = null;
  // beat 级视觉计划：内存版 visualPlan 含 source_scene 供建帧/路由消费，持久化版剥离 source_scene
  let visualPlan = null;
  let persistableVisualPlan = null;
  // beat 级路由决策（Map，键为 beat.id），per_scene 分支赋值，建帧与持久化共用
  let visualDecisions = null;
  let renderDecisions = null;
  // per_scene 工程重建/重写 project.json 时统一挂载视觉计划与路由决策；
  // renderDecisions 在 asset-first 覆写扇出后会重算，这里始终读取最新值
  const attachVisualRouting = target => {
    if (generationMode === 'per_scene' && target) {
      // 持久化生成模式：重试恢复时 resumeArtifactsMatch 依赖它区分 per_scene 与整片模板工程
      target.generation_mode = 'per_scene';
    }
    if (generationMode === 'per_scene' && persistableVisualPlan && target) {
      target.scene_spec = objectOrEmpty(sceneSpec);
      target.visual_plan = persistableVisualPlan;
      target.render_decisions = renderDecisions;
      target.visual_route_summary = summarizeVisualRoute(target);
    }
    return target;
  };
  // 生图/素材水合必须在模板匹配与 beat 路由之前完成，否则路由决策看不到生成图，
  // 会把已有主视觉的场景误路由到不支持图片的 template_inputs 模板。
  creativeContext = await materializeCreativeContextAssets(projectDir, creativeContext);
  const existingProjectForGeneration = resumeProject || await loadExistingProject(projectDir);
  if (generationMode === 'template_inputs') {
    if (creativeContext?.visual_strategy === 'asset_first') {
      diagnostics.push(createDiagnostic({
        code: 'generated_image_unsupported_mode',
        stage: 'project',
        sub_stage: 'gen_images',
        user_message: '当前为整片模板模式（template_inputs），不支持图片/视频优先的主视觉生成，已跳过。',
        severity: 'warning',
      }));
    }
  } else {
    creativeContext = hydrateGeneratedAssetsFromProject({
      project: existingProjectForGeneration,
      creativeContext,
      projectDir,
    });
    let skipGeneration = false;
    let requiredSceneIds = [];
    if (reuseContentGraphRequested) {
      const reusedNodes = Array.isArray(existingProjectForGeneration?.content_graph?.nodes)
        ? existingProjectForGeneration.content_graph.nodes
        : [];
      const referencedGeneratedIds = new Set(reusedNodes
        .flatMap(node => (Array.isArray(node?.asset_refs) ? node.asset_refs : []))
        .map(ref => String(ref?.asset_id || ''))
        .filter(id => id.startsWith('gen_')));
      const hydratedGeneratedIds = new Set((creativeContext.asset_context?.assets || [])
        .filter(asset => asset?.source === 'generated')
        .map(asset => asset.id));
      requiredSceneIds = [...referencedGeneratedIds]
        .filter(id => !hydratedGeneratedIds.has(id))
        .map(id => id.replace(/^gen_/, ''));
      skipGeneration = requiredSceneIds.length === 0;
    }
    const generatedImageResult = skipGeneration
      ? { creativeContext, generated_count: 0, failures: [], diagnostics: [] }
      : await runGeneratedImagePhase({
        sceneSpec,
        creativeContext,
        projectDir,
        aspectRatio: renderTarget.aspect_ratio || renderTarget.aspectRatio || '',
        requiredSceneIds,
        services: { ...services, aiTextModel: model },
        onProgress,
        now: new Date().toISOString(),
      });
    creativeContext = generatedImageResult.creativeContext;
    if (generatedImageResult.diagnostics?.length) diagnostics.push(...generatedImageResult.diagnostics);
    if (generatedImageResult.generated_count > 0) {
      await projectStore.writeProjectJson(projectDir, current => {
        const generatedAssets = (creativeContext.asset_context?.assets || [])
          .filter(asset => asset?.source === 'generated')
          .map(asset => ({
            id: asset.id,
            type: 'image',
            path: asset.path,
            source: asset.source,
            url: asset.url || '',
            alt: asset.alt || '',
            attribution: null,
            generation: asset.generation || null,
          }));
        const byId = new Map((current.assets || []).map(asset => [asset.id, asset]));
        generatedAssets.forEach(asset => byId.set(asset.id, { ...(byId.get(asset.id) || {}), ...asset }));
        current.assets = Array.from(byId.values()).filter(asset => asset.path);
        return current;
      });
    }
  }
  if (generationMode === 'per_scene') {
    if (!hasSceneSpecScenes(sceneSpec)) {
      return failure('缺少 scene_spec，无法逐场景匹配模板。', [
        createDiagnostic({
          code: 'scene_spec_missing',
          stage: 'project',
          sub_stage: 'template_select',
          user_message: '缺少 scene_spec，无法逐场景匹配模板。',
          details: { generation_mode: generationMode },
          fallback_allowed: false,
        }),
      ], {
        html_video_project_path: projectDir,
        project_dir: projectDir,
      });
    }
    const styleTemplateId = preferredTemplate.compatible
      ? effectivePreferredTemplateId
      : (compactIndex[0]?.id || '');
    template = styleTemplateId ? registry.getTemplate(styleTemplateId) : {};
    // 路由输入用绑定生成图后的克隆 spec；原始 sceneSpec 保持不变以稳定 scene_spec_hash
    const routingSceneSpec = bindGeneratedAssetsToSceneSpec(sceneSpec, creativeContext);
    perSceneDecisions = matchScenesToTemplates({
      scenes: routingSceneSpec.scenes,
      registry,
      renderTarget,
    });
    visualPlan = buildVisualPlan({ sceneSpec: routingSceneSpec, workflowId });
    assignMotionOrchestration(visualPlan, {
      visualStrategy: creativeContext?.visual_strategy || null,
      styleProfile: visualPlan.style_profile || null,
    });
    visualDecisions = matchVisualBeatsToRenderers({
      visualPlan,
      registry,
      renderTarget,
      options: { visualStrategy: creativeContext?.visual_strategy || null },
    });
    renderDecisions = Array.from(visualDecisions.values());
    // 持久化版剥离 source_scene，防止 project.json 膨胀
    persistableVisualPlan = {
      ...visualPlan,
      beats: visualPlan.beats.map(({ source_scene, ...beat }) => beat),
    };
    for (const decision of perSceneDecisions.values()) {
      if (decision.source_mode === 'raw_html') {
        diagnostics.push(createDiagnostic({
          code: decision.diagnostic?.code || 'scene_template_fallback',
          stage: 'template',
          sub_stage: 'template_select',
          frame_id: decision.scene_id,
          severity: 'warning',
          fallback_allowed: true,
          user_message: decision.fallback_reason || '该场景未匹配到合适模板，已用自由生成兜底。',
          details: decision.diagnostic?.details || {},
        }));
      }
    }
  } else {
    selection = await requestTemplateSelection({
      model,
      compactIndex,
      creativeContext,
      target: renderTarget,
      sceneSpec,
      preferredTemplateId: preferredTemplate.compatible ? effectivePreferredTemplateId : '',
      lockTemplate: effectiveLockTemplate,
    });
    if (!selection.success) {
      const selectionDiagnostics = selection.diagnostics || [];
      const code = selectionDiagnostics.some(item => String(item).includes('unknown_template_id'))
        ? 'template_missing'
        : 'ai_response_invalid';
      const message = selection.user_message || selection.message || '模板选择失败。';
      return failure(`html-video ${message}`, [
        createDiagnostic({
          code,
          stage: 'ai-template-selection',
          sub_stage: 'template_select',
          user_message: `html-video ${message}`,
          details: { diagnostics: selectionDiagnostics },
        }),
      ]);
    }

    template = registry.getTemplate(selection.template_id);
    if (!template) {
      return failure(`未找到 html-video 模板：${selection.template_id}。`, [
        createDiagnostic({
          code: 'template_missing',
          stage: 'template',
          sub_stage: 'template_select',
          user_message: `未找到 html-video 模板：${selection.template_id}。`,
          details: { template_id: selection.template_id },
        }),
      ]);
    }
  }
  const templateRenderTarget = resolveTemplateRenderTarget(renderTarget, template);
  const currentSceneSpecHash = computeSceneSpecCheckpointHash(sceneSpec || {});
  const trustedTargetDurationSec = firstPositiveNumber(
    templateRenderTarget.duration_sec,
    templateRenderTarget.durationSec,
    templateRenderTarget.duration,
  );
  await report(onProgress, {
    type: 'html_video_template_selected',
    stage: 'project',
    sub_stage: 'template_select',
    message: generationMode === 'per_scene'
      ? '已启用逐场景模板匹配，未设置全片主模板。'
      : `已选择 html-video 模板：${template.name || template.id}。`,
    data: {
      template_id: generationMode === 'per_scene' ? null : template.id,
      style_reference_template_id: generationMode === 'per_scene' ? (template.id || null) : null,
      template_name: template.name || '',
      reason: selection.reason || '',
    },
  });

  const env = skipValidation ? { ok: true, diagnostics: [] } : await runEnvironmentDoctor(services);
  if (generationMode === 'raw_html' && !hasSceneSpecScenes(sceneSpec)) {
    return failure('缺少 scene_spec，无法生成 raw_html 帧。', [
      ...diagnostics,
      createDiagnostic({
        code: 'scene_spec_missing',
        stage: 'project',
        sub_stage: 'raw_html_build',
        user_message: '缺少 scene_spec，无法生成 raw_html 帧。',
        details: { generation_mode: generationMode },
        fallback_allowed: false,
      }),
    ], {
      html_video_project_path: projectDir,
      project_dir: projectDir,
    });
  }
  let project = resumeProject || undefined;
  let templateInputs = {};

  if (generationMode === 'template_inputs') {
    const inputResult = await requestTemplateInputs({
      model,
      template,
      creativeContext,
      sceneSpec,
    });
    if (!inputResult.success) {
      return failure(inputResult.user_message || inputResult.message || 'html-video 模板字段填写失败。', [
        ...diagnostics,
        createDiagnostic({
          code: 'template_inputs_invalid',
          stage: 'ai-template-inputs',
          sub_stage: 'template_inputs',
          user_message: inputResult.user_message || inputResult.message || 'html-video 模板字段填写失败。',
          details: { diagnostics: inputResult.diagnostics || [] },
        }),
      ], {
        html_video_project_path: projectDir,
        project_dir: projectDir,
      });
    }
    templateInputs = inputResult.inputs;
    project = buildInitialProject({
      workflowId,
      runId,
      sceneSpec,
      template,
      templateInputs,
      target: templateRenderTarget,
    });
    const checkpointProject = await loadExistingProject(projectDir);
    if (checkpointProject?.generation_checkpoint?.model_calls?.length) {
      project.generation_checkpoint.model_calls = checkpointProject.generation_checkpoint.model_calls;
    }
  } else {
    const resumeAllowed = resumeArtifactsMatch(resumeProject || {}, sceneSpec, template, generationMode);
    let contentGraph = resolveResumeContentGraph(projectDir, resumeProject, sceneSpec, template, generationMode);
    const reusedContentGraph = Boolean(contentGraph);
    if (contentGraph) {
      project = await projectStore.writeProjectJson(projectDir, current => {
        current.template_id = generationMode === 'per_scene' ? null : (template.id || current.template_id);
        attachVisualRouting(current);
        current.generation_checkpoint.scene_spec_hash = currentSceneSpecHash;
        current.content_graph = contentGraph;
        markCheckpointStage(current, 'content_graph', {
          status: 'done',
          reused: true,
          diagnostic_code: '',
        });
        return current;
      });
    } else {
      if (reuseContentGraphRequested) {
        const message = '未找到可复用的内容图，请先完整生成一次视频。';
        return failure(message, [
          ...diagnostics,
          createDiagnostic({
            code: 'content_graph_reuse_missing',
            stage: 'project',
            sub_stage: 'content_graph',
            user_message: message,
            retryable: false,
            fallback_allowed: false,
          }),
        ], {
          html_video_project_path: projectDir,
          project_dir: projectDir,
          project,
        });
      }
      await report(onProgress, {
        type: 'html_video_graph_started',
        stage: 'project',
        sub_stage: 'content_graph',
        message: '正在生成 html-video 内容图...',
        data: {},
      });
      const graphResult = await generateContentGraphWithRetry({
        model,
        sceneSpec,
        creativeContext,
        target: templateRenderTarget,
        onProgress,
        project,
        projectDir,
      });
      if (!graphResult.success) {
        const graphDiagnostics = normalizeDiagnostics(graphResult.diagnostics, {
          code: 'content_graph_failed',
          stage: 'ai-content-graph',
          sub_stage: 'content_graph',
          user_message: graphResult.message || 'content graph 生成失败。',
          retryable: true,
          repair_action: 'retry_content_graph',
        });
        project = await projectStore.writeProjectJson(projectDir, current => {
          markCheckpointStage(current, 'content_graph', {
            status: 'failed',
            input_hash: graphResult.inputHash || '',
            diagnostic_code: graphDiagnostics[0]?.code || 'content_graph_failed',
          });
          return current;
        });
        return failure(graphResult.message || 'content graph 生成失败。', [...diagnostics, ...graphDiagnostics], {
          html_video_project_path: projectDir,
          project_dir: projectDir,
          project,
        });
      }
      diagnostics.push(...normalizeDiagnostics(graphResult.diagnostics));
      contentGraph = graphResult.contentGraph;
      if (sceneSpec) {
        const graphBinding = validateGraphMatchesSceneSpec(contentGraph, sceneSpec);
        if (!graphBinding.ok) {
          const graphDiagnostics = [
            ...diagnostics,
            contentGraphSceneSpecMismatchDiagnostic(graphBinding),
          ];
          await report(onProgress, {
            type: 'html_video_graph_scene_spec_mismatch',
            stage: 'project',
            sub_stage: 'content_graph',
            message: CONTENT_GRAPH_SCENE_SPEC_MISMATCH_MESSAGE,
            data: graphBinding,
          });
          project = await projectStore.writeProjectJson(projectDir, current => {
            markCheckpointStage(current, 'content_graph', {
              status: 'failed',
              input_hash: graphResult.inputHash || '',
              diagnostic_code: 'content_graph_scene_spec_mismatch',
            });
            return current;
          });
          return failure(CONTENT_GRAPH_SCENE_SPEC_MISMATCH_MESSAGE, graphDiagnostics, {
            html_video_project_path: projectDir,
            project_dir: projectDir,
            project,
          });
        }
      }
      await report(onProgress, {
        type: 'html_video_graph_done',
        stage: 'project',
        sub_stage: 'content_graph',
        message: 'html-video 内容图已生成。',
        data: {
          node_count: contentGraph.nodes?.length || 0,
          edge_count: contentGraph.edges?.length || 0,
        },
      });
      const contentGraphPath = await projectStore.saveContentGraph(projectDir, contentGraph);
      project = await projectStore.writeProjectJson(projectDir, current => {
        if (!reusedContentGraph) invalidateFrameHtmlResumeState(current);
        current.template_id = generationMode === 'per_scene' ? null : (template.id || current.template_id);
        attachVisualRouting(current);
        current.content_graph = contentGraph;
        current.generation_checkpoint.scene_spec_hash = currentSceneSpecHash;
        current.generation_checkpoint.target = {
          duration_sec: firstPositiveNumber(templateRenderTarget.duration_sec, templateRenderTarget.durationSec, templateRenderTarget.duration),
          aspect_ratio: templateRenderTarget.aspect_ratio || templateRenderTarget.aspectRatio || '',
        };
        markCheckpointStage(current, 'content_graph', {
          status: 'done',
          path: contentGraphPath,
          input_hash: graphResult.inputHash || '',
          output_hash: sha256(JSON.stringify(contentGraph)),
          diagnostic_code: '',
          reused: false,
        });
        return current;
      });
    }
    if (generationMode === 'per_scene') {
      enforceAssetFirstRawHtmlRouting({
        decisions: perSceneDecisions,
        contentGraph,
        creativeContext,
      });
      // asset-first 覆写按 scene 生效，这里扇出到该场景全部 beat，并重算持久化的 render_decisions，
      // 消除“盘上 render_decisions 与实际建帧路由不一致”的时序缺陷
      const fannedOut = fanOutAssetFirstOverridesToBeats({
        perSceneDecisions,
        visualPlan,
        visualDecisions,
      });
      if (fannedOut) {
        renderDecisions = Array.from(visualDecisions.values());
        project = await projectStore.writeProjectJson(projectDir, current => attachVisualRouting(current));
      }
      // scene_html 分支只在 asset_first + scene_html 生效；此时 project.visual_strategy 尚未挂载
      // （attachVisualStrategy 在建帧后才调用），用 creativeContext 判断等价条件。
      contentGraph = (creativeContext?.visual_strategy === 'asset_first'
        && (creativeContext?.continuity_mode || 'beat_mp4') === 'scene_html')
        ? expandContentGraphToSceneEntries(contentGraph, visualPlan)
        : expandContentGraphToVisualBeats({ graph: contentGraph, visualPlan, visualDecisions });
      const expandedContentGraphPath = await projectStore.saveContentGraph(projectDir, contentGraph);
      project = await projectStore.writeProjectJson(projectDir, current => {
        current.content_graph = contentGraph;
        current.generation_checkpoint = objectOrEmpty(current.generation_checkpoint);
        current.generation_checkpoint.stages = objectOrEmpty(current.generation_checkpoint.stages);
        current.generation_checkpoint.stages.content_graph = {
          ...(current.generation_checkpoint.stages.content_graph || {}),
          path: expandedContentGraphPath,
          output_hash: sha256(JSON.stringify(contentGraph)),
        };
        attachVisualRouting(current);
        return current;
      });
    }
    const frameHtmlResult = await runFrameHtmlPhase({
      model,
      projectDir,
      project,
      contentGraph,
      sceneSpec,
      creativeContext,
      templateRenderTarget,
      template,
      mediaOptions,
      frameHtmlConcurrency,
      resumeAllowed,
      regenerateFrameHtmlRequested,
      // 帧生成阶段的布局自检不跟随 skipValidation：skipValidation 只跳过阻断式校验，
      // 而这里是生成质量自修复，关掉它就会重现“元素互相遮挡”的成片。
      runLayoutQa: runLayoutQa === true,
      layoutQaService: services.layoutQaService || defaultLayoutQaService,
      onProgress,
      diagnostics,
      report,
      objectOrEmpty,
      sha256,
      failure,
      shouldReuseFrameHtml,
      invalidateFrameHtmlDependents,
      templateRoutingDecisions: generationMode === 'per_scene'
        ? visualDecisions
        : perSceneDecisions,
    });
    if (!frameHtmlResult.ok) return frameHtmlResult.failure;
    project = frameHtmlResult.project;
    contentGraph = frameHtmlResult.contentGraph;
    // R4：在 attachVisualRouting 重挂之前，把帧统计合并进闭包引用的决策源对象
    mergeFrameStatsIntoDecisions({
      visualDecisions,
      renderDecisions,
      statsByBeatId: frameHtmlResult.stats_by_beat_id || {},
    });
    try {
      project = generationMode === 'per_scene'
        ? await buildMixedFrameProject({
          projectDir,
          workflowId,
          runId,
          graph: contentGraph,
          sceneSpec,
          target: templateRenderTarget,
          registry,
          decisions: visualDecisions,
          visualPlan,
          mediaOptions,
          generationCheckpoint: project?.generation_checkpoint,
          // 与 attachVisualStrategy 同优先级（creativeContext 优先）：此时 project 尚未挂策略，
          // 且 normalizeProject 会把 continuity_mode 缺省成 beat_mp4，不能反过来盖掉 creativeContext
          continuityMode: creativeContext?.continuity_mode || project?.continuity_mode || 'beat_mp4',
          visualStrategy: creativeContext?.visual_strategy || project?.visual_strategy || null,
        })
        : await buildRawHtmlFrameProject({
          projectDir,
          workflowId,
          runId,
          graph: contentGraph,
          sceneSpec,
          target: templateRenderTarget,
          template,
          mediaOptions,
        });
      // buildMixedFrameProject 会重建 project，这里要重新挂上视觉计划与路由决策
      attachVisualRouting(project);
      attachVisualStrategy(project, creativeContext);
      project.generation_checkpoint = objectOrEmpty(project.generation_checkpoint);
      project.generation_checkpoint.agent_pipeline = [
        { agent: AGENTS.contentGraph, stage: STAGES.contentGraph, artifact: 'content-graph.json' },
        { agent: AGENTS.frameHtml, stage: STAGES.frameHtml, artifact: 'frames' },
      ];
      project = await projectStore.saveProject(projectDir, project);
    } catch (error) {
      const frameId = rawHtmlBuildFrameIdFromError(error);
      const message = error?.message || 'raw HTML 工程构建失败。';
      return failure(message, [
        ...diagnostics,
        createDiagnostic({
          code: 'raw_html_build_failed',
          stage: 'project',
          sub_stage: 'raw_html_build',
          ...(frameId ? { frame_id: frameId } : {}),
          user_message: message,
          retryable: true,
          repair_action: 'retry_frame_html',
          details: { message },
        }),
      ], {
        html_video_project_path: projectDir,
        project_dir: projectDir,
        project,
      });
    }
  }
  project = applyMediaOptionsToProject(project, mediaOptions);
  // 首次 saveProject 之前统一挂上视觉策略：template_inputs / raw_html / per_scene 三条路径在此汇合
  attachVisualStrategy(project, creativeContext);
  const sourceProjectAssets = projectAssetsFromCreativeContext(creativeContext);
  if (sourceProjectAssets.length) {
    const byPath = new Map((Array.isArray(project.assets) ? project.assets : []).map(asset => [String(asset.path || ''), asset]));
    sourceProjectAssets.forEach(asset => byPath.set(asset.path, { ...(byPath.get(asset.path) || {}), ...asset }));
    project.assets = Array.from(byPath.values()).filter(asset => asset.path);
  }

  const validation = await validateHtmlVideoProject({
    project,
    projectDir,
    templateRegistry: registry,
    environment: env,
    sceneSpec: skipValidation ? null : sceneSpec,
    mediaOptions,
  });
  diagnostics.push(...validation.diagnostics);
  if (!validation.ok) {
    markCheckpointStage(project, 'validate_project', {
      status: 'failed',
      diagnostic_code: validation.diagnostics[0]?.code || diagnostics[0]?.code || 'project_invalid',
    });
    project = await projectStore.saveProject(projectDir, project);
    project = await attachAssetUsageReport({ project, projectDir, creativeContext });
    return failure('html-video 工程未通过生成前校验。', diagnostics, {
      html_video_project_path: projectDir,
      project_dir: projectDir,
      project,
    });
  }
  markCheckpointStage(project, 'validate_project', {
    status: 'done',
    diagnostic_code: '',
  });
  project = await projectStore.saveProject(projectDir, project);

  // 已编排过（含用户在编辑器里的删除标记）就不再重跑 AI，避免恢复/重试时覆盖用户改动；
  // 脚本（scene_spec）变了则时间点已失效，重新编排
  const sfxEnabledForRun = target.autoSfxEnabled !== false && mediaOptions.generateAudio !== false;
  const reusableSfx = [
    objectOrEmpty(objectOrEmpty(project.audio).sfx),
    objectOrEmpty(objectOrEmpty(resumeProject?.audio).sfx),
  ].find(sfx => sfx.status === 'ready'
    && sfx.scene_spec_hash === currentSceneSpecHash
    && Array.isArray(sfx.events) && sfx.events.length > 0) || null;
  if (mediaOptions.generateAudio === false) {
    project.audio = {
      ...(project.audio || {}),
      status: 'skipped',
      reason: 'disabled_by_settings',
      narration_path: null,
      tts_manifest_path: null,
    };
  } else {
    const existingNarrationAudio = resolveExistingNarrationAudio(
      mergeResumeAudioIntoCreativeContext(creativeContext, project, resumeProject, sceneSpec),
      sceneSpec,
    );
    if (existingNarrationAudio.reusable) {
      const audio = existingNarrationAudio.audio;
      project.audio = objectOrEmpty(project.audio);
      project.audio.source = audio.source;
      project.audio.scene_spec_hash = audio.scene_spec_hash;
      project.audio.scene_count = audio.scene_count ?? audio.sceneCount;
      project.audio.scene_ids = Array.isArray(audio.scene_ids) ? audio.scene_ids : [];
      project.audio.status = audio.status || 'ready';
      project.audio.narration_path = existingNarrationAudio.path;
      project.audio.tts_manifest_path = audio.tts_manifest_path || audio.ttsManifestPath || null;
    } else if (services.ttsService && sceneSpec) {
      if (existingNarrationAudio.path) {
        await report(onProgress, {
          type: 'html_video_tts_regenerate_started',
          stage: 'audio',
          sub_stage: 'tts',
          message: '检测到脚本已变化，正在按当前字幕重新生成旁白...',
          data: { reason: existingNarrationAudio.reason },
        });
      }
      const tts = await services.ttsService.synthesizeSceneNarration({
        projectDir,
        sceneSpec,
      });
      if (!tts.success) {
        return failure(tts.message || '旁白音频生成失败。', diagnostics, {
          html_video_project_path: projectDir,
          project_dir: projectDir,
          project,
        });
      }
      applyManifestToProjectAudio(project, sceneSpec, objectOrEmpty(tts.audio_manifest));
    } else if (existingNarrationAudio.path && sceneSpec) {
      return failure('当前音频与字幕脚本不一致，请重新生成旁白后再渲染。', diagnostics, {
        html_video_project_path: projectDir,
        project_dir: projectDir,
        project,
      });
    }
  }
  if (sfxEnabledForRun && reusableSfx) {
    project.audio = objectOrEmpty(project.audio);
    project.audio.sfx = reusableSfx;
    await report(onProgress, {
      type: 'html_video_sfx_planning_reused',
      stage: 'audio',
      sub_stage: 'sfx',
      message: '复用已有自动音效编排。',
      data: { count: reusableSfx.events.length },
    });
  } else if (sfxEnabledForRun) {
    try {
      await report(onProgress, {
        type: 'html_video_sfx_planning_started',
        stage: 'audio',
        sub_stage: 'sfx',
        message: '正在编排自动音效...',
        data: {},
      });
      const library = sfxLibrary.loadSfxLibrary();
      const librarySummary = sfxLibrary.getSfxLibrarySummary({ library });
      if (!librarySummary.length) {
        const emptyLibraryError = new Error('本地音效素材库为空。');
        emptyLibraryError.code = 'sfx_library_missing';
        throw emptyLibraryError;
      }
      const planned = await (services.sfxPlannerAgent || sfxPlannerAgent).planSfxEvents({
        model,
        target: templateRenderTarget,
        rules: sfxEventService.getPlanningRules(project, sceneSpec),
        sfxLibrary: librarySummary,
        scenes: sfxEventService.buildSfxPlanningScenes({ project, sceneSpec }),
      });
      if (!planned || planned.success === false) {
        const plannedError = new Error(planned?.message || '自动音效编排失败，已跳过音效增强。');
        plannedError.code = planned?.code;
        throw plannedError;
      }
      const applied = await sfxEventService.applyPlannedSfxEvents({
        projectDir,
        project,
        sceneSpec,
        library,
        aiEvents: planned.events,
      });
      project = applied.project;
      project.audio.sfx.scene_spec_hash = currentSceneSpecHash;
      if (!applied.events.length) {
        diagnostics.push(createDiagnostic({
          code: 'sfx_no_valid_events',
          stage: 'audio',
          sub_stage: 'sfx',
          user_message: '自动音效编排未产生可用事件，已跳过音效增强。',
          details: {},
          severity: 'warning',
        }));
      }
      if (applied.dropped.length) {
        diagnostics.push(createDiagnostic({
          code: 'sfx_asset_missing',
          stage: 'audio',
          sub_stage: 'sfx',
          user_message: `部分自动音效素材不可用，已丢弃 ${applied.dropped.length} 条。`,
          details: { dropped: applied.dropped },
          severity: 'warning',
        }));
      }
      await report(onProgress, {
        type: 'html_video_sfx_planning_done',
        stage: 'audio',
        sub_stage: 'sfx',
        message: '自动音效编排完成。',
        data: { count: applied.events.length, dropped: applied.dropped.length },
      });
    } catch (error) {
      const diagnosticCode = error?.code === 'ENOENT' ? 'sfx_library_missing' : (error?.code || 'sfx_planning_failed');
      const reason = error?.message || '自动音效编排失败，已跳过音效增强。';
      sfxEventService.markSfxSkipped(project, reason);
      await sfxEventService.persistProjectSfxMirror(projectDir, project).catch(() => {});
      diagnostics.push(createDiagnostic({
        code: diagnosticCode,
        stage: 'audio',
        sub_stage: 'sfx',
        user_message: '自动音效编排失败，已跳过音效增强。',
        details: { reason },
        severity: 'warning',
      }));
      await report(onProgress, {
        type: 'html_video_sfx_planning_skipped',
        stage: 'audio',
        sub_stage: 'sfx',
        message: '自动音效编排失败，已跳过音效增强。',
        data: { code: diagnosticCode, reason },
      });
    }
  }
  project = await projectStore.saveProject(projectDir, project);
  const rendered = await projectOrchestrator.renderHtmlVideoProject({
    rootDir,
    workflowId,
    runId,
    projectDir,
    project,
    templateRegistry: registry,
    services,
    onProgress,
    runLayoutQa: runLayoutQa === true && !skipValidation,
    targetDurationSec: trustedTargetDurationSec,
  });
  rendered.project = await attachAssetUsageReport({
    project: rendered.project || project,
    projectDir,
    creativeContext,
  });
  diagnostics.push(...normalizeDiagnostics(rendered.diagnostics));
  if (!rendered.success) {
    return failure(rendered.message || 'html-video 工程渲染失败。', diagnostics, {
      ...(rendered.code ? { code: rendered.code } : {}),
      html_video_project_path: rendered.html_video_project_path || projectDir,
      project_dir: rendered.project_dir || projectDir,
      project: rendered.project || project,
    });
  }

  let visualReport = { success: true, issues: [], metrics: {} };
  const visualQaService = services.visualQaService || defaultVisualQaService;
  await report(onProgress, {
    type: 'html_video_visual_inspect_started',
    stage: 'project',
    sub_stage: 'visual_inspect',
    message: skipValidation ? '正在执行 html-video 成片轻量安全检查...' : '正在巡检 html-video 成片画面...',
    data: { safety_only: skipValidation === true },
  });
  visualReport = await visualQaService.inspectRenderedVideo({
    projectDir,
    outputPath: rendered.output_path,
    project: rendered.project,
    expectedAspectRatio: templateRenderTarget.aspect_ratio || sceneSpec?.aspect_ratio,
    safetyOnly: skipValidation === true,
  });
  const visualReportPath = visualReport.report_path || visualReport.reportPath || 'inspect/visual-report.json';
  const visualIssues = Array.isArray(visualReport.issues) ? visualReport.issues : [];
  const blockingVisualIssues = visualIssues.filter(isBlockingVisualQaIssue);
  if (!visualReport.success) {
    diagnostics.push(createDiagnostic({
      code: 'visual_qa_warning',
      stage: 'inspect',
      sub_stage: 'visual_inspect',
      user_message: visualReport.message || (blockingVisualIssues.length
        ? 'html-video 成片画面存在开头或镜头边界白屏，未通过视觉安全检查。'
        : 'html-video 视觉质检未通过，仅记录为参考报告。'),
      details: { issues: visualIssues, metrics: visualReport.metrics || {} },
      severity: blockingVisualIssues.length ? 'error' : 'warning',
    }));
  }
  markCheckpointStage(rendered.project, 'visual_inspect', {
    status: visualReport.success ? 'done' : (blockingVisualIssues.length ? 'failed' : 'warning'),
    report_path: visualReportPath,
    diagnostic_code: visualReport.success ? '' : 'visual_qa_warning',
  });
  rendered.project = await projectStore.saveProject(projectDir, rendered.project);
  await report(onProgress, {
    type: 'html_video_visual_inspect_done',
    stage: 'project',
    sub_stage: 'visual_inspect',
    message: visualReport.success ? 'html-video 成片画面巡检完成。' : 'html-video 成片画面巡检发现问题。',
    data: visualReport,
  });
  rendered.project = await attachAssetUsageReport({
    project: rendered.project,
    projectDir,
    creativeContext,
  });
  const missingRequiredAssets = missingRequiredAssetIds(rendered.project);
  if (missingRequiredAssets.length) {
    // asset_first 是用户显式选择"素材必须进画面"，缺引用要阻断并触发帧重试；
    // 其他策略维持 warning，避免历史任务批量翻车
    const assetFirstBlocking = creativeContext?.visual_strategy === 'asset_first';
    diagnostics.push(createDiagnostic({
      code: 'required_visual_asset_missing',
      stage: 'project',
      sub_stage: 'asset_usage',
      severity: assetFirstBlocking ? 'error' : 'warning',
      retryable: true,
      repair_action: 'retry_frame_html',
      user_message: assetFirstBlocking
        ? `有 ${missingRequiredAssets.length} 个必用视觉素材未进入最终画面，已停止导出，可重试重新生成对应镜头。`
        : `有 ${missingRequiredAssets.length} 个必用视觉素材未进入最终画面，已记录为质量警告。`,
      details: {
        missing_required_asset_ids: missingRequiredAssets,
        required_asset_ids: rendered.project.asset_usage_report?.required_asset_ids || [],
      },
    }));
    if (assetFirstBlocking) {
      rendered.project = await projectStore.saveProject(projectDir, rendered.project);
      return failure(`有 ${missingRequiredAssets.length} 个必用视觉素材未进入最终画面，已停止导出。`, diagnostics, {
        code: 'required_visual_asset_missing',
        html_video_project_path: projectDir,
        project_dir: projectDir,
        project: rendered.project,
        output_path: rendered.output_path,
      });
    }
  }
  if (blockingVisualIssues.length) {
    rendered.project = await projectStore.saveProject(projectDir, rendered.project);
    return failure('html-video 成片画面存在开头或镜头边界白屏，未通过视觉安全检查。', diagnostics, {
      code: 'visual_qa_blocking_failure',
      html_video_project_path: projectDir,
      project_dir: projectDir,
      project: rendered.project,
      output_path: rendered.output_path,
      visual_report: visualReport,
    });
  }

  return {
    success: true,
    message: 'html-video 成片完成。',
    render_mode: 'html-video',
    template_id: generationMode === 'per_scene' ? null : template.id,
    template_reason: generationMode === 'per_scene' ? '逐场景模板匹配。' : selection.reason,
    template_inputs: templateInputs,
    project: rendered.project,
    project_dir: projectDir,
    html_video_project_path: projectDir,
    output_path: rendered.output_path,
    files: ['project.json', 'content-graph.json'],
    audio_manifest: rendered.project.audio?.tts_manifest_path || null,
    scene_spec: sceneSpec,
    visual_report: visualReport,
    html_video_diagnostics: diagnostics,
    diagnostics,
  };
}

async function loadProjectForWorkflow({ workflowId, projectDir, rootDir }) {
  if (projectDir) {
    return { projectDir, project: await projectStore.loadProject(projectDir) };
  }
  throw new Error(`缺少 html-video 工程目录，无法加载工作流 ${workflowId || ''}。`);
}

async function parseEditInstruction({ model, project, instruction }) {
  const response = await model.callTextModel({
    messages: [{
      role: 'user',
      content: [
        '你是 html-video 可编辑工程的编辑补丁生成器。',
        '只能返回 JSON，不要返回 Markdown、HTML、CSS 或 JS。',
        'JSON 必须是 edit_patch，type 只能是 template_inputs_patch、frame_inputs_patch、frame_patch、narration_patch、caption_patch、duration_patch、replace_frame_template。',
        '编辑单帧标题、旁白、字幕、时长或 inputs 时，优先返回 type=frame_patch，并带 frame_id；字幕必须写入 frame_patch.captions，不要写 project 顶层 captions。',
        '标题写入 frame_patch.metadata_patch.visual_text.headline；旁白写入 frame_patch.narration_text；时长写入 frame_patch.duration_sec；模板字段仅在确实编辑项目级模板 inputs 时才使用 template_inputs_patch。',
        '当前 project 摘要：',
        JSON.stringify({
          template_id: project.template_id,
          template_inputs: project.template_inputs,
          frames: (project.frames || []).map(frame => ({
            id: frame.id,
            scene_id: frame.scene_id,
            template_id: frame.template_id,
            source_mode: frame.source_mode,
            inputs: frame.inputs,
            visual_text: frame.metadata?.visual_text || {},
            narration_text: frame.narration_text || '',
            captions: frame.captions || [],
            duration_sec: frame.duration_sec,
          })),
        }),
        `用户编辑意图：${instruction}`,
      ].join('\n'),
    }],
  });
  if (!response || response.success === false) {
    return { success: false, message: response?.message || '解析编辑意图失败。' };
  }
  const parsed = parseJsonOnlyResponse(response.text || response.content || '');
  if (!parsed.success) {
    return { success: false, message: parsed.user_message || parsed.message || 'AI 返回的 edit_patch JSON 无效。' };
  }
  return { success: true, edit_patch: parsed.data.edit_patch || parsed.data };
}

async function applyEdit({
  workflowId,
  rootDir,
  projectDir,
  project,
  payload = {},
  services = {},
} = {}) {
  const loaded = project
    ? { projectDir, project }
    : await loadProjectForWorkflow({ workflowId, rootDir, projectDir });
  let editPatch = payload.edit_patch || (payload.type ? payload : null);
  if (!editPatch && payload.instruction) {
    const parsed = await parseEditInstruction({
      model: getModel(services),
      project: loaded.project,
      instruction: payload.instruction,
    });
    if (!parsed.success) {
      return { success: false, code: 'EDIT_PATCH_INVALID', workflow_id: workflowId, message: parsed.message };
    }
    editPatch = parsed.edit_patch;
  }
  if (!editPatch) {
    return {
      success: false,
      code: 'EDIT_PATCH_REQUIRED',
      workflow_id: workflowId,
      message: '自然语言编辑需要先解析为 edit_patch JSON，首版不接受直接写 HTML 或自由文本改工程。',
    };
  }
  const result = editPatchService.applyEditPatch(loaded.project, editPatch);
  if (!result.success) return result;
  let rawHtmlTextPatch = { updated: false, updated_keys: [] };
  if (loaded.projectDir) {
    rawHtmlTextPatch = await syncRawHtmlFrameTextPatch({
      projectDir: loaded.projectDir,
      project: result.project,
      editPatch,
    });
    await projectStore.saveProject(loaded.projectDir, result.project);
  }
  return {
    ...result,
    workflow_id: workflowId,
    html_video_project_path: loaded.projectDir,
    raw_html_text_patch: rawHtmlTextPatch,
  };
}

async function renderOrExport(options = {}) {
  return projectOrchestrator.renderHtmlVideoProject(options);
}

async function rerender(options = {}) {
  return renderOrExport(options);
}

module.exports = {
  generateHtmlVideo,
  generateHtmlVideoProject: generateHtmlVideo,
  generateProject: generateHtmlVideo,
  renderOrExport,
  rerender,
  applyEdit,
  requestTemplateSelection,
  requestTemplateInputs,
  callTextModel,
  generateContentGraphWithRetry,
  buildInitialProject,
  resolveGenerationMode,
  buildAssetUsageReport,
  shouldReuseFrameHtml,
  resumeArtifactsMatch,
  resolveRenderTarget,
  resolveTemplateRenderTarget,
  buildTemplateIndexOptions,
  reorderCompactIndex,
  expandContentGraphToVisualBeats,
  expandContentGraphToSceneEntries,
  bindGeneratedAssetsToSceneSpec,
};
