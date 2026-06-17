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
    '    width: 1920',
    '    height: 1080',
    '  fps: 24',
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

async function createVerticalTemplate(rootDir) {
  const dir = path.join(rootDir, 'vertical');
  await writeFile(path.join(dir, 'template.html-video.yaml'), [
    'id: vertical',
    'name: 竖屏模板',
    'engine: hyperframes',
    'source_entry: index.html',
    'output:',
    '  resolution:',
    '    width: 1080',
    '    height: 1920',
    '  fps: 24',
    '  duration: 4',
    'inputs:',
    '  schema:',
    '    type: object',
    '    required: [headline]',
    '    properties:',
    '      headline:',
    '        type: string',
    '      section_no:',
    '        type: string',
    '      bullets:',
    '        type: array',
    'license:',
    '  commercial_use: true',
    '',
  ].join('\n'));
  await writeFile(path.join(dir, 'index.html'), '<html><body>{{section_no}} {{headline}}</body></html>');
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-workflow-'));
  const templateRoot = path.join(rootDir, 'templates');
  await createTemplate(templateRoot);
  await createVerticalTemplate(templateRoot);
  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();

  const rawCalls = [];
  const rawPathResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000000_raw',
    runId: 'run_raw',
    rootDir,
    sceneSpec: {
      title: '默认 Raw HTML',
      aspect_ratio: '9:16',
      scenes: [
        { id: 'scene_01', duration: 2, kind: 'text', narration_text: '第一幕旁白', captions: [], visual_text: { headline: '第一幕', keywords: [], cards: [] } },
        { id: 'scene_02', duration: 2, kind: 'text', narration_text: '第二幕旁白', captions: [], visual_text: { headline: '第二幕', keywords: [], cards: [] } },
      ],
    },
    creativeContext: { input: { raw_text: '默认应该生成完整 HTML。' } },
    target: {},
    templateRegistry,
    skipValidation: true,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          rawCalls.push(prompt);
          if (prompt.includes('"template_id"')) {
            return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
          }
          if (prompt.startsWith('你是 html-video 的 content graph')) {
            return {
              success: true,
              text: JSON.stringify({
                synopsis: '两帧完整 HTML',
                nodes: [
                  { id: 'scene_01', kind: 'text', label: '第一幕', durationSec: 2, text: '第一幕完整页面' },
                  { id: 'scene_02', kind: 'text', label: '第二幕', durationSec: 2, text: '第二幕完整页面' },
                ],
                edges: [{ from: 'scene_01', to: 'scene_02', kind: 'sequence' }],
              }),
            };
          }
          if (prompt.includes('当前帧：scene_01')) {
            return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01">第一幕完整页面</main></body></html>' };
          }
          return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_02">第二幕完整页面</main></body></html>' };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      frameRenderer: {
        renderFrame: async (frame, options) => {
          rawCalls.push(`render:${frame.id}:${frame.source_mode}`);
          assert.equal(frame.source_mode, 'raw_html');
          assert.ok(frame.html_path.endsWith('.html'));
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
  assert.equal(rawPathResult.success, true);
  assert.equal(rawPathResult.render_mode, 'html-video');
  assert.ok(rawPathResult.project.frames.every(frame => frame.source_mode === 'raw_html'));
  assert.equal(rawPathResult.project.frames.some(frame => Object.keys(frame.inputs || {}).length > 0), false);
  const rawHtmlFiles = await Promise.all(rawPathResult.project.frames.map(frame => fs.readFile(path.join(rawPathResult.html_video_project_path, frame.html_path), 'utf8')));
  assert.notEqual(rawHtmlFiles[0], rawHtmlFiles[1]);
  assert.ok(rawCalls.some(call => call === 'render:scene_01:raw_html'));
  assert.ok(rawCalls.some(call => call === 'render:scene_02:raw_html'));

  const progressEvents = [];
  const progressResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000003_progress',
    runId: 'run_progress',
    rootDir,
    sceneSpec: {
      title: '进度测试',
      aspect_ratio: '9:16',
      scenes: [{ id: 'scene_01', duration: 2, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '进度' } }],
    },
    creativeContext: { input: { raw_text: '进度测试' } },
    target: {},
    templateRegistry,
    skipValidation: true,
    onProgress: async event => {
      await new Promise(resolve => setImmediate(resolve));
      progressEvents.push(event);
      if (event.type === 'html_video_graph_done') {
        throw new Error('progress failed');
      }
    },
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.includes('"template_id"')) return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
          if (prompt.startsWith('你是 html-video 的 content graph')) {
            return { success: true, text: JSON.stringify({ synopsis: '进度', nodes: [{ id: 'scene_01', kind: 'text', label: '进度', durationSec: 2, text: '进度' }], edges: [] }) };
          }
          return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01">进度</main></body></html>' };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      frameRenderer: {
        renderFrame: async (frame, options) => {
          await options.onProgress?.({ frame, percent: 50, message: '正在录制 html-video 帧...' });
          return { success: true, frame_id: frame.id, output_path: path.join(options.projectDir, 'frames', `${frame.id}.mp4`), diagnostics: [] };
        },
      },
      ffmpegComposer: {
        concatFramesWithFfmpeg: async (frames, outputPath) => {
          await writeFile(outputPath, 'mp4');
          return { success: true, output_path: outputPath };
        },
        muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
      },
      visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
    },
  });
  assert.equal(progressResult.success, true);
  assert.ok(progressEvents.some(event => event.type === 'html_video_graph_started'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_frame_html_started'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_frame_render_progress'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_export_ready'));

  const calls = [];
  const result = await workflow.generateHtmlVideo({
    workflowId: '202606170000000001',
    runId: 'run_001',
    rootDir,
    sceneSpec: {
      title: '产品发布',
      aspect_ratio: '9:16',
      scenes: [
        { id: 'scene_01', duration: 4, kind: 'text', narration_text: '旁白一', captions: [], visual_text: { headline: '首版标题', keywords: [], cards: [] } },
        { id: 'scene_02', duration: 3, kind: 'text', narration_text: '旁白二', captions: [], visual_text: { headline: '第二幕', keywords: [], cards: [] } },
      ],
    },
    creativeContext: { input: { raw_text: '产品发布' } },
    target: { html_video_generation_mode: 'template_inputs' },
    templateRegistry,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          calls.push(prompt);
          assert.match(prompt, /只返回 JSON/);
          if (calls.length === 1) {
            assert.match(prompt, /"aspect_ratio": "9:16"/);
            assert.match(prompt, /"id": "vertical"/);
            assert.doesNotMatch(prompt, /"id": "simple"/);
            return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
          }
          return { success: true, text: JSON.stringify({ headline: '首版标题' }) };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      ttsService: {
        synthesizeSceneNarration: async ({ projectDir }) => {
          calls.push(`tts:${path.basename(projectDir)}`);
          await writeFile(path.join(projectDir, 'tts', 'scene_01.mp3'), 'audio');
          await writeFile(path.join(projectDir, 'tts', 'scene_02.mp3'), 'audio');
          await writeFile(path.join(projectDir, 'tts', 'audio_manifest.json'), JSON.stringify({
            version: 1,
            project_dir: projectDir,
            scenes: [
              { scene_id: 'scene_01', relative_path: 'tts/scene_01.mp3', duration: 4, format: 'mp3' },
              { scene_id: 'scene_02', relative_path: 'tts/scene_02.mp3', duration: 3, format: 'mp3' },
            ],
          }));
          return {
            success: true,
            audio_manifest: {
              scenes: [
                { scene_id: 'scene_01', relative_path: 'tts/scene_01.mp3' },
                { scene_id: 'scene_02', relative_path: 'tts/scene_02.mp3' },
              ],
              combined_path: null,
            },
          };
        },
      },
      frameRenderer: {
        renderFrame: async (frame, options) => {
          calls.push(`render:${frame.id}`);
          assert.deepEqual(options.resolution, { width: 1080, height: 1920 });
          assert.equal(options.fps, 24);
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
        concatAudioWithFfmpeg: async (files, outputPath) => {
          calls.push(`audio:${path.basename(files[0].path)}`);
          await writeFile(outputPath, 'audio');
          return { success: true, output_path: outputPath };
        },
        muxAudioWithFfmpeg: async ({ videoPath, narrationPath }) => {
          calls.push(`mux:${path.basename(narrationPath || '')}`);
          return { success: true, skipped: false, output_path: videoPath };
        },
      },
      visualQaService: {
        inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.render_mode, 'html-video');
  assert.equal(result.template_id, 'vertical');
  assert.ok(result.html_video_project_path.endsWith(`${path.sep}202606170000000001${path.sep}agent_runs${path.sep}run_001-html-video`));
  assert.equal(result.project.frames.length, 2);
  assert.equal(result.project.frames[0].scene_id, 'scene_01');
  assert.equal(result.project.frames[1].scene_id, 'scene_02');
  assert.equal(result.project.frames[0].inputs.headline, '首版标题');
  assert.equal(result.project.content_graph.nodes.length, 2);
  assert.equal(result.project.timeline.tracks.find(track => track.id === 'main').items.length, 2);
  assert.deepEqual(result.project.output.resolution, { width: 1080, height: 1920 });
  assert.equal(result.project.output.fps, 24);
  assert.equal(result.project.template_schema.properties.headline.type, 'string');
  assert.equal(result.project.audio.tts_manifest_path, 'tts/audio_manifest.json');
  assert.equal(result.output_path, path.join(result.html_video_project_path, 'exports', 'output.mp4'));
  assert.deepEqual(calls.slice(-6), [
    `tts:${path.basename(result.html_video_project_path)}`,
    'render:scene_01',
    'render:scene_02',
    'concat:2',
    'audio:scene_01.mp3',
    'mux:narration-track.mp3',
  ]);

  const existingAudioPath = path.join(rootDir, 'existing-narration.wav');
  await writeFile(existingAudioPath, 'existing audio');
  let existingAudioMuxPath = null;
  const existingAudioResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000001_existing_audio',
    runId: 'run_existing_audio',
    rootDir,
    sceneSpec: {
      title: '已有音频',
      aspect_ratio: '9:16',
      scenes: [
        { id: 'scene_01', duration: 4, kind: 'text', narration_text: '旁白一', captions: [], visual_text: { headline: '已有音频标题', keywords: [], cards: [] } },
      ],
    },
    creativeContext: {
      input: { raw_text: '已有音频' },
      audio: {
        status: 'ready',
        path: existingAudioPath,
        duration: 4,
      },
    },
    target: { html_video_generation_mode: 'template_inputs' },
    templateRegistry,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.includes('"template_id"')) {
            return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
          }
          return { success: true, text: JSON.stringify({ headline: '已有音频标题' }) };
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
          return { success: true, output_path: outputPath, strategy: 'stub' };
        },
        muxAudioWithFfmpeg: async ({ videoPath, narrationPath }) => {
          existingAudioMuxPath = narrationPath;
          return { success: true, skipped: false, output_path: videoPath };
        },
      },
      visualQaService: {
        inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
      },
    },
  });
  assert.equal(existingAudioResult.success, true);
  assert.equal(existingAudioResult.project.audio.narration_path, existingAudioPath);
  assert.equal(existingAudioMuxPath, existingAudioPath);

  const visualQaWarning = await workflow.generateHtmlVideo({
    workflowId: '202606170000000001_visual_warning',
    runId: 'run_visual_warning',
    rootDir,
    sceneSpec: {
      title: '视觉报告误判',
      aspect_ratio: '9:16',
      scenes: [
        { id: 'scene_01', duration: 4, kind: 'text', narration_text: '旁白一', captions: [], visual_text: { headline: '深色场景', keywords: [], cards: [] } },
      ],
    },
    creativeContext: { input: { raw_text: '视觉报告误判' } },
    target: { html_video_generation_mode: 'template_inputs' },
    templateRegistry,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.includes('"template_id"')) {
            return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
          }
          return { success: true, text: JSON.stringify({ headline: '深色场景' }) };
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
          return { success: true, output_path: outputPath, strategy: 'stub' };
        },
        concatAudioWithFfmpeg: async () => ({ success: true, skipped: true }),
        muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
      },
      visualQaService: {
        inspectRenderedVideo: async () => ({
          success: false,
          message: '视觉质检失败：深色画面误判。',
          issues: [{ code: 'too_many_blank_frames', message: '近黑帧比例过高。' }],
          metrics: { blank_ratio: 1 },
        }),
      },
    },
  });
  assert.equal(visualQaWarning.success, true);
  assert.equal(visualQaWarning.render_mode, 'html-video');
  assert.equal(visualQaWarning.visual_report.success, false);
  assert.ok(visualQaWarning.html_video_diagnostics.some(item => item.code === 'visual_qa_warning'));

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

  const edited = await workflow.applyEdit({
    workflowId: '202606170000000001',
    projectDir: result.html_video_project_path,
    project: result.project,
    payload: { instruction: '把标题改成最终版' },
    services: {
      aiTextModel: {
        callTextModel: async () => ({
          success: true,
          text: JSON.stringify({ edit_patch: { type: 'template_inputs_patch', patch: { headline: '最终版标题' } } }),
        }),
      },
    },
  });
  assert.equal(edited.success, true);
  assert.equal(edited.project.template_inputs.headline, '最终版标题');
  const savedProject = JSON.parse(await fs.readFile(path.join(result.html_video_project_path, 'project.json'), 'utf8'));
  assert.equal(savedProject.template_inputs.headline, '最终版标题');

  console.log('html-video workflow tests passed');
})();
