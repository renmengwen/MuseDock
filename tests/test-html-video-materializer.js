const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { normalizeProject } = require('../server/services/creative-video/html-video/projectSchema');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { materializeProject } = require('../server/services/creative-video/html-video/materializer');
const {
  renderHtmlVideoFrames,
  composeHtmlVideoProject,
} = require('../server/services/creative-video/html-video/projectOrchestrator');
const {
  validateSceneSpecTimelineConsistency,
} = require('../server/services/creative-video/html-video/timelineConsistency');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function createTemplate(rootDir, options = {}) {
  const templateId = options.id || 'variable_title';
  const templateDir = path.join(rootDir, templateId);
  await writeFile(path.join(templateDir, 'template.html-video.yaml'), [
    `id: ${templateId}`,
    'name: 变量标题',
    'engine: hyperframes',
    'engine_version: "1.0.0"',
    'source_entry: source/index.html',
    'output:',
    '  resolution:',
    '    width: 1920',
    '    height: 1080',
    '  fps: 30',
    '  duration: 6',
    'inputs:',
    '  schema:',
    '    title:',
    '      type: string',
    '    subtitle:',
    '      type: string',
    '    duration_sec:',
    '      type: number',
    '  examples:',
    '    - title: 默认标题',
    '      subtitle: 默认副标题',
    '      duration_sec: 6',
    'preview:',
    '  poster: preview.png',
    'license:',
    '  commercial_use: true',
    'assets_attribution: []',
    '',
  ].join('\n'));
  await writeFile(path.join(templateDir, 'source/index.html'), [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="UTF-8"><title>{{title}}</title></head>',
    '<body>',
    '<h1 data-hv-element-id="title" data-hv-bind="title">{{title}}</h1>',
    '<p data-hv-element-id="subtitle" data-hv-bind="subtitle">{{subtitle}}</p>',
    options.includeUnmanagedCaptionLayer ? '<div data-hv-layer="captions" data-hv-managed="false">模板字幕</div>' : '',
    '<span data-hv-element-id="duration" data-hv-bind="duration_sec">{{duration_sec}}</span>',
    '<script>',
    'const vars = window.__HV_VARS__ || {};',
    'const duration = Number(window.__HV_DURATION__ || vars.duration_sec || 6);',
    'document.querySelector("[data-hv-bind=title]").textContent = vars.title || "默认标题";',
    '</script>',
    '</body>',
    '</html>',
  ].join('\n'));
  return templateDir;
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-materializer-'));
  const templateRoot = path.join(rootDir, 'templates');
  const projectDir = path.join(rootDir, 'project');
  await fs.mkdir(projectDir, { recursive: true });
  await createTemplate(templateRoot);
  await createTemplate(templateRoot, { id: 'variable_title_unmanaged', includeUnmanagedCaptionLayer: true });

  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();

  const project = normalizeProject({
    project_id: 'project_001',
    template_id: 'variable_title',
    template_inputs: {
      title: '全局标题',
      subtitle: '全局副标题',
      duration_sec: 6,
    },
    frames: [
      {
        id: 'scene_01',
        scene_id: 'scene_01',
        order: 1,
        template_id: 'variable_title',
        duration_sec: 4,
        inputs: {
          title: '安全标题 </script><script>window.__x=1</script>',
          subtitle: '<img src=x onerror=alert(1)>',
          duration_sec: 4,
        },
        metadata: {
          visual_text: {
            headline: '第一幕',
            cards: ['卡片一'],
            keywords: ['关键词一'],
          },
        },
      },
      {
        id: 'scene_02',
        scene_id: 'scene_02',
        order: 2,
        template_id: 'variable_title',
        duration_sec: 5,
        inputs: {
          title: '不应覆盖',
          subtitle: 'override 生效',
          duration_sec: 5,
        },
      },
    ],
    overrides: {
      html: {
        enabled: true,
        frames: {
          scene_02: {
            enabled: true,
            html_path: 'frames/custom_scene_02.html',
          },
        },
      },
    },
  });

  await writeFile(path.join(projectDir, 'frames/custom_scene_02.html'), '<html><body>用户改写</body></html>');

  const result = await materializeProject({ projectDir, project, templateRegistry });

  assert.equal(result.project.frames[0].html_path, 'frames/01-scene_01.html');
  assert.equal(result.project.frames[1].html_path, 'frames/custom_scene_02.html');
  assert.ok(result.diagnostics.some(item => item.code === 'html_override_active' && item.frame_id === 'scene_02'));

  const html = await fs.readFile(path.join(projectDir, result.project.frames[0].html_path), 'utf8');
  assert.ok(html.includes('<script>window.__HV_VARS__ = '));
  assert.ok(html.includes('window.__HV_DURATION__ = 4;'));
  assert.match(html, /window\.__HV_SCENE__/);
  assert.match(html, /"headline":"第一幕"/);
  assert.ok(html.includes('data-hv-element-id="title"'));
  assert.ok(html.includes('data-hv-bind="subtitle"'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!html.includes('</script><script>window.__x=1</script>'));
  assert.match(html, /"title":"安全标题 \\u003C\/script\\u003E\\u003Cscript\\u003Ewindow.__x=1\\u003C\/script\\u003E"/);
  assert.ok(html.includes('<title>安全标题 &lt;/script&gt;&lt;script&gt;window.__x=1&lt;/script&gt;</title>'));

  const overrideHtml = await fs.readFile(path.join(projectDir, 'frames/custom_scene_02.html'), 'utf8');
  assert.equal(overrideHtml, '<html><body>用户改写</body></html>');

  const unmanagedTemplateProjectDir = path.join(rootDir, 'unmanaged-template-project');
  await fs.mkdir(unmanagedTemplateProjectDir, { recursive: true });
  const unmanagedTemplateResult = await materializeProject({
    projectDir: unmanagedTemplateProjectDir,
    project: normalizeProject({
      project_id: 'project_unmanaged_template',
      template_id: 'variable_title_unmanaged',
      template_inputs: { title: '标题', subtitle: '副标题', duration_sec: 3 },
      frames: [
        {
          id: 'template_unmanaged_01',
          scene_id: 'template_unmanaged_01',
          order: 1,
          template_id: 'variable_title_unmanaged',
          duration_sec: 3,
          narration_text: '模板帧旁白',
          inputs: { title: '标题', subtitle: '副标题', duration_sec: 3 },
        },
      ],
    }),
    templateRegistry,
  });
  assert.ok(unmanagedTemplateResult.diagnostics.some(item => item.code === 'unmanaged_caption_layer_preserved' && item.frame_id === 'template_unmanaged_01'));
  const unmanagedTemplateHtml = await fs.readFile(path.join(unmanagedTemplateProjectDir, unmanagedTemplateResult.project.frames[0].html_path), 'utf8');
  assert.equal((unmanagedTemplateHtml.match(/data-hv-layer="captions"/g) || []).length, 2);
  assert.match(unmanagedTemplateHtml, /模板字幕/);
  assert.match(unmanagedTemplateHtml, /模板帧旁白/);

  const unmanagedTemplateEmptyProjectDir = path.join(rootDir, 'unmanaged-template-empty-project');
  await fs.mkdir(unmanagedTemplateEmptyProjectDir, { recursive: true });
  const unmanagedTemplateEmptyResult = await materializeProject({
    projectDir: unmanagedTemplateEmptyProjectDir,
    project: normalizeProject({
      project_id: 'project_unmanaged_template_empty',
      template_id: 'variable_title_unmanaged',
      template_inputs: { title: '标题', subtitle: '副标题', duration_sec: 3 },
      frames: [
        {
          id: 'template_unmanaged_empty_01',
          scene_id: 'template_unmanaged_empty_01',
          order: 1,
          template_id: 'variable_title_unmanaged',
          duration_sec: 3,
          narration_text: '',
          captions: [],
          inputs: { title: '标题', subtitle: '副标题', duration_sec: 3 },
        },
      ],
    }),
    templateRegistry,
  });
  assert.ok(unmanagedTemplateEmptyResult.diagnostics.some(item => item.code === 'unmanaged_caption_layer_preserved' && item.frame_id === 'template_unmanaged_empty_01'));
  const unmanagedTemplateEmptyHtml = await fs.readFile(path.join(unmanagedTemplateEmptyProjectDir, unmanagedTemplateEmptyResult.project.frames[0].html_path), 'utf8');
  assert.equal((unmanagedTemplateEmptyHtml.match(/data-hv-layer="captions"/g) || []).length, 1);
  assert.match(unmanagedTemplateEmptyHtml, /模板字幕/);

  const rawProjectDir = path.join(rootDir, 'raw-project');
  await writeFile(path.join(rawProjectDir, 'frames/01-raw.html'), '<!doctype html><html><body>raw</body></html>');
  const rawResult = await materializeProject({
    projectDir: rawProjectDir,
    project: normalizeProject({
      project_id: 'project_raw',
      frames: [
        {
          id: 'raw_01',
          scene_id: 'raw_01',
          order: 1,
          source_mode: 'raw_html',
          html_path: 'frames/01-raw.html',
          duration_sec: 2,
          narration_text: 'raw 旁白',
          metadata: { from: 'raw-builder' },
        },
      ],
    }),
    templateRegistry,
  });
  assert.equal(rawResult.project.frames[0].html_path, 'frames/01-raw.html');
  assert.equal(rawResult.project.frames[0].source_mode, 'raw_html');
  assert.equal(rawResult.project.frames[0].narration_text, 'raw 旁白');
  assert.equal(rawResult.project.frames[0].captions[0].text, 'raw 旁白');
  assert.equal(rawResult.project.frames[0].metadata.from, 'raw-builder');
  assert.ok(rawResult.diagnostics.some(item => item.code === 'raw_html_caption_injected' && item.frame_id === 'raw_01'));
  const rawHtml = await fs.readFile(path.join(rawProjectDir, 'frames/01-raw.html'), 'utf8');
  assert.match(rawHtml, /data-role="subtitle-caption"/);
  assert.match(rawHtml, /raw 旁白/);

  const disabledCaptionProjectDir = path.join(rootDir, 'disabled-caption-project');
  const disabledCaptionResult = await materializeProject({
    projectDir: disabledCaptionProjectDir,
    project: normalizeProject({
      project_id: 'project_disabled_caption',
      template_id: 'variable_title',
      template_inputs: { title: '标题', subtitle: '副标题', duration_sec: 3 },
      frames: [
        {
          id: 'disabled_caption_01',
          scene_id: 'disabled_caption_01',
          order: 1,
          template_id: 'variable_title',
          duration_sec: 3,
          narration_text: '这段旁白不应该被注入字幕层。',
          captions: [],
          generate_captions: false,
          inputs: { title: '标题', subtitle: '副标题', duration_sec: 3 },
        },
      ],
    }),
    templateRegistry,
  });
  assert.deepEqual(disabledCaptionResult.project.frames[0].captions, []);
  const disabledCaptionHtml = await fs.readFile(path.join(disabledCaptionProjectDir, disabledCaptionResult.project.frames[0].html_path), 'utf8');
  assert.doesNotMatch(disabledCaptionHtml, /data-hv-layer="captions"/);

  const rawUnmanagedProjectDir = path.join(rootDir, 'raw-unmanaged-project');
  await writeFile(
    path.join(rawUnmanagedProjectDir, 'frames/01-raw.html'),
    '<!doctype html><html><body><div data-hv-layer="captions" data-hv-managed="false">模板字幕</div></body></html>',
  );
  const rawUnmanagedResult = await materializeProject({
    projectDir: rawUnmanagedProjectDir,
    project: normalizeProject({
      project_id: 'project_raw_unmanaged',
      frames: [
        {
          id: 'raw_unmanaged_01',
          scene_id: 'raw_unmanaged_01',
          order: 1,
          source_mode: 'raw_html',
          html_path: 'frames/01-raw.html',
          duration_sec: 2,
          narration_text: 'raw 非受管旁白',
        },
      ],
    }),
    templateRegistry,
  });
  assert.ok(rawUnmanagedResult.diagnostics.some(item => item.code === 'unmanaged_caption_layer_preserved' && item.frame_id === 'raw_unmanaged_01'));
  const rawUnmanagedHtml = await fs.readFile(path.join(rawUnmanagedProjectDir, 'frames/01-raw.html'), 'utf8');
  assert.equal((rawUnmanagedHtml.match(/data-hv-layer="captions"/g) || []).length, 2);
  assert.match(rawUnmanagedHtml, /模板字幕/);
  assert.match(rawUnmanagedHtml, /raw 非受管旁白/);

  const rawUnmanagedEmptyProjectDir = path.join(rootDir, 'raw-unmanaged-empty-project');
  await writeFile(
    path.join(rawUnmanagedEmptyProjectDir, 'frames/01-raw.html'),
    '<!doctype html><html><body><div data-hv-layer="captions" data-hv-managed="false">模板字幕</div></body></html>',
  );
  const rawUnmanagedEmptyResult = await materializeProject({
    projectDir: rawUnmanagedEmptyProjectDir,
    project: normalizeProject({
      project_id: 'project_raw_unmanaged_empty',
      frames: [
        {
          id: 'raw_unmanaged_empty_01',
          scene_id: 'raw_unmanaged_empty_01',
          order: 1,
          source_mode: 'raw_html',
          html_path: 'frames/01-raw.html',
          duration_sec: 2,
          narration_text: '',
          captions: [],
        },
      ],
    }),
    templateRegistry,
  });
  assert.ok(rawUnmanagedEmptyResult.diagnostics.some(item => item.code === 'unmanaged_caption_layer_preserved' && item.frame_id === 'raw_unmanaged_empty_01'));
  const rawUnmanagedEmptyHtml = await fs.readFile(path.join(rawUnmanagedEmptyProjectDir, 'frames/01-raw.html'), 'utf8');
  assert.equal((rawUnmanagedEmptyHtml.match(/data-hv-layer="captions"/g) || []).length, 1);
  assert.match(rawUnmanagedEmptyHtml, /模板字幕/);

  const rawNoRegistryProjectDir = path.join(rootDir, 'raw-no-registry-project');
  await writeFile(path.join(rawNoRegistryProjectDir, 'frames/01-raw.html'), '<!doctype html><html><body>raw no registry</body></html>');
  const rawNoRegistryResult = await materializeProject({
    projectDir: rawNoRegistryProjectDir,
    project: normalizeProject({
      project_id: 'project_raw_no_registry',
      frames: [
        {
          id: 'raw_no_registry_01',
          scene_id: 'raw_no_registry_01',
          order: 1,
          source_mode: 'raw_html',
          html_path: 'frames/01-raw.html',
          duration_sec: 2,
          narration_text: 'raw 无 registry 旁白',
        },
      ],
    }),
  });
  assert.equal(rawNoRegistryResult.project.frames[0].captions[0].text, 'raw 无 registry 旁白');
  const rawNoRegistryHtml = await fs.readFile(path.join(rawNoRegistryProjectDir, 'frames/01-raw.html'), 'utf8');
  assert.match(rawNoRegistryHtml, /raw 无 registry 旁白/);

  const sharedRawBeatProjectDir = path.join(rootDir, 'shared-raw-beat-project');
  await writeFile(
    path.join(sharedRawBeatProjectDir, 'frames/shared.html'),
    '<!doctype html><html><body><main>shared raw</main></body></html>',
  );
  const sharedRawBeatResult = await materializeProject({
    projectDir: sharedRawBeatProjectDir,
    project: normalizeProject({
      project_id: 'project_shared_raw_beat',
      frames: [
        {
          id: 'scene_long_b1',
          scene_id: 'scene_long',
          beat_id: 'scene_long_b1',
          order: 1,
          source_mode: 'raw_html',
          html_path: 'frames/shared.html',
          duration_sec: 3,
          captions: [{ start: 0, end: 3, text: '第一段字幕' }],
        },
        {
          id: 'scene_long_b2',
          scene_id: 'scene_long',
          beat_id: 'scene_long_b2',
          order: 2,
          source_mode: 'raw_html',
          html_path: 'frames/shared.html',
          duration_sec: 3,
          captions: [{ start: 0, end: 3, text: '第二段字幕' }],
        },
      ],
    }),
  });
  const [firstBeatFrame, secondBeatFrame] = sharedRawBeatResult.project.frames;
  assert.notEqual(firstBeatFrame.html_path, secondBeatFrame.html_path);
  const firstBeatHtml = await fs.readFile(path.join(sharedRawBeatProjectDir, firstBeatFrame.html_path), 'utf8');
  const secondBeatHtml = await fs.readFile(path.join(sharedRawBeatProjectDir, secondBeatFrame.html_path), 'utf8');
  assert.match(firstBeatHtml, /第一段字幕/);
  assert.doesNotMatch(firstBeatHtml, /第二段字幕/);
  assert.match(secondBeatHtml, /第二段字幕/);
  assert.doesNotMatch(secondBeatHtml, /第一段字幕/);
  const mixedBeatValidation = validateSceneSpecTimelineConsistency({
    sceneSpec: { scenes: [{ id: 'scene_long', narration_text: '旁白' }] },
    project: {
      frames: [
        { id: 'scene_long', scene_id: 'scene_long', duration_sec: 3, narration_text: '旁白' },
        { id: 'scene_long_b2', scene_id: 'scene_long', beat_id: 'scene_long_b2', duration_sec: 3, narration_text: '旁白' },
      ],
    },
    mediaOptions: { generateCaptions: false, generateAudio: false },
  });
  assert.equal(mixedBeatValidation.ok, false);
  assert.ok(mixedBeatValidation.diagnostics.some(item => item.code === 'frame_scene_duplicate' && item.frame_id === 'scene_long'));

  const beatRenderProjectDir = path.join(rootDir, 'beat-render-project');
  await fs.mkdir(beatRenderProjectDir, { recursive: true });
  const beatProject = normalizeProject({
    project_id: 'beat_render_project',
    output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 18 },
    audio: { status: 'skipped', reason: 'disabled_by_settings' },
    frames: [
      { id: 'scene_long_b1', scene_id: 'scene_long', beat_id: 'scene_long_b1', order: 1, duration_sec: 6, engine: 'hyperframes-playwright', html_path: 'frames/long.html' },
      { id: 'scene_long_b2', scene_id: 'scene_long', beat_id: 'scene_long_b2', order: 2, duration_sec: 6, engine: 'hyperframes-playwright', html_path: 'frames/long.html' },
      { id: 'scene_long_b3', scene_id: 'scene_long', beat_id: 'scene_long_b3', order: 3, duration_sec: 6, engine: 'hyperframes-playwright', html_path: 'frames/long.html' },
    ],
  });
  await writeFile(path.join(beatRenderProjectDir, 'frames/long.html'), '<!doctype html><html><body>long</body></html>');
  const renderedBeatPaths = [];
  const renderResult = await renderHtmlVideoFrames({
    projectDir: beatRenderProjectDir,
    project: beatProject,
    services: {
      frameRenderer: {
        renderFrame: async (_frame, { outputPath }) => {
          await writeFile(outputPath, `mp4:${path.basename(outputPath)}`);
          renderedBeatPaths.push(outputPath);
          return { success: true, output_path: outputPath, output_hash: path.basename(outputPath), meta: {} };
        },
      },
    },
  });
  assert.equal(renderResult.success, true);
  assert.deepEqual(Object.keys(renderResult.project.generation_checkpoint.stages.render.frames).sort(), [
    'scene_long_b1',
    'scene_long_b2',
    'scene_long_b3',
  ]);
  assert.equal(new Set(renderedBeatPaths.map(item => path.basename(item))).size, 3);
  const composeResult = await composeHtmlVideoProject({
    projectDir: beatRenderProjectDir,
    project: renderResult.project,
    services: {
      ffmpegComposer: {
        concatFramesWithFfmpeg: async (frames, outputPath) => {
          const basenames = frames.map(frame => path.basename(frame.path));
          assert.deepEqual(basenames, ['scene_long_b1.mp4', 'scene_long_b2.mp4', 'scene_long_b3.mp4']);
          assert.equal(new Set(basenames).size, 3);
          await writeFile(outputPath, 'combined');
          return { success: true, output_path: outputPath };
        },
        muxAudioWithFfmpeg: async () => ({ success: true }),
      },
    },
  });
  assert.equal(composeResult.success, true);

  console.log('html-video materializer tests passed');
})();
