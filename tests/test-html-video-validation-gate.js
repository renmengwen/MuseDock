const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { validateHtmlVideoProject } = require('../server/services/creative-video/html-video/validationGate');
const { ensureCaptionLayer } = require('../server/services/creative-video/html-video/captionLayer');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-gate-'));

  const timelineSceneSpec = {
    scenes: [
      { id: 'scene_01', order: 1, narration_text: '第一段', captions: [{ text: '字幕一' }] },
    ],
  };

  function timelineGateProject(audio, frameOverrides = {}) {
    return {
      output: { resolution: { width: 1920, height: 1080 }, fps: 30 },
      frames: [
        {
          id: 'scene_01',
          scene_id: 'scene_01',
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
    'timeline_item_kind_unsupported',
    'asset_path_invalid',
    'playwright_not_configured',
    'ffmpeg_not_configured',
    'html_override_active',
  ]) {
    assert.ok(codes.includes(code), `缺少诊断 ${code}`);
  }
  // 模板工程校验已删除：旧工程仍带 template_id/engine 字段时不得再产生模板类诊断
  for (const code of [
    'template_missing',
    'unsupported_engine',
    'source_entry_not_html',
    'license_not_allowed',
    'template_inputs_invalid',
  ]) {
    assert.ok(!codes.includes(code), `不应再产生模板诊断 ${code}`);
  }
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
      frames: [{ id: 'f1', inputs: { headline: '帧标题' }, html_path: 'frames/f1.html' }],
      assets: [{ id: 'a1', path: 'assets/a.png' }],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'f1', kind: 'frame' }] }] },
    },
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(pass.ok, true);
  assert.deepEqual(pass.diagnostics, []);

  const captionFallbackPass = await validateHtmlVideoProject({
    project: {
      frames: [{ id: 'caption_fallback', inputs: { headline: '帧标题' }, narration_text: '这句旁白会自动生成字幕。' }],
    },
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(captionFallbackPass.ok, true);
  assertLacksDiagnostic(captionFallbackPass, 'caption_missing_for_narration');

  const captionDisabledWarning = await validateHtmlVideoProject({
    project: {
      frames: [{ id: 'caption_disabled', inputs: { headline: '帧标题' }, narration_text: '有旁白但关闭字幕。', generate_captions: false }],
    },
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
    environment: { ok: true, diagnostics: [] },
    sceneSpec: timelineSceneSpec,
  });
  assert.equal(noAudioPathTimelinePass.ok, true);
  assertLacksDiagnostic(noAudioPathTimelinePass, 'audio_scene_spec_hash_mismatch');

  const rawHtmlPass = await validateHtmlVideoProject({
    project: {
      frames: [
        {
          id: 'raw_01',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/raw_01.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_01', kind: 'frame' }] }] },
    },
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
      frames: [
        {
          id: 'raw_missing_keys',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/missing-keys.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_missing_keys', kind: 'frame' }] }] },
    },
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
      frames: [
        {
          id: 'raw_valid_keys',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/valid-keys.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_valid_keys', kind: 'frame' }] }] },
    },
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
      frames: [
        {
          id: 'raw_comment_fake_key',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/comment-fake-key.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_comment_fake_key', kind: 'frame' }] }] },
    },
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
      frames: [
        {
          id: 'raw_managed_caption_layer',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/managed-caption-layer.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_managed_caption_layer', kind: 'frame' }] }] },
    },
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
      output: { resolution: { width: 1920, height: 1080 }, fps: 30 },
      frames: [
        {
          id: 'raw_decorative_frame',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/decorative-frame.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_decorative_frame', kind: 'frame' }] }] },
    },
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
      output: { resolution: { width: 1920, height: 1080 }, fps: 30 },
      frames: [
        {
          id: 'raw_root_container',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/root-container-with-body-contract.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_root_container', kind: 'frame' }] }] },
    },
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
      output: { resolution: { width: 1080, height: 1920 }, fps: 30 },
      frames: [
        {
          id: 'raw_wrong_resolution',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/wrong-resolution.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_wrong_resolution', kind: 'frame' }] }] },
    },
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
      frames: [
        {
          id: 'raw_missing_file',
          source_mode: 'raw_html',
          inputs: {},
          html_path: 'frames/not-found.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_missing_file', kind: 'frame' }] }] },
    },
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(rawHtmlMissingFile.diagnostics.some(item => item.code === 'raw_html_text_keys_missing'), false);

  const rawHtmlPathEscape = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: {
      frames: [
        {
          id: 'raw_path_escape',
          source_mode: 'raw_html',
          inputs: {},
          html_path: '../escape.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_path_escape', kind: 'frame' }] }] },
    },
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
      frames: [
        {
          id: 'template_inputs_missing_file',
          source_mode: 'template_inputs',
          inputs: { headline: '帧标题' },
          html_path: 'frames/not-found.html',
        },
      ],
      timeline: { tracks: [{ id: 'main', items: [{ id: 'template_inputs_missing_file', kind: 'frame' }] }] },
    },
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

  // ===== 模块3：overlay 校验 =====
  // runGateOnHtml：按 validationGate 导出的 assetFirstOverlayIssues 真实签名调用，
  // 把 HTML 传入并返回 issues 数组。
  const { assetFirstOverlayIssues } = require('../server/services/creative-video/html-video/validationGate');
  function runGateOnHtml(html) {
    return assetFirstOverlayIssues(html);
  }
  {
    const html = '<html><body><div data-mp-overlay="key_marker" style="position:absolute;left:0;right:0;bottom:0;height:300px"></div></body></html>';
    const issues = runGateOnHtml(html);
    assert.ok(issues.some(i => i.code === 'overlay_in_caption_safe_area' && i.severity === 'warning'));
  }
  // 无 overlay 的 HTML 不产生 issue（warning 级，不阻断）
  {
    const plainHtml = '<html><body><h1>标题</h1></body></html>';
    assert.deepEqual(runGateOnHtml(plainHtml), []);
  }
  // 端到端：raw_html 帧带违规 overlay 时，gate 产生 warning 且不阻断
  await writeFile(path.join(rawHtmlProjectDir, 'frames', 'overlay-unsafe.html'), [
    '<!doctype html>',
    '<html><body>',
    '<main>',
    '<h1 data-text-key="headline">标题</h1>',
    "<p data-text-key='subtitle'>短字幕</p>",
    '<section data-text-key="body">正文</section>',
    '</main>',
    '<div data-mp-overlay="key_marker" style="position:absolute;left:0;right:0;bottom:0;height:300px"></div>',
    '</body></html>',
  ].join('\n'));
  const overlayProject = () => ({
    frames: [
      {
        id: 'raw_overlay_unsafe',
        source_mode: 'raw_html',
        inputs: {},
        html_path: 'frames/overlay-unsafe.html',
      },
    ],
    timeline: { tracks: [{ id: 'main', items: [{ id: 'raw_overlay_unsafe', kind: 'frame' }] }] },
  });
  const overlayResult = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: overlayProject(),
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(overlayResult.ok, true, 'overlay 校验为 warning 级，不得阻断');
  const overlayDiagnostic = overlayResult.diagnostics.find(item => item.code === 'overlay_in_caption_safe_area');
  assert.ok(overlayDiagnostic, '违规 overlay 应产生 overlay_in_caption_safe_area 警告');
  assert.equal(overlayDiagnostic.severity, 'warning');
  console.log('validation gate overlay tests passed');

  // ===== P2-B：无图 diagram beat 的骨架确定性校验（warning 级，不阻断）=====
  await writeFile(path.join(rawHtmlProjectDir, 'frames', 'diagram-missing-base.html'), [
    '<!doctype html>',
    '<html><body>',
    '<main>',
    '<h1 data-text-key="headline">大标题</h1>',
    "<p data-text-key='subtitle'>短字幕</p>",
    '<section data-text-key="body">正文</section>',
    '</main>',
    '<div data-mp-overlay="key_marker" style="position:absolute;left:48px;right:48px;bottom:200px;height:200px"></div>',
    '</body></html>',
  ].join('\n'));
  await writeFile(path.join(rawHtmlProjectDir, 'frames', 'diagram-with-base.html'), [
    '<!doctype html>',
    '<html><body>',
    '<main data-mp-diagram-base="diagram">',
    '<h1 data-text-key="headline">大标题</h1>',
    "<p data-text-key='subtitle'>短字幕</p>",
    '<section data-text-key="body">正文</section>',
    '</main>',
    '</body></html>',
  ].join('\n'));
  const diagramProject = ({ htmlPath, beatVisualBaseType } = {}) => ({
    visual_plan: {
      beats: [
        {
          id: 'scene_07_b1',
          scene_id: 'scene_07',
          visual_base: beatVisualBaseType ? { type: beatVisualBaseType } : null,
        },
      ],
    },
    frames: [
      {
        id: 'scene_07_b1',
        beat_id: 'scene_07_b1',
        scene_id: 'scene_07',
        source_mode: 'raw_html',
        inputs: {},
        html_path: htmlPath,
      },
    ],
    timeline: { tracks: [{ id: 'main', items: [{ id: 'scene_07_b1', kind: 'frame' }] }] },
  });
  // diagram beat + 无 data-mp-diagram-base → warning 存在且不阻断
  const diagramMissing = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: diagramProject({ htmlPath: 'frames/diagram-missing-base.html', beatVisualBaseType: 'diagram' }),
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(diagramMissing.ok, true, 'diagram 骨架校验为 warning 级，不得阻断');
  const diagramDiagnostic = diagramMissing.diagnostics.find(item => item.code === 'diagram_base_missing');
  assert.ok(diagramDiagnostic, 'diagram beat 缺骨架应产生 diagram_base_missing 警告');
  assert.equal(diagramDiagnostic.severity, 'warning');
  // diagram beat + 含骨架 HTML → 无该 warning
  const diagramPresent = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: diagramProject({ htmlPath: 'frames/diagram-with-base.html', beatVisualBaseType: 'diagram' }),
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(diagramPresent.diagnostics.some(item => item.code === 'diagram_base_missing'), false, '含骨架 HTML 不得报 diagram_base_missing');
  // 非 diagram beat → 无该 warning
  const diagramNotDiagramBeat = await validateHtmlVideoProject({
    projectDir: rawHtmlProjectDir,
    project: diagramProject({ htmlPath: 'frames/diagram-missing-base.html', beatVisualBaseType: 'asset' }),
    environment: { ok: true, diagnostics: [] },
  });
  assert.equal(diagramNotDiagramBeat.diagnostics.some(item => item.code === 'diagram_base_missing'), false, '非 diagram beat 不得报 diagram_base_missing');
  console.log('validation gate diagram base tests passed');

  console.log('html-video validation gate tests passed');
})();
