const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const aiImageModel = require('../server/services/ai/aiImageModel');

// 测试隔离：生图 phase 的前置检查默认读全局模型配置，本机若配置了 image 模型会让生图链路
// 混入这些集成测试（多一次 planner 的 text 调用，打乱 mock 计数）。统一按未配置处理。
aiImageModel.isConfigured = async () => false;

const facade = require('../server/services/creative-video/workflowFacade');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function createTemplate(rootDir, { id, name, width, height }) {
  const dir = path.join(rootDir, id);
  await writeFile(path.join(dir, 'template.html-video.yaml'), [
    `id: ${id}`,
    `name: ${name}`,
    'engine: hyperframes',
    'source_entry: index.html',
    'output:',
    '  resolution:',
    `    width: ${width}`,
    `    height: ${height}`,
    '  fps: 24',
    '  duration: 6',
    'inputs:',
    '  schema:',
    '    type: object',
    '    required: [headline]',
    '    properties:',
    '      headline: { type: string }',
    'license:',
    '  commercial_use: true',
    '',
  ].join('\n'));
  await writeFile(path.join(dir, 'index.html'), '<html><body>{{headline}}</body></html>');
}

async function createRegistry() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-template-pref-'));
  const templateRoot = path.join(rootDir, 'templates');
  await createTemplate(templateRoot, {
    id: 'vertical_template',
    name: '竖屏模板',
    width: 1080,
    height: 1920,
  });
  await createTemplate(templateRoot, {
    id: 'wide_template',
    name: '横屏模板',
    width: 1920,
    height: 1080,
  });
  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();
  return { rootDir, templateRegistry };
}

function sceneSpec(aspectRatio = '9:16') {
  return {
    title: '模板偏好测试',
    aspect_ratio: aspectRatio,
    target_duration_sec: 6,
    scenes: [{
      id: 'scene_01',
      order: 1,
      duration: 6,
      kind: 'text',
      narration_text: '旁白',
      captions: [{ id: 'cap_01', start: 0, end: 6, duration: 6, text: '旁白' }],
      visual_text: { headline: '首选模板标题', keywords: [], cards: [] },
    }],
  };
}

function parsePromptCompactIndex(prompt) {
  const marker = '可用模板 compactIndex：\n';
  const start = prompt.indexOf(marker);
  assert.notEqual(start, -1, 'prompt should include compactIndex');
  return JSON.parse(prompt.slice(start + marker.length));
}

function servicesForSelection({ selectTemplateId, onSelectionPrompt }) {
  return {
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        const prompt = messages.map(message => message.content).join('\n');
        if (prompt.includes('"template_id"')) {
          onSelectionPrompt?.(prompt);
          return {
            success: true,
            text: JSON.stringify({
              template_id: selectTemplateId,
              reason: '测试选择',
              confidence: 0.9,
            }),
          };
        }
        return { success: true, text: JSON.stringify({ headline: '模板字段标题' }) };
      },
    },
    environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
    frameRenderer: {
      renderFrame: async (frame, options) => {
        await writeFile(options.outputPath, 'mp4');
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
        return { success: true, output_path: outputPath };
      },
      muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
    },
    visualQaService: {
      inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
    },
  };
}

async function testUnlockedPreferredIsFirstInSelectionPrompt() {
  let promptCompactIndex = null;
  const result = await workflow.requestTemplateSelection({
    model: {
      callTextModel: async ({ messages }) => {
        const prompt = messages.map(message => message.content).join('\n');
        promptCompactIndex = parsePromptCompactIndex(prompt);
        return {
          success: true,
          text: JSON.stringify({ template_id: 'vertical_template', reason: '首选', confidence: 0.9 }),
        };
      },
    },
    compactIndex: [
      { id: 'wide_template', name: '横屏模板' },
      { id: 'vertical_template', name: '竖屏模板' },
    ],
    creativeContext: {},
    target: {},
    sceneSpec: sceneSpec('9:16'),
    preferredTemplateId: 'vertical_template',
    lockTemplate: false,
  });
  assert.equal(result.success, true);
  assert.equal(promptCompactIndex[0].id, 'vertical_template');
}

async function testUnlockedMissingPreferredFallsBackWithDiagnostic() {
  const { rootDir, templateRegistry } = await createRegistry();
  const result = await workflow.generateHtmlVideo({
    workflowId: 'wf_preferred_missing',
    runId: 'run_001',
    rootDir,
    sceneSpec: sceneSpec('9:16'),
    creativeContext: { input: { raw_text: '模板偏好测试' } },
    target: { html_video_generation_mode: 'template_inputs', aspect_ratio: '9:16' },
    templateRegistry,
    preferredTemplateId: 'missing_template',
    lockTemplate: false,
    services: servicesForSelection({ selectTemplateId: 'vertical_template' }),
  });

  assert.equal(result.success, true);
  assert.equal(result.template_id, 'vertical_template');
  assert.ok(result.diagnostics.some(item => item.code === 'preferred_template_unavailable'));
}

async function testLockedIncompatiblePreferredFails() {
  const { rootDir, templateRegistry } = await createRegistry();
  const result = await workflow.generateHtmlVideo({
    workflowId: 'wf_locked_incompatible',
    runId: 'run_001',
    rootDir,
    sceneSpec: sceneSpec('16:9'),
    creativeContext: { input: { raw_text: '模板偏好测试' } },
    target: { html_video_generation_mode: 'template_inputs', aspect_ratio: '16:9' },
    templateRegistry,
    preferredTemplateId: 'vertical_template',
    lockTemplate: true,
    services: servicesForSelection({ selectTemplateId: 'wide_template' }),
  });

  assert.equal(result.success, false);
  assert.match(result.message, /默认模板 vertical_template 不支持当前画面比例 16:9/);
  assert.ok(result.diagnostics.some(item => item.code === 'locked_template_invalid'));
}

async function testLockedValidPreferredCannotBeChangedByModel() {
  const { rootDir, templateRegistry } = await createRegistry();
  const result = await workflow.generateHtmlVideo({
    workflowId: 'wf_locked_valid',
    runId: 'run_001',
    rootDir,
    sceneSpec: sceneSpec('9:16'),
    creativeContext: { input: { raw_text: '模板偏好测试' } },
    target: { html_video_generation_mode: 'template_inputs', aspect_ratio: '9:16' },
    templateRegistry,
    preferredTemplateId: 'vertical_template',
    lockTemplate: true,
    services: servicesForSelection({ selectTemplateId: 'wide_template' }),
  });

  assert.equal(result.success, true);
  assert.equal(result.template_id, 'vertical_template');
}

async function testBackwardCompatibleCallWithoutNewParamsSucceeds() {
  const { rootDir, templateRegistry } = await createRegistry();
  const result = await workflow.generateHtmlVideo({
    workflowId: 'wf_backward_compatible',
    runId: 'run_001',
    rootDir,
    sceneSpec: sceneSpec('9:16'),
    creativeContext: { input: { raw_text: '模板偏好测试' } },
    target: { html_video_generation_mode: 'template_inputs', aspect_ratio: '9:16' },
    templateRegistry,
    services: servicesForSelection({ selectTemplateId: 'vertical_template' }),
  });

  assert.equal(result.success, true);
  assert.equal(result.template_id, 'vertical_template');
}

async function testFacadePassesTemplatePreferenceToHtmlVideoWorkflow() {
  let receivedPreferredTemplateId = null;
  let receivedLockTemplate = null;
  const result = await facade.generateCreativeVideoProject({
    workflowId: 'wf_facade_pass_through',
    runId: 'run_001',
    creativeContext: { input: { raw_text: '模板偏好测试' } },
    target: {
      preferredTemplateId: 'vertical_template',
      lockTemplate: true,
    },
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async ({ preferredTemplateId, lockTemplate }) => {
          receivedPreferredTemplateId = preferredTemplateId;
          receivedLockTemplate = lockTemplate;
          return {
            success: true,
            message: 'html-video 成片完成。',
            render_mode: 'html-video',
            project: { frames: [] },
            project_dir: 'D:/tmp/html-video-template-pref',
            html_video_project_path: 'D:/tmp/html-video-template-pref',
            files: [],
          };
        },
      },
      aiTextModel: {
        callTextModel: async () => ({
          success: true,
          text: JSON.stringify({
            scene_spec: sceneSpec('9:16'),
          }),
        }),
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(receivedPreferredTemplateId, 'vertical_template');
  assert.equal(receivedLockTemplate, true);
}

(async () => {
  await testUnlockedPreferredIsFirstInSelectionPrompt();
  await testUnlockedMissingPreferredFallsBackWithDiagnostic();
  await testLockedIncompatiblePreferredFails();
  await testLockedValidPreferredCannotBeChangedByModel();
  await testBackwardCompatibleCallWithoutNewParamsSucceeds();
  await testFacadePassesTemplatePreferenceToHtmlVideoWorkflow();
  console.log('html-video template preference tests passed');
})();
