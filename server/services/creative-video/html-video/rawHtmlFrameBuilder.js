const fs = require('fs/promises');
const path = require('path');

const { normalizeProject } = require('./projectSchema');
const { topoSort, getNode, DEFAULT_FRAME_DURATION_SEC } = require('./contentGraph');
const { applyCaptionLayer, normalizeCaptionsForFrame } = require('./captionLayer');
const { resolveNodeSceneId } = require('./sceneGraphBinding');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function safeFilePart(value, fallback) {
  const text = String(value || fallback || 'frame')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return text || fallback || 'frame';
}

function resolveProjectPath(projectDir, relativePath) {
  const target = path.resolve(projectDir, relativePath);
  const relative = path.relative(projectDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('raw_html frame 路径不能逃逸工程目录。');
  }
  return target;
}

function resolveOutput(target = {}, template = {}) {
  const templateOutput = objectOrEmpty(template.output);
  const resolution = objectOrEmpty(target.resolution || templateOutput.resolution);
  const width = Number(target.width || resolution.width || 1920);
  const height = Number(target.height || resolution.height || 1080);
  const fps = Number(target.fps || templateOutput.fps || 30);
  return {
    resolution: {
      width: Number.isFinite(width) && width > 0 ? width : 1920,
      height: Number.isFinite(height) && height > 0 ? height : 1080,
    },
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
  };
}

function sceneById(sceneSpec = {}) {
  return new Map((Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : []).map(scene => [scene.id, scene]));
}

function defaultFrameFields() {
  return {
    transition_in: { type: 'cut', duration_sec: 0, params: {} },
    transition_out: { type: 'cut', duration_sec: 0, params: {} },
    trim: { in_sec: 0, out_sec: null },
    speed: 1,
    loop: false,
    enhancement: {
      enabled: false,
      engine: null,
      template_id: null,
      data: null,
      preview_mp4_path: null,
    },
  };
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function trustedSceneDuration(scene = {}, node = {}) {
  return firstPositiveNumber(
    scene.speech_duration_sec,
    scene.speechDurationSec,
    scene.duration,
    scene.duration_sec,
    scene.durationSec,
    scene.actual_duration_sec,
    scene.actualDurationSec,
    scene.target_duration_sec,
    scene.targetDurationSec,
    node.durationSec,
    node.duration_sec,
    node.duration,
    DEFAULT_FRAME_DURATION_SEC,
  );
}

function normalizeCaptions(scene = {}, durationSec = DEFAULT_FRAME_DURATION_SEC) {
  return normalizeCaptionsForFrame({
    id: scene.id,
    scene_id: scene.scene_id,
    duration_sec: durationSec,
    narration_text: scene.narration_text,
    captions: scene.captions,
  });
}

function injectCaptionOverlay(html, captions = []) {
  return applyCaptionLayer(html, captions);
}

async function buildRawHtmlFrameProject({
  projectDir,
  workflowId,
  runId,
  graph,
  frameHtmlByNodeId,
  sceneSpec = {},
  target = {},
  template = {},
  mediaOptions = {},
} = {}) {
  if (!projectDir) throw new Error('缺少 projectDir。');
  const htmlMap = frameHtmlByNodeId instanceof Map
    ? frameHtmlByNodeId
    : new Map(Object.entries(objectOrEmpty(frameHtmlByNodeId)));
  const orderedNodeIds = topoSort(graph);
  const scenes = sceneById(sceneSpec);
  const frames = [];
  const items = [];
  const trustedDurations = new Map();
  let cursor = 0;
  const includeCaptions = mediaOptions.generateCaptions !== false;

  for (let index = 0; index < orderedNodeIds.length; index += 1) {
    const nodeId = orderedNodeIds[index];
    const node = getNode(graph, nodeId) || {};
    const html = htmlMap.get(nodeId);
    if (!html) throw new Error(`缺少帧 ${nodeId} 的 raw HTML。`);
    const safeId = safeFilePart(nodeId, `scene_${String(index + 1).padStart(2, '0')}`);
    const htmlPath = `frames/${String(index + 1).padStart(2, '0')}-${safeId}.html`;
    const outputPath = resolveProjectPath(projectDir, htmlPath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const sceneId = resolveNodeSceneId(node);
    const scene = scenes.get(sceneId);
    if (!scene) {
      throw new Error(`内容图节点 ${nodeId} 未匹配到 scene_spec 场景 ${sceneId || '未指定'}。`);
    }
    const durationSec = trustedSceneDuration(scene, node);
    const normalizedDurationSec = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : DEFAULT_FRAME_DURATION_SEC;
    trustedDurations.set(nodeId, normalizedDurationSec);
    const trustedNode = { ...node, durationSec: normalizedDurationSec };
    if (trustedNode.duration_sec != null) trustedNode.duration_sec = normalizedDurationSec;
    if (trustedNode.duration != null) trustedNode.duration = normalizedDurationSec;
    const captions = includeCaptions ? normalizeCaptions(scene, normalizedDurationSec) : [];
    const frame = {
      id: scene.id,
      scene_id: scene.id,
      graph_node_id: nodeId,
      order: index + 1,
      template_id: template.id || null,
      engine: 'hyperframes-playwright',
      source_mode: 'raw_html',
      html_path: htmlPath,
      preview_mp4_path: null,
      duration_sec: normalizedDurationSec,
      inputs: {},
      narration_text: scene.narration_text || '',
      captions,
      generate_captions: includeCaptions,
      metadata: {
        frame_intent: node.kind || scene.kind || 'text',
        visual_text: clone(scene.visual_text),
        graph_node: clone(trustedNode),
        scene_snapshot: {
          id: scene.id,
          order: scene.order,
          narration_text: scene.narration_text || '',
          captions: clone(scene.captions),
        },
      },
      ...defaultFrameFields(),
    };
    const htmlWithCaptions = includeCaptions
      ? applyCaptionLayer(html, frame.captions, { durationSec: frame.duration_sec, generateCaptions: true })
      : html;
    await fs.writeFile(outputPath, htmlWithCaptions, 'utf8');
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

  const trustedGraph = clone(graph);
  if (Array.isArray(trustedGraph.nodes)) {
    trustedGraph.nodes = trustedGraph.nodes.map(node => {
      if (!node || !trustedDurations.has(node.id)) return node;
      const durationSec = trustedDurations.get(node.id);
      const next = { ...node, durationSec };
      if (next.duration_sec != null) next.duration_sec = durationSec;
      if (next.duration != null) next.duration = durationSec;
      return next;
    });
  }

  const project = normalizeProject({
    project_id: `${workflowId || 'workflow'}_${runId || 'run'}`,
    workflow_id: workflowId || null,
    run_id: runId || null,
    template_id: template.id || null,
    template_inputs: {},
    output: {
      ...resolveOutput(target, template),
      duration: cursor,
    },
    template_schema: {},
    content_graph: trustedGraph,
    frames,
    timeline: {
      tracks: [
        { id: 'main', type: 'video', items },
        { id: 'voice', type: 'audio', items: [] },
        { id: 'music', type: 'audio', items: [] },
      ],
    },
  });
  for (const frame of project.frames) {
    if (frame.generate_captions === false) frame.captions = [];
  }
  return project;
}

module.exports = {
  buildRawHtmlFrameProject,
  injectCaptionOverlay,
  normalizeCaptions,
};
