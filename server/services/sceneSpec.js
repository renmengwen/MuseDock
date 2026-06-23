function normalizeSceneSpec(input) {
  let cumulative = 0;
  const scenes = (input.scenes || []).map((scene, index) => {
    const duration = Math.round(scene.duration * 100) / 100;
    const start = Math.round(cumulative * 100) / 100;
    cumulative += duration;
    return {
      ...scene,
      duration,
      order: index + 1,
      start,
      editable: scene.editable || { local_tts: true },
    };
  });

  return {
    version: 1,
    title: input.title || '',
    aspect_ratio: input.aspect_ratio || '9:16',
    target_duration_sec: input.target_duration_sec || 0,
    style: input.style || null,
    scenes,
  };
}

function retimeScenes(scenes) {
  let cumulative = 0;
  return scenes.map((scene, index) => {
    const start = Math.round(cumulative * 100) / 100;
    cumulative += scene.duration;
    return {
      ...scene,
      order: index + 1,
      start,
    };
  });
}

function validateSceneSpec(spec) {
  const errors = [];

  if (!spec.scenes || !Array.isArray(spec.scenes)) {
    errors.push('缺少 scenes 数组');
    return { success: false, errors };
  }

  spec.scenes.forEach((scene, index) => {
    const sceneNum = index + 1;
    if (!scene.id) {
      errors.push(`场景 ${sceneNum} 缺少 id`);
    }
    if (typeof scene.duration !== 'number' || scene.duration <= 0) {
      errors.push(`场景 ${sceneNum} 时长无效`);
    }
  });

  const ids = spec.scenes.map(s => s.id).filter(Boolean);
  const uniqueIds = new Set(ids);
  if (ids.length !== uniqueIds.size) {
    errors.push('存在重复的场景 id');
  }

  return { success: errors.length === 0, errors };
}

function applySceneSpecEdit(spec, edit) {
  const cloned = JSON.parse(JSON.stringify(spec));
  const scene = cloned.scenes.find(s => s.id === edit.scene_id);

  switch (edit.type) {
    case 'caption_text': {
      if (!scene) throw new Error(`未找到场景 ${edit.scene_id}`);
      const caption = scene.captions.find(c => c.id === edit.caption_id);
      if (!caption) throw new Error(`未找到字幕 ${edit.caption_id}`);
      caption.text = edit.text;
      return { scene_spec: cloned, requires_tts: false, requires_render: true };
    }

    case 'narration_text': {
      if (!scene) throw new Error(`未找到场景 ${edit.scene_id}`);
      scene.narration_text = edit.text;
      return { scene_spec: cloned, requires_tts: true, requires_render: true };
    }

    case 'visual_text': {
      if (!scene) throw new Error(`未找到场景 ${edit.scene_id}`);
      scene.visual_text = edit.visual_text;
      return { scene_spec: cloned, requires_tts: false, requires_render: true };
    }

    case 'duration': {
      if (!scene) throw new Error(`未找到场景 ${edit.scene_id}`);
      if (typeof edit.duration !== 'number' || edit.duration <= 0) {
        throw new Error('时长必须为正数');
      }
      scene.duration = Math.round(edit.duration * 100) / 100;
      cloned.scenes = retimeScenes(cloned.scenes);
      return { scene_spec: cloned, requires_tts: false, requires_render: true };
    }

    case 'reorder_scenes': {
      if (!edit.scene_ids || !Array.isArray(edit.scene_ids)) {
        throw new Error('缺少 scene_ids 数组');
      }
      const originalIds = new Set(cloned.scenes.map(s => s.id));
      const newIds = new Set(edit.scene_ids);
      if (originalIds.size !== newIds.size || ![...originalIds].every(id => newIds.has(id))) {
        throw new Error('重排序的场景 ID 集合与原集合不一致');
      }
      const reordered = edit.scene_ids.map(id => {
        const found = cloned.scenes.find(s => s.id === id);
        if (!found) throw new Error(`未找到场景 ${id}`);
        return found;
      });
      cloned.scenes = retimeScenes(reordered);
      return { scene_spec: cloned, requires_tts: false, requires_render: true };
    }

    default:
      throw new Error(`未知的编辑类型 ${edit.type}`);
  }
}

module.exports = {
  normalizeSceneSpec,
  validateSceneSpec,
  applySceneSpecEdit,
  retimeScenes,
};
