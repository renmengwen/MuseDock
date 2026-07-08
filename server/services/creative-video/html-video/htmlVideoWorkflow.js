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
const { runFrameHtmlPhase, isProviderMissingText } = require('./frameHtmlPhase');
const { buildRawHtmlFrameProject } = require('./rawHtmlFrameBuilder');
const { buildMixedFrameProject } = require('./mixedFrameBuilder');
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

function resumeArtifactsMatch(project = {}, sceneSpec = null, template = {}) {
  const currentHash = computeSceneSpecCheckpointHash(sceneSpec || {});
  const checkpointHash = String(project.generation_checkpoint?.scene_spec_hash || '').trim();
  if (!checkpointHash || !currentHash || checkpointHash !== currentHash) return false;
  const projectTemplateId = String(project.template_id || '').trim();
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
  markCheckpointFrame(project, 'render', sceneId, {
    status: 'pending',
    mp4_path: '',
    output_hash: '',
    diagnostic_code: '',
  });
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

function contentGraphMatchesSceneSpec(graph = {}, sceneSpec = null) {
  if (!sceneSpec) return true;
  return validateGraphMatchesSceneSpec(graph, sceneSpec).ok;
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

function resolveResumeContentGraph(projectDir, project = {}, sceneSpec = null, template = {}) {
  if (!project) return null;
  if (!resumeArtifactsMatch(project, sceneSpec, template)) return null;
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
  })).filter(asset => asset.path);
}

function normalizeAssetToken(value = '') {
  return String(value || '').replace(/\\/g, '/').trim();
}

function assetReferenceTokens(asset = {}) {
  const assetPath = normalizeAssetToken(asset.path);
  return [...new Set([
    normalizeAssetToken(asset.frame_src),
    assetPath,
    assetPath ? `../${assetPath}` : '',
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
  for (const rawToken of tokens) {
    const token = normalizeHtmlAssetReference(rawToken);
    if (!token) continue;
    for (const ref of referenceSet) {
      if (ref === token || ref.endsWith(`/${token.replace(/^\.\.\//, '')}`)) return true;
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

function buildAssetUsageReport({ project = {}, projectDir = '', creativeContext = {} } = {}) {
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  if (!assets.length) {
    return {
      status: 'empty',
      assets: [],
      used_asset_ids: [],
      unused_asset_ids: [],
      summary: '没有可追踪的来源图片。',
    };
  }
  const frames = Array.isArray(project.frames) ? project.frames : [];
  const frameHtmlEntries = frames.map(frame => ({
    id: firstNonEmptyString(frame.scene_id, frame.id),
    references: extractHtmlAssetReferences(readFrameHtml(projectDir, frame)),
  }));
  const reportAssets = assets.map((asset, index) => {
    const assetId = firstNonEmptyString(asset.id, `asset_${index + 1}`);
    const tokens = assetReferenceTokens(asset);
    const usedInFrames = frameHtmlEntries
      .filter(frame => frame.id && htmlReferencesAsset(frame.references, tokens))
      .map(frame => frame.id);
    return {
      asset_id: assetId,
      path: asset.path || '',
      frame_src: asset.frame_src || '',
      used: usedInFrames.length > 0,
      used_in_frames: usedInFrames,
      usage_count: usedInFrames.length,
    };
  });
  const usedAssetIds = reportAssets.filter(asset => asset.used).map(asset => asset.asset_id);
  const unusedAssetIds = reportAssets.filter(asset => !asset.used).map(asset => asset.asset_id);
  return {
    status: 'ready',
    assets: reportAssets,
    used_asset_ids: usedAssetIds,
    unused_asset_ids: unusedAssetIds,
    summary: usedAssetIds.length
      ? `最终 HTML 使用了 ${usedAssetIds.length} 张来源图片。`
      : '最终 HTML 未引用已准备的来源图片。',
  };
}

async function attachAssetUsageReport({ project = {}, projectDir = '', creativeContext = {} } = {}) {
  const assetUsageReport = buildAssetUsageReport({ project, projectDir, creativeContext });
  project.asset_usage_report = assetUsageReport;
  if (creativeContext.asset_context) creativeContext.asset_context.asset_usage_report = assetUsageReport;
  return projectDir ? projectStore.saveProject(projectDir, project) : project;
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
    creativeContext = {},
    target = {},
    templateRegistry,
    services = {},
    skipValidation = false,
    runLayoutQa = false,
    onProgress = null,
    preferredTemplateId = '',
    projectOptions = {},
  } = options;
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
  if (hasSceneSpecScenes(sceneSpec)) {
    await projectStore.saveSceneSpec(projectDir, sceneSpec);
  }

  let selection = { success: true, template_id: null, reason: '' };
  let template = null;
  let perSceneDecisions = null;
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
    perSceneDecisions = matchScenesToTemplates({
      scenes: sceneSpec.scenes,
      registry,
      renderTarget,
    });
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
  await materializeCreativeContextAssets(projectDir, creativeContext);
  if (generationMode === 'raw_html' && !hasSceneSpecScenes(sceneSpec)) {
    return failure('缺少 scene_spec，无法生成 raw_html 帧。', [
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
    const resumeAllowed = resumeArtifactsMatch(resumeProject || {}, sceneSpec, template);
    let contentGraph = resolveResumeContentGraph(projectDir, resumeProject, sceneSpec, template);
    const reusedContentGraph = Boolean(contentGraph);
    if (contentGraph) {
      project = await projectStore.writeProjectJson(projectDir, current => {
        current.template_id = generationMode === 'per_scene' ? null : (template.id || current.template_id);
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
        return failure(graphResult.message || 'content graph 生成失败。', graphDiagnostics, {
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
      templateRoutingDecisions: perSceneDecisions,
    });
    if (!frameHtmlResult.ok) return frameHtmlResult.failure;
    project = frameHtmlResult.project;
    contentGraph = frameHtmlResult.contentGraph;
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
          decisions: perSceneDecisions,
          mediaOptions,
          generationCheckpoint: project?.generation_checkpoint,
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
  if (!skipValidation) {
    const visualQaService = services.visualQaService || defaultVisualQaService;
    await report(onProgress, {
      type: 'html_video_visual_inspect_started',
      stage: 'project',
      sub_stage: 'visual_inspect',
      message: '正在巡检 html-video 成片画面...',
      data: {},
    });
    visualReport = await visualQaService.inspectRenderedVideo({
      projectDir,
      outputPath: rendered.output_path,
      expectedAspectRatio: templateRenderTarget.aspect_ratio || sceneSpec?.aspect_ratio,
    });
    const visualReportPath = visualReport.report_path || visualReport.reportPath || 'inspect/visual-report.json';
    if (!visualReport.success) {
      diagnostics.push(createDiagnostic({
        code: 'visual_qa_warning',
        stage: 'inspect',
        sub_stage: 'visual_inspect',
        user_message: visualReport.message || 'html-video 视觉质检未通过，仅记录为参考报告。',
        details: { issues: visualReport.issues || [], metrics: visualReport.metrics || {} },
        severity: 'warning',
      }));
    }
    markCheckpointStage(rendered.project, 'visual_inspect', {
      status: visualReport.success ? 'done' : 'warning',
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
  }
  rendered.project = await attachAssetUsageReport({
    project: rendered.project,
    projectDir,
    creativeContext,
  });

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
  resolveRenderTarget,
  resolveTemplateRenderTarget,
  buildTemplateIndexOptions,
  reorderCompactIndex,
};
