const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { validateHtmlVideoProject } = require('../server/services/creative-video/html-video/validationGate');

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

  const { normalizeDiagnostics } = require('../server/services/creative-video/html-video/diagnostics');
  const normalized = normalizeDiagnostics(['Playwright browser executable not found'], { stage: 'render' });
  assert.match(normalized[0].user_message, /html-video|失败|错误|未配置/);
  assert.doesNotMatch(normalized[0].user_message, /^Playwright browser executable not found$/);
  const objectDiagnostic = normalizeDiagnostics([{ code: 'playwright_not_configured', message: 'Playwright browser executable not found' }]);
  assert.equal(objectDiagnostic[0].user_message, 'Playwright Chromium 未配置，无法渲染 html-video。');
  assert.equal(objectDiagnostic[0].details.message, 'Playwright browser executable not found');

  console.log('html-video validation gate tests passed');
})();
