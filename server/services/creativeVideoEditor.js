const sceneSpec = require('./sceneSpec');

function applyEditCommand(spec, command) {
  try {
    const result = sceneSpec.applySceneSpecEdit(spec, command);
    return {
      success: true,
      scene_spec: result.scene_spec,
      edit_type: command.type,
      requires_tts: result.requires_tts,
      requires_render: result.requires_render,
      changed_scene_ids: [command.scene_id],
      message: '编辑已应用',
    };
  } catch (error) {
    return {
      success: false,
      scene_spec: spec,
      edit_type: command.type,
      requires_tts: false,
      requires_render: false,
      changed_scene_ids: [],
      message: error.message,
    };
  }
}

function applyRewriteResult(spec, sceneId, rewriteResult) {
  try {
    const cloned = JSON.parse(JSON.stringify(spec));
    const scene = cloned.scenes.find(s => s.id === sceneId);
    if (!scene) {
      return {
        success: false,
        scene_spec: spec,
        edit_type: 'rewrite',
        requires_tts: false,
        requires_render: false,
        changed_scene_ids: [],
        message: `未找到场景 ${sceneId}`,
      };
    }

    scene.narration_text = rewriteResult.narration_text || scene.narration_text;
    if (rewriteResult.captions) {
      scene.captions = rewriteResult.captions;
    }
    if (rewriteResult.visual_text) {
      scene.visual_text = rewriteResult.visual_text;
    }
    if (typeof rewriteResult.duration === 'number' && rewriteResult.duration > 0) {
      scene.duration = Math.round(rewriteResult.duration * 100) / 100;
      cloned.scenes = sceneSpec.retimeScenes(cloned.scenes);
    }

    return {
      success: true,
      scene_spec: cloned,
      edit_type: 'rewrite',
      requires_tts: true,
      requires_render: true,
      changed_scene_ids: [sceneId],
      message: '场景已重写',
    };
  } catch (error) {
    return {
      success: false,
      scene_spec: spec,
      edit_type: 'rewrite',
      requires_tts: false,
      requires_render: false,
      changed_scene_ids: [],
      message: error.message,
    };
  }
}

module.exports = {
  applyEditCommand,
  applyRewriteResult,
};
