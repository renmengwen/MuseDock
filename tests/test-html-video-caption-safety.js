const assert = require('assert');
const { injectCaptionLayerGuard } = require('../server/services/creative-video/html-video/materializer');

// 字幕层容器强制置顶 + pointer-events 隔离（选择器是 .hv-caption-layer class）
{
  const html = '<html><head></head><body><div id="content" style="z-index:2147483000"></div></body></html>';
  const out = injectCaptionLayerGuard(html);
  assert.ok(out.includes('data-hv-caption-guard'), '应注入字幕守卫样式');
  assert.ok(/z-index:\s*2147483647/.test(out), '字幕层必须使用最大 z-index');
  assert.ok(out.includes('.hv-caption-layer'), '守卫样式必须针对受管字幕层 class（captionLayer.js:222）');
}
// 幂等：重复注入不叠加
{
  const html = '<html><body></body></html>';
  const once = injectCaptionLayerGuard(html);
  const twice = injectCaptionLayerGuard(once);
  assert.strictEqual(once, twice);
}
// 分支覆盖：无 head 有 body（含大写标签/带属性）→ 守卫注入 body 开标签之后
{
  const html = '<HTML><BODY class="stage" data-x="1"><div>content</div></BODY></HTML>';
  const out = injectCaptionLayerGuard(html);
  assert.ok(out.includes('data-hv-caption-guard'), '无 head 时也必须注入守卫样式');
  assert.ok(
    /<BODY class="stage" data-x="1"><style data-hv-caption-guard>/i.test(out),
    '守卫必须紧跟 body 开标签之后注入',
  );
}
// 分支覆盖：head/body 都无 → 守卫前置
{
  const html = '<div>fragment</div>';
  const out = injectCaptionLayerGuard(html);
  assert.ok(out.startsWith('<style data-hv-caption-guard>'), '无 head/body 时守卫必须前置');
  assert.ok(out.endsWith('<div>fragment</div>'), '原始片段必须完整保留在守卫之后');
}
console.log('caption safety tests passed');
