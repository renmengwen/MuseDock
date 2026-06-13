const { isAllowedKind } = require('./specEnums');

const PRODUCTION_WORDS = ['背景', '光效', '动画', '转场', '布局', '发光', '粒子', '镜头'];

function roundTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.round(number * 100) / 100;
}

function text(value) {
  return String(value || '').trim();
}

function list(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(item => text(item)).filter(Boolean);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function normalizeVisualText(visualText) {
  const source = visualText || {};
  return {
    headline: text(source.headline),
    keywords: list(source.keywords),
    cards: list(source.cards),
  };
}

function normalizeCaptions(captions) {
  if (!Array.isArray(captions)) {
    return [];
  }
  return captions.map((caption, index) => {
    const isObject = caption && typeof caption === 'object';
    const source = isObject ? caption : {};
    return {
      id: text(source.id) || `cap_${String(index + 1).padStart(2, '0')}`,
      start: roundTime(source.start),
      end: roundTime(source.end),
      text: text(source.text),
      ...(!isObject ? { invalid: true } : {}),
    };
  });
}

function normalizeScene(scene, index) {
  const kind = isAllowedKind(scene && scene.kind) ? text(scene.kind) : 'text';
  return {
    id: text(scene && scene.id) || `scene_${String(index + 1).padStart(2, '0')}`,
    order: index + 1,
    start: roundTime(scene && scene.start),
    duration: roundTime(scene && scene.duration),
    kind,
    narration_text: text(scene && scene.narration_text),
    captions: normalizeCaptions(scene && scene.captions),
    visual_text: normalizeVisualText(scene && scene.visual_text),
  };
}

function retimeScenes(sceneSpec) {
  const source = sceneSpec && sceneSpec.scene_spec ? sceneSpec.scene_spec : sceneSpec;
  const scenes = Array.isArray(source && source.scenes) ? source.scenes : [];
  let cursor = 0;
  const retimedScenes = scenes.map((scene, index) => {
    const normalized = normalizeScene(scene, index);
    const start = roundTime(cursor);
    const duration = roundTime(normalized.duration);
    cursor = roundTime(cursor + duration);
    return {
      ...normalized,
      order: index + 1,
      start,
      duration,
    };
  });
  return {
    ...clone(source),
    version: Number(source && source.version) || 1,
    title: text(source && source.title),
    aspect_ratio: text(source && source.aspect_ratio) || '16:9',
    target_duration_sec: roundTime((source && source.target_duration_sec) || cursor),
    scenes: retimedScenes,
  };
}

function normalizeSceneSpec(raw) {
  return retimeScenes(raw && raw.scene_spec ? raw.scene_spec : raw);
}

function hasProductionWord(value) {
  const content = text(value);
  return PRODUCTION_WORDS.some(word => content.includes(word));
}

function collectTextFields(scene) {
  const visualText = scene.visual_text || {};
  return [
    { label: `${scene.id}.narration_text`, value: scene.narration_text },
    { label: `${scene.id}.visual_text.headline`, value: visualText.headline },
    ...list(visualText.keywords).map((value, index) => ({
      label: `${scene.id}.visual_text.keywords[${index}]`,
      value,
    })),
    ...list(visualText.cards).map((value, index) => ({
      label: `${scene.id}.visual_text.cards[${index}]`,
      value,
    })),
    ...(Array.isArray(scene.captions) ? scene.captions : []).map(caption => ({
      label: `${scene.id}.captions.${caption.id || 'caption'}`,
      value: caption.text,
    })),
  ];
}

function validateSceneSpec(raw) {
  const sceneSpec = normalizeSceneSpec(raw);
  const errors = [];

  if (!Array.isArray(sceneSpec.scenes) || sceneSpec.scenes.length === 0) {
    errors.push('scene_spec.scenes 不能为空');
  }

  const sceneIds = new Set();
  sceneSpec.scenes.forEach((scene, index) => {
    if (!scene.id) {
      errors.push(`第 ${index + 1} 个场景缺少 id`);
    }
    if (sceneIds.has(scene.id)) {
      errors.push(`场景 id 重复：${scene.id}`);
    }
    sceneIds.add(scene.id);
    if (!isAllowedKind(scene.kind)) {
      errors.push(`场景 ${scene.id} 的 kind 不被允许`);
    }
    if (scene.duration <= 0) {
      errors.push(`场景 ${scene.id} 的 duration 必须大于 0`);
    }
    scene.captions.forEach(caption => {
      if (caption.invalid) {
        errors.push(`场景 ${scene.id} 的字幕 ${caption.id} 格式无效`);
      }
      if (caption.end < caption.start) {
        errors.push(`场景 ${scene.id} 的字幕 ${caption.id} 结束时间不能早于开始时间`);
      }
      if (caption.start < 0 || caption.end > scene.duration) {
        errors.push(`场景 ${scene.id} 的字幕 ${caption.id} 时间范围必须落在场景时长内`);
      }
    });
    collectTextFields(scene).forEach(field => {
      if (hasProductionWord(field.value)) {
        errors.push(`${field.label} 包含视觉描述或制作说明，请移到 frame_specs 的视觉字段`);
      }
    });
  });

  return {
    success: errors.length === 0,
    errors,
    scene_spec: sceneSpec,
  };
}

function findSceneIndex(sceneSpec, sceneId) {
  return sceneSpec.scenes.findIndex(scene => scene.id === sceneId);
}

function applySceneEdit(rawSceneSpec, edit) {
  const next = normalizeSceneSpec(rawSceneSpec);
  const change = edit || {};
  let requiresTts = false;
  let requiresRender = false;

  if (change.type === 'reorder_scenes') {
    const orderedIds = Array.isArray(change.scene_ids) ? change.scene_ids : [];
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    next.scenes.sort((left, right) => {
      const leftRank = rank.has(left.id) ? rank.get(left.id) : Number.MAX_SAFE_INTEGER;
      const rightRank = rank.has(right.id) ? rank.get(right.id) : Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.order - right.order;
    });
    requiresRender = true;
    return { scene_spec: retimeScenes(next), requires_tts: requiresTts, requires_render: requiresRender };
  }

  const sceneIndex = findSceneIndex(next, change.scene_id);
  if (sceneIndex === -1) {
    return { scene_spec: next, requires_tts: false, requires_render: false, errors: ['未找到要编辑的场景'] };
  }

  const scene = next.scenes[sceneIndex];
  if (change.type === 'duration') {
    scene.duration = roundTime(change.duration);
    requiresRender = true;
  } else if (change.type === 'narration_text') {
    scene.narration_text = text(change.text);
    requiresTts = true;
    requiresRender = true;
  } else if (change.type === 'caption_text') {
    const caption = scene.captions.find(item => item.id === change.caption_id);
    if (caption) {
      caption.text = text(change.text);
      requiresRender = true;
    }
  } else if (change.type === 'visual_text') {
    scene.visual_text = normalizeVisualText(change.visual_text);
    requiresRender = true;
  }

  return {
    scene_spec: retimeScenes(next),
    requires_tts: requiresTts,
    requires_render: requiresRender,
  };
}

module.exports = {
  normalizeSceneSpec,
  validateSceneSpec,
  applySceneEdit,
  retimeScenes,
};
