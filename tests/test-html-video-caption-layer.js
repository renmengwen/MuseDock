const assert = require('assert');
const {
  ensureCaptionLayer,
  hasUnmanagedCaptionLayer,
  normalizeCaptionsForFrame,
  renderCaptionLayer,
} = require('../server/services/creative-video/html-video/captionLayer');

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
    { id: 'c1', start: 0, end: 2, text: '（吸气）先收藏这 10 类插件。（稍停顿）用到时再安装。（推荐）保留括号说明。' },
  ]);
  assert.doesNotMatch(layer, /吸气|稍停顿/);
  assert.match(layer, /先收藏这 10 类插件。用到时再安装。/);
  assert.match(layer, /（推荐）保留括号说明。/);
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
  const split = normalizeCaptionsForFrame({
    id: 'scene_02',
    duration_sec: 12,
    captions: [{
      id: 'cap_01',
      start: 0,
      end: 12,
      text: '最近，微软正式合并了一个关于 Vite+ 的 PR：在 VS Code 的 npm.scriptRunner 枚举里，新增了 vp，也就是 Vite+。',
    }],
  });
  assert.ok(split.length > 1);
  assert.equal(split.map(item => item.text).join(''), '最近，微软正式合并了一个关于 Vite+ 的 PR：在 VS Code 的 npm.scriptRunner 枚举里，新增了 vp，也就是 Vite+。');
  assert.equal(split[0].start, 0);
  assert.equal(split.at(-1).end, 12);
  for (let index = 1; index < split.length; index += 1) {
    assert.equal(split[index].start, split[index - 1].end);
  }
  assert.ok(split.every(item => item.text.length <= 34));
}

{
  const split = normalizeCaptionsForFrame({
    id: 'scene_06',
    duration_sec: 7.68,
    captions: [{
      id: 'cap_01',
      start: 0,
      end: 7.68,
      text: '如今Vue、React、Svelte、Solid等生态都拥抱Vite，新项目里它正成为默认选项。',
    }],
  });
  assert.ok(split.length > 1);
  assert.ok(split.every(item => !/^[，。！？；：,.!?;:]/.test(item.text)));
  assert.equal(split.map(item => item.text).join(''), '如今Vue、React、Svelte、Solid等生态都拥抱Vite，新项目里它正成为默认选项。');
}

{
  const split = normalizeCaptionsForFrame({
    id: 'scene_07',
    duration_sec: 8.06,
    captions: [{
      id: 'cap_01',
      start: 0,
      end: 8.06,
      text: '配置后，在 Claude、Cursor、Copilot、Windsurf 或 Codex 里说需求即可。',
    }],
  });
  assert.ok(split.length > 1);
  assert.ok(split.every(item => item.text === item.text.trim()));
  assert.doesNotMatch(split.map(item => item.text).join('|'), /\|\s/);
}

{
  const html = '<html><body><main>画面</main></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.match(next, /data-hv-layer="captions"/);
  assert.match(next, /字幕文本/);
  assert.match(next, /<\/body>/);
}

{
  const html = '<html><body><main>画面</main></body></html>';
  const result = ensureCaptionLayer(html, [{ start: 0, end: 1, text: '字幕' }], {
    generateCaptions: false,
  });
  assert.equal(result, html);
}

{
  const html = [
    '<html><body>',
    '<main>画面</main>',
    '<div data-hv-layer="captions" data-hv-managed="true"><span>旧字幕</span></div>',
    '<footer>结尾</footer>',
    '</body></html>',
  ].join('');
  const result = ensureCaptionLayer(html, [{ start: 0, end: 1, text: '新字幕' }], {
    generateCaptions: false,
  });
  assert.doesNotMatch(result, /data-hv-layer="captions"/);
  assert.doesNotMatch(result, /旧字幕/);
  assert.doesNotMatch(result, /新字幕/);
  assert.match(result, /<main>画面<\/main>/);
  assert.match(result, /<footer>结尾<\/footer>/);
}

{
  const html = [
    '<html><body>',
    '<main>画面</main>',
    '<div data-hv-layer="captions" data-hv-managed="false">用户字幕层</div>',
    '</body></html>',
  ].join('');
  const result = ensureCaptionLayer(html, [{ start: 0, end: 1, text: '新字幕' }], {
    generateCaptions: false,
  });
  assert.match(result, /data-hv-layer="captions"/);
  assert.match(result, /data-hv-managed="false"/);
  assert.match(result, /用户字幕层/);
  assert.doesNotMatch(result, /新字幕/);
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
  const html = '<html><body><main>画面</main><div class="caption-bar">AI 内置字幕</div></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.equal(captionLayerCount(next), 1);
  assert.doesNotMatch(next, /AI 内置字幕/);
  assert.doesNotMatch(next, /class="caption-bar"/);
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

// ===== D-05：cue 驱动的字幕关键词高亮（REQ-D-08 字幕侧） =====
const {
  applyFocusKeywords,
  focusKeywordsByCaptionId,
} = require('../server/services/creative-video/html-video/captionLayer');
const { keywordOccurrence } = require('../server/services/creative-video/html-video/focusCuePlanner');

// keywordOccurrence 必须从 planner 追加导出（字幕侧复用同一边界语义）
{
  assert.equal(typeof keywordOccurrence, 'function', 'focusCuePlanner 必须导出 keywordOccurrence');
  assert.equal(keywordOccurrence('重启用 restart，请点 star', 'star'), 'star');
  assert.equal(keywordOccurrence('请 restart 服务', 'star'), '');
  assert.equal(keywordOccurrence('镜头展示人物头部', '头'), '');
  assert.equal(keywordOccurrence('镜头之后，头，保持', '头'), '头');
}

// 无 cue（无注记）时输出与现状字节级一致：不出现 hv-caption-kw，样式块与 item 结构保持原样
{
  const plain = renderCaptionLayer([{ id: 'c1', start: 0, end: 2, text: '普通字幕' }]);
  assert.doesNotMatch(plain, /hv-caption-kw/);
  assert.ok(plain.includes('<span class="hv-caption-item" data-role="subtitle-caption" data-caption-id="c1" data-start="0" data-end="2">普通字幕</span>'));
  const styleMatch = plain.match(/<style data-hv-layer-style="captions">([\s\S]*?)<\/style>/);
  assert.ok(styleMatch, '字幕样式块必须存在');
  assert.equal(styleMatch[1], [
    '.hv-caption-layer{position:absolute;left:50%;bottom:42px;transform:translateX(-50%);width:max-content;max-width:84%;z-index:9999;pointer-events:none;text-align:center;font:600 34px/1.28 "Noto Sans SC","Microsoft YaHei",Arial,sans-serif;letter-spacing:0;}',
    '.hv-caption-item{display:none;padding:14px 22px;border-radius:8px;background:rgba(0,0,0,.68);color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.55);white-space:normal;overflow-wrap:anywhere;}',
    '.hv-caption-item[data-hv-active="true"]{display:block;}',
  ].join(''), '无 cue 时样式块必须与现状逐字节一致');
}

// applyFocusKeywords：空映射零改动（同一引用），命中 id 注记 focus_keyword，未命中原对象原样
{
  const source = [
    { id: 'c1', start: 0, end: 2, text: '先看这里的 Star 按钮' },
    { id: 'c2', start: 2, end: 4, text: '再看整体页面布局' },
  ];
  assert.strictEqual(applyFocusKeywords(source, new Map()), source, '空映射必须原样返回同一数组');
  const annotated = applyFocusKeywords(source, new Map([['c1', 'Star 按钮']]));
  assert.equal(annotated[0].focus_keyword, 'Star 按钮');
  assert.strictEqual(annotated[1], source[1], '无 cue 的 caption 必须保持原对象');
  assert.equal('focus_keyword' in source[0], false, '不得原地修改入参 caption');
}

// 高亮渲染：span 包裹 + 样式仅挂 active 态 + 结构稳定 + 时钟脚本零改动
{
  const source = [
    { id: 'c1', start: 0, end: 2, text: '先看这里的 Star 按钮' },
    { id: 'c2', start: 2, end: 4, text: '再看整体页面布局' },
  ];
  const plain = renderCaptionLayer(source);
  const layer = renderCaptionLayer(applyFocusKeywords(source, new Map([['c1', 'Star 按钮']])));
  assert.ok(layer.includes('>先看这里的 <span class="hv-caption-kw">Star 按钮</span></span>'), '关键词必须被 hv-caption-kw 包裹');
  assert.ok(layer.includes('>再看整体页面布局</span>'), '无 cue 的 caption 输出保持原样');
  assert.ok(
    layer.includes('.hv-caption-item[data-hv-active="true"] .hv-caption-kw{color:#FFD54A;font-weight:800;display:inline-block;transform:scale(1.08);}'),
    '高亮样式必须仅在 active 态生效且用 transform 放大（不改排版尺寸）',
  );
  assert.doesNotMatch(plain, /\.hv-caption-kw/, '无注记时不得出现高亮样式规则');
  const scriptOf = html => (html.match(/<script data-hv-caption-clock="true">[\s\S]*?<\/script>/) || [])[0];
  assert.equal(scriptOf(layer), scriptOf(plain), '不得新增任何 JS 订阅，时钟脚本必须逐字节一致');
}

// 大小写不敏感重定位：合并 cue 的 keyword 形式取自首条 caption，后续 caption 大小写不同也要按本条原文包裹
{
  const layer = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: 'github star 数上涨' }],
    new Map([['c1', 'GitHub Star']]),
  ));
  assert.ok(layer.includes('><span class="hv-caption-kw">github star</span> 数上涨</span>'), '必须包裹本条 caption 自己的原文切片');
  assert.doesNotMatch(layer, /GitHub Star/, '不得把首条 caption 的大小写形式搬进本条');
}

// 拉丁词边界：restart 内的 star 不得命中（与 planner 同语义），真正的 star 才高亮
{
  const layer = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: '重启用 restart 演示，再点 star' }],
    new Map([['c1', 'star']]),
  ));
  assert.ok(layer.includes('>重启用 restart 演示，再点 <span class="hv-caption-kw">star</span></span>'), '必须跳过 restart 内被词边界拒绝的位置');
  const rejected = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: '请 restart 服务' }],
    new Map([['c1', 'star']]),
  ));
  assert.doesNotMatch(rejected, /hv-caption-kw/, '整条无词边界合法命中时不得高亮');
  assert.ok(rejected.includes('>请 restart 服务</span>'), '找不到时文本必须原样保留');
}

// 单汉字高亮与 Camera matcher 同语义：词中位置拒绝，独立汉字接受。
{
  const rejected = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: '镜头展示人物头部' }],
    new Map([['c1', '头']]),
  ));
  assert.doesNotMatch(rejected, /hv-caption-kw/);
  const accepted = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: '镜头之后，头，保持' }],
    new Map([['c1', '头']]),
  ));
  assert.ok(accepted.includes('镜头之后，<span class="hv-caption-kw">头</span>，保持'));
}

// 找不到关键词：绝不插入旁白中不存在的词、不改动文本内容
{
  const layer = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: '这里没有可高亮的词' }],
    new Map([['c1', '价格面板']]),
  ));
  assert.doesNotMatch(layer, /hv-caption-kw/);
  assert.doesNotMatch(layer, /价格面板/, '不得把 keyword 插进字幕');
  assert.ok(layer.includes('>这里没有可高亮的词</span>'));
}

// 转义安全：先在原文定位再分段转义，含 &、<、>、引号的 caption 与 keyword 不错位、不双重转义
{
  const layer = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: 'A&B 方案 <重点> "对比"' }],
    new Map([['c1', '<重点>']]),
  ));
  assert.ok(
    layer.includes('>A&amp;B 方案 <span class="hv-caption-kw">&lt;重点&gt;</span> &quot;对比&quot;</span>'),
    '前段/keyword/后段必须各自转义一次且不错位',
  );
  assert.doesNotMatch(layer, /&amp;lt;|&amp;quot;|&amp;amp;/, '不得双重转义');

  const ampersandKeyword = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: '选 A&B 方案' }],
    new Map([['c1', 'A&B']]),
  ));
  assert.ok(ampersandKeyword.includes('>选 <span class="hv-caption-kw">A&amp;B</span> 方案</span>'), '含 & 的 keyword 必须整体包裹并转义一次');
}

// 边界位置：keyword 在 caption 开头/结尾都要正确包裹
{
  const atStart = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: 'Star 按钮很显眼' }],
    new Map([['c1', 'Star 按钮']]),
  ));
  assert.ok(atStart.includes('><span class="hv-caption-kw">Star 按钮</span>很显眼</span>'));
  const atEnd = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: '请点击 Star' }],
    new Map([['c1', 'Star']]),
  ));
  assert.ok(atEnd.includes('>请点击 <span class="hv-caption-kw">Star</span></span>'));
}

// 中文 keyword、中英混合 caption；每条 caption 至多一个 cue，只高亮首次出现
{
  const cjk = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: '点击价格面板查看 Pricing 详情' }],
    new Map([['c1', '价格面板']]),
  ));
  assert.ok(cjk.includes('>点击<span class="hv-caption-kw">价格面板</span>查看 Pricing 详情</span>'));
  const latin = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: '点击价格面板查看 Pricing 详情' }],
    new Map([['c1', 'Pricing']]),
  ));
  assert.ok(latin.includes('>点击价格面板查看 <span class="hv-caption-kw">Pricing</span> 详情</span>'));
  const first = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'c1', start: 0, end: 2, text: '价格与价格对比' }],
    new Map([['c1', '价格']]),
  ));
  assert.ok(first.includes('><span class="hv-caption-kw">价格</span>与价格对比</span>'), '只高亮首次出现');
}

// 拆分长字幕（id_NN）：注记随拆分片下传，仅真正包含关键词的分片高亮，拆分行为零回归
{
  const longText = '一二三四五六七八九十一二三四五六七八九十，现在聚焦价格面板看关键数字。';
  const layer = renderCaptionLayer(applyFocusKeywords(
    [{ id: 'cap_01', start: 0, end: 8, text: longText }],
    new Map([['cap_01', '价格面板']]),
  ));
  assert.match(layer, /data-caption-id="cap_01_01"/);
  assert.match(layer, /data-caption-id="cap_01_02"/);
  assert.ok(layer.includes('>一二三四五六七八九十一二三四五六七八九十，</span>'), '不含关键词的分片必须保持原样');
  assert.ok(layer.includes('>现在聚焦<span class="hv-caption-kw">价格面板</span>看关键数字。</span>'), '含关键词的分片必须高亮');
}

// focusKeywordsByCaptionId：beat_mp4（metadata.visual_beat）与 scene_html（metadata.visual_beats）两种形态，
// camera_zoom 与 highlight_only 都参与高亮；无 camera/keyword/caption_ids 时容错为空
{
  const zoomCue = { id: 'cue_a', caption_ids: ['cap_01'], keyword: 'Star 按钮', region_id: 'r_a', effect: 'camera_zoom', zoom: 'auto', return_policy: 'hold_or_next' };
  const highlightCue = { id: 'cue_b', caption_ids: ['cap_02', 'cap_03'], keyword: '价格面板', region_id: 'r_b', effect: 'highlight_only', return_policy: 'hold_or_next' };
  const beatNode = {
    metadata: {
      visual_beat: {
        id: 'b1',
        visual_base: { type: 'image_sequence', shots: [{ id: 's1', camera: { initial_view: 'overview', focus_cues: [zoomCue] } }] },
      },
    },
  };
  const beatMap = focusKeywordsByCaptionId(beatNode);
  assert.equal(beatMap.size, 1);
  assert.equal(beatMap.get('cap_01'), 'Star 按钮');

  const sceneNode = {
    metadata: {
      visual_beats: [
        { id: 'b1', visual_base: { type: 'image_sequence', shots: [{ id: 's1', camera: { focus_cues: [zoomCue] } }] } },
        { id: 'b2', visual_base: { type: 'image_sequence', shots: [{ id: 's2', camera: { focus_cues: [highlightCue] } }, { id: 's3' }] } },
      ],
    },
  };
  const sceneMap = focusKeywordsByCaptionId(sceneNode);
  assert.equal(sceneMap.size, 3);
  assert.equal(sceneMap.get('cap_01'), 'Star 按钮');
  assert.equal(sceneMap.get('cap_02'), '价格面板', 'highlight_only 的 cue 同样参与字幕高亮');
  assert.equal(sceneMap.get('cap_03'), '价格面板');

  const aliasCue = {
    ...zoomCue,
    caption_ids: ['cap_01', 'cap_02'],
    keyword: 'Stars',
    keywords_by_caption_id: { cap_01: 'Stars', cap_02: '星标' },
  };
  const aliasMap = focusKeywordsByCaptionId({
    metadata: { visual_beat: { visual_base: { shots: [{ camera: { focus_cues: [aliasCue] } }] } } },
  });
  assert.equal(aliasMap.get('cap_01'), 'Stars');
  assert.equal(aliasMap.get('cap_02'), '星标', '合并 cue 的后续字幕必须取自己的原文关键词');
  const aliasLayer = renderCaptionLayer(applyFocusKeywords([
    { id: 'cap_01', start: 0, end: 2, text: 'Stars 数量持续上涨' },
    { id: 'cap_02', start: 2, end: 4, text: '点击星标查看收藏' },
  ], aliasMap));
  assert.ok(aliasLayer.includes('><span class="hv-caption-kw">Stars</span> 数量持续上涨</span>'));
  assert.ok(aliasLayer.includes('>点击<span class="hv-caption-kw">星标</span>查看收藏</span>'));

  assert.equal(focusKeywordsByCaptionId(null).size, 0);
  assert.equal(focusKeywordsByCaptionId({}).size, 0);
  assert.equal(focusKeywordsByCaptionId({ metadata: { visual_beat: { visual_base: { type: 'image_sequence', shots: [{ id: 's1' }] } } } }).size, 0);
  assert.equal(focusKeywordsByCaptionId({
    metadata: { visual_beat: { visual_base: { shots: [{ camera: { focus_cues: [{ caption_ids: ['cap_x'], keyword: '  ' }] } }] } } },
  }).size, 0, '空 keyword 的 cue 必须被忽略');
}

// normalizeCaptionsForFrame 派生态纪律：
// (1) frame.metadata.graph_node 携带 cue（materializer/项目帧形态）→ 注记 focus_keyword；
// (2) frame.metadata.visual_beat 直挂（beat 帧形态）→ 同样注记；
// (3) 无 cue 元数据时剥离入参中的旧注记（防 timelineConsistency 假阳性）；
// (4) 拆分片 id 的 cue 绑定注到对应分片上。
{
  const cue = { id: 'cue_a', caption_ids: ['cap_01'], keyword: 'Star 按钮', region_id: 'r_a', effect: 'camera_zoom', zoom: 'auto', return_policy: 'hold_or_next' };
  const cueBeat = {
    id: 'b1',
    visual_base: { type: 'image_sequence', shots: [{ id: 's1', camera: { initial_view: 'overview', focus_cues: [cue] } }] },
  };
  const baseCaptions = [
    { id: 'cap_01', start: 0, end: 2, text: '先看这里的 Star 按钮' },
    { id: 'cap_02', start: 2, end: 4, text: '再看整体页面布局' },
  ];

  const viaGraphNode = normalizeCaptionsForFrame({
    id: 'scene_01',
    duration_sec: 4,
    captions: baseCaptions,
    metadata: { graph_node: { id: 'scene_01_b1', metadata: { visual_beat: cueBeat } } },
  });
  assert.equal(viaGraphNode[0].focus_keyword, 'Star 按钮');
  assert.equal('focus_keyword' in viaGraphNode[1], false);

  const viaFrameBeat = normalizeCaptionsForFrame({
    id: 'scene_01',
    duration_sec: 4,
    captions: baseCaptions,
    metadata: { visual_beat: cueBeat },
  });
  assert.equal(viaFrameBeat[0].focus_keyword, 'Star 按钮');

  const stripped = normalizeCaptionsForFrame({
    id: 'scene_01',
    duration_sec: 4,
    captions: [{ id: 'cap_01', start: 0, end: 4, text: '先看这里的 Star 按钮', focus_keyword: 'Star 按钮' }],
  });
  assert.equal('focus_keyword' in stripped[0], false, '无 cue 元数据时必须剥离旧注记');

  const splitCue = { ...cue, caption_ids: ['cap_01_02'], keyword: '价格面板' };
  const viaSplit = normalizeCaptionsForFrame({
    id: 'scene_01',
    duration_sec: 8,
    captions: [{ id: 'cap_01', start: 0, end: 8, text: '一二三四五六七八九十一二三四五六七八九十，现在聚焦价格面板看关键数字。' }],
    metadata: {
      visual_beat: {
        id: 'b1',
        visual_base: { type: 'image_sequence', shots: [{ id: 's1', camera: { focus_cues: [splitCue] } }] },
      },
    },
  });
  assert.equal(viaSplit.length, 2);
  assert.equal('focus_keyword' in viaSplit[0], false);
  assert.equal(viaSplit[1].id, 'cap_01_02');
  assert.equal(viaSplit[1].focus_keyword, '价格面板');
}

// materializer 路径端到端：ensureCaptionLayer + 注记 captions → 最终 HTML 带高亮且幂等
{
  const cue = { id: 'cue_a', caption_ids: ['cap_01'], keyword: 'Star 按钮', region_id: 'r_a', effect: 'camera_zoom', zoom: 'auto', return_policy: 'hold_or_next' };
  const frame = {
    id: 'scene_01',
    duration_sec: 4,
    captions: [{ id: 'cap_01', start: 0, end: 4, text: '先看这里的 Star 按钮' }],
    metadata: {
      graph_node: {
        id: 'scene:scene_01',
        metadata: {
          visual_beats: [{ id: 'b1', visual_base: { type: 'image_sequence', shots: [{ id: 's1', camera: { focus_cues: [cue] } }] } }],
        },
      },
    },
  };
  const annotatedCaptions = normalizeCaptionsForFrame(frame);
  const once = ensureCaptionLayer('<html><body><main>画面</main></body></html>', annotatedCaptions);
  assert.ok(once.includes('先看这里的 <span class="hv-caption-kw">Star 按钮</span>'));
  const twice = ensureCaptionLayer(once, annotatedCaptions);
  assert.equal(twice, once, '注记字幕的 ensureCaptionLayer 必须保持幂等');
}

console.log('html-video caption layer tests passed');
