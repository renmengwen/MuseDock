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
    sceneSpec: {
      title: '产品发布',
      aspect_ratio: '16:9',
      scenes: [
        { id: 'scene_01', duration: 4, kind: 'text', narration_text: '旁白一', captions: [], visual_text: { headline: '首版标题', keywords: [], cards: [] } },
        { id: 'scene_02', duration: 3, kind: 'text', narration_text: '旁白二', captions: [], visual_text: { headline: '第二幕', keywords: [], cards: [] } },
      ],
    },
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
  assert.equal(result.template_id, 'simple');
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
