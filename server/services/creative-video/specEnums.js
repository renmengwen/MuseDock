const KINDS = ['text', 'data', 'quote', 'steps', 'comparison', 'cta'];
const TEMPLATES = ['hero_title', 'keyword_burst', 'process_steps', 'compare_split', 'quote_focus', 'data_cards', 'cta_end'];
const LAYOUTS = ['center_stack', 'left_title_right_cards', 'three_step_grid', 'split_compare', 'bottom_caption', 'stat_focus'];
const BACKGROUNDS = ['dark_gradient', 'soft_grid', 'radial_spotlight', 'brand_blocks', 'clean_light'];
const MOTIONS = ['fade_up', 'slide_in', 'scale_pop', 'stagger_cards', 'glow_pulse', 'fade_out'];
const VISUAL_LAYER_TYPES = ['glow_panel', 'grid_lines', 'shape_blocks', 'number_counter', 'progress_bar', 'connector_lines'];

function includes(list, value) {
  return list.includes(String(value || '').trim());
}

module.exports = {
  KINDS,
  TEMPLATES,
  LAYOUTS,
  BACKGROUNDS,
  MOTIONS,
  VISUAL_LAYER_TYPES,
  isAllowedKind: value => includes(KINDS, value),
  isAllowedTemplate: value => includes(TEMPLATES, value),
  isAllowedLayout: value => includes(LAYOUTS, value),
  isAllowedBackground: value => includes(BACKGROUNDS, value),
  isAllowedMotion: value => includes(MOTIONS, value),
  isAllowedVisualLayerType: value => includes(VISUAL_LAYER_TYPES, value),
};
