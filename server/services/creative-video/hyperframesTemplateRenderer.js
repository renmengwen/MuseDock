const fs = require('fs');
const path = require('path');
const sceneSpecService = require('./sceneSpecService');
const frameSpecService = require('./frameSpecService');
const templateRegistry = require('./templateRegistry');

const GSAP_LOCAL_PATH = path.resolve(__dirname, '../../../node_modules/gsap/dist/gsap.min.js');
const GSAP_CACHE_SENTINEL = Symbol('not-loaded');
let gsapBundleCache = GSAP_CACHE_SENTINEL;

function getGsapBundle() {
  if (gsapBundleCache !== GSAP_CACHE_SENTINEL) return gsapBundleCache;
  try {
    gsapBundleCache = fs.readFileSync(GSAP_LOCAL_PATH, 'utf8');
  } catch (err) {
    console.warn(`[hyperframesTemplateRenderer] Failed to load GSAP bundle: ${err.message}`);
    gsapBundleCache = '';
  }
  return gsapBundleCache;
}

const ASPECT_RATIOS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

const GOOGLE_FONT_FALLBACKS = [
  [/(['"]?)Archivo Black\1/gi, 'sans-serif'],
  [/(['"]?)Archivo\1/gi, 'sans-serif'],
  [/(['"]?)Caveat\1/gi, 'cursive'],
  [/(['"]?)EB Garamond\1/gi, 'serif'],
  [/(['"]?)IBM Plex Mono\1/gi, 'monospace'],
  [/(['"]?)IBM Plex Sans\1/gi, 'sans-serif'],
  [/(['"]?)Inter Tight\1/gi, 'sans-serif'],
  [/(['"]?)JetBrains Mono\1/gi, 'monospace'],
  [/(['"]?)Libre Baskerville\1/gi, 'serif'],
  [/(['"]?)Noto Sans SC\1/gi, 'sans-serif'],
  [/(['"]?)Noto Serif SC\1/gi, 'serif'],
  [/(['"]?)Shrikhand\1/gi, 'cursive'],
  [/(['"]?)Source Serif Pro\1/gi, 'serif'],
  [/(['"]?)Space Grotesk\1/gi, 'sans-serif'],
  [/(['"]?)Space Mono\1/gi, 'monospace'],
  [/(['"]?)Syne\1/gi, 'sans-serif'],
];

const ROOT_COMPOSITION_ATTRS = [
  'data-composition-id',
  'data-start',
  'data-duration',
  'data-width',
  'data-height',
  'data-track-index',
];

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstString(inputs, names, fallback = '') {
  for (const name of names) {
    if (typeof inputs?.[name] === 'string' && inputs[name].trim()) {
      return inputs[name].trim();
    }
  }
  return fallback;
}

function renderTemplateHtmlWithInputs({ templateHtml, inputs = {}, sceneSpec = {}, templateId } = {}) {
  let html = String(templateHtml || '');
  const headline = firstString(inputs, ['headline', 'title'], sceneSpec.title || '创意视频');
  const subtitle = firstString(inputs, ['subtitle', 'description', 'summary'], '');
  const channel = firstString(inputs, ['channel_info', 'source', 'label'], '');

  if (headline) {
    html = html.replace(/(<h1\b[^>]*>)([\s\S]*?)(<\/h1>)/i, `$1${escapeHtml(headline).replace(/\s+/g, '<br/>')}$3`);
    html = html.replace(/(<h1\b[^>]*class=["'][^"']*\blayer\b[^"']*["'][^>]*>)([\s\S]*?)(<\/h1>)/gi, `$1${escapeHtml(headline).replace(/\s+/g, '<br/>')}$3`);
    html = html.replace(/(<title>)([\s\S]*?)(<\/title>)/i, `$1${escapeHtml(headline)}$3`);
  }
  if (subtitle) {
    html = html.replace(/(<p\b[^>]*>)([\s\S]*?)(<\/p>)/i, `$1${escapeHtml(subtitle)}$3`);
  }
  if (channel) {
    html = html.replace(/(<span>)(?:&gt;&gt;|>>)[\s\S]*?(<\/span>)/i, `$1&gt;&gt; ${escapeHtml(channel)}$2`);
  }

  const sourceJson = JSON.stringify({
    template_id: templateId,
    template_inputs: inputs,
    scene_spec: sceneSpec,
  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const script = `<script type="application/json" id="template-inputs">${sourceJson}</script>`;
  if (!html.includes('id="template-inputs"')) {
    html = html.includes('</body>') ? html.replace('</body>', `${script}\n</body>`) : `${html}\n${script}`;
  }
  return html;
}

function escapeJsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function roundTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.round(number * 100) / 100;
}

function dimensionsFor(aspectRatio) {
  return ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['16:9'];
}

function ensureRootAttribute(tag, name, value) {
  const pattern = new RegExp(`\\s${name}\\s*=`, 'i');
  if (pattern.test(tag)) return tag;
  return tag.replace(/>$/, ` ${name}="${value}">`);
}

function stripRootCompositionAttributesFromBody(html) {
  return String(html || '').replace(/<body\b[^>]*>/i, (tag) => {
    let nextTag = tag;
    for (const name of ROOT_COMPOSITION_ATTRS) {
      nextTag = nextTag.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'gi'), '');
    }
    return nextTag;
  });
}

function stripRootCompositionAttributesFromElements(html) {
  return String(html || '').replace(/<([a-z][\w:-]*)([^>]*)>/gi, (tag, tagName) => {
    if (/^(html|body|script|style)$/i.test(tagName)) return tag;
    let nextTag = tag;
    for (const name of ROOT_COMPOSITION_ATTRS) {
      nextTag = nextTag.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'gi'), '');
    }
    return nextTag;
  });
}

function splitTrailingScripts(bodyContent) {
  const scripts = [];
  let visualContent = String(bodyContent || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (script) => {
    scripts.push(script);
    return '';
  });
  visualContent = visualContent.trim();
  return { visualContent, scripts: scripts.join('\n') };
}

function buildStageOpenTag({ duration, dimensions }) {
  return [
    '<div id="stage"',
    ' data-composition-id="main"',
    ' data-start="0"',
    ` data-duration="${duration}"`,
    ` data-width="${dimensions.width}"`,
    ` data-height="${dimensions.height}"`,
    ` style="position:relative;width:${dimensions.width}px;height:${dimensions.height}px;overflow:hidden"`,
    '>',
  ].join('');
}

function wrapBodyInEntryComposition(html, { duration, dimensions }) {
  return String(html || '').replace(/(<body\b[^>]*>)([\s\S]*?)(<\/body>)/i, (match, bodyOpen, bodyContent, bodyClose) => {
    const { visualContent, scripts } = splitTrailingScripts(stripRootCompositionAttributesFromElements(bodyContent));
    const stage = `${buildStageOpenTag({ duration, dimensions })}\n${visualContent}\n</div>`;
    return `${bodyOpen}\n  ${stage}${scripts ? `\n${scripts}` : ''}\n${bodyClose}`;
  });
}

function bodyStartsWithEntryComposition(html) {
  const bodyMatch = String(html || '').match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return false;
  const firstTag = bodyMatch[1].trimStart().match(/^<([a-z][\w:-]*)([^>]*)>/i);
  return Boolean(firstTag && /\sdata-composition-id\s*=/.test(firstTag[0]));
}

function ensureEntryCompositionAttributes(html, { duration, dimensions }) {
  const durationText = String(duration);
  const attrs = {
    'data-composition-id': 'main',
    'data-start': '0',
    'data-duration': durationText,
    'data-width': String(dimensions.width),
    'data-height': String(dimensions.height),
  };
  let content = stripRootCompositionAttributesFromBody(html);
  if (/<body\b/i.test(content) && !bodyStartsWithEntryComposition(content)) {
    return wrapBodyInEntryComposition(content, { duration: durationText, dimensions });
  }

  const rootPattern = /<([a-z][\w:-]*)([^>]*\sdata-composition-id\s*=\s*['"][^'"]+['"][^>]*)>/i;
  if (rootPattern.test(content)) {
    return content.replace(rootPattern, (tag) => {
      let nextTag = tag.replace(/\sdata-track-index\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
      for (const [name, value] of Object.entries(attrs)) {
        nextTag = ensureRootAttribute(nextTag, name, value);
      }
      return nextTag;
    });
  }

  const targetPatterns = [
    /<main\b[^>]*>/i,
    /<([a-z][\w:-]*)([^>]*\bid\s*=\s*['"]stage['"][^>]*)>/i,
    /<([a-z][\w:-]*)([^>]*\bclass\s*=\s*['"][^'"]*\b(?:composition|stage)\b[^'"]*['"][^>]*)>/i,
    /(<body\b[^>]*>\s*)<([a-z][\w:-]*)([^>]*)>/i,
  ];

  for (const pattern of targetPatterns) {
    if (!pattern.test(content)) continue;
    return content.replace(pattern, (...args) => {
      if (pattern === targetPatterns[3]) {
        const [, bodyOpen, tagName, tagAttrs] = args;
        if (/^(script|style|svg)$/i.test(tagName)) return args[0];
        let nextTag = `<${tagName}${tagAttrs}>`;
        for (const [name, value] of Object.entries(attrs)) {
          nextTag = ensureRootAttribute(nextTag, name, value);
        }
        return `${bodyOpen}${nextTag}`;
      }
      let nextTag = args[0];
      for (const [name, value] of Object.entries(attrs)) {
        nextTag = ensureRootAttribute(nextTag, name, value);
      }
      return nextTag;
    });
  }

  return content;
}

function localizeTemplateFonts(html) {
  let content = String(html || '')
    .replace(/<link\b[^>]*href\s*=\s*["'][^"']*fonts\.googleapis\.com[^"']*["'][^>]*>\s*/gi, '')
    .replace(/@import\s+url\(\s*["']?[^"')]*fonts\.googleapis\.com[^"')]*["']?\s*\)\s*;?/gi, '')
    .replace(/@import\s+["'][^"']*fonts\.googleapis\.com[^"']*["']\s*;?/gi, '');
  for (const [pattern, replacement] of GOOGLE_FONT_FALLBACKS) {
    content = content.replace(pattern, replacement);
  }
  return content;
}

function mirrorBodySelectorsToStage(css) {
  return String(css || '').replace(/([^{}@]+)\{([^{}]*)\}/g, (rule, selectors, declarations) => {
    const stageSelectors = selectors
      .split(',')
      .map(selector => selector.trim())
      .filter(selector => /\bbody\b/i.test(selector))
      .map(selector => selector
        .replace(/\bhtml\s+body\b/gi, '#stage')
        .replace(/\bhtml\s*>\s*body\b/gi, '#stage')
        .replace(/\bbody\b/gi, '#stage')
        .trim())
      .filter(Boolean);
    if (stageSelectors.length === 0) return rule;
    return `${rule}\n${Array.from(new Set(stageSelectors)).join(',')}{${declarations}}`;
  });
}

function mirrorBodyVisualStylesToStage(html) {
  return String(html || '').replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (tag, attrs, css) => {
    const mirroredCss = mirrorBodySelectorsToStage(css);
    return `<style${attrs}>${mirroredCss}</style>`;
  });
}

function insertBeforeBodyClose(html, fragment) {
  const content = String(html || '');
  if (content.includes('</body>')) return content.replace('</body>', `${fragment}\n</body>`);
  return `${content}\n${fragment}`;
}

function sceneOverlayTitle(scene, index) {
  return String(
    scene?.visual_text?.headline
    || scene?.headline
    || scene?.title
    || scene?.narration_text
    || `场景 ${index + 1}`
  ).trim().slice(0, 80);
}

function sceneOverlayMeta(scene, index) {
  const keywords = Array.isArray(scene?.visual_text?.keywords) ? scene.visual_text.keywords : [];
  const cards = Array.isArray(scene?.visual_text?.cards) ? scene.visual_text.cards : [];
  return [...keywords, ...cards].map(item => String(item || '').trim()).filter(Boolean).slice(0, 3).join(' · ')
    || `SCENE ${String(index + 1).padStart(2, '0')}`;
}

function buildTimelineEnhancementScript({ sceneSpec, duration }) {
  const scenes = (sceneSpec.scenes || [])
    .map((scene, index) => ({
      title: sceneOverlayTitle(scene, index),
      meta: sceneOverlayMeta(scene, index),
      start: roundTime(Number(scene.start || 0)),
      duration: Math.max(0.3, roundTime(Number(scene.duration || 0))),
    }))
    .filter(scene => Number.isFinite(scene.start) && Number.isFinite(scene.duration));
  if (scenes.length < 2) return '';

  const scenesJson = JSON.stringify(scenes).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `
<style data-hf-scene-overlay>
  #stage .hf-scene-overlay{position:absolute;left:56px;right:56px;bottom:56px;z-index:80;pointer-events:none;font-family:sans-serif;color:#fff}
  #stage .hf-scene-card{position:absolute;left:0;right:0;bottom:22px;opacity:0;visibility:hidden;padding:18px 22px;border-left:6px solid #ff4d4d;background:linear-gradient(90deg,rgba(8,12,20,.82),rgba(8,12,20,.42));box-shadow:0 20px 60px rgba(0,0,0,.28);backdrop-filter:blur(12px)}
  #stage .hf-scene-card strong{display:block;font-size:34px;line-height:1.12;font-weight:800;letter-spacing:0;color:#fff;text-wrap:balance}
  #stage .hf-scene-card span{display:block;margin-top:8px;font-size:14px;line-height:1.3;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.76)}
  #stage .hf-progress-track{position:absolute;left:0;right:0;bottom:0;height:8px;background:rgba(255,255,255,.16);overflow:hidden}
  #stage .hf-progress-fill{width:100%;height:100%;background:linear-gradient(90deg,#ff4d4d,#ffd166,#38bdf8);transform:scaleX(0);transform-origin:left center}
</style>
<script data-hf-scene-overlay>
  (function enhanceRichTemplateTimeline() {
    if (!window.gsap) return;
    var scenes = ${scenesJson};
    var duration = ${roundTime(duration)};
    var stage = document.querySelector('[data-composition-id="main"]');
    if (!stage || stage.querySelector('[data-hf-scene-overlay]')) return;
    stage.setAttribute('data-hf-scene-overlay', 'true');
    var overlay = document.createElement('div');
    var hfSceneOverlay = overlay;
    overlay.className = 'hf-scene-overlay';
    overlay.setAttribute('data-hf-scene-overlay', 'true');
    var cards = scenes.map(function(scene, index) {
      var card = document.createElement('div');
      card.className = 'hf-scene-card';
      var title = document.createElement('strong');
      title.textContent = scene.title;
      var meta = document.createElement('span');
      meta.textContent = scene.meta;
      card.appendChild(title);
      card.appendChild(meta);
      overlay.appendChild(card);
      return card;
    });
    var track = document.createElement('div');
    track.className = 'hf-progress-track';
    var fill = document.createElement('div');
    fill.className = 'hf-progress-fill';
    track.appendChild(fill);
    overlay.appendChild(track);
    stage.appendChild(overlay);
    window.__timelines = window.__timelines || {};
    var tl = window.__timelines["main"] || gsap.timeline({ paused: true });
    window.__timelines["main"] = tl;
    tl.to({}, { duration: ${roundTime(duration)} }, 0);
    tl.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: duration, ease: "none" }, 0);
    cards.forEach(function(card, index) {
      var scene = scenes[index];
      var start = Number(scene.start || 0);
      var end = Math.min(duration, start + Number(scene.duration || 0.3));
      tl.set(card, { autoAlpha: 0 }, 0);
      tl.set(card, { autoAlpha: 1 }, start);
      tl.fromTo(card, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, ease: "power2.out", overwrite: "auto" }, start);
      tl.to(card, { autoAlpha: 0, duration: 0.22, ease: "power1.in", overwrite: "auto" }, Math.max(start + 0.4, end - 0.25));
      tl.set(card, { autoAlpha: 0 }, end);
    });
  })();
</script>`;
}

function enhanceRichTemplateTimeline(html, { sceneSpec, duration }) {
  const fragment = buildTimelineEnhancementScript({ sceneSpec, duration });
  if (!fragment) return html;
  return insertBeforeBodyClose(html, fragment);
}

function normalizeBodyForStageCapture(html, { dimensions }) {
  const style = [
    '<style data-hf-stage-reset>',
    'html{margin:0!important;padding:0!important;overflow:hidden!important}',
    `body{display:block!important;padding:0!important;width:${dimensions.width}px!important;height:${dimensions.height}px!important;margin:0!important;overflow:hidden!important}`,
    `#stage{position:relative!important;width:${dimensions.width}px!important;height:${dimensions.height}px!important;overflow:hidden!important}`,
    '</style>',
  ].join('');
  const content = String(html || '');
  if (content.includes('</head>')) return content.replace('</head>', `${style}\n</head>`);
  return content.replace(/<body\b/i, `${style}\n<body`);
}

function totalDuration(sceneSpec) {
  return roundTime((sceneSpec.scenes || []).reduce((sum, scene) => sum + Number(scene.duration || 0), 0));
}

function sceneById(sceneSpec) {
  return new Map((sceneSpec.scenes || []).map(scene => [scene.id, scene]));
}

function buildCaptionHtml(sceneSpec) {
  return (sceneSpec.scenes || []).flatMap(scene => (
    (scene.captions || []).map(caption => {
      const duration = Math.max(0, roundTime(Number(caption.end || 0) - Number(caption.start || 0)));
      return `<div class="caption-line clip" data-caption-id="${escapeHtml(caption.id)}" data-scene-id="${escapeHtml(scene.id)}" data-start="${roundTime(scene.start + caption.start)}" data-duration="${duration}">${escapeHtml(caption.text)}</div>`;
    })
  )).join('\n');
}

function safeDomId(value, index) {
  const safe = String(value || '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `frame_${index + 1}_${safe || 'clip'}`;
}

function buildFrameHtmlAndCss(sceneSpec, frameSpecs) {
  const scenes = sceneById(sceneSpec);
  const css = new Set();
  const html = [];
  const timeline = [];

  frameSpecs.frames.forEach((frame, index) => {
    const template = templateRegistry.getTemplate(frame.template);
    const scene = scenes.get(frame.scene_id);
    const domId = safeDomId(frame.id, index);
    const renderFrame = { ...frame, id: domId };
    const rendered = template.renderFrame(renderFrame, scene);
    const frameHtml = rendered.html
      .replace('class="creative-frame ', 'class="creative-frame clip ')
      .replace(/<section\b/, `<section data-start="${roundTime(frame.start)}" data-duration="${roundTime(frame.duration)}"`);
    css.add(rendered.css);
    html.push(frameHtml);
    const selector = `#${domId}`;
    timeline.push(
      `tl.set("${selector}", { autoAlpha: 0 }, 0);`,
      `tl.set("${selector}", { autoAlpha: 1 }, ${roundTime(frame.start)});`,
      templateRegistry
        .getMotionSnippet(frame.motion || template.defaultMotion, selector, roundTime(frame.start))
        .replace(/^gsap\./, 'tl.'),
      `tl.set("${selector}", { autoAlpha: 0 }, ${roundTime(frame.start + frame.duration)});`
    );
  });

  return {
    html: html.join('\n'),
    css: Array.from(css).join('\n'),
    timeline: timeline.join('\n'),
  };
}

function buildIndexHtml({ sceneSpec, frameSpecs }) {
  const dimensions = dimensionsFor(sceneSpec.aspect_ratio);
  const duration = totalDuration(sceneSpec);
  const fragments = buildFrameHtmlAndCss(sceneSpec, frameSpecs);
  const captionsHtml = buildCaptionHtml(sceneSpec);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(sceneSpec.title || '创意视频')}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box}
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#020617;color:#fff}
    body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .composition{position:relative;width:${dimensions.width}px;height:${dimensions.height}px;overflow:hidden;background:#020617}
    .clip{position:absolute;opacity:0;visibility:hidden;will-change:opacity,transform}
    .caption-line{left:9%;right:9%;bottom:7%;z-index:20;padding:16px 24px;border-radius:14px;background:rgba(2,6,23,.72);color:#fff;font-size:34px;line-height:1.25;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.28)}
${fragments.css}
  </style>
</head>
<body>
  <main class="composition" id="stage" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${dimensions.width}" data-height="${dimensions.height}">
${fragments.html}
${captionsHtml}
  </main>
  <script src="./gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
${fragments.timeline}
    document.querySelectorAll(".caption-line.clip").forEach((caption) => {
      const start = Number(caption.dataset.start || 0);
      const duration = Number(caption.dataset.duration || 0);
      tl.set(caption, { autoAlpha: 0 }, 0);
      tl.set(caption, { autoAlpha: 1 }, start);
      tl.fromTo(caption, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.18, ease: "power1.out" }, start);
      tl.to(caption, { opacity: 0, y: -12, duration: 0.18, ease: "power1.in" }, start + duration);
      tl.set(caption, { autoAlpha: 0 }, start + duration + 0.18);
    });
    tl.to("#stage", { opacity: 1, duration: 0.001 }, ${duration});
    window.__timelines["main"] = tl;
  </script>
  <script type="application/json" id="creative-video-source">${escapeJsonForHtml({ scene_spec: sceneSpec, frame_specs: frameSpecs })}</script>
</body>
</html>`;
}

function buildDesignMd(sceneSpec, frameSpecs) {
  return `# ${sceneSpec.title || '创意视频'}

- 宽高比: ${sceneSpec.aspect_ratio}
- 总时长: ${totalDuration(sceneSpec)}s
- 场景数: ${(sceneSpec.scenes || []).length}
- 帧数: ${(frameSpecs.frames || []).length}

${(sceneSpec.scenes || []).map(scene => `## ${scene.id}
- 类型: ${scene.kind}
- 开始: ${scene.start}s
- 时长: ${scene.duration}s
- 旁白: ${scene.narration_text || '无'}`).join('\n\n')}
`;
}

function renderHyperframesProjectFiles({ sceneSpec, frameSpecs } = {}) {
  const normalizedSceneSpec = sceneSpecService.normalizeSceneSpec(sceneSpec);
  const sceneValidation = sceneSpecService.validateSceneSpec(normalizedSceneSpec);
  if (!sceneValidation.success) {
    return {
      success: false,
      message: `scene_spec 校验失败：${sceneValidation.errors.join('；')}`,
      diagnostics: sceneValidation.errors,
      files: {},
    };
  }

  const normalizedFrameSpecs = frameSpecService.normalizeFrameSpecs(frameSpecs, sceneValidation.scene_spec);
  const frameValidation = frameSpecService.validateFrameSpecs(normalizedFrameSpecs, sceneValidation.scene_spec);
  if (!frameValidation.success) {
    return {
      success: false,
      message: `frame_specs 校验失败：${frameValidation.errors.join('；')}`,
      diagnostics: frameValidation.errors,
      files: {},
    };
  }
  const incompatibleTemplates = frameValidation.frame_specs.frames
    .map(frame => ({ frame, template: templateRegistry.getTemplate(frame.template) }))
    .filter(item => !item.template.supportedKinds.includes(item.frame.kind))
    .map(item => `frame ${item.frame.id} 的模板 ${item.frame.template} 不支持 kind ${item.frame.kind}`);
  if (incompatibleTemplates.length > 0) {
    return {
      success: false,
      message: `模板兼容性校验失败：${incompatibleTemplates.join('；')}`,
      diagnostics: incompatibleTemplates,
      files: {},
    };
  }

  const dimensions = dimensionsFor(sceneValidation.scene_spec.aspect_ratio);
  const duration = totalDuration(sceneValidation.scene_spec);
  const indexHtml = buildIndexHtml({
    sceneSpec: sceneValidation.scene_spec,
    frameSpecs: frameValidation.frame_specs,
  });
  const meta = {
    title: sceneValidation.scene_spec.title,
    aspect_ratio: sceneValidation.scene_spec.aspect_ratio,
    width: dimensions.width,
    height: dimensions.height,
    duration_sec: duration,
    scene_count: sceneValidation.scene_spec.scenes.length,
    frame_count: frameValidation.frame_specs.frames.length,
    renderer: 'html-video-lite-template',
  };
  const hyperframes = {
    composition: 'main',
    width: dimensions.width,
    height: dimensions.height,
    duration,
    fps: 30,
    timeline: 'main',
    clips: frameValidation.frame_specs.frames.map(frame => ({
      id: frame.id,
      scene_id: frame.scene_id,
      start: frame.start,
      duration: frame.duration,
      template: frame.template,
    })),
  };

  return {
    success: true,
    message: 'HyperFrames 工程文件已生成。',
    scene_spec: sceneValidation.scene_spec,
    frame_specs: frameValidation.frame_specs,
    files: {
      'index.html': indexHtml,
      'gsap.min.js': getGsapBundle(),
      'meta.json': JSON.stringify(meta, null, 2),
      'hyperframes.json': JSON.stringify(hyperframes, null, 2),
      'scene_spec.json': JSON.stringify(sceneValidation.scene_spec, null, 2),
      'frame_specs.json': JSON.stringify(frameValidation.frame_specs, null, 2),
      'design.md': buildDesignMd(sceneValidation.scene_spec, frameValidation.frame_specs),
    },
    diagnostics: [],
  };
}

/**
 * Assemble project files from AI-generated HTML (rich template path).
 * The AI has already produced a complete index.html following the template's design.
 * This function wraps it with the same file structure as renderHyperframesProjectFiles.
 */
function assembleProjectFiles({ sceneSpec, frameSpecs, aiGeneratedHtml, templateId }) {
  const normalizedSceneSpec = sceneSpecService.normalizeSceneSpec(sceneSpec);
  const sceneValidation = sceneSpecService.validateSceneSpec(normalizedSceneSpec);
  if (!sceneValidation.success) {
    return {
      success: false,
      message: `scene_spec 校验失败：${sceneValidation.errors.join('；')}`,
      diagnostics: sceneValidation.errors,
      files: {},
    };
  }

  const dimensions = dimensionsFor(sceneValidation.scene_spec.aspect_ratio);
  const duration = totalDuration(sceneValidation.scene_spec);

  // Validate the AI-generated HTML is not empty
  if (!aiGeneratedHtml || aiGeneratedHtml.trim().length < 100) {
    return {
      success: false,
      message: 'AI 生成的 HTML 内容为空或过短。',
      diagnostics: ['aiGeneratedHtml is empty or too short'],
      files: {},
    };
  }

  // Ensure the HTML loads GSAP from the LOCAL file (not CDN — rendering is offline).
  // Replace any existing <script src="...gsap..."> with the local path.
  let finalHtml = aiGeneratedHtml;
  if (/<script[^>]+gsap[^>]+src=/i.test(finalHtml)) {
    // Replace any GSAP script src (CDN or other) with local path
    finalHtml = finalHtml.replace(/<script([^>]+)src=["'][^"']*gsap[^"']*["']/gi, '<script$1src="./gsap.min.js"');
  } else if (!finalHtml.includes('gsap.min.js')) {
    // No GSAP script at all — inject local one
    const gsapScript = '\n<script src="./gsap.min.js"></script>\n';
    if (finalHtml.includes('</body>')) {
      finalHtml = finalHtml.replace('</body>', gsapScript + '</body>');
    } else if (finalHtml.includes('</html>')) {
      finalHtml = finalHtml.replace('</html>', gsapScript + '</html>');
    } else {
      finalHtml += gsapScript;
    }
  }

  // Ensure window.__timelines["main"] exists for hyperframes compatibility.
  // If AI generated CSS @keyframes instead of GSAP tweens, convert them.
  // HyperFrames renders by seeking the GSAP timeline — CSS animations are invisible.
  if (!finalHtml.includes('__timelines')) {
    const timelineScript = `
<script>
  window.__timelines = window.__timelines || {};
  (function() {
    var DUR = ${duration};
    var tl = gsap.timeline({ paused: true });
    window.__timelines["main"] = tl;

    // Freeze all CSS animations immediately
    var cssAnims = [];
    document.querySelectorAll("*").forEach(function(el) {
      var cs = getComputedStyle(el);
      var name = cs.animationName;
      if (name && name !== "none") {
        cssAnims.push({
          el: el,
          dur: parseFloat(cs.animationDuration) || 1,
          delay: parseFloat(cs.animationDelay) || 0
        });
        el.style.animationPlayState = "paused";
      }
    });

    if (cssAnims.length > 0) {
      // Scrub CSS animations via negative animation-delay
      var tick = function() {
        var t = tl.time();
        for (var i = 0; i < cssAnims.length; i++) {
          var a = cssAnims[i];
          var local = Math.max(0, Math.min(t - a.delay, a.dur));
          a.el.style.animationDelay = (-local) + "s";
        }
      };
      tl.eventCallback("onUpdate", tick);
      for (var pos = 0; pos <= DUR; pos += 0.5) {
        tl.add(tick, pos);
      }
    }

    // Always add GSAP tweens for main visual elements as primary animation
    var headline = document.querySelector(".headline, .card-title, h1, h2, .section-no");
    var subtitle = document.querySelector(".subtitle, .card-label, .label, .content p");
    var card = document.querySelector(".card");
    var bars = document.querySelectorAll(".bar");
    var bottomBar = document.querySelector(".bottom-bar");
    if (headline) {
      tl.fromTo(headline, { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 1.2, ease: "power3.out" }, 0.3);
    }
    if (subtitle) {
      tl.fromTo(subtitle, { opacity: 0, y: 25 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, 0.8);
    }
    if (card) {
      tl.fromTo(card, { opacity: 0, x: "110%" }, { opacity: 1, x: "0%", duration: 1, ease: "power3.out" }, 0.5);
    }
    if (bars.length > 0) {
      tl.fromTo(bars, { scaleY: 0 }, { scaleY: 1, duration: 0.7, stagger: 0.1, ease: "power2.out", transformOrigin: "bottom" }, 1.2);
    }
    if (bottomBar) {
      tl.fromTo(bottomBar, { y: "100%" }, { y: "0%", duration: 0.6, ease: "power3.out" }, 1.5);
    }

    // Ensure timeline spans full duration
    tl.to({}, { duration: DUR });
  })();
</script>`;
    if (finalHtml.includes('</body>')) {
      finalHtml = finalHtml.replace('</body>', timelineScript + '\n</body>');
    } else {
      finalHtml += timelineScript;
    }
  }

  // Ensure HyperFrames can detect composition duration via data-duration attribute.
  // The FrameCapture runtime expects these attributes on the entry composition
  // element, not on <body>. Rich AI templates often put only data-duration on body.
  finalHtml = ensureEntryCompositionAttributes(finalHtml, { duration, dimensions });
  finalHtml = mirrorBodyVisualStylesToStage(finalHtml);
  finalHtml = normalizeBodyForStageCapture(finalHtml, { dimensions });
  finalHtml = enhanceRichTemplateTimeline(finalHtml, { sceneSpec: sceneValidation.scene_spec, duration });
  finalHtml = localizeTemplateFonts(finalHtml);

  const normalizedFrameSpecs = frameSpecs || { frames: [] };
  const meta = {
    title: normalizedSceneSpec.title,
    aspect_ratio: normalizedSceneSpec.aspect_ratio,
    width: dimensions.width,
    height: dimensions.height,
    duration_sec: duration,
    scene_count: normalizedSceneSpec.scenes.length,
    frame_count: normalizedFrameSpecs.frames ? normalizedFrameSpecs.frames.length : 0,
    renderer: 'rich-template',
    template_id: templateId,
  };
  const hyperframes = {
    composition: 'main',
    width: dimensions.width,
    height: dimensions.height,
    duration,
    fps: 30,
    timeline: 'main',
    clips: (normalizedFrameSpecs.frames || []).map(frame => ({
      id: frame.id,
      scene_id: frame.scene_id,
      start: frame.start,
      duration: frame.duration,
    })),
  };

  return {
    success: true,
    message: 'Rich template 工程文件已生成。',
    scene_spec: sceneValidation.scene_spec,
    frame_specs: normalizedFrameSpecs,
    target_duration_sec: duration,
    files: {
      'index.html': finalHtml,
      'gsap.min.js': getGsapBundle(),
      'meta.json': JSON.stringify(meta, null, 2),
      'hyperframes.json': JSON.stringify(hyperframes, null, 2),
      'scene_spec.json': JSON.stringify(sceneValidation.scene_spec, null, 2),
      'frame_specs.json': JSON.stringify(normalizedFrameSpecs, null, 2),
    },
    diagnostics: [],
  };
}

module.exports = {
  renderHyperframesProjectFiles,
  buildIndexHtml,
  assembleProjectFiles,
  renderTemplateHtmlWithInputs,
};
