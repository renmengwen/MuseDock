const assert = require('assert');
const enums = require('../server/services/creative-video/specEnums');

assert.deepEqual(enums.KINDS, ['text', 'data', 'quote', 'steps', 'comparison', 'cta']);
assert.ok(enums.TEMPLATES.includes('hero_title'));
assert.ok(enums.TEMPLATES.includes('data_cards'));
assert.ok(enums.LAYOUTS.includes('center_stack'));
assert.ok(enums.BACKGROUNDS.includes('dark_gradient'));
assert.ok(enums.MOTIONS.includes('fade_up'));
assert.ok(enums.VISUAL_LAYER_TYPES.includes('glow_panel'));
assert.equal(enums.isAllowedKind('text'), true);
assert.equal(enums.isAllowedKind('freeform'), false);

console.log('creative video spec enum tests passed');
