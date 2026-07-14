const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { matchScenesToTemplates } = require('../server/services/creative-video/html-video/sceneTemplateMatcher');

const registry = createTemplateRegistry();
registry.scanTemplates();

function decision(scene) {
  return matchScenesToTemplates({ scenes: [scene], registry, renderTarget: { aspectRatio: '16:9' } }).get(scene.id);
}

{
  const d = decision({
    id: 'single',
    kind: 'data',
    duration_sec: 4,
    visual_text: { headline: '转化率 88.6%', keywords: ['转化率'], cards: ['转化率 88.6%'] },
  });
  assert.equal(d.source_mode, 'template_inputs');
  assert.equal(d.template_id, 'frame-pentagram-stat');
}

{
  const d = decision({
    id: 'multi',
    kind: 'data',
    duration_sec: 8,
    visual_text: { headline: '渠道对比', cards: ['搜索 12', '推荐 34', '私域 56'] },
  });
  assert.equal(d.source_mode, 'template_inputs');
  assert.equal(d.template_id, 'frame-data-chart-nyt');
}

{
  const d = decision({
    id: 'quote',
    kind: 'quote',
    duration_sec: 5,
    visual_text: { headline: '一句金句', cards: ['保持专注'] },
  });
  assert.equal(d.source_mode, 'template_inputs');
  assert.equal(d.template_id, 'frame-electric-studio');
}

{
  const d = decision({
    id: 'explainer',
    kind: 'text',
    duration_sec: 6,
    visual_text: { headline: '再讲 UE', keywords: ['交互', '流程', '反馈'], cards: ['操作路径', '入口清晰', '反馈及时'] },
  });
  assert.equal(d.source_mode, 'template_inputs');
  assert.notEqual(d.template_id, 'frame-glitch-title');
}

{
  const d = decision({
    id: 'asset-bound',
    kind: 'text',
    duration_sec: 6,
    visual_text: { headline: 'AI 主视觉' },
    asset_refs: [{ asset_id: 'gen_scene_01', usage: 'showcase' }],
  });
  assert.equal(d.source_mode, 'raw_html');
  assert.ok(d.reason.includes('视觉素材'));
}

{
  const d = decision({
    id: 'freeform',
    kind: 'unknown',
    duration_sec: 5,
    visual_text: { headline: '没有对应模板的自由内容' },
  });
  assert.equal(d.source_mode, 'raw_html');
}

{
  const d = decision({
    id: 'bad-chart',
    kind: 'comparison',
    duration_sec: 8,
    visual_text: { headline: '单点对比', cards: ['搜索 12'] },
  });
  assert.equal(d.source_mode, 'raw_html');
  assert.ok(d.reason.includes('数量不能少于') || d.reason.includes('模板字段'));
}

{
  const scenes = [
    { id: 'a', kind: 'data', duration_sec: 4, visual_text: { headline: 'A 12', cards: ['A 12'] } },
    { id: 'b', kind: 'data', duration_sec: 4, visual_text: { headline: 'B 13', cards: ['B 13'] } },
  ];
  const map = matchScenesToTemplates({ scenes, registry, renderTarget: { aspectRatio: '16:9' } });
  assert.equal(map.get('a').template_id, 'frame-pentagram-stat');
  assert.equal(map.get('b').template_id, 'frame-pentagram-stat');
}

{
  const scenes = [
    { id: 'a', kind: 'comparison', duration_sec: 8, visual_text: { headline: 'A', cards: ['A 1', 'B 2'] } },
    { id: 'b', kind: 'comparison', duration_sec: 8, visual_text: { headline: 'B', cards: ['A 3', 'B 4'] } },
    { id: 'c', kind: 'comparison', duration_sec: 8, visual_text: { headline: 'C', cards: ['A 5', 'B 6'] } },
  ];
  const map = matchScenesToTemplates({ scenes, registry, renderTarget: { aspectRatio: '16:9' } });
  assert.equal(map.get('a').template_id, 'frame-data-chart-nyt');
  assert.equal(map.get('b').template_id, 'frame-data-chart-nyt');
  assert.equal(map.get('c').template_id, 'frame-data-chart-nyt');
}

{
  const longScene = {
    id: 'long',
    kind: 'data',
    duration_sec: 99,
    visual_text: { headline: '超长 88', cards: ['超长 88'] },
  };
  const d = decision(longScene);
  assert.equal(d.source_mode, 'raw_html');
  assert.ok(d.reason.includes('时长'));
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'html-video-template-gate-'));
  const source = path.join(tmp, 'index.html');
  fs.writeFileSync(source, '<html><body>未接线</body></html>', 'utf8');
  const fake = {
    id: 'frame-pentagram-stat',
    engine: 'hyperframes',
    source_entry: 'index.html',
    __dir: tmp,
    output: { resolution: { width: 1920, height: 1080 }, duration: { min_sec: 3, max_sec: 6 } },
    license: { commercial_use: true },
    inputs: registry.getTemplate('frame-pentagram-stat').inputs,
  };
  const fakeRegistry = { getTemplate: id => (id === 'frame-pentagram-stat' ? fake : null) };
  const map = matchScenesToTemplates({
    scenes: [{ id: 'fake', kind: 'data', duration_sec: 4, visual_text: { headline: '88', cards: ['A 88'] } }],
    registry: fakeRegistry,
    renderTarget: { aspectRatio: '16:9' },
  });
  assert.equal(map.get('fake').source_mode, 'raw_html');
  assert.ok(map.get('fake').reason.includes('未接线'));
}

for (const d of matchScenesToTemplates({
  scenes: [{ id: 'rollup-check', kind: 'data', duration_sec: 8, visual_text: { headline: 'A', cards: ['A 1', 'B 2', 'C 3'] } }],
  registry,
  renderTarget: { aspectRatio: '16:9' },
}).values()) {
  assert.notEqual(d.template_id, 'frame-data-rollup');
}

console.log('html-video scene template matcher tests passed');

// ===== 模块1：asset_first 能力字段 =====
const { templateCapabilities, blocksAssetFirstFullFrame } = require('../server/services/creative-video/html-video/sceneTemplateMatcher');

// 缺省能力：未声明的模板视为 full_frame、不兼容 asset_first
{
  const caps = templateCapabilities({ id: 'frame-build-minimal' });
  assert.strictEqual(caps.render_role, 'full_frame');
  assert.strictEqual(caps.asset_first_compatible, false);
  assert.strictEqual(caps.overlay_safe, false);
  assert.strictEqual(caps.caption_safe, 'unknown');
}

// 模板 manifest 显式声明可覆盖缺省
{
  const caps = templateCapabilities({
    id: 'frame-anything',
    capabilities: { render_role: 'overlay', asset_first_compatible: true, overlay_safe: true, caption_safe: true },
  });
  assert.strictEqual(caps.render_role, 'overlay');
  assert.strictEqual(caps.asset_first_compatible, true);
}

// asset_first 阻断判断：full_frame 且不兼容 => 返回原因；兼容 => 空串
assert.ok(blocksAssetFirstFullFrame({ id: 'frame-glitch-title' }).length > 0);
assert.ok(blocksAssetFirstFullFrame({ id: 'frame-build-minimal' }).length > 0);
assert.strictEqual(
  blocksAssetFirstFullFrame({ id: 'frame-x', capabilities: { asset_first_compatible: true } }),
  '',
);

// 旧字段语义回归：capability 元数据字段语义完全不变
{
  const caps = templateCapabilities({ id: 'frame-glitch-title' });
  assert.strictEqual(caps.information_capacity, 'low');
  assert.strictEqual(caps.accepts_image, false);
}
console.log('scene-template-matcher asset_first capability tests passed');
