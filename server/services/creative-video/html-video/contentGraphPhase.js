const fs = require('fs');
const crypto = require('crypto');

const contentGraphAgent = require('./contentGraphAgent');
const { isProviderMissingText, groupBeatsForSceneHtml } = require('./frameHtmlPhase');
const projectStore = require('./projectStore');
const { createDiagnostic, normalizeDiagnostics } = require('./diagnostics');
const { mapSceneSpecToContentGraph } = require('./sceneSpecMapper');
const { resolveNodeSceneId, validateGraphMatchesSceneSpec } = require('./sceneGraphBinding');
const { topoSort } = require('./contentGraph');
const { AGENTS, STAGES } = require('../agentStages');
const { objectOrEmpty, firstNonEmptyString } = require('./assetUsagePhase');

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function report(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  try {
    await onProgress(event);
  } catch (_) {
    // 进度回调不能影响主生成流程。
  }
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

function hasUsableContentGraph(graph = {}) {
  return Array.isArray(graph.nodes) && graph.nodes.length > 0;
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

module.exports = {
  sha256,
  report,
  callTextModel,
  hasUsableContentGraph,
  contentGraphMatchesSceneSpec,
  loadCheckpointContentGraph,
  CONTENT_GRAPH_SCENE_SPEC_MISMATCH_MESSAGE,
  contentGraphSceneSpecMismatchDiagnostic,
  generateContentGraphWithRetry,
  expandContentGraphToVisualBeats,
  expandContentGraphToSceneEntries,
};
