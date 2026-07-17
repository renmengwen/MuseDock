const assert = require('assert');
const fs = require('fs/promises');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const { buildMixedFrameProject } = require('../server/services/creative-video/html-video/mixedFrameBuilder');
const { validateHtmlVideoProject } = require('../server/services/creative-video/html-video/validationGate');
const { buildVisualPlan } = require('../server/services/creative-video/html-video/visualPlanService');
const { matchVisualBeatsToRenderers } = require('../server/services/creative-video/html-video/visualRouteMatcher');
const { normalizeCaptions } = require('../server/services/creative-video/html-video/rawHtmlFrameBuilder');

// 测试隔离：本机若配置了 image 模型，生图链路会混入本测试的 mock 计数，
// 通过 services 注入未配置的 aiImageModel（generatedImagePhase 优先取 services.aiImageModel）。
const stubAiImageModel = { isConfigured: async () => false };

(async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-per-scene-'));

  const sceneSpec = {
    scenes: [
      {
        id: 'scene_data',
        kind: 'data',
        duration_sec: 4,
        narration_text: '核心指标达到 88.6%。',
        visual_text: { headline: '核心指标 88.6%', keywords: ['核心指标', '对照值'], cards: ['核心指标 88.6%', '对照值 72.4%'] },
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
  const visualDecisions = matchVisualBeatsToRenderers({ visualPlan });
  const beatProject = await buildMixedFrameProject({
    projectDir,
    workflowId: 'wf',
    runId: 'run-beats',
    graph: beatGraph,
    sceneSpec: beatSpec,
    target: { aspect_ratio: '16:9', resolution: { width: 1920, height: 1080 }, fps: 30 },
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
      creativeContext: { input: { raw_text: '图片优先逐场景' } },
      target: { generateAudio: false, generateCaptions: false },
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
                    ...(scene.id === 'scene_data' ? { asset_refs: [{ asset_id: 'gen_scene_data', usage: 'subject', reason: '场景主视觉' }] } : {}),
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
  assert.equal(assetFirstResult.success, true, JSON.stringify({
    message: assetFirstResult.message,
    diagnostics: assetFirstResult.html_video_diagnostics,
  }, null, 2));
  const canonicalGraph = JSON.parse(await fs.readFile(path.join(assetFirstResult.html_video_project_path, 'content-graph.json'), 'utf8'));
  assert.notEqual(canonicalGraph.expanded_from_scene_graph, true, 'content-graph.json 必须保持 canonical graph');
  assert.equal(assetFirstResult.project.content_graph.expanded_from_scene_graph, true, 'project.content_graph 可保存展开图');
  assert.equal(
    assetFirstResult.project.generation_checkpoint.stages.content_graph.output_hash,
    crypto.createHash('sha256').update(JSON.stringify(canonicalGraph)).digest('hex'),
    'content graph checkpoint hash 必须绑定 canonical graph',
  );
  const assetFirstBeats = assetFirstResult.project.visual_plan.beats.filter(beat => beat.scene_id === 'scene_data');
  assert.ok(assetFirstBeats.length >= 1);
  assert.ok(
    assetFirstBeats.every(beat => (beat.asset_refs || []).some(ref => ref.asset_id === 'gen_scene_data') && beat.visual_base?.type === 'image_sequence'),
    `Content Graph 选择的生成图应成为 image_sequence：${JSON.stringify(assetFirstBeats, null, 2)}`,
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
      assert.strictEqual(Object.prototype.hasOwnProperty.call(d, 'template_id'), false, `asset_first 决策不应再携带 template_id：${JSON.stringify(d)}`);
    }
  }

  // R3：展开后的 content graph node 必须带完整 visual_beat 元数据
  {
    const graphNodes = assetFirstResult.project.content_graph?.nodes || [];
    assert.ok(graphNodes.length > 0, 'asset_first 工程应有 content_graph.nodes');
    for (const node of graphNodes) {
      const vb = node.metadata?.visual_beat;
      assert.ok(vb && vb.id === node.beat_id, 'node.metadata.visual_beat 必须存在且与 beat_id 一致');
      // P0-1：motion_overlay 改为可选——结构类型 beat 有 overlay，普通图片/diagram beat 为 null；
      // 无论如何都不得是 undefined 或缺 preset 的畸形对象（规格 §16 P0-1）
      assert.ok(
        vb.motion_overlay === null || (vb.motion_overlay && typeof vb.motion_overlay.preset === 'string' && vb.motion_overlay.preset.length > 0),
        `motion_overlay 必须为 null 或带合法 preset：${JSON.stringify(vb.motion_overlay)}`,
      );
      assert.ok(!vb.source_scene, 'visual_beat 不得携带 source_scene（体积与序列化考虑）');
    }
    // P0-1：结构类型 beat（scene_data=data / scene_quote=quote）仍应叠 overlay，
    // 证明 overlay 编排在放开可选后没有整体失效
    assert.ok(
      graphNodes.some(node => node.metadata?.visual_beat?.motion_overlay?.preset),
      '结构类型 beat 应仍带 motion_overlay（overlay 编排未整体失效）',
    );
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

  // P1-A（决策2）：resume 二次执行（仅带 projectDir/workflowId/runId/sceneSpec 的重试入口），
  // render_decisions 仍全是 raw_html + route_role。
  {
    projectOrchestrator.renderHtmlVideoProject = async ({ project: renderProject, projectDir: renderProjectDir }) => ({
      success: true,
      message: 'mock render success',
      project: renderProject,
      project_dir: renderProjectDir,
      html_video_project_path: renderProjectDir,
      output_path: path.join(renderProjectDir, 'exports', 'output.mp4'),
      diagnostics: [],
    });
    let resumeResult;
    try {
      resumeResult = await workflow.generateHtmlVideo({
        workflowId: 'wf-per-scene-asset-first',
        runId: 'run-per-scene-asset-first',
        rootDir: assetFirstRootDir,
        sceneSpec: workflowSceneSpec,
        // 关键：retry/resume 调用只带 projectDir/workflowId/runId/sceneSpec，模拟真实重试入口
        creativeContext: { input: { raw_text: '图片优先逐场景' } },
        target: { generateAudio: false, generateCaptions: false },
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
    assert.equal(resumeResult.success, true, JSON.stringify({
      message: resumeResult.message,
      diagnostics: resumeResult.html_video_diagnostics,
    }, null, 2));
    assert.strictEqual(resumeResult.project.continuity_mode, 'beat_mp4',
      'resume 后 project.continuity_mode 不得被 creativeContext 缺省值冲掉');
    const resumeDecisions = resumeResult.project.render_decisions || [];
    assert.ok(resumeDecisions.length > 0, 'resume 应产生 render_decisions');
    for (const d of resumeDecisions) {
      assert.ok(
        typeof d.route_role === 'string' && d.route_role.length > 0,
        `resume 后决策必须仍带 route_role：${JSON.stringify(d)}`,
      );
      assert.strictEqual(d.source_mode, 'raw_html',
        `resume 后决策必须仍为 raw_html：${JSON.stringify(d)}`);
    }
  }

  // P1-1a：Frame HTML 阶段失败提前返回后，落盘 project.json 必须已带 continuity_mode，
  // 否则真实 retry（不带 creativeContext）会丢失连续性模式选择。
  {
    const failRootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-per-scene-strategy-fail-'));
    let failResult;
    projectOrchestrator.renderHtmlVideoProject = async () => {
      throw new Error('frame html 失败后不应进入渲染');
    };
    try {
      failResult = await workflow.generateHtmlVideo({
        workflowId: 'wf-per-scene-strategy-fail',
        runId: 'run-per-scene-strategy-fail',
        rootDir: failRootDir,
        sceneSpec: workflowSceneSpec,
        creativeContext: { input: { raw_text: '图片优先建帧失败' } },
        target: { generateAudio: false, generateCaptions: false },
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
                    synopsis: '图片优先建帧失败',
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
              // Frame HTML 阶段必然失败
              return { success: false, message: 'mock frame html failure' };
            },
          },
          environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
        },
      });
    } finally {
      projectOrchestrator.renderHtmlVideoProject = originalRenderHtmlVideoProject;
    }
    assert.equal(failResult.success, false, 'frame html 必然失败的用例应返回失败');
    const failProjectDir = failResult.html_video_project_path || failResult.project_dir;
    assert.ok(failProjectDir, '失败返回必须带工程目录');
    const failedProject = JSON.parse(await fs.readFile(path.join(failProjectDir, 'project.json'), 'utf8'));
    assert.strictEqual(failedProject.continuity_mode, 'beat_mp4',
      'P1-1a：frame html 失败提前返回后，落盘 project.continuity_mode 必须已写入');
    console.log('per-scene continuity persisted before failure test passed');
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
