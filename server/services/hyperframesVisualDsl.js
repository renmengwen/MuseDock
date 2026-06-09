const storyboardSchema = require('./storyboardSchema');

function prepareSceneDsl(scene = {}) {
  const normalizedScene = {
    ...scene,
    visual_type: storyboardSchema.VISUAL_TYPE_ALLOWED.includes(scene.visual_type)
      ? scene.visual_type
      : 'quote_burst',
  };
  const visualScene = storyboardSchema.normalizeVisualScene(normalizedScene);
  return {
    visualType: normalizedScene.visual_type,
    composition: visualScene.composition,
    objects: visualScene.objects,
    motion: visualScene.motion,
    focus: visualScene.focus,
  };
}

function prepareScenes(scenes = []) {
  return Array.isArray(scenes)
    ? scenes.map(scene => ({ ...scene, prepared_visual_scene: prepareSceneDsl(scene) }))
    : [];
}

module.exports = {
  prepareSceneDsl,
  prepareScenes,
};
