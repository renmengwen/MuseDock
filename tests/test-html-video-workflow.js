const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const {
  computeSceneSpecSpeechHash,
  audioMatchesSceneSpec,
} = require('../server/services/creative-video/sceneSpecHash');

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

function fullSceneCaption(sceneId, text, duration) {
  return [{
    id: `${sceneId}_caption_01`,
    start: 0,
    end: duration,
    duration,
    text,
  }];
}

async function readProjectJson(projectDir) {
  return JSON.parse(await fs.readFile(path.join(projectDir, 'project.json'), 'utf8'));
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
        { id: 'scene_01', duration: 2, kind: 'text', narration_text: '第一幕旁白', captions: fullSceneCaption('scene_01', '第一幕旁白', 2), visual_text: { headline: '第一幕', keywords: [], cards: [] } },
        { id: 'scene_02', duration: 2, kind: 'text', narration_text: '第二幕旁白', captions: fullSceneCaption('scene_02', '第二幕旁白', 2), visual_text: { headline: '第二幕', keywords: [], cards: [] } },
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
            assert.match(prompt, /Target resolution：1080x1920/);
            return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">第一幕</h1><p data-text-key="subtitle">短字幕</p><section data-text-key="body">第一幕完整页面</section></main></body></html>' };
          }
          assert.match(prompt, /Target resolution：1080x1920/);
          return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_02"><h1 data-text-key="headline">第二幕</h1><p>短字幕</p><section>第二幕完整页面</section></main></body></html>' };
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
  assert.ok(rawPathResult.html_video_diagnostics.some(item => item.code === 'raw_html_text_keys_missing'));
  assert.ok(rawCalls.some(call => call === 'render:scene_01:raw_html'));
  assert.ok(rawCalls.some(call => call === 'render:scene_02:raw_html'));
  const rawPathSavedProject = await readProjectJson(rawPathResult.html_video_project_path);
  assert.equal(rawPathSavedProject.generation_checkpoint.stages.validate_project.status, 'done');
  assert.equal(rawPathSavedProject.generation_checkpoint.stages.validate_project.diagnostic_code, '');

  const contentGraphAiFailure = await workflow.generateHtmlVideo({
    workflowId: '202606170000000009_graph_ai_failure',
    runId: 'run_graph_ai_failure',
    rootDir,
    sceneSpec: {
      title: '内容图失败',
      aspect_ratio: '9:16',
      scenes: [
        { id: 'scene_01', duration: 2, kind: 'text', narration_text: '内容图失败旁白', captions: fullSceneCaption('scene_01', '内容图失败旁白', 2), visual_text: { headline: '内容图失败', keywords: [], cards: [] } },
      ],
    },
    creativeContext: { input: { raw_text: '内容图模型失败' } },
    target: { html_video_generation_mode: 'raw_html' },
    templateRegistry,
    skipValidation: true,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.includes('"template_id"')) {
            return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
          }
          return { success: false, message: 'content graph 生成失败。' };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
    },
  });
  assert.equal(contentGraphAiFailure.success, false);
  const graphFailureProject = await readProjectJson(contentGraphAiFailure.html_video_project_path);
  assert.equal(graphFailureProject.generation_checkpoint.stages.content_graph.status, 'failed');
  assert.equal(graphFailureProject.generation_checkpoint.stages.content_graph.diagnostic_code, 'content_graph_failed');

  const validationFailure = await workflow.generateHtmlVideo({
    workflowId: '202606170000000010_validation_failure',
    runId: 'run_validation_failure',
    rootDir,
    sceneSpec: {
      title: '校验失败',
      aspect_ratio: '16:9',
      scenes: [
        { id: 'scene_01', duration: 2, kind: 'text', narration_text: '校验失败旁白', captions: fullSceneCaption('scene_01', '校验失败旁白', 2), visual_text: { headline: '校验失败', keywords: [], cards: [] } },
      ],
    },
    creativeContext: { input: { raw_text: '校验失败' } },
    target: { html_video_generation_mode: 'template_inputs' },
    templateRegistry,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.includes('"template_id"')) {
            return { success: true, text: JSON.stringify({ template_id: 'simple', reason: '匹配横屏', confidence: 0.9 }) };
          }
          return { success: true, text: JSON.stringify({ headline: '校验失败标题' }) };
        },
      },
      environmentDoctor: async () => ({ ok: false, diagnostics: [{ code: 'ffmpeg_missing', ok: false }] }),
    },
  });
  assert.equal(validationFailure.success, false);
  const validationFailureProject = await readProjectJson(validationFailure.html_video_project_path);
  assert.equal(validationFailureProject.generation_checkpoint.stages.validate_project.status, 'failed');
  assert.equal(validationFailureProject.generation_checkpoint.stages.validate_project.diagnostic_code, 'ffmpeg_not_configured');

  let unreasonableTimelineRenderCalls = 0;
  const unreasonableTimelineResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000007_unreasonable_timeline',
    runId: 'run_unreasonable_timeline',
    rootDir,
    sceneSpec: {
      title: '异常时间轴',
      aspect_ratio: '9:16',
      scenes: [
        {
          id: 'scene_01',
          duration: 300,
          kind: 'text',
          narration_text: '异常长旁白一',
          captions: [{ start: 0, end: 300, text: '异常长字幕一' }],
          visual_text: { headline: '异常时间轴一', keywords: [], cards: [] },
        },
        {
          id: 'scene_02',
          duration: 29,
          kind: 'text',
          narration_text: '异常长旁白二',
          captions: [{ start: 0, end: 29, text: '异常长字幕二' }],
          visual_text: { headline: '异常时间轴二', keywords: [], cards: [] },
        },
      ],
    },
    creativeContext: { input: { raw_text: '目标 60 秒，但内容图异常生成 329 秒。' } },
    target: { html_video_generation_mode: 'raw_html', duration_sec: 60 },
    templateRegistry,
    skipValidation: true,
    projectOptions: { generateAudio: false },
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.includes('"template_id"')) {
            return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
          }
          if (prompt.startsWith('你是 html-video 的 content graph')) {
            return {
              success: true,
              text: JSON.stringify({
                synopsis: '异常时间轴',
                nodes: [
                  { id: 'scene_01', kind: 'text', label: '异常时间轴一', durationSec: 300, text: '异常长字幕一' },
                  { id: 'scene_02', kind: 'text', label: '异常时间轴二', durationSec: 29, text: '异常长字幕二' },
                ],
                edges: [{ from: 'scene_01', to: 'scene_02', kind: 'sequence' }],
              }),
            };
          }
          const frameId = prompt.includes('当前帧：scene_02') ? 'scene_02' : 'scene_01';
          return {
            success: true,
            text: `<!doctype html><html><head><style>html,body,#app{width:1080px;height:1920px;margin:0;} main{width:1080px;height:1920px;animation:fade 1s ease;} @keyframes fade{from{opacity:.2}to{opacity:1}}</style></head><body><main id="app" data-frame-id="${frameId}"><h1 data-text-key="headline">异常时间轴</h1><p data-text-key="subtitle">异常长字幕</p><section data-text-key="body">异常长旁白</section></main></body></html>`,
          };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      frameRenderer: {
        renderFrame: async (frame, options) => {
          unreasonableTimelineRenderCalls += 1;
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
        muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
      },
      visualQaService: {
        inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
      },
    },
  });
  assert.equal(unreasonableTimelineResult.success, false);
  const unreasonableTimelineDiagnostic = unreasonableTimelineResult.html_video_diagnostics.find(item => item.code === 'timeline_duration_unreasonable');
  assert.ok(unreasonableTimelineDiagnostic, JSON.stringify({
    message: unreasonableTimelineResult.message,
    diagnostics: unreasonableTimelineResult.html_video_diagnostics,
  }, null, 2));
  assert.equal(unreasonableTimelineDiagnostic.sub_stage, 'timeline_check');
  assert.equal(unreasonableTimelineDiagnostic.retryable, true);
  assert.equal(unreasonableTimelineDiagnostic.repair_action, 'repair_timeline');
  assert.equal(unreasonableTimelineRenderCalls, 0);

  const originalWriteRawFrameHtml = projectStore.writeRawFrameHtml;
  projectStore.writeRawFrameHtml = async () => {
    throw new Error('模拟帧 HTML 写入失败。');
  };
  try {
    const frameWriteFailure = await workflow.generateHtmlVideo({
      workflowId: '202606170000000008_frame_write_failure',
      runId: 'run_frame_write_failure',
      rootDir,
      sceneSpec: {
        title: '写入失败',
        aspect_ratio: '9:16',
        scenes: [
          { id: 'scene_01', duration: 2, kind: 'text', narration_text: '写入失败旁白', captions: fullSceneCaption('scene_01', '写入失败旁白', 2), visual_text: { headline: '写入失败', keywords: [], cards: [] } },
        ],
      },
      creativeContext: { input: { raw_text: '写入失败' } },
      target: { html_video_generation_mode: 'raw_html' },
      templateRegistry,
      skipValidation: true,
      services: {
        aiTextModel: {
          callTextModel: async ({ messages }) => {
            const prompt = messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
            }
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return { success: true, text: JSON.stringify({ synopsis: '写入失败', nodes: [{ id: 'scene_01', kind: 'text', label: '写入失败', durationSec: 2, text: '写入失败' }], edges: [] }) };
            }
            return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">写入失败</h1><p data-text-key="subtitle">短字幕</p><section data-text-key="body">正文</section></main></body></html>' };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      },
    });
    assert.equal(frameWriteFailure.success, false);
    const frameWriteDiagnostic = frameWriteFailure.html_video_diagnostics.find(item => item.code === 'frame_html_write_failed');
    assert.equal(frameWriteDiagnostic.sub_stage, 'frame_html');
    assert.equal(frameWriteDiagnostic.frame_id, 'scene_01');
    assert.equal(frameWriteDiagnostic.retryable, true);
    assert.equal(frameWriteDiagnostic.repair_action, 'retry_frame_html');
  } finally {
    projectStore.writeRawFrameHtml = originalWriteRawFrameHtml;
  }

  projectStore.writeRawFrameHtml = async () => ({
    html_path: '',
    output_hash: 'empty-html-path',
  });
  try {
    const rawBuildFailure = await workflow.generateHtmlVideo({
      workflowId: '202606170000000011_raw_build_failure',
      runId: 'run_raw_build_failure',
      rootDir,
      sceneSpec: {
        title: 'raw HTML 构建失败',
        aspect_ratio: '9:16',
        scenes: [
          { id: 'scene_01', duration: 2, kind: 'text', narration_text: '构建失败旁白', captions: fullSceneCaption('scene_01', '构建失败旁白', 2), visual_text: { headline: '构建失败', keywords: [], cards: [] } },
        ],
      },
      creativeContext: { input: { raw_text: '构建失败' } },
      target: { html_video_generation_mode: 'raw_html' },
      templateRegistry,
      skipValidation: true,
      services: {
        aiTextModel: {
          callTextModel: async ({ messages }) => {
            const prompt = messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
            }
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return { success: true, text: JSON.stringify({ synopsis: '构建失败', nodes: [{ id: 'scene_01', kind: 'text', label: '构建失败', durationSec: 2, text: '构建失败' }], edges: [] }) };
            }
            return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">构建失败</h1><p data-text-key="subtitle">短字幕</p><section data-text-key="body">正文</section></main></body></html>' };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      },
    }).catch(error => ({ success: 'thrown', error }));
    assert.equal(rawBuildFailure.success, false);
    assert.equal(rawBuildFailure.html_video_project_path, rawBuildFailure.project_dir);
    const rawBuildDiagnostic = rawBuildFailure.html_video_diagnostics.find(item => item.code === 'raw_html_build_failed');
    assert.ok(rawBuildDiagnostic);
    assert.equal(rawBuildDiagnostic.stage, 'project');
    assert.equal(rawBuildDiagnostic.sub_stage, 'raw_html_build');
    assert.equal(rawBuildDiagnostic.frame_id, 'scene_01');
    assert.equal(rawBuildDiagnostic.retryable, true);
    assert.equal(rawBuildDiagnostic.repair_action, 'retry_frame_html');
  } finally {
    projectStore.writeRawFrameHtml = originalWriteRawFrameHtml;
  }

  const originalRenderHtmlVideoProject = projectOrchestrator.renderHtmlVideoProject;
  const graphProgressEvents = [];
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
    const graphMismatchResult = await workflow.generateHtmlVideo({
      workflowId: '202606170000000004_graph_mismatch',
      runId: 'run_graph_mismatch',
      rootDir,
      sceneSpec: {
        title: '内容图错位',
        aspect_ratio: '9:16',
        scenes: [
          { id: 'scene_01', duration: 2, kind: 'text', narration_text: '第一幕旁白', captions: fullSceneCaption('scene_01', '第一幕旁白', 2), visual_text: { headline: '第一幕', keywords: [], cards: [] } },
          { id: 'scene_02', duration: 2, kind: 'text', narration_text: '第二幕旁白', captions: fullSceneCaption('scene_02', '第二幕旁白', 2), visual_text: { headline: '第二幕', keywords: [], cards: [] } },
        ],
      },
      creativeContext: { input: { raw_text: '内容图多出一帧' } },
      target: { html_video_generation_mode: 'raw_html' },
      templateRegistry,
      skipValidation: true,
      onProgress: event => {
        graphProgressEvents.push(event);
      },
      services: {
        aiTextModel: {
          callTextModel: async ({ messages }) => {
            const prompt = messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
            }
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: 'AI 多生成了一帧',
                  nodes: [
                    { id: 'scene_01', kind: 'text', label: '第一幕', durationSec: 2, text: '第一幕完整页面' },
                    { id: 'scene_02', kind: 'text', label: '第二幕', durationSec: 2, text: '第二幕完整页面' },
                    { id: 'scene_03', kind: 'text', label: '第三幕', durationSec: 2, text: '第三幕完整页面' },
                  ],
                  edges: [
                    { from: 'scene_01', to: 'scene_02', kind: 'sequence' },
                    { from: 'scene_02', to: 'scene_03', kind: 'sequence' },
                  ],
                }),
              };
            }
            if (prompt.includes('当前帧：scene_01')) {
              return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">第一幕</h1><p data-text-key="subtitle">短字幕</p><section data-text-key="body">第一幕完整页面</section></main></body></html>' };
            }
            if (prompt.includes('当前帧：scene_02')) {
              return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_02"><h1 data-text-key="headline">第二幕</h1><p data-text-key="subtitle">短字幕</p><section data-text-key="body">第二幕完整页面</section></main></body></html>' };
            }
            return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_03"><h1 data-text-key="headline">第三幕</h1><p data-text-key="subtitle">短字幕</p><section data-text-key="body">第三幕完整页面</section></main></body></html>' };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      },
    });
    assert.equal(graphMismatchResult.success, true);
    assert.equal(graphMismatchResult.project.frames.length, 2);
    assert.deepEqual(graphMismatchResult.project.frames.map(frame => frame.scene_id), ['scene_01', 'scene_02']);
    assert.equal(graphMismatchResult.project.frames.some(frame => frame.scene_id === 'scene_03'), false);
    assert.deepEqual(graphMismatchResult.project.content_graph.nodes.map(node => node.id), ['scene_01', 'scene_02']);
    assert.equal(graphMismatchResult.project.content_graph.nodes.some(node => node.id === 'scene_03'), false);
    const mismatchDiagnostic = graphMismatchResult.html_video_diagnostics.find(item => item.code === 'content_graph_scene_spec_mismatch');
    assert.ok(mismatchDiagnostic);
    assert.equal(mismatchDiagnostic.stage, 'ai-content-graph');
    assert.equal(mismatchDiagnostic.severity, 'warning');
    assert.equal(mismatchDiagnostic.fallback_allowed, true);
    assert.equal(mismatchDiagnostic.sub_stage, 'content_graph');
    assert.equal(mismatchDiagnostic.details.reason, 'node_count_mismatch');
    assert.ok(graphProgressEvents.some(event => event.sub_stage === 'content_graph' && String(event.message || '').includes('画面帧与字幕脚本不一致，已回退为字幕脚本生成画面结构。')));
  } finally {
    projectOrchestrator.renderHtmlVideoProject = originalRenderHtmlVideoProject;
  }

  const tenSceneSpec = {
    title: '最新根因回归',
    aspect_ratio: '9:16',
    scenes: Array.from({ length: 10 }, (_, index) => ({
      id: `scene_${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      duration: 1,
      kind: 'text',
      narration_text: `第 ${index + 1} 段新旁白`,
      captions: [{ start: 0, end: 1, text: `第 ${index + 1} 段新字幕` }],
      visual_text: { headline: `第 ${index + 1} 帧画面`, keywords: [], cards: [] },
    })),
  };
  let latestRootBugTtsCalls = 0;
  let latestRootBugMuxedAudio = null;
  projectOrchestrator.renderHtmlVideoProject = async ({ project, projectDir }) => {
    latestRootBugMuxedAudio = project.audio.narration_path;
    return {
      success: true,
      message: 'mock render success',
      project,
      project_dir: projectDir,
      html_video_project_path: projectDir,
      output_path: path.join(projectDir, 'exports', 'output.mp4'),
      diagnostics: [],
    };
  };
  try {
    const latestRootBugResult = await workflow.generateHtmlVideo({
      workflowId: '202606170000000006_latest_root_bug',
      runId: 'run_latest_root_bug',
      rootDir,
      sceneSpec: tenSceneSpec,
      creativeContext: {
        input: { raw_text: '旧音频七段，新字幕十段，AI 多出十一帧。' },
        audio: {
          path: path.join(rootDir, 'legacy-seven-segment.wav'),
          status: 'ready',
          segment_count: 7,
        },
      },
      target: { html_video_generation_mode: 'raw_html' },
      templateRegistry,
      skipValidation: true,
      services: {
        aiTextModel: {
          callTextModel: async ({ messages }) => {
            const prompt = messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
            }
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              const nodes = Array.from({ length: 11 }, (_, index) => ({
                id: `scene_${String(index + 1).padStart(2, '0')}`,
                kind: 'text',
                label: `第 ${index + 1} 帧画面`,
                durationSec: 1,
                text: `第 ${index + 1} 段新字幕`,
              }));
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: 'AI 多生成了一帧',
                  nodes,
                  edges: nodes.slice(1).map((node, index) => ({
                    from: nodes[index].id,
                    to: node.id,
                    kind: 'sequence',
                  })),
                }),
              };
            }
            const scene = tenSceneSpec.scenes.find(item => prompt.includes(`当前帧：${item.id}`));
            assert.ok(scene, 'raw html prompt should target one of the ten scene_spec scenes');
            return {
              success: true,
              text: `<!doctype html><html><body><main data-frame-id="${scene.id}"><h1 data-text-key="headline">${scene.visual_text.headline}</h1><p data-text-key="subtitle">${scene.captions[0].text}</p><section data-text-key="body">${scene.narration_text}</section></main></body></html>`,
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
        ttsService: {
          synthesizeSceneNarration: async ({ sceneSpec }) => {
            latestRootBugTtsCalls += 1;
            return {
              success: true,
              audio_manifest: {
                source: 'scene_spec',
                scene_spec_hash: computeSceneSpecSpeechHash(sceneSpec),
                scene_count: sceneSpec.scenes.length,
                scene_ids: sceneSpec.scenes.map(scene => scene.id),
                combined_path: path.join(rootDir, 'tts-current-ten-scenes.wav'),
                scenes: sceneSpec.scenes.map(scene => ({ scene_id: scene.id })),
                status: 'ready',
              },
            };
          },
        },
        visualQaService: {
          inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
        },
      },
    });
    assert.equal(latestRootBugResult.success, true, JSON.stringify({
      message: latestRootBugResult.message,
      diagnostics: latestRootBugResult.html_video_diagnostics,
    }, null, 2));
    assert.equal(latestRootBugResult.project.frames.length, 10);
    assert.deepEqual(latestRootBugResult.project.frames.map(frame => frame.scene_id), tenSceneSpec.scenes.map(scene => scene.id));
    assert.equal(latestRootBugTtsCalls, 1);
    assert.equal(latestRootBugMuxedAudio, path.join(rootDir, 'tts-current-ten-scenes.wav'));
    assert.equal(latestRootBugResult.project.audio.scene_count, 10);
    assert.equal(latestRootBugResult.project.audio.scene_spec_hash, computeSceneSpecSpeechHash(tenSceneSpec));
    assert.equal(latestRootBugResult.project.audio.status, 'ready');
    assert.ok(latestRootBugResult.html_video_diagnostics.some(item => item.code === 'content_graph_scene_spec_mismatch'));
    assert.equal(latestRootBugResult.html_video_diagnostics.some(item => item.code === 'audio_scene_spec_hash_mismatch'), false);
    assert.deepEqual(latestRootBugResult.project.content_graph.nodes.map(node => node.id), tenSceneSpec.scenes.map(scene => scene.id));
    assert.equal(latestRootBugResult.project.content_graph.nodes.some(node => node.id === 'scene_11'), false);
  } finally {
    projectOrchestrator.renderHtmlVideoProject = originalRenderHtmlVideoProject;
  }

  const reportedFailureSceneSpec = {
    title: 'TTS 长尾静音回归',
    aspect_ratio: '9:16',
    target_duration_sec: 20.996,
    scenes: [
      {
        index: 1,
        id: 'scene_01',
        duration: 7,
        kind: 'text',
        narration_text: '第一段。',
        captions: fullSceneCaption('scene_01', '第一段。', 7),
        visual_text: { headline: '第一段', keywords: [], cards: [] },
      },
      {
        index: 2,
        id: 'scene_04',
        duration: 13.996,
        actual_duration_sec: 13.996,
        raw_duration_sec: 231.04,
        speech_duration_sec: 13.996,
        tail_silence_sec: 217.544,
        trimmed: true,
        kind: 'text',
        narration_text: '他用 Claude Code 搭建了一套 Python 工具。',
        captions: fullSceneCaption('scene_04', '他用 Claude Code 搭建了一套 Python 工具。', 13.996),
        visual_text: { headline: 'Python 工具', keywords: [], cards: [] },
      },
    ],
  };
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
    const reportedFailureWorkflowResult = await workflow.generateHtmlVideo({
      workflowId: '202606170000000008_reported_tts_duration',
      runId: 'run_reported_tts_duration',
      rootDir,
      sceneSpec: reportedFailureSceneSpec,
      creativeContext: { input: { raw_text: 'TTS 长尾静音不应污染 html-video 时长。' } },
      target: { html_video_generation_mode: 'raw_html', duration_sec: 60 },
      templateRegistry,
      skipValidation: true,
      services: {
        aiTextModel: {
          callTextModel: async ({ messages }) => {
            const prompt = messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
            }
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: 'TTS 长尾静音回归',
                  nodes: reportedFailureSceneSpec.scenes.map(scene => ({
                    id: scene.id,
                    kind: 'text',
                    label: scene.visual_text.headline,
                    durationSec: scene.id === 'scene_04' ? 231.04 : scene.duration,
                    text: scene.narration_text,
                  })),
                  edges: [{ from: 'scene_01', to: 'scene_04', kind: 'sequence' }],
                }),
              };
            }
            const scene = reportedFailureSceneSpec.scenes.find(item => prompt.includes(`当前帧：${item.id}`));
            assert.ok(scene, 'raw html prompt should target the reported failure scenes');
            return {
              success: true,
              text: `<!doctype html><html><body><main data-frame-id="${scene.id}"><h1 data-text-key="headline">${scene.visual_text.headline}</h1><p data-text-key="subtitle">${scene.narration_text}</p></main></body></html>`,
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
        ttsService: {
          synthesizeSceneNarration: async ({ sceneSpec }) => ({
            success: true,
            audio_manifest: {
              source: 'scene_spec',
              scene_spec_hash: computeSceneSpecSpeechHash(sceneSpec),
              scene_count: sceneSpec.scenes.length,
              scene_ids: sceneSpec.scenes.map(scene => scene.id),
              combined_path: path.join(rootDir, 'reported-failure-clean-tts.wav'),
              scenes: sceneSpec.scenes.map(scene => ({
                scene_id: scene.id,
                duration: scene.duration,
                raw_duration_sec: scene.raw_duration_sec,
              })),
              status: 'ready',
            },
          }),
        },
        visualQaService: {
          inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
        },
      },
    });

    assert.equal(reportedFailureWorkflowResult.success, true, JSON.stringify({
      message: reportedFailureWorkflowResult.message,
      diagnostics: reportedFailureWorkflowResult.html_video_diagnostics,
    }, null, 2));
    assert.ok(reportedFailureWorkflowResult.project.frames.every(frame => frame.duration_sec < 30));
    const reportedFailureScene01Frame = reportedFailureWorkflowResult.project.frames.find(frame => frame.scene_id === 'scene_01');
    const reportedFailureScene04Frame = reportedFailureWorkflowResult.project.frames.find(frame => frame.scene_id === 'scene_04');
    assert.ok(reportedFailureScene01Frame);
    assert.ok(reportedFailureScene04Frame);
    assert.equal(reportedFailureScene01Frame.duration_sec, 7);
    assert.equal(reportedFailureScene04Frame.duration_sec, 13.996);
    const reportedFailureMainTrack = reportedFailureWorkflowResult.project.timeline.tracks.find(track => track.id === 'main');
    assert.ok(reportedFailureMainTrack);
    assert.ok(reportedFailureMainTrack.items.every(item => item.duration_sec < 30));
    const reportedFailureScene01Item = reportedFailureMainTrack.items.find(item => item.frame_id === 'scene_01');
    const reportedFailureScene04Item = reportedFailureMainTrack.items.find(item => item.frame_id === 'scene_04');
    assert.ok(reportedFailureScene01Item);
    assert.ok(reportedFailureScene04Item);
    assert.equal(reportedFailureScene01Item.duration_sec, 7);
    assert.equal(reportedFailureScene04Item.duration_sec, 13.996);
    assert.equal(reportedFailureScene04Item.start_sec, 7);
    assert.doesNotMatch(JSON.stringify(reportedFailureWorkflowResult.project), /231\.04/);
  } finally {
    projectOrchestrator.renderHtmlVideoProject = originalRenderHtmlVideoProject;
  }

  const rawMissingSceneSpecResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000005_raw_missing_scene_spec',
    runId: 'run_raw_missing_scene_spec',
    rootDir,
    creativeContext: { input: { raw_text: '缺少场景脚本' } },
    target: { html_video_generation_mode: 'raw_html' },
    templateRegistry,
    skipValidation: true,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.includes('"template_id"')) {
            return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
          }
          if (prompt.startsWith('你是 html-video 的 content graph')) {
            return {
              success: true,
              text: JSON.stringify({
                synopsis: '缺少场景脚本',
                nodes: [{ id: 'scene_01', kind: 'text', label: '第一幕', durationSec: 2, text: '第一幕完整页面' }],
                edges: [],
              }),
            };
          }
          return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">第一幕</h1></main></body></html>' };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
    },
  });
  assert.equal(rawMissingSceneSpecResult.success, false);
  assert.match(rawMissingSceneSpecResult.message, /缺少 scene_spec/);
  const missingSceneSpecDiagnostic = rawMissingSceneSpecResult.html_video_diagnostics.find(item => item.code === 'scene_spec_missing');
  assert.ok(missingSceneSpecDiagnostic);
  assert.equal(missingSceneSpecDiagnostic.stage, 'project');
  assert.equal(missingSceneSpecDiagnostic.fallback_allowed, false);

  const progressEvents = [];
  const progressResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000003_progress',
    runId: 'run_progress',
    rootDir,
    sceneSpec: {
      title: '进度测试',
      aspect_ratio: '9:16',
      scenes: [{ id: 'scene_01', duration: 2, kind: 'text', narration_text: '旁白', captions: fullSceneCaption('scene_01', '旁白', 2), visual_text: { headline: '进度' } }],
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
          return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">进度</h1><p data-text-key="subtitle">短字幕</p><section data-text-key="body">进度</section></main></body></html>' };
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
  assert.ok(progressEvents.some(event => event.type === 'html_video_template_selected' && event.sub_stage === 'template_select'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_graph_started'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_graph_done'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_frame_html_started'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_frame_html_done'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_frame_render_progress'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_export_ready' && event.sub_stage === 'compose'));

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
          captions: [{ id: 'c1', start: 0, end: 4, text: '这段可以有旁白但不显示字幕。' }],
          visual_text: { headline: '标题' },
        }],
      },
      creativeContext: { input: { raw_text: '无字幕测试' } },
      projectOptions: {
        generateAudio: true,
        generateCaptions: false,
      },
      templateRegistry,
      services: {
        aiTextModel: {
          callTextModel: async ({ messages }) => {
            const prompt = messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'simple', reason: '匹配横屏', confidence: 0.9 }) };
            }
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
    let noAudioTtsCalls = 0;
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
      templateRegistry,
      services: {
        aiTextModel: {
          callTextModel: async ({ messages }) => {
            const prompt = messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'simple', reason: '匹配横屏', confidence: 0.9 }) };
            }
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: '禁用音频测试',
                  nodes: [{ id: 'scene_01', kind: 'text', label: '禁用音频', durationSec: 4, text: '这段旁白不应该生成音频。' }],
                  edges: [],
                }),
              };
            }
            return {
              success: true,
              text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">禁用音频</h1><section data-text-key="body">画面</section></main></body></html>',
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
        ttsService: {
          synthesizeSceneNarration: async () => {
            noAudioTtsCalls += 1;
            return { success: true };
          },
        },
      },
    });

    assert.equal(noAudioResult.success, true);
    assert.equal(noAudioTtsCalls, 0);
    assert.equal(noAudioResult.project.audio.status, 'skipped');
    assert.equal(noAudioResult.project.audio.reason, 'disabled_by_settings');
  } finally {
    projectOrchestrator.renderHtmlVideoProject = originalRenderForNoAudio;
  }

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
    let targetMediaTtsCalls = 0;
    const targetMediaResult = await workflow.generateHtmlVideo({
      workflowId: 'wf-target-media-options',
      runId: 'run-target-media-options',
      rootDir,
      sceneSpec: sceneSpecWithNarration,
      creativeContext: { input: { raw_text: 'target 关闭音频和字幕' } },
      target: {
        html_video_generation_mode: 'raw_html',
        generateAudio: false,
        generateCaptions: false,
      },
      templateRegistry,
      skipValidation: true,
      services: {
        aiTextModel: {
          callTextModel: async ({ messages }) => {
            const prompt = messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'simple', reason: '匹配横屏', confidence: 0.9 }) };
            }
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: 'target 关闭音频和字幕',
                  nodes: [{ id: 'scene_01', kind: 'text', label: '禁用音频', durationSec: 4, text: '这段旁白不应该生成音频。' }],
                  edges: [],
                }),
              };
            }
            return {
              success: true,
              text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">禁用音频</h1><section data-text-key="body">画面</section></main></body></html>',
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
        ttsService: {
          synthesizeSceneNarration: async () => {
            targetMediaTtsCalls += 1;
            return { success: true };
          },
        },
      },
    });

    assert.equal(targetMediaResult.success, true);
    assert.equal(targetMediaTtsCalls, 0);
    assert.equal(targetMediaResult.project.audio.status, 'skipped');
    assert.equal(targetMediaResult.project.audio.reason, 'disabled_by_settings');
    assert.equal(targetMediaResult.project.frames[0].generate_captions, false);
    assert.equal(targetMediaResult.project.frames[0].captions.length, 0);
  } finally {
    projectOrchestrator.renderHtmlVideoProject = originalRenderForNoAudio;
  }

  const calls = [];
  const result = await workflow.generateHtmlVideo({
    workflowId: '202606170000000001',
    runId: 'run_001',
    rootDir,
    sceneSpec: {
      title: '产品发布',
      aspect_ratio: '9:16',
      scenes: [
        { id: 'scene_01', duration: 4, kind: 'text', narration_text: '旁白一', captions: fullSceneCaption('scene_01', '旁白一', 4), visual_text: { headline: '首版标题', keywords: [], cards: [] } },
        { id: 'scene_02', duration: 3, kind: 'text', narration_text: '旁白二', captions: fullSceneCaption('scene_02', '旁白二', 3), visual_text: { headline: '第二幕', keywords: [], cards: [] } },
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
  const generatedAudioPath = path.join(rootDir, 'generated-narration.wav');
  await writeFile(existingAudioPath, 'existing audio');
  await writeFile(generatedAudioPath, 'generated audio');
  const existingAudioSceneSpec = {
    title: '已有音频',
    aspect_ratio: '9:16',
    scenes: [
      { id: 'scene_01', duration: 4, kind: 'text', narration_text: '旁白一', captions: fullSceneCaption('scene_01', '旁白一', 4), visual_text: { headline: '已有音频标题', keywords: [], cards: [] } },
    ],
  };
  let existingAudioMuxPath = null;
  let ttsCalls = 0;
  let ttsSceneSpec = null;
  const legacyAudioProgressEvents = [];
  const existingAudioResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000001_existing_audio',
    runId: 'run_existing_audio',
    rootDir,
    sceneSpec: existingAudioSceneSpec,
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
    onProgress: event => {
      legacyAudioProgressEvents.push(event);
    },
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
      ttsService: {
        synthesizeSceneNarration: async ({ sceneSpec }) => {
          ttsCalls += 1;
          ttsSceneSpec = sceneSpec;
          return {
            success: true,
            audio_manifest: {
              source: 'scene_spec',
              scene_spec_hash: computeSceneSpecSpeechHash(sceneSpec),
              scene_count: sceneSpec.scenes.length,
              scene_ids: sceneSpec.scenes.map(scene => scene.id),
              combined_path: generatedAudioPath,
              scenes: [],
            },
          };
        },
      },
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
  assert.equal(ttsCalls, 1);
  assert.deepEqual(ttsSceneSpec, existingAudioSceneSpec);
  assert.equal(existingAudioResult.project.audio.narration_path, generatedAudioPath);
  assert.equal(existingAudioResult.project.audio.scene_spec_hash, computeSceneSpecSpeechHash(existingAudioSceneSpec));
  assert.equal(audioMatchesSceneSpec(existingAudioResult.project.audio, existingAudioSceneSpec), true);
  assert.equal(existingAudioMuxPath, generatedAudioPath);
  assert.notEqual(existingAudioMuxPath, existingAudioPath);
  assert.ok(legacyAudioProgressEvents.some(event => (
    event.type === 'html_video_tts_regenerate_started'
    && event.stage === 'audio'
    && event.sub_stage === 'tts'
    && event.message === '检测到脚本已变化，正在按当前字幕重新生成旁白...'
    && event.data?.reason === 'scene_spec_mismatch'
  )));

  let reuseTtsCalls = 0;
  let reusedAudioMuxPath = null;
  const reusableAudioResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000001_reusable_audio',
    runId: 'run_reusable_audio',
    rootDir,
    sceneSpec: existingAudioSceneSpec,
    creativeContext: {
      input: { raw_text: '可复用音频' },
      audio: {
        source: 'scene_spec',
        scene_spec_hash: computeSceneSpecSpeechHash(existingAudioSceneSpec),
        scene_count: existingAudioSceneSpec.scenes.length,
        scene_ids: existingAudioSceneSpec.scenes.map(scene => scene.id),
        status: 'ready',
        path: existingAudioPath,
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
      ttsService: {
        synthesizeSceneNarration: async () => {
          reuseTtsCalls += 1;
          return { success: false, message: '不应重新生成旁白。' };
        },
      },
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
          reusedAudioMuxPath = narrationPath;
          return { success: true, skipped: false, output_path: videoPath };
        },
      },
      visualQaService: {
        inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
      },
    },
  });
  assert.equal(reusableAudioResult.success, true);
  assert.equal(reuseTtsCalls, 0);
  assert.equal(reusableAudioResult.project.audio.narration_path, existingAudioPath);
  assert.equal(reusableAudioResult.project.audio.scene_spec_hash, computeSceneSpecSpeechHash(existingAudioSceneSpec));
  assert.deepEqual(reusableAudioResult.project.audio.scene_ids, ['scene_01']);
  assert.equal(audioMatchesSceneSpec(reusableAudioResult.project.audio, existingAudioSceneSpec), true);
  assert.equal(reusedAudioMuxPath, existingAudioPath);

  let blankPathReuseTtsCalls = 0;
  let blankPathReuseMuxPath = null;
  const blankPathReuseResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000001_blank_path_reuse',
    runId: 'run_blank_path_reuse',
    rootDir,
    sceneSpec: existingAudioSceneSpec,
    creativeContext: {
      input: { raw_text: '空白 path 复用音频' },
      audio: {
        source: 'scene_spec',
        scene_spec_hash: computeSceneSpecSpeechHash(existingAudioSceneSpec),
        scene_count: existingAudioSceneSpec.scenes.length,
        scene_ids: existingAudioSceneSpec.scenes.map(scene => scene.id),
        status: 'ready',
        path: '   ',
        combined_path: existingAudioPath,
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
      ttsService: {
        synthesizeSceneNarration: async () => {
          blankPathReuseTtsCalls += 1;
          return { success: false, message: '不应重新生成旁白。' };
        },
      },
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
          blankPathReuseMuxPath = narrationPath;
          return { success: true, skipped: false, output_path: videoPath };
        },
      },
      visualQaService: {
        inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
      },
    },
  });
  assert.equal(blankPathReuseResult.success, true);
  assert.equal(blankPathReuseTtsCalls, 0);
  assert.equal(blankPathReuseResult.project.audio.narration_path, existingAudioPath);
  assert.equal(audioMatchesSceneSpec(blankPathReuseResult.project.audio, existingAudioSceneSpec), true);
  assert.equal(blankPathReuseMuxPath, existingAudioPath);

  const emptyManifestSceneSpec = {
    title: '无旁白',
    aspect_ratio: '9:16',
    scenes: [
      { id: 'scene_01', duration: 4, kind: 'text', narration_text: '', captions: [], visual_text: { headline: '无旁白标题', keywords: [], cards: [] } },
    ],
  };
  let emptyManifestMuxPath = '未调用';
  const emptyManifestResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000001_empty_manifest',
    runId: 'run_empty_manifest',
    rootDir,
    sceneSpec: emptyManifestSceneSpec,
    creativeContext: { input: { raw_text: '无旁白' } },
    target: { html_video_generation_mode: 'template_inputs' },
    templateRegistry,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.includes('"template_id"')) {
            return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
          }
          return { success: true, text: JSON.stringify({ headline: '无旁白标题' }) };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      ttsService: {
        synthesizeSceneNarration: async ({ sceneSpec }) => ({
          success: true,
          audio_manifest: {
            source: 'scene_spec',
            scene_spec_hash: computeSceneSpecSpeechHash(sceneSpec),
            scene_count: sceneSpec.scenes.length,
            scene_ids: sceneSpec.scenes.map(scene => scene.id),
            status: 'ready',
            scenes: [],
          },
        }),
      },
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
          emptyManifestMuxPath = narrationPath;
          return { success: true, skipped: true, output_path: videoPath };
        },
      },
      visualQaService: {
        inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }),
      },
    },
  });
  assert.equal(emptyManifestResult.success, true);
  assert.equal(emptyManifestResult.project.audio.tts_manifest_path, null);
  assert.equal(emptyManifestResult.audio_manifest, null);
  assert.equal(emptyManifestMuxPath, null);
  assert.equal(emptyManifestResult.html_video_diagnostics.some(item => item.code === 'tts_manifest_missing'), false);
  assert.equal(emptyManifestResult.project.generation_checkpoint.stages.visual_inspect.status, 'done');
  assert.equal(emptyManifestResult.project.generation_checkpoint.stages.visual_inspect.diagnostic_code, '');

  const visualQaWarning = await workflow.generateHtmlVideo({
    workflowId: '202606170000000001_visual_warning',
    runId: 'run_visual_warning',
    rootDir,
    sceneSpec: {
      title: '视觉报告误判',
      aspect_ratio: '9:16',
      scenes: [
        { id: 'scene_01', duration: 4, kind: 'text', narration_text: '旁白一', captions: fullSceneCaption('scene_01', '旁白一', 4), visual_text: { headline: '深色场景', keywords: [], cards: [] } },
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
  assert.equal(visualQaWarning.project.generation_checkpoint.stages.visual_inspect.status, 'warning');
  assert.equal(visualQaWarning.project.generation_checkpoint.stages.visual_inspect.diagnostic_code, 'visual_qa_warning');

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
  assert.equal(fallback.html_video_diagnostics[0].sub_stage, 'template_select');
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
