const { normalizeProject } = require('./projectSchema');
const { topoSort, getNode, DEFAULT_FRAME_DURATION_SEC } = require('./contentGraph');
const { resolveNodeSceneId } = require('./sceneGraphBinding');
const { sliceCaptionsToWindow } = require('./captionLayer');
const projectStore = require('./projectStore');
const {
  defaultFrameFields,
  normalizeCaptions,
  trustedSceneDuration,
  resolveOutput,
} = require('./rawHtmlFrameBuilder');
const { mapSceneToTemplateInputs } = require('./templateInputMappers');
const { validateTemplateInputs } = require('./templateInputAgent');

const MISSING_BEAT_DECISION_REASON = 'beat 决策缺失，已用场景 HTML 兜底。';

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function sceneById(sceneSpec = {}) {
  return new Map((Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : []).map(scene => [scene.id, scene]));
}

function getDecision(decisions, key) {
  if (!decisions) return null;
  if (decisions instanceof Map) return decisions.get(key) || null;
  return decisions[key] || null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function stripBeatSourceScene(beat = {}) {
  const { source_scene: _sourceScene, ...rest } = beat;
  return clone(rest);
}

// 按路由决策把基础帧字段落成 template_inputs 帧或 raw_html 帧；
// 决策缺失时按 raw_html 兜底（决策 Map 可能跳过损坏 beat，消费侧必须判空）。
function resolveFrameByDecision({
  base,
  decision,
  missingDecision = false,
  scene,
  node,
  nodeId,
  registry,
  projectDir,
}) {
  if (decision.source_mode === 'template_inputs' && decision.template_id) {
    const template = registry.getTemplate(decision.template_id);
    if (!template) throw new Error(`未找到逐场景模板：${decision.template_id}。`);
    const inputs = decision.inputs || mapSceneToTemplateInputs(template.id, scene, template.inputs?.schema || {});
    const validation = validateTemplateInputs(inputs, template);
    if (!validation.success) throw new Error(validation.user_message || '模板字段校验失败。');
    return {
      ...base,
      template_id: template.id,
      source_mode: 'template_inputs',
      html_path: null,
      inputs,
    };
  }
  const htmlPath = String(node.html_path || '').trim();
  if (!htmlPath) throw new Error(`缺少帧 ${nodeId} 的 raw HTML 路径。`);
  projectStore.resolveProjectPath(projectDir, htmlPath);
  return {
    ...base,
    template_id: null,
    source_mode: 'raw_html',
    html_path: htmlPath,
    inputs: {},
    fallback_source_mode: decision.fallback_source_mode || 'raw_html',
    fallback_reason: decision.fallback_reason || decision.reason || (missingDecision ? MISSING_BEAT_DECISION_REASON : ''),
  };
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
  visualPlan = null,
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

  const visualBeats = Array.isArray(visualPlan?.beats) && visualPlan.beats.length ? visualPlan.beats : null;

  if (visualBeats) {
    // 有视觉计划：帧按 beat 展开（帧数可能多于内容图节点数），
    // raw_html beat 优先消费 beat 级 graph node，避免长场景拆分后重复同一份 HTML。
    const nodeIdByScene = new Map();
    const nodeIdByBeat = new Map();
    for (const nodeId of orderedNodeIds) {
      const node = getNode(graph, nodeId) || {};
      const nodeBeatId = String(node.beat_id || node.beatId || '').trim();
      if (nodeBeatId && !nodeIdByBeat.has(nodeBeatId)) nodeIdByBeat.set(nodeBeatId, nodeId);
      const nodeSceneId = resolveNodeSceneId(node);
      if (nodeSceneId && !nodeIdByScene.has(nodeSceneId)) nodeIdByScene.set(nodeSceneId, nodeId);
    }
    const sceneDurations = new Map();
    for (const beat of visualBeats) {
      if (!beat || !beat.id) continue;
      const sceneId = String(beat.scene_id || '').trim();
      sceneDurations.set(sceneId, (sceneDurations.get(sceneId) || 0) + (positiveNumber(beat.duration_sec) || 0));
    }
    // 场景级字幕时间轴（以该场景 beat 时长之和展开），供各 beat 按窗口切片
    const sceneCaptionTracks = new Map();
    for (const beat of visualBeats) {
      // 损坏的 beat（缺 id）无法建帧，跳过（与路由层的 id 守卫一致）
      if (!beat || !beat.id) continue;
      const sceneId = String(beat.scene_id || '').trim();
      const scene = scenes.get(sceneId);
      if (!scene) throw new Error(`视觉 beat ${beat.id} 未匹配到 scene_spec 场景 ${sceneId || '未指定'}。`);
      const nodeId = nodeIdByBeat.get(beat.id) || nodeIdByScene.get(sceneId);
      const node = nodeId ? (getNode(graph, nodeId) || {}) : null;
      if (!nodeId || !node) throw new Error(`视觉 beat ${beat.id} 未匹配到场景 ${sceneId} 的内容图节点。`);
      const durationSec = positiveNumber(beat.duration_sec) || DEFAULT_FRAME_DURATION_SEC;
      let track = sceneCaptionTracks.get(sceneId);
      if (!track) {
        const sceneDurationSec = sceneDurations.get(sceneId)
          || trustedSceneDuration(scene, node)
          || DEFAULT_FRAME_DURATION_SEC;
        track = {
          captions: includeCaptions ? normalizeCaptions(scene, sceneDurationSec) : [],
          offsetSec: 0,
        };
        sceneCaptionTracks.set(sceneId, track);
      }
      // 字幕切窗：整场景字幕切到 beat 窗口并平移为 beat 局部时间，避免整段字幕在每个 beat 重复
      const captions = includeCaptions
        ? sliceCaptionsToWindow(track.captions, track.offsetSec, durationSec)
        : [];
      track.offsetSec += durationSec;
      const base = {
        id: beat.id,
        scene_id: sceneId,
        beat_id: beat.id,
        graph_node_id: nodeId,
        order: frames.length + 1,
        engine: 'hyperframes-playwright',
        preview_mp4_path: null,
        duration_sec: durationSec,
        narration_text: scene.narration_text || '',
        captions,
        generate_captions: includeCaptions,
        metadata: {
          frame_intent: node.kind || scene.kind || 'text',
          visual_text: clone(beat.visual_text || scene.visual_text),
          graph_node: clone({ ...node, durationSec }),
          visual_beat: stripBeatSourceScene(beat),
          scene_snapshot: {
            id: scene.id,
            order: scene.order,
            narration_text: scene.narration_text || '',
            captions: clone(scene.captions),
          },
        },
        ...defaultFrameFields(),
      };
      const decision = getDecision(decisions, beat.id);
      const frame = resolveFrameByDecision({
        base,
        decision: decision || {},
        missingDecision: !decision,
        scene,
        node,
        nodeId,
        registry,
        projectDir,
      });
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
  } else {
    // 无视觉计划：保持既有 node 循环（帧与场景 1:1），决策按 scene.id 查
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

      const frame = resolveFrameByDecision({
        base,
        decision,
        scene,
        node,
        nodeId,
        registry,
        projectDir,
      });

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
