const assert = require('assert');

const frameProfiles = require('../server/services/frameProfiles');

const profile = frameProfiles.getFrameProfile('tech_neon');
const creative = frameProfiles.getFrameProfile('creative_brutalist');

assert.equal(profile.id, 'tech_neon');
assert.equal(profile.name, '科技霓虹');
assert.equal(profile.stage.aspectRatio, '9:16');
assert.ok(profile.cssVars['--frame-bg']);
assert.ok(profile.cssVars['--frame-accent']);
assert.ok(profile.backgroundLayers.includes('neon-grid'));
assert.ok(profile.backgroundLayers.includes('scanline'));
assert.ok(profile.sceneRenderers.includes('text_card'));
assert.ok(profile.sceneRenderers.includes('quote_card'));
assert.ok(profile.sceneRenderers.includes('contrast_card'));
assert.ok(profile.sceneRenderers.includes('step_card'));
assert.ok(profile.transitions.includes('glitch-wipe'));
assert.ok(profile.transitions.includes('zoom-burst'));

const fallback = frameProfiles.getFrameProfile('missing');
assert.equal(fallback.id, 'tech_neon');
assert.equal(creative.id, 'creative_brutalist');
assert.equal(creative.stage.aspectRatio, '9:16');
assert.equal(creative.cssVars['--frame-bg'], '#EFE9D9');
assert.equal(creative.cssVars['--frame-ink'], '#0F0F0F');
assert.ok(creative.backgroundLayers.includes('paper-grain'));

const normalized = frameProfiles.normalizeFrameOptions({
  frameStyle: 'creative_brutalist',
  energy: 'high',
  density: 'rich',
  transitionStyle: 'glitch',
  captionMode: 'kinetic',
});
assert.deepStrictEqual(normalized, {
  frameStyle: 'creative_brutalist',
  energy: 'high',
  density: 'rich',
  transitionStyle: 'glitch',
  captionMode: 'kinetic',
});

const safe = frameProfiles.normalizeFrameOptions({
  frameStyle: 'unknown',
  energy: 'extreme',
  density: 'busy',
  transitionStyle: 'spin',
  captionMode: 'karaoke',
});
assert.deepStrictEqual(safe, {
  frameStyle: 'tech_neon',
  energy: 'medium',
  density: 'balanced',
  transitionStyle: 'auto',
  captionMode: 'standard',
});

console.log('frame profile tests passed');
