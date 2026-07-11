const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {
  MOTION_PRIMITIVES,
  selectMotionPrimitive,
  loadOverlaySnippet,
  validateOverlayHtml,
} = require('../server/services/creative-video/html-video/motionPrimitiveCatalog');

// 目录完整性：6 个首批 primitive，均有 best_for/placements/max_items
for (const id of ['concept_card', 'key_marker', 'three_step_flow', 'cause_chain', 'checklist', 'stat_compare']) {
  const p = MOTION_PRIMITIVES[id];
  assert.ok(p, `缺少 primitive ${id}`);
  assert.ok(Array.isArray(p.best_for) && p.best_for.length > 0);
  assert.ok(Array.isArray(p.placements) && p.placements.length > 0);
  assert.ok(Number.isInteger(p.max_items) && p.max_items >= 1);
}

// 选择规则：确定性映射（同输入必同输出）
assert.strictEqual(selectMotionPrimitive({ kind: 'steps' }).preset, 'three_step_flow');
assert.strictEqual(selectMotionPrimitive({ kind: 'comparison' }).preset, 'stat_compare');
assert.strictEqual(selectMotionPrimitive({ kind: 'quote' }).preset, 'key_marker');
assert.strictEqual(
  selectMotionPrimitive({ kind: 'text', visual_text: { cards: ['a', 'b', 'c'] } }).preset,
  'checklist',
);
assert.strictEqual(
  selectMotionPrimitive({ kind: 'text', narration_text: '为什么会这样？因为……所以……' }).preset,
  'cause_chain',
);
assert.strictEqual(selectMotionPrimitive({ kind: 'text' }).preset, 'concept_card');
// placement 必须来自该 primitive 的合法 placements
{
  const pick = selectMotionPrimitive({ kind: 'steps' });
  assert.ok(MOTION_PRIMITIVES[pick.preset].placements.includes(pick.placement));
}

// 片段可加载：每个 primitive 有真实 overlay.html
for (const id of Object.keys(MOTION_PRIMITIVES)) {
  const html = loadOverlaySnippet(id);
  assert.ok(html.includes('data-mp-overlay'), `${id} 片段必须带 data-mp-overlay 根节点`);
  assert.ok(!/cdn|https?:\/\//i.test(html), `${id} 片段禁止外链资源`);
}

// 意见11：无图 diagram 的 CSS 骨架也必须是真实文件（v1 就有，不推 v2）
const { loadDiagramSkeleton } = require('../server/services/creative-video/html-video/motionPrimitiveCatalog');
{
  const skeleton = loadDiagramSkeleton();
  assert.ok(skeleton.includes('data-mp-diagram-base'), 'diagram 骨架必须带 data-mp-diagram-base 根节点');
  assert.ok(skeleton.includes('--mp-accent'), 'diagram 骨架必须消费主题 token 变量');
  assert.ok(!/https?:\/\//i.test(skeleton), 'diagram 骨架禁止外链资源');
}

// 确定性校验：overlay 不入底部 140px 字幕区、不整屏覆盖
{
  const ok = validateOverlayHtml(
    '<div data-mp-overlay="key_marker" data-mp-placement="lower_third" style="position:absolute;left:48px;right:48px;bottom:180px;height:220px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(ok.valid, true, JSON.stringify(ok));
}
{
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="key_marker" data-mp-placement="lower_third" style="position:absolute;left:0;right:0;bottom:0;height:300px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false);
  assert.strictEqual(bad.reason_code, 'overlay_in_caption_safe_area');
}
{
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="concept_card" style="position:absolute;inset:0"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false);
  assert.strictEqual(bad.reason_code, 'overlay_covers_full_frame');
}

// P1-B 回归：全部内置 primitive 的真实 overlay.html 必须通过安全区校验
// （缺失 bottom 的 top+height 布局不得被 pxNumber('')===0 误判为 bottom:0）
for (const id of Object.keys(MOTION_PRIMITIVES)) {
  const result = validateOverlayHtml(loadOverlaySnippet(id), { height: 1920 });
  assert.strictEqual(result.valid, true, `内置 primitive ${id} 不得被误判：${JSON.stringify(result)}`);
}
// top+height 越界仍要拦：top:1700px + height:200px（1900 > 1920-140）
{
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="x" style="position:absolute;left:48px;right:48px;top:1700px;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false);
  assert.strictEqual(bad.reason_code, 'overlay_in_caption_safe_area');
}
console.log('motion primitive catalog tests passed');
