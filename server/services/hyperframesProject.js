const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const frameProfiles = require('./frameProfiles');

const TEMPLATE_AI_STORYBOARD_CARDS = 'ai_storyboard_cards';

const RENDER_DEFAULTS = {
  resolution: '1080x1920',
  fps: '30',
  captionSize: 'medium',
  motionLevel: 'medium',
  showCaptionBar: true,
  showSceneNumber: true,
  quality: 'standard',
  frameStyle: 'tech_neon',
  transitionStyle: 'auto',
  captionMode: 'standard',
};

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeRenderOptions(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    resolution: pickAllowed(source.resolution, ['1080x1920', '720x1280'], RENDER_DEFAULTS.resolution),
    fps: pickAllowed(String(source.fps || ''), ['24', '30', '60'], RENDER_DEFAULTS.fps),
    captionSize: pickAllowed(source.captionSize, ['small', 'medium', 'large'], RENDER_DEFAULTS.captionSize),
    motionLevel: pickAllowed(source.motionLevel, ['low', 'medium', 'high'], RENDER_DEFAULTS.motionLevel),
    showCaptionBar: normalizeBoolean(source.showCaptionBar, RENDER_DEFAULTS.showCaptionBar),
    showSceneNumber: normalizeBoolean(source.showSceneNumber, RENDER_DEFAULTS.showSceneNumber),
    quality: pickAllowed(source.quality, ['standard', 'high'], RENDER_DEFAULTS.quality),
    frameStyle: pickAllowed(source.frameStyle, ['tech_neon'], RENDER_DEFAULTS.frameStyle),
    transitionStyle: pickAllowed(source.transitionStyle, ['auto', 'wipe', 'glitch', 'zoom'], RENDER_DEFAULTS.transitionStyle),
    captionMode: pickAllowed(source.captionMode, ['standard', 'kinetic'], RENDER_DEFAULTS.captionMode),
  };
}

function getRenderSize(options) {
  return options.resolution === '720x1280'
    ? { width: 720, height: 1280 }
    : { width: 1080, height: 1920 };
}

function getCaptionFontSize(options) {
  if (options.captionSize === 'small') return 28;
  if (options.captionSize === 'large') return 40;
  return 34;
}

function getMotionScale(options) {
  if (options.motionLevel === 'low') return 0.55;
  if (options.motionLevel === 'high') return 1.25;
  return 1;
}

function buildCssVars(profile) {
  return Object.entries(profile.cssVars)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeCaption(caption, index) {
  const start = Number(caption?.start || 0);
  const end = Number(caption?.end || 0);
  return {
    index: Number(caption?.index || index + 1),
    start,
    end,
    duration: Number(caption?.duration || end - start),
    text: typeof caption?.text === 'string' ? caption.text : '',
  };
}

function getSceneTone(scene, index, storyboard) {
  const palette = Array.isArray(storyboard?.style?.palette) && storyboard.style.palette.length
    ? storyboard.style.palette
    : ['#101216', '#fe2c55', '#25f4ee', '#ffd166'];
  return {
    bg: palette[0] || '#101216',
    accent: palette[(index % Math.max(palette.length - 1, 1)) + 1] || '#fe2c55',
    secondary: palette[(index + 2) % palette.length] || '#25f4ee',
  };
}

function getSceneClass(visualType) {
  const normalized = String(visualType || 'text_card').replace(/_/g, '-');
  if (normalized === 'quote-card') return 'quote-card';
  if (normalized === 'contrast-card') return 'contrast-card';
  if (normalized === 'step-card') return 'step-card';
  return 'text-card';
}

function renderEmphasis(words = []) {
  const safeWords = Array.isArray(words) ? words.filter(Boolean) : [];
  return safeWords.length
    ? safeWords.map((word, index) => `<span data-card-index="${index}">${escapeHtml(word)}</span>`).join('')
    : '';
}

function renderCaptionText(text, frameOptions) {
  if (frameOptions.captionMode !== 'kinetic') return escapeHtml(text);
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return escapeHtml(text);
  return words.map(word => `<span>${escapeHtml(word)}</span>`).join('');
}

function renderCaptionBar(scene, frameOptions) {
  const captions = Array.isArray(scene.captions) ? scene.captions.filter(caption => caption?.text) : [];
  const lines = captions.length
    ? captions
    : [{ index: 1, start: scene.start, end: scene.end, text: '' }];
  const lineHtml = lines
    .map((caption, index) => [
      `<div class="caption-line${frameOptions.captionMode === 'kinetic' ? ' kinetic-caption' : ''}" data-caption-index="${escapeHtml(caption.index || index + 1)}" data-start="${Number(caption.start || scene.start || 0)}" data-end="${Number(caption.end || scene.end || 0)}">`,
      renderCaptionText(caption.text || '', frameOptions),
      '</div>',
    ].join(''))
    .join('');
  return `<div class="caption-bar">${lineHtml}</div>`;
}

function cleanCaptionText(value) {
  return String(value || '')
    .replace(/^(开头|片头|引子|导语|正文|主体|结尾|片尾|总结)\s*[:：]\s*/g, '')
    .replace(/^第[一二三四五六七八九十\d]+部分\s*[:：]\s*/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function makeFallbackEmphasisWords(text, headline) {
  const seen = new Set();
  const words = [];
  const add = value => {
    const clean = cleanCaptionText(value)
      .replace(/^(你要先懂|要先懂|先懂|懂|比如|例如)/, '')
      .slice(0, 12);
    if (/^(以前|过去|现在).{0,6}(写代码|做项目|开发)$/.test(clean)) return;
    if (!clean || clean === headline || clean.length < 2 || seen.has(clean)) return;
    seen.add(clean);
    words.push(clean);
  };
  const units = cleanCaptionText(text)
    .split(/[，,、；;：:。“”"「」『』（）()【】\[\]\s]+/g)
    .map(item => item.trim())
    .filter(Boolean);
  const exampleIndex = units.findIndex(item => /^(比如|例如|你要先懂|要先懂|先懂|懂)/.test(item));
  if (exampleIndex >= 0) units.slice(exampleIndex).forEach(add);
  units.forEach(add);
  if (words.length < 3) cleanCaptionText(text).split(/[、，,]/g).forEach(add);
  return words.slice(0, 6);
}

function getSceneEmphasisWords(scene, captionText) {
  const words = Array.isArray(scene.emphasis_words)
    ? scene.emphasis_words.map(word => String(word || '').trim()).filter(Boolean)
    : [];
  return words.length ? words : makeFallbackEmphasisWords(captionText, scene.headline);
}

function renderSceneContent({ scene, index, captionText, wordHtml }) {
  const sceneClass = getSceneClass(scene.visual_type);
  const emphasisClass = 'emphasis timed-cards';
  if (sceneClass === 'contrast-card') {
    const parts = String(scene.headline || '').split(/\s+vs\.?\s+/i);
    const [oldText, newText] = parts.map(part => String(part || '').trim());
    const hasRealContrast = parts.length >= 2 && oldText && newText && oldText !== newText;
    if (!hasRealContrast) {
      return [
        `<div class="scene-content scene-content--text-card" data-visual-type="text_card">`,
        `  <div class="visual-type">text_card</div>`,
        `  <h1>${escapeHtml(scene.headline)}</h1>`,
        `  <div class="${emphasisClass}">${wordHtml}</div>`,
        '</div>',
      ].join('\n');
    }
    return [
      `<div class="scene-content scene-content--contrast-card" data-visual-type="${escapeHtml(scene.visual_type || 'contrast_card')}">`,
      '  <div class="compare-grid">',
      `    <div class="compare-side compare-side--old"><span>传统</span><strong>${escapeHtml(oldText)}</strong></div>`,
      '    <div class="compare-vs">VS</div>',
      `    <div class="compare-side compare-side--new"><span>现在</span><strong>${escapeHtml(newText)}</strong></div>`,
      '  </div>',
      `  <div class="${emphasisClass}">${wordHtml}</div>`,
      '</div>',
    ].join('\n');
  }
  if (sceneClass === 'step-card') {
    return [
      `<div class="scene-content scene-content--step-card" data-visual-type="${escapeHtml(scene.visual_type || 'step_card')}">`,
      `  <div class="step-orbit"><span>${String(scene.index || index + 1).padStart(2, '0')}</span></div>`,
      `  <h1>${escapeHtml(scene.headline)}</h1>`,
      `  <div class="step-line"><i></i><i></i><i></i></div>`,
      `  <div class="${emphasisClass}">${wordHtml}</div>`,
      '</div>',
    ].join('\n');
  }
  if (sceneClass === 'quote-card') {
    return [
      `<div class="scene-content scene-content--quote-card" data-visual-type="${escapeHtml(scene.visual_type || 'quote_card')}">`,
      '  <div class="quote-mark">“</div>',
      `  <h1>${escapeHtml(scene.headline)}</h1>`,
      `  <div class="${emphasisClass}">${wordHtml}</div>`,
      '</div>',
    ].join('\n');
  }
  return [
    `<div class="scene-content scene-content--text-card" data-visual-type="${escapeHtml(scene.visual_type || 'text_card')}">`,
    `  <div class="visual-type">${escapeHtml(scene.visual_type || 'text_card')}</div>`,
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    `  <div class="${emphasisClass}">${wordHtml}</div>`,
    '</div>',
  ].join('\n');
}

function hasReplacementGlyph(value) {
  if (value === undefined || value === null) return false;
  return String(value).includes('\uFFFD');
}

function validateStoryboardText(storyboard = {}) {
  const errors = [];
  const scenes = Array.isArray(storyboard.scenes) ? storyboard.scenes : [];
  scenes.forEach((scene, index) => {
    const label = `分镜 ${index + 1}`;
    const fields = ['headline', 'layout', 'background_prompt'];
    fields.forEach(field => {
      if (hasReplacementGlyph(scene?.[field])) errors.push(`${label} 的 ${field} 包含乱码。`);
    });
    const words = Array.isArray(scene?.emphasis_words) ? scene.emphasis_words : [];
    words.forEach((word, wordIndex) => {
      if (hasReplacementGlyph(word)) errors.push(`${label} 的强调词 ${wordIndex + 1} 包含乱码。`);
    });
  });
  return {
    success: errors.length === 0,
    errors,
  };
}

function buildBackgroundLayers(profile) {
  return profile.backgroundLayers
    .map(layer => `    <div class="frame-bg-layer ${layer}"></div>`)
    .join('\n');
}

function scaleDuration(value, motionScale) {
  return Math.max(0.08, Number(value || 0) * motionScale);
}

function buildTimelineScript(scenes, duration, motionScale = 1, frameOptions = {}) {
  const lines = [
    '    const tl = gsap.timeline({ paused: true });',
    `    tl.to({}, { duration: ${duration} }, 0);`,
    '    tl.to(".neon-grid", { backgroundPosition: "140px 220px", duration: Math.max(8, ' + duration + '), ease: "none" }, 0);',
    '    tl.to(".radial-energy", { rotate: 16, scale: 1.08, duration: Math.max(8, ' + duration + '), ease: "sine.inOut" }, 0);',
  ];

  scenes.forEach((scene, index) => {
    const sceneId = `#scene-${index + 1}`;
    const start = Number(scene.start || 0);
    const sceneDuration = Math.max(0.2, Number(scene.duration || 0.2));
    const enterDuration = scaleDuration(Math.min(0.45, sceneDuration * 0.28), motionScale);
    const exitDuration = scaleDuration(Math.min(0.32, Math.max(0.12, sceneDuration * 0.18)), motionScale);
    const exitStart = Math.max(start + enterDuration, start + sceneDuration - exitDuration);
    const transitionName = frameOptions.transitionStyle === 'glitch'
      ? 'glitch-wipe'
      : (frameOptions.transitionStyle === 'zoom' ? 'zoom-burst' : 'soft-wipe');
    lines.push(`    tl.set(".transition-layer", { attr: { "data-transition": "${transitionName}" } }, ${start.toFixed(3)});`);
    lines.push(`    tl.fromTo(".transition-layer", { xPercent: -120, autoAlpha: 0.92 }, { xPercent: 120, autoAlpha: 0, duration: ${Math.min(0.38, enterDuration + 0.12).toFixed(3)}, ease: "power4.out" }, ${start.toFixed(3)});`);
    lines.push(`    tl.fromTo("${sceneId}", { autoAlpha: 0 }, { autoAlpha: 1, duration: ${enterDuration.toFixed(3)}, ease: "power2.out" }, ${start.toFixed(3)});`);
    lines.push(`    tl.fromTo("${sceneId} .scene-content", { y: 64, scale: 0.94, rotateX: 8, filter: "blur(14px)" }, { y: 0, scale: 1, rotateX: 0, filter: "blur(0px)", duration: ${enterDuration.toFixed(3)}, ease: "power3.out" }, ${start.toFixed(3)});`);
    lines.push(`    tl.fromTo("${sceneId} h1", { y: 28, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: ${Math.min(0.38, enterDuration).toFixed(3)}, ease: "back.out(1.45)" }, ${(start + 0.08).toFixed(3)});`);
    const words = Array.isArray(scene.emphasis_words) ? scene.emphasis_words.filter(Boolean) : [];
    words.forEach((_, wordIndex) => {
      const cardStart = start + Math.min(sceneDuration - 0.18, enterDuration + ((sceneDuration - enterDuration - exitDuration) * (wordIndex / Math.max(words.length, 1))));
      lines.push(`    tl.fromTo("${sceneId} .emphasis span:nth-child(${wordIndex + 1})", { x: 34, y: 14, scale: 0.82, autoAlpha: 0 }, { x: 0, y: 0, scale: 1, autoAlpha: 1, duration: 0.28, ease: "back.out(1.7)" }, ${cardStart.toFixed(3)});`);
    });
    lines.push(`    tl.fromTo("${sceneId} .caption-bar", { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.24, ease: "power2.out" }, ${(start + 0.12).toFixed(3)});`);
    lines.push(`    tl.set("${sceneId} .caption-line", { autoAlpha: 0 }, ${start.toFixed(3)});`);
    const captionLines = Array.isArray(scene.captions) && scene.captions.length
      ? scene.captions
      : [{ start, end: start + sceneDuration }];
    captionLines.forEach((caption, captionIndex) => {
      const captionStart = Math.max(start, Number(caption.start || start));
      const captionEnd = Math.min(start + sceneDuration, Number(caption.end || captionStart + 0.8));
      const lineSelector = `${sceneId} .caption-line:nth-child(${captionIndex + 1})`;
      lines.push(`    tl.fromTo("${lineSelector}", { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.18, ease: "power2.out" }, ${captionStart.toFixed(3)});`);
      lines.push(`    tl.to("${lineSelector}", { y: -8, autoAlpha: 0, duration: 0.16, ease: "power1.in" }, ${Math.max(captionStart + 0.18, captionEnd - 0.16).toFixed(3)});`);
      lines.push(`    tl.from("${lineSelector} span", { y: 14, autoAlpha: 0, duration: 0.16, stagger: 0.018, ease: "power2.out" }, ${(captionStart + 0.04).toFixed(3)});`);
    });
    lines.push(`    tl.to("${sceneId} .scene-content", { y: -20, scale: 1.03, duration: ${Math.max(0.2, sceneDuration - exitDuration).toFixed(3)}, ease: "none" }, ${start.toFixed(3)});`);
    lines.push(`    tl.to("${sceneId}", { autoAlpha: 0, duration: ${exitDuration.toFixed(3)}, ease: "power1.in" }, ${exitStart.toFixed(3)});`);
  });

  return lines.join('\n');
}

function buildIndexHtml({ storyboard, captions, duration, renderOptions = {} }) {
  const options = normalizeRenderOptions(renderOptions);
  const frameOptions = frameProfiles.normalizeFrameOptions({
    frameStyle: options.frameStyle,
    transitionStyle: options.transitionStyle,
    captionMode: options.captionMode,
    energy: options.motionLevel === 'high' ? 'high' : (options.motionLevel === 'low' ? 'low' : 'medium'),
    density: options.quality === 'high' ? 'rich' : 'balanced',
  });
  const profile = frameProfiles.getFrameProfile(frameOptions.frameStyle);
  const size = getRenderSize(options);
  const captionFontSize = getCaptionFontSize(options);
  const motionScale = getMotionScale(options);
  const renderScenes = storyboard.scenes.map(scene => {
    const captionText = Array.isArray(scene.captions)
      ? scene.captions.map(caption => caption.text).filter(Boolean).join(' ')
      : '';
    return {
      ...scene,
      emphasis_words: getSceneEmphasisWords(scene, captionText),
    };
  });
  const sceneHtml = renderScenes.map((scene, index) => {
    const tone = getSceneTone(scene, index, storyboard);
    const captionText = Array.isArray(scene.captions)
      ? scene.captions.map(caption => caption.text).filter(Boolean).join(' ')
      : '';
    const wordHtml = renderEmphasis(scene.emphasis_words);
    return [
      `<section id="scene-${index + 1}" class="scene clip ${escapeHtml(scene.layout)}" data-start="${scene.start}" data-duration="${scene.duration}" data-track-index="${index + 1}" style="--bg:${tone.bg};--accent:${tone.accent};--secondary:${tone.secondary};">`,
      options.showSceneNumber ? `  <div class="scene-number">${String(scene.index || index + 1).padStart(2, '0')}</div>` : '',
      renderSceneContent({ scene, index, captionText, wordHtml }),
      options.showCaptionBar ? `  ${renderCaptionBar(scene, frameOptions)}` : '',
      '</section>',
    ].filter(line => line !== '').join('\n');
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <title>MuseDock AI 分镜成片</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #05070b; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    #stage { position: relative; width: ${size.width}px; height: ${size.height}px; overflow: hidden; background: var(--frame-bg); --caption-font-size: ${captionFontSize}px; ${buildCssVars(profile)} }
    .frame-bg-layer { position: absolute; inset: -8%; pointer-events: none; z-index: 0; }
    .neon-grid { background-image: linear-gradient(rgba(37,244,238,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(37,244,238,.1) 1px, transparent 1px); background-size: 52px 52px; mask-image: radial-gradient(circle at 50% 38%, #000 0 58%, transparent 78%); }
    .scanline { background: repeating-linear-gradient(180deg, rgba(255,255,255,.035) 0 1px, transparent 1px 7px); mix-blend-mode: screen; opacity: .55; }
    .radial-energy { background: radial-gradient(circle at 16% 14%, rgba(37,244,238,.32), transparent 28%), radial-gradient(circle at 82% 20%, rgba(254,44,85,.26), transparent 30%), radial-gradient(circle at 50% 86%, rgba(255,209,102,.12), transparent 34%); filter: blur(1px); }
    .transition-layer { position: absolute; inset: -12% -28%; z-index: 40; pointer-events: none; background: linear-gradient(90deg, transparent, rgba(37,244,238,.18), rgba(254,44,85,.75), transparent); transform: skewX(-14deg); opacity: 0; }
    .scene { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; padding: 120px 82px 220px; box-sizing: border-box; background:
      linear-gradient(150deg, color-mix(in srgb, var(--accent) 22%, transparent), transparent 28%),
      radial-gradient(circle at 78% 18%, color-mix(in srgb, var(--secondary) 24%, transparent), transparent 30%),
      linear-gradient(180deg, color-mix(in srgb, var(--bg) 86%, #05070b), rgba(5,7,11,.78) 76%); }
    .scene::before { content: ""; position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px); background-size: 54px 54px; mask-image: linear-gradient(to bottom, transparent, #000 18%, #000 82%, transparent); transform: scale(1.06); }
    .scene-number { position: absolute; top: 78px; left: 78px; color: var(--accent); font-size: 36px; font-weight: 800; letter-spacing: 0; z-index: 3; }
    .scene-content { position: relative; width: 100%; min-height: 720px; display: flex; flex-direction: column; justify-content: center; gap: 34px; border-left: 10px solid var(--accent); padding: 54px 48px; background: var(--frame-panel); box-shadow: 0 30px 90px rgba(0,0,0,.34), 0 0 80px color-mix(in srgb, var(--accent) 18%, transparent); backdrop-filter: blur(18px); }
    .scene-content--quote-card { border-left: 0; border-top: 8px solid var(--accent); padding-top: 92px; }
    .quote-mark { position: absolute; top: -24px; left: 36px; color: color-mix(in srgb, var(--accent) 58%, transparent); font-size: 190px; line-height: 1; font-weight: 900; }
    .scene-content--contrast-card { border-left: 0; padding: 44px; }
    .compare-grid { display: grid; grid-template-columns: 1fr 84px 1fr; gap: 18px; align-items: stretch; }
    .compare-side { min-height: 230px; display: grid; align-content: center; gap: 12px; padding: 24px; border: 1px solid color-mix(in srgb, var(--accent) 54%, transparent); background: rgba(255,255,255,.06); }
    .compare-side span { color: var(--frame-muted); font-size: 24px; font-weight: 800; }
    .compare-side strong { color: #fff; font-size: 44px; line-height: 1.15; }
    .compare-side--new { border-color: var(--frame-hot); box-shadow: 0 0 42px rgba(254,44,85,.18); }
    .compare-vs { display: grid; place-items: center; color: var(--frame-hot); font-size: 32px; font-weight: 900; }
    .scene-content--step-card { border-left: 0; border-bottom: 8px solid var(--accent); }
    .step-orbit { width: 112px; height: 112px; display: grid; place-items: center; border-radius: 999px; border: 2px solid var(--accent); box-shadow: 0 0 36px color-mix(in srgb, var(--accent) 34%, transparent); }
    .step-orbit span { color: var(--accent); font-size: 42px; font-weight: 900; }
    .step-line { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .step-line i { display: block; height: 8px; border-radius: 999px; background: linear-gradient(90deg, var(--accent), var(--frame-hot)); }
    .visual-type { width: max-content; max-width: 100%; padding: 9px 14px; border-radius: 8px; background: color-mix(in srgb, var(--accent) 28%, rgba(255,255,255,.1)); color: #fff; font-size: 24px; font-weight: 700; }
    h1 { margin: 0; color: #fff; font-size: 68px; line-height: 1.18; font-weight: 900; letter-spacing: 0; }
    p { margin: 0; color: rgba(255,255,255,.78); font-size: 36px; line-height: 1.55; font-weight: 650; letter-spacing: 0; }
    .emphasis { display: flex; flex-wrap: wrap; gap: 12px; }
    .emphasis span { padding: 9px 14px; border: 1px solid color-mix(in srgb, var(--accent) 72%, #fff); border-radius: 8px; color: var(--accent); font-size: 28px; font-weight: 800; }
    .caption-bar { position: absolute; z-index: 5; left: 64px; right: 64px; bottom: 94px; min-height: calc(var(--caption-font-size) * 2.1); display: grid; place-items: center; padding: 24px 28px; border-radius: 8px; background: rgba(0,0,0,.58); color: #fff; font-size: var(--caption-font-size); line-height: 1.42; text-align: center; }
    .caption-line { grid-area: 1 / 1; width: 100%; opacity: 0; }
    .kinetic-caption { display: flex; flex-wrap: wrap; justify-content: center; gap: .35em; }
    .kinetic-caption span { display: inline-block; }
  </style>
</head>
<body>
  <div id="stage" data-composition-id="ai-storyboard-cards" data-frame-profile="${profile.id}" data-transition-style="${frameOptions.transitionStyle}" data-start="0" data-duration="${duration}" data-width="${size.width}" data-height="${size.height}">
${buildBackgroundLayers(profile)}
    <div class="transition-layer"></div>
    <audio id="narration-audio" data-start="0" data-duration="${duration}" data-track-index="0" src="assets/narration.wav"></audio>
${sceneHtml}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    ${buildTimelineScript(renderScenes, duration, motionScale, frameOptions)}
    window.__timelines['ai-storyboard-cards'] = tl;
  </script>
</body>
</html>
`;
}

async function createOriginalCaptionProject({ run, projectDir, renderOptions = {} } = {}) {
  const normalizedRenderOptions = normalizeRenderOptions(renderOptions || run?.video?.render_options || {});
  const frameOptions = frameProfiles.normalizeFrameOptions({
    frameStyle: normalizedRenderOptions.frameStyle,
    transitionStyle: normalizedRenderOptions.transitionStyle,
    captionMode: normalizedRenderOptions.captionMode,
    energy: normalizedRenderOptions.motionLevel === 'high' ? 'high' : (normalizedRenderOptions.motionLevel === 'low' ? 'low' : 'medium'),
    density: normalizedRenderOptions.quality === 'high' ? 'rich' : 'balanced',
  });
  const captions = Array.isArray(run?.tts?.captions)
    ? run.tts.captions.map(normalizeCaption).filter(item => item.text && item.end > item.start)
    : [];
  const audioPath = typeof run?.tts?.path === 'string' ? run.tts.path : '';
  const scenes = Array.isArray(run?.storyboard?.scenes) ? run.storyboard.scenes : [];

  if (!audioPath || captions.length === 0) {
    return {
      success: false,
      message: '生成视频工程失败：请先完成 TTS 合成并生成字幕时间轴。',
    };
  }
  if (!scenes.length) {
    return {
      success: false,
      message: '生成视频工程失败：请先生成 AI 分镜。',
    };
  }
  const textValidation = validateStoryboardText(run.storyboard);
  if (!textValidation.success) {
    return {
      success: false,
      message: `生成视频工程失败：分镜包含乱码，请重新生成或手动修正。${textValidation.errors.join('')}`,
      storyboard_text_validation: textValidation,
    };
  }
  if (!fs.existsSync(audioPath)) {
    return {
      success: false,
      message: '生成视频工程失败：未找到 TTS 音频文件。',
    };
  }

  const duration = Number(run.tts.duration || captions[captions.length - 1].end || 0);
  const storyboard = {
    ...run.storyboard,
    template: run.storyboard.template || TEMPLATE_AI_STORYBOARD_CARDS,
    scenes,
  };
  const assetsDir = path.join(projectDir, 'assets');
  await fsp.rm(projectDir, { recursive: true, force: true });
  await fsp.mkdir(assetsDir, { recursive: true });
  await fsp.copyFile(audioPath, path.join(assetsDir, 'narration.wav'));

  const storyboardPath = path.join(projectDir, 'storyboard.json');
  const captionsPath = path.join(projectDir, 'captions.json');
  const projectJsonPath = path.join(projectDir, 'project.json');
  const indexPath = path.join(projectDir, 'index.html');

  await fsp.writeFile(storyboardPath, JSON.stringify(storyboard, null, 2), 'utf-8');
  await fsp.writeFile(captionsPath, JSON.stringify({ duration, captions }, null, 2), 'utf-8');
  await fsp.writeFile(projectJsonPath, JSON.stringify({
    template: TEMPLATE_AI_STORYBOARD_CARDS,
    run_id: run.run_id || '',
    aweme_id: run.aweme_id || '',
    duration,
    render_options: normalizedRenderOptions,
    frame_options: frameOptions,
    created_at: new Date().toISOString(),
  }, null, 2), 'utf-8');
  await fsp.writeFile(indexPath, buildIndexHtml({ storyboard, captions, duration, renderOptions: normalizedRenderOptions }), 'utf-8');

  return {
    success: true,
    template: TEMPLATE_AI_STORYBOARD_CARDS,
    project_dir: projectDir,
    index_path: indexPath,
    storyboard_path: storyboardPath,
    captions_path: captionsPath,
    project_json_path: projectJsonPath,
    duration,
    render_options: normalizedRenderOptions,
    frame_options: frameOptions,
    message: '视频工程已生成。',
  };
}

module.exports = {
  TEMPLATE_AI_STORYBOARD_CARDS,
  createOriginalCaptionProject,
  buildIndexHtml,
  normalizeRenderOptions,
  validateStoryboardText,
};
