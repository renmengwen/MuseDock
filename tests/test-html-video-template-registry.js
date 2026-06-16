const assert = require('assert');
const path = require('path');

const registry = require('../server/services/creative-video/html-video/templateRegistry');

const fixturesDir = path.resolve(__dirname, 'fixtures/html-video-templates');
const productionTemplatesDir = path.resolve(__dirname, '../server/templates');

const manifests = registry.scanTemplateManifests(fixturesDir);
assert.ok(manifests.some(item => item.id === 'commercial_hyperframes'));
assert.ok(manifests.some(item => item.id === 'noncommercial_hyperframes'));
assert.ok(manifests.some(item => item.id === 'remotion_template'));
assert.ok(manifests.some(item => item.id === 'script_source'));

const compactDefault = registry.buildCompactIndex(fixturesDir);
assert.deepEqual(compactDefault.map(item => item.id), ['commercial_hyperframes']);
assert.deepEqual(Object.keys(compactDefault[0]).sort(), [
  'aspect_ratio',
  'assets_attribution',
  'attribution_required',
  'category',
  'description',
  'duration_sec',
  'engine',
  'id',
  'inputs',
  'license',
  'mapped_engine',
  'name',
  'output',
  'source_entry',
  'tags',
].sort());
assert.equal(compactDefault[0].mapped_engine, 'hyperframes-playwright');
assert.equal(compactDefault[0].aspect_ratio, '16:9');
assert.equal(compactDefault[0].duration_sec, 8);
assert.equal(compactDefault[0].attribution_required, true);
assert.equal(compactDefault[0].source_entry, 'index.html');
assert.equal(compactDefault[0].license.commercial_use, true);
assert.equal(compactDefault[0].license.attribution_required, true);
assert.equal(compactDefault[0].sourceHtml, undefined);

const statefulRegistry = registry.createTemplateRegistry({ rootDir: fixturesDir });
assert.deepEqual(statefulRegistry.scanTemplates().map(item => item.id).sort(), manifests.map(item => item.id).sort());
assert.deepEqual(statefulRegistry.listTemplates().map(item => item.id), ['commercial_hyperframes']);
assert.equal(statefulRegistry.hasTemplate('commercial_hyperframes'), true);
assert.equal(statefulRegistry.hasTemplate('noncommercial_hyperframes'), false);
assert.equal(statefulRegistry.getTemplate('commercial_hyperframes').id, 'commercial_hyperframes');

assert.deepEqual(
  statefulRegistry.buildCompactIndex({ aspectRatio: '16:9', durationSec: 8 }).map(item => item.id),
  ['commercial_hyperframes']
);

assert.deepEqual(
  statefulRegistry.buildCompactIndex({ aspect_ratio: '9:16', duration: 8 }).map(item => item.id),
  []
);

assert.deepEqual(
  registry.buildCompactIndex(fixturesDir, { commercialOnly: false }).map(item => item.id).sort(),
  ['commercial_hyperframes', 'noncommercial_hyperframes'].sort()
);

assert.deepEqual(
  registry.buildCompactIndex(fixturesDir, { engines: ['remotion'], commercialOnly: false }).map(item => item.id),
  ['remotion_template']
);

assert.deepEqual(
  registry.buildCompactIndex(fixturesDir, { aspects: ['9:16'] }).map(item => item.id),
  []
);

assert.deepEqual(
  registry.buildCompactIndex(fixturesDir, { durationSec: 3 }).map(item => item.id),
  []
);

assert.deepEqual(
  registry.buildCompactIndex(fixturesDir, { duration: 3 }).map(item => item.id),
  []
);

assert.deepEqual(
  registry.buildCompactIndex(fixturesDir, { licenseAllow: ['Apache-2.0'] }).map(item => item.id),
  ['commercial_hyperframes']
);

const failures = [
  {
    manifest: manifests.find(item => item.id === 'remotion_template'),
    field: 'engine',
    text: '当前不支持该模板引擎',
  },
  {
    manifest: manifests.find(item => item.id === 'script_source'),
    field: 'source_entry',
    text: 'source_entry 必须指向 HTML 文件',
  },
  {
    manifest: manifests.find(item => item.id === 'noncommercial_hyperframes'),
    field: 'license',
    text: '模板授权不允许商业使用',
  },
  {
    manifest: manifests.find(item => item.id === 'commercial_hyperframes'),
    options: { aspects: ['1:1'] },
    field: 'aspect',
    text: '模板不支持目标画幅',
  },
  {
    manifest: manifests.find(item => item.id === 'commercial_hyperframes'),
    options: { durationSec: 30 },
    field: 'duration',
    text: '模板不支持目标时长',
  },
  {
    manifest: manifests.find(item => item.id === 'missing_source_entry'),
    field: 'source_entry',
    text: 'source_entry 指向的文件不存在',
  },
];

failures.forEach(({ manifest, options, field, text }) => {
  const result = registry.validateTemplateCompatibility(manifest, options);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some(item => item.field === field && item.message.includes(text)), field);
});

const productionIndex = registry.buildCompactIndex(productionTemplatesDir);
const productionIds = productionIndex.map(item => item.id).sort();
assert.deepEqual(productionIds, ['bold_signal', 'glitch_title'].sort());
for (const id of ['bold_signal', 'glitch_title']) {
  const template = productionIndex.find(item => item.id === id);
  assert.equal(template.engine, 'hyperframes');
  assert.equal(template.source_entry, 'source/index.html');
  assert.equal(template.output.resolution.width, 1920);
  assert.equal(template.output.resolution.height, 1080);
  assert.equal(Number(template.output.fps), 30);
  assert.ok(Number(template.duration_sec) > 0);
  assert.ok(template.inputs.schema && Object.keys(template.inputs.schema).length > 0);
  assert.equal(template.license.commercial_use, true);
  assert.ok(Array.isArray(template.assets_attribution));
}

console.log('html-video template registry tests passed');
