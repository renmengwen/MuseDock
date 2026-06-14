const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');

const GSAP_LOCAL_PATH = path.resolve(__dirname, '../node_modules/gsap/dist/gsap.min.js');
let gsapBundleCache = null;
function getGsapBundle() {
  if (gsapBundleCache !== null) return gsapBundleCache;
  try { gsapBundleCache = fs.readFileSync(GSAP_LOCAL_PATH, 'utf8'); } catch { gsapBundleCache = ''; }
  return gsapBundleCache;
}
const frameProfiles = require('./frameProfiles');
const visualDsl = require('./hyperframesVisualDsl');
const sceneRenderers = require('./hyperframesSceneRenderers');
const animations = require('./hyperframesAnimations');
const phraseTimeline = require('./phraseTimeline');
const videoQualityReport = require('./videoQualityReport');

const TEMPLATE_AI_STORYBOARD_CARDS = 'ai_storyboard_cards';

const RENDER_DEFAULTS = {
  resolution: '1080x1920',
  fps: '30',
  captionSize: 'medium',
  motionLevel: 'medium',
  showCaptionBar: true,
  showSceneNumber: true,
  quality: 'standard',
  frameStyle: 'creative_brutalist',
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
    frameStyle: pickAllowed(source.frameStyle, ['creative_brutalist'], RENDER_DEFAULTS.frameStyle),
    transitionStyle: pickAllowed(source.transitionStyle, ['auto', 'wipe', 'glitch', 'zoom'], RENDER_DEFAULTS.transitionStyle),
    captionMode: pickAllowed(source.captionMode, ['standard', 'kinetic', 'phrase_kinetic'], RENDER_DEFAULTS.captionMode),
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

function getProfileSceneTone(profile, scene, index, storyboard) {
  if (profile?.id === 'creative_brutalist') {
    const accents = [
      profile.cssVars['--frame-accent'] || '#1F8A4C',
      profile.cssVars['--frame-hot'] || '#F06CA8',
      profile.cssVars['--frame-gold'] || '#F5C518',
    ];
    return {
      bg: profile.cssVars['--frame-bg'] || '#EFE9D9',
      accent: accents[index % accents.length],
      secondary: accents[(index + 1) % accents.length],
    };
  }
  return getSceneTone(scene, index, storyboard);
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

function getScenePhraseCaptions(scene, frameOptions) {
  if (frameOptions.captionMode !== 'phrase_kinetic') return [];
  if (Array.isArray(scene.phrase_captions) && scene.phrase_captions.length) {
    return scene.phrase_captions;
  }
  return phraseTimeline.buildPhraseBlocksFromCaptions(Array.isArray(scene.captions) ? scene.captions : []);
}

function renderCaptionBar(scene, frameOptions) {
  const phraseCaptions = getScenePhraseCaptions(scene, frameOptions);
  if (frameOptions.captionMode === 'phrase_kinetic' && phraseCaptions.length) {
    const phraseHtml = phraseCaptions.map(block => [
      `<span class="phrase-caption" data-caption-block-id="${escapeHtml(block.id)}" data-caption-index="${escapeHtml(block.caption_index)}" data-start="${Number(block.start || 0)}" data-end="${Number(block.end || 0)}">`,
      escapeHtml(block.text || ''),
      '</span>',
    ].join('')).join('');
    return `<div class="caption-bar caption-bar--phrase" data-caption-mode="phrase_kinetic"><div class="caption-line phrase-kinetic-caption">${phraseHtml}</div></div>`;
  }
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

function renderLegacySceneContent({ scene, index, captionText, wordHtml }) {
  const sceneClass = getSceneClass(scene.visual_type);
  const emphasisClass = 'emphasis timed-cards';
  if (sceneClass === 'contrast-card') {
    const parts = String(scene.headline || '').split(/\s+vs\.?\s+/i);
    const [oldText, newText] = parts.map(part => String(part || '').trim());
    const hasRealContrast = parts.length >= 2 && oldText && newText && oldText !== newText;
    if (!hasRealContrast) {
      return [
        `<div class="scene-content scene-content--text-card" data-visual-type="text_card">`,
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
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    `  <div class="${emphasisClass}">${wordHtml}</div>`,
    '</div>',
  ].join('\n');
}

function renderProjectSceneContent({ scene, index, captionText, wordHtml }) {
  const preparedType = scene.prepared_visual_scene?.visualType || scene.visual_type;
  const hasPreparedObjects = Array.isArray(scene.prepared_visual_scene?.objects) && scene.prepared_visual_scene.objects.length > 0;
  const legacyTypes = ['text_card', 'quote_card', 'contrast_card', 'step_card'];
  if (legacyTypes.includes(preparedType) && !hasPreparedObjects) {
    return renderLegacySceneContent({ scene, index, captionText, wordHtml });
  }
  return sceneRenderers.renderSceneContent({ scene, index, captionText, wordHtml });
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
    '    tl.to(".paper-grain", { backgroundPosition: "0 28px, 34px 0", duration: Math.max(8, ' + duration + '), ease: "none" }, 0);',
    '    tl.to(".ink-grid", { backgroundPosition: "36px 36px", duration: Math.max(10, ' + duration + '), ease: "none" }, 0);',
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
  const allPhraseCaptions = Array.isArray(storyboard.phrase_captions)
    ? storyboard.phrase_captions
    : phraseTimeline.buildPhraseBlocksFromCaptions(Array.isArray(captions?.captions) ? captions.captions : captions);
  const scenesWithFallbackWords = (Array.isArray(storyboard.scenes) ? storyboard.scenes : []).map(scene => {
    const captionText = Array.isArray(scene.captions)
      ? scene.captions.map(caption => caption.text).filter(Boolean).join(' ')
      : '';
    const sceneCaptionIndexes = new Set((Array.isArray(scene.captions) ? scene.captions : [])
      .map(caption => Number(caption.index))
      .filter(Number.isFinite));
    return {
      ...scene,
      emphasis_words: getSceneEmphasisWords(scene, captionText),
      phrase_captions: allPhraseCaptions.filter(block => sceneCaptionIndexes.has(Number(block.caption_index))),
    };
  });
  const renderScenes = visualDsl.prepareScenes(scenesWithFallbackWords);
  const sceneHtml = renderScenes.map((scene, index) => {
    const tone = getProfileSceneTone(profile, scene, index, storyboard);
    const captionText = Array.isArray(scene.captions)
      ? scene.captions.map(caption => caption.text).filter(Boolean).join(' ')
      : '';
    const wordHtml = renderEmphasis(scene.emphasis_words);
    return [
      `<section id="scene-${index + 1}" class="scene clip ${escapeHtml(scene.layout)}" data-start="${scene.start}" data-duration="${scene.duration}" data-track-index="${index + 1}" data-prepared_visual_scene="1" style="--bg:${tone.bg};--accent:${tone.accent};--secondary:${tone.secondary};">`,
      options.showSceneNumber ? `  <div class="scene-number">${String(scene.index || index + 1).padStart(2, '0')}</div>` : '',
      renderProjectSceneContent({ scene, index, captionText, wordHtml }),
      options.showCaptionBar ? `  ${renderCaptionBar(scene, frameOptions)}` : '',
      '</section>',
    ].filter(line => line !== '').join('\n');
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="./gsap.min.js"></script>
  <title>MuseDock AI 分镜成片</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: var(--frame-bg, #EFE9D9); color: var(--frame-text, #0F0F0F); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    #stage { position: relative; width: ${size.width}px; height: ${size.height}px; overflow: hidden; background: var(--frame-bg); --caption-font-size: ${captionFontSize}px; ${buildCssVars(profile)} }
    .frame-bg-layer { position: absolute; inset: -8%; pointer-events: none; z-index: 0; }
    .paper-grain { background-image: repeating-linear-gradient(0deg, rgba(15,15,15,.035) 0 1px, transparent 1px 5px), repeating-linear-gradient(90deg, rgba(15,15,15,.025) 0 1px, transparent 1px 7px); opacity: .72; }
    .ink-grid { background-image: linear-gradient(rgba(15,15,15,.1) 2px, transparent 2px), linear-gradient(90deg, rgba(15,15,15,.1) 2px, transparent 2px); background-size: 78px 78px; opacity: .32; }
    .transition-layer { position: absolute; inset: -12% -28%; z-index: 40; pointer-events: none; background: linear-gradient(90deg, transparent, var(--frame-gold), var(--frame-hot), transparent); transform: skewX(-14deg); opacity: 0; }
    .scene { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; padding: 120px 82px 220px; box-sizing: border-box; background:
      linear-gradient(150deg, color-mix(in srgb, var(--accent) 22%, transparent), transparent 28%),
      radial-gradient(circle at 78% 18%, color-mix(in srgb, var(--secondary) 24%, transparent), transparent 30%),
      linear-gradient(180deg, color-mix(in srgb, var(--bg) 86%, var(--frame-bg)), var(--frame-bg) 76%); }
    .scene::before { content: ""; position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px); background-size: 54px 54px; mask-image: linear-gradient(to bottom, transparent, #000 18%, #000 82%, transparent); transform: scale(1.06); }
    .scene-number { position: absolute; top: 78px; left: 78px; color: var(--accent); font-size: 36px; font-weight: 800; letter-spacing: 0; z-index: 3; }
    .scene-content { position: relative; width: 100%; min-height: 720px; display: flex; flex-direction: column; justify-content: center; gap: 34px; padding: 36px 24px; box-sizing: border-box; }
    .scene-content--text-card, .scene-content--quote-card, .scene-content--contrast-card, .scene-content--step-card { border-left: 10px solid var(--accent); padding: 54px 48px; background: var(--frame-panel); box-shadow: 0 30px 90px rgba(0,0,0,.34), 0 0 80px color-mix(in srgb, var(--accent) 18%, transparent); backdrop-filter: blur(18px); }
    .scene-content--quote-card { border-left: 0; border-top: 8px solid var(--accent); padding-top: 92px; }
    .quote-mark { position: absolute; top: -24px; left: 36px; color: color-mix(in srgb, var(--accent) 58%, transparent); font-size: 190px; line-height: 1; font-weight: 900; }
    .scene-content--contrast-card { border-left: 0; padding: 44px; }
    .compare-grid { display: grid; grid-template-columns: 1fr 84px 1fr; gap: 18px; align-items: stretch; }
    .compare-side { min-height: 230px; display: grid; align-content: center; gap: 12px; padding: 24px; border: 1px solid color-mix(in srgb, var(--accent) 54%, transparent); background: rgba(255,255,255,.06); }
    .compare-side span { color: var(--frame-muted); font-size: 24px; font-weight: 800; }
    .compare-side strong { color: var(--frame-text); font-size: 44px; line-height: 1.15; }
    .compare-side--new { border-color: var(--frame-hot); box-shadow: 0 0 42px rgba(254,44,85,.18); }
    .compare-vs { display: grid; place-items: center; color: var(--frame-hot); font-size: 32px; font-weight: 900; }
    .scene-content--step-card { border-left: 0; border-bottom: 8px solid var(--accent); }
    .step-orbit { width: 112px; height: 112px; display: grid; place-items: center; border-radius: 999px; border: 2px solid var(--accent); box-shadow: 0 0 36px color-mix(in srgb, var(--accent) 34%, transparent); }
    .step-orbit span { color: var(--accent); font-size: 42px; font-weight: 900; }
    .step-line { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .step-line i { display: block; height: 8px; border-radius: 999px; background: linear-gradient(90deg, var(--accent), var(--frame-hot)); }
    .scene-content--workflow, .scene-content--code-panel, .scene-content--code-walkthrough, .scene-content--ui-mockup, .scene-content--split-compare, .scene-content--concept-map, .scene-content--timeline, .scene-content--timeline-sync, .scene-content--formula-build, .scene-content--checklist-pipeline, .scene-content--quote-burst, .scene-content--brand-close, .scene-content--center-burst, .scene-content--dsl-layer { border-left: 0; overflow: visible; }
    .visual-flow, .visual-timeline, .visual-concept-branches { display: grid; gap: 18px; }
    .visual-flow { grid-template-columns: 1fr; }
    .visual-node, .visual-milestone, .visual-pill, .visual-ui-item, .visual-branch { border: 1px solid color-mix(in srgb, var(--accent) 58%, transparent); background: color-mix(in srgb, var(--frame-panel) 72%, transparent); padding: 16px 18px; border-radius: 8px; color: var(--frame-text); font-weight: 800; overflow-wrap: anywhere; }
    .visual-node { display: flex; align-items: center; gap: 12px; min-height: 72px; }
    .visual-node span, .visual-milestone span { color: var(--accent); margin-right: 12px; font-weight: 900; }
    .visual-connector { height: 4px; width: 100%; transform-origin: left center; background: linear-gradient(90deg, var(--accent), var(--frame-hot)); border-radius: 999px; }
    .visual-code-window, .visual-ui-panel { border: 1px solid color-mix(in srgb, var(--accent) 48%, transparent); background: rgba(0,0,0,.34); border-radius: 8px; padding: 22px; box-shadow: inset 0 0 40px rgba(37,244,238,.08); }
    .visual-window-dots { display: flex; gap: 8px; margin-bottom: 16px; }
    .visual-window-dots i { width: 12px; height: 12px; border-radius: 999px; background: var(--accent); display: block; }
    .visual-code-line { white-space: pre-wrap; color: var(--frame-text); font-size: 26px; line-height: 1.45; margin: 0; overflow-wrap: anywhere; }
    .visual-terminal { margin-top: 16px; color: var(--frame-gold); font-size: 24px; }
    .visual-ui-panel { display: grid; gap: 14px; }
    .visual-ui-button { justify-self: start; margin-top: 18px; padding: 12px 18px; border-radius: 8px; background: var(--accent); color: #001014; font-weight: 900; }
    .visual-compare-grid { display: grid; grid-template-columns: 1fr 82px 1fr; gap: 16px; align-items: stretch; }
    .visual-compare-column { min-height: 210px; display: grid; align-content: center; gap: 12px; padding: 22px; border: 1px solid var(--accent); background: rgba(255,255,255,.06); border-radius: 8px; overflow-wrap: anywhere; }
    .visual-compare-column span { color: var(--frame-muted); font-size: 24px; font-weight: 800; }
    .visual-compare-column strong { font-size: 40px; line-height: 1.18; }
    .visual-compare-vs { display: grid; place-items: center; color: var(--frame-hot); font-size: 34px; font-weight: 900; }
    .visual-concept-center { width: 160px; height: 160px; display: grid; place-items: center; border-radius: 999px; background: var(--accent); color: #001014; font-weight: 900; justify-self: center; text-align: center; }
    .visual-concept-branches { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .visual-timeline { position: relative; }
    .visual-formula { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 16px; }
    .visual-formula-token { min-width: 118px; padding: 18px 20px; border: 1px solid color-mix(in srgb, var(--accent) 68%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--frame-panel) 72%, transparent); color: var(--frame-text); font-size: 38px; font-weight: 900; text-align: center; box-shadow: 0 0 34px color-mix(in srgb, var(--accent) 18%, transparent); overflow-wrap: anywhere; }
    .visual-checklist { display: grid; gap: 14px; }
    .visual-check-item { display: grid; grid-template-columns: 54px 1fr 34px; align-items: center; gap: 12px; min-height: 72px; padding: 16px 18px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--accent) 58%, transparent); background: color-mix(in srgb, var(--frame-panel) 72%, transparent); color: var(--frame-text); }
    .visual-check-item span { color: var(--accent); font-weight: 900; }
    .visual-check-item strong { font-size: 30px; overflow-wrap: anywhere; }
    .visual-check-item i { width: 28px; height: 28px; border-radius: 999px; border: 2px solid var(--accent); box-shadow: inset 0 0 0 0 var(--accent); }
    .visual-sync-track { position: relative; height: 10px; border-radius: 999px; background: rgba(255,255,255,.12); overflow: hidden; }
    .visual-sync-track i { display: block; width: 100%; height: 100%; transform: scaleX(0); transform-origin: left center; background: linear-gradient(90deg, var(--accent), var(--frame-hot)); }
    .visual-brand-panel { display: grid; gap: 26px; align-content: center; min-height: 620px; padding: 46px; border: 4px solid var(--frame-ink); background: var(--frame-panel); box-shadow: 18px 18px 0 var(--frame-hot), 18px 18px 0 4px var(--frame-ink); }
    .visual-brand-action { justify-self: start; max-width: 760px; padding: 22px 28px; border: 4px solid var(--frame-ink); background: var(--accent); color: #001014; font-size: 54px; line-height: 1.12; font-weight: 900; box-shadow: 10px 10px 0 var(--frame-gold), 10px 10px 0 4px var(--frame-ink); overflow-wrap: anywhere; }
    .visual-brand-notes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .visual-brand-note { min-height: 74px; display: grid; place-items: center start; padding: 14px 18px; border: 4px solid var(--frame-ink); background: var(--frame-bg); color: var(--frame-text); font-size: 28px; font-weight: 850; overflow-wrap: anywhere; }
    .visual-burst-shell { position: relative; min-height: 680px; display: grid; place-items: center; gap: 18px; }
    .visual-burst-main { position: relative; z-index: 2; max-width: 820px; padding: 28px 34px; border: 4px solid var(--frame-ink); background: var(--frame-hot); color: var(--frame-ink); font-size: 62px; line-height: 1.08; font-weight: 900; text-align: center; box-shadow: 16px 16px 0 var(--frame-gold), 16px 16px 0 4px var(--frame-ink); overflow-wrap: anywhere; }
    .visual-burst-tags { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .visual-burst-tag { padding: 13px 16px; border: 4px solid var(--frame-ink); background: var(--frame-panel); color: var(--frame-text); font-size: 27px; font-weight: 850; overflow-wrap: anywhere; }
    .scene-content--dsl-layer { min-height: 860px; align-items: center; text-align: center; isolation: isolate; }
    .visual-focus { width: 220px; height: 220px; display: grid; place-items: center; border-radius: 999px; background: radial-gradient(circle, color-mix(in srgb, var(--accent) 72%, #fff), color-mix(in srgb, var(--accent) 22%, transparent)); color: #061014; font-size: 34px; font-weight: 900; box-shadow: 0 0 70px color-mix(in srgb, var(--accent) 42%, transparent); }
    .visual-layer-cloud { width: 100%; min-height: 360px; display: flex; flex-wrap: wrap; align-content: center; justify-content: center; gap: 22px; }
    .visual-layer-item { min-width: 150px; max-width: 320px; padding: 18px 22px; border: 1px solid color-mix(in srgb, var(--accent) 58%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--frame-panel) 72%, transparent); color: var(--frame-text); font-size: 30px; font-weight: 850; box-shadow: 0 18px 44px rgba(0,0,0,.24), 0 0 34px color-mix(in srgb, var(--accent) 18%, transparent); overflow-wrap: anywhere; }
    .visual-layer-item[data-visual-role="primary"] { transform: scale(1.12); background: var(--accent); color: #001014; }
    h1 { margin: 0; color: var(--frame-text); font-size: 68px; line-height: 1.18; font-weight: 900; letter-spacing: 0; }
    p { margin: 0; color: rgba(255,255,255,.78); font-size: 36px; line-height: 1.55; font-weight: 650; letter-spacing: 0; }
    .emphasis { display: flex; flex-wrap: wrap; gap: 12px; }
    .emphasis span { padding: 9px 14px; border: 1px solid color-mix(in srgb, var(--accent) 72%, #fff); border-radius: 8px; color: var(--accent); font-size: 28px; font-weight: 800; }
    .caption-bar { position: absolute; z-index: 5; left: 64px; right: 64px; bottom: 94px; min-height: calc(var(--caption-font-size) * 2.1); display: grid; place-items: center; padding: 24px 28px; border-radius: 8px; background: rgba(0,0,0,.58); color: #fff; font-size: var(--caption-font-size); line-height: 1.42; text-align: center; }
    .caption-bar--phrase { background: transparent; color: var(--frame-ink); padding: 0 28px; border: 0; min-height: calc(var(--caption-font-size) * 1.6); }
    [data-frame-profile="creative_brutalist"] .scene { background: var(--frame-bg); color: var(--frame-text); }
    [data-frame-profile="creative_brutalist"] .scene::before { background-image: linear-gradient(rgba(15,15,15,.08) 2px, transparent 2px), linear-gradient(90deg, rgba(15,15,15,.08) 2px, transparent 2px); background-size: 72px 72px; mask-image: none; }
    [data-frame-profile="creative_brutalist"] .scene-content--text-card,
    [data-frame-profile="creative_brutalist"] .scene-content--quote-card,
    [data-frame-profile="creative_brutalist"] .scene-content--contrast-card,
    [data-frame-profile="creative_brutalist"] .scene-content--step-card,
    [data-frame-profile="creative_brutalist"] .visual-node,
    [data-frame-profile="creative_brutalist"] .visual-milestone,
    [data-frame-profile="creative_brutalist"] .visual-ui-item,
    [data-frame-profile="creative_brutalist"] .visual-branch,
    [data-frame-profile="creative_brutalist"] .visual-layer-item,
    [data-frame-profile="creative_brutalist"] .visual-formula-token,
    [data-frame-profile="creative_brutalist"] .visual-check-item,
    [data-frame-profile="creative_brutalist"] .visual-code-window,
    [data-frame-profile="creative_brutalist"] .visual-ui-panel { border: 4px solid var(--frame-ink); border-radius: 0; background: var(--frame-panel); color: var(--frame-text); box-shadow: 14px 14px 0 var(--frame-hot), 14px 14px 0 4px var(--frame-ink); backdrop-filter: none; }
    [data-frame-profile="creative_brutalist"] .caption-bar { border-radius: 0; background: var(--frame-ink); color: var(--frame-bg); border: 4px solid var(--frame-ink); }
    [data-frame-profile="creative_brutalist"] .caption-bar--phrase { background: transparent; color: var(--frame-ink); border: 0; }
    [data-frame-profile="creative_brutalist"] .scene-number,
    [data-frame-profile="creative_brutalist"] .emphasis span { color: var(--frame-ink); border-color: var(--frame-ink); background: var(--frame-gold); border-radius: 0; }
    .caption-line { grid-area: 1 / 1; width: 100%; opacity: 0; }
    .kinetic-caption { display: flex; flex-wrap: wrap; justify-content: center; gap: .35em; }
    .kinetic-caption span { display: inline-block; }
    .phrase-kinetic-caption { display: flex; flex-wrap: wrap; justify-content: center; gap: .35em; opacity: 1; }
    .phrase-caption { display: inline-block; padding: .08em .22em; border-radius: 6px; opacity: 0; transform: translateY(10px); transition: color .12s ease, background .12s ease; }
    .phrase-caption.is-active { background: var(--frame-gold); color: var(--frame-ink); }
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
    window.__renderOptions = ${JSON.stringify({ captionMode: frameOptions.captionMode }, null, 6)};
    ${animations.buildTimelineScript(renderScenes, duration, motionScale, frameOptions)}
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
  const phraseCaptions = Array.isArray(run?.tts?.phrase_captions) && run.tts.phrase_captions.length
    ? run.tts.phrase_captions
    : phraseTimeline.buildPhraseBlocksFromCaptions(captions);
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
    phrase_captions: phraseCaptions,
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
  const indexHtml = buildIndexHtml({ storyboard, captions, duration, renderOptions: normalizedRenderOptions });
  const qualityReport = videoQualityReport.buildVideoQualityReport({
    project: {
      duration,
      render_options: normalizedRenderOptions,
    },
    storyboard,
    captions,
    phraseCaptions,
    html: indexHtml,
    targetDurationSec: run?.result?.video_brief?.target_duration_sec || 60,
  });

  await fsp.writeFile(storyboardPath, JSON.stringify(storyboard, null, 2), 'utf-8');
  await fsp.writeFile(captionsPath, JSON.stringify({ duration, captions }, null, 2), 'utf-8');
  await fsp.writeFile(projectJsonPath, JSON.stringify({
    template: TEMPLATE_AI_STORYBOARD_CARDS,
    visual_dsl_version: 1,
    run_id: run.run_id || '',
    aweme_id: run.aweme_id || '',
    duration,
    phrase_captions: phraseCaptions,
    render_options: normalizedRenderOptions,
    frame_options: frameOptions,
    video_quality_report: qualityReport,
    created_at: new Date().toISOString(),
  }, null, 2), 'utf-8');
  await fsp.writeFile(indexPath, indexHtml, 'utf-8');
  await fsp.writeFile(path.join(projectDir, 'gsap.min.js'), getGsapBundle(), 'utf-8');

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
    video_quality_report: qualityReport,
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
