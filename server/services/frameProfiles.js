const FRAME_DEFAULTS = {
  frameStyle: 'creative_brutalist',
  energy: 'medium',
  density: 'balanced',
  transitionStyle: 'auto',
  captionMode: 'standard',
};

const FRAME_ALLOWED = {
  frameStyle: ['creative_brutalist'],
  energy: ['low', 'medium', 'high'],
  density: ['clean', 'balanced', 'rich'],
  transitionStyle: ['auto', 'wipe', 'glitch', 'zoom'],
  captionMode: ['standard', 'kinetic', 'phrase_kinetic'],
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
  sceneRenderers: ['workflow', 'code_panel', 'ui_mockup', 'split_compare', 'concept_map', 'timeline', 'quote_burst', 'text_card', 'quote_card', 'contrast_card', 'step_card'],
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

function getFrameProfile() {
  return CREATIVE_BRUTALIST_PROFILE;
}

module.exports = {
  FRAME_DEFAULTS,
  normalizeFrameOptions,
  getFrameProfile,
};
