const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { validateHtmlVideoProject } = require('../server/services/creative-video/html-video/validationGate');
const { ensureCaptionLayer } = require('../server/services/creative-video/html-video/captionLayer');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function createTemplate(rootDir, name, yaml, sourceName = 'index.html') {
  const dir = path.join(rootDir, name);
  await writeFile(path.join(dir, 'template.html-video.yaml'), yaml);
  await writeFile(path.join(dir, sourceName), '<html><body>{{headline}}</body></html>');
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-gate-'));
  const templateRoot = path.join(rootDir, 'templates');

  await createTemplate(templateRoot, 'valid', [
    'id: valid',
    'name: 可用模板',
    'engine: hyperframes',
    'source_entry: index.html',
    'inputs:',
    '  schema:',
    '    type: object',
    '    required: [headline]',
    '    properties:',
    '      headline:',
    '        type: string',
    'license:',
    '  name: Apache-2.0',
    '  commercial_use: true',
    '',
  ].join('\n'));

  await createTemplate(templateRoot, 'bad_engine', [
    'id: bad_engine',
    'name: 不支持引擎',
    'engine: remotion',
    'source_entry: index.html',
    'inputs:',
    '  schema:',
    '    type: object',
    'license:',
    '  commercial_use: true',
    '',
  ].join('\n'));

  await createTemplate(templateRoot, 'script_source', [
    'id: script_source',
    'name: 非 HTML 入口',
    'engine: hyperframes',
    'source_entry: index.js',
    'inputs:',
    '  schema:',
    '    type: object',
    'license:',
    '  commercial_use: true',
    '',
  ].join('\n'), 'index.js');

  await createTemplate(templateRoot, 'noncommercial', [
    'id: noncommercial',
    'name: 不可商用',
    'engine: hyperframes',
    'source_entry: index.html',
    'inputs:',
    '  schema:',
    '    type: object',
    'license:',
    '  commercial_use: false',
    '',
  ].join('\n'));

  const registry = createTemplateRegistry({ rootDir: templateRoot });
  registry.scanTemplates();

  const timelineSceneSpec = {
    scenes: [
      { id: 'scene_01', order: 1, narration_text: '第一段', captions: [{ text: '字幕一' }] },
    ],
  };

  function timelineGateProject(audio, frameOverrides = {}) {
    return {
      template_id: 'valid',
      template_inputs: { headline: '标题' },
      output: { resolution: { width: 1920, height: 1080 }, fps: 30 },
      frames: [
        {
          id: 'scene_01',
          scene_id: 'scene_01',
          template_id: 'valid',
          inputs: { headline: '帧标题' },
          narration_text: '第一段',
          captions: [{ text: '字幕一' }],
          ...frameOverrides,
        },
      ],
      audio,
    };
  }

  function assertHasDiagnostic(result, code) {
    assert.equal(result.diagnostics.some(item => item.code === code), true);
  }

  function assertLacksDiagnostic(result, code) {
    assert.equal(result.diagnostics.some(item => item.code === code), false);
  }

  const project = {
    template_id: 'missing',
    template_inputs: {},
    frames: [
      { id: 'f1', template_id: 'valid', inputs: {}, engine: 'unknown-engine', html_path: 'frames/f1.html' },
      { id: 'f2', template_id: 'script_source', inputs: {}, html_path: 'frames/f2.html' },
      { id: 'f3', template_id: 'noncommercial', inputs: {}, html_path: 'frames/f3.html' },
      { id: 'f4', template_id: 'valid', inputs: {}, html_path: 'frames/f4.html' },
    ],
    assets: [{ id: 'a1', path: '../escape.png' }],
    timeline: { tracks: [{ id: 'main', items: [{ id: 'bad', kind: 'clip' }] }] },
    overrides: { html: { enabled: true, frames: { f1: { enabled: true, html_path: 'frames/f1.html' } } } },
  };

  const result = await validateHtmlVideoProject({
    project,
    templateRegistry: registry,
    environment: {
      ok: false,
      diagnostics: [
        { ok: false, code: 'playwright_missing', message: 'Playwright 未配置。' },
        { ok: false, code: 'ffmpeg_missing', message: 'ffmpeg 未配置。' },
      ],
    },
  });

  assert.equal(result.ok, false);
  const codes = result.diagnostics.map(item => item.code);
  for (const code of [
    'template_missing',
    'unsupported_engine',
    'source_entry_not_html',
    'license_not_allowed',
    'template_inputs_invalid',
    'timeline_item_kind_unsupported',
    'asset_path_invalid',
    'playwright_not_configured',
    'ffmpeg_not_configured',
    'html_override_active',
  ]) {
    assert.ok(codes.includes(code), `缺少诊断 ${code}`);
  }
  assert.equal(result.diagnostics.find(item => item.code === 'license_not_allowed').fallback_allowed, false);
  const playwrightDiagnostic = result.diagnostics.find(item => item.code === 'playwright_not_configured');
  const ffmpegDiagnostic = result.diagnostics.find(item => item.code === 'ffmpeg_not_configured');
  assert.equal(playwrightDiagnostic.sub_stage, 'validate_project');
  assert.equal(ffmpegDiagnostic.sub_stage, 'validate_project');
  assert.equal(Object.hasOwn(playwrightDiagnostic.details, 'sub_stage'), false);
  assert.equal(Object.hasOwn(ffmpegDiagnostic.details, 'sub_stage'), false);

  for (const diagnostic of result.diagnostics) {
    assert.equal(typeof diagnostic.code, 'string');
    assert.equal(typeof diagnostic.stage, 'string');
    assert.equal(typeof diagnostic.user_message, 'string');
    assert.equal(typeof diagnostic.details, 'object');
    assert.equal(typeof diagnostic.fallback_allowed, 'boolean');
    assert.match(diagnostic.user_message, /[\u4e00-\u9fa5]/);
  }

  const pass = await validateHtmlVideoProject({
    project: {
      template_id: 'valid',
      template_inputs: { headline: '标题' },
      frames: [{ id: 'f1', template_id: 'valid', inputs: { headline: '帧标题' }, html_path: 'frames/f1.html' }],
      assets: [{ id: 'a1', path: 'assets/a.png' }],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'f1', kind: 'frame' }] }] },
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(pass.ok, true);
  assert.deepEqual(pass.diagnostics, []);

  const captionFallbackPass = await validateHtmlVideoProject({
    project: {
      template_id: 'valid',
      template_inputs: { headline: '标题' },
      frames: [{ id: 'caption_fallback', template_id: 'valid', inputs: { headline: '帧标题' }, narration_text: '这句旁白会自动生成字幕。' }],
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(captionFallbackPass.ok, true);
  assertLacksDiagnostic(captionFallbackPass, 'caption_missing_for_narration');

  const captionDisabledWarning = await validateHtmlVideoProject({
    project: {
      template_id: 'valid',
      template_inputs: { headline: '标题' },
      frames: [{ id: 'caption_disabled', template_id: 'valid', inputs: { headline: '帧标题' }, narration_text: '有旁白但关闭字幕。', generate_captions: false }],
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(captionDisabledWarning.ok, true);
  assertHasDiagnostic(captionDisabledWarning, 'caption_generation_disabled_for_narration');

  const emptySceneSpec = await validateHtmlVideoProject({
    projectDir: rootDir,
    project: timelineGateProject({
      source: 'scene_spec',
      scene_spec_hash: 'legacy-hash',
      scene_count: 0,
      scene_ids: [],
      status: 'ready',
    }),
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
    sceneSpec: { scenes: [] },
  });
  assert.equal(emptySceneSpec.ok, false);
  assertHasDiagnostic(emptySceneSpec, 'scene_spec_empty');

  const timelineMismatch = await validateHtmlVideoProject({
    projectDir: rootDir,
    project: timelineGateProject({
      source: 'scene_spec',
      scene_spec_hash: 'legacy-hash',
      scene_count: 1,
      scene_ids: ['scene_01'],
      narration_path: 'tts/legacy.wav',
      status: 'ready',
    }),
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
    sceneSpec: timelineSceneSpec,
  });
  assert.equal(timelineMismatch.ok, false);
  assertHasDiagnostic(timelineMismatch, 'audio_scene_spec_hash_mismatch');

  const combinedTimelineMismatch = await validateHtmlVideoProject({
    projectDir: rootDir,
    project: timelineGateProject({
      source: 'scene_spec',
      scene_spec_hash: 'legacy-hash',
      scene_count: 1,
      scene_ids: ['scene_01'],
      narration_path: 'tts/legacy.wav',
      status: 'ready',
    }, { narration_text: '错误旁白' }),
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
    sceneSpec: timelineSceneSpec,
  });
  assert.equal(combinedTimelineMismatch.ok, false);
  assertHasDiagnostic(combinedTimelineMismatch, 'audio_scene_spec_hash_mismatch');
  assertHasDiagnostic(combinedTimelineMismatch, 'frame_narration_mismatch');

  const structuralBeforeTimelineProject = timelineGateProject({
    source: 'scene_spec',
    scene_spec_hash: 'legacy-hash',
    scene_count: 1,
    scene_ids: ['scene_01'],
    narration_path: 'tts/legacy.wav',
    status: 'ready',
  }, { narration_text: '错误旁白' });
  structuralBeforeTimelineProject.timeline = {
    tracks: [{ id: 'main', items: [{ id: 'bad', kind: 'clip' }] }],
  };
  const structuralBeforeTimeline = await validateHtmlVideoProject({
    projectDir: rootDir,
    project: structuralBeforeTimelineProject,
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
    sceneSpec: timelineSceneSpec,
  });
  const orderedCodes = structuralBeforeTimeline.diagnostics.map(item => item.code);
  const structuralIndex = orderedCodes.indexOf('timeline_item_kind_unsupported');
  const timelineIndex = orderedCodes.indexOf('frame_narration_mismatch');
  assert.ok(structuralIndex >= 0, '缺少结构校验诊断 timeline_item_kind_unsupported');
  assert.ok(timelineIndex > structuralIndex, 'timeline consistency 诊断应追加在结构校验之后');

  const pathTimelineMismatch = await validateHtmlVideoProject({
    projectDir: rootDir,
    project: timelineGateProject({
      source: 'scene_spec',
      scene_spec_hash: 'legacy-hash',
      scene_count: 1,
      scene_ids: ['scene_01'],
      path: 'tts/legacy.wav',
      status: 'ready',
    }),
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
    sceneSpec: timelineSceneSpec,
  });
  assert.equal(pathTimelineMismatch.ok, false);
  assertHasDiagnostic(pathTimelineMismatch, 'audio_scene_spec_hash_mismatch');

  const narrationPathTimelineMismatch = await validateHtmlVideoProject({
    projectDir: rootDir,
    project: timelineGateProject({
      source: 'scene_spec',
      scene_spec_hash: 'legacy-hash',
      scene_count: 1,
      scene_ids: ['scene_01'],
      narrationPath: 'tts/legacy.wav',
      status: 'ready',
    }),
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
    sceneSpec: timelineSceneSpec,
  });
  assert.equal(narrationPathTimelineMismatch.ok, false);
  assertHasDiagnostic(narrationPathTimelineMismatch, 'audio_scene_spec_hash_mismatch');

  const combinedPathTimelineMismatch = await validateHtmlVideoProject({
    projectDir: rootDir,
    project: timelineGateProject({
      source: 'scene_spec',
      scene_spec_hash: 'legacy-hash',
      scene_count: 1,
      scene_ids: ['scene_01'],
      combined_path: 'tts/legacy.wav',
      status: 'ready',
    }),
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
    sceneSpec: timelineSceneSpec,
  });
  assert.equal(combinedPathTimelineMismatch.ok, false);
  assertHasDiagnostic(combinedPathTimelineMismatch, 'audio_scene_spec_hash_mismatch');

  const noAudioPathTimelinePass = await validateHtmlVideoProject({
    projectDir: rootDir,
    project: timelineGateProject({
      source: 'scene_spec',
      scene_spec_hash: 'legacy-hash',
      scene_count: 1,
      scene_ids: ['scene_01'],
      status: 'ready',
    }),
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
    sceneSpec: timelineSceneSpec,
  });
  assert.equal(noAudioPathTimelinePass.ok, true);
  assertLacksDiagnostic(noAudioPathTimelinePass, 'audio_scene_spec_hash_mismatch');

  const rawHtmlPass = await validateHtmlVideoProject({
    project: {
      template_id: 'valid',
      template_inputs: {},
      frames: [
        {
          id: 'raw_01',
          template_id: 'valid',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/raw_01.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_01', kind: 'frame' }] }] },
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(rawHtmlPass.ok, true);
  assert.deepEqual(rawHtmlPass.diagnostics, []);

  const rawHtmlProjectDir = path.join(rootDir, 'raw-html-project');
  await writeFile(path.join(rawHtmlProjectDir, 'frames', 'missing-keys.html'), [
    '<!doctype html>',
    '<html><body>',
    '<main>',
    '<h1 data-text-key="headline">标题</h1>',
    '<p>缺少 subtitle 和 body 锚点</p>',
    '</main>',
    '</body></html>',
  ].join('\n'));
  const rawHtmlMissingKeys = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: {
      template_id: 'valid',
      template_inputs: {},
      frames: [
        {
          id: 'raw_missing_keys',
          template_id: 'valid',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/missing-keys.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_missing_keys', kind: 'frame' }] }] },
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(rawHtmlMissingKeys.ok, true);
  assert.ok(rawHtmlMissingKeys.diagnostics.some(item => item.code === 'raw_html_text_keys_missing'));
  const missingKeysDiagnostic = rawHtmlMissingKeys.diagnostics.find(item => item.code === 'raw_html_text_keys_missing');
  assert.deepEqual(missingKeysDiagnostic.details.missing_keys, ['subtitle', 'body']);
  assert.equal(missingKeysDiagnostic.details.blocking, false);
  assert.equal(missingKeysDiagnostic.severity, 'warning');

  await writeFile(path.join(rawHtmlProjectDir, 'frames', 'valid-keys.html'), [
    '<!doctype html>',
    '<html><body>',
    '<main>',
    '<h1 DATA-TEXT-KEY = "headline">标题</h1>',
    "<p data-text-key = 'subtitle'>短字幕</p>",
    '<section data-text-key="body">正文</section>',
    '</main>',
    '</body></html>',
  ].join('\n'));
  const rawHtmlValidKeys = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: {
      template_id: 'valid',
      template_inputs: {},
      frames: [
        {
          id: 'raw_valid_keys',
          template_id: 'valid',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/valid-keys.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_valid_keys', kind: 'frame' }] }] },
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(rawHtmlValidKeys.ok, true);
  assert.equal(rawHtmlValidKeys.diagnostics.some(item => item.code === 'raw_html_text_keys_missing'), false);

  await writeFile(path.join(rawHtmlProjectDir, 'frames', 'comment-fake-key.html'), [
    '<!doctype html>',
    '<html><body>',
    '<main>',
    '<h1 data-text-key="headline">标题</h1>',
    '<!-- <p data-text-key="subtitle">注释里的假锚点</p> -->',
    '<section data-text-key="body">正文</section>',
    '</main>',
    '</body></html>',
  ].join('\n'));
  const rawHtmlCommentFakeKey = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: {
      template_id: 'valid',
      template_inputs: {},
      frames: [
        {
          id: 'raw_comment_fake_key',
          template_id: 'valid',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/comment-fake-key.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_comment_fake_key', kind: 'frame' }] }] },
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(rawHtmlCommentFakeKey.ok, true);
  const commentFakeDiagnostic = rawHtmlCommentFakeKey.diagnostics.find(item => item.code === 'raw_html_text_keys_missing');
  assert.deepEqual(commentFakeDiagnostic.details.missing_keys, ['subtitle']);

  await writeFile(path.join(rawHtmlProjectDir, 'frames', 'managed-caption-layer.html'), ensureCaptionLayer([
    '<!doctype html>',
    '<html><body>',
    '<main>',
    '<h1 data-text-key="headline">标题</h1>',
    '<section data-text-key="body">正文</section>',
    '</main>',
    '</body></html>',
  ].join('\n'), [{ id: 'cap_1', start: 0, end: 2, text: '系统字幕' }]));
  const rawHtmlManagedCaptionLayer = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: {
      template_id: 'valid',
      template_inputs: {},
      frames: [
        {
          id: 'raw_managed_caption_layer',
          template_id: 'valid',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/managed-caption-layer.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_managed_caption_layer', kind: 'frame' }] }] },
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(rawHtmlManagedCaptionLayer.ok, true);
  const managedCaptionDiagnostic = rawHtmlManagedCaptionLayer.diagnostics.find(item => item.code === 'raw_html_text_keys_missing');
  assert.deepEqual(managedCaptionDiagnostic.details.missing_keys, ['subtitle']);

  await writeFile(path.join(rawHtmlProjectDir, 'frames', 'decorative-frame.html'), [
    '<!doctype html>',
    '<html><head>',
    '<meta name="viewport" content="width=1920,height=1080,initial-scale=1.0">',
    '<style>',
    'html,body{margin:0;width:1920px;height:1080px;overflow:hidden}',
    '.corner-frame span{width:140px;height:140px}',
    '</style>',
    '</head><body data-hv-canvas data-width="1920" data-height="1080">',
    '<div class="corner-frame"><span></span></div>',
    '<main>',
    '<h1 data-text-key="headline">横屏标题</h1>',
    '<p data-text-key="subtitle">短字幕</p>',
    '<section data-text-key="body">正文</section>',
    '</main>',
    '</body></html>',
  ].join('\n'));
  const rawHtmlDecorativeFrame = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: {
      template_id: 'valid',
      template_inputs: {},
      output: { resolution: { width: 1920, height: 1080 }, fps: 30 },
      frames: [
        {
          id: 'raw_decorative_frame',
          template_id: 'valid',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/decorative-frame.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_decorative_frame', kind: 'frame' }] }] },
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(rawHtmlDecorativeFrame.ok, true);

  await writeFile(path.join(rawHtmlProjectDir, 'frames', 'root-container-with-body-contract.html'), [
    '<!doctype html>',
    '<html><head>',
    '<meta name="viewport" content="width=1920,height=1080,initial-scale=1.0">',
    '<style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden}</style>',
    '</head><body data-hv-canvas data-width="1920" data-height="1080">',
    '<div id="root">',
    '<h1 data-text-key="headline">横屏标题</h1>',
    '<p data-text-key="subtitle">短字幕</p>',
    '<section data-text-key="body">正文</section>',
    '</div>',
    '</body></html>',
  ].join('\n'));
  const rawHtmlRootContainer = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: {
      template_id: 'valid',
      template_inputs: {},
      output: { resolution: { width: 1920, height: 1080 }, fps: 30 },
      frames: [
        {
          id: 'raw_root_container',
          template_id: 'valid',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/root-container-with-body-contract.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_root_container', kind: 'frame' }] }] },
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(rawHtmlRootContainer.ok, true);

  await writeFile(path.join(rawHtmlProjectDir, 'frames', 'wrong-resolution.html'), [
    '<!doctype html>',
    '<html><head>',
    '<meta name="viewport" content="width=1920,height=1080,initial-scale=1.0">',
    '<style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden}</style>',
    '</head><body>',
    '<main>',
    '<h1 data-text-key="headline">横屏标题</h1>',
    '<p data-text-key="subtitle">短字幕</p>',
    '<section data-text-key="body">正文</section>',
    '</main>',
    '</body></html>',
  ].join('\n'));
  const rawHtmlWrongResolution = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: {
      template_id: 'valid',
      template_inputs: {},
      output: { resolution: { width: 1080, height: 1920 }, fps: 30 },
      frames: [
        {
          id: 'raw_wrong_resolution',
          template_id: 'valid',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/wrong-resolution.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_wrong_resolution', kind: 'frame' }] }] },
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(rawHtmlWrongResolution.ok, false);
  const wrongResolutionDiagnostic = rawHtmlWrongResolution.diagnostics.find(item => item.code === 'raw_html_resolution_mismatch');
  assert.ok(wrongResolutionDiagnostic);
  assert.deepEqual(wrongResolutionDiagnostic.details.expected, { width: 1080, height: 1920 });
  assert.deepEqual(wrongResolutionDiagnostic.details.actual, { width: 1920, height: 1080, source: 'viewport' });

  const rawHtmlMissingFile = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: {
      template_id: 'valid',
      template_inputs: {},
      frames: [
        {
          id: 'raw_missing_file',
          template_id: 'valid',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/not-found.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_missing_file', kind: 'frame' }] }] },
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(rawHtmlMissingFile.diagnostics.some(item => item.code === 'raw_html_text_keys_missing'), false);

  const rawHtmlPathEscape = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: {
      template_id: 'valid',
      template_inputs: {},
      frames: [
        {
          id: 'raw_path_escape',
          template_id: 'valid',
          source_mode: 'raw_html',
          inputs: {},
          html_path: '../escape.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_path_escape', kind: 'frame' }] }] },
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(rawHtmlPathEscape.ok, false);
  const rawHtmlPathInvalid = rawHtmlPathEscape.diagnostics.find(item => item.code === 'raw_html_path_invalid');
  assert.ok(rawHtmlPathInvalid);
  assert.equal(rawHtmlPathInvalid.sub_stage, 'frame_html');
  assert.equal(rawHtmlPathInvalid.frame_id, 'raw_path_escape');

  const templateInputsSkipRawHtmlCheck = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: {
      template_id: 'valid',
      template_inputs: { headline: '标题' },
      frames: [
        {
          id: 'template_inputs_missing_file',
          template_id: 'valid',
          source_mode: 'template_inputs',
          inputs: { headline: '帧标题' },
          html_path: 'frames/not-found.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'template_inputs_missing_file', kind: 'frame' }] }] },
    },
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(templateInputsSkipRawHtmlCheck.ok, true);
  assert.equal(templateInputsSkipRawHtmlCheck.diagnostics.some(item => /^raw_html_/.test(item.code)), false);

  const { normalizeDiagnostics } = require('../server/services/creative-video/html-video/diagnostics');
  const normalized = normalizeDiagnostics(['Playwright browser executable not found'], { stage: 'render' });
  assert.match(normalized[0].user_message, /html-video|失败|错误|未配置/);
  assert.doesNotMatch(normalized[0].user_message, /^Playwright browser executable not found$/);
  const objectDiagnostic = normalizeDiagnostics([{ code: 'playwright_not_configured', message: 'Playwright browser executable not found' }]);
  assert.equal(objectDiagnostic[0].user_message, 'Playwright Chromium 未配置，无法渲染 html-video。');
  assert.equal(objectDiagnostic[0].details.message, 'Playwright browser executable not found');
  const renderInfo = normalizeDiagnostics([{
    code: 'frame_rendered',
    stage: 'render',
    message: '已通过 Playwright/Chromium 录制并使用 ffmpeg libx264 编码。',
  }]);
  assert.equal(renderInfo[0].code, 'frame_rendered');
  assert.doesNotMatch(renderInfo[0].user_message, /处理失败/);

  console.log('html-video validation gate tests passed');
})();
