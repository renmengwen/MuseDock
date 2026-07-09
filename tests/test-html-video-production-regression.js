const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const aiImageModel = require('../server/services/ai/aiImageModel');

// 测试隔离：生图 phase 的前置检查默认读全局模型配置，本机若配置了 image 模型会让生图链路
// 混入这些集成测试（多一次 planner 的 text 调用，打乱 mock 计数）。统一按未配置处理。
aiImageModel.isConfigured = async () => false;

const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function createVerticalTemplate(rootDir) {
  const dir = path.join(rootDir, 'news_signal_vertical');
  await writeFile(path.join(dir, 'template.html-video.yaml'), [
    'id: news_signal_vertical',
    'name: 竖屏财经信号',
    'engine: hyperframes',
    'source_entry: index.html',
    'output:',
    '  resolution:',
    '    width: 1080',
    '    height: 1920',
    '  fps: 24',
    '  duration: 6',
    'inputs:',
    '  schema:',
    '    type: object',
    '    required: [headline]',
    '    properties:',
    '      headline: { type: string }',
    '      section_no: { type: string }',
    '      bullets: { type: array }',
    '      metric: { type: string }',
    'license:',
    '  commercial_use: true',
    '',
  ].join('\n'));
  await writeFile(path.join(dir, 'index.html'), '<html><body>{{section_no}} {{headline}}</body></html>');
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-regression-'));
  const templateRoot = path.join(rootDir, 'templates');
  await createVerticalTemplate(templateRoot);
  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();

  const sceneSpec = {
    title: 'SpaceX 600 亿美元收购 Cursor 母公司',
    aspect_ratio: '9:16',
    target_duration_sec: 20,
    scenes: [
      {
        id: 'scene_01',
        order: 1,
        duration: 8,
        kind: 'data',
        narration_text: '第一段',
        captions: [{ id: 'scene_01_caption_01', start: 0, end: 8, duration: 8, text: '第一段' }],
        visual_text: {
          headline: '600 亿美元全股票收购',
          keywords: ['$60B', 'SpaceX'],
          cards: ['SpaceX 收购 Cursor 母公司', '全股票交易'],
        },
      },
      {
        id: 'scene_02',
        order: 2,
        duration: 12,
        kind: 'data',
        narration_text: '第二段',
        captions: [{ id: 'scene_02_caption_01', start: 0, end: 12, duration: 12, text: '第二段' }],
        visual_text: {
          headline: '第三季度完成，分手费高昂',
          keywords: ['$1.5B', '$8.5B'],
          cards: ['15 亿美元现金', '85 亿美元算力资源'],
        },
      },
    ],
  };

  const result = await workflow.generateHtmlVideo({
    workflowId: '20260617045930646240',
    runId: 'regression',
    rootDir,
    sceneSpec,
    creativeContext: { input: { raw_text: 'SpaceX 收购 Cursor' } },
    target: { html_video_generation_mode: 'template_inputs' },
    templateRegistry,
    skipValidation: false,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.includes('"template_id"')) {
            assert.match(prompt, /"aspect_ratio": "9:16"/);
            return { success: true, text: JSON.stringify({ template_id: 'news_signal_vertical', reason: '竖屏财经', confidence: 0.95 }) };
          }
          return { success: true, text: JSON.stringify({ headline: '全局标题' }) };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      frameRenderer: {
        renderFrame: async (frame, options) => ({
          success: true,
          frame_id: frame.id,
          output_path: path.join(options.projectDir, 'frames', `${frame.id}.mp4`),
          diagnostics: [],
        }),
      },
      ffmpegComposer: {
        concatFramesWithFfmpeg: async (frames, outputPath) => {
          await writeFile(outputPath, 'mp4');
          return { success: true, output_path: outputPath };
        },
        muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
      },
      visualQaService: {
        inspectRenderedVideo: async ({ expectedAspectRatio }) => {
          assert.equal(expectedAspectRatio, '9:16');
          return { success: true, issues: [], metrics: {} };
        },
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.template_id, 'news_signal_vertical');
  assert.deepEqual(result.project.output.resolution, { width: 1080, height: 1920 });
  assert.equal(result.project.frames[0].inputs.headline, '600 亿美元全股票收购');
  assert.equal(result.project.frames[1].inputs.headline, '第三季度完成，分手费高昂');
  assert.notDeepEqual(result.project.frames[0].inputs, result.project.frames[1].inputs);
  assert.equal(result.project.frames[0].inputs.section_no, '01/02');
  assert.equal(result.project.frames[1].inputs.section_no, '02/02');

  console.log('html-video production regression tests passed');
})();
