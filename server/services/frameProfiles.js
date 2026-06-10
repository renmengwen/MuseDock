const FRAME_DEFAULTS = {
  frameStyle: 'tech_neon',
  energy: 'medium',
  density: 'balanced',
  transitionStyle: 'auto',
  captionMode: 'standard',
};

const FRAME_ALLOWED = {
  frameStyle: ['tech_neon', 'creative_brutalist'],
  energy: ['low', 'medium', 'high'],
  density: ['clean', 'balanced', 'rich'],
  transitionStyle: ['auto', 'wipe', 'glitch', 'zoom'],
  captionMode: ['standard', 'kinetic'],
};

const TECH_NEON_PROFILE = {
  id: 'tech_neon',
  name: '科技霓虹',
  stage: {
    aspectRatio: '9:16',
    compositionId: 'ai-storyboard-cards',
  },
  cssVars: {
    '--frame-bg': '#05070b',
    '--frame-panel': 'rgba(14, 18, 24, .78)',
    '--frame-accent': '#25f4ee',
    '--frame-hot': '#fe2c55',
    '--frame-gold': '#ffd166',
    '--frame-text': '#f7fbff',
    '--frame-muted': 'rgba(247, 251, 255, .72)',
  },
  backgroundLayers: ['neon-grid', 'scanline', 'radial-energy'],
  sceneRenderers: ['workflow', 'code_panel', 'ui_mockup', 'split_compare', 'concept_map', 'timeline', 'quote_burst', 'text_card', 'quote_card', 'contrast_card', 'step_card'],
  transitions: ['glitch-wipe', 'zoom-burst', 'soft-wipe'],
};

const CREATIVE_BRUTALIST_PROFILE = {
  id: 'creative_brutalist',
  name: 'Creative Brutalist',
  stage: {
    aspectRatio: '9:16',
    compositionId: 'ai-storyboard-cards',
  },
  cssVars: {
    '--frame-bg': '#EFE9D9',
    '--frame-panel': '#E4DCC4',
    '--frame-ink': '#0F0F0F',
    '--frame-accent': '#1F8A4C',
    '--frame-hot': '#F06CA8',
    '--frame-gold': '#F5C518',
    '--frame-text': '#0F0F0F',
    '--frame-muted': 'rgba(15, 15, 15, .68)',
  },
  backgroundLayers: ['paper-grain', 'ink-grid'],
  sceneRenderers: TECH_NEON_PROFILE.sceneRenderers,
  transitions: ['hard-wipe', 'stamp-pop', 'soft-wipe'],
};

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeFrameOptions(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    frameStyle: pickAllowed(source.frameStyle, FRAME_ALLOWED.frameStyle, FRAME_DEFAULTS.frameStyle),
    energy: pickAllowed(source.energy, FRAME_ALLOWED.energy, FRAME_DEFAULTS.energy),
    density: pickAllowed(source.density, FRAME_ALLOWED.density, FRAME_DEFAULTS.density),
    transitionStyle: pickAllowed(source.transitionStyle, FRAME_ALLOWED.transitionStyle, FRAME_DEFAULTS.transitionStyle),
    captionMode: pickAllowed(source.captionMode, FRAME_ALLOWED.captionMode, FRAME_DEFAULTS.captionMode),
  };
}

function getFrameProfile(id = FRAME_DEFAULTS.frameStyle) {
  const value = typeof id === 'string' ? id.trim() : '';
  if (value === TECH_NEON_PROFILE.id) return TECH_NEON_PROFILE;
  if (value === CREATIVE_BRUTALIST_PROFILE.id) return CREATIVE_BRUTALIST_PROFILE;
  return TECH_NEON_PROFILE;
}

module.exports = {
  FRAME_DEFAULTS,
  normalizeFrameOptions,
  getFrameProfile,
};
