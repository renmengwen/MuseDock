const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const facade = require('../server/services/creative-video/workflowFacade');
const hyperframesTemplateRenderer = require('../server/services/creative-video/hyperframesTemplateRenderer');

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-facade-test-'));
  const outputMp4 = path.join(tmpDir, 'output.mp4');
  fs.writeFileSync(outputMp4, Buffer.alloc(100));

  const previousProductionForLegacyTests = process.env.HTML_VIDEO_PRODUCTION_ENABLED;
  process.env.HTML_VIDEO_PRODUCTION_ENABLED = 'false';

  const calls = [];
  const serviceOrder = [];
  let renderAudioManifest = null;
  const result = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000001',
    runId: 'run_001',
    creativeContext: { input: { raw_text: '测试主题' } },
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          calls.push(messages.map(message => message.content).join('\n'));
          if (calls.length === 1) {
            return { success: true, text: JSON.stringify({ scene_spec: { title: '测试', aspect_ratio: '16:9', scenes: [{ id: 'scene_01', duration: 8, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: ['卡片'] } }] } }) };
          }
          return { success: true, text: JSON.stringify({ frame_specs: [{ id: 'frame_01_01', scene_id: 'scene_01', start: 0, duration: 8, kind: 'text', template: 'hero_title', layout: 'center_stack', background: 'dark_gradient', motion: 'fade_up', text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }], visual_layers: [{ id: 'accent', type: 'glow_panel', variant: 'cyan_pink' }] }] }) };
        },
      },
      projectWriter: async files => {
        serviceOrder.push('projectWriter');
        return { success: true, project_dir: tmpDir, files: Object.keys(files) };
      },
      checker: async () => {
        serviceOrder.push('checker');
        return { success: true, message: '校验通过' };
      },
      ttsService: {
        synthesizeSceneNarration: async () => {
          serviceOrder.push('tts');
          return { success: true, audio_manifest: { scenes: [] } };
        },
      },
      renderAdapter: {
        render: async ({ audio_manifest }) => {
          serviceOrder.push('render');
          renderAudioManifest = audio_manifest;
          return { success: true, output_path: outputMp4, diagnostics: [] };
        },
      },
      visualQaService: {
        inspectRenderedVideo: async () => {
          serviceOrder.push('visualQa');
          return { success: true, issues: [], metrics: {} };
        },
      },
    },
  });

  assert.equal(result.success, true);
  // Rich template path makes extra AI calls (template selection) that fail with legacy mock,
  // then falls back to legacy path (scene_spec + frame_specs = 2 more calls).
  // Total: 2 (rich path attempts) + 2 (legacy path) = 4
  assert.ok(calls.length >= 2, `Expected at least 2 AI calls, got ${calls.length}`);
  assert.ok(result.scene_spec);
  assert.ok(result.frame_specs);
  assert.equal(result.project_dir, tmpDir);
  assert.ok(result.files.includes('index.html'));
  assert.ok(result.audio_manifest);
  assert.deepEqual(renderAudioManifest, { scenes: [] });
  assert.equal(result.output_path, outputMp4);
  assert.ok(result.visual_report);
  assert.deepEqual(serviceOrder, ['projectWriter', 'checker', 'tts', 'render', 'visualQa']);

  const retryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-facade-retry-'));
  const retryOutput = path.join(retryDir, 'output.mp4');
  fs.writeFileSync(retryOutput, Buffer.alloc(100));

  const retryCalls = [];
  const retryResult = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000001_retry',
    runId: 'run_retry',
    creativeContext: { input: { raw_text: '测试重试' } },
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(message => message.content).join('\n');
          retryCalls.push(prompt);
          if (prompt.includes('不允许输出 frame_specs')) {
            return { success: true, text: JSON.stringify({ scene_spec: { title: '测试', aspect_ratio: '16:9', scenes: [{ id: 'scene_01', duration: 8, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: ['卡片'] } }] } }) };
          }
          if (!prompt.includes('上一次输出包含以下问题')) {
            return { success: true, text: '{"frame_specs":[{"id":"frame_01_01","scene_id":"scene_01","start":0,"duration":8,"kind":"text","template":"hero_title","layout":"center_stack","background":"dark_gradient","motion":"fade_up","text_layers":[{"id":"headline","role":"headline","text":"标题","emphasis":"primary"}],"visual_layers":[]}' };
          }
          return { success: true, text: JSON.stringify({ frame_specs: [{ id: 'frame_01_01', scene_id: 'scene_01', start: 0, duration: 8, kind: 'text', template: 'hero_title', layout: 'center_stack', background: 'dark_gradient', motion: 'fade_up', text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }], visual_layers: [] }] }) };
        },
      },
      projectWriter: async files => ({ success: true, project_dir: retryDir, files: Object.keys(files) }),
      checker: async () => ({ success: true, message: '校验通过' }),
      ttsService: {
        synthesizeSceneNarration: async () => ({ success: true, audio_manifest: { scenes: [] } }),
      },
      renderAdapter: {
        render: async () => ({ success: true, output_path: retryOutput, diagnostics: [] }),
      },
      visualQaService: {
        inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
      },
    },
  });
  assert.equal(retryResult.success, true);
  // Rich template path adds extra calls that fail, then legacy path does 3 calls (scene_spec + bad frame_specs + retry)
  assert.ok(retryCalls.length >= 3, `Expected at least 3 AI calls, got ${retryCalls.length}`);
  // Find the retry call in the legacy path (the one with error feedback)
  const retryCall = retryCalls.find(c => c.includes('上一次输出包含以下问题'));
  assert.ok(retryCall, 'Should have a retry call with error feedback');
  assert.ok(retryCall.includes('AI 返回不是有效 JSON'));

  const blockedOrder = [];
  const blocked = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000002',
    runId: 'run_002',
    creativeContext: { input: { raw_text: '测试主题' } },
    services: {
      aiTextModel: {
        callTextModel: async () => {
          if (blockedOrder.filter(item => item === 'ai').length === 0) {
            blockedOrder.push('ai');
            return { success: true, text: JSON.stringify({ scene_spec: { title: '测试', aspect_ratio: '16:9', scenes: [{ id: 'scene_01', duration: 8, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: ['卡片'] } }] } }) };
          }
          blockedOrder.push('ai');
          return { success: true, text: JSON.stringify({ frame_specs: [{ id: 'frame_01_01', scene_id: 'scene_01', start: 0, duration: 8, kind: 'text', template: 'hero_title', layout: 'center_stack', background: 'dark_gradient', motion: 'fade_up', text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }], visual_layers: [] }] }) };
        },
      },
      projectWriter: async files => {
        blockedOrder.push('projectWriter');
        return { success: true, project_dir: 'D:/tmp/project-bad', files: Object.keys(files) };
      },
      checker: async () => {
        blockedOrder.push('checker');
        return { success: false, message: '工程校验失败' };
      },
      ttsService: {
        synthesizeSceneNarration: async () => {
          blockedOrder.push('tts');
          return { success: true, audio_manifest: { scenes: [] } };
        },
      },
      renderAdapter: {
        render: async () => {
          blockedOrder.push('render');
          return { success: true, output_path: 'D:/tmp/output.mp4' };
        },
      },
      visualQaService: {
        inspectRenderedVideo: async () => {
          blockedOrder.push('visualQa');
          return { success: true, issues: [], metrics: {} };
        },
      },
    },
  });
  assert.equal(blocked.success, false);
  assert.equal(blockedOrder.includes('tts'), false);
  assert.equal(blockedOrder.includes('render'), false);
  assert.equal(blockedOrder.includes('visualQa'), false);

  const visualQaFailed = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000003',
    runId: 'run_003',
    creativeContext: { input: { raw_text: '测试主题' } },
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(message => message.content).join('\n');
          if (prompt.includes('不允许输出 frame_specs')) {
            return { success: true, text: JSON.stringify({ scene_spec: { title: '测试', aspect_ratio: '16:9', scenes: [{ id: 'scene_01', duration: 8, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: ['卡片'] } }] } }) };
          }
          return { success: true, text: JSON.stringify({ frame_specs: [{ id: 'frame_01_01', scene_id: 'scene_01', start: 0, duration: 8, kind: 'text', template: 'hero_title', layout: 'center_stack', background: 'dark_gradient', motion: 'fade_up', text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }], visual_layers: [{ id: 'accent', type: 'glow_panel', variant: 'cyan_pink' }] }] }) };
        },
      },
      projectWriter: async files => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-facade-visual-'));
        fs.writeFileSync(path.join(dir, 'output.mp4'), Buffer.alloc(100));
        return { success: true, project_dir: dir, files: Object.keys(files) };
      },
      checker: async () => ({ success: true, message: '校验通过' }),
      ttsService: {
        synthesizeSceneNarration: async () => ({ success: true, audio_manifest: { scenes: [] } }),
      },
      renderAdapter: {
        render: async (input) => ({ success: true, output_path: path.join(input.project_dir, 'output.mp4'), diagnostics: [] }),
      },
      visualQaService: {
        inspectRenderedVideo: async () => ({
          success: false,
          message: '视觉质检失败：画面信息量不足。',
          issues: ['低信息帧比例过高'],
          metrics: { low_information_ratio: 0.8 },
        }),
      },
    },
  });
  assert.equal(visualQaFailed.success, true);
  assert.match(visualQaFailed.message, /创意视频生成完成/);
  assert.deepEqual(visualQaFailed.visual_report.issues, ['低信息帧比例过高']);
  assert.equal(visualQaFailed.visual_report.success, false);

  if (previousProductionForLegacyTests == null) delete process.env.HTML_VIDEO_PRODUCTION_ENABLED;
  else process.env.HTML_VIDEO_PRODUCTION_ENABLED = previousProductionForLegacyTests;

  const originalAssemble = hyperframesTemplateRenderer.assembleProjectFiles;
  hyperframesTemplateRenderer.assembleProjectFiles = () => ({
    success: false,
    message: '组装器模拟失败',
    diagnostics: ['assembler_failed'],
  });
  const richAssemblyFailed = await facade.tryRichTemplate({
    model: {
      callTextModel: async ({ messages }) => {
        const prompt = messages.map(message => message.content).join('\n');
        if (prompt.includes('"template_id"')) {
          return { success: true, text: JSON.stringify({ template_id: 'glitch_title', reason: '测试', confidence: 0.8 }) };
        }
        return { success: true, text: JSON.stringify({ headline: '标题', subtitle: '副标题' }) };
      },
    },
    sceneSpec: {
      title: '测试',
      aspect_ratio: '16:9',
      scenes: [{ id: 'scene_01', duration: 6, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: [] } }],
    },
    creativeContext: {},
    target: { aspect_ratio: '16:9', duration: 6 },
  });
  hyperframesTemplateRenderer.assembleProjectFiles = originalAssemble;
  assert.equal(richAssemblyFailed.success, false);
  assert.equal(richAssemblyFailed.fallback_allowed, true);
  assert.ok(richAssemblyFailed.user_message.includes('项目组装失败'));
  assert.ok(richAssemblyFailed.diagnostics.some(item => String(item).includes('assembler_failed')));

  const previousProductionForProgress = process.env.HTML_VIDEO_PRODUCTION_ENABLED;
  process.env.HTML_VIDEO_PRODUCTION_ENABLED = 'true';
  const facadeProgressEvents = [];
  let facadeForwardedOnProgress = false;
  const htmlVideoProgressResult = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000004_progress',
    runId: 'run_progress',
    creativeContext: { input: { raw_text: '测试进度' } },
    onProgress: event => facadeProgressEvents.push(event),
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async ({ onProgress }) => {
          facadeForwardedOnProgress = typeof onProgress === 'function';
          onProgress?.({ type: 'html_video_graph_started', stage: 'project', message: '正在生成内容图...' });
          return {
            success: true,
            message: 'html-video 成片完成。',
            render_mode: 'html-video',
            html_video_project_path: tmpDir,
            project_dir: tmpDir,
            project: { frames: [] },
            files: [],
          };
        },
      },
      aiTextModel: {
        callTextModel: async () => ({
          success: true,
          text: JSON.stringify({
            scene_spec: {
              title: '测试进度',
              aspect_ratio: '9:16',
              scenes: [{ id: 'scene_01', duration: 2, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '进度', keywords: [], cards: [] } }],
            },
          }),
        }),
      },
    },
  });
  if (previousProductionForProgress == null) delete process.env.HTML_VIDEO_PRODUCTION_ENABLED;
  else process.env.HTML_VIDEO_PRODUCTION_ENABLED = previousProductionForProgress;
  assert.equal(htmlVideoProgressResult.success, true);
  assert.equal(facadeForwardedOnProgress, true);
  assert.ok(facadeProgressEvents.some(event => event.type === 'html_video_graph_started'));

  const previousProductionEnabled = process.env.HTML_VIDEO_PRODUCTION_ENABLED;
  process.env.HTML_VIDEO_PRODUCTION_ENABLED = 'false';
  let htmlVideoCalledWhenDisabled = false;
  const disabledHtmlVideo = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000004',
    runId: 'run_004',
    creativeContext: { input: { raw_text: '测试主题' } },
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async () => {
          htmlVideoCalledWhenDisabled = true;
          return { success: true };
        },
      },
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(message => message.content).join('\n');
          if (prompt.includes('不允许输出 frame_specs')) {
            return { success: true, text: JSON.stringify({ scene_spec: { title: '测试', aspect_ratio: '16:9', scenes: [{ id: 'scene_01', duration: 8, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: [] } }] } }) };
          }
          return { success: true, text: JSON.stringify({ frame_specs: [{ id: 'frame_01_01', scene_id: 'scene_01', start: 0, duration: 8, kind: 'text', template: 'hero_title', layout: 'center_stack', background: 'dark_gradient', motion: 'fade_up', text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }], visual_layers: [] }] }) };
        },
      },
      projectWriter: async files => ({ success: true, project_dir: tmpDir, files: Object.keys(files) }),
      checker: async () => ({ success: true, message: '校验通过' }),
      ttsService: { synthesizeSceneNarration: async () => ({ success: true, audio_manifest: { scenes: [] } }) },
      renderAdapter: { render: async () => ({ success: true, output_path: outputMp4, diagnostics: [] }) },
      visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
    },
  });
  if (previousProductionEnabled == null) delete process.env.HTML_VIDEO_PRODUCTION_ENABLED;
  else process.env.HTML_VIDEO_PRODUCTION_ENABLED = previousProductionEnabled;
  assert.equal(disabledHtmlVideo.success, true);
  assert.equal(htmlVideoCalledWhenDisabled, false);

  const previousFallbackEnabled = process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED;
  process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED = 'false';
  let legacyProjectWriterCalledWhenFallbackDisabled = false;
  const blockedFallback = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000005',
    runId: 'run_005',
    creativeContext: { input: { raw_text: '测试主题' } },
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async () => ({
          success: false,
          message: 'html-video 模拟失败。',
          fallback_allowed: true,
          html_video_diagnostics: [{ code: 'template_missing', stage: 'template', user_message: '没有可用模板。', details: {}, fallback_allowed: true }],
        }),
      },
      aiTextModel: {
        callTextModel: async () => ({ success: true, text: JSON.stringify({ scene_spec: { title: '测试', aspect_ratio: '16:9', scenes: [{ id: 'scene_01', duration: 8, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: [] } }] } }) }),
      },
      projectWriter: async () => {
        legacyProjectWriterCalledWhenFallbackDisabled = true;
        return { success: true, project_dir: tmpDir, files: [] };
      },
    },
  });
  if (previousFallbackEnabled == null) delete process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED;
  else process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED = previousFallbackEnabled;
  assert.equal(blockedFallback.success, false);
  assert.equal(legacyProjectWriterCalledWhenFallbackDisabled, false);

  const previousDefaultFallbackEnabled = process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED;
  delete process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED;
  let legacyProjectWriterCalledByDefault = false;
  const defaultBlockedFallback = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000006',
    runId: 'run_006',
    creativeContext: { input: { raw_text: '测试主题' } },
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async () => ({
          success: false,
          message: 'html-video 模拟失败。',
          fallback_allowed: true,
          html_video_diagnostics: [{ code: 'render_failed', stage: 'render', user_message: '首帧渲染失败。', details: {}, fallback_allowed: true }],
        }),
      },
      aiTextModel: {
        callTextModel: async () => ({ success: true, text: JSON.stringify({ scene_spec: { title: '测试', aspect_ratio: '16:9', scenes: [{ id: 'scene_01', duration: 8, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: [] } }] } }) }),
      },
      projectWriter: async () => {
        legacyProjectWriterCalledByDefault = true;
        return { success: true, project_dir: tmpDir, files: [] };
      },
    },
  });
  if (previousDefaultFallbackEnabled == null) delete process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED;
  else process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED = previousDefaultFallbackEnabled;
  assert.equal(defaultBlockedFallback.success, false);
  assert.equal(legacyProjectWriterCalledByDefault, false);
  assert.equal(defaultBlockedFallback.render_mode, 'html-video');
  assert.ok(defaultBlockedFallback.legacy_fallback_reason);
  assert.ok(defaultBlockedFallback.html_video_diagnostics.some(item => item.user_message === '首帧渲染失败。'));

  const previousExplicitFallbackEnabled = process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED;
  process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED = 'true';
  let explicitFallbackProjectWriterCalled = false;
  const explicitFallback = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000007',
    runId: 'run_007',
    creativeContext: { input: { raw_text: '测试主题' } },
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async () => ({
          success: false,
          message: 'html-video 模拟失败。',
          fallback_allowed: true,
          html_video_diagnostics: [{ code: 'render_failed', stage: 'render', user_message: '首帧渲染失败。', details: {}, fallback_allowed: true }],
        }),
      },
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(message => message.content).join('\n');
          if (prompt.includes('不允许输出 frame_specs')) {
            return { success: true, text: JSON.stringify({ scene_spec: { title: '测试', aspect_ratio: '16:9', scenes: [{ id: 'scene_01', duration: 8, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: [] } }] } }) };
          }
          return { success: true, text: JSON.stringify({ frame_specs: [{ id: 'frame_01_01', scene_id: 'scene_01', start: 0, duration: 8, kind: 'text', template: 'hero_title', layout: 'center_stack', background: 'dark_gradient', motion: 'fade_up', text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }], visual_layers: [] }] }) };
        },
      },
      projectWriter: async files => {
        explicitFallbackProjectWriterCalled = true;
        return { success: true, project_dir: tmpDir, files: Object.keys(files) };
      },
      checker: async () => ({ success: true, message: '校验通过' }),
      ttsService: { synthesizeSceneNarration: async () => ({ success: true, audio_manifest: { scenes: [] } }) },
      renderAdapter: { render: async () => ({ success: true, output_path: outputMp4, diagnostics: [] }) },
      visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
    },
  });
  if (previousExplicitFallbackEnabled == null) delete process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED;
  else process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED = previousExplicitFallbackEnabled;
  assert.equal(explicitFallback.success, true);
  assert.equal(explicitFallbackProjectWriterCalled, true);
  assert.equal(explicitFallback.render_mode, 'legacy');
  assert.ok(explicitFallback.legacy_fallback_reason);
  assert.match(explicitFallback.message, /html-video 生成失败，已按配置回退到 Legacy 模式。/);

  console.log('creative video workflow facade tests passed');
})();
