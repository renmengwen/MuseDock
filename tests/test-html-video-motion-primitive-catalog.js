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
// P2-2：多 overlay 必须逐个校验（scene_html 标准结构就是多 overlay）
{
  // 第一个安全、第二个 bottom:0 → invalid，并带上失败元素的 beat scope 定位
  const bad = validateOverlayHtml(
    [
      '<div data-mp-overlay="key_marker" data-mp-beat-scope="scene_x_b1" style="position:absolute;left:48px;right:48px;bottom:180px;height:220px"></div>',
      '<div data-mp-overlay="key_marker" data-mp-beat-scope="scene_x_b2" style="position:absolute;left:48px;right:48px;bottom:0;height:220px"></div>',
    ].join(''),
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, '第二个 overlay 越界必须判 invalid');
  assert.strictEqual(bad.reason_code, 'overlay_in_caption_safe_area');
  assert.strictEqual(bad.details && bad.details.beat_scope, 'scene_x_b2', '失败结果必须带该元素的 beat scope');
  assert.ok(String(bad.message).includes('scene_x_b2'), 'message 必须能定位到出错 beat');
}
{
  // 双 overlay 均安全 → valid
  const ok = validateOverlayHtml(
    [
      '<div data-mp-overlay="key_marker" data-mp-beat-scope="scene_x_b1" style="position:absolute;left:48px;right:48px;bottom:180px;height:220px"></div>',
      '<div data-mp-overlay="concept_card" data-mp-beat-scope="scene_x_b2" style="position:absolute;left:48px;right:48px;top:200px;height:300px"></div>',
    ].join(''),
    { height: 1920 },
  );
  assert.strictEqual(ok.valid, true, JSON.stringify(ok));
}
{
  // P1-8 联动：<style>/注释里的 data-mp-overlay 不算根节点
  const styleOnly = validateOverlayHtml(
    '<style>[data-mp-overlay]{opacity:0}</style><!-- data-mp-overlay --><div class="hero"></div>',
    { height: 1920 },
  );
  assert.strictEqual(styleOnly.valid, false);
  assert.strictEqual(styleOnly.reason_code, 'overlay_root_missing');
}
// 未闭合 <style>/<script>：其后的 tag 形文本按浏览器语义属于样式/脚本内容，不算真实元素
const { hasRealOverlayElement } = require('../server/services/creative-video/html-video/motionPrimitiveCatalog');
{
  const unclosedStyle = '<div class="hero"></div><style>[data-mp-overlay]{opacity:0} <div data-mp-overlay="key_marker"></div>';
  assert.strictEqual(hasRealOverlayElement(unclosedStyle), false, '未闭合 <style> 内的 tag 形文本不算真实 overlay');
  const unclosedScript = '<div class="hero"></div><script>var s = \'<div data-mp-overlay="x"></div>\';';
  assert.strictEqual(hasRealOverlayElement(unclosedScript), false, '未闭合 <script> 内的 tag 形文本不算真实 overlay');
  // 未闭合 style 之前的真实节点仍要认
  const realBefore = '<div data-mp-overlay="key_marker" style="position:absolute;bottom:180px"></div><style>.x{}';
  assert.strictEqual(hasRealOverlayElement(realBefore), true);
}
// P2-5：其他属性值中的 " data-mp-overlay " 子串不算真实属性——必须按属性 token 解析
{
  assert.strictEqual(
    hasRealOverlayElement('<div title=" data-mp-overlay ">base</div>'),
    false,
    'title 属性值内的子串不算 data-mp-overlay 属性',
  );
  // 单引号属性值正常识别
  assert.strictEqual(hasRealOverlayElement("<div data-mp-overlay='key_marker'>x</div>"), true);
  // 无引号属性值
  assert.strictEqual(hasRealOverlayElement('<div data-mp-overlay=key_marker>x</div>'), true);
  // 布尔属性（无值）
  assert.strictEqual(hasRealOverlayElement('<div data-mp-overlay>x</div>'), true);
  // 属性名大写
  assert.strictEqual(hasRealOverlayElement('<div DATA-MP-OVERLAY="x">x</div>'), true);
  // class 值里包含该子串同样不算
  assert.strictEqual(hasRealOverlayElement('<div class="data-mp-overlay">x</div>'), false);
}
// P2-6：单引号 style / 大写 STYLE / 等号空白 / CSS 键大写 都要参与安全区校验
{
  const bad = validateOverlayHtml(
    "<div data-mp-overlay='key_marker' style='position:absolute;left:0;right:0;bottom:0;height:200px'></div>",
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, '单引号 style 的越界 overlay 必须判 invalid');
  assert.strictEqual(bad.reason_code, 'overlay_in_caption_safe_area');
}
{
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" STYLE = "position:absolute;left:0;right:0;BOTTOM:0;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, 'STYLE 大写 + 等号空白 + CSS 键大写也必须判定');
  assert.strictEqual(bad.reason_code, 'overlay_in_caption_safe_area');
}
{
  // 单引号 data-mp-beat-scope 也要能定位出错 beat
  const bad = validateOverlayHtml(
    "<div data-mp-overlay='k' data-mp-beat-scope='scene_y_b2' style='position:absolute;bottom:0;height:200px'></div>",
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false);
  assert.strictEqual(bad.details && bad.details.beat_scope, 'scene_y_b2');
}
{
  // 属性值含裸 >：引号感知 tag 扫描不得截断 opening tag
  const ok = validateOverlayHtml(
    '<div data-mp-overlay="k" title="a > b" style="position:absolute;left:48px;right:48px;bottom:180px;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(ok.valid, true, JSON.stringify(ok));
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" title="a > b" style="position:absolute;bottom:0;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, '含裸 > 属性值的越界 overlay 仍要拦');
  assert.strictEqual(bad.reason_code, 'overlay_in_caption_safe_area');
}
// Finding 1：CSS 值归一化——大写 px / !important / inset:0px 等合法写法不得绕过安全区校验
{
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;left:48px;right:48px;bottom:0PX;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, 'bottom:0PX（大写 px）必须判 invalid');
  assert.strictEqual(bad.reason_code, 'overlay_in_caption_safe_area');
}
{
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;left:48px;right:48px;bottom:0px !important;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, 'bottom:0px !important 必须判 invalid');
  assert.strictEqual(bad.reason_code, 'overlay_in_caption_safe_area');
}
{
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;inset:0px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, 'inset:0px 必须判整屏覆盖');
  assert.strictEqual(bad.reason_code, 'overlay_covers_full_frame');
}
{
  // 变体：大写键 + 大写 px + 大写 !IMPORTANT
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;left:48px;right:48px;BOTTOM:0PX !IMPORTANT;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, 'BOTTOM:0PX !IMPORTANT 必须判 invalid');
  assert.strictEqual(bad.reason_code, 'overlay_in_caption_safe_area');
}
{
  // 变体：inset 值带空白
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;inset: 0px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, 'inset: 0px（带空白）必须判整屏覆盖');
  assert.strictEqual(bad.reason_code, 'overlay_covers_full_frame');
}
{
  // 变体：四边零（混合写法）等价整屏覆盖
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;top:0;bottom:0px;left:0PX;right:0"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, '四边零（混合 0/0px/0PX）必须判整屏覆盖');
  assert.strictEqual(bad.reason_code, 'overlay_covers_full_frame');
}
{
  // 回归：正常值不受影响；!important 剥离后正常值不误伤
  const ok1 = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;left:48px;right:48px;bottom:180px;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(ok1.valid, true, JSON.stringify(ok1));
  const ok2 = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;left:48px;right:48px;bottom:200px !important;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(ok2.valid, true, 'bottom:200px !important 剥离后为正常值，不得误伤：' + JSON.stringify(ok2));
}
// Finding 1（P2）：0% 与多值 inset 等合法零长度写法不得绕过校验
{
  // 生产探针 1：bottom:0%（零长度任意单位）实际贴底边，必须判侵入字幕安全区
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;left:48px;right:48px;bottom:0%;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, 'bottom:0% 必须判 invalid');
  assert.strictEqual(bad.reason_code, 'overlay_in_caption_safe_area');
}
{
  // 生产探针 2：inset:0px 0px（双值全零）等价整屏覆盖
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;inset:0px 0px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, 'inset:0px 0px 必须判整屏覆盖');
  assert.strictEqual(bad.reason_code, 'overlay_covers_full_frame');
}
{
  // 生产探针 3：inset:0 0 0 0（四值全零）等价整屏覆盖
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;inset:0 0 0 0"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, 'inset:0 0 0 0 必须判整屏覆盖');
  assert.strictEqual(bad.reason_code, 'overlay_covers_full_frame');
}
{
  // -0px 也是零：inset:-0px 判整屏覆盖
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;inset:-0px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false, 'inset:-0px 必须判整屏覆盖');
  assert.strictEqual(bad.reason_code, 'overlay_covers_full_frame');
}
{
  // 0.5px 不得误判为零：四边中一边 0.5px 就不是整屏覆盖（bottom:0 仍按安全区拦）
  const bad = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;top:0;bottom:0;left:0.5px;right:0"></div>',
    { height: 1920 },
  );
  assert.strictEqual(bad.valid, false);
  assert.strictEqual(bad.reason_code, 'overlay_in_caption_safe_area', '0.5px 不是零，不得判整屏覆盖');
  // inset 四值的第三项是 bottom：0.5px / -10px 都侵入字幕安全区
  const halfPx = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;inset:0 0 0.5px 0"></div>',
    { height: 1920 },
  );
  assert.strictEqual(halfPx.valid, false, JSON.stringify(halfPx));
  assert.strictEqual(halfPx.reason_code, 'overlay_in_caption_safe_area');
  const negPx = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;inset:0 0 -10px 0"></div>',
    { height: 1920 },
  );
  assert.strictEqual(negPx.valid, false, JSON.stringify(negPx));
  assert.strictEqual(negPx.reason_code, 'overlay_in_caption_safe_area');
  const autoTop = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;inset:auto 48px 0 48px;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(autoTop.valid, false, JSON.stringify(autoTop));
  assert.strictEqual(autoTop.reason_code, 'overlay_in_caption_safe_area');
}
{
  // CSS number 支持显式正号与指数；两者在浏览器中都等价 inset:0
  for (const inset of ['+0px', '0e0px']) {
    const bad = validateOverlayHtml(
      `<div data-mp-overlay="k" style="position:absolute;inset:${inset}"></div>`,
      { height: 1920 },
    );
    assert.strictEqual(bad.valid, false, `${inset} 必须判整屏覆盖：${JSON.stringify(bad)}`);
    assert.strictEqual(bad.reason_code, 'overlay_covers_full_frame');
  }
}
{
  // style 声明遵循 CSS 注释和 !important 级联
  const commented = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;/*x*/bottom:0;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(commented.valid, false, JSON.stringify(commented));
  assert.strictEqual(commented.reason_code, 'overlay_in_caption_safe_area');
  const importantUnsafe = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;bottom:0 !important;bottom:180px;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(importantUnsafe.valid, false, JSON.stringify(importantUnsafe));
  assert.strictEqual(importantUnsafe.reason_code, 'overlay_in_caption_safe_area');
  const importantSafe = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;bottom:180px !important;bottom:0;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(importantSafe.valid, true, JSON.stringify(importantSafe));
}
{
  // inset shorthand 必须原子生效：任一非法分量使整条声明失效，不得局部覆盖 longhand
  const invalidInsetAfterSafeBottom = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;bottom:180px;inset:200px bogus 0 200px;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(invalidInsetAfterSafeBottom.valid, true, JSON.stringify(invalidInsetAfterSafeBottom));
  assert.ok(!invalidInsetAfterSafeBottom.indeterminate, '非法 inset 应整条忽略，保留 bottom:180px');
  const invalidImportantInset = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;inset:bogus !important;bottom:0;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(invalidImportantInset.valid, false, JSON.stringify(invalidImportantInset));
  assert.strictEqual(invalidImportantInset.reason_code, 'overlay_in_caption_safe_area');
  // var() 可能替换成 1~4 个值，无法确定时不得局部展开，也不得静默采用后续非 important longhand
  const unresolvedImportantInset = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;inset:var(--unknown) !important;bottom:0;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(unresolvedImportantInset.valid, true, '无法确定的 important shorthand 保持非阻断');
  assert.strictEqual(unresolvedImportantInset.indeterminate, true, JSON.stringify(unresolvedImportantInset));
}
{
  // CSS 注释相当于 token 间空白，不能把 1/**/80px 拼成 180px
  const splitLength = validateOverlayHtml(
    '<style>.unsafe{position:absolute;bottom:0;height:200px}</style><div data-mp-overlay="k" class="unsafe" style="bottom:1/**/80px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(splitLength.valid, true, '无法静态确认外部 class 时保持非阻断');
  assert.strictEqual(splitLength.indeterminate, true, JSON.stringify(splitLength));
}
{
  // height 不接受负长度；声明被浏览器忽略后可能由 class 决定，不能把 -1px 当作安全高度
  const negativeHeight = validateOverlayHtml(
    '<style>.unsafe{height:1900px}</style><div data-mp-overlay="k" class="unsafe" style="position:absolute;bottom:180px;height:-1px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(negativeHeight.valid, true, '无法静态确认高度时保持非阻断');
  assert.strictEqual(negativeHeight.indeterminate, true, JSON.stringify(negativeHeight));
}
{
  // class / <style> 定位无法在静态 opening tag 中确认，不得静默标为安全
  const classPositioned = validateOverlayHtml(
    '<style>.unsafe{position:absolute;bottom:0;height:200px}</style><div data-mp-overlay="k" class="unsafe"></div>',
    { height: 1920 },
  );
  assert.strictEqual(classPositioned.valid, true, '无法静态确认仍保持非阻断');
  assert.strictEqual(classPositioned.indeterminate, true, JSON.stringify(classPositioned));
}
{
  // 外部 class 的 !important 可覆盖完整内联定位；带 class 的安全结论必须降级人工复核
  const classOverride = validateOverlayHtml(
    '<style>.unsafe{position:absolute;bottom:0 !important;height:200px}</style><div data-mp-overlay="k" class="unsafe" style="position:absolute;bottom:180px;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(classOverride.valid, true, '外部样式不确定性保持非阻断');
  assert.strictEqual(classOverride.indeterminate, true, JSON.stringify(classOverride));
  const classMakesUnsafeInlineSafe = validateOverlayHtml(
    '<style>.safe{position:absolute;bottom:180px !important;height:200px}</style><div data-mp-overlay="k" class="safe" style="position:absolute;bottom:0;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(classMakesUnsafeInlineSafe.valid, true, '外部样式可能覆盖危险内联值时不得确定性误报');
  assert.strictEqual(classMakesUnsafeInlineSafe.indeterminate, true, JSON.stringify(classMakesUnsafeInlineSafe));
}
{
  // CSS escape 会在浏览器 tokenizer 中解码；静态子集不解码时必须整体降级，不能静默忽略危险声明
  for (const style of [
    'position:absolute;bottom:0 !\\69mportant;bottom:180px;height:200px',
    'position:absolute;bottom:180px;bott\\6fm:0;height:200px',
    'position:absolute;bottom:180px;bottom:0p\\78;height:200px',
  ]) {
    const result = validateOverlayHtml(`<div data-mp-overlay="k" style="${style}"></div>`, { height: 1920 });
    assert.strictEqual(result.valid, true, 'CSS escape 保持非阻断');
    assert.strictEqual(result.indeterminate, true, `CSS escape 不得静默返回确定安全：${JSON.stringify(result)}`);
  }
}
{
  // HTML character reference 会先于 CSS 解析解码，静态子集未解码时必须降级
  const encodedQuote = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;bottom:180px;--note:&quot;/*&quot;;bottom:0;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(encodedQuote.valid, true, 'HTML 引用不确定性保持非阻断');
  assert.strictEqual(encodedQuote.indeterminate, true, JSON.stringify(encodedQuote));
}
{
  // CSS 字符串中的注释标记和分号不是语法分隔符
  const stringComment = validateOverlayHtml(
    '<div data-mp-overlay="k" style=\'position:absolute;bottom:180px;--note:"/*";bottom:0;height:200px\'></div>',
    { height: 1920 },
  );
  assert.strictEqual(stringComment.valid, false, '字符串里的 /* 不得吞掉后续 bottom:0');
  assert.strictEqual(stringComment.reason_code, 'overlay_in_caption_safe_area');
  const stringSemicolon = validateOverlayHtml(
    '<div data-mp-overlay="k" style=\'position:absolute;bottom:180px;--note:"x;bottom:0;z";height:200px\'></div>',
    { height: 1920 },
  );
  assert.strictEqual(stringSemicolon.valid, true, JSON.stringify(stringSemicolon));
  assert.ok(!stringSemicolon.indeterminate, '字符串里的伪 bottom 声明不得影响安全定位');
  for (const block of ['{foo;bottom:0;z}', '[foo;bottom:0;z]']) {
    const simpleBlock = validateOverlayHtml(
      `<div data-mp-overlay="k" style="position:absolute;bottom:180px;--x:${block};height:200px"></div>`,
      { height: 1920 },
    );
    assert.strictEqual(simpleBlock.valid, true, `${block} 内分号不得生成伪声明：${JSON.stringify(simpleBlock)}`);
    assert.ok(!simpleBlock.indeterminate, `${block} 不影响可确定的内联定位`);
  }
}
{
  // Chromium 支持的 root font-relative 单位必须识别为合法但静态不可换算的长度
  for (const unit of ['rex', 'rch', 'ric', 'rcap']) {
    const result = validateOverlayHtml(
      `<div data-mp-overlay="k" style="position:absolute;bottom:180px;bottom:1${unit};height:200px"></div>`,
      { height: 1920 },
    );
    assert.strictEqual(result.valid, true, `${unit} 保持非阻断`);
    assert.strictEqual(result.indeterminate, true, `${unit} 不得被当作无效声明静默保留 bottom:180px：${JSON.stringify(result)}`);
  }
}
{
  // all 会重置此前的定位 longhand；静态子集按级联降级，不得继续沿用旧 bottom:0
  const resetByAll = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;bottom:0;all:initial;top:200px;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(resetByAll.valid, true, JSON.stringify(resetByAll));
  assert.strictEqual(resetByAll.indeterminate, true, 'all:initial 后应降级人工复核');
}
{
  // CSS 数字语法合法但超过 JS 有限数范围时，浏览器会钳制；不得静默忽略
  const overflowExponent = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;bottom:180px;height:1e999px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(overflowExponent.valid, true, '超范围数值保持非阻断');
  assert.strictEqual(overflowExponent.indeterminate, true, JSON.stringify(overflowExponent));
}
{
  // height 的 intrinsic sizing 值合法但依赖内容，静态子集必须降级而不是当成无效声明忽略
  for (const heightValue of ['max-content', 'min-content', 'fit-content', 'fit-content(300px)', 'stretch']) {
    const intrinsicHeight = validateOverlayHtml(
      `<div data-mp-overlay="k" style="position:absolute;bottom:180px;height:${heightValue}"></div>`,
      { height: 1920 },
    );
    assert.strictEqual(intrinsicHeight.valid, true, `${heightValue} 保持非阻断`);
    assert.strictEqual(intrinsicHeight.indeterminate, true,
      `${heightValue} 不得被静默忽略：${JSON.stringify(intrinsicHeight)}`);
  }
}
{
  // 逻辑定位/尺寸及 min/max-height 会改变最终物理布局；当前子集不换算时统一降级
  for (const declaration of [
    'inset-block-end:0',
    'inset-block:0 180px',
    'block-size:1900px',
    'min-height:1900px',
    'max-height:100px',
    'writing-mode:vertical-rl',
  ]) {
    const logicalLayout = validateOverlayHtml(
      `<div data-mp-overlay="k" style="position:absolute;bottom:180px;height:200px;${declaration}"></div>`,
      { height: 1920 },
    );
    assert.strictEqual(logicalLayout.valid, true, `${declaration} 保持非阻断`);
    assert.strictEqual(logicalLayout.indeterminate, true,
      `${declaration} 不得静默保留旧物理值：${JSON.stringify(logicalLayout)}`);
  }
}
{
  // 浏览器会忽略未知长度单位；不得把 0foo 当作 bottom:0 误报
  const invalidUnit = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;bottom:0foo;top:200px;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(invalidUnit.valid, true, JSON.stringify(invalidUnit));
  assert.ok(!invalidUnit.indeterminate, '无效 bottom 声明应忽略，由有效 top+height 完成静态判断');
}
{
  // 非 px 非零定位值（bottom:5%）无法静态确认：valid 不变但要带 indeterminate 标记
  const result = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;left:48px;right:48px;bottom:5%;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(result.valid, true, 'indeterminate 不改变 valid 语义（非阻断）');
  assert.strictEqual(result.indeterminate, true, 'bottom:5% 必须标记 indeterminate');
  assert.ok(
    result.details && Array.isArray(result.details.indeterminate_props)
      && result.details.indeterminate_props.includes('bottom'),
    `details.indeterminate_props 必须含 bottom：${JSON.stringify(result)}`,
  );
  assert.ok(String(result.message).includes('bottom:5%'), 'message 必须带出无法确认的值');
  // calc(...) 同样 indeterminate
  const calc = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;bottom:calc(10% + 20px);height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(calc.valid, true);
  assert.strictEqual(calc.indeterminate, true, 'bottom:calc(...) 必须标记 indeterminate');
  // 正常 px 值不得带 indeterminate
  const normal = validateOverlayHtml(
    '<div data-mp-overlay="k" style="position:absolute;left:48px;right:48px;bottom:180px;height:200px"></div>',
    { height: 1920 },
  );
  assert.strictEqual(normal.valid, true);
  assert.ok(!normal.indeterminate, '正常 px 值不得标 indeterminate');
}
{
  // validationGate 接线：indeterminate → overlay_position_indeterminate warning
  const { assetFirstOverlayIssues } = require('../server/services/creative-video/html-video/validationGate');
  const html = '<div data-mp-overlay="k" style="position:absolute;left:48px;right:48px;bottom:5%;height:200px"></div>';
  const issues = assetFirstOverlayIssues(html);
  assert.ok(
    issues.some(issue => issue.code === 'overlay_position_indeterminate' && issue.severity === 'warning'),
    `indeterminate 必须产生 warning 级 issue：${JSON.stringify(issues)}`,
  );
  const normalHtml = '<div data-mp-overlay="k" style="position:absolute;left:48px;right:48px;bottom:180px;height:200px"></div>';
  assert.deepStrictEqual(
    assetFirstOverlayIssues(normalHtml),
    [],
    '正常 px 值不得产生 indeterminate issue',
  );
}
// Finding 5：未闭合 HTML 注释吞到文本末尾——注释内伪 overlay 不算真实元素
{
  const unclosedComment = '<div class="hero">base</div><!-- fallback: <div data-mp-overlay="key_marker"></div>';
  assert.strictEqual(hasRealOverlayElement(unclosedComment), false, '未闭合注释内的 tag 形文本不算真实 overlay');
  // 未闭合注释之前的真实 overlay 仍要认
  const realBeforeComment = '<div data-mp-overlay="key_marker" style="position:absolute;bottom:180px"></div><!-- todo';
  assert.strictEqual(hasRealOverlayElement(realBeforeComment), true, '未闭合注释之前的真实 overlay 必须识别');
  // 完整注释行为回归：注释剥除后，后续真实节点仍要认
  const afterClosedComment = '<!-- note --><div data-mp-overlay="key_marker"></div>';
  assert.strictEqual(hasRealOverlayElement(afterClosedComment), true, '完整注释之后的真实 overlay 必须识别');
}
console.log('motion primitive catalog tests passed');
