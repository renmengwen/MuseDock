const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const creativeWorkflows = require('../server/services/creative/creativeWorkflows');
const aiImageModel = require('../server/services/ai/aiImageModel');

// 测试隔离：生图 phase 的前置检查默认读全局模型配置，本机若配置了 image 模型会让生图链路
// 混入这些集成测试（多一次 planner 的 text 调用，打乱 mock 计数）。统一按未配置处理。
aiImageModel.isConfigured = async () => false;

const frameHtmlAgent = require('../server/services/creative-video/html-video/frameHtmlAgent');
const frameHtmlPhase = require('../server/services/creative-video/html-video/frameHtmlPhase');
const { resolveAssetFirstMotionArgs } = require('../server/services/creative-video/html-video/motionOverlayPhase');
const contentGraphPhase = require('../server/services/creative-video/html-video/contentGraphPhase');
const { materializeCreativeContextAssets } = require('../server/services/creative-video/html-video/assetUsagePhase');
const { mergeVisualAssets } = require('../server/services/creative/visualAssetContract');
const { materializeSceneImageSequenceDom } = require('../server/services/creative-video/html-video/sceneImageSequenceDom');
const visualPlanService = require('../server/services/creative-video/html-video/visualPlanService');
const { planFocusCues } = require('../server/services/creative-video/html-video/focusCuePlanner');
const { matchVisualBeatsToRenderers } = require('../server/services/creative-video/html-video/visualRouteMatcher');
const frameFallbackBuilder = require('../server/services/creative-video/html-video/frameFallbackBuilder');
const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { createEmptyProject, markCheckpointStage, markCheckpointFrame } = require('../server/services/creative-video/html-video/projectSchema');
const { computeSceneSpecSpeechHash } = require('../server/services/creative-video/sceneSpecHash');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

function validHtml(id, text = id) {
  return [
    '<!doctype html><html><head>',
    '<meta name="viewport" content="width=1080,height=1920,initial-scale=1.0">',
    '<style>html,body{margin:0;width:1080px;height:1920px}@keyframes enter{from{opacity:0}to{opacity:1}}main{animation:enter .4s both}</style>',
    '</head><body>',
    `<main data-frame-id="${id}"><h1 data-text-key="headline">${text}</h1><p data-text-key="subtitle">副标题</p><section data-text-key="body">正文</section></main>`,
    '</body></html>',
  ].join('');
}

function sceneSpec() {
  return {
    title: '帧 HTML 恢复',
    aspect_ratio: '9:16',
    scenes: [
      { id: 'scene_01', duration: 2, narration_text: '第一幕旁白', captions: [{ text: '第一幕旁白' }], visual_text: { headline: '第一幕' } },
      { id: 'scene_02', duration: 2, narration_text: '第二幕旁白', captions: [{ text: '第二幕旁白' }], visual_text: { headline: '第二幕' } },
      { id: 'scene_03', duration: 2, narration_text: '第三幕旁白', captions: [{ text: '第三幕旁白' }], visual_text: { headline: '第三幕' } },
    ],
  };
}

function changedSceneSpec() {
  const spec = sceneSpec();
  return {
    ...spec,
    scenes: spec.scenes.map(scene => (
      scene.id === 'scene_02'
        ? { ...scene, narration_text: '第二幕旁白已修改', captions: [{ text: '第二幕旁白已修改' }] }
        : scene
    )),
  };
}

function changedVisualSceneSpec() {
  const spec = sceneSpec();
  return {
    ...spec,
    scenes: spec.scenes.map(scene => (
      scene.id === 'scene_02'
        ? { ...scene, visual_text: { ...scene.visual_text, headline: '第二幕视觉标题已修改' } }
        : scene
    )),
  };
}

function changedCaptionSceneSpec() {
  const spec = sceneSpec();
  return {
    ...spec,
    scenes: spec.scenes.map(scene => (
      scene.id === 'scene_02'
        ? { ...scene, captions: [{ id: 'scene_02_caption_changed', start: 0, end: 2, text: '第二幕字幕已修改' }] }
        : scene
    )),
  };
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

function computeSceneSpecCheckpointHash(spec = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(stableSceneSpecValue(spec || {}))).digest('hex');
}

function contentGraph(label = '三帧恢复') {
  return {
    synopsis: label,
    nodes: [
      { id: 'scene_01', kind: 'text', text: '第一幕' },
      { id: 'scene_02', kind: 'text', text: '第二幕' },
      { id: 'scene_03', kind: 'text', text: '第三幕' },
    ],
    edges: [
      { from: 'scene_01', to: 'scene_02', kind: 'sequence' },
      { from: 'scene_02', to: 'scene_03', kind: 'sequence' },
    ],
  };
}

function staleContentGraph() {
  return {
    synopsis: '旧内容图',
    nodes: [
      { id: 'old_scene_01', kind: 'text', text: '旧第一幕' },
    ],
    edges: [],
  };
}

function invalidCheckpointHtml() {
  return '<!doctype html><html><head></head><body>bad</body></html>';
}

function spacedAnchorHtml(id = 'scene_01') {
  return [
    '<!doctype html><html><head>',
    '<meta name="viewport" content="width=1080,height=1920,initial-scale=1.0">',
    '<style>html,body{margin:0;width:1080px;height:1920px}</style>',
    '</head><body>',
    `<main data-frame-id="${id}"><h1 data-text-key = 'headline'>标题</h1><p data-text-key = "subtitle">副标题</p><section data-text-key = 'body'>正文</section></main>`,
    '</body></html>',
  ].join('');
}

function commentOnlyAnchorHtml() {
  return [
    '<!doctype html><html><head>',
    '<!-- data-text-key="headline" data-text-key="subtitle" data-text-key="body" -->',
    '<script>const fake = \'data-text-key="headline"\';</script>',
    '<style>.fake:after{content:"data-text-key=\\"body\\""}</style>',
    '</head><body><main>bad</main></body></html>',
  ].join('');
}

async function setupProject(rootDir, workflowId, runId, options = {}) {
  const projectDir = await projectStore.createProjectDir({ rootDir, workflowId, runId });
  const scene01Html = options.scene01Html || (options.badScene01Html ? invalidCheckpointHtml() : validHtml('scene_01', '已完成一'));
  await writeFile(path.join(projectDir, 'frames/01-scene_01.html'), scene01Html);
  await writeFile(path.join(projectDir, 'frames/02-scene_02.html'), validHtml('scene_02', '已完成二'));
  if (Array.isArray(options.projectAssets)) {
    for (const asset of options.projectAssets) {
      if (asset.path) await writeFile(path.join(projectDir, asset.path), 'asset');
    }
  }
  const graph = options.contentGraph || contentGraph();
  const rawGraphCreativeContext = options.assetContext || { input: { raw_text: '三帧恢复测试' } };
  const graphCreativeContext = await materializeCreativeContextAssets(projectDir, Array.isArray(options.projectAssets)
    ? {
      ...rawGraphCreativeContext,
      asset_context: {
        ...(rawGraphCreativeContext.asset_context || {}),
        assets: mergeVisualAssets(
          rawGraphCreativeContext.asset_context?.assets || [],
          options.projectAssets.map(asset => ({
            ...asset,
            ...(asset.path && !asset.frame_src ? { frame_src: `../${String(asset.path).replace(/\\/g, '/')}` } : {}),
          })),
        ),
      },
    }
    : rawGraphCreativeContext);
  const graphTarget = workflow.applyRenderTargetDefaults(workflow.resolveRenderTarget({ generate_audio: false }, sceneSpec()));
  const project = createEmptyProject({
    projectId: `${workflowId}_${runId}`,
    workflowId,
    runId,
    contentGraph: graph,
  });
  await writeFile(path.join(projectDir, 'content-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
  if (Array.isArray(options.projectAssets)) {
    project.assets = options.projectAssets;
  }
  if (!options.omitSceneSpecHash) {
    project.generation_checkpoint.scene_spec_hash = options.sceneSpecHash || computeSceneSpecCheckpointHash(sceneSpec());
  }
  markCheckpointStage(project, 'content_graph', {
    status: 'done',
    path: 'content-graph.json',
    input_hash: contentGraphPhase.buildContentGraphInput({
      sceneSpec: sceneSpec(), creativeContext: graphCreativeContext, target: graphTarget,
    }).inputHash,
    output_hash: contentGraphPhase.hashContentGraph(graph),
  });
  // P1-2 语义：checkpoint 无指纹一律不复用——fixture 按生产展开路径（visualPlan 编排 + beat 展开）
  // 现算各 scene 的输入指纹，与 resume 时 frameHtmlPhase 现算值逐字节一致
  const { fingerprintBySceneId, persistedVisualPlan } = (() => {
    const spec = sceneSpec();
    const visualPlan = visualPlanService.buildVisualPlan({
      graph,
      sceneSpec: spec,
      creativeContext: options.assetContext || { input: { raw_text: '三帧恢复测试' } },
      workflowId,
    });
    visualPlanService.assignMotionOrchestration(visualPlan, { styleProfile: visualPlan.style_profile || null });
    const visualDecisions = matchVisualBeatsToRenderers({ visualPlan });
    const expanded = workflow.expandContentGraphToVisualBeats({ graph, visualPlan, visualDecisions });
    const renderTarget = workflow.applyRenderTargetDefaults(workflow.resolveRenderTarget({ generate_audio: false }, spec));
    const map = new Map();
    const initialHtmlByGroup = new Map();
    let visualStyleReferenceHtml = '';
    const htmlBySceneId = new Map([
      ['scene_01', scene01Html],
      ['scene_02', validHtml('scene_02', '已完成二')],
    ]);
    for (const [index, node] of (expanded.nodes || []).entries()) {
      const sceneId = String(node.scene_id || node.id || '');
      const scene = spec.scenes.find(item => item.id === sceneId);
      const beatId = String(node.beat_id || node.beatId || '').trim();
      const groupId = node?.metadata?.visual_beat?.continuity?.group_id || null;
      const beatIndex = Number(node?.metadata?.visual_beat?.continuity?.beat_index) || 1;
      const previousBeatSummary = groupId
        ? frameHtmlPhase.summarizeBaseLayout(frameHtmlPhase.predecessorHtmlForBeat(initialHtmlByGroup, groupId, beatIndex))
        : '';
      const motionArgs = resolveAssetFirstMotionArgs(node, {
        scene,
        beats: visualPlan.beats || [],
        mediaOptions: {},
      });
      if (sceneId && !map.has(sceneId)) {
        map.set(sceneId, frameHtmlPhase.computeFrameInputFingerprint({
          graph: expanded,
          node,
          index,
          total: expanded.nodes.length,
          sceneSpec: spec,
          creativeContext: graphCreativeContext,
          styleProfile: visualPlan.style_profile || null,
          visualStyleReferenceHtml,
          previousFrameHtml: '',
          ...motionArgs,
          ...(previousBeatSummary ? { previousBeatSummary } : {}),
          ...(beatId && node?.metadata?.visual_beat
            ? {
              hasCaptions: frameHtmlPhase.hasCaptionsForBeat({
                scene,
                beats: visualPlan.beats || [],
                beatId,
                mediaOptions: {},
              }),
            }
            : {}),
          continuityMode: 'beat_mp4',
          target: renderTarget,
        }));
      }
      const html = htmlBySceneId.get(sceneId);
      if (html) {
        if (!visualStyleReferenceHtml) visualStyleReferenceHtml = html;
        frameHtmlPhase.collectReusedFrameContext({
          node,
          html,
          frameKey: sceneId,
          initialHtmlByGroup,
        });
      }
    }
    return {
      fingerprintBySceneId: map,
      persistedVisualPlan: { ...visualPlan, beats: visualPlan.beats.map(({ source_scene, ...beat }) => beat) },
    };
  })();
  project.visual_plan = persistedVisualPlan;
  if (options.legacyVisualPlan) project.visual_plan = { ...persistedVisualPlan, version: 1, input_fingerprint: '' };
  markCheckpointFrame(project, 'frame_html', 'scene_01', {
    status: 'done',
    html_path: 'frames/01-scene_01.html',
    input_hash: 'in-1',
    input_fingerprint: fingerprintBySceneId.get('scene_01') || '',
    output_hash: 'out-1',
  });
  markCheckpointFrame(project, 'frame_html', 'scene_02', {
    status: 'done',
    html_path: 'frames/02-scene_02.html',
    input_hash: 'in-2',
    input_fingerprint: fingerprintBySceneId.get('scene_02') || '',
    output_hash: 'out-2',
  });
  markCheckpointFrame(project, 'frame_html', 'scene_03', {
    status: 'failed',
    html_path: '',
    diagnostic_code: 'provider_missing_text',
  });
  if (options.audio) {
    project.audio = options.audio;
  }
  if (options.downstreamDone) {
    markCheckpointFrame(project, 'render', 'scene_01', {
      status: 'done',
      mp4_path: 'frames/scene_01.mp4',
      output_hash: 'render-1',
    });
    markCheckpointFrame(project, 'render', 'scene_03', {
      status: 'done',
      mp4_path: 'frames/scene_03.mp4',
      output_hash: 'render-3',
    });
    markCheckpointStage(project, 'compose', {
      status: 'done',
      output_path: 'exports/output.mp4',
      output_audio_path: 'exports/output-audio.mp4',
      diagnostic_code: '',
    });
    markCheckpointStage(project, 'duration_verify', {
      status: 'done',
      expected_duration_sec: 6,
      actual_duration_sec: 6,
      diagnostic_code: '',
    });
    markCheckpointStage(project, 'visual_inspect', {
      status: 'done',
      report_path: 'inspect/report.json',
      diagnostic_code: '',
    });
    project.exports = [{ id: 'export_001', path: 'exports/output.mp4', format: 'mp4' }];
    project.render_outputs = [{ path: 'exports/output.mp4' }];
    project.status = 'rendered';
  }
  await projectStore.saveProject(projectDir, project);
  return { projectDir };
}

async function runWorkflow({ rootDir, workflowId, runId, aiTextModel, target = {}, services = {}, sceneSpecOverride = null, creativeContextOverride = null, reuseContentGraph = false }) {
  return workflow.generateHtmlVideo({
    workflowId,
    runId,
    rootDir,
    sceneSpec: sceneSpecOverride || sceneSpec(),
    creativeContext: creativeContextOverride || { input: { raw_text: '三帧恢复测试' } },
    target: { generate_audio: false, ...target },
    reuseContentGraph,
    skipValidation: true,
    services: {
      aiTextModel,
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      visualQaService: {
        inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
      },
      ...services,
    },
  });
}

function matchingAudio() {
  const spec = sceneSpec();
  return {
    source: 'scene_spec',
    scene_spec_hash: computeSceneSpecSpeechHash(spec),
    scene_count: spec.scenes.length,
    scene_ids: spec.scenes.map(scene => scene.id),
    status: 'ready',
    narration_path: 'tts/narration.mp3',
    tts_manifest_path: 'tts/audio_manifest.json',
  };
}

function mismatchedAudio() {
  return {
    source: 'scene_spec',
    scene_spec_hash: 'old-hash',
    scene_count: 1,
    scene_ids: ['old_scene'],
    status: 'ready',
    narration_path: 'tts/old-narration.mp3',
    tts_manifest_path: 'tts/old-audio_manifest.json',
  };
}

function assertDownstreamInvalidated(project, sceneId = 'scene_03') {
  const checkpoint = project.generation_checkpoint;
  assert.equal(checkpoint.stages.frame_html.frames.scene_01.status, 'done');
  assert.equal(checkpoint.stages.frame_html.frames.scene_02.status, 'done');
  assert.equal(checkpoint.stages.render.frames.scene_01.status, 'done');
  assert.equal(checkpoint.stages.render.frames[sceneId].status, 'pending');
  assert.equal(checkpoint.stages.render.frames[sceneId].mp4_path, '');
  assert.equal(checkpoint.stages.compose.status, 'pending');
  assert.equal(checkpoint.stages.compose.output_path, '');
  assert.equal(checkpoint.stages.compose.output_audio_path, '');
  assert.equal(checkpoint.stages.duration_verify.status, 'pending');
  assert.notEqual(checkpoint.stages.duration_verify.actual_duration_sec, 6);
  assert.equal(checkpoint.stages.visual_inspect.status, 'done');
  assert.equal(checkpoint.stages.visual_inspect.report_path, 'inspect/visual-report.json');
  assert.deepEqual(project.exports, []);
  assert.notEqual(project.status, 'rendered');
}

async function main() {
  const originalGenerateFrameHtml = frameHtmlAgent.generateFrameHtml;
  const originalBuildFallbackFrameHtml = frameFallbackBuilder.buildFallbackFrameHtml;
  const originalRender = projectOrchestrator.renderHtmlVideoProject;

  projectOrchestrator.renderHtmlVideoProject = async ({ project, projectDir }) => ({
    success: true,
    project,
    html_video_project_path: projectDir,
    project_dir: projectDir,
    output_path: path.join(projectDir, 'out.mp4'),
    diagnostics: [],
  });

  try {
    assert.equal(
      contentGraphPhase.hashContentGraph({ b: 1, a: { d: 4, c: 3 } }),
      contentGraphPhase.hashContentGraph({ a: { c: 3, d: 4 }, b: 1 }),
      'Content Graph hash 不得受对象键顺序影响',
    );

    // Frame HTML 输入指纹直接覆盖完整 canonical prompt；只忽略 prompt/materializer 都不消费的字段。
    {
      const { computeFrameInputFingerprint, FRAME_PROMPT_VERSION } = frameHtmlPhase;
      assert.equal(FRAME_PROMPT_VERSION, 5, 'overlay-only Frame Prompt 合同变化必须使旧 checkpoint 失效');
      const args = () => {
        const node = {
          id: 'scene_01',
          label: '当前标签',
          text: '当前正文',
          data: { value: '当前数据' },
          asset_refs: [{ asset_id: 'gen_02', usage: 'subject' }, { asset_id: 'gen_01', usage: 'background' }],
          metadata: {
            visual_beat: {
              visual_base: {
                type: 'image_sequence',
                shots: [{ id: 'shot_01', asset_id: 'gen_01' }],
              },
              motion_overlay: { preset: 'count_up', theme_tokens: { accent: '#ff5a00' } },
              continuity: { group_id: 'g1', beat_index: 2 },
              visual_text: { headline: '第一幕' },
            },
          },
        };
        const beat = node.metadata.visual_beat;
        return {
          graph: {
            synopsis: '完整视频摘要',
            nodes: [
              { id: 'remote_before', label: '远端前帧' },
              { id: 'previous', label: '相邻前帧' },
              node,
              { id: 'next', label: '相邻后帧' },
              { id: 'remote_after', label: '远端后帧' },
            ],
            edges: [],
          },
          node,
          index: 2,
          total: 5,
          sceneSpec: {
            title: '场景规格',
            scenes: [
              { id: 'previous', title: '上一场景' },
              { id: 'scene_01', title: '当前场景', narration_text: '当前旁白' },
              { id: 'next', title: '下一场景' },
            ],
          },
          creativeContext: {
            source_context: { summary: '来源摘要' },
            asset_context: {
              assets: [
                { id: 'gen_01', media_type: 'image', status: 'ready', path: 'assets/gen-01.png', frame_src: '../assets/gen-01.png', provider: 'local' },
                { id: 'gen_02', media_type: 'image', status: 'ready', path: 'assets/gen-02.png', frame_src: '../assets/gen-02.png' },
              ],
            },
          },
          target: { resolution: { width: 1080, height: 1920 } },
          styleProfile: { id: 'editorial', family: 'editorial', palette: ['#111'] },
          visualStyleReferenceHtml: '<main>视觉锚点 A</main>',
          previousFrameHtml: '',
          beat,
          primitiveSnippet: '<div data-mp-overlay>primitive A</div>',
          diagramSkeleton: '',
          previousBeatSummary: '上一 beat 布局 A',
          hasCaptions: true,
          sceneBeatsBrief: '场景 beat brief A',
          continuityMode: 'beat_mp4',
        };
      };
      const base = computeFrameInputFingerprint(args());
      const oldV4Fingerprint = '07be78cff2675ccd3700d95a556b4632063f5d3fa107fa6af104fb4fde08074b';
      assert.notEqual(base, oldV4Fingerprint, 'overlay-only v5 产物指纹不得继续命中真实 v4 指纹');
      assert.notEqual(base, 'c77e59e0bdeb437abfdcb9b1c8ecde81f350b197b240c619b4ba187e8b810154', 'v3 产物指纹不得在当前版本继续命中');
      assert.ok(/^[0-9a-f]{64}$/.test(base), '指纹应为 sha256 hex');
      assert.equal(computeFrameInputFingerprint(args()), base, '同输入应得到同指纹');
      const consumedChanges = [
        ['node.label', value => { value.node.label = '已改标签'; }],
        ['node.text', value => { value.node.text = '已改正文'; }],
        ['node.data', value => { value.node.data.value = '已改数据'; }],
        ['graph.synopsis', value => { value.graph.synopsis = '已改视频摘要'; }],
        ['相邻前节点', value => { value.graph.nodes[1].label = '已改相邻前帧'; }],
        ['相邻后节点', value => { value.graph.nodes[3].label = '已改相邻后帧'; }],
        ['来源摘要', value => { value.creativeContext.source_context.summary = '已改来源摘要'; }],
        ['当前 scene', value => { value.sceneSpec.scenes[1].title = '已改当前场景'; }],
        ['style profile', value => { value.styleProfile.palette = ['#fff']; }],
        ['hasCaptions', value => { value.hasCaptions = false; }],
        ['sceneBeatsBrief', value => { value.sceneBeatsBrief = '已改 brief'; }],
        ['视觉锚点', value => { value.visualStyleReferenceHtml = '<main>视觉锚点 B</main>'; }],
        ['上一 beat 摘要', value => { value.previousBeatSummary = '上一 beat 布局 B'; }],
        ['primitive', value => { value.primitiveSnippet = '<div data-mp-overlay>primitive B</div>'; }],
        ['asset_refs 顺序', value => { value.node.asset_refs.reverse(); }],
        ['continuity mode', value => { value.continuityMode = 'scene_html'; }],
        ['画幅', value => { value.target = { resolution: { width: 1920, height: 1080 } }; }],
      ];
      for (const [label, change] of consumedChanges) {
        const changed = args();
        change(changed);
        assert.notEqual(computeFrameInputFingerprint(changed), base, `${label} 变化应改变指纹`);
      }
      for (const [field, value] of [
        ['status', 'pending'],
        ['path', 'assets/gen-01-v2.png'],
        ['frame_src', '../assets/gen-01-v2.png'],
      ]) {
        const registryChanged = args();
        registryChanged.creativeContext.asset_context.assets[0][field] = value;
        assert.notEqual(computeFrameInputFingerprint(registryChanged), base, `Shot registry ${field} 变化应改变指纹`);
      }
      for (const [label, change] of [
        ['远端节点', value => { value.graph.nodes[0].label = '远端节点变化'; }],
        ['graph edges', value => { value.graph.edges.push({ from: 'x', to: 'y' }); }],
        ['模型/审计参数', value => { value.modelOptions = { provider: 'x', audit: { id: 'y' } }; }],
        ['layout feedback', value => { value.layoutFeedback = '不进入正常生成指纹'; }],
      ]) {
        const changed = args();
        change(changed);
        assert.equal(computeFrameInputFingerprint(changed), base, `${label} 未被生产 Prompt 消费，不应扩大失效`);
      }
    }

    // D-07：旧 v3 checkpoint 即使 HTML 文件仍存在，也必须重建并物化摄影机受管运行时。
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-camera-v3-resume-'));
      const workflowId = '202606260000000020_camera_v3';
      const runId = 'run_camera_v3';
      const graph = contentGraph('摄影机 v3 恢复');
      graph.nodes[0].asset_refs = [{ asset_id: 'camera_asset', usage: 'subject' }];
      graph.nodes[0].metadata = {
        captions: sceneSpec().scenes[0].captions,
        narration_text: sceneSpec().scenes[0].narration_text,
      };
      const asset = {
        id: 'camera_asset',
        media_type: 'image',
        status: 'ready',
        requirement: 'preferred',
        path: 'assets/camera.png',
        frame_src: '../assets/camera.png',
        focus_regions: [{
          id: 'region_1',
          label: '第一幕旁白',
          region: { x: 0.2, y: 0.2, width: 0.3, height: 0.2 },
          focus_point: { x: 0.35, y: 0.3 },
          method: 'dom',
          confidence_level: 'high',
          verification: { status: 'verified', method: 'dom_match', evidence: '测试固定区域。' },
          trust_level: 'A',
        }],
      };
      const creativeContext = { asset_context: { assets: [asset] } };
      const { projectDir } = await setupProject(rootDir, workflowId, runId, {
        contentGraph: graph,
        projectAssets: [asset],
        assetContext: creativeContext,
      });
      const project = await projectStore.loadProject(projectDir);
      planFocusCues({ visualPlan: project.visual_plan, creativeContext, sceneSpec: sceneSpec(), mediaOptions: {} });
      const oldV3Fingerprint = 'c0fdad5117ebcf48662e3d2fc21517ba0f46be61810f748df92c1a65d464f3cc';
      project.generation_checkpoint.stages.frame_html.frames.scene_01.input_fingerprint = oldV3Fingerprint;
      await projectStore.saveProject(projectDir, project);

      const calls = [];
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };
      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        creativeContextOverride: creativeContext,
        aiTextModel: { async callTextModel() { throw new Error('canonical graph 应直接复用。'); } },
      });
      assert.equal(result.success, true);
      assert.ok(calls.some(args => args.node.id === 'scene_01'), '旧 v3 摄影机 checkpoint 不得复用');
      const persisted = await projectStore.loadProject(projectDir);
      const checkpoint = persisted.generation_checkpoint.stages.frame_html.frames.scene_01;
      const generatedArgs = calls.find(args => args.node.id === 'scene_01');
      assert.equal(checkpoint.input_fingerprint, frameHtmlPhase.computeFrameInputFingerprint({
        ...generatedArgs,
        continuityMode: 'beat_mp4',
      }), '重建后必须持久化实际模型输入的 v5 指纹');
      assert.notEqual(checkpoint.input_fingerprint, oldV3Fingerprint, 'v5 摄影机产物指纹必须与已记录的 v3 指纹不同');
      const html = await fs.readFile(path.join(projectDir, checkpoint.html_path), 'utf8');
      assert.match(html, /data-camera-cues=/, '重建 HTML 必须物化 camera cue 数据');
      assert.match(html, /computeCameraTransform/, '重建 HTML 必须包含 D-07 摄影机运行时');
    }

    // Overlay-only Prompt 合同升级：已有 v4 done checkpoint/HTML 必须重建并写入 v5 指纹。
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-overlay-v4-resume-'));
      const workflowId = '202606260000000021_overlay_v4';
      const runId = 'run_overlay_v4';
      const { projectDir } = await setupProject(rootDir, workflowId, runId);
      const project = await projectStore.loadProject(projectDir);
      // 由父提交 d1401259 的 v4 实现按本 fixture 同输入计算并固化。
      const oldV4Fingerprint = '869323c94d0da892e56029745e431c6c747af0457557c13c9ab2947581ea5494';
      const currentFingerprint = project.generation_checkpoint.stages.frame_html.frames.scene_01.input_fingerprint;
      assert.notEqual(currentFingerprint, oldV4Fingerprint, 'v5 Frame Prompt 指纹必须与已记录的真实 v4 指纹不同');
      project.generation_checkpoint.stages.frame_html.frames.scene_01.input_fingerprint = oldV4Fingerprint;
      await projectStore.saveProject(projectDir, project);

      const calls = [];
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args.node.id);
        return { success: true, html: validHtml(args.node.id, `${args.node.id} v5`) };
      };
      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        aiTextModel: { async callTextModel() { throw new Error('canonical graph 应直接复用。'); } },
      });

      assert.equal(result.success, true);
      assert.deepEqual(calls, ['scene_01', 'scene_02', 'scene_03'], '首帧视觉锚点失配后必须保守重建全部尾帧');
      const persisted = await projectStore.loadProject(projectDir);
      const checkpoint = persisted.generation_checkpoint.stages.frame_html.frames.scene_01;
      assert.equal(checkpoint.input_fingerprint, currentFingerprint, 'v4 Frame 重建后必须持久化 v5 指纹');
      assert.match(await fs.readFile(path.join(projectDir, checkpoint.html_path), 'utf8'), /scene_01 v5/);
    }

    // P1-2：shouldReuseFrameHtml 指纹判定——匹配复用 / 不匹配重生成 / 无指纹一律不复用
    {
      const { computeFrameInputFingerprint } = frameHtmlPhase;
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-fingerprint-reuse-'));
      const projectDir = path.join(rootDir, 'proj');
      await writeFile(path.join(projectDir, 'frames/01-scene_01.html'), validHtml('scene_01'));
      const target = { resolution: { width: 1080, height: 1920 } };
      const node = { id: 'scene_01', metadata: { visual_beat: { visual_text: { headline: '第一幕' } } } };
      const fingerprint = computeFrameInputFingerprint({ node, continuityMode: 'beat_mp4', target });
      const baseArgs = {
        projectDir,
        scene: { id: 'scene_01' },
        node,
        target,
        resumeAllowed: true,
      };
      const doneFrame = { status: 'done', html_path: 'frames/01-scene_01.html' };
      // 指纹匹配 → 复用
      assert.equal(workflow.shouldReuseFrameHtml({
        ...baseArgs,
        checkpointFrame: { ...doneFrame, input_fingerprint: fingerprint },
        inputFingerprint: fingerprint,
      }).reuse, true, 'checkpoint 指纹与当前指纹一致应复用');
      // 指纹不匹配 → 不复用
      assert.equal(workflow.shouldReuseFrameHtml({
        ...baseArgs,
        checkpointFrame: { ...doneFrame, input_fingerprint: 'deadbeef' },
        inputFingerprint: fingerprint,
      }).reuse, false, 'checkpoint 指纹与当前指纹不一致不应复用');
      // 无指纹（旧工程）→ 一律不复用（旧 HTML 必然是旧链路产物）
      assert.equal(workflow.shouldReuseFrameHtml({
        ...baseArgs,
        checkpointFrame: { ...doneFrame },
        inputFingerprint: fingerprint,
      }).reuse, false, '旧 checkpoint 无指纹不应复用');

      const sequenceNode = {
        id: 'scene_01',
        durationSec: 2,
        metadata: {
          narration_text: '聚焦输入框',
          captions: [{ id: 'caption_01', start: 0.2, end: 1.5, text: '聚焦输入框' }],
          visual_beat: {
            visual_text: { headline: '第一幕' },
            visual_base: {
              type: 'image_sequence',
              sequence_mode: 'fullscreen_relay',
              shots: [{
                id: 'shot_01',
                asset_id: 'asset_01',
                role: 'showcase',
                requirement: 'required',
                caption_ids: ['caption_01'],
                minimum_visible_duration_sec: 2,
                active_window: { time_base: 'scene_local', start_sec: 0, end_sec: 2 },
                camera: {
                  focus_cues: [{
                    id: 'cue_01',
                    effect: 'camera_zoom',
                    region_id: 'region_01',
                    zoom: 'normal',
                    caption_ids: ['caption_01'],
                  }],
                },
              }],
            },
          },
        },
      };
      const sequenceContext = {
        asset_context: {
          assets: [{
            id: 'asset_01',
            media_type: 'image',
            status: 'ready',
            path: 'assets/asset-01.png',
            focus_regions: [{
              id: 'region_01',
              trust_level: 'A',
              region: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
            }],
          }],
        },
      };
      const materialized = materializeSceneImageSequenceDom({
        html: validHtml('scene_01'),
        node: sequenceNode,
        creativeContext: sequenceContext,
      });
      assert.equal(materialized.success, true);
      assert.match(materialized.html, /data-camera-cues=/);
      assert.match(materialized.html, /__hvResolvedCameraCues/);

      const currentPath = 'frames/current-managed.html';
      await writeFile(path.join(projectDir, currentPath), materialized.html);
      assert.equal(workflow.shouldReuseFrameHtml({
        ...baseArgs,
        node: sequenceNode,
        creativeContext: sequenceContext,
        checkpointFrame: { status: 'done', html_path: currentPath, input_fingerprint: fingerprint },
        inputFingerprint: fingerprint,
      }).reuse, true, '当前受管 Image Sequence runtime 应继续复用');

      const oldRuntimePath = 'frames/old-managed.html';
      await writeFile(
        path.join(projectDir, oldRuntimePath),
        materialized.html.replace('shot.figure.__hvResolvedCameraCues = acceptedCues;', ''),
      );
      assert.equal(workflow.shouldReuseFrameHtml({
        ...baseArgs,
        node: sequenceNode,
        creativeContext: sequenceContext,
        checkpointFrame: { status: 'done', html_path: oldRuntimePath, input_fingerprint: fingerprint },
        inputFingerprint: fingerprint,
      }).reuse, false, '指纹相同的旧受管 runtime 也不得复用');

      assert.equal(workflow.shouldReuseFrameHtml({
        ...baseArgs,
        checkpointFrame: { ...doneFrame, input_fingerprint: fingerprint },
        inputFingerprint: fingerprint,
      }).reuse, true, '无 Image Sequence 的普通 Frame HTML 应继续复用');
    }

    // 旧链路识别：template_id / 旧策略字段 / 模板帧 任一命中即 legacy
    {
      const { detectLegacyPipelineMarkers } = workflow;
      assert.strictEqual(detectLegacyPipelineMarkers({ template_id: 'vertical' }).legacy, true, 'template_id 非空应判为 legacy');
      assert.strictEqual(detectLegacyPipelineMarkers({ template_id: 'bold_signal' }).legacy, true, '存量 bold_signal 工程应判为 legacy');
      assert.strictEqual(detectLegacyPipelineMarkers({ visual_strategy: 'hf_first' }).legacy, true, '旧策略字段 hf_first 应判为 legacy');
      assert.strictEqual(detectLegacyPipelineMarkers({ frames: [{ source_mode: 'template_inputs' }] }).legacy, true, '含模板帧应判为 legacy');
      assert.strictEqual(detectLegacyPipelineMarkers({ visual_strategy: 'asset_first', frames: [{ source_mode: 'raw_html' }] }).legacy, false, 'asset_first 工程不应判为 legacy');
      assert.strictEqual(detectLegacyPipelineMarkers({}).legacy, false, '三字段全空的工程不应判为 legacy');
    }

    // resumeArtifactsMatch：复用判定只看 scene_spec_hash；legacy 工程一律 false
    {
      const { resumeArtifactsMatch } = workflow;
      const spec = sceneSpec();
      const hash = computeSceneSpecCheckpointHash(spec);
      assert.strictEqual(
        resumeArtifactsMatch({ generation_checkpoint: { scene_spec_hash: hash } }, spec),
        true,
        'scene_spec_hash 一致应复用',
      );
      assert.strictEqual(
        resumeArtifactsMatch({ generation_checkpoint: { scene_spec_hash: 'other' } }, spec),
        false,
        'scene_spec_hash 不一致不应复用',
      );
      assert.strictEqual(
        resumeArtifactsMatch({ template_id: 'vertical', generation_checkpoint: { scene_spec_hash: hash } }, spec),
        false,
        'legacy 工程即使 hash 一致也不应复用',
      );
    }

    // 旧链路续跑 guard（e2e）：resume 读原始 project.json 判定 legacy，在任何写盘/阶段前拒绝；
    // 无 legacy 标记的工程照常穿过 guard 走后续阶段
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-legacy-guard-'));
      const workflowId = '202606260000000015_legacy_guard';

      // legacy 工程：绕过 projectStore.saveProject 的 normalize，直接写含 template_id 的原始 project.json
      const legacyRunId = 'run_legacy_guard';
      const legacyProjectDir = path.join(rootDir, workflowId, 'agent_runs', `${legacyRunId}-html-video`);
      await writeFile(path.join(legacyProjectDir, 'project.json'), `${JSON.stringify({
        project_id: `${workflowId}_${legacyRunId}`,
        workflow_id: workflowId,
        run_id: legacyRunId,
        template_id: 'bold_signal',
        generation_checkpoint: { scene_spec_hash: 'legacy-hash' },
      }, null, 2)}\n`);
      frameHtmlAgent.generateFrameHtml = async () => {
        throw new Error('legacy guard 应在建帧阶段前拦下，不应调用帧生成。');
      };

      const legacyResult = await runWorkflow({
        rootDir,
        workflowId,
        runId: legacyRunId,
        aiTextModel: {
          async callTextModel() {
            throw new Error('legacy guard 应在任何模型调用前拦下。');
          },
        },
      });

      assert.strictEqual(legacyResult.success, false, 'legacy 工程续跑应失败');
      assert.match(String(legacyResult.message || ''), /旧版链路/, '失败文案应说明旧版链路不支持续跑');
      const legacyDiag = (legacyResult.diagnostics || []).find(item => item.code === 'legacy_pipeline_project');
      assert.ok(legacyDiag, '诊断应含 legacy_pipeline_project');
      assert.strictEqual(legacyDiag.details.marker, 'template_id', '诊断应携带命中的 legacy 标记');
      // guard 在任何写盘之前返回：原始 project.json 不应被 normalize 重写（旧字段仍在）
      const persistedRaw = JSON.parse(await fs.readFile(path.join(legacyProjectDir, 'project.json'), 'utf8'));
      assert.strictEqual(persistedRaw.template_id, 'bold_signal', 'guard 拦截后不应覆写原始 project.json');

      // 对照：三个 legacy 标记全无的原始 project.json 应穿过 guard，走到后续阶段
      const cleanRunId = 'run_clean_guard';
      const cleanProjectDir = path.join(rootDir, workflowId, 'agent_runs', `${cleanRunId}-html-video`);
      await writeFile(path.join(cleanProjectDir, 'project.json'), `${JSON.stringify({
        project_id: `${workflowId}_${cleanRunId}`,
        workflow_id: workflowId,
        run_id: cleanRunId,
        generation_checkpoint: { scene_spec_hash: 'stale-hash' },
      }, null, 2)}\n`);
      frameHtmlAgent.generateFrameHtml = async args => ({ success: true, html: validHtml(args.node.id, args.node.id) });

      const cleanResult = await runWorkflow({
        rootDir,
        workflowId,
        runId: cleanRunId,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return { success: true, text: JSON.stringify(contentGraph('穿过 guard 重新生成')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.ok(
        !(cleanResult.diagnostics || []).some(item => item.code === 'legacy_pipeline_project'),
        '无 legacy 标记的工程不应被 guard 拒绝',
      );
      assert.strictEqual(cleanResult.success, true, '无 legacy 标记的工程应穿过 guard 正常跑完');
      await fs.rm(rootDir, { recursive: true, force: true });
    }
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-frame-resume-'));
      const workflowId = '202606260000000001_frame_resume';
      const runId = 'run_resume';
      const { projectDir } = await setupProject(rootDir, workflowId, runId);
      const canonicalGraph = JSON.parse(await fs.readFile(path.join(projectDir, 'content-graph.json'), 'utf8'));
      const oldOutputHash = crypto.createHash('sha256').update(JSON.stringify(canonicalGraph)).digest('hex');
      const stableOutputHash = contentGraphPhase.hashContentGraph(canonicalGraph);
      assert.notEqual(oldOutputHash, stableOutputHash, '旧 JSON.stringify hash fixture 必须与 stable hash 有区别');
      const legacyHashProject = await projectStore.loadProject(projectDir);
      markCheckpointStage(legacyHashProject, 'content_graph', { output_hash: oldOutputHash });
      await projectStore.saveProject(projectDir, legacyHashProject);
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async (args) => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, '第三幕') };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              throw new Error('resume 不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].node.id, 'scene_03');
      const project = await projectStore.loadProject(projectDir);
      assert.equal(project.generation_checkpoint.stages.content_graph.output_hash, stableOutputHash,
        '成功复用旧完整 hash 后必须迁移写回 stable hash');
      assert.notEqual(project.generation_checkpoint.stages.content_graph.output_hash, oldOutputHash);
      assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_01.html_path, 'frames/01-scene_01.html');
      assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_02.html_path, 'frames/02-scene_02.html');
      assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_03.status, 'done');
      // P1-2：新生成帧应写入输入指纹，供后续 resume 比较
      assert.ok(
        String(project.generation_checkpoint.stages.frame_html.frames.scene_03.input_fingerprint || '').length === 64,
        '新生成帧的 checkpoint 应持久化 input_fingerprint',
      );
    }

    // Content Graph resume：现代 hash 下补齐 required，并保持 canonical/project/checkpoint 幂等一致。
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-content-graph-finalize-resume-'));
      const workflowId = '202606260000000022_graph_finalize_resume';
      const runId = 'run_graph_finalize_resume';
      const asset = {
        id: 'upload_resume_required',
        file_name: 'resume-required.png',
        requirement: 'required',
        media_type: 'image',
        status: 'ready',
        path: 'assets/resume-required.png',
        frame_src: '../assets/resume-required.png',
      };
      const creativeContext = {
        input: { raw_text: 'S01 使用 resume-required.png。' },
        asset_context: { assets: [asset] },
      };
      const { projectDir } = await setupProject(rootDir, workflowId, runId, {
        projectAssets: [asset],
        assetContext: creativeContext,
      });
      let graphModelCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => ({ success: true, html: validHtml(args.node.id, args.node.id) });
      const run = () => runWorkflow({
        rootDir,
        workflowId,
        runId,
        creativeContextOverride: creativeContext,
        aiTextModel: {
          async callTextModel() {
            graphModelCalls += 1;
            throw new Error('合法 canonical graph 不应重新调用模型。');
          },
        },
      });
      const first = await run();
      assert.equal(first.success, true);
      assert.equal(graphModelCalls, 0);
      const canonicalPath = path.join(projectDir, 'content-graph.json');
      const firstCanonicalText = await fs.readFile(canonicalPath, 'utf8');
      const firstCanonical = JSON.parse(firstCanonicalText);
      assert.deepEqual(firstCanonical.nodes[0].asset_refs.map(ref => ref.asset_id), ['upload_resume_required']);
      const firstProject = await projectStore.loadProject(projectDir);
      const firstCheckpoint = firstProject.generation_checkpoint.stages.content_graph;
      assert.match(firstCheckpoint.input_hash, /^[a-f0-9]{64}$/);
      assert.equal(firstCheckpoint.output_hash, contentGraphPhase.hashContentGraph(firstCanonical));
      assert.equal(firstCheckpoint.path, 'content-graph.json');
      assert.equal(firstCheckpoint.reused, true);
      assert.ok(firstProject.content_graph.nodes.some(node => (
        (node.asset_refs || []).some(ref => ref.asset_id === 'upload_resume_required')
      )), '展开后的 project Graph 必须保留修复后的 required 引用');

      const second = await run();
      assert.equal(second.success, true, '素材水合后的同输入 hash 必须稳定并继续复用');
      assert.equal(graphModelCalls, 0);
      assert.equal(await fs.readFile(canonicalPath, 'utf8'), firstCanonicalText, '二次 resume 不得重复改写 canonical Graph');
      const secondCanonical = JSON.parse(firstCanonicalText);
      assert.deepEqual(secondCanonical.nodes[0].asset_refs.map(ref => ref.asset_id), ['upload_resume_required']);
    }

    // Content Graph resume：已记录的 output/input hash 不匹配时拒绝复用。
    for (const mismatch of ['output', 'input', 'status', 'legacy_hash']) {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), `html-video-content-graph-${mismatch}-mismatch-`));
      const workflowId = `202606260000000023_graph_${mismatch}_mismatch`;
      const runId = `run_graph_${mismatch}_mismatch`;
      const { projectDir } = await setupProject(rootDir, workflowId, runId);
      if (mismatch === 'output') {
        await writeFile(path.join(projectDir, 'content-graph.json'), `${JSON.stringify(contentGraph('漂移内容图'), null, 2)}\n`);
      } else {
        const project = await projectStore.loadProject(projectDir);
        markCheckpointStage(project, 'content_graph', mismatch === 'input'
          ? { input_hash: 'f'.repeat(64) }
          : mismatch === 'status'
            ? { status: 'pending' }
            : { input_hash: '', output_hash: '' });
        await projectStore.saveProject(projectDir, project);
      }
      frameHtmlAgent.generateFrameHtml = async () => { throw new Error('hash 不匹配时不得进入 Frame HTML。'); };
      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        reuseContentGraph: true,
        aiTextModel: { async callTextModel() { throw new Error('显式复用失败时不得调用模型。'); } },
      });
      assert.equal(result.success, false);
      assert.ok((result.diagnostics || []).some(item => item.code === 'content_graph_reuse_missing'));
      if (mismatch === 'legacy_hash') {
        let graphCalls = 0;
        frameHtmlAgent.generateFrameHtml = async args => ({ success: true, html: validHtml(args.node.id, args.node.id) });
        const regenerated = await runWorkflow({
          rootDir,
          workflowId,
          runId,
          aiTextModel: {
            async callTextModel() {
              graphCalls += 1;
              return { success: true, text: JSON.stringify(contentGraph('legacy hash 重新生成')) };
            },
          },
        });
        assert.equal(regenerated.success, true);
        assert.equal(graphCalls, 1, 'legacy 缺 hash 的普通流程必须重新生成 Content Graph');
      }
    }

    // Content Graph resume：任一旧节点已有 5 张 required 时结构化阻断，原 canonical/checkpoint 保持不变。
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-content-graph-capacity-resume-'));
      const workflowId = '202606260000000024_graph_capacity_resume';
      const runId = 'run_graph_capacity_resume';
      const assets = Array.from({ length: 5 }, (_, index) => ({
        id: `upload_resume_capacity_${index + 1}`,
        file_name: `resume-capacity-${index + 1}.png`,
        requirement: 'required',
        media_type: 'image',
        status: 'ready',
        path: `assets/resume-capacity-${index + 1}.png`,
      }));
      const graph = contentGraph('resume required 容量');
      graph.nodes[0].asset_refs = assets.map(asset => ({
        asset_id: asset.id, usage: 'subject', reason: '旧 canonical 引用',
      }));
      const { projectDir } = await setupProject(rootDir, workflowId, runId, {
        contentGraph: graph,
        projectAssets: assets,
        assetContext: { asset_context: { assets } },
      });
      const beforeCanonical = await fs.readFile(path.join(projectDir, 'content-graph.json'), 'utf8');
      const beforeStage = (await projectStore.loadProject(projectDir)).generation_checkpoint.stages.content_graph;
      frameHtmlAgent.generateFrameHtml = async () => { throw new Error('容量失败不得进入 Frame HTML。'); };
      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        reuseContentGraph: true,
        creativeContextOverride: { asset_context: { assets } },
        aiTextModel: { async callTextModel() { throw new Error('容量失败不得调用模型。'); } },
      });
      assert.equal(result.success, false);
      const diagnostic = (result.diagnostics || []).find(item => item.code === 'required_asset_scene_capacity_exceeded');
      assert.deepEqual(diagnostic.details, {
        scene_id: 'scene_01',
        asset_ids: assets.map(asset => asset.id),
        max_assets: 4,
      });
      assert.equal(diagnostic.retryable, false);
      assert.equal(diagnostic.fallback_allowed, false);
      assert.equal(await fs.readFile(path.join(projectDir, 'content-graph.json'), 'utf8'), beforeCanonical);
      assert.deepEqual((await projectStore.loadProject(projectDir)).generation_checkpoint.stages.content_graph, beforeStage);
    }

    // C-04 retry E2E：必须走生产 defaultRetryFrameHtmlAction → generateHtmlVideo →
    // shouldReuseFrameHtml；scene_html checkpoint 使用 scene:<scene_id> 键，定向重建目标 Scene。
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-default-retry-scene-'));
      const workflowId = '202606260000000001_default_retry_scene';
      const runId = 'run_default_retry_scene';
      const retrySceneSpec = {
        title: 'Scene HTML 定向重试',
        aspect_ratio: '9:16',
        scenes: [
          { id: 'scene_01', duration: 2, narration_text: '第一幕旁白', captions: [], visual_text: { headline: '第一幕' } },
          { id: 'scene_02', duration: 2, narration_text: '第二幕旁白', captions: [], visual_text: { headline: '第二幕' } },
        ],
      };
      const graph = {
        synopsis: 'Scene HTML 定向重试',
        nodes: [
          { id: 'scene_01', kind: 'text', text: '第一幕' },
          { id: 'scene_02', kind: 'text', text: '第二幕' },
        ],
        edges: [{ from: 'scene_01', to: 'scene_02', kind: 'sequence' }],
      };
      const creativeContext = {
        continuity_mode: 'scene_html',
        input: { raw_text: '首次内容图提示', source_hint: '保留原始用户提示' },
        source_context: { summary: '完整来源上下文' },
        research_context: { summary: '完整研究上下文' },
        brief: { summary: '完整策划上下文' },
        audio: { narration_text: '完整旁白上下文' },
        asset_context: {},
      };
      const retryTarget = { duration_sec: 4, aspect_ratio: '9:16', generate_audio: false, autoSfxEnabled: false };
      frameHtmlAgent.generateFrameHtml = async args => ({ success: true, html: validHtml(args.node.id, args.node.id) });
      const fresh = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        sceneSpecOverride: retrySceneSpec,
        creativeContextOverride: creativeContext,
        target: retryTarget,
        aiTextModel: { async callTextModel() { return { success: true, text: JSON.stringify(graph) }; } },
      });
      assert.equal(fresh.success, true);
      const projectDir = fresh.html_video_project_path;
      const project = await projectStore.loadProject(projectDir);
      assert.match(project.generation_checkpoint.stages.content_graph.input_hash, /^[a-f0-9]{64}$/,
        'fresh 必须写入现代 Content Graph input hash');
      const firstBefore = { ...project.generation_checkpoint.stages.frame_html.frames['scene:scene_01'] };
      const secondBefore = { ...project.generation_checkpoint.stages.frame_html.frames['scene:scene_02'] };
      const firstHtml = await fs.readFile(path.join(projectDir, firstBefore.html_path), 'utf8');
      markCheckpointFrame(project, 'frame_html', 'scene:scene_02', { status: 'pending' });
      await projectStore.saveProject(projectDir, project);

      const generated = [];
      frameHtmlAgent.generateFrameHtml = async args => {
        generated.push(args.node.id);
        return { success: true, html: validHtml(args.node.id, '第二幕新 HTML') };
      };
      const result = await creativeWorkflows.defaultRetryFrameHtmlAction({
        workflow: {
          workflow_id: workflowId,
          creative_context: creativeContext,
          result: { hyperframes_freeform: { project: { scene_spec: retrySceneSpec, frame_specs: {} } } },
          target: project.target,
        },
        project,
        projectDir,
        plan: { executor_options: { regenerate_frame_html: true, frame_ids: ['scene_02'] } },
        services: {
          aiTextModel: { callTextModel: async () => { throw new Error('Frame HTML 已由测试替身接管，不应调用模型。'); } },
          environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
          layoutQaService: { inspectFrameHtmlLayout: async () => ({ success: true, issues: [] }) },
        },
      });

      assert.equal(result.success, true);
      assert.deepEqual(generated, ['scene:scene_02']);
      const persisted = await projectStore.loadProject(projectDir);
      const firstCheckpoint = persisted.generation_checkpoint.stages.frame_html.frames['scene:scene_01'];
      const secondCheckpoint = persisted.generation_checkpoint.stages.frame_html.frames['scene:scene_02'];
      assert.equal(firstCheckpoint.html_path, firstBefore.html_path);
      assert.equal(firstCheckpoint.output_hash, firstBefore.output_hash);
      assert.equal(firstCheckpoint.input_fingerprint, firstBefore.input_fingerprint);
      assert.equal(await fs.readFile(path.join(projectDir, firstBefore.html_path), 'utf8'), firstHtml);
      assert.notEqual(secondCheckpoint.output_hash, secondBefore.output_hash);
      assert.equal(secondCheckpoint.status, 'done');
      assert.match(await fs.readFile(path.join(projectDir, secondCheckpoint.html_path), 'utf8'), /第二幕新 HTML/);
    }

    // Review：resume 不传 creativeContext 时，从 project.assets 恢复全部正式字段；旧受管 DOM 即使指纹相同也重建。
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-registry-resume-'));
      const workflowId = '202606260000000001_registry_resume';
      const runId = 'run_registry_resume';
      const graph = contentGraph('正式素材恢复');
      graph.nodes[0].asset_refs = [{ asset_id: 'capture_01', usage: 'showcase', reason: '页面截图' }];
      const asset = {
        id: 'capture_01',
        media_type: 'image',
        origin: 'page_capture',
        origin_detail: 'github_repository_page',
        provider: 'chromium',
        requirement: 'required',
        evidence_class: 'direct_source',
        status: 'ready',
        path: 'assets/capture-01.png',
        frame_src: '../assets/capture-01.png',
        fit: 'contain',
        image_analysis: { fit: 'contain', summary: '仓库页面截图', contains_text: true },
        focus_regions: [{
          id: 'region_stars',
          label: 'Stars 数量',
          aliases: ['stars'],
          region: { x: 0.7, y: 0.1, width: 0.2, height: 0.1 },
          method: 'dom',
          confidence_level: 'high',
          verification: { status: 'verified', method: 'dom_match', evidence: '页面元素' },
          trust_level: 'C',
        }],
      };
      const callerOnlyFocus = {
        id: 'caller_focus',
        media_type: 'image',
        origin: 'source_extract',
        status: 'ready',
        path: 'assets/caller-focus.png',
      };
      const clearedByProject = {
        id: 'cleared_focus',
        media_type: 'image',
        origin: 'source_extract',
        status: 'ready',
        path: 'assets/cleared-focus.png',
        focus_regions: [],
      };
      await setupProject(rootDir, workflowId, runId, {
        contentGraph: graph,
        projectAssets: [asset, callerOnlyFocus, clearedByProject],
        assetContext: { asset_context: { assets: [asset, callerOnlyFocus, clearedByProject] } },
      });
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args.node.id);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };
      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        creativeContextOverride: {
          asset_context: { assets: [{
            id: 'capture_01',
            media_type: 'image',
            origin: 'page_capture',
            origin_detail: 'caller_stale',
            provider: 'caller',
            requirement: 'optional',
            evidence_class: 'contextual',
            status: 'ready',
            path: 'assets/old.png',
            frame_src: '../assets/old.png',
            fit: 'cover',
            image_analysis: { fit: 'cover', summary: '旧调用方分析' },
            focus_regions: [{
              id: 'stale',
              label: '旧区域',
              aliases: [],
              region: { x: 0, y: 0, width: 0.2, height: 0.2 },
              method: 'vision',
              verification: { status: 'candidate', method: 'model', evidence: '旧调用方' },
            }],
          }, {
            ...callerOnlyFocus,
            focus_regions: [{
              id: 'caller_region',
              label: '调用方区域',
              aliases: [],
              region: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
              method: 'vision',
              verification: { status: 'candidate', method: 'model', evidence: '仅调用方存在' },
            }],
          }, {
            ...clearedByProject,
            focus_regions: [{
              id: 'must_clear',
              label: '应被清空',
              aliases: [],
              region: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
              method: 'vision',
              verification: { status: 'candidate', method: 'model', evidence: '陈旧数据' },
            }],
          }] },
        },
        aiTextModel: { async callTextModel() { throw new Error('canonical graph 应直接复用。'); } },
      });
      assert.equal(result.success, true);
      assert.deepEqual(calls, ['scene_01', 'scene_02', 'scene_03'], '首帧旧受管 DOM 重建后必须连同视觉锚点尾帧一起重建');
      const shot = result.project.visual_plan.beats.find(beat => beat.scene_id === 'scene_01').visual_base.shots[0];
      assert.equal(shot.requirement, 'required');
      assert.equal(shot.fit, 'contain');
      assert.equal(shot.analysis.summary, '仓库页面截图');
      assert.equal(shot.src, '../assets/capture-01.png');
      assert.equal(shot.focus_regions, undefined, 'focus_regions 不得复制到 Visual Plan / Shot');
      const persisted = result.project.assets.find(item => item.id === 'capture_01');
      assert.equal(persisted.requirement, 'required');
      assert.equal(persisted.provider, 'chromium');
      assert.equal(persisted.origin_detail, 'github_repository_page');
      assert.equal(persisted.evidence_class, 'direct_source');
      assert.equal(persisted.path, 'assets/capture-01.png');
      assert.equal(persisted.image_analysis?.focus_regions, undefined, 'focus_regions 只能位于 asset 顶层');
      assert.equal(persisted.focus_regions[0].id, 'region_stars', 'resume 必须以 project canonical focus 覆盖陈旧调用方');
      assert.equal(persisted.focus_regions[0].trust_level, 'A');
      assert.equal(result.project.assets.find(item => item.id === 'caller_focus').focus_regions[0].id, 'caller_region', 'project 缺失 focus 时保留调用方值');
      assert.deepEqual(result.project.assets.find(item => item.id === 'cleared_focus').focus_regions, [], 'project 显式空数组应清空调用方值');
    }

    // C-04：只改变受管 Shot 消费的当前 registry 路径时，旧 Frame HTML 不得命中 checkpoint。
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-shot-registry-fingerprint-'));
      const workflowId = '202606260000000019_shot_registry_fingerprint';
      const runId = 'run_shot_registry_fingerprint';
      const graph = contentGraph('Shot registry fingerprint');
      graph.nodes[0].asset_refs = [{ asset_id: 'shot_asset', usage: 'showcase' }];
      const oldAsset = {
        id: 'shot_asset',
        media_type: 'image',
        status: 'ready',
        path: 'assets/shot-old.png',
        frame_src: '../assets/shot-old.png',
      };
      const { projectDir } = await setupProject(rootDir, workflowId, runId, {
        contentGraph: graph,
        projectAssets: [oldAsset],
        assetContext: { asset_context: { assets: [oldAsset] } },
      });
      const currentAsset = {
        ...oldAsset,
        path: 'assets/shot-current.png',
        frame_src: '../assets/shot-current.png',
      };
      await writeFile(path.join(projectDir, currentAsset.path), 'asset');
      const project = await projectStore.loadProject(projectDir);
      project.assets = [currentAsset];
      await projectStore.saveProject(projectDir, project);
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args.node.id);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        creativeContextOverride: { asset_context: { assets: [currentAsset] } },
        aiTextModel: { async callTextModel() { return { success: true, text: JSON.stringify(graph) }; } },
      });

      assert.equal(result.success, true);
      assert.ok(calls.includes('scene_01'), 'registry 路径变化后必须重建引用该 Shot 的 Frame HTML');
      const persisted = await projectStore.loadProject(projectDir);
      const html = await fs.readFile(path.join(projectDir, persisted.generation_checkpoint.stages.frame_html.frames.scene_01.html_path), 'utf8');
      assert.match(html, /src="\.\.\/assets\/shot-current\.png"/, '重建 HTML 必须物化当前 registry 路径');
      assert.doesNotMatch(html, /shot-old\.png/, '旧 Frame HTML 不得继续复用旧 registry 路径');
    }

    // C-02：旧 visual plan 无法证明 v2 fingerprint 时，所有 Frame HTML fail-closed 重生成。
    // C-03：required Shot 最短时长冲突必须在 Frame HTML 前阻断，且禁止 fallback/retry。
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-shot-timing-conflict-'));
      const workflowId = '202606260000000015_shot_timing_conflict';
      const runId = 'run_shot_timing_conflict';
      const graph = contentGraph('Shot timing conflict');
      graph.nodes[0].asset_refs = [{ asset_id: 'text_a' }, { asset_id: 'text_b' }];
      const assets = ['text_a', 'text_b'].map(id => ({
        id,
        media_type: 'image',
        requirement: 'required',
        status: 'ready',
        path: `assets/${id}.png`,
        frame_src: `../assets/${id}.png`,
        image_analysis: { contains_text: true },
      }));
      await setupProject(rootDir, workflowId, runId, {
        contentGraph: graph,
        projectAssets: assets,
        assetContext: { asset_context: { assets } },
      });
      let frameHtmlCalls = 0;
      frameHtmlAgent.generateFrameHtml = async () => {
        frameHtmlCalls += 1;
        return { success: true, html: validHtml('scene_01', 'unexpected') };
      };
      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        creativeContextOverride: { asset_context: { assets } },
        aiTextModel: { async callTextModel() { throw new Error('canonical graph 应直接复用。'); } },
      });
      assert.equal(result.success, false);
      assert.equal(frameHtmlCalls, 0);
      assert.equal(result.retryable, false);
      assert.equal(result.fallback_allowed, false);
      const diagnostic = result.diagnostics.find(item => item.code === 'required_asset_shot_timing_conflict');
      assert.ok(diagnostic);
      assert.equal(diagnostic.retryable, false);
      assert.equal(diagnostic.fallback_allowed, false);
      assert.match(diagnostic.user_message, /必用图片镜头/);
    }

    // C-03 Review：raw caption 非对象必须由真实 workflow 结构化阻断，不能抛 TypeError。
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-caption-invalid-'));
      const workflowId = '202606260000000018_caption_invalid';
      const runId = 'run_caption_invalid';
      const graph = contentGraph('Invalid caption');
      graph.nodes[0].asset_refs = [{ asset_id: 'caption_asset' }];
      const asset = {
        id: 'caption_asset',
        media_type: 'image',
        requirement: 'required',
        status: 'ready',
        path: 'assets/caption-asset.png',
        frame_src: '../assets/caption-asset.png',
      };
      await setupProject(rootDir, workflowId, runId, {
        contentGraph: graph,
        projectAssets: [asset],
        assetContext: { asset_context: { assets: [asset] } },
      });
      const invalidSpec = sceneSpec();
      invalidSpec.scenes[0] = { ...invalidSpec.scenes[0], captions: [null] };
      let frameHtmlCalls = 0;
      frameHtmlAgent.generateFrameHtml = async () => {
        frameHtmlCalls += 1;
        return { success: true, html: validHtml('scene_01', 'unexpected') };
      };
      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        sceneSpecOverride: invalidSpec,
        creativeContextOverride: { asset_context: { assets: [asset] } },
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) return { success: true, text: JSON.stringify(graph) };
            throw new Error(`不应进入 Frame HTML 模型：${prompt.slice(0, 40)}`);
          },
        },
      });
      assert.equal(result.success, false);
      assert.equal(frameHtmlCalls, 0);
      assert.ok(result.diagnostics.some(item => item.code === 'image_sequence_caption_invalid'));
    }

    // C-03：非必用 Shot 因字幕锚点不足而缩减时继续生成，并把 warning 贯穿工作流结果。
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-shot-reduced-warning-'));
      const workflowId = '202606260000000017_shot_reduced_warning';
      const runId = 'run_shot_reduced_warning';
      const graph = contentGraph('Shot reduced warning');
      graph.nodes[0].asset_refs = [{ asset_id: 'optional_a' }, { asset_id: 'optional_b' }];
      const assets = ['optional_a', 'optional_b'].map(id => ({
        id,
        media_type: 'image',
        requirement: 'optional',
        status: 'ready',
        path: `assets/${id}.png`,
        frame_src: `../assets/${id}.png`,
        image_analysis: { contains_text: true },
      }));
      await setupProject(rootDir, workflowId, runId, {
        contentGraph: graph,
        projectAssets: assets,
        assetContext: { asset_context: { assets } },
      });
      frameHtmlAgent.generateFrameHtml = async args => ({ success: true, html: validHtml(args.node.id, args.node.id) });
      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        creativeContextOverride: { asset_context: { assets } },
        aiTextModel: { async callTextModel() { throw new Error('canonical graph 应直接复用。'); } },
      });
      assert.equal(result.success, true);
      const warning = result.diagnostics.find(item => item.code === 'image_sequence_shots_reduced_for_duration');
      assert.ok(warning);
      assert.equal(warning.severity, 'warning');
      assert.equal(warning.retryable, false);
      assert.equal(warning.fallback_allowed, true);
    }

    // C-03：只改变 canonical caption track 也必须改变计划指纹并使已完成 Frame HTML 失效。
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-caption-resume-'));
      const workflowId = '202606260000000016_caption_resume';
      const runId = 'run_caption_resume';
      const { projectDir } = await setupProject(rootDir, workflowId, runId);
      const previousFingerprint = (await projectStore.loadProject(projectDir)).visual_plan.input_fingerprint;
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args.node.id);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };
      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        sceneSpecOverride: changedCaptionSceneSpec(),
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return { success: true, text: JSON.stringify(contentGraph('字幕已修改')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });
      assert.equal(result.success, true);
      assert.deepEqual(calls, ['scene_01', 'scene_02', 'scene_03']);
      const persisted = await projectStore.loadProject(result.html_video_project_path);
      assert.equal(persisted.visual_plan.input_fingerprint, result.project.visual_plan.input_fingerprint);
      assert.notEqual(persisted.visual_plan.input_fingerprint, previousFingerprint);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-plan-version-resume-'));
      const workflowId = '202606260000000001_plan_version';
      const runId = 'run_plan_version';
      await setupProject(rootDir, workflowId, runId, { legacyVisualPlan: true });
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args.node.id);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };
      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        aiTextModel: { async callTextModel() { throw new Error('canonical graph 应直接复用。'); } },
      });
      assert.equal(result.success, true);
      assert.deepEqual(calls, ['scene_01', 'scene_02', 'scene_03']);
      assert.equal(result.project.visual_plan.version, 2);
      assert.equal(result.project.visual_plan.input_fingerprint.length, 64);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-audio-resume-'));
      const workflowId = '202606260000000005_audio_resume';
      const runId = 'run_audio_resume';
      await setupProject(rootDir, workflowId, runId, { audio: matchingAudio() });
      let ttsCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => ({ success: true, html: validHtml(args.node.id, args.node.id) });

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        target: { generate_audio: true },
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              throw new Error('音频恢复场景不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
        services: {
          ttsService: {
            async synthesizeSceneNarration() {
              ttsCalls += 1;
              throw new Error('resume 已有匹配音频时不应调用 TTS。');
            },
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(ttsCalls, 0);
      assert.equal(result.project.audio.narration_path, 'tts/narration.mp3');
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-audio-current-mismatch-'));
      const workflowId = '202606260000000012_audio_current_mismatch';
      const runId = 'run_audio_current_mismatch';
      await setupProject(rootDir, workflowId, runId, { audio: matchingAudio() });
      let ttsCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => ({ success: true, html: validHtml(args.node.id, args.node.id) });

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        target: { generate_audio: true },
        creativeContextOverride: {
          input: { raw_text: '三帧恢复测试' },
          audio: mismatchedAudio(),
        },
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              throw new Error('音频候选选择场景不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
        services: {
          ttsService: {
            async synthesizeSceneNarration() {
              ttsCalls += 1;
              throw new Error('resume 有匹配音频时不应调用 TTS。');
            },
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(ttsCalls, 0);
      assert.equal(result.project.audio.narration_path, 'tts/narration.mp3');
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-spaced-anchor-'));
      const workflowId = '202606260000000006_spaced_anchor';
      const runId = 'run_spaced_anchor';
      await setupProject(rootDir, workflowId, runId, { scene01Html: spacedAnchorHtml() });
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              throw new Error('合法空格锚点复用场景不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-comment-anchor-'));
      const workflowId = '202606260000000007_comment_anchor';
      const runId = 'run_comment_anchor';
      await setupProject(rootDir, workflowId, runId, { scene01Html: commentOnlyAnchorHtml() });
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              throw new Error('注释假锚点场景不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_01', 'scene_02', 'scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-changed-script-'));
      const workflowId = '202606260000000008_changed_script';
      const runId = 'run_changed_script';
      await setupProject(rootDir, workflowId, runId);
      const calls = [];
      let contentGraphCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        sceneSpecOverride: changedSceneSpec(),
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              contentGraphCalls += 1;
              return { success: true, text: JSON.stringify(contentGraph('脚本已修改')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(contentGraphCalls, 1);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_01', 'scene_02', 'scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-changed-visual-'));
      const workflowId = '202606260000000011_changed_visual';
      const runId = 'run_changed_visual';
      const visualSpec = changedVisualSceneSpec();
      assert.equal(computeSceneSpecSpeechHash(sceneSpec()), computeSceneSpecSpeechHash(visualSpec));
      await setupProject(rootDir, workflowId, runId);
      const calls = [];
      let contentGraphCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        sceneSpecOverride: visualSpec,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              contentGraphCalls += 1;
              return { success: true, text: JSON.stringify(contentGraph('视觉字段已修改')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(contentGraphCalls, 1);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_01', 'scene_02', 'scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-rewrite-interrupt-'));
      const workflowId = '202606260000000013_rewrite_interrupt';
      const runId = 'run_rewrite_interrupt';
      const visualSpec = changedVisualSceneSpec();
      const { projectDir } = await setupProject(rootDir, workflowId, runId, { downstreamDone: true });
      let contentGraphCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => ({
        success: false,
        message: `模拟 ${args.node.id} 失败`,
        diagnostics: [{
          code: 'frame_html_invalid',
          stage: 'ai-frame-html',
          sub_stage: 'frame_html',
          frame_id: args.node.id,
          user_message: '模拟帧 HTML 失败。',
          retryable: true,
          repair_action: 'retry_frame_html',
        }],
      });

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        sceneSpecOverride: visualSpec,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              contentGraphCalls += 1;
              return { success: true, text: JSON.stringify(contentGraph('中断新图')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, false);
      assert.equal(contentGraphCalls, 1);
      const project = await projectStore.loadProject(projectDir);
      assert.equal(project.generation_checkpoint.scene_spec_hash, computeSceneSpecCheckpointHash(visualSpec));
      assert.equal(project.content_graph.synopsis, '中断新图');
      assert.notEqual(project.generation_checkpoint.stages.frame_html.frames.scene_01?.status, 'done');
      assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_02, undefined);
      assert.deepEqual(project.exports, []);
      assert.notEqual(project.status, 'rendered');
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-missing-hash-'));
      const workflowId = '202606260000000009_missing_hash';
      const runId = 'run_missing_hash';
      await setupProject(rootDir, workflowId, runId, { omitSceneSpecHash: true });
      const calls = [];
      let contentGraphCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              contentGraphCalls += 1;
              return { success: true, text: JSON.stringify(contentGraph('缺 hash 重新生成')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(contentGraphCalls, 1);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_01', 'scene_02', 'scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-frame-bad-reuse-'));
      const workflowId = '202606260000000003_bad_frame_reuse';
      const runId = 'run_bad_reuse';
      await setupProject(rootDir, workflowId, runId, { badScene01Html: true });
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async (args) => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              throw new Error('坏 HTML 复用场景不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_01', 'scene_02', 'scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-stale-graph-'));
      const workflowId = '202606260000000004_stale_graph';
      const runId = 'run_stale_graph';
      await setupProject(rootDir, workflowId, runId, { contentGraph: staleContentGraph() });
      const calls = [];
      let contentGraphCalls = 0;
      frameHtmlAgent.generateFrameHtml = async (args) => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              contentGraphCalls += 1;
              return { success: true, text: JSON.stringify(contentGraph('重新生成内容图')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(contentGraphCalls, 1);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_01', 'scene_02', 'scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-invalid-message-'));
      const workflowId = '202606260000000014_invalid_message';
      const runId = 'run_invalid_message';
      const { projectDir } = await setupProject(rootDir, workflowId, runId);
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async (args) => {
        calls.push(args);
        return {
          success: false,
          message: '返回结果缺少文本内容，但 HTML 结构校验失败。',
          diagnostics: [{
            code: 'frame_html_invalid',
            stage: 'ai-frame-html',
            sub_stage: 'frame_html',
            frame_id: args.node.id,
            user_message: '单帧 HTML 结构校验失败。',
            retryable: true,
            repair_action: 'retry_frame_html',
          }],
        };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              throw new Error('诊断优先级测试不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, false);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].node.id, 'scene_03');
      assert.equal(result.diagnostics[0].code, 'frame_html_invalid');
      assert.equal(result.diagnostics[0].sub_stage, 'frame_html');
      assert.equal(result.diagnostics[0].frame_id, 'scene_03');
      assert.equal(result.diagnostics[0].retryable, true);
      assert.equal(result.diagnostics[0].repair_action, 'retry_frame_html');
      const project = await projectStore.loadProject(projectDir);
      assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_03.diagnostic_code, 'frame_html_invalid');
    }

    {
      const calls = [];
      const result = await originalGenerateFrameHtml({
        model: {
          async callTextModel(request) {
            calls.push(request);
            return { success: true, text: '' };
          },
        },
        frameId: 'scene_03',
        attempt: 2,
        modelOptions: { stream: false },
        shortPrompt: true,
        graph: { nodes: [{ id: 'scene_03', text: '第三幕' }], edges: [] },
        node: { id: 'scene_03', text: '第三幕' },
        index: 2,
        total: 3,
        sceneSpec: sceneSpec(),
        target: { resolution: { width: 1080, height: 1920 } },
      });
      assert.equal(result.success, false);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].stream, false);
      assert.equal(result.diagnostics[0].code, 'provider_missing_text');
      assert.match(calls[0].messages[0].content, /当前帧：scene_03/);
      assert.doesNotMatch(calls[0].messages[0].content, /Source context summary|content graph node|Visual continuity lock/);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-frame-fallback-'));
      const workflowId = '202606260000000002_frame_fallback';
      const runId = 'run_fallback';
      const { projectDir } = await setupProject(rootDir, workflowId, runId, { downstreamDone: true });
      const calls = [];
      let contentGraphCalls = 0;
      const fallbackCalls = [];
      frameHtmlAgent.generateFrameHtml = async (args) => {
        calls.push(args);
        return {
          success: false,
          message: args.attempt === 1 ? '返回结果缺少文本内容。' : '流式返回结果缺少文本内容。',
          diagnostics: [{
            code: 'provider_missing_text',
            stage: 'ai-frame-html',
            sub_stage: 'frame_html',
            frame_id: args.node.id,
            user_message: '返回结果缺少文本内容。',
            retryable: true,
            repair_action: 'retry_frame_html',
          }],
        };
      };
      frameFallbackBuilder.buildFallbackFrameHtml = (args) => {
        fallbackCalls.push(args);
        return originalBuildFallbackFrameHtml(args);
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              contentGraphCalls += 1;
              throw new Error('resume fallback 不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(contentGraphCalls, 0);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].node.id, 'scene_03');
      assert.equal(calls[0].attempt, 1);
      assert.deepEqual(calls[0].modelOptions, {
        requestTimeoutMs: 180000,
        maxRetries: 1,
        audit: {
          agent: 'FrameHtmlAgent',
          stage: 'frame_html',
          sub_stage: 'frame_html',
          frame_id: 'scene_03',
          node_id: 'scene_03',
          attempt: 1,
        },
      });
      assert.equal(calls[1].node.id, 'scene_03');
      assert.equal(calls[1].attempt, 2);
      assert.deepEqual(calls[1].modelOptions, {
        requestTimeoutMs: 180000,
        maxRetries: 1,
        stream: false,
        audit: {
          agent: 'FrameHtmlAgent',
          stage: 'frame_html',
          sub_stage: 'frame_html',
          frame_id: 'scene_03',
          node_id: 'scene_03',
          attempt: 2,
        },
      });
      assert.equal(calls[1].shortPrompt, true);
      assert.equal(fallbackCalls.length, 1);
      assert.equal(fallbackCalls[0].scene.id, 'scene_03');

      const project = await projectStore.loadProject(projectDir);
      const frame = project.generation_checkpoint.stages.frame_html.frames.scene_03;
      assert.equal(frame.status, 'done');
      assert.equal(frame.diagnostic_code, 'fallback_frame_html_used');
      const warning = result.diagnostics.find(item => item.code === 'fallback_frame_html_used');
      assert.ok(warning);
      assert.equal(warning.stage, 'ai-frame-html');
      assert.equal(warning.sub_stage, 'frame_html');
      assert.equal(warning.frame_id, 'scene_03');
      assert.equal(warning.severity, 'warning');
      assert.equal(warning.fallback_allowed, true);
      assert.equal(warning.retryable, false);
      assert.equal(warning.user_message, '当前帧 AI 生成连续失败，已使用基础 HTML 兜底。');
      const fallbackHtml = await fs.readFile(path.join(projectDir, frame.html_path), 'utf8');
      assert.match(fallbackHtml, /data-text-key="headline"/);
      assert.match(fallbackHtml, /data-text-key="subtitle"/);
      assert.match(fallbackHtml, /data-text-key="body"/);
      assertDownstreamInvalidated(project);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-frame-mixed-fallback-'));
      const workflowId = '202606260000000003_mixed_fallback';
      const runId = 'run_mixed_fallback';
      const { projectDir } = await setupProject(rootDir, workflowId, runId, { downstreamDone: true });
      const calls = [];
      const failedHtml = [
        '<!doctype html><html><head>',
        '<meta name="viewport" content="width=1920,height=1080">',
        '<style>html,body{width:1920px;height:1080px}</style>',
        '</head><body><main>错误横屏 HTML</main></body></html>',
      ].join('');
      frameHtmlAgent.generateFrameHtml = async (args) => {
        calls.push(args);
        if (args.attempt === 1) {
          return {
            success: false,
            message: '首版 HTML 未通过校验：HTML 画幅尺寸不符合目标 1080x1920；修复重试时模型返回空内容。',
            failed_html: failedHtml,
            diagnostics: [{
              code: 'html_validation_failed',
              stage: 'ai-frame-html',
              sub_stage: 'frame_html',
              frame_id: args.node.id,
              user_message: '首版 HTML 未通过校验：HTML 画幅尺寸不符合目标 1080x1920；修复重试时模型返回空内容。',
              retryable: true,
              repair_action: 'retry_frame_html',
              details: {
                validation_code: 'frame_html_invalid',
                retry_provider_missing_text: true,
                failed_html: failedHtml,
              },
            }],
          };
        }
        return {
          success: false,
          message: '返回结果缺少文本内容。',
          diagnostics: [{
            code: 'provider_missing_text',
            stage: 'ai-frame-html',
            sub_stage: 'frame_html',
            frame_id: args.node.id,
            user_message: '返回结果缺少文本内容。',
            retryable: true,
            repair_action: 'retry_frame_html',
          }],
        };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              throw new Error('mixed fallback 不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].attempt, 1);
      assert.equal(calls[1].attempt, 2);
      assert.equal(calls[1].shortPrompt, true);
      const project = await projectStore.loadProject(projectDir);
      const frame = project.generation_checkpoint.stages.frame_html.frames.scene_03;
      assert.equal(frame.status, 'done');
      assert.equal(frame.diagnostic_code, 'fallback_frame_html_used');
      const warning = result.diagnostics.find(item => item.code === 'fallback_frame_html_used');
      assert.ok(warning?.details?.failed_html_path);
      const failedHtmlPath = path.join(projectDir, warning.details.failed_html_path);
      assert.match(await fs.readFile(failedHtmlPath, 'utf8'), /错误横屏 HTML/);
      assertDownstreamInvalidated(project);
    }
  } finally {
    frameHtmlAgent.generateFrameHtml = originalGenerateFrameHtml;
    frameFallbackBuilder.buildFallbackFrameHtml = originalBuildFallbackFrameHtml;
    projectOrchestrator.renderHtmlVideoProject = originalRender;
  }

  console.log('html-video frame html resume tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
