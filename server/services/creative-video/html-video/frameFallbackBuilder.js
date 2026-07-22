function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

function resolveResolution(target = {}, template = {}) {
  const output = objectOrEmpty(template.output);
  const resolution = objectOrEmpty(target.resolution || output.resolution);
  const width = Number(target.width || resolution.width || 1920);
  const height = Number(target.height || resolution.height || 1080);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1920,
    height: Number.isFinite(height) && height > 0 ? height : 1080,
  };
}

function captionText(scene = {}) {
  const captions = Array.isArray(scene.captions) ? scene.captions : [];
  return captions.map(item => firstText(item?.text, item)).filter(Boolean).join(' ');
}

function buildFallbackFrameHtml({ scene, node, target, template, overlayOnly = false } = {}) {
  const safeScene = objectOrEmpty(scene);
  const safeNode = objectOrEmpty(node);
  const resolution = resolveResolution(target, template);
  const headline = firstText(safeScene.visual_text?.headline, safeNode.label, safeNode.title, safeScene.title, safeScene.id, safeNode.id, '基础画面');
  const subtitle = firstText(safeScene.narration_text, captionText(safeScene), safeNode.text, 'AI 生成失败，已使用基础版式。');
  const body = firstText(safeNode.text, safeNode.summary, safeScene.narration_text, captionText(safeScene), '当前帧 AI 生成连续失败，系统已保留字幕和基础文本。');
  const frameId = firstText(safeScene.id, safeNode.id, 'fallback_frame');

  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta name="viewport" content="width=${resolution.width},height=${resolution.height},initial-scale=1.0">`,
    '<style>',
    `html,body{margin:0;width:${resolution.width}px;height:${resolution.height}px;overflow:hidden;background:${overlayOnly ? 'transparent' : '#101418'};color:#f7fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}`,
    '*{box-sizing:border-box}',
    '@keyframes fallbackEnter{from{opacity:0;transform:translateY(36px)}to{opacity:1;transform:translateY(0)}}',
    '@keyframes fallbackLine{from{transform:scaleX(0)}to{transform:scaleX(1)}}',
    `.stage{width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:9%;background:${overlayOnly ? 'transparent' : 'linear-gradient(135deg,#101418 0%,#1d2730 58%,#28323b 100%)'};}`,
    '.panel{max-width:78%;animation:fallbackEnter .7s ease-out both}',
    '.kicker{font-size:28px;letter-spacing:0;color:#8fd0ff;margin-bottom:24px}',
    'h1{font-size:84px;line-height:1.08;margin:0 0 28px;font-weight:800}',
    '.subtitle{font-size:40px;line-height:1.35;margin:0 0 34px;color:#d8e5ef}',
    '.body{font-size:30px;line-height:1.55;margin:0;color:#b8c6d1;max-width:980px}',
    '.line{width:260px;height:8px;background:#ffcc66;border-radius:999px;margin-top:44px;transform-origin:left;animation:fallbackLine .8s .25s ease-out both}',
    '</style>',
    '</head>',
    `<body data-hv-canvas data-width="${resolution.width}" data-height="${resolution.height}">`,
    `<main class="stage" data-frame-id="${escapeHtml(frameId)}">`,
    '<section class="panel">',
    '<div class="kicker">基础 HTML 兜底</div>',
    `<h1 data-text-key="headline">${escapeHtml(headline)}</h1>`,
    `<p class="subtitle" data-text-key="subtitle">${escapeHtml(subtitle)}</p>`,
    `<p class="body" data-text-key="body">${escapeHtml(body)}</p>`,
    '<div class="line" aria-hidden="true"></div>',
    '</section>',
    '</main>',
    '</body>',
    '</html>',
  ].join('\n');
}

module.exports = {
  buildFallbackFrameHtml,
};
