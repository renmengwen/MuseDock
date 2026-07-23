const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const fsSync = require('fs');
const createdTempDirs = [];
const mkdtemp = fs.mkdtemp.bind(fs);
fs.mkdtemp = async (...args) => { const dir = await mkdtemp(...args); createdTempDirs.push(dir); return dir; };
process.on('exit', () => createdTempDirs.forEach(dir => fsSync.rmSync(dir, { recursive: true, force: true })));

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const aiImageModel = require('../server/services/ai/aiImageModel');

// 测试隔离：生图 phase 的前置检查默认读全局模型配置，本机若配置了 image 模型会让生图链路
// 混入这些集成测试（多一次 planner 的 text 调用，打乱 mock 计数）。统一按未配置处理。
aiImageModel.isConfigured = async () => false;

const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { buildCreativeContext } = require('../server/services/creative/creativeContext');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

function fullSceneCaption(sceneId, text, duration) {
  return [{
    id: `${sceneId}_caption_01`,
    start: 0,
    end: duration,
    duration,
    text,
  }];
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-workflow-'));

  // D-03c：焦点区域必须在 Frame HTML 前落盘；resume 从 project.assets 水合后不得重调 vision。
  {
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'focus-region-workflow-source-'));
    const sourcePath = path.join(sourceDir, 'hero.png');
    await fs.writeFile(sourcePath, 'focus-region-image-bytes');
    const sceneSpec = {
      title: '焦点区域持久化',
      aspect_ratio: '16:9',
      scenes: [{
        id: 'scene_01',
        duration_sec: 4,
        narration_text: '焦点区域应在帧生成前持久化。',
        captions: fullSceneCaption('scene_01', '焦点区域应在帧生成前持久化。', 4),
        visual_text: { headline: '焦点区域', keywords: [], cards: [] },
      }],
    };
    let visionCalls = 0;
    const model = {
      callTextModel: async request => {
        if (request.audit?.sub_stage === 'vision') {
          visionCalls += 1;
          return {
            success: true,
            text: JSON.stringify({
              regions: [{ label: '主体', region: { x: 0.2, y: 0.1, width: 0.5, height: 0.7 } }],
            }),
          };
        }
        const prompt = request.messages.map(item => (
          typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
        )).join('\n');
        if (prompt.startsWith('你是 html-video 的 content graph')) {
          return {
            success: true,
            text: JSON.stringify({
              synopsis: '焦点区域持久化',
              nodes: [{
                id: 'scene_01', kind: 'text', label: '焦点区域', durationSec: 4,
                text: '焦点区域应在帧生成前持久化。',
                asset_refs: [{ asset_id: 'hero', usage: 'subject' }],
              }],
              edges: [],
            }),
          };
        }
        return { success: true, text: 'Frame HTML 故意失败' };
      },
    };
    const options = {
      workflowId: 'wf-focus-region-persist',
      runId: 'run-focus-region-persist',
      rootDir,
      sceneSpec,
      creativeContext: {
        input: { raw_text: '焦点区域持久化' },
        asset_context: {
          assets: [{
            id: 'hero', media_type: 'image', origin: 'source_extract',
            requirement: 'preferred', evidence_class: 'direct_source', status: 'ready',
            path: 'assets/hero.png', local_path: sourcePath,
          }],
        },
      },
      target: { sourceImageAnalysisEnabled: true, generateAudio: false },
      skipValidation: true,
      services: { aiTextModel: model, aiImageModel: { isConfigured: async () => false } },
    };
    const first = await workflow.generateHtmlVideo(options);
    assert.equal(first.success, false, 'Frame HTML 故意失败以验证前置持久化');
    assert.equal(visionCalls, 1);
    const persisted = await projectStore.loadProject(first.project_dir);
    const persistedRegion = persisted.assets.find(item => item.id === 'hero')?.focus_regions?.[0];
    assert.equal(persistedRegion?.label, '主体');
    assert.equal(persistedRegion?.trust_level, 'C');

    const resumed = await workflow.generateHtmlVideo({
      ...options,
      creativeContext: { input: { raw_text: '焦点区域持久化' } },
    });
    assert.equal(resumed.success, false);
    assert.equal(visionCalls, 1, 'resume 应从 project.assets 水合 canonical region 并跳过 vision');
  }

  // D-06：focus_analysis durable 缓存必须扛住“完整成功 run”——buildMixedFrameProject 重建
  // （assets 清空）+ saveProject 覆盖 + projectAssetsFromCreativeContext 投影重建之后，
  // 记录全靠投影透传存活；第二次 run 对 empty 结果零 vision 调用（真正的跨 run 复用）。
  {
    const {
      FOCUS_ANALYSIS_CONTRACT_VERSION,
      FOCUS_ANALYSIS_PROMPT_VERSION,
    } = require('../server/services/creative-video/html-video/focusRegionPhase');
    const durableSourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'focus-analysis-durable-source-'));
    const durableSourcePath = path.join(durableSourceDir, 'hero-empty.png');
    const durableImageBytes = 'focus-analysis-empty-image-bytes';
    await fs.writeFile(durableSourcePath, durableImageBytes);
    const durableNarration = '空焦点结果应缓存，第二次 run 不再调用 vision。';
    const durableSpec = {
      title: '焦点分析缓存',
      aspect_ratio: '16:9',
      scenes: [{
        id: 'scene_01',
        kind: 'text',
        duration_sec: 4,
        narration_text: durableNarration,
        captions: fullSceneCaption('scene_01', durableNarration, 4),
        visual_text: { headline: '焦点缓存', keywords: [], cards: [] },
      }],
    };
    let visionCalls = 0;
    let layoutQaCalls = 0;
    const durableModel = {
      provider: 'mock-ai',
      modelId: 'vision-mock-1',
      callTextModel: async request => {
        if (request.audit?.sub_stage === 'vision') {
          visionCalls += 1;
          return { success: true, text: JSON.stringify({ regions: [] }) };
        }
        const prompt = request.messages.map(item => (
          typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
        )).join('\n');
        if (prompt.startsWith('你是 html-video 的 content graph')) {
          return {
            success: true,
            text: JSON.stringify({
              synopsis: '焦点分析缓存',
              nodes: [{
                id: 'scene_01', kind: 'text', label: '焦点缓存', durationSec: 4,
                text: durableNarration,
                asset_refs: [{ asset_id: 'hero_empty', usage: 'subject' }],
              }],
              edges: [],
            }),
          };
        }
        const frameId = request.audit?.frame_id || 'scene_01';
        return {
          success: true,
          text: `<!doctype html><html><body><main data-frame-id="${frameId}"><h1 data-text-key="headline">焦点缓存</h1><p data-text-key="subtitle">支撑短句</p><section data-text-key="body">要点</section></main></body></html>`,
        };
      },
    };
    const durableOptions = {
      workflowId: 'wf-focus-analysis-durable',
      runId: 'run-focus-analysis-durable',
      rootDir,
      sceneSpec: durableSpec,
      creativeContext: {
        input: { raw_text: '焦点分析缓存' },
        asset_context: {
          assets: [{
            id: 'hero_empty', media_type: 'image', origin: 'source_extract',
            requirement: 'preferred', evidence_class: 'direct_source', status: 'ready',
            path: 'assets/hero-empty.png', local_path: durableSourcePath,
          }],
        },
      },
      target: { sourceImageAnalysisEnabled: true, generateAudio: false },
      skipValidation: true,
      runLayoutQa: true,
      services: {
        aiTextModel: durableModel,
        aiImageModel: { isConfigured: async () => false },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
        layoutQaService: {
          async inspectFrameHtmlLayout() {
            layoutQaCalls += 1;
            return { success: false, issues: [{ code: 'text_overlap', severity: 'error' }] };
          },
        },
      },
    };
    const originalRenderForDurable = projectOrchestrator.renderHtmlVideoProject;
    projectOrchestrator.renderHtmlVideoProject = async ({ project, projectDir }) => ({
      success: true,
      message: 'mock render success',
      project,
      project_dir: projectDir,
      html_video_project_path: projectDir,
      output_path: path.join(projectDir, 'exports', 'output.mp4'),
      diagnostics: [],
    });
    try {
      const expectedRecord = {
        version: 1,
        content_sha256: crypto.createHash('sha256').update(durableImageBytes).digest('hex'),
        contract_version: FOCUS_ANALYSIS_CONTRACT_VERSION,
        provider: 'mock-ai',
        model: 'vision-mock-1',
        prompt_version: FOCUS_ANALYSIS_PROMPT_VERSION,
        status: 'empty',
      };
      const firstDurable = await workflow.generateHtmlVideo(durableOptions);
      assert.equal(firstDurable.success, true, JSON.stringify({
        message: firstDurable.message,
        diagnostics: firstDurable.diagnostics,
      }, null, 2));
      assert.equal(visionCalls, 1);
      const durablePersisted = await projectStore.loadProject(firstDurable.project_dir);
      const durableAsset = durablePersisted.assets.find(item => item.id === 'hero_empty');
      assert.deepEqual(durableAsset?.focus_regions, [], 'empty 分析结论应落盘为空 focus_regions');
      assert.deepEqual(durableAsset?.focus_analysis, expectedRecord,
        '完整成功 run 后 focus_analysis 必须仍在磁盘 assets 上');

      const secondDurable = await workflow.generateHtmlVideo({
        ...durableOptions,
        creativeContext: { input: { raw_text: '焦点分析缓存' } },
      });
      assert.equal(secondDurable.success, true, JSON.stringify({
        message: secondDurable.message,
        diagnostics: secondDurable.diagnostics,
      }, null, 2));
      assert.equal(visionCalls, 1, '第二次 run 必须命中 durable 缓存，零 vision 调用');
      assert.equal(layoutQaCalls, 0, '已开启跳过质检时不应调用布局 QA');
      const secondPersisted = await projectStore.loadProject(secondDurable.project_dir);
      assert.deepEqual(
        secondPersisted.assets.find(item => item.id === 'hero_empty')?.focus_analysis,
        expectedRecord,
        '第二次 run 后记录必须继续留在磁盘（可持续复用）',
      );
    } finally {
      projectOrchestrator.renderHtmlVideoProject = originalRenderForDurable;
    }
  }

  const originalRenderForNoCaptions = projectOrchestrator.renderHtmlVideoProject;
  projectOrchestrator.renderHtmlVideoProject = async ({ project, projectDir }) => ({
    success: true,
    message: 'mock render success',
    project,
    project_dir: projectDir,
    html_video_project_path: projectDir,
    output_path: path.join(projectDir, 'exports', 'output.mp4'),
    diagnostics: [],
  });
  try {
    const noCaptionsResult = await workflow.generateHtmlVideo({
      workflowId: 'wf-no-captions',
      runId: 'run-no-captions',
      rootDir,
      sceneSpec: {
        title: '无字幕测试',
        aspect_ratio: '16:9',
        scenes: [{
          id: 'scene_01',
          duration: 4,
          narration_text: '这段可以有旁白但不显示字幕。',
          captions: [null],
          visual_text: { headline: '标题' },
        }],
      },
      creativeContext: { input: { raw_text: '无字幕测试' } },
      projectOptions: {
        generateAudio: true,
        generateCaptions: false,
      },
      services: {
        aiTextModel: {
          callTextModel: async ({ messages }) => {
            const prompt = messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: '无字幕测试',
                  nodes: [{ id: 'scene_01', kind: 'text', label: '标题', durationSec: 4, text: '标题' }],
                  edges: [],
                }),
              };
            }
            return {
              success: true,
              text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">标题</h1><section data-text-key="body">画面</section></main></body></html>',
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      },
    });

    assert.equal(noCaptionsResult.success, true);
    assert.equal(noCaptionsResult.project.frames[0].captions.length, 0);
    const html = await fs.readFile(path.join(
      noCaptionsResult.html_video_project_path,
      noCaptionsResult.project.frames[0].html_path,
    ), 'utf8');
    assert.doesNotMatch(html, /data-hv-layer="captions"/);

    const targetDisabledResult = await workflow.generateHtmlVideo({
      workflowId: 'wf-no-captions-target',
      runId: 'run-no-captions-target',
      rootDir,
      sceneSpec: {
        scenes: [{ id: 'scene_01', duration: 2, narration_text: '旁白', captions: [null], visual_text: { headline: '标题' } }],
      },
      creativeContext: { input: { raw_text: 'target 禁用字幕' } },
      target: { generate_captions: false },
      services: {
        aiTextModel: {
          callTextModel: async ({ messages }) => {
            const prompt = messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return { success: true, text: JSON.stringify({ synopsis: '禁用字幕', nodes: [{ id: 'scene_01', text: '标题' }], edges: [] }) };
            }
            return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">标题</h1><p data-text-key="subtitle">副标题</p><section data-text-key="body">正文</section></main></body></html>' };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      },
    });
    assert.equal(targetDisabledResult.success, true);
    assert.equal(targetDisabledResult.diagnostics.some(item => item.code === 'image_sequence_caption_invalid'), false);
  } finally {
    projectOrchestrator.renderHtmlVideoProject = originalRenderForNoCaptions;
  }

  const sceneSpecWithNarration = {
    title: '禁用音频测试',
    aspect_ratio: '16:9',
    scenes: [{
      id: 'scene_01',
      duration: 4,
      narration_text: '这段旁白不应该生成音频。',
      captions: [{ id: 'c1', start: 0, end: 4, text: '这段旁白不应该生成音频。' }],
      visual_text: { headline: '禁用音频' },
    }],
  };
  const originalRenderForNoAudio = projectOrchestrator.renderHtmlVideoProject;
  const mockRenderSuccess = async ({ project, projectDir }) => ({
    success: true,
    message: 'mock render success',
    project,
    project_dir: projectDir,
    html_video_project_path: projectDir,
    output_path: path.join(projectDir, 'exports', 'output.mp4'),
    diagnostics: [],
  });
  const rawHtmlTextModel = ({ synopsis, label, text }) => ({
    callTextModel: async ({ messages }) => {
      const prompt = messages.map(item => item.content).join('\n');
      if (prompt.startsWith('你是 html-video 的 content graph')) {
        return {
          success: true,
          text: JSON.stringify({
            synopsis,
            nodes: [{ id: 'scene_01', kind: 'text', label, durationSec: 4, text }],
            edges: [],
          }),
        };
      }
      return {
        success: true,
        text: `<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">${label}</h1><section data-text-key="body">画面</section></main></body></html>`,
      };
    },
  });
  projectOrchestrator.renderHtmlVideoProject = mockRenderSuccess;
  try {
    let noAudioTtsCalls = 0;
    let noAudioSfxCalls = 0;
    const noAudioResult = await workflow.generateHtmlVideoProject({
      workflowId: 'wf-no-audio',
      runId: 'run-no-audio',
      rootDir,
      creativeContext: {
        input: { raw_text: '禁用音频测试' },
        scene_spec: sceneSpecWithNarration,
        audio: {
          path: 'stale.wav',
          scene_spec_hash: 'old-hash',
        },
      },
      projectOptions: {
        generateAudio: false,
        generateCaptions: true,
      },
      services: {
        aiTextModel: rawHtmlTextModel({ synopsis: '禁用音频测试', label: '禁用音频', text: '这段旁白不应该生成音频。' }),
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
        ttsService: {
          synthesizeSceneNarration: async () => {
            noAudioTtsCalls += 1;
            return { success: true };
          },
        },
        sfxPlannerAgent: {
          planSfxEvents: async () => {
            noAudioSfxCalls += 1;
            return { success: false, events: [] };
          },
        },
      },
    });

    assert.equal(noAudioResult.success, true);
    assert.equal(noAudioTtsCalls, 0);
    assert.equal(noAudioSfxCalls, 0);
    assert.equal(noAudioResult.project.audio.status, 'skipped');
    assert.equal(noAudioResult.project.audio.reason, 'disabled_by_settings');
  } finally {
    projectOrchestrator.renderHtmlVideoProject = originalRenderForNoAudio;
  }

  // ===== 决策2：continuity_mode 顶层持久化 + schema roundtrip =====
  const { normalizeProject } = require('../server/services/creative-video/html-video/projectSchema');

  // (1) normalizeProject 白名单必须保留 continuity_mode 且裁掉已删除的 visual_strategy
  {
    const normalized = normalizeProject({
      project_id: 'p1',
      visual_strategy: 'asset_first',
      continuity_mode: 'scene_html',
    });
    assert.strictEqual('visual_strategy' in normalized, false,
      'visual_strategy 概念已删除，normalizeProject 不得保留该字段');
    assert.strictEqual(normalized.continuity_mode, 'scene_html');
    // 缺省值：未设置时 continuity_mode 默认 beat_mp4
    const empty = normalizeProject({ project_id: 'p2' });
    assert.strictEqual(empty.continuity_mode, 'beat_mp4');
  }

  // (2) saveProject / loadProject 往返不丢（用测试临时目录，projectStore 真实读写）
  {
    const roundtripDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-strategy-roundtrip-'));
    const savedRoundtrip = await projectStore.saveProject(roundtripDir, normalizeProject({
      project_id: 'p3', continuity_mode: 'scene_html',
    }));
    assert.strictEqual(savedRoundtrip.continuity_mode, 'scene_html');
    const loadedRoundtrip = await projectStore.loadProject(roundtripDir);
    assert.strictEqual(loadedRoundtrip.continuity_mode, 'scene_html', 'load 后字段必须原样保留');
    await fs.rm(roundtripDir, { recursive: true, force: true });
  }
  // (3) workflow 端到端的 continuity_mode 持久化由下方 scene_html 用例覆盖
  // （sceneHtmlProject.continuity_mode === 'scene_html'）。

  // ===== Task 4.3：scene_html 端到端（continuity_mode=scene_html）=====
  // R1/R2：帧按 scene 归并（id = scene:<scene_id>）、frameHtmlPhase 回写 html_path、
  // frame_html/render checkpoint 全部按 scene:<id> 键控。
  {
    const sceneHtmlNarration = '第一句讲清楚问题的来龙去脉与背景。第二句给出核心的判断标准和依据。第三句展开关键的执行步骤细节。第四句总结行动建议并给出提醒。';
    let sceneHtmlQaInput = null;
    const sceneHtmlRenderCalls = [];
    let sceneHtmlComposeFrames = [];
    const sceneHtmlSpec = {
      title: 'scene_html 连续性',
      aspect_ratio: '16:9',
      scenes: [
        {
          id: 'scene_intro',
          kind: 'text',
          duration_sec: 4,
          narration_text: '开场旁白。',
          captions: fullSceneCaption('scene_intro', '开场旁白。', 4),
          visual_text: { headline: '开场', keywords: [], cards: [] },
        },
        {
          id: 'scene_long',
          kind: 'text',
          speech_duration_sec: 18,
          narration_text: sceneHtmlNarration,
          captions: fullSceneCaption('scene_long', sceneHtmlNarration, 18),
          visual_text: { headline: '长场景', keywords: ['要点'], cards: [] },
        },
      ],
    };
    const sceneHtmlResult = await workflow.generateHtmlVideo({
      workflowId: '202606170000000030_scene_html',
      runId: 'run_scene_html',
      rootDir,
      sceneSpec: sceneHtmlSpec,
      creativeContext: buildCreativeContext({ input: { raw_text: 'scene_html 连续性' } }),
      target: { generateAudio: false, generateCaptions: true },
      skipValidation: true,
      services: {
        aiImageModel: { isConfigured: async () => false },
        aiTextModel: {
          callTextModel: async request => {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: 'scene_html 连续性',
                  nodes: sceneHtmlSpec.scenes.map(scene => ({
                    id: scene.id,
                    kind: scene.kind,
                    label: scene.visual_text.headline,
                    durationSec: scene.duration_sec || scene.speech_duration_sec,
                    text: scene.narration_text,
                  })),
                  edges: [{ from: 'scene_intro', to: 'scene_long', kind: 'sequence' }],
                }),
              };
            }
            const frameId = request.audit?.frame_id || 'scene:scene_intro';
            return {
              success: true,
              text: `<!doctype html><html><body><main data-frame-id="${frameId}"><h1 data-text-key="headline">连续场景</h1><p data-text-key="subtitle">支撑短句</p><section data-text-key="body">要点</section><div data-mp-overlay="key_marker" data-mp-beat-scope="scene_long_b1">重点</div></main></body></html>`,
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
        frameRenderer: {
          renderFrame: async (frame, options) => {
            sceneHtmlRenderCalls.push({ id: frame.id, outputPath: options.outputPath });
            await writeFile(options.outputPath, `frame:${frame.id}`);
            return {
              success: true,
              frame_id: frame.id,
              output_path: options.outputPath,
              diagnostics: [],
            };
          },
        },
        ffmpegComposer: {
          concatFramesWithFfmpeg: async (frames, outputPath) => {
            sceneHtmlComposeFrames = frames.map(frame => ({ ...frame }));
            await writeFile(outputPath, 'mp4');
            return { success: true, output_path: outputPath, strategy: 'stub' };
          },
          concatAudioWithFfmpeg: async () => ({ success: true, skipped: true }),
          muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
        },
        visualQaService: {
          // Task 7.2：模拟 asset_first QA 报告——success 通过但携带 warnings（非阻断观测通道）
          inspectRenderedVideo: async input => {
            sceneHtmlQaInput = input;
            return {
              success: true,
              issues: [],
              metrics: {},
              warnings: [{
                code: 'asset_first_low_information',
                severity: 'warning',
                message: '无图 beat 画面元素过少。',
                details: { beat_id: 'scene_long_b1' },
              }],
            };
          },
        },
      },
    });
    assert.equal(sceneHtmlResult.success, true, JSON.stringify({
      message: sceneHtmlResult.message,
      diagnostics: sceneHtmlResult.html_video_diagnostics,
    }, null, 2));
    const sceneHtmlProject = JSON.parse(
      await fs.readFile(path.join(sceneHtmlResult.html_video_project_path, 'project.json'), 'utf8'),
    );
    assert.equal(sceneHtmlProject.continuity_mode, 'scene_html');
    assert.equal(sceneHtmlProject.frames.length, 2, '两个 scene 应归并成两帧（不按 beat 展开）');
    assert.deepEqual(sceneHtmlRenderCalls.map(call => call.id).sort(), ['scene:scene_intro', 'scene:scene_long']);
    assert.equal(new Set(sceneHtmlRenderCalls.map(call => call.outputPath)).size, 2, '两个 Scene 必须各自生成唯一 MP4 路径');
    assert.equal(sceneHtmlComposeFrames.length, 2, '合成器只能收到两个 Scene MP4，不得收到 Beat MP4');
    assert.deepEqual(sceneHtmlComposeFrames.map(frame => frame.frame_id).sort(), ['scene:scene_intro', 'scene:scene_long']);
    assert.equal(new Set(sceneHtmlComposeFrames.map(frame => frame.path)).size, 2, '合成器输入 MP4 路径必须按 Scene 独立');
    // R1/R2 端到端：最终 project.json 的 scene frame 必须有非空 html_path 且 checkpoint 同键
    for (const frame of sceneHtmlProject.frames) {
      assert.ok(frame.id.startsWith('scene:'), `scene_html 模式下 frames 全部为 scene 条目：${frame.id}`);
      assert.ok(String(frame.html_path || '').trim().length > 0, `scene frame ${frame.id} 必须携带 frameHtmlPhase 回写的 html_path`);
      assert.ok(Array.isArray(frame.metadata.beat_windows) && frame.metadata.beat_windows.length >= 1);
      assert.equal(frame.beat_id ?? null, null, 'scene frame 不设 beat_id');
    }
    assert.equal(new Set(sceneHtmlProject.frames.map(frame => frame.html_path)).size, 2, '两个 Scene 必须各自生成唯一 HTML 路径');
    const sceneLongFrame = sceneHtmlProject.frames.find(frame => frame.scene_id === 'scene_long');
    assert.ok(sceneLongFrame.metadata.beat_windows.length >= 2, '长场景应携带多个 beat 窗口');
    assert.ok(Math.abs(sceneHtmlProject.frames.reduce((total, frame) => total + frame.duration_sec, 0) - 22) < 1e-6);
    // 场景 HTML 写盘产物：包含时间线脚本（按时间切 body[data-mp-beat]）
    const sceneLongHtml = await fs.readFile(
      path.join(sceneHtmlResult.html_video_project_path, sceneLongFrame.html_path),
      'utf8',
    );
    assert.ok(sceneLongHtml.includes('__MP_BEATS__'), '场景 HTML 必须注入 beat 时间线脚本');
    // 字幕整轨：scene frame 的字幕覆盖整场景相对时间（不做 beat 切窗）
    assert.ok(Array.isArray(sceneLongFrame.captions) && sceneLongFrame.captions.length >= 1);
    const sceneLongCaptionMaxEnd = Math.max(...sceneLongFrame.captions.map(caption => Number(caption.end) || 0));
    assert.ok(sceneLongCaptionMaxEnd > 8, 'scene frame 字幕应为整场景时间轨，而非首个 beat 窗口');
    // checkpoint 键位（R2）：frame_html 与 render 的已完成条目必须都按 scene:<id> 键控
    const sceneHtmlStages = sceneHtmlProject.generation_checkpoint?.stages || {};
    const frameHtmlEntries = Object.entries(sceneHtmlStages.frame_html?.frames || {})
      .filter(([, entry]) => entry?.status === 'done');
    assert.ok(frameHtmlEntries.length >= 2, 'frame_html checkpoint 应有 scene 级完成条目');
    assert.ok(frameHtmlEntries.every(([key]) => key.startsWith('scene:')),
      `frame_html checkpoint 完成条目必须按 scene:<id> 键控：${JSON.stringify(Object.keys(sceneHtmlStages.frame_html?.frames || {}))}`);
    const renderEntries = Object.entries(sceneHtmlStages.render?.frames || {})
      .filter(([, entry]) => entry?.status === 'done');
    assert.ok(renderEntries.length >= 2, 'render checkpoint 应有 scene 级完成条目');
    assert.ok(renderEntries.every(([key]) => key.startsWith('scene:')),
      `render checkpoint 完成条目必须按 scene:<id> 键控（R2）：${JSON.stringify(Object.keys(sceneHtmlStages.render?.frames || {}))}`);

    // ===== Task 7.2：QA warnings 通道双向断言 =====
    // 正向：工程只有 warnings（无 blocking issue）时，success 不变、不触发 visual_qa_warning 诊断
    assert.strictEqual('visualStrategy' in sceneHtmlQaInput, false,
      '策略概念已删除，workflow 不得再向 inspectRenderedVideo 传 visualStrategy');
    assert.strictEqual(sceneHtmlResult.visual_report.success, true, 'warnings 不得改变 visual_report.success');
    assert.strictEqual(sceneHtmlResult.visual_report.warnings.length, 1, 'warnings 数组应原样透传到 visual_report');
    assert.ok(!sceneHtmlResult.html_video_diagnostics.some(d => d.code === 'visual_qa_warning'),
      'warnings 不得触发 visual_qa_warning 诊断');
    assert.equal(sceneHtmlStages.visual_inspect.status, 'done', 'warnings 不得改变 visual_inspect checkpoint 状态');
    assert.equal(sceneHtmlStages.visual_inspect.diagnostic_code, '', 'warnings 不得写入 checkpoint 诊断码');
    // 反向（blocking issue 仍记 visual_qa_warning）原由死模式用例覆盖，随死模式下线，待 per_scene 用例补齐。
  }

  // ===== C-04：preferred / optional / legacy 被计划选中后由系统确定性注入，且不阻断完整生成流程 =====
  {
    const assetSourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-non-required-assets-'));
    const preferredPath = path.join(assetSourceDir, 'preferred-generated.png');
    const optionalPath = path.join(assetSourceDir, 'optional-source.png');
    const legacyPath = path.join(assetSourceDir, 'legacy-generated.png');
    await Promise.all([
      writeFile(preferredPath, 'preferred-png'),
      writeFile(optionalPath, 'optional-png'),
      writeFile(legacyPath, 'legacy-png'),
    ]);
    const nonRequiredNarration = '非必用素材被计划选中后应由系统注入画面。';
    const nonRequiredSpec = {
      title: '非必用素材不阻断',
      aspect_ratio: '16:9',
      scenes: ['preferred', 'optional', 'legacy'].map((kind, index) => {
        const sceneId = `scene_0${index + 1}`;
        return {
          id: sceneId,
          kind: 'text',
          duration_sec: 4,
          narration_text: `${nonRequiredNarration}${kind}`,
          captions: fullSceneCaption(sceneId, `${nonRequiredNarration}${kind}`, 4),
          visual_text: { headline: `正常生成 ${kind}`, keywords: [], cards: [] },
        };
      }),
    };
    let composeCalls = 0;
    const nonRequiredResult = await workflow.generateHtmlVideo({
      workflowId: 'wf-non-required-assets',
      runId: 'run-non-required-assets',
      rootDir,
      sceneSpec: nonRequiredSpec,
      creativeContext: {
        input: { raw_text: '非必用素材不阻断' },
        continuity_mode: 'scene_html',
        asset_context: {
          assets: [
            {
              id: 'preferred_generated',
              type: 'image',
              media_type: 'image',
              source: 'generated',
              origin: 'ai_generated',
              origin_detail: 'scene_main_visual',
              provider: 'openai',
              requirement: 'preferred',
              evidence_class: 'synthetic',
              status: 'ready',
              path: 'assets/preferred-generated.png',
              local_path: preferredPath,
            },
            {
              id: 'optional_source',
              type: 'image',
              media_type: 'image',
              source: 'article',
              origin: 'source_extract',
              origin_detail: 'github_readme',
              provider: 'github',
              requirement: 'optional',
              evidence_class: 'direct_source',
              status: 'ready',
              path: 'assets/optional-source.png',
              local_path: optionalPath,
            },
            {
              id: 'legacy_generated',
              type: 'image',
              source: 'generated',
              path: 'assets/legacy-generated.png',
              local_path: legacyPath,
            },
          ],
        },
      },
      target: { generateAudio: false, generateCaptions: true },
      skipValidation: true,
      services: {
        aiImageModel: { isConfigured: async () => false },
        aiTextModel: {
          callTextModel: async request => {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.includes('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: '非必用素材不阻断',
                  nodes: [
                    { id: 'scene_01', kind: 'text', label: '正常生成 preferred', durationSec: 4, text: `${nonRequiredNarration}preferred`, asset_refs: [{ asset_id: 'preferred_generated', usage: 'subject' }] },
                    { id: 'scene_02', kind: 'text', label: '正常生成 optional', durationSec: 4, text: `${nonRequiredNarration}optional`, asset_refs: [{ asset_id: 'optional_source', usage: 'showcase' }] },
                    { id: 'scene_03', kind: 'text', label: '正常生成 legacy', durationSec: 4, text: `${nonRequiredNarration}legacy`, asset_refs: [{ asset_id: 'legacy_generated', usage: 'background' }] },
                  ],
                  edges: [],
                }),
              };
            }
            const frameId = request.audit?.frame_id || 'scene:scene_01';
            return {
              success: true,
              text: `<!doctype html><html><body><main data-frame-id="${frameId}"><h1 data-text-key="headline">正常生成</h1><p data-text-key="subtitle">未使用非必用素材</p><section data-text-key="body">画面继续完成</section></main></body></html>`,
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
        frameRenderer: {
          renderFrame: async (frame, options) => {
            await writeFile(options.outputPath, `frame:${frame.id}`);
            return {
              success: true,
              frame_id: frame.id,
              output_path: options.outputPath,
              diagnostics: [],
            };
          },
        },
        ffmpegComposer: {
          concatFramesWithFfmpeg: async (_frames, outputPath) => {
            composeCalls += 1;
            await writeFile(outputPath, 'mp4');
            return { success: true, output_path: outputPath, strategy: 'stub' };
          },
          concatAudioWithFfmpeg: async () => ({ success: true, skipped: true }),
          muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
        },
        visualQaService: {
          inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
        },
      },
    });
    assert.equal(nonRequiredResult.success, true, JSON.stringify(nonRequiredResult.diagnostics || [], null, 2));
    assert.equal(composeCalls, 1, '非必用素材未引用时仍应正常合成');
    assert.ok(!nonRequiredResult.diagnostics?.some(item => item.code === 'required_visual_asset_missing'));
    assert.deepEqual(
      nonRequiredResult.project.content_graph.nodes.map(node => node.asset_refs?.[0]?.asset_id),
      ['preferred_generated', 'optional_source', 'legacy_generated'],
      '非 required refs 必须由正常 content graph 产出并走过真实帧生成链',
    );
    assert.deepEqual(nonRequiredResult.project.asset_usage_report.required_asset_ids, []);
    assert.deepEqual(nonRequiredResult.project.asset_usage_report.missing_required_asset_ids, []);
    assert.deepEqual(nonRequiredResult.project.asset_usage_report.unused_asset_ids, []);
    for (const node of nonRequiredResult.project.content_graph.nodes) {
      const frameHtml = await fs.readFile(path.join(nonRequiredResult.project_dir, node.html_path), 'utf8');
      assert.equal((frameHtml.match(/data-hv-shot="true"/g) || []).length, 1);
      assert.equal((frameHtml.match(/<img data-shot-layer=/g) || []).length, 2);
    }
    assert.equal(
      nonRequiredResult.project.asset_usage_report.assets.find(asset => asset.asset_id === 'preferred_generated').requirement,
      'preferred',
    );
    assert.equal(nonRequiredResult.project.generation_checkpoint?.stages?.compose?.status, 'done');
    assert.ok(Object.values(nonRequiredResult.project.generation_checkpoint?.stages?.render?.frames || {})
      .some(entry => entry?.status === 'done'));
    const persistedNonRequired = JSON.parse(await fs.readFile(
      path.join(nonRequiredResult.project_dir, 'project.json'),
      'utf8',
    ));
    assert.deepEqual(persistedNonRequired.asset_usage_report?.required_asset_ids, []);
    assert.deepEqual(persistedNonRequired.asset_usage_report?.missing_required_asset_ids, []);
    assert.equal(persistedNonRequired.generation_checkpoint?.stages?.compose?.status, 'done');
  }

  // ===== 回归：必用生成素材未进画面必须阻断导出（required_visual_asset_missing）=====
  // 谱系：e8000f4 展平策略概念时，阻断分支残留未定义变量 assetFirstBlocking，
  // missingRequiredAssets 命中时抛 ReferenceError、被上游吞成通用 html_video_error。
  // 语义：asset_context 带 requirement='required' 的 AI 生成资产（其 generation.scene_id 已不在当前
  // scene_spec，帧级 asset_refs 校验兜不住），帧 HTML 又未引用该素材路径 → 工作流终检必须
  // 返回结构化阻断失败，且阻断前工程已落盘。
  {
    const missingAssetSourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-missing-asset-src-'));
    const missingAssetSourcePath = path.join(missingAssetSourceDir, 'gen-hero.png');
    await fs.writeFile(missingAssetSourcePath, 'fake-png-bytes', 'utf8');
    const missingAssetNarration = '生成主视觉必须进入最终画面。';
    const missingAssetSpec = {
      title: '必用素材缺失阻断',
      aspect_ratio: '16:9',
      scenes: [{
        id: 'scene_01',
        kind: 'text',
        duration_sec: 4,
        narration_text: missingAssetNarration,
        captions: fullSceneCaption('scene_01', missingAssetNarration, 4),
        visual_text: { headline: '画面标题', keywords: [], cards: [] },
      }],
    };
    const missingAssetResult = await workflow.generateHtmlVideo({
      workflowId: 'wf-missing-required-asset',
      runId: 'run-missing-required-asset',
      rootDir,
      sceneSpec: missingAssetSpec,
      creativeContext: {
        input: { raw_text: '必用素材缺失阻断' },
        continuity_mode: 'scene_html',
        asset_context: {
          assets: [{
            id: 'gen_scene_removed',
            type: 'image',
            source: 'generated',
            requirement: 'required',
            path: 'assets/gen-hero.png',
            frame_src: '../assets/gen-hero.png',
            local_path: missingAssetSourcePath,
            alt: '生成主视觉',
            generation: { scene_id: 'scene_removed', prompt: '生成主视觉' },
          }],
        },
      },
      target: { generateAudio: false, generateCaptions: true },
      skipValidation: true,
      services: {
        aiImageModel: { isConfigured: async () => false },
        aiTextModel: {
          callTextModel: async request => {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: '必用素材缺失阻断',
                  nodes: [{ id: 'scene_01', kind: 'text', label: '画面标题', durationSec: 4, text: missingAssetNarration }],
                  edges: [],
                }),
              };
            }
            // 故意不引用 assets/gen-hero.png：必用素材缺引用
            const frameId = request.audit?.frame_id || 'scene:scene_01';
            return {
              success: true,
              text: `<!doctype html><html><body><main data-frame-id="${frameId}"><h1 data-text-key="headline">画面标题</h1><p data-text-key="subtitle">支撑短句</p><section data-text-key="body">要点</section></main></body></html>`,
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
        frameRenderer: {
          renderFrame: async (frame, options) => {
            await writeFile(options.outputPath, `frame:${frame.id}`);
            return {
              success: true,
              frame_id: frame.id,
              output_path: options.outputPath,
              diagnostics: [],
            };
          },
        },
        ffmpegComposer: {
          concatFramesWithFfmpeg: async (frames, outputPath) => {
            await writeFile(outputPath, 'mp4');
            return { success: true, output_path: outputPath, strategy: 'stub' };
          },
          concatAudioWithFfmpeg: async () => ({ success: true, skipped: true }),
          muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
        },
        visualQaService: {
          inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
        },
      },
    });
    assert.strictEqual(missingAssetResult.success, false, '必用素材缺引用时导出必须失败');
    assert.strictEqual(missingAssetResult.code, 'required_visual_asset_missing');
    assert.ok(missingAssetResult.message.includes('必用视觉素材'),
      `失败信息必须指明必用视觉素材缺失：${missingAssetResult.message}`);
    const missingAssetDiag = (missingAssetResult.diagnostics || [])
      .find(item => item.code === 'required_visual_asset_missing');
    assert.ok(missingAssetDiag, '诊断必须携带 required_visual_asset_missing 结构化明细');
    assert.ok(Array.isArray(missingAssetDiag.details?.missing_required_asset_ids)
      && missingAssetDiag.details.missing_required_asset_ids.length > 0);
    assert.deepEqual(missingAssetDiag.details.missing_required_asset_ids, ['gen_scene_removed']);
    assert.strictEqual(missingAssetDiag.retryable, true, '阻断诊断必须标记可重试');
    assert.strictEqual(missingAssetDiag.repair_action, 'retry_frame_html');
    assert.ok(missingAssetResult.project, '阻断返回必须携带已落盘工程');
    // 阻断前 saveProject：落盘 project.json 必须已带 asset_usage_report 缺失明细
    const blockedProjectJson = JSON.parse(await fs.readFile(
      path.join(missingAssetResult.project_dir, 'project.json'),
      'utf8',
    ));
    assert.deepEqual(blockedProjectJson.asset_usage_report?.missing_required_asset_ids, ['gen_scene_removed'],
      '阻断前必须把带缺失明细的工程落盘');
  }

  // ===== 回归：复用/编辑后的最终 HTML 引用未登记图片必须阻断 =====
  {
    const finalGateNarration = '最终工程必须拒绝绕过统一资产登记的图片。';
    let renderCalls = 0;
    let composeCalls = 0;
    let visualQaCalls = 0;
    const finalGateResult = await workflow.generateHtmlVideo({
      workflowId: 'wf-unregistered-final-asset',
      runId: 'run-unregistered-final-asset',
      rootDir,
      sceneSpec: {
        title: '最终图片注册门',
        aspect_ratio: '16:9',
        scenes: [{
          id: 'scene_01',
          kind: 'text',
          duration_sec: 4,
          narration_text: finalGateNarration,
          captions: fullSceneCaption('scene_01', finalGateNarration, 4),
          visual_text: { headline: '最终图片注册门', keywords: [], cards: [] },
        }],
      },
      creativeContext: {
        input: { raw_text: '最终图片注册门' },
        continuity_mode: 'scene_html',
        asset_context: { assets: [] },
      },
      target: { generateAudio: false, generateCaptions: true },
      skipValidation: true,
      services: {
        aiImageModel: { isConfigured: async () => false },
        aiTextModel: {
          callTextModel: async request => {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: '最终图片注册门',
                  nodes: [{ id: 'scene_01', kind: 'text', label: '最终图片注册门', durationSec: 4, text: finalGateNarration }],
                  edges: [],
                }),
              };
            }
            return {
              success: true,
              text: '<!doctype html><html><body><main data-frame-id="scene:scene_01"><h1 data-text-key="headline">最终图片注册门</h1><section data-text-key="body">正常初稿</section></main></body></html>',
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
        materializer: {
          materializeProject: async ({ project, projectDir }) => {
            const frame = project.frames[0];
            await writeFile(path.join(projectDir, frame.html_path), '<!doctype html><html><body><img src=../assets/edited-unregistered.png><video poster="https://example.com/poster.png"></video><div style="background-image:url(data:image/png;base64,AAAA)"></div></body></html>');
            return { success: true, project, diagnostics: [] };
          },
        },
        frameRenderer: {
          renderFrame: async (frame, options) => {
            renderCalls += 1;
            const violations = [
              { source: 'route', kind: 'unregistered_local_image', target: 'assets/edited-unregistered.png', frame_id: frame.id },
              { source: 'route', kind: 'remote_or_disallowed_scheme', target: 'https://example.com/poster.png', frame_id: frame.id },
              { source: 'csp', kind: 'csp_violation', target: 'data:', frame_id: frame.id },
            ];
            return {
              success: false,
              code: 'runtime_visual_asset_policy_violation',
              frame_id: frame.id,
              message: '运行时素材门禁阻断。',
              diagnostics: [{ code: 'runtime_visual_asset_policy_violation', frame_id: frame.id, sub_stage: 'frame_html', retryable: true, repair_action: 'retry_frame_html', details: { violations } }],
            };
          },
        },
        ffmpegComposer: {
          concatFramesWithFfmpeg: async (_frames, outputPath) => {
            composeCalls += 1;
            await writeFile(outputPath, 'mp4');
            return { success: true, output_path: outputPath, strategy: 'stub' };
          },
          concatAudioWithFfmpeg: async () => ({ success: true, skipped: true }),
          muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
        },
        visualQaService: {
          inspectRenderedVideo: async () => {
            visualQaCalls += 1;
            return { success: true, issues: [], metrics: {} };
          },
        },
      },
    });
    assert.equal(finalGateResult.success, false, '最终 HTML 出现未登记图片时必须阻断');
    assert.equal(finalGateResult.code, 'runtime_visual_asset_policy_violation');
    const diagnostic = finalGateResult.diagnostics?.find(item => item.code === 'runtime_visual_asset_policy_violation');
    assert.ok(diagnostic, '必须返回未登记视觉资产结构化诊断');
    assert.equal(diagnostic.retryable, true);
    assert.equal(diagnostic.repair_action, 'retry_frame_html');
    assert.equal(diagnostic.details?.violations.length, 3);
    assert.equal(finalGateResult.project.asset_usage_report?.runtime_policy_violations[0].frame_id, 'scene:scene_01');
    assert.equal(renderCalls, 1, '生成链必须进入真实 renderer runtime gate');
    assert.equal(composeCalls, 0, '生成链资产预检失败后不得调用 compositor');
    assert.equal(visualQaCalls, 0, '生成链资产预检失败后不得调用 visual QA');
  }

  for (const method of ['renderOrExport', 'rerender']) {
    const directProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), `html-video-${method}-asset-gate-`));
    await writeFile(path.join(directProjectDir, 'frames', 'scene_01.html'), '<img src = ../assets/direct-unregistered.png>');
    let renderCalls = 0;
    let composeCalls = 0;
    const directResult = await workflow[method]({
      projectDir: directProjectDir,
      project: {
        project_id: `${method}-asset-gate`,
        output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 2 },
        frames: [{ id: 'scene_01', scene_id: 'scene_01', html_path: 'frames/scene_01.html', duration_sec: 2 }],
        timeline: { tracks: [{ id: 'main', type: 'video', items: [{ frame_id: 'scene_01', duration_sec: 2 }] }] },
        audio: { status: 'skipped', reason: 'disabled_by_settings' },
        assets: [],
      },
      services: {
        materializer: { materializeProject: async ({ project }) => ({ project, diagnostics: [] }) },
        frameRenderer: { renderFrame: async frame => {
          renderCalls += 1;
          return {
            success: false,
            code: 'runtime_visual_asset_policy_violation',
            message: '运行时素材门禁阻断。',
            diagnostics: [{ code: 'runtime_visual_asset_policy_violation', frame_id: frame.id, details: { violations: [] } }],
          };
        } },
        ffmpegComposer: { concatFramesWithFfmpeg: async () => { composeCalls += 1; return { success: true }; } },
      },
    });
    assert.equal(directResult.code, 'runtime_visual_asset_policy_violation');
    assert.equal(renderCalls, 1, `${method} 必须进入 runtime gate`);
    assert.equal(composeCalls, 0, `${method} 预检失败后不得调用 compositor`);
    await fs.rm(directProjectDir, { recursive: true, force: true });
  }

  // ===== D-04：Scene/Shot 级 focus_cues 摄影机规划端到端 =====
  // 规则 9：planner enrich 后的 camera 必须随 visualPlan 进入 content graph 展开与持久化 project。
  {
    const d04SourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-focus-cue-src-'));
    const d04AssetPath = path.join(d04SourceDir, 'repo-hero.png');
    await fs.writeFile(d04AssetPath, 'focus-cue-image-bytes');
    const d04Region = {
      id: 'region_star_button',
      label: 'Star 按钮',
      aliases: ['GitHub Star'],
      region: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
      focus_point: { x: 0.25, y: 0.2 },
      method: 'dom',
      confidence_level: 'high',
      verification: { status: 'verified', method: 'dom_capture', evidence: '测试用固定证据。' },
      trust_level: 'A',
    };
    const d04Scene = {
      id: 'scene_01',
      kind: 'text',
      duration_sec: 4,
      narration_text: '先看这里的 Star 按钮，再看整体页面布局。',
      captions: [
        { id: 'cap_01', start: 0, end: 2, text: '先看这里的 Star 按钮' },
        { id: 'cap_02', start: 2, end: 4, text: '再看整体页面布局' },
      ],
      visual_text: { headline: '仓库页面', keywords: [], cards: [] },
    };
    const d04AssetContext = assetId => ({
      assets: [{
        id: assetId,
        type: 'image',
        media_type: 'image',
        origin: 'source_extract',
        origin_detail: 'github_readme',
        provider: 'github',
        requirement: 'preferred',
        evidence_class: 'direct_source',
        status: 'ready',
        path: 'assets/repo-hero.png',
        local_path: d04AssetPath,
        focus_regions: [d04Region],
      }],
    });
    const d04ContentGraphText = assetId => JSON.stringify({
      synopsis: '焦点提示词规划',
      nodes: [{
        id: 'scene_01',
        kind: 'text',
        label: '仓库页面',
        durationSec: 4,
        text: d04Scene.narration_text,
        asset_refs: [{ asset_id: assetId, usage: 'subject' }],
      }],
      edges: [],
    });
    const assertFocusCue = (shot, label) => {
      assert.ok(shot.camera, `${label} 必须带 camera`);
      assert.equal(shot.camera.initial_view, 'overview', label);
      assert.equal(shot.camera.focus_cues.length, 1, label);
      const cue = shot.camera.focus_cues[0];
      assert.deepEqual(cue.caption_ids, ['cap_01'], label);
      assert.equal(cue.keyword, 'Star 按钮', label);
      assert.equal(cue.region_id, 'region_star_button', label);
      assert.equal(cue.effect, 'camera_zoom', label);
      assert.equal(cue.zoom, 'auto', label);
      assert.equal(cue.return_policy, 'hold_or_next', label);
      assert.equal('start_sec' in cue, false, `${label}：cue 不写 start_sec`);
      assert.equal('end_sec' in cue, false, `${label}：cue 不写 end_sec`);
    };
    const imageSequenceShots = beats => (Array.isArray(beats) ? beats : [])
      .filter(beat => beat?.visual_base?.type === 'image_sequence')
      .flatMap(beat => beat.visual_base.shots || []);

    // (1) scene_html 分支：真实 workflow 全链路成功后，持久化 project 与展开产物都带 camera.focus_cues。
    const d04SceneHtmlResult = await workflow.generateHtmlVideo({
      workflowId: 'wf-focus-cue-scene-html',
      runId: 'run-focus-cue-scene-html',
      rootDir,
      sceneSpec: { title: '焦点提示词规划', aspect_ratio: '16:9', scenes: [d04Scene] },
      creativeContext: {
        input: { raw_text: '焦点提示词规划' },
        continuity_mode: 'scene_html',
        asset_context: d04AssetContext('repo_hero'),
      },
      target: { generateAudio: false, generateCaptions: true },
      skipValidation: true,
      services: {
        aiImageModel: { isConfigured: async () => false },
        aiTextModel: {
          callTextModel: async request => {
            const prompt = request.messages.map(item => (
              typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
            )).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return { success: true, text: d04ContentGraphText('repo_hero') };
            }
            const frameId = request.audit?.frame_id || 'scene:scene_01';
            return {
              success: true,
              text: `<!doctype html><html><body><main data-frame-id="${frameId}"><h1 data-text-key="headline">仓库页面</h1><p data-text-key="subtitle">支撑短句</p><section data-text-key="body">要点</section></main></body></html>`,
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
        frameRenderer: {
          renderFrame: async (frame, options) => {
            await writeFile(options.outputPath, `frame:${frame.id}`);
            return { success: true, frame_id: frame.id, output_path: options.outputPath, diagnostics: [] };
          },
        },
        ffmpegComposer: {
          concatFramesWithFfmpeg: async (_frames, outputPath) => {
            await writeFile(outputPath, 'mp4');
            return { success: true, output_path: outputPath, strategy: 'stub' };
          },
          concatAudioWithFfmpeg: async () => ({ success: true, skipped: true }),
          muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
        },
        visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
      },
    });
    assert.equal(d04SceneHtmlResult.success, true, JSON.stringify(d04SceneHtmlResult.diagnostics || [], null, 2));
    const d04Persisted = JSON.parse(await fs.readFile(
      path.join(d04SceneHtmlResult.html_video_project_path, 'project.json'),
      'utf8',
    ));
    const d04PlanShots = imageSequenceShots(d04Persisted.visual_plan?.beats);
    assert.ok(d04PlanShots.length >= 1, '持久化 visual_plan 必须包含 image_sequence shot');
    d04PlanShots.forEach(shot => assertFocusCue(shot, '持久化 visual_plan shot'));
    const d04SceneNode = d04Persisted.content_graph.nodes.find(node => node.id === 'scene:scene_01');
    const d04SceneNodeShots = imageSequenceShots(d04SceneNode?.metadata?.visual_beats);
    assert.ok(d04SceneNodeShots.length >= 1, 'scene_html 展开节点必须携带 image_sequence shot');
    d04SceneNodeShots.forEach(shot => assertFocusCue(shot, 'scene_html 展开产物 shot'));
    const d04Frame = d04Persisted.frames.find(frame => frame.scene_id === 'scene_01');
    const d04Html = await fs.readFile(path.join(d04SceneHtmlResult.html_video_project_path, d04Frame.html_path), 'utf8');
    assert.match(d04Html, /data-camera-cues=/, 'scene_html 最终 HTML 必须携带摄影机 cue 数据');
    assert.match(d04Html, /computeCameraTransform/, 'scene_html 最终 HTML 必须注入摄影机运行时');

    // (2) beat 分支：expandContentGraphToVisualBeats 展开的节点 metadata.visual_beat 同样带 camera
    //（Frame HTML 故意失败，验证 camera 展开与持久化发生在帧生成之前）。
    const d04BeatResult = await workflow.generateHtmlVideo({
      workflowId: 'wf-focus-cue-beat',
      runId: 'run-focus-cue-beat',
      rootDir,
      sceneSpec: { title: '焦点提示词规划 beat', aspect_ratio: '16:9', scenes: [d04Scene] },
      creativeContext: {
        input: { raw_text: '焦点提示词规划 beat' },
        asset_context: d04AssetContext('repo_hero_beat'),
      },
      target: { generateAudio: false, generateCaptions: true },
      skipValidation: true,
      services: {
        aiImageModel: { isConfigured: async () => false },
        aiTextModel: {
          callTextModel: async request => {
            const prompt = request.messages.map(item => (
              typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
            )).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return { success: true, text: d04ContentGraphText('repo_hero_beat') };
            }
            return { success: true, text: 'Frame HTML 故意失败' };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      },
    });
    assert.equal(d04BeatResult.success, false, 'beat 分支用例：Frame HTML 故意失败');
    const d04BeatPersisted = await projectStore.loadProject(d04BeatResult.project_dir);
    const d04BeatPlanShots = imageSequenceShots(d04BeatPersisted.visual_plan?.beats);
    assert.ok(d04BeatPlanShots.length >= 1, 'beat 分支持久化 visual_plan 必须包含 image_sequence shot');
    d04BeatPlanShots.forEach(shot => assertFocusCue(shot, 'beat 分支持久化 visual_plan shot'));
    const d04BeatNodeShots = imageSequenceShots(
      d04BeatPersisted.content_graph.nodes.map(node => node.metadata?.visual_beat),
    );
    assert.ok(d04BeatNodeShots.length >= 1, 'beat 展开节点必须携带 image_sequence shot');
    d04BeatNodeShots.forEach(shot => assertFocusCue(shot, 'beat 展开产物 shot'));
  }

  console.log('html-video workflow tests passed');
})();
