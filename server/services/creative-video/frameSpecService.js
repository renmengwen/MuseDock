const {
  isAllowedKind,
  isAllowedTemplate,
  isAllowedLayout,
  isAllowedBackground,
  isAllowedMotion,
  isAllowedVisualLayerType,
} = require('./specEnums');

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
  return Array.isArray(value) ? value : [];
}

function sceneMap(sceneSpec) {
  const scenes = list(sceneSpec && sceneSpec.scenes);
  return new Map(scenes.map(scene => [scene.id, scene]));
}

function getFrames(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (Array.isArray(raw && raw.frame_specs)) {
    return raw.frame_specs;
  }
  return list(raw && raw.frames);
}

function uniqueFrameId(baseId, usedIds, index) {
  const fallback = `frame_${String(index + 1).padStart(2, '0')}`;
  const base = text(baseId) || fallback;
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  let suffix = 2;
  while (usedIds.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  const next = `${base}_${suffix}`;
  usedIds.add(next);
  return next;
}

function normalizeTextLayer(layer, index) {
  const source = layer && typeof layer === 'object' ? layer : {};
  return {
    id: text(source.id) || `text_${String(index + 1).padStart(2, '0')}`,
    role: text(source.role) || 'body',
    text: text(source.text),
    emphasis: text(source.emphasis) || 'normal',
  };
}

function normalizeVisualLayer(layer, index) {
  const source = layer && typeof layer === 'object' ? layer : {};
  return {
    id: text(source.id) || `visual_${String(index + 1).padStart(2, '0')}`,
    type: text(source.type),
    variant: text(source.variant),
  };
}

function buildFallbackTextLayers(scene) {
  const layers = [];
  if (!scene) return layers;
  const vt = scene.visual_text || {};
  if (vt.headline) {
    layers.push({ id: 'text_fb_01', role: 'headline', text: vt.headline, emphasis: 'primary' });
  }
  const extras = [...(vt.cards || []), ...(vt.keywords || [])]
    .filter(t => String(t || '').trim())
    .slice(0, 4);
  extras.forEach((t, i) => {
    layers.push({
      id: `text_fb_${String(i + 2).padStart(2, '0')}`,
      role: 'body',
      text: t,
      emphasis: 'secondary',
    });
  });
  if (layers.length === 0 && scene.narration_text) {
    layers.push({ id: 'text_fb_01', role: 'body', text: scene.narration_text, emphasis: 'secondary' });
  }
  return layers;
}

function normalizeFrame(frame, index, usedIds, scenesById) {
  const source = frame && typeof frame === 'object' ? frame : {};
  const sceneId = text(source.scene_id);
  const scene = scenesById && scenesById.get(sceneId);
  const rawStart = Number(source.start);
  const hasStart = Number.isFinite(rawStart);
  let start = roundTime(source.start);
  if (scene) {
    if (!hasStart) {
      start = roundTime(scene.start);
    } else if (rawStart >= 0 && rawStart < Number(scene.start || 0)) {
      start = roundTime(Number(scene.start || 0) + rawStart);
    }
  }
  const rawDuration = Number(source.duration);
  const hasDuration = Number.isFinite(rawDuration) && rawDuration > 0;
  let duration = roundTime(source.duration);
  if (scene && !hasDuration) {
    duration = roundTime(Number(scene.duration || 0) - Math.max(0, start - Number(scene.start || 0)));
  }
  const rawKind = text(source.kind) || 'text';
  const kind = scene && isAllowedKind(rawKind) && rawKind !== scene.kind
    ? scene.kind
    : rawKind;
  let textLayers = list(source.text_layers).map(normalizeTextLayer);
  // If AI omitted text_layers, auto-populate from scene.visual_text
  if (textLayers.length === 0) {
    textLayers = buildFallbackTextLayers(scene).map(normalizeTextLayer);
  }
  return {
    id: uniqueFrameId(source.id, usedIds, index),
    scene_id: sceneId,
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : index + 1,
    start,
    duration,
    kind,
    template: text(source.template),
    layout: text(source.layout),
    background: text(source.background),
    motion: text(source.motion),
    text_layers: textLayers,
    visual_layers: list(source.visual_layers).map(normalizeVisualLayer),
  };
}

function normalizeFrameSpecs(raw, sceneSpec) {
  const usedIds = new Set();
  const scenesById = sceneMap(sceneSpec);
  const frames = getFrames(raw).map((frame, index) => normalizeFrame(frame, index, usedIds, scenesById));
  return { frames };
}

function frameEnd(frame) {
  return roundTime(frame.start + frame.duration);
}

function validateFrameSpecs(raw, sceneSpec) {
  const frameSpecs = normalizeFrameSpecs(raw, sceneSpec);
  const scenesById = sceneMap(sceneSpec);
  const errors = [];

  if (frameSpecs.frames.length === 0) {
    errors.push('frame_specs.frames 不能为空');
  }

  const coveredScenes = new Set();
  frameSpecs.frames.forEach(frame => {
    const scene = scenesById.get(frame.scene_id);
    if (!scene) {
      errors.push(`frame ${frame.id} 的 scene_id 不存在`);
      return;
    }
    coveredScenes.add(frame.scene_id);
    if (!isAllowedKind(frame.kind)) {
      errors.push(`frame ${frame.id} 的 kind 不被允许`);
    }
    if (isAllowedKind(frame.kind) && frame.kind !== scene.kind) {
      errors.push(`frame ${frame.id} 的 kind 与所属 scene 不兼容`);
    }
    if (!isAllowedTemplate(frame.template)) {
      errors.push(`frame ${frame.id} 的 template 不被允许`);
    }
    if (!isAllowedLayout(frame.layout)) {
      errors.push(`frame ${frame.id} 的 layout 不被允许`);
    }
    if (frame.background && !isAllowedBackground(frame.background)) {
      errors.push(`frame ${frame.id} 的 background 不被允许`);
    }
    if (!isAllowedMotion(frame.motion)) {
      errors.push(`frame ${frame.id} 的 motion 不被允许`);
    }
    frame.visual_layers.forEach(layer => {
      if (!isAllowedVisualLayerType(layer.type)) {
        errors.push(`frame ${frame.id} 的 visual_layers.type 不被允许`);
      }
    });
    if (frame.text_layers.length === 0) {
      errors.push(`frame ${frame.id} 必须至少包含一个 text_layers 项`);
    }
    if (!frame.background && frame.visual_layers.length === 0) {
      errors.push(`frame ${frame.id} 必须包含 background 或 visual_layers`);
    }
    if (frame.duration <= 0) {
      errors.push(`frame ${frame.id} 的 duration 必须大于 0`);
    }
    const sceneStart = roundTime(scene.start);
    const sceneEnd = roundTime(scene.start + scene.duration);
    if (frame.start < sceneStart || frameEnd(frame) > sceneEnd) {
      errors.push(`frame ${frame.id} 的时间范围必须落在所属 scene 内`);
    }
  });

  list(sceneSpec && sceneSpec.scenes).forEach(scene => {
    if (!coveredScenes.has(scene.id)) {
      errors.push(`场景 ${scene.id} 缺少对应 frame`);
    }
  });

  return {
    success: errors.length === 0,
    errors,
    frame_specs: frameSpecs,
  };
}

function retimeFramesForScenes(rawFrameSpecs, sceneSpec) {
  const frameSpecs = normalizeFrameSpecs(rawFrameSpecs);
  const oldSceneStarts = new Map();
  frameSpecs.frames.forEach(frame => {
    if (!oldSceneStarts.has(frame.scene_id)) {
      oldSceneStarts.set(frame.scene_id, frame.start);
    }
    oldSceneStarts.set(frame.scene_id, Math.min(oldSceneStarts.get(frame.scene_id), frame.start));
  });

  const scenesById = sceneMap(sceneSpec);
  const sceneOrder = new Map(list(sceneSpec && sceneSpec.scenes).map(scene => [scene.id, scene.order || 0]));
  const frames = frameSpecs.frames
    .map(frame => {
      const scene = scenesById.get(frame.scene_id);
      const localStart = roundTime(frame.start - (oldSceneStarts.get(frame.scene_id) || 0));
      return {
        ...frame,
        start: scene ? roundTime(scene.start + localStart) : frame.start,
      };
    })
    .sort((left, right) => (
      (sceneOrder.get(left.scene_id) || 0) - (sceneOrder.get(right.scene_id) || 0)
      || left.order - right.order
      || left.start - right.start
    ))
    .map((frame, index) => ({ ...frame, order: index + 1 }));

  return { frames };
}

module.exports = {
  normalizeFrameSpecs,
  validateFrameSpecs,
  retimeFramesForScenes,
};
