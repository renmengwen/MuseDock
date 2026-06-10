const assert = require('assert');

const frameProfiles = require('../server/services/frameProfiles');

const creative = frameProfiles.getFrameProfile('creative_brutalist');

const fallback = frameProfiles.getFrameProfile('missing');
assert.equal(fallback.id, 'creative_brutalist');
assert.equal(creative.id, 'creative_brutalist');
assert.equal(creative.stage.aspectRatio, '9:16');
assert.equal(creative.cssVars['--frame-bg'], '#EFE9D9');
assert.equal(creative.cssVars['--frame-ink'], '#0F0F0F');
assert.ok(creative.backgroundLayers.includes('paper-grain'));
assert.ok(!creative.backgroundLayers.includes('neon-grid'));

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
  frameStyle: 'creative_brutalist',
  energy: 'medium',
  density: 'balanced',
  transitionStyle: 'auto',
  captionMode: 'standard',
});

console.log('frame profile tests passed');
