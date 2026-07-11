const assert = require('assert');
const { injectCaptionLayerGuard } = require('../server/services/creative-video/html-video/materializer');

// asset_first：字幕层容器强制置顶 + pointer-events 隔离（选择器是 .hv-caption-layer class）
{
  const html = '<html><head></head><body><div id="content" style="z-index:2147483000"></div></body></html>';
  const out = injectCaptionLayerGuard(html, { visualStrategy: 'asset_first' });
  assert.ok(out.includes('data-hv-caption-guard'), '应注入字幕守卫样式');
  assert.ok(/z-index:\s*2147483647/.test(out), '字幕层必须使用最大 z-index');
  assert.ok(out.includes('.hv-caption-layer'), '守卫样式必须针对受管字幕层 class（captionLayer.js:222）');
}
// 硬约束 A 回归：hf_first / 未指定策略时输出与输入完全一致
{
  const html = '<html><body></body></html>';
  assert.strictEqual(injectCaptionLayerGuard(html, { visualStrategy: 'hf_first' }), html);
  assert.strictEqual(injectCaptionLayerGuard(html, {}), html);
}
// 幂等：重复注入不叠加
{
  const html = '<html><body></body></html>';
  const once = injectCaptionLayerGuard(html, { visualStrategy: 'asset_first' });
  const twice = injectCaptionLayerGuard(once, { visualStrategy: 'asset_first' });
  assert.strictEqual(once, twice);
}
console.log('caption safety tests passed');
