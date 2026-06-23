const { createDiagnostic } = require('./diagnostics');
const {
  audioMatchesSceneSpec,
  computeSceneSpecSpeechHash,
} = require('../sceneSpecHash');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function stableComparableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableComparableValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.keys(value).sort().reduce((normalized, key) => {
    normalized[key] = stableComparableValue(value[key]);
    return normalized;
  }, {});
}

function normalizeCaption(value) {
  const caption = objectOrEmpty(value);
  return Object.keys(caption)
    .filter(key => key !== 'duration' && key !== 'id')
    .sort()
    .reduce((normalized, key) => {
      normalized[key] = stableComparableValue(caption[key]);
      return normalized;
    }, {});
}

function normalizeCaptions(value) {
  return JSON.stringify(arrayOrEmpty(value).map(normalizeCaption));
}

function add(diagnostics, code, userMessage, details = {}) {
  diagnostics.push({
    ...createDiagnostic({
      code,
      stage: 'timeline-consistency',
      user_message: userMessage,
      details,
      fallback_allowed: false,
    }),
    severity: 'error',
  });
}

function getNarrationText(value) {
  const record = objectOrEmpty(value);
  return record.narration_text ?? record.narrationText ?? '';
}

function getAudioPath(audio) {
  const record = objectOrEmpty(audio);
  return [
    record.path,
    record.narration_path,
    record.narrationPath,
    record.combined_path,
  ].map(value => String(value ?? '').trim())
    .find(value => value)
    || '';
}

function hasAudioPath(audio) {
  return Boolean(getAudioPath(audio));
}

function validateSceneSpecTimelineConsistency({ sceneSpec, project, audio } = {}) {
  const diagnostics = [];
  const scenes = arrayOrEmpty(objectOrEmpty(sceneSpec).scenes);
  const frames = arrayOrEmpty(objectOrEmpty(project).frames);
  const scenesById = new Map(scenes.map(scene => [String(scene.id || ''), scene]));
  const matchedFrameCounts = new Map();

  if (scenes.length === 0) {
    add(diagnostics, 'scene_spec_empty', '字幕脚本为空，无法校验旁白和画面时间轴。', {
      scene_count: scenes.length,
      frame_count: frames.length,
      has_scene_spec: Boolean(sceneSpec && typeof sceneSpec === 'object'),
    });
    return { ok: false, diagnostics };
  }

  if (frames.length !== scenes.length) {
    add(diagnostics, 'frame_scene_count_mismatch', '画面帧与字幕脚本数量不一致，无法继续渲染。', {
      expected_count: scenes.length,
      actual_count: frames.length,
    });
  }

  frames.forEach((frame, index) => {
    const sceneId = firstNonEmptyString(frame.scene_id, frame.sceneId, frame.id);
    const scene = scenesById.get(sceneId);
    if (!scene) {
      add(diagnostics, 'frame_scene_missing', '画面帧与字幕脚本不一致，无法继续渲染。', {
        frame_id: frame.id,
        scene_id: sceneId,
        index,
      });
      return;
    }
    const matchedCount = matchedFrameCounts.get(sceneId) || 0;
    if (matchedCount > 0) {
      add(diagnostics, 'frame_scene_duplicate', '画面帧重复绑定同一个字幕场景，无法继续渲染。', {
        frame_id: frame.id,
        scene_id: sceneId,
        index,
      });
    }
    matchedFrameCounts.set(sceneId, matchedCount + 1);

    const expectedSceneAtIndex = scenes[index];
    const expectedSceneId = firstNonEmptyString(expectedSceneAtIndex && expectedSceneAtIndex.id);
    if (expectedSceneId && expectedSceneId !== sceneId) {
      add(diagnostics, 'frame_scene_order_mismatch', '画面帧顺序与字幕脚本顺序不一致，无法继续渲染。', {
        index,
        expected_scene_id: expectedSceneId,
        actual_scene_id: sceneId,
        frame_id: frame.id,
      });
    }

    const actualNarration = String(getNarrationText(frame));
    const expectedNarration = String(getNarrationText(scene));
    if (actualNarration !== expectedNarration) {
      add(diagnostics, 'frame_narration_mismatch', '画面帧旁白与字幕脚本不一致，无法继续渲染。', {
        frame_id: frame.id,
        scene_id: sceneId,
        expected_narration_length: expectedNarration.length,
        actual_narration_length: actualNarration.length,
      });
    }

    const actualCaptions = arrayOrEmpty(frame.captions);
    const expectedCaptions = arrayOrEmpty(scene.captions);
    if (normalizeCaptions(actualCaptions) !== normalizeCaptions(expectedCaptions)) {
      add(diagnostics, 'frame_captions_mismatch', '画面帧字幕与字幕脚本不一致，无法继续渲染。', {
        frame_id: frame.id,
        scene_id: sceneId,
        expected_caption_count: expectedCaptions.length,
        actual_caption_count: actualCaptions.length,
      });
    }
  });

  scenes.forEach((scene, index) => {
    const sceneId = String(scene.id || '');
    if ((matchedFrameCounts.get(sceneId) || 0) === 0) {
      add(diagnostics, 'frame_scene_missing', '字幕脚本场景缺少对应画面帧，无法继续渲染。', {
        scene_id: sceneId,
        scene_index: index,
      });
    }
  });

  const audioInput = audio || objectOrEmpty(project).audio;
  if (audioInput && hasAudioPath(audioInput)) {
    if (!audioMatchesSceneSpec(audioInput, sceneSpec)) {
      const audioRecord = objectOrEmpty(audioInput);
      add(diagnostics, 'audio_scene_spec_hash_mismatch', '当前音频与字幕脚本不一致，请重新生成旁白后再渲染。', {
        expected_scene_spec_hash: computeSceneSpecSpeechHash(sceneSpec),
        audio_scene_spec_hash: audioRecord.scene_spec_hash,
        audio_source: audioRecord.source,
        audio_scene_count: audioRecord.scene_count ?? audioRecord.sceneCount,
        audio_scene_ids: arrayOrEmpty(audioRecord.scene_ids),
        audio_path_present: true,
        audio_path: getAudioPath(audioRecord),
      });
    }
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

module.exports = {
  validateSceneSpecTimelineConsistency,
};
