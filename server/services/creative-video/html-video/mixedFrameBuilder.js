const { normalizeProject } = require('./projectSchema');
const { topoSort, getNode, DEFAULT_FRAME_DURATION_SEC } = require('./contentGraph');
const { resolveNodeSceneId } = require('./sceneGraphBinding');
const projectStore = require('./projectStore');
const {
  defaultFrameFields,
  normalizeCaptions,
  trustedSceneDuration,
  resolveOutput,
} = require('./rawHtmlFrameBuilder');
const { mapSceneToTemplateInputs } = require('./templateInputMappers');
const { validateTemplateInputs } = require('./templateInputAgent');

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function sceneById(sceneSpec = {}) {
  return new Map((Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : []).map(scene => [scene.id, scene]));
}

function getDecision(decisions, sceneId) {
  if (!decisions) return null;
  if (decisions instanceof Map) return decisions.get(sceneId) || null;
  return decisions[sceneId] || null;
}

async function buildMixedFrameProject({
  projectDir,
  workflowId,
  runId,
  graph,
  sceneSpec = {},
  target = {},
  registry,
  decisions,
  mediaOptions = {},
  generationCheckpoint = null,
} = {}) {
  if (!projectDir) throw new Error('缺少 projectDir。');
  const orderedNodeIds = topoSort(graph);
  const scenes = sceneById(sceneSpec);
  const frames = [];
  const items = [];
  const includeCaptions = mediaOptions.generateCaptions !== false;
  let cursor = 0;

  for (let index = 0; index < orderedNodeIds.length; index += 1) {
    const nodeId = orderedNodeIds[index];
    const node = getNode(graph, nodeId) || {};
    const sceneId = resolveNodeSceneId(node);
    const scene = scenes.get(sceneId);
    if (!scene) throw new Error(`内容图节点 ${nodeId} 未匹配到 scene_spec 场景 ${sceneId || '未指定'}。`);
    const durationSec = trustedSceneDuration(scene, node) || DEFAULT_FRAME_DURATION_SEC;
    const captions = includeCaptions ? normalizeCaptions(scene, durationSec) : [];
    const decision = getDecision(decisions, scene.id) || {};
    const base = {
      id: scene.id,
      scene_id: scene.id,
      graph_node_id: nodeId,
      order: index + 1,
      engine: 'hyperframes-playwright',
      preview_mp4_path: null,
      duration_sec: durationSec,
      narration_text: scene.narration_text || '',
      captions,
      generate_captions: includeCaptions,
      metadata: {
        frame_intent: node.kind || scene.kind || 'text',
        visual_text: clone(scene.visual_text),
        graph_node: clone({ ...node, durationSec }),
        scene_snapshot: {
          id: scene.id,
          order: scene.order,
          narration_text: scene.narration_text || '',
          captions: clone(scene.captions),
        },
      },
      ...defaultFrameFields(),
    };

    let frame;
    if (decision.source_mode === 'template_inputs' && decision.template_id) {
      const template = registry.getTemplate(decision.template_id);
      if (!template) throw new Error(`未找到逐场景模板：${decision.template_id}。`);
      const inputs = decision.inputs || mapSceneToTemplateInputs(template.id, scene, template.inputs?.schema || {});
      const validation = validateTemplateInputs(inputs, template);
      if (!validation.success) throw new Error(validation.user_message || '模板字段校验失败。');
      frame = {
        ...base,
        template_id: template.id,
        source_mode: 'template_inputs',
        html_path: null,
        inputs,
      };
    } else {
      const htmlPath = String(node.html_path || '').trim();
      if (!htmlPath) throw new Error(`缺少帧 ${nodeId} 的 raw HTML 路径。`);
      projectStore.resolveProjectPath(projectDir, htmlPath);
      frame = {
        ...base,
        template_id: null,
        source_mode: 'raw_html',
        html_path: htmlPath,
        inputs: {},
        fallback_source_mode: decision.fallback_source_mode || 'raw_html',
        fallback_reason: decision.fallback_reason || decision.reason || '',
      };
    }

    frames.push(frame);
    items.push({
      id: `item_${frame.id}`,
      kind: 'frame',
      frame_id: frame.id,
      start_sec: cursor,
      duration_sec: frame.duration_sec,
    });
    cursor += frame.duration_sec;
  }

  return normalizeProject({
    project_id: `${workflowId || 'workflow'}_${runId || 'run'}`,
    workflow_id: workflowId || null,
    run_id: runId || null,
    template_id: null,
    template_inputs: {},
    output: {
      ...resolveOutput(target, {}),
      duration: cursor,
    },
    template_schema: {},
    content_graph: graph,
    frames,
    timeline: {
      tracks: [
        { id: 'main', type: 'video', items },
        { id: 'voice', type: 'audio', items: [] },
        { id: 'music', type: 'audio', items: [] },
      ],
    },
    generation_checkpoint: generationCheckpoint,
  });
}

module.exports = { buildMixedFrameProject };
