const templateRegistry = require('./templateRegistry');

const KINDS = ['text', 'data', 'quote', 'steps', 'comparison', 'cta'];

// Legacy templates (hardcoded)
const LEGACY_TEMPLATES = ['hero_title', 'keyword_burst', 'process_steps', 'compare_split', 'quote_focus', 'data_cards', 'cta_end'];

const LAYOUTS = ['center_stack', 'left_title_right_cards', 'three_step_grid', 'split_compare', 'bottom_caption', 'stat_focus'];
const BACKGROUNDS = ['dark_gradient', 'soft_grid', 'radial_spotlight', 'brand_blocks', 'clean_light'];
const MOTIONS = ['fade_up', 'slide_in', 'scale_pop', 'stagger_cards', 'glow_pulse', 'fade_out'];
const VISUAL_LAYER_TYPES = ['glow_panel', 'grid_lines', 'shape_blocks', 'number_counter', 'progress_bar', 'connector_lines'];

function includes(list, value) {
  return list.includes(String(value || '').trim());
}

/**
 * Get all allowed template IDs (legacy + rich from filesystem).
 */
function getAllTemplateIds() {
  const richIds = templateRegistry.getRichTemplateIds();
  return [...new Set([...LEGACY_TEMPLATES, ...richIds])];
}

module.exports = {
  KINDS,
  get TEMPLATES() { return getAllTemplateIds(); }, // Dynamically includes all templates
  LAYOUTS,
  BACKGROUNDS,
  MOTIONS,
  VISUAL_LAYER_TYPES,
  isAllowedKind: value => includes(KINDS, value),
  isAllowedTemplate: value => {
    const id = String(value || '').trim();
    // Check legacy templates first
    if (LEGACY_TEMPLATES.includes(id)) return true;
    // Check rich templates from filesystem
    return templateRegistry.hasTemplate(id);
  },
  isAllowedLayout: value => includes(LAYOUTS, value),
  isAllowedBackground: value => includes(BACKGROUNDS, value),
  isAllowedMotion: value => includes(MOTIONS, value),
  isAllowedVisualLayerType: value => includes(VISUAL_LAYER_TYPES, value),
  getAllTemplateIds,
};
