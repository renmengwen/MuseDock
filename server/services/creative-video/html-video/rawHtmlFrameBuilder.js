const fs = require('fs/promises');
const path = require('path');

const { normalizeProject } = require('./projectSchema');
const { topoSort, getNode, DEFAULT_FRAME_DURATION_SEC } = require('./contentGraph');
const { ensureCaptionLayer, normalizeCaptionsForFrame } = require('./captionLayer');

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
  return ensureCaptionLayer(html, captions);
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
} = {}) {
  if (!projectDir) throw new Error('缺少 projectDir。');
  const htmlMap = frameHtmlByNodeId instanceof Map
    ? frameHtmlByNodeId
    : new Map(Object.entries(objectOrEmpty(frameHtmlByNodeId)));
  const orderedNodeIds = topoSort(graph);
  const scenes = sceneById(sceneSpec);
  const frames = [];
  const items = [];
  let cursor = 0;

  for (let index = 0; index < orderedNodeIds.length; index += 1) {
    const nodeId = orderedNodeIds[index];
    const node = getNode(graph, nodeId) || {};
    const html = htmlMap.get(nodeId);
    if (!html) throw new Error(`缺少帧 ${nodeId} 的 raw HTML。`);
    const safeId = safeFilePart(nodeId, `scene_${String(index + 1).padStart(2, '0')}`);
    const htmlPath = `frames/${String(index + 1).padStart(2, '0')}-${safeId}.html`;
    const outputPath = resolveProjectPath(projectDir, htmlPath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const scene = scenes.get(nodeId) || {};
    const durationSec = Number(node.durationSec || scene.duration || scene.target_duration_sec || DEFAULT_FRAME_DURATION_SEC);
    const normalizedDurationSec = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : DEFAULT_FRAME_DURATION_SEC;
    const captions = normalizeCaptions(scene, normalizedDurationSec);
    const frame = {
      id: nodeId,
      scene_id: nodeId,
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
      metadata: {
        frame_intent: node.kind || scene.kind || 'text',
        visual_text: clone(scene.visual_text),
        graph_node: clone(node),
      },
      ...defaultFrameFields(),
    };
    await fs.writeFile(outputPath, ensureCaptionLayer(html, captions), 'utf8');
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
    template_id: template.id || null,
    template_inputs: {},
    output: {
      ...resolveOutput(target, template),
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
  });
}

module.exports = {
  buildRawHtmlFrameProject,
  injectCaptionOverlay,
  normalizeCaptions,
};
