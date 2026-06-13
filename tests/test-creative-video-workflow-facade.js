const assert = require('assert');
const facade = require('../server/services/creative-video/workflowFacade');

(async () => {
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
        return { success: true, project_dir: 'D:/tmp/project', files: Object.keys(files) };
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
          return { success: true, output_path: 'D:/tmp/output.mp4', diagnostics: [] };
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
  assert.equal(calls.length, 2);
  assert.ok(result.scene_spec);
  assert.ok(result.frame_specs);
  assert.equal(result.project_dir, 'D:/tmp/project');
  assert.ok(result.files.includes('index.html'));
  assert.ok(result.audio_manifest);
  assert.deepEqual(renderAudioManifest, { scenes: [] });
  assert.equal(result.output_path, 'D:/tmp/output.mp4');
  assert.ok(result.visual_report);
  assert.deepEqual(serviceOrder, ['projectWriter', 'checker', 'tts', 'render', 'visualQa']);

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
      projectWriter: async files => ({ success: true, project_dir: 'D:/tmp/project-visual-failed', files: Object.keys(files) }),
      checker: async () => ({ success: true, message: '校验通过' }),
      ttsService: {
        synthesizeSceneNarration: async () => ({ success: true, audio_manifest: { scenes: [{ scene_id: 'scene_01', audio_path: 'tts/scene_01.wav' }] } }),
      },
      renderAdapter: {
        render: async () => ({ success: true, output_path: 'D:/tmp/output-bad.mp4', diagnostics: [] }),
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
  assert.equal(visualQaFailed.success, false);
  assert.match(visualQaFailed.message, /视觉质检失败/);
  assert.deepEqual(visualQaFailed.issues, ['低信息帧比例过高']);
  assert.equal(visualQaFailed.visual_report.success, false);

  console.log('creative video workflow facade tests passed');
})();
