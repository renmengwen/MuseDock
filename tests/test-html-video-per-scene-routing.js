const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { matchScenesToTemplates } = require('../server/services/creative-video/html-video/sceneTemplateMatcher');
const { buildMixedFrameProject } = require('../server/services/creative-video/html-video/mixedFrameBuilder');
const { validateHtmlVideoProject } = require('../server/services/creative-video/html-video/validationGate');
const { validateTemplateInputs } = require('../server/services/creative-video/html-video/templateInputAgent');
const { resolveFrameRenderSource } = require('../server/services/creative-video/html-video/frameRenderSource');
const { resolveGenerationMode } = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const { buildVisualPlan } = require('../server/services/creative-video/html-video/visualPlanService');
const { matchVisualBeatsToRenderers } = require('../server/services/creative-video/html-video/visualRouteMatcher');
const { normalizeCaptions } = require('../server/services/creative-video/html-video/rawHtmlFrameBuilder');

// 测试隔离：本机若配置了 image 模型，生图链路会混入本测试的 mock 计数，
// 通过 services 注入未配置的 aiImageModel（generatedImagePhase 优先取 services.aiImageModel）。
const stubAiImageModel = { isConfigured: async () => false };

(async () => {
  assert.equal(resolveGenerationMode({}), 'per_scene');
  assert.equal(resolveGenerationMode({ html_video_generation_mode: 'per_scene' }), 'per_scene');
  assert.equal(resolveGenerationMode({ html_video_generation_mode: 'raw_html' }), 'raw_html');
  assert.equal(resolveGenerationMode({ htmlVideoGenerationMode: 'template_inputs' }), 'template_inputs');

  const registry = createTemplateRegistry();
  registry.scanTemplates();
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-per-scene-'));

  const sceneSpec = {
    scenes: [
      {
        id: 'scene_data',
        kind: 'data',
        duration_sec: 4,
        narration_text: '核心指标达到 88.6%。',
        visual_text: { headline: '核心指标 88.6%', keywords: ['核心指标'], cards: ['核心指标 88.6%'] },
      },
      {
        id: 'scene_quote',
        kind: 'quote',
        duration_sec: 5,
        narration_text: '保持专注。',
        visual_text: { headline: '保持专注', cards: ['保持专注'] },
      },
      {
        id: 'scene_free',
        kind: 'unknown',
        duration_sec: 3,
        narration_text: '没有对应模板的自由场景。',
        visual_text: { headline: '自由内容' },
      },
    ],
  };

  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'frames/03-scene_free.html'),
    '<!doctype html><html><head><style>body{width:1920px;height:1080px}</style></head><body><main data-text-key="headline">自由内容</main><p data-text-key="subtitle">字幕</p><p data-text-key="body">正文</p></body></html>',
    'utf8',
  );

  const graph = {
    nodes: [
      { id: 'node_data', scene_id: 'scene_data', durationSec: 4 },
      { id: 'node_quote', scene_id: 'scene_quote', durationSec: 5 },
      { id: 'node_free', scene_id: 'scene_free', durationSec: 3, html_path: 'frames/03-scene_free.html' },
    ],
    edges: [
      { from: 'node_data', to: 'node_quote', kind: 'sequence' },
      { from: 'node_quote', to: 'node_free', kind: 'sequence' },
    ],
  };

  const decisions = matchScenesToTemplates({
    scenes: sceneSpec.scenes,
    registry,
    renderTarget: { aspectRatio: '16:9' },
  });
  assert.equal(decisions.get('scene_data').source_mode, 'template_inputs');
  assert.equal(decisions.get('scene_data').template_id, 'frame-pentagram-stat');
  assert.equal(decisions.get('scene_quote').source_mode, 'template_inputs');
  assert.equal(decisions.get('scene_quote').template_id, 'frame-electric-studio');
  assert.equal(decisions.get('scene_free').source_mode, 'raw_html');

  const project = await buildMixedFrameProject({
    projectDir,
    workflowId: 'wf',
    runId: 'run',
    graph,
    sceneSpec,
    target: { aspect_ratio: '16:9', resolution: { width: 1920, height: 1080 }, fps: 30 },
    registry,
    decisions,
    mediaOptions: { generateCaptions: false },
  });

  assert.equal(project.template_id, null);
  const dataFrame = project.frames.find(frame => frame.id === 'scene_data');
  const quoteFrame = project.frames.find(frame => frame.id === 'scene_quote');
  const freeFrame = project.frames.find(frame => frame.id === 'scene_free');

  assert.equal(dataFrame.source_mode, 'template_inputs');
  assert.equal(dataFrame.template_id, 'frame-pentagram-stat');
  assert.equal(dataFrame.html_path, null);
  assert.equal(validateTemplateInputs(dataFrame.inputs, registry.getTemplate(dataFrame.template_id)).success, true);

  assert.equal(quoteFrame.source_mode, 'template_inputs');
  assert.equal(quoteFrame.template_id, 'frame-electric-studio');
  assert.equal(quoteFrame.html_path, null);
  assert.equal(validateTemplateInputs(quoteFrame.inputs, registry.getTemplate(quoteFrame.template_id)).success, true);

  assert.equal(freeFrame.source_mode, 'raw_html');
  assert.equal(freeFrame.template_id, null);
  assert.equal(freeFrame.html_path, 'frames/03-scene_free.html');
  assert.ok(freeFrame.fallback_reason);

  const validation = await validateHtmlVideoProject({
    project,
    projectDir,
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
    options: { commercialOnly: true },
  });
  assert.equal(validation.ok, true);
  assert.ok(!validation.diagnostics.some(item => item.code === 'template_missing'));

  const templateSource = resolveFrameRenderSource({ projectDir, project, frame: dataFrame });
  assert.equal(templateSource.needs_materialize, true);
  assert.equal(templateSource.template_id, 'frame-pentagram-stat');
  const rawSource = resolveFrameRenderSource({ projectDir, project, frame: freeFrame });
  assert.equal(rawSource.needs_materialize, false);
  assert.equal(rawSource.html_path, 'frames/03-scene_free.html');

  // beat 展开：传入 visualPlan 时按 beat 建帧，字幕按 beat 窗口切片（局部时间）。
  const longNarration = '第一句讲清楚问题的来龙去脉与背景。第二句给出核心的判断标准和依据。第三句展开关键的执行步骤细节。第四句总结行动建议并给出提醒。';
  const beatSpec = {
    scenes: [
      {
        id: 'scene_free',
        kind: 'unknown',
        duration_sec: 3,
        narration_text: '没有对应模板的自由场景。',
        visual_text: { headline: '自由内容' },
      },
      {
        id: 'scene_long',
        kind: 'unknown',
        speech_duration_sec: 18,
        narration_text: longNarration,
        visual_text: { headline: '长场景' },
      },
    ],
  };
  await fs.writeFile(
    path.join(projectDir, 'frames/04-scene_long.html'),
    '<!doctype html><html><head><style>body{width:1920px;height:1080px}</style></head><body><main data-text-key="headline">长场景</main><p data-text-key="subtitle">字幕</p><p data-text-key="body">正文</p></body></html>',
    'utf8',
  );
  const beatGraph = {
    nodes: [
      { id: 'node_free', scene_id: 'scene_free', durationSec: 3, html_path: 'frames/03-scene_free.html' },
      { id: 'node_long', scene_id: 'scene_long', durationSec: 18, html_path: 'frames/04-scene_long.html' },
    ],
    edges: [
      { from: 'node_free', to: 'node_long', kind: 'sequence' },
    ],
  };
  const visualPlan = buildVisualPlan({ sceneSpec: beatSpec, workflowId: 'wf' });
  const visualDecisions = matchVisualBeatsToRenderers({
    visualPlan,
    registry,
    renderTarget: { aspectRatio: '16:9' },
  });
  const beatProject = await buildMixedFrameProject({
    projectDir,
    workflowId: 'wf',
    runId: 'run-beats',
    graph: beatGraph,
    sceneSpec: beatSpec,
    target: { aspect_ratio: '16:9', resolution: { width: 1920, height: 1080 }, fps: 30 },
    registry,
    decisions: visualDecisions,
    visualPlan,
    mediaOptions: { generateCaptions: true },
  });

  assert.equal(beatProject.frames.length, 4);
  const longFrames = beatProject.frames.filter(frame => frame.scene_id === 'scene_long');
  assert.equal(longFrames.length, 3);
  assert.deepEqual(longFrames.map(frame => frame.beat_id), ['scene_long_b1', 'scene_long_b2', 'scene_long_b3']);
  assert.ok(longFrames.every(frame => frame.duration_sec <= 8));
  assert.ok(longFrames.every(frame => frame.graph_node_id === 'node_long'));
  // 同场景 raw beat 共享该场景 graph node 生成的同一份 HTML（本期已接受的行为）
  assert.ok(longFrames.every(frame => frame.source_mode === 'raw_html' && frame.html_path === 'frames/04-scene_long.html'));
  assert.ok(longFrames.every(frame => frame.metadata.visual_beat && !('source_scene' in frame.metadata.visual_beat)));
  const singleBeatFrame = beatProject.frames.find(frame => frame.scene_id === 'scene_free');
  assert.equal(singleBeatFrame.beat_id, 'scene_free');
  assert.equal(singleBeatFrame.id, 'scene_free');

  // 时间轴守恒：帧时长总和 == 各场景时长总和
  const beatFrameTotal = beatProject.frames.reduce((total, frame) => total + frame.duration_sec, 0);
  assert.ok(Math.abs(beatFrameTotal - 21) < 1e-6);
  assert.ok(Math.abs(beatProject.output.duration - 21) < 1e-6);
  assert.equal(beatProject.timeline.tracks[0].items.length, 4);

  // 字幕切窗：beat 帧字幕不是整场景字幕的简单复制，且时间为 beat 局部时间
  const sceneLongCaptions = normalizeCaptions(beatSpec.scenes[1], 18);
  assert.ok(sceneLongCaptions.length >= 2, '长场景字幕应被拆成多段，测试前提不成立');
  for (const frame of longFrames) {
    assert.ok(frame.captions.length >= 1);
    assert.notEqual(JSON.stringify(frame.captions), JSON.stringify(sceneLongCaptions));
    for (const caption of frame.captions) {
      assert.ok(caption.start >= -1e-3 && caption.end <= frame.duration_sec + 1e-3, '字幕应落在 beat 窗口内的局部时间');
    }
  }
  // 还原偏移后拼接：覆盖时段与原场景字幕一致、无重复
  const restored = [];
  longFrames.forEach((frame, frameIndex) => {
    const offset = longFrames.slice(0, frameIndex).reduce((total, item) => total + item.duration_sec, 0);
    for (const caption of frame.captions) {
      restored.push({ start: caption.start + offset, end: caption.end + offset, text: caption.text });
    }
  });
  restored.sort((a, b) => a.start - b.start);
  for (let index = 1; index < restored.length; index += 1) {
    assert.ok(restored[index].start >= restored[index - 1].end - 1e-3, '还原偏移后的字幕时段不应重叠');
  }
  const restoredCovered = restored.reduce((total, item) => total + (item.end - item.start), 0);
  const sceneCovered = sceneLongCaptions.reduce((total, item) => total + (item.end - item.start), 0);
  assert.ok(Math.abs(restoredCovered - sceneCovered) < 0.02, '还原偏移后的字幕覆盖时长应与原场景字幕一致');
  const restoredMaxEnd = Math.max(...restored.map(item => item.end));
  const sceneMaxEnd = Math.max(...sceneLongCaptions.map(item => item.end));
  assert.ok(Math.abs(restoredMaxEnd - sceneMaxEnd) < 1e-3);
  for (const caption of sceneLongCaptions) {
    assert.ok(restored.some(item => item.text === caption.text), `原字幕文本「${caption.text}」应出现在 beat 字幕中`);
  }
  // beat 帧工程也要过校验 gate（frames:nodes 不再 1:1）
  const beatValidation = await validateHtmlVideoProject({
    project: beatProject,
    projectDir,
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
    sceneSpec: beatSpec,
    mediaOptions: { generateCaptions: true, generateAudio: false },
    options: { commercialOnly: true },
  });
  assert.equal(beatValidation.ok, true, JSON.stringify(beatValidation.diagnostics, null, 2));

  // 端到端：generateHtmlVideo（per_scene）必须按 beat 展开帧，并把 beat 级视觉计划与路由决策持久化进 project。
  const workflowRootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-per-scene-workflow-'));
  const workflowSceneSpec = {
    title: '逐场景视觉计划',
    aspect_ratio: '16:9',
    scenes: [
      ...sceneSpec.scenes,
      {
        id: 'scene_long',
        kind: 'text',
        speech_duration_sec: 18,
        narration_text: longNarration,
        visual_text: { headline: '长场景' },
      },
    ],
  };
  const originalRenderHtmlVideoProject = projectOrchestrator.renderHtmlVideoProject;
  projectOrchestrator.renderHtmlVideoProject = async ({ project: renderProject, projectDir: renderProjectDir }) => ({
    success: true,
    message: 'mock render success',
    project: renderProject,
    project_dir: renderProjectDir,
    html_video_project_path: renderProjectDir,
    output_path: path.join(renderProjectDir, 'exports', 'output.mp4'),
    diagnostics: [],
  });
  let result;
  try {
    result = await workflow.generateHtmlVideo({
      workflowId: 'wf-per-scene-visual-plan',
      runId: 'run-per-scene-visual-plan',
      rootDir: workflowRootDir,
      sceneSpec: workflowSceneSpec,
      creativeContext: { input: { raw_text: '逐场景视觉计划' } },
      target: { generateAudio: false, generateCaptions: false },
      templateRegistry: registry,
      skipValidation: true,
      services: {
        aiImageModel: stubAiImageModel,
        aiTextModel: {
          callTextModel: async request => {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: '逐场景视觉计划',
                  nodes: workflowSceneSpec.scenes.map(scene => ({
                    id: scene.id,
                    kind: scene.kind,
                    label: scene.visual_text.headline,
                    durationSec: scene.duration_sec,
                    text: scene.narration_text,
                  })),
                  edges: workflowSceneSpec.scenes.slice(1).map((scene, index) => ({
                    from: workflowSceneSpec.scenes[index].id,
                    to: scene.id,
                    kind: 'sequence',
                  })),
                }),
              };
            }
            const frameId = request.audit?.frame_id || 'scene_free';
            return {
              success: true,
              text: `<!doctype html><html><body><main data-frame-id="${frameId}"><h1 data-text-key="headline">自由内容</h1><p data-text-key="subtitle">字幕</p><section data-text-key="body">正文</section></main></body></html>`,
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      },
    });
  } finally {
    projectOrchestrator.renderHtmlVideoProject = originalRenderHtmlVideoProject;
  }
  assert.equal(result.success, true, JSON.stringify({
    message: result.message,
    diagnostics: result.html_video_diagnostics,
  }, null, 2));
  assert.ok(result.project.visual_plan);
  assert.ok(Array.isArray(result.project.visual_plan.beats));
  assert.ok(result.project.visual_plan.beats.length >= workflowSceneSpec.scenes.length);
  assert.ok(result.project.visual_plan.beats.every(beat => !('source_scene' in beat)));
  assert.ok(result.project.visual_plan.style_profile && result.project.visual_plan.style_profile.id);
  assert.ok(Array.isArray(result.project.render_decisions));
  assert.ok(result.project.render_decisions.length >= result.project.frames.length);
  assert.ok(result.project.render_decisions.every(item => item.beat_id || item.scene_id));
  // 硬约束 A 回归：未设置 visual_strategy（hf_first 链路）时决策对象不得带 route_role 字段
  assert.ok(
    result.project.render_decisions.every(item => !('route_role' in item)),
    `hf_first 链路的 render_decisions 不应带 route_role：${JSON.stringify(result.project.render_decisions, null, 2)}`,
  );

  // 持久化校验：project.json 落盘后经 normalizeProject 仍保留两个新字段。
  const savedProject = JSON.parse(await fs.readFile(path.join(result.html_video_project_path, 'project.json'), 'utf8'));
  assert.equal(savedProject.visual_plan.beats.length > savedProject.scene_spec.scenes.length, true);
  assert.ok(Array.isArray(savedProject.visual_plan.beats));
  assert.ok(savedProject.visual_plan.beats.every(beat => !('source_scene' in beat)));
  assert.ok(Array.isArray(savedProject.render_decisions));
  assert.ok(savedProject.render_decisions.length >= savedProject.frames.length);
  assert.equal(savedProject.visual_route_summary.style_profile_id, savedProject.visual_plan.style_profile.id);

  // 端到端：asset_first 下生图必须发生在路由之前——生成图要绑定进 beat 的 asset_refs，
  // 且带素材的场景不再走不支持图片的 template_inputs 模板。
  const assetFirstRootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-per-scene-asset-first-'));
  const generatingImageModel = {
    isConfigured: async () => true,
    generateImages: async () => ({
      success: true,
      images: [{ url: 'mock://generated-image' }],
      model_info: { model: 'mock-image-model' },
    }),
    downloadGeneratedImages: async ({ assetDir, startIndex }) => {
      await fs.mkdir(assetDir, { recursive: true });
      const fileName = `generated-${String(startIndex + 1).padStart(2, '0')}.png`;
      const localPath = path.join(assetDir, fileName);
      await fs.writeFile(localPath, Buffer.alloc(128, 7));
      return {
        success: true,
        files: [{ file_name: fileName, local_path: localPath, url: 'mock://generated-image', mime: 'image/png', bytes: 128 }],
        failures: [],
      };
    },
  };
  projectOrchestrator.renderHtmlVideoProject = async ({ project: renderProject, projectDir: renderProjectDir }) => ({
    success: true,
    message: 'mock render success',
    project: renderProject,
    project_dir: renderProjectDir,
    html_video_project_path: renderProjectDir,
    output_path: path.join(renderProjectDir, 'exports', 'output.mp4'),
    diagnostics: [],
  });
  let assetFirstResult;
  try {
    assetFirstResult = await workflow.generateHtmlVideo({
      workflowId: 'wf-per-scene-asset-first',
      runId: 'run-per-scene-asset-first',
      rootDir: assetFirstRootDir,
      sceneSpec: workflowSceneSpec,
      creativeContext: { input: { raw_text: '图片优先逐场景' }, visual_strategy: 'asset_first' },
      target: { generateAudio: false, generateCaptions: false },
      templateRegistry: registry,
      skipValidation: true,
      services: {
        aiImageModel: generatingImageModel,
        generatedImagePlanner: {
          planGeneratedImages: async () => ({
            success: true,
            plans: [{ scene_id: 'scene_data', generation_prompt: '核心指标主视觉插画' }],
          }),
        },
        aiTextModel: {
          callTextModel: async request => {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: '图片优先逐场景',
                  nodes: workflowSceneSpec.scenes.map(scene => ({
                    id: scene.id,
                    kind: scene.kind,
                    label: scene.visual_text.headline,
                    durationSec: scene.duration_sec,
                    text: scene.narration_text,
                  })),
                  edges: workflowSceneSpec.scenes.slice(1).map((scene, index) => ({
                    from: workflowSceneSpec.scenes[index].id,
                    to: scene.id,
                    kind: 'sequence',
                  })),
                }),
              };
            }
            const frameId = request.audit?.frame_id || 'scene_free';
            const imageTag = String(frameId).startsWith('scene_data')
              ? '<img src="../assets/generated-01.png" alt="主视觉">'
              : '';
            return {
              success: true,
              text: `<!doctype html><html><body><main data-frame-id="${frameId}">${imageTag}<h1 data-text-key="headline">自由内容</h1><p data-text-key="subtitle">字幕</p><section data-text-key="body">正文</section></main></body></html>`,
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      },
    });
  } finally {
    projectOrchestrator.renderHtmlVideoProject = originalRenderHtmlVideoProject;
  }
  assert.equal(assetFirstResult.success, true, JSON.stringify({
    message: assetFirstResult.message,
    diagnostics: assetFirstResult.html_video_diagnostics,
  }, null, 2));
  const assetFirstBeats = assetFirstResult.project.visual_plan.beats.filter(beat => beat.scene_id === 'scene_data');
  assert.ok(assetFirstBeats.length >= 1);
  assert.ok(
    assetFirstBeats.every(beat => (beat.asset_refs || []).some(ref => ref.asset_id === 'gen_scene_data')),
    `生成图应在路由前绑定进 scene_data 的 beat asset_refs：${JSON.stringify(assetFirstBeats, null, 2)}`,
  );
  const assetFirstDecisions = assetFirstResult.project.render_decisions.filter(item => item.scene_id === 'scene_data');
  assert.ok(assetFirstDecisions.length >= 1);
  assert.ok(
    assetFirstDecisions.every(item => item.source_mode === 'raw_html'),
    `带生成图的场景不应走 template_inputs：${JSON.stringify(assetFirstDecisions, null, 2)}`,
  );

  // 模块1：asset_first 下 render_decisions 必须带 route_role 且不含标题模板
  {
    const decisionsAll = assetFirstResult.project.render_decisions || [];
    assert.ok(decisionsAll.length > 0, '应产生 render_decisions');
    for (const d of decisionsAll) {
      assert.ok(
        typeof d.route_role === 'string' && d.route_role.length > 0,
        `asset_first 决策必须带 route_role：${JSON.stringify(d)}`,
      );
      assert.notStrictEqual(d.template_id, 'frame-glitch-title');
      assert.notStrictEqual(d.template_id, 'frame-build-minimal');
    }
  }

  // R3：展开后的 content graph node 必须带完整 visual_beat 元数据
  {
    const graphNodes = assetFirstResult.project.content_graph?.nodes || [];
    assert.ok(graphNodes.length > 0, 'asset_first 工程应有 content_graph.nodes');
    for (const node of graphNodes) {
      const vb = node.metadata?.visual_beat;
      assert.ok(vb && vb.id === node.beat_id, 'node.metadata.visual_beat 必须存在且与 beat_id 一致');
      assert.ok(vb.motion_overlay?.preset, 'asset_first 下 visual_beat 必须含 motion_overlay');
      assert.ok(!vb.source_scene, 'visual_beat 不得携带 source_scene（体积与序列化考虑）');
    }
  }

  // R4：帧统计必须活过 attachVisualRouting 的覆盖，出现在最终 project.json
  {
    const persisted = JSON.parse(
      await fs.readFile(path.join(assetFirstResult.html_video_project_path, 'project.json'), 'utf8'),
    );
    const withStats = (persisted.render_decisions || [])
      .filter(d => d.overlay_check || Number.isFinite(d.text_blocks));
    assert.ok(
      withStats.length > 0,
      `render_decisions 统计字段在最终 project.json 中必须存在（不被 attachVisualRouting 抹掉）：${JSON.stringify(persisted.render_decisions, null, 2)}`,
    );
  }

  // 绑定 helper：不改入参（保证 scene_spec_hash 稳定）、结果确定性、不重复写入
  {
    const bindSpec = {
      scenes: [
        { id: 'scene_data', asset_refs: [{ asset_id: 'gen_scene_data', usage: 'subject' }] },
        { id: 'scene_quote' },
      ],
    };
    const bindContext = {
      asset_context: {
        assets: [
          { id: 'gen_scene_quote', source: 'generated', generation: { scene_id: 'scene_quote' } },
          { id: 'gen_scene_data', source: 'generated', generation: { scene_id: 'scene_data' } },
        ],
      },
    };
    const before = JSON.stringify(bindSpec);
    const boundOnce = workflow.bindGeneratedAssetsToSceneSpec(bindSpec, bindContext);
    const boundTwice = workflow.bindGeneratedAssetsToSceneSpec(bindSpec, bindContext);
    assert.equal(JSON.stringify(bindSpec), before, '绑定不得修改原始 sceneSpec');
    assert.deepEqual(boundOnce, boundTwice, '绑定结果必须确定性');
    assert.equal(boundOnce.scenes[0].asset_refs.length, 1, '已有引用不重复写入');
    assert.deepEqual(
      boundOnce.scenes[1].asset_refs.map(ref => ref.asset_id),
      ['gen_scene_quote'],
      '生成图应绑定到对应场景',
    );
  }

  console.log('html-video per-scene routing tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
