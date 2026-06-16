const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function createTemplate(rootDir) {
  const dir = path.join(rootDir, 'simple');
  await writeFile(path.join(dir, 'template.html-video.yaml'), [
    'id: simple',
    'name: 简单模板',
    'engine: hyperframes',
    'source_entry: index.html',
    'output:',
    '  resolution:',
    '    width: 1280',
    '    height: 720',
    '  fps: 30',
    '  duration: 4',
    'inputs:',
    '  schema:',
    '    type: object',
    '    required: [headline]',
    '    properties:',
    '      headline:',
    '        type: string',
    'license:',
    '  commercial_use: true',
    '',
  ].join('\n'));
  await writeFile(path.join(dir, 'index.html'), '<html><body>{{headline}}</body></html>');
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-workflow-'));
  const templateRoot = path.join(rootDir, 'templates');
  await createTemplate(templateRoot);
  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();

  const calls = [];
  const result = await workflow.generateHtmlVideo({
    workflowId: '202606170000000001',
    runId: 'run_001',
    rootDir,
    creativeContext: { input: { raw_text: '产品发布' } },
    target: { duration_sec: 4 },
    templateRegistry,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          calls.push(prompt);
          assert.match(prompt, /只返回 JSON/);
          if (calls.length === 1) {
            return { success: true, text: JSON.stringify({ template_id: 'simple', reason: '匹配', confidence: 0.9 }) };
          }
          return { success: true, text: JSON.stringify({ headline: '首版标题' }) };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      frameRenderer: {
        renderFrame: async (frame, options) => {
          calls.push(`render:${frame.id}`);
          return {
            success: true,
            frame_id: frame.id,
            output_path: path.join(options.projectDir, 'frames', `${frame.id}.mp4`),
            diagnostics: [],
          };
        },
      },
      ffmpegComposer: {
        concatFramesWithFfmpeg: async (frames, outputPath) => {
          calls.push(`concat:${frames.length}`);
          await writeFile(outputPath, 'mp4');
          return { success: true, output_path: outputPath, strategy: 'stub' };
        },
        muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
      },
      visualQaService: {
        inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.render_mode, 'html-video');
  assert.equal(result.template_id, 'simple');
  assert.ok(result.html_video_project_path.endsWith(`${path.sep}202606170000000001${path.sep}agent_runs${path.sep}run_001-html-video`));
  assert.equal(result.project.frames.length, 1);
  assert.equal(result.project.frames[0].inputs.headline, '首版标题');
  assert.equal(result.output_path, path.join(result.html_video_project_path, 'exports', 'output.mp4'));
  assert.deepEqual(calls.slice(-2), ['render:frame_01', 'concat:1']);

  const fallback = await workflow.generateHtmlVideo({
    workflowId: '202606170000000002',
    runId: 'run_002',
    rootDir,
    creativeContext: {},
    templateRegistry,
    services: {
      aiTextModel: {
        callTextModel: async () => ({ success: true, text: JSON.stringify({ template_id: 'missing', reason: '无', confidence: 0.8 }) }),
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
    },
  });
  assert.equal(fallback.success, false);
  assert.equal(fallback.fallback_allowed, true);
  assert.equal(fallback.html_video_diagnostics[0].code, 'template_missing');
  assert.match(fallback.message, /html-video/);

  console.log('html-video workflow tests passed');
})();
