const assert = require('assert');
const path = require('path');

const manifestService = require('../server/services/creative-video/html-video/templateManifestService');

const fixturesDir = path.resolve(__dirname, 'fixtures/html-video-templates');

const commercial = manifestService.loadTemplateManifest(path.join(fixturesDir, 'commercial-hyperframes'));
assert.equal(commercial.id, 'commercial_hyperframes');
assert.equal(commercial.name, '商业 Hyperframes 模板');
assert.equal(commercial.engine, 'hyperframes');
assert.equal(commercial.source_entry, 'index.html');
assert.equal(commercial.__dir, path.join(fixturesDir, 'commercial-hyperframes'));
assert.deepEqual(commercial.output, { resolution: { width: 1920, height: 1080 }, duration: 8 });
assert.equal(commercial.inputs.schema.headline.type, 'string');
assert.equal(commercial.license.commercial_use, true);
assert.equal(commercial.license.attribution_required, true);
assert.deepEqual(commercial.assets_attribution, [
  { title: '测试素材', author: '测试作者', license: 'CC-BY-4.0', url: 'https://example.com/asset' },
]);
assert.deepEqual(commercial.preview, { poster: 'preview.png' });

const minimal = manifestService.normalizeTemplateManifest(
  { id: 'minimal', name: '最小模板', engine: 'hyperframes', source_entry: 'main.html' },
  { templateDir: path.join(fixturesDir, 'minimal') }
);
assert.deepEqual(minimal.output, {});
assert.deepEqual(minimal.inputs, { schema: {} });
assert.deepEqual(minimal.license, { commercial_use: false, attribution_required: false });
assert.deepEqual(minimal.assets_attribution, []);
assert.deepEqual(minimal.preview, {});

assert.throws(
  () => manifestService.normalizeTemplateManifest(
    { id: 'absolute', name: '绝对路径', engine: 'hyperframes', source_entry: 'C:/tmp/template.html' },
    { templateDir: fixturesDir }
  ),
  /source_entry/
);

assert.throws(
  () => manifestService.normalizeTemplateManifest(
    { id: 'parent', name: '上级路径', engine: 'hyperframes', source_entry: '../template.html' },
    { templateDir: fixturesDir }
  ),
  /source_entry/
);

const nonHtml = manifestService.normalizeTemplateManifest(
  { id: 'non-html', name: '非 HTML', engine: 'hyperframes', source_entry: 'template.txt' },
  { templateDir: fixturesDir }
);
assert.equal(nonHtml.source_entry, 'template.txt');

console.log('html-video template manifest service tests passed');
