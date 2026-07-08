const assert = require('assert');
const fs = require('fs');
const path = require('path');

const registry = require('../server/services/creative-video/html-video/templateRegistry');

const templatesDir = path.resolve(__dirname, '../server/templates');
const manifests = registry.scanTemplateManifests(templatesDir);
const manifestIds = manifests.map(item => item.id);
const index = registry.buildCompactIndex(templatesDir);
const ids = index.map(item => item.id);

const externalHyperframes = [
  'frame-bold-poster',
  'frame-bold-signal',
  'frame-build-minimal',
  'frame-creative-voltage',
  'frame-data-chart-nyt',
  'frame-decision-tree',
  'frame-electric-studio',
  'frame-glitch-title',
  'frame-kinetic-type',
  'frame-light-leak-cinema',
  'frame-liquid-bg-hero',
  'frame-logo-outro',
  'frame-nyt-graph',
  'frame-pentagram-stat',
  'frame-play-mode',
  'frame-product-promo',
  'frame-product-promo-30s',
  'frame-swiss-grid',
  'frame-takram-organic',
  'frame-vignelli',
  'frame-warm-grain',
  'vfx-text-cursor',
];

assert.ok(manifestIds.includes('frame-data-rollup'), '应扫描到 remotion 模板，但不能加载为 hyperframes');
assert.ok(index.length >= 25, `可加载模板应至少 25 个，实际 ${index.length}`);
for (const id of externalHyperframes) {
  assert.ok(ids.includes(id), `缺少外部 hyperframes 模板 ${id}`);
}
for (const id of ['bold_signal', 'glitch_title', 'news_signal_vertical']) {
  assert.ok(ids.includes(id), `缺少内部模板 ${id}`);
}
assert.ok(!ids.includes('frame-data-rollup'), 'frame-data-rollup 不应进入 hyperframes 可用列表');

const rollup = manifests.find(item => item.id === 'frame-data-rollup');
const rollupValidation = registry.validateTemplateCompatibility(rollup);
assert.equal(rollupValidation.ok, false);
assert.ok(rollupValidation.reasons.some(item => item.field === 'engine' && item.code === 'unsupported-engine'));

for (const template of index) {
  assert.ok(template.inputs?.schema && Object.keys(template.inputs.schema).length > 0, `${template.id} 缺少 inputs.schema`);
  assert.ok(template.category, `${template.id} 缺少 category`);
  assert.ok(Array.isArray(template.tags) && template.tags.length > 0, `${template.id} 缺少 tags`);
  assert.equal(template.license.commercial_use, true, `${template.id} 应允许商业使用`);
}

for (const manifest of manifests) {
  const sourcePath = registry.resolveSourceEntryPath(manifest);
  assert.ok(sourcePath && fs.existsSync(sourcePath), `${manifest.id} source_entry 指向文件应存在`);
}

const dataChart = manifests.find(item => item.id === 'frame-data-chart-nyt');
const dataSchema = dataChart.inputs.schema.properties.data;
assert.ok(dataChart.inputs.schema.required.includes('title'));
assert.ok(dataChart.inputs.schema.required.includes('data'));
assert.equal(dataSchema.minItems, 2);
assert.equal(dataSchema.maxItems, 12);
assert.ok(dataSchema.items.required.includes('label'));
assert.ok(dataSchema.items.required.includes('value'));

console.log('html-video template catalog tests passed');
