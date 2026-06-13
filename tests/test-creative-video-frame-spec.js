const assert = require('assert');
const frameSpec = require('../server/services/creative-video/frameSpecService');

const sceneSpec = {
  scenes: [
    { id: 'scene_01', order: 1, start: 0, duration: 8, kind: 'text' },
    { id: 'scene_02', order: 2, start: 8, duration: 6, kind: 'cta' },
  ],
};

const raw = {
  frames: [
    {
      id: 'frame_01_01',
      scene_id: 'scene_01',
      start: 0,
      duration: 4,
      kind: 'text',
      template: 'hero_title',
      layout: 'center_stack',
      background: 'dark_gradient',
      motion: 'fade_up',
      text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }],
      visual_layers: [{ id: 'accent_01', type: 'glow_panel', variant: 'cyan_pink' }],
    },
    {
      id: 'frame_02_01',
      scene_id: 'scene_02',
      start: 8,
      duration: 6,
      kind: 'cta',
      template: 'cta_end',
      layout: 'center_stack',
      background: 'radial_spotlight',
      motion: 'glow_pulse',
      text_layers: [{ id: 'cta', role: 'headline', text: '马上行动', emphasis: 'primary' }],
      visual_layers: [],
    },
  ],
};

const normalized = frameSpec.normalizeFrameSpecs(raw, sceneSpec);
assert.equal(normalized.frames[0].order, 1);
assert.equal(normalized.frames[0].duration, 4);
assert.equal(frameSpec.validateFrameSpecs(normalized, sceneSpec).success, true);

const duplicateIds = frameSpec.normalizeFrameSpecs({
  frame_specs: [
    { ...raw.frames[0], id: 'frame_dup' },
    { ...raw.frames[0], id: 'frame_dup', start: 2, duration: 2 },
  ],
}, sceneSpec);
assert.equal(duplicateIds.frames[0].id, 'frame_dup');
assert.equal(duplicateIds.frames[1].id, 'frame_dup_2');

const invalidKind = frameSpec.validateFrameSpecs({
  frames: [{ ...raw.frames[0], kind: 'freeform' }],
}, sceneSpec);
assert.equal(invalidKind.success, false);
assert.ok(invalidKind.errors.some(error => error.includes('kind')));

const invalidTemplate = frameSpec.validateFrameSpecs({
  frames: [{ ...raw.frames[0], template: 'unknown_template' }],
}, sceneSpec);
assert.equal(invalidTemplate.success, false);
assert.ok(invalidTemplate.errors.some(error => error.includes('template')));

const visualOnlyBackground = frameSpec.validateFrameSpecs({
  frames: [
    { ...raw.frames[0], background: '', visual_layers: [{ id: 'accent', type: 'glow_panel' }] },
    raw.frames[1],
  ],
}, sceneSpec);
assert.equal(visualOnlyBackground.success, true);

const missingTextLayer = frameSpec.validateFrameSpecs({
  frames: [{ ...raw.frames[0], text_layers: [] }],
}, sceneSpec);
assert.equal(missingTextLayer.success, false);
assert.ok(missingTextLayer.errors.some(error => error.includes('text_layers')));

const invalidTiming = frameSpec.validateFrameSpecs({
  frames: [{ ...raw.frames[0], start: 7, duration: 4 }],
}, sceneSpec);
assert.equal(invalidTiming.success, false);
assert.ok(invalidTiming.errors.some(error => error.includes('时间范围')));

const retimed = frameSpec.retimeFramesForScenes({
  frames: [
    raw.frames[0],
    { ...raw.frames[0], id: 'frame_01_02', start: 2, duration: 2 },
    raw.frames[1],
  ],
}, {
  scenes: [
    { id: 'scene_02', order: 1, start: 0, duration: 6, kind: 'cta' },
    { id: 'scene_01', order: 2, start: 6, duration: 8, kind: 'text' },
  ],
});
assert.equal(retimed.frames[0].scene_id, 'scene_02');
assert.equal(retimed.frames[0].start, 0);
assert.equal(retimed.frames[1].scene_id, 'scene_01');
assert.equal(retimed.frames[1].start, 6);
assert.equal(retimed.frames[2].scene_id, 'scene_01');
assert.equal(retimed.frames[2].start, 8);

console.log('creative video frame spec tests passed');
