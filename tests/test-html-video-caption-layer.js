const assert = require('assert');
const { ensureCaptionLayer, hasUnmanagedCaptionLayer, renderCaptionLayer } = require('../server/services/creative-video/html-video/captionLayer');

const captions = [{ id: 'c1', start: 0, end: 3, text: '字幕文本' }];
const captionLayerCount = html => (html.match(/data-hv-layer="captions"/g) || []).length;

{
  const layer = renderCaptionLayer(captions);
  assert.match(layer, /data-hv-layer="captions"/);
  assert.match(layer, /data-role="subtitle-caption"/);
  assert.doesNotMatch(layer, /data-text-key="subtitle"/);
  assert.match(layer, /data-caption-id="c1"/);
  assert.match(layer, /字幕文本/);
}

{
  const layer = renderCaptionLayer([
    { id: 'c1', start: 0, end: 1, text: '第一句' },
    { id: 'c2', start: 1, end: 2, text: '第二句' },
  ]);
  assert.match(layer, /\.hv-caption-item\{display:none;/);
  assert.match(layer, /\.hv-caption-item\[data-hv-active="true"\]\{display:block;/);
  assert.match(layer, /data-hv-caption-clock/);
  assert.match(layer, /requestAnimationFrame/);
}

{
  const html = '<html><body><main>画面</main></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.match(next, /data-hv-layer="captions"/);
  assert.match(next, /字幕文本/);
  assert.match(next, /<\/body>/);
}

{
  const html = '<html><body><div data-hv-layer="captions">已有字幕</div></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.equal(captionLayerCount(next), 1);
  assert.match(next, /字幕文本/);
  assert.doesNotMatch(next, /已有字幕/);
}

{
  const html = '<html><body><div data-hv-layer="captions"><div class="inner">旧字幕</div></div><main>画面</main></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.equal(captionLayerCount(next), 1);
  assert.doesNotMatch(next, /旧字幕/);
  assert.doesNotMatch(next, /class="inner"/);
  assert.match(next, /<body><main>画面<\/main><style data-hv-layer-style="captions">/);
}

{
  const html = '<html><body><div data-hv-layer="captions" data-hv-managed="false">模板字幕</div></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.equal(captionLayerCount(next), 2);
  assert.match(next, /模板字幕/);
  assert.match(next, /字幕文本/);
}

{
  const html = '<html><body><script>const tpl = \'<div data-hv-layer="captions">old</div>\';</script></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.match(next, /const tpl = '<div data-hv-layer="captions">old<\/div>';/);
  assert.equal(captionLayerCount(next), 2);
  assert.match(next, /字幕文本/);
}

{
  const html = '<html><body><script>const tpl = \'<div data-hv-layer="captions">old</div>\'; const marker = "<script>";</script><main>OK</main></body></html>';
  const next = ensureCaptionLayer(html, [{ text: 'CAP', start: 0, end: 1 }]);
  assert.match(next, /const tpl = '<div data-hv-layer="captions">old<\/div>'; const marker = "<script>";/);
  assert.match(next, /<\/script><main>OK<\/main><style data-hv-layer-style="captions">/);
  assert.match(next, /CAP/);
}

{
  const html = '<html><body><style>.x::after{content:\'<div data-hv-layer="captions">old</div> <style>\';}</style><main>OK</main></body></html>';
  const next = ensureCaptionLayer(html, [{ text: 'CAP', start: 0, end: 1 }]);
  assert.match(next, /\.x::after\{content:'<div data-hv-layer="captions">old<\/div> <style>';\}/);
  assert.match(next, /<\/style><main>OK<\/main><style data-hv-layer-style="captions">/);
  assert.match(next, /CAP/);
}

{
  const html = '<html><body><script>const close = "</body>";</script><main>画面</main></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.match(next, /const close = "<\/body>";/);
  assert.match(next, /<\/script><main>画面<\/main><style data-hv-layer-style="captions">/);
  assert.match(next, /<\/div><script data-hv-caption-clock="true">/);
  assert.match(next, /<\/script><\/body><\/html>$/);
}

{
  const html = '<html><body><script>const close = "</body>"; const marker = "<script>";</script><main>画面</main></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.match(next, /const close = "<\/body>"; const marker = "<script>";/);
  assert.match(next, /<\/script><main>画面<\/main><style data-hv-layer-style="captions">/);
  assert.match(next, /<\/div><script data-hv-caption-clock="true">/);
  assert.match(next, /<\/script><\/body><\/html>$/);
}

{
  const html = '<html><head><title></body></title></head><body><main>画面</main></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.match(next, /<title><\/body><\/title>/);
  assert.match(next, /<main>画面<\/main><style data-hv-layer-style="captions">/);
  assert.match(next, /<\/div><script data-hv-caption-clock="true">/);
  assert.match(next, /<\/script><\/body><\/html>$/);
}

{
  const html = '<html><body><textarea><div data-hv-layer="captions">literal</div></textarea><main>画面</main></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.match(next, /<textarea><div data-hv-layer="captions">literal<\/div><\/textarea>/);
  assert.match(next, /<main>画面<\/main><style data-hv-layer-style="captions">/);
}

{
  const html = '<html><body><template><template><span>内层</span></template><p></body></p></template><main>画面</main></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.match(next, /<template><template><span>内层<\/span><\/template><p><\/body><\/p><\/template><main>画面<\/main><style data-hv-layer-style="captions">/);
  assert.match(next, /<\/div><script data-hv-caption-clock="true">/);
  assert.match(next, /<\/script><\/body><\/html>$/);
}

{
  const html = [
    '<html><body>',
    '<script>const tpl = \'<div data-hv-layer="captions" data-hv-managed="false">脚本字幕</div>\';</script>',
    '<style>.x::after{content:"<div data-hv-layer=\\"captions\\" data-hv-managed=\\"false\\">样式字幕</div>"}</style>',
    '<template><div data-hv-layer="captions" data-hv-managed="false">模板片段字幕</div></template>',
    '<!-- <div data-hv-layer="captions" data-hv-managed="false">注释字幕</div> -->',
    '</body></html>',
  ].join('');
  assert.equal(hasUnmanagedCaptionLayer(html), false);
}

{
  const html = '<html><body><script>const tpl = \'<div data-hv-layer="captions" data-hv-managed="false">脚本字幕</div>\'; const marker = "<script>";</script></body></html>';
  assert.equal(hasUnmanagedCaptionLayer(html), false);
}

{
  const html = '<html><body><textarea><div data-hv-layer="captions" data-hv-managed="false">literal</div></textarea></body></html>';
  assert.equal(hasUnmanagedCaptionLayer(html), false);
}

{
  const html = '<html><body><template><template><div data-hv-layer="captions" data-hv-managed="false">模板片段字幕</div></template></template></body></html>';
  assert.equal(hasUnmanagedCaptionLayer(html), false);
}

{
  const html = '<html><body><style data-role="subtitle-caption-style">.old{}</style><div class="hv-subtitle-caption" data-role="subtitle-caption" data-text-key="subtitle">旧字幕</div></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.equal(captionLayerCount(next), 1);
  assert.doesNotMatch(next, /subtitle-caption-style/);
  assert.doesNotMatch(next, /hv-subtitle-caption/);
  assert.doesNotMatch(next, /旧字幕/);
  assert.match(next, /字幕文本/);
}

{
  const html = '<html><body><div data-hv-layer="captions" data-hv-managed="true">受管字幕</div><div data-hv-layer="captions" data-hv-managed="false">模板字幕</div></body></html>';
  const next = ensureCaptionLayer(html, []);
  assert.equal(captionLayerCount(next), 1);
  assert.doesNotMatch(next, /受管字幕/);
  assert.match(next, /模板字幕/);
}

{
  const once = ensureCaptionLayer('<html><body><main>画面</main></body></html>', captions);
  const twice = ensureCaptionLayer(once, captions);
  assert.equal(captionLayerCount(twice), 1);
  assert.equal(twice, once);
}

{
  const layer = renderCaptionLayer([{ id: 'c"<script>', start: 0, end: 1, text: '<script>alert("x")</script>' }]);
  assert.match(layer, /data-caption-id="c&quot;&lt;script&gt;"/);
  assert.match(layer, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(layer, /<script>alert/);
}

console.log('html-video caption layer tests passed');
