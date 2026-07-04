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
  assert.ok(templateRegistry.getTemplate('vertical'));

  const auditedRawResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000020_audit_raw',
    runId: 'run_audit_raw',
    rootDir,
    sceneSpec: {
      title: '审计 Raw HTML',
      aspect_ratio: '9:16',
      scenes: [
        { id: 'scene_01', duration: 2, kind: 'text', narration_text: '审计旁白', captions: fullSceneCaption('scene_01', '审计旁白', 2), visual_text: { headline: '审计标题', keywords: [], cards: [] } },
      ],
    },
    creativeContext: { input: { raw_text: '审计 Raw HTML' } },
    target: {
      html_video_generation_mode: 'raw_html',
      preferredTemplateId: 'vertical',
      lockTemplate: true,
      generateAudio: false,
    },
    templateRegistry,
    skipValidation: true,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.startsWith('你是 html-video 的 content graph')) {
            return {
              success: true,
              model: { model_id: 'gpt-test' },
              usage: { cached_tokens: 1024 },
              text: JSON.stringify({
                synopsis: '审计 Raw HTML',
                nodes: [{ id: 'scene_01', kind: 'text', label: '审计标题', durationSec: 2, text: '审计正文' }],
                edges: [],
              }),
            };
          }
          return {
            success: true,
            model: { model_id: 'gpt-test' },
            usage: { cached_tokens: 1024 },
            text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">审计标题</h1><p data-text-key="subtitle">审计旁白</p><section data-text-key="body">审计正文</section></main></body></html>',
          };
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
      visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
    },
  });
  assert.equal(auditedRawResult.success, true);
  const auditedRawProject = await readProjectJson(auditedRawResult.html_video_project_path);
  const auditedRawCalls = auditedRawProject.generation_checkpoint.model_calls;
  const contentGraphAudit = auditedRawCalls.find(call => call.agent === 'ContentGraphAgent' && call.stage === 'content_graph');
  const frameHtmlAudit = auditedRawCalls.find(call => call.agent === 'FrameHtmlAgent' && call.stage === 'frame_html' && call.frame_id === 'scene_01');
  assert.ok(contentGraphAudit);
  assert.equal(contentGraphAudit.model.model_id, 'gpt-test');
  assert.equal(contentGraphAudit.usage.cached_tokens, 1024);
  assert.ok(frameHtmlAudit);
  assert.equal(frameHtmlAudit.model.model_id, 'gpt-test');
  assert.equal(frameHtmlAudit.usage.cached_tokens, 1024);

  const auditedTemplateInputsResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000021_audit_template_inputs',
    runId: 'run_audit_template_inputs',
    rootDir,
    sceneSpec: {
      title: '审计模板字段',
      aspect_ratio: '9:16',
      scenes: [
        { id: 'scene_01', duration: 2, kind: 'text', narration_text: '模板旁白', captions: fullSceneCaption('scene_01', '模板旁白', 2), visual_text: { headline: '模板标题', keywords: [], cards: [] } },
      ],
    },
    creativeContext: { input: { raw_text: '审计模板字段' } },
    target: { html_video_generation_mode: 'template_inputs', generateAudio: false },
    templateRegistry,
    services: {
      aiTextModel: {
        callTextModel: async request => {
          if (request.audit?.stage === 'template_selection') {
            return { success: true, model: { model_id: 'gpt-test' }, usage: { cached_tokens: 1024 }, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
          }
          if (request.audit?.stage === 'template_inputs') {
            return { success: true, model: { model_id: 'gpt-test' }, usage: { cached_tokens: 1024 }, text: JSON.stringify({ headline: '模板标题' }) };
          }
          return { success: false, message: '缺少审计元数据。' };
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
      visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
    },
  });
  assert.equal(auditedTemplateInputsResult.success, true);
  const auditedTemplateInputsProject = await readProjectJson(auditedTemplateInputsResult.html_video_project_path);
  const auditedTemplateInputCalls = auditedTemplateInputsProject.generation_checkpoint.model_calls;
  assert.ok(auditedTemplateInputCalls.some(call => call.agent === 'TemplateSelectorAgent' && call.stage === 'template_selection'));
  assert.ok(auditedTemplateInputCalls.some(call => call.agent === 'TemplateInputAgent' && call.stage === 'template_inputs'));

  let activeFrameHtmlCalls = 0;
  let maxActiveFrameHtmlCalls = 0;
  const parallelFramePrompts = {};
  const parallelProgressEvents = [];
  const parallelSceneSpec = {
    title: '并发帧 HTML',
    aspect_ratio: '9:16',
    scenes: Array.from({ length: 4 }, (_, index) => {
      const id = `scene_${String(index + 1).padStart(2, '0')}`;
      return {
        id,
        duration: 2,
        kind: 'text',
        narration_text: `并发旁白 ${index + 1}`,
        captions: fullSceneCaption(id, `并发旁白 ${index + 1}`, 2),
        visual_text: { headline: `并发标题 ${index + 1}`, keywords: [], cards: [] },
      };
    }),
  };
  const parallelFrameResult = await workflow.generateHtmlVideo({
    workflowId: '202606280000000001_parallel_frame_html',
    runId: 'run_parallel_frame_html',
    rootDir,
    sceneSpec: parallelSceneSpec,
    creativeContext: { input: { raw_text: '并发帧 HTML' } },
    target: {
      html_video_generation_mode: 'raw_html',
      preferredTemplateId: 'vertical',
      lockTemplate: true,
      generateAudio: false,
      frameHtmlConcurrency: 2,
    },
    templateRegistry,
    skipValidation: true,
    onProgress: event => parallelProgressEvents.push(event),
    services: {
      aiTextModel: {
        callTextModel: async request => {
          const prompt = request.messages.map(item => item.content).join('\n');
          if (prompt.startsWith('你是 html-video 的 content graph')) {
            return {
              success: true,
              text: JSON.stringify({
                synopsis: '并发帧 HTML',
                nodes: parallelSceneSpec.scenes.map(scene => ({
                  id: scene.id,
                  kind: 'text',
                  label: scene.visual_text.headline,
                  durationSec: scene.duration,
                  text: scene.narration_text,
                })),
                edges: parallelSceneSpec.scenes.slice(1).map((scene, index) => ({
                  from: parallelSceneSpec.scenes[index].id,
                  to: scene.id,
                  kind: 'sequence',
                })),
              }),
            };
          }
          if (request.audit?.stage === 'frame_html') {
            const frameId = request.audit.frame_id;
            parallelFramePrompts[frameId] = prompt;
            activeFrameHtmlCalls += 1;
            maxActiveFrameHtmlCalls = Math.max(maxActiveFrameHtmlCalls, activeFrameHtmlCalls);
            await new Promise(resolve => setTimeout(resolve, 30));
            activeFrameHtmlCalls -= 1;
            const scene = parallelSceneSpec.scenes.find(item => item.id === frameId);
            const previousOnlyMarker = frameId === 'scene_02' ? 'SECOND_PREVIOUS_ONLY' : '';
            return {
              success: true,
              text: `<!doctype html><html><body><main data-frame-id="${frameId}"><h1 data-text-key="headline">${scene.visual_text.headline}</h1><p data-text-key="subtitle">${scene.captions[0].text}</p><section data-text-key="body">${scene.narration_text} ${previousOnlyMarker}</section></main></body></html>`,
            };
          }
          return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
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
      visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
    },
  });
  assert.equal(parallelFrameResult.success, true);
  assert.equal(maxActiveFrameHtmlCalls, 2, `expected frame HTML calls to respect configured concurrency, got ${maxActiveFrameHtmlCalls}`);
  assert.doesNotMatch(parallelFramePrompts.scene_03, /SECOND_PREVIOUS_ONLY/);
  assert.doesNotMatch(parallelFramePrompts.scene_04, /SECOND_PREVIOUS_ONLY/);
  const batchFrameHtmlStarted = parallelProgressEvents.find(event => event.type === 'html_video_frame_html_parallel_started');
  assert.ok(batchFrameHtmlStarted);
  assert.match(batchFrameHtmlStarted.message, /并发生成/);
  assert.equal(batchFrameHtmlStarted.data?.concurrency, 2);
  assert.ok(parallelProgressEvents
    .filter(event => event.type === 'html_video_frame_html_started')
    .every(event => Number.isFinite(Number(event.data?.completed))));
  assert.ok(parallelProgressEvents.some(event => event.type === 'html_video_frame_html_done' && event.data?.completed === 4));

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
  assert.deepEqual(rawPathSavedProject.generation_checkpoint.agent_pipeline, [
    { agent: 'ContentGraphAgent', stage: 'content_graph', artifact: 'content-graph.json' },
    { agent: 'FrameHtmlAgent', stage: 'frame_html', artifact: 'frames' },
  ]);

  const layoutQaCalls = [];
  const layoutRepairPrompts = [];
  let layoutQaRenderCalled = false;
  const layoutQaFailureResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000000_layout_qa_failure',
    runId: 'run_layout_qa_failure',
    rootDir,
    sceneSpec: {
      title: '布局遮挡检查',
      aspect_ratio: '16:9',
      scenes: [
        { id: 'scene_01', duration: 2, kind: 'text', narration_text: '布局旁白', captions: fullSceneCaption('scene_01', '布局旁白', 2), visual_text: { headline: '布局标题', keywords: [], cards: [] } },
      ],
    },
    creativeContext: { input: { raw_text: '检查元素遮挡。' } },
    target: {
      html_video_generation_mode: 'raw_html',
      generateAudio: false,
    },
    templateRegistry,
    runLayoutQa: true,
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
                synopsis: '一帧布局检查',
                nodes: [{ id: 'scene_01', kind: 'text', label: '布局标题', durationSec: 2, text: '布局正文' }],
                edges: [],
              }),
            };
          }
          if (prompt.includes('布局修复要求')) {
            layoutRepairPrompts.push(prompt);
          }
          return {
            success: true,
            text: '<!doctype html><html><head><meta name="viewport" content="width=1920,height=1080,initial-scale=1"><style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden}.stage{width:1920px;height:1080px;display:grid;place-items:center;animation:in .8s ease both}@keyframes in{from{opacity:.2}to{opacity:1}}</style></head><body data-hv-canvas data-width="1920" data-height="1080"><main class="stage" data-frame-id="scene_01"><h1 data-text-key="headline">布局标题</h1><p data-text-key="subtitle">布局旁白</p><section data-text-key="body">布局正文</section></main></body></html>',
          };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      layoutQaService: {
        inspectFrameHtmlLayout: async ({ htmlPath, frame }) => {
          await fs.access(htmlPath);
          layoutQaCalls.push({ htmlPath, frameId: frame.id });
          return {
            success: false,
            issues: [{ code: 'text_overlap', message: '标题覆盖正文。', severity: 'error' }],
            metrics: { samples: [{ sample_time_sec: 0.8 }] },
          };
        },
      },
      frameRenderer: {
        renderFrame: async () => {
          layoutQaRenderCalled = true;
          throw new Error('layout QA failed frames should not render');
        },
      },
    },
  });
  assert.equal(layoutQaFailureResult.success, false);
  assert.equal(layoutQaFailureResult.code, 'layout_qa_failed');
  assert.equal(layoutQaFailureResult.html_video_diagnostics.some(item => item.code === 'layout_qa_failed' && item.repair_action === 'retry_frame_html'), true);
  assert.equal(layoutQaFailureResult.html_video_diagnostics.some(item => item.details?.issues?.[0]?.code === 'text_overlap'), true);
  // 帧生成阶段：首检 + 修复后复检；渲染前 gate 再检一次
  assert.equal(layoutQaCalls.length, 3);
  assert.ok(layoutQaCalls[0].htmlPath.includes('.qa'));
  assert.equal(layoutRepairPrompts.length, 1);
  assert.match(layoutRepairPrompts[0], /标题覆盖正文/);
  assert.equal(layoutQaFailureResult.html_video_diagnostics.some(item => item.code === 'frame_layout_qa_unresolved' && item.severity === 'warning'), true);
  assert.equal(layoutQaRenderCalled, false);

  // 线上事故场景：skipValidation=true 关闭阻断式校验，但帧生成阶段的布局自检 + 自动修复仍要生效。
  const layoutRepairQaCalls = [];
  const layoutRepairSuccessResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000000_layout_repair',
    runId: 'run_layout_repair',
    rootDir,
    sceneSpec: {
      title: '布局自动修复',
      aspect_ratio: '16:9',
      scenes: [
        { id: 'scene_01', duration: 2, kind: 'text', narration_text: '修复旁白', captions: fullSceneCaption('scene_01', '修复旁白', 2), visual_text: { headline: '修复标题', keywords: [], cards: [] } },
      ],
    },
    creativeContext: { input: { raw_text: '布局遮挡应被自动修复。' } },
    target: {
      html_video_generation_mode: 'raw_html',
      generateAudio: false,
    },
    templateRegistry,
    runLayoutQa: true,
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
                synopsis: '一帧布局修复',
                nodes: [{ id: 'scene_01', kind: 'text', label: '修复标题', durationSec: 2, text: '修复正文' }],
                edges: [],
              }),
            };
          }
          const repaired = prompt.includes('布局修复要求');
          return {
            success: true,
            text: `<!doctype html><html><body><main data-frame-id="scene_01"${repaired ? ' data-layout-v2="true"' : ''}><h1 data-text-key="headline">修复标题</h1><p data-text-key="subtitle">修复旁白</p><section data-text-key="body">修复正文</section></main></body></html>`,
          };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      layoutQaService: {
        inspectFrameHtmlLayout: async ({ htmlPath, frame }) => {
          const html = await fs.readFile(htmlPath, 'utf8');
          const passed = html.includes('data-layout-v2');
          layoutRepairQaCalls.push({ htmlPath, frameId: frame.id, passed });
          return passed
            ? { success: true, issues: [], metrics: {} }
            : {
              success: false,
              issues: [{ code: 'text_overlap', message: 'CTA 覆盖正文卡片。', severity: 'error' }],
              metrics: {},
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
        concatAudioWithFfmpeg: async () => ({ success: true, skipped: true }),
        muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
      },
    },
  });
  assert.equal(layoutRepairSuccessResult.success, true);
  // 首检失败 + 修复后复检通过；skipValidation 下渲染前 gate 不再重复检查
  assert.equal(layoutRepairQaCalls.length, 2);
  assert.equal(layoutRepairQaCalls[0].passed, false);
  assert.equal(layoutRepairQaCalls[1].passed, true);
  const repairedFrameHtml = await fs.readFile(path.join(layoutRepairSuccessResult.html_video_project_path, layoutRepairSuccessResult.project.frames[0].html_path), 'utf8');
  assert.ok(repairedFrameHtml.includes('data-layout-v2'));
  assert.equal(layoutRepairSuccessResult.html_video_diagnostics.some(item => item.code === 'frame_layout_qa_unresolved'), false);

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
          const frameId = prompt.includes('当前帧：scene_02') || prompt.includes('当前帧 id：scene_02') ? 'scene_02' : 'scene_01';
          const suffix = frameId === 'scene_02' ? '二' : '一';
          return {
            success: true,
            text: `<!doctype html><html><head><style>html,body,#app{width:1080px;height:1920px;margin:0;} main{width:1080px;height:1920px;animation:fade 1s ease;} @keyframes fade{from{opacity:.2}to{opacity:1}}</style></head><body><main id="app" data-frame-id="${frameId}"><h1 data-text-key="headline">异常时间轴${suffix}</h1><p data-text-key="subtitle">异常长字幕${suffix}</p><section data-text-key="body">异常长旁白${suffix}</section></main></body></html>`,
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

  const failedHtmlResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000007_failed_html',
    runId: 'run_failed_html',
    rootDir,
    sceneSpec: {
      title: '失败 HTML 落盘',
      aspect_ratio: '16:9',
      scenes: [
        {
          id: 'scene_01',
          duration: 2,
          kind: 'text',
          narration_text: '失败 HTML 需要落盘。',
          captions: fullSceneCaption('scene_01', '失败 HTML 需要落盘。', 2),
          visual_text: { headline: '失败 HTML', keywords: [], cards: [] },
        },
      ],
    },
    creativeContext: { input: { raw_text: '失败 HTML 落盘' } },
    target: { html_video_generation_mode: 'raw_html', generateAudio: false },
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
                synopsis: '失败 HTML 落盘',
                nodes: [{ id: 'scene_01', kind: 'text', label: '失败 HTML', durationSec: 2, text: '失败 HTML 需要落盘。' }],
                edges: [],
              }),
            };
          }
          return {
            success: true,
            text: [
              '<!doctype html><html><head>',
              '<style>.stage{width:900px;height:870px}</style>',
              '</head><body>',
              '<div class="stage"><h1 data-text-key="headline">失败 HTML</h1><p data-text-key="subtitle">落盘</p><section data-text-key="body">失败 HTML 需要落盘。</section></div>',
              '</body></html>',
            ].join(''),
          };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
    },
  });
  assert.equal(failedHtmlResult.success, false);
  const failedHtmlDiagnostic = failedHtmlResult.html_video_diagnostics.find(item => item.code === 'html_validation_failed');
  assert.ok(failedHtmlDiagnostic?.details?.failed_html_path);
  assert.equal(failedHtmlDiagnostic.details.validation_code, 'frame_html_invalid');
  const failedHtmlPath = path.join(failedHtmlResult.project_dir, failedHtmlDiagnostic.details.failed_html_path);
  const failedHtmlContent = await fs.readFile(failedHtmlPath, 'utf8');
  assert.match(failedHtmlContent, /\.stage/);

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
  let graphMismatchRenderCalls = 0;
  projectOrchestrator.renderHtmlVideoProject = async ({ project, projectDir }) => {
    graphMismatchRenderCalls += 1;
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
    assert.equal(graphMismatchResult.success, false);
    assert.match(graphMismatchResult.message, /画面结构与旁白脚本不一致/);
    assert.equal(graphMismatchRenderCalls, 0);
    const mismatchDiagnostic = graphMismatchResult.html_video_diagnostics.find(item => item.code === 'content_graph_scene_spec_mismatch');
    assert.ok(mismatchDiagnostic);
    assert.equal(mismatchDiagnostic.stage, 'ai-content-graph');
    assert.equal(mismatchDiagnostic.fallback_allowed, false);
    assert.equal(mismatchDiagnostic.sub_stage, 'content_graph');
    assert.equal(mismatchDiagnostic.details.reason, 'node_count_mismatch');
    assert.ok(graphProgressEvents.some(event => event.sub_stage === 'content_graph' && String(event.message || '').includes('content graph 与字幕脚本不一致')));
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
    assert.equal(latestRootBugResult.success, false, JSON.stringify({
      message: latestRootBugResult.message,
      diagnostics: latestRootBugResult.html_video_diagnostics,
    }, null, 2));
    assert.match(latestRootBugResult.message, /画面结构与旁白脚本不一致/);
    assert.equal(latestRootBugTtsCalls, 0);
    assert.equal(latestRootBugMuxedAudio, null);
    assert.ok(latestRootBugResult.html_video_diagnostics.some(item => item.code === 'content_graph_scene_spec_mismatch'));
    assert.equal(latestRootBugResult.html_video_diagnostics.some(item => item.code === 'audio_scene_spec_hash_mismatch'), false);
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

  const reuseSceneSpec = {
    title: '内容图复用测试',
    aspect_ratio: '16:9',
    scenes: [{ id: 'scene_01', duration: 2, kind: 'text', narration_text: '复用旁白', captions: fullSceneCaption('scene_01', '复用旁白', 2), visual_text: { headline: '复用标题' } }],
  };
  const renderServices = {
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
    visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
  };
  let secondRunContentGraphCalls = 0;
  const firstReuseResult = await workflow.generateHtmlVideo({
    workflowId: 'wf-content-graph-reuse',
    runId: 'run-content-graph-reuse',
    rootDir,
    sceneSpec: reuseSceneSpec,
    creativeContext: { input: { raw_text: '内容图复用测试' } },
    target: { preferredTemplateId: 'simple', lockTemplate: true, generateAudio: false },
    templateRegistry,
    skipValidation: true,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.startsWith('你是 html-video 的 content graph')) {
            return { success: true, text: JSON.stringify({ synopsis: '复用测试', nodes: [{ id: 'scene_01', kind: 'text', label: '复用标题', durationSec: 2, text: '复用正文' }], edges: [] }) };
          }
          return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">复用标题</h1><p data-text-key="subtitle">复用旁白</p><section data-text-key="body">复用正文</section></main></body></html>' };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      ...renderServices,
    },
  });
  assert.equal(firstReuseResult.success, true);
  const secondReuseResult = await workflow.generateHtmlVideo({
    workflowId: 'wf-content-graph-reuse',
    runId: 'run-content-graph-reuse',
    rootDir,
    sceneSpec: reuseSceneSpec,
    creativeContext: { input: { raw_text: '内容图复用测试' } },
    target: { preferredTemplateId: 'simple', lockTemplate: true, generateAudio: false },
    templateRegistry,
    skipValidation: true,
    services: {
      aiTextModel: {
        callTextModel: async request => {
          if (request.audit?.stage === 'content_graph') {
            secondRunContentGraphCalls += 1;
            throw new Error('不应重新生成 content graph');
          }
          return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">复用标题</h1><p data-text-key="subtitle">复用旁白</p><section data-text-key="body">复用正文</section></main></body></html>' };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      ...renderServices,
    },
  });
  assert.equal(secondReuseResult.success, true);
  assert.equal(secondRunContentGraphCalls, 0);
  assert.equal(secondReuseResult.project.generation_checkpoint.stages.content_graph.reused, true);

  // Retry-path regression: the resume entry must succeed even when the caller no longer
  // has scene_spec in memory. The first run persists scene-spec.json; a later run that
  // omits sceneSpec must hydrate it from disk so template selection + content-graph reuse
  // still work (previously this failed with "没有可用的 html-video 模板").
  const persistedSceneSpecPath = path.join(
    rootDir,
    'wf-content-graph-reuse',
    'agent_runs',
    'run-content-graph-reuse-html-video',
    'scene-spec.json',
  );
  assert.ok(JSON.parse(await fs.readFile(persistedSceneSpecPath, 'utf8')).scenes.length > 0);
  let hydratedRunContentGraphCalls = 0;
  const hydratedReuseResult = await workflow.generateHtmlVideo({
    workflowId: 'wf-content-graph-reuse',
    runId: 'run-content-graph-reuse',
    rootDir,
    // sceneSpec intentionally omitted to mimic the retry path
    creativeContext: { input: { raw_text: '内容图复用测试' } },
    target: { preferredTemplateId: 'simple', lockTemplate: true, generateAudio: false },
    templateRegistry,
    skipValidation: true,
    reuseContentGraph: true,
    projectOptions: { reuseContentGraph: true },
    services: {
      aiTextModel: {
        callTextModel: async request => {
          if (request.audit?.stage === 'content_graph') {
            hydratedRunContentGraphCalls += 1;
            throw new Error('不应重新生成 content graph');
          }
          return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">复用标题</h1><p data-text-key="subtitle">复用旁白</p><section data-text-key="body">复用正文</section></main></body></html>' };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      ...renderServices,
    },
  });
  assert.equal(hydratedReuseResult.success, true);
  assert.equal(hydratedRunContentGraphCalls, 0);
  assert.equal(hydratedReuseResult.project.generation_checkpoint.stages.content_graph.reused, true);

  let regenerateContentGraphCalls = 0;
  let regenerateFrameHtmlCalls = 0;
  const regenerateFrameResult = await workflow.generateHtmlVideo({
    workflowId: 'wf-content-graph-reuse',
    runId: 'run-content-graph-reuse',
    rootDir,
    sceneSpec: reuseSceneSpec,
    creativeContext: { input: { raw_text: '内容图复用测试' } },
    projectOptions: { reuseContentGraph: true, regenerateFrameHtml: true },
    target: { preferredTemplateId: 'simple', lockTemplate: true, generateAudio: false },
    templateRegistry,
    skipValidation: true,
    services: {
      aiTextModel: {
        callTextModel: async request => {
          if (request.audit?.stage === 'content_graph') {
            regenerateContentGraphCalls += 1;
            throw new Error('不应重新生成 content graph');
          }
          regenerateFrameHtmlCalls += 1;
          return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">复用标题</h1><p data-text-key="subtitle">复用旁白</p><section data-text-key="body">重绘正文</section></main></body></html>' };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      ...renderServices,
    },
  });
  assert.equal(regenerateFrameResult.success, true);
  assert.equal(regenerateContentGraphCalls, 0);
  assert.equal(regenerateFrameHtmlCalls, 1);
  assert.equal(regenerateFrameResult.project.generation_checkpoint.stages.content_graph.reused, true);
  assert.equal(regenerateFrameResult.project.generation_checkpoint.stages.frame_html.frames.scene_01.status, 'done');

  const missingReuseResult = await workflow.generateHtmlVideo({
    workflowId: 'wf-content-graph-reuse-missing',
    runId: 'run-content-graph-reuse-missing',
    rootDir,
    sceneSpec: reuseSceneSpec,
    creativeContext: { input: { raw_text: '内容图复用测试' } },
    projectOptions: { reuseContentGraph: true },
    target: { preferredTemplateId: 'simple', lockTemplate: true, generateAudio: false },
    templateRegistry,
    skipValidation: true,
    services: {
      aiTextModel: {
        callTextModel: async request => {
          if (request.audit?.stage === 'content_graph') throw new Error('缺失复用内容图时不应生成 content graph');
          return { success: true, text: '' };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      ...renderServices,
    },
  });
  assert.equal(missingReuseResult.success, false);
  assert.equal(missingReuseResult.html_video_diagnostics[0].code, 'content_graph_reuse_missing');
  assert.equal(missingReuseResult.message, '未找到可复用的内容图，请先完整生成一次视频。');

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
