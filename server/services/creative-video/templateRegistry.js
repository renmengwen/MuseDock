function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textLayers(frame) {
  return Array.isArray(frame && frame.text_layers) ? frame.text_layers : [];
}

function visualLayers(frame) {
  return Array.isArray(frame && frame.visual_layers) ? frame.visual_layers : [];
}

const BACKGROUNDS = {
  dark_gradient: '.bg-dark_gradient{background:linear-gradient(135deg,#101828 0%,#1d3557 48%,#5b2a86 100%);color:#f8fafc;}',
  soft_grid: '.bg-soft_grid{background:#f7fbff;background-image:linear-gradient(rgba(23,37,84,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(23,37,84,.12) 1px,transparent 1px);background-size:44px 44px;color:#132238;}',
  radial_spotlight: '.bg-radial_spotlight{background:radial-gradient(circle at 50% 32%,#3b82f6 0%,#111827 46%,#020617 100%);color:#ffffff;}',
  brand_blocks: '.bg-brand_blocks{background:linear-gradient(90deg,#0f172a 0 50%,#f8fafc 50% 100%);color:#f8fafc;}',
  clean_light: '.bg-clean_light{background:linear-gradient(180deg,#ffffff 0%,#eef4ff 100%);color:#111827;}',
};

const LAYOUTS = {
  center_stack: 'layout-center-stack',
  left_title_right_cards: 'layout-left-title-right-cards',
  three_step_grid: 'layout-three-step-grid',
  split_compare: 'layout-split-compare',
  bottom_caption: 'layout-bottom-caption',
  stat_focus: 'layout-stat-focus',
};

const MOTIONS = {
  fade_up: (selector, offset = 0) => `gsap.fromTo("${selector}", { opacity: 0, y: 48 }, { opacity: 1, y: 0, duration: 0.72, ease: "power2.out" }, ${offset});`,
  slide_in: (selector, offset = 0) => `gsap.fromTo("${selector}", { opacity: 0, x: -64 }, { opacity: 1, x: 0, duration: 0.68, ease: "power3.out" }, ${offset});`,
  scale_pop: (selector, offset = 0) => `gsap.fromTo("${selector}", { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.62, ease: "back.out(1.6)" }, ${offset});`,
  stagger_cards: (selector, offset = 0) => `gsap.fromTo("${selector} .creative-text-layer", { opacity: 0, y: 28 }, { opacity: 1, y: 0, stagger: 0.12, duration: 0.5, ease: "power2.out" }, ${offset});`,
  glow_pulse: (selector, offset = 0) => `gsap.fromTo("${selector}", { opacity: 0.72, filter: "brightness(1)" }, { opacity: 1, filter: "brightness(1.28)", repeat: 1, yoyo: true, duration: 0.8, ease: "sine.inOut" }, ${offset});`,
  fade_out: (selector, offset = 0) => `gsap.to("${selector}", { opacity: 0, duration: 0.45, ease: "power1.in" }, ${offset});`,
};

const VISUAL_LAYER_RENDERERS = {
  glow_panel: layer => `<div class="visual-layer visual-glow-panel visual-${escapeHtml(layer.variant)}" data-visual-id="${escapeHtml(layer.id)}"></div>`,
  grid_lines: layer => `<div class="visual-layer visual-grid-lines visual-${escapeHtml(layer.variant)}" data-visual-id="${escapeHtml(layer.id)}"></div>`,
  shape_blocks: layer => `<div class="visual-layer visual-shape-blocks visual-${escapeHtml(layer.variant)}" data-visual-id="${escapeHtml(layer.id)}"></div>`,
  number_counter: layer => `<div class="visual-layer visual-number-counter visual-${escapeHtml(layer.variant)}" data-visual-id="${escapeHtml(layer.id)}"></div>`,
  progress_bar: layer => `<div class="visual-layer visual-progress-bar visual-${escapeHtml(layer.variant)}" data-visual-id="${escapeHtml(layer.id)}"></div>`,
  connector_lines: layer => `<div class="visual-layer visual-connector-lines visual-${escapeHtml(layer.variant)}" data-visual-id="${escapeHtml(layer.id)}"></div>`,
};

const BASE_FRAME_CSS = `
.creative-frame{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;display:grid;padding:72px;box-sizing:border-box;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
.creative-frame-content{position:relative;z-index:2;display:grid;gap:24px;align-content:center;}
.creative-text-layer{max-width:980px;line-height:1.12;text-wrap:balance;}
.creative-text-layer[data-role="headline"]{font-size:72px;font-weight:800;}
.creative-text-layer[data-emphasis="primary"]{letter-spacing:0;}
.creative-text-layer[data-role="body"]{font-size:34px;font-weight:520;}
.layout-center-stack .creative-frame-content{place-items:center;text-align:center;}
.layout-left-title-right-cards .creative-frame-content{grid-template-columns:1fr 1fr;align-items:center;text-align:left;}
.layout-three-step-grid .creative-frame-content{grid-template-columns:repeat(3,1fr);align-items:stretch;}
.layout-split-compare .creative-frame-content{grid-template-columns:1fr 1fr;align-items:center;}
.layout-bottom-caption .creative-frame-content{align-content:end;text-align:center;}
.layout-stat-focus .creative-frame-content{place-items:center;text-align:center;}
.visual-layer{position:absolute;z-index:1;pointer-events:none;}
.visual-glow-panel{inset:12%;border-radius:36px;background:radial-gradient(circle at 50% 50%,rgba(56,189,248,.32),transparent 60%);filter:blur(2px);}
.visual-grid-lines{inset:0;background-image:linear-gradient(rgba(255,255,255,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.12) 1px,transparent 1px);background-size:56px 56px;}
.visual-shape-blocks{right:8%;bottom:12%;width:260px;height:260px;background:linear-gradient(135deg,#22d3ee,#a78bfa);clip-path:polygon(15% 0,100% 18%,84% 100%,0 78%);opacity:.72;}
.visual-number-counter{right:10%;top:12%;font-size:160px;font-weight:900;color:rgba(255,255,255,.16);}
.visual-progress-bar{left:10%;right:10%;bottom:10%;height:12px;border-radius:999px;background:linear-gradient(90deg,#22c55e,#38bdf8);}
.visual-connector-lines{inset:18%;border:2px solid rgba(255,255,255,.22);border-radius:28px;}
`;

function renderTextLayers(frame, scene) {
  const layers = textLayers(frame);
  const filledLayers = layers.filter(layer => String(layer && layer.text || '').trim());
  if (filledLayers.length > 0) {
    return filledLayers.map(layer => (
      `<div class="creative-text-layer" data-role="${escapeHtml(layer.role)}" data-emphasis="${escapeHtml(layer.emphasis)}">${escapeHtml(layer.text)}</div>`
    )).join('\n');
  }
  const visualText = scene && scene.visual_text ? scene.visual_text : {};
  const fallbackLayers = [];
  if (visualText.headline) {
    fallbackLayers.push({ role: 'headline', emphasis: 'primary', text: visualText.headline });
  }
  [...(visualText.cards || []), ...(visualText.keywords || [])]
    .filter(text => String(text || '').trim())
    .slice(0, 4)
    .forEach(text => fallbackLayers.push({ role: 'body', emphasis: 'secondary', text }));
  if (fallbackLayers.length === 0 && scene && scene.narration_text) {
    fallbackLayers.push({ role: 'body', emphasis: 'secondary', text: scene.narration_text });
  }
  return fallbackLayers.map(layer => (
    `<div class="creative-text-layer" data-role="${escapeHtml(layer.role)}" data-emphasis="${escapeHtml(layer.emphasis)}">${escapeHtml(layer.text)}</div>`
  )).join('\n');
}

function renderVisualLayers(frame) {
  return visualLayers(frame).map(layer => {
    const renderer = getVisualLayerRenderer(layer.type);
    return renderer(layer);
  }).join('\n');
}

function renderGenericFrame(frame, scene) {
  const frameId = escapeHtml(frame.id);
  const background = escapeHtml(frame.background || 'clean_light');
  const layout = getLayoutClass(frame.layout || 'center_stack');
  const selector = `#${frameId}`;
  return {
    html: [
      `<section id="${frameId}" class="creative-frame bg-${background} ${layout}" data-frame-id="${frameId}" data-scene-id="${escapeHtml(frame.scene_id)}">`,
      renderVisualLayers(frame),
      '<div class="creative-frame-content">',
      renderTextLayers(frame, scene),
      '</div>',
      '</section>',
    ].join('\n'),
    css: [BASE_FRAME_CSS, getBackgroundCss(frame.background || 'clean_light')].join('\n'),
    timeline: getMotionSnippet(frame.motion || 'fade_up', selector, 0),
  };
}

function template(id, supportedKinds, defaultLayout, defaultBackground, defaultMotion) {
  return {
    id,
    supportedKinds,
    defaultLayout,
    defaultBackground,
    defaultMotion,
    renderFrame: (frame, scene) => renderGenericFrame({
      ...frame,
      layout: frame.layout || defaultLayout,
      background: frame.background || defaultBackground,
      motion: frame.motion || defaultMotion,
    }, scene),
  };
}

const TEMPLATES = [
  template('hero_title', ['text', 'quote'], 'center_stack', 'dark_gradient', 'fade_up'),
  template('keyword_burst', ['text'], 'center_stack', 'radial_spotlight', 'stagger_cards'),
  template('process_steps', ['steps'], 'three_step_grid', 'soft_grid', 'slide_in'),
  template('compare_split', ['comparison'], 'split_compare', 'brand_blocks', 'slide_in'),
  template('quote_focus', ['quote'], 'bottom_caption', 'dark_gradient', 'fade_up'),
  template('data_cards', ['data'], 'stat_focus', 'dark_gradient', 'scale_pop'),
  template('cta_end', ['cta'], 'center_stack', 'radial_spotlight', 'glow_pulse'),
];

function listTemplates() {
  return TEMPLATES.map(item => ({ ...item }));
}

function getTemplate(id) {
  const found = TEMPLATES.find(item => item.id === id);
  if (!found) {
    throw new Error(`未知模板：${id}`);
  }
  return found;
}

function getBackgroundCss(id) {
  const css = BACKGROUNDS[id];
  if (!css) {
    throw new Error(`未知背景：${id}`);
  }
  return css;
}

function getLayoutClass(id) {
  const className = LAYOUTS[id];
  if (!className) {
    throw new Error(`未知布局：${id}`);
  }
  return className;
}

function getMotionSnippet(id, selector, offset) {
  const motion = MOTIONS[id];
  if (!motion) {
    throw new Error(`未知动效：${id}`);
  }
  return motion(selector, offset);
}

function getVisualLayerRenderer(type) {
  const renderer = VISUAL_LAYER_RENDERERS[type];
  if (!renderer) {
    throw new Error(`未知视觉层：${type}`);
  }
  return renderer;
}

module.exports = {
  listTemplates,
  getTemplate,
  getBackgroundCss,
  getLayoutClass,
  getMotionSnippet,
  getVisualLayerRenderer,
};
