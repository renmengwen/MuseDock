const storyboardSchema = require('./storyboardSchema');

function prepareSceneDsl(scene = {}) {
  const source = scene && typeof scene === 'object' && !Array.isArray(scene) ? scene : {};
  const normalizedScene = {
    ...source,
    visual_type: storyboardSchema.VISUAL_TYPE_ALLOWED.includes(source.visual_type)
      ? source.visual_type
      : 'quote_burst',
  };
  const visualScene = storyboardSchema.normalizeVisualScene(normalizedScene);
  return {
    visualType: normalizedScene.visual_type,
    composition: visualScene.composition,
    objects: visualScene.objects,
    motion: visualScene.motion,
    beats: visualScene.beats,
    caption_sync: visualScene.caption_sync,
    focus: visualScene.focus,
  };
}

function prepareScenes(scenes = []) {
  return Array.isArray(scenes)
    ? scenes.map(scene => {
      const source = scene && typeof scene === 'object' && !Array.isArray(scene) ? scene : {};
      return { ...source, prepared_visual_scene: prepareSceneDsl(source) };
    })
    : [];
}

module.exports = {
  prepareSceneDsl,
  prepareScenes,
};
