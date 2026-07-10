const { createDiagnostic } = require('./diagnostics');
const {
  audioMatchesSceneSpec,
  computeSceneSpecSpeechHash,
} = require('../sceneSpecHash');
const { normalizeCaptionsForFrame, sliceCaptionsToWindow } = require('./captionLayer');

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

function comparableFrameCaptions(frame = {}, scene = {}) {
  return normalizeCaptionsForFrame({
    id: frame.id || scene.id,
    scene_id: frame.scene_id || scene.id,
    duration_sec: frame.duration_sec || scene.duration,
    narration_text: frame.narration_text,
    captions: frame.captions,
  });
}

function comparableSceneCaptions(scene = {}, frame = {}) {
  return normalizeCaptionsForFrame({
    id: scene.id || frame.id,
    scene_id: scene.id || frame.scene_id,
    duration_sec: frame.duration_sec || scene.duration,
    narration_text: scene.narration_text,
    captions: scene.captions,
  });
}

function add(diagnostics, code, userMessage, details = {}) {
  const inputDetails = objectOrEmpty(details);
  diagnostics.push({
    ...createDiagnostic({
      code,
      stage: 'timeline-consistency',
      sub_stage: 'timeline_check',
      frame_id: inputDetails.frame_id || '',
      user_message: userMessage,
      details: inputDetails,
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

function frameBeatId(frame = {}) {
  return firstNonEmptyString(frame.beat_id, frame.beatId);
}

function frameDurationSec(frame = {}) {
  const number = Number(frame.duration_sec ?? frame.durationSec ?? frame.duration);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

// 帧按 scene 分组（保持出现顺序）；beat 展开后同一场景允许多帧，但必须连续出现
function groupFramesByScene(frames = []) {
  const groups = [];
  frames.forEach((frame, index) => {
    const sceneId = firstNonEmptyString(frame.scene_id, frame.sceneId, frame.id);
    const last = groups[groups.length - 1];
    if (last && last.scene_id === sceneId) {
      last.entries.push({ frame, index });
      return;
    }
    groups.push({ scene_id: sceneId, entries: [{ frame, index }] });
  });
  return groups;
}

function validateSceneSpecTimelineConsistency({ sceneSpec, project, audio, mediaOptions = {} } = {}) {
  const diagnostics = [];
  const scenes = arrayOrEmpty(objectOrEmpty(sceneSpec).scenes);
  const frames = arrayOrEmpty(objectOrEmpty(project).frames);
  const scenesById = new Map(scenes.map(scene => [String(scene.id || ''), scene]));
  const checkCaptions = mediaOptions?.generateCaptions !== false;
  const checkAudio = mediaOptions?.generateAudio !== false;

  if (scenes.length === 0) {
    add(diagnostics, 'scene_spec_empty', '字幕脚本为空，无法校验旁白和画面时间轴。', {
      scene_count: scenes.length,
      frame_count: frames.length,
      has_scene_spec: Boolean(sceneSpec && typeof sceneSpec === 'object'),
    });
    return { ok: false, diagnostics };
  }

  const groups = groupFramesByScene(frames);
  const seenSceneIds = new Set();

  if (groups.length !== scenes.length) {
    add(diagnostics, 'frame_scene_count_mismatch', '画面帧与字幕脚本数量不一致，无法继续渲染。', {
      expected_count: scenes.length,
      actual_count: groups.length,
      frame_count: frames.length,
    });
  }

  groups.forEach((group, groupIndex) => {
    const sceneId = group.scene_id;
    const firstEntry = group.entries[0];
    if (seenSceneIds.has(sceneId)) {
      add(diagnostics, 'frame_scene_duplicate', '画面帧重复绑定同一个字幕场景，无法继续渲染。', {
        frame_id: firstEntry.frame.id,
        scene_id: sceneId,
        index: firstEntry.index,
      });
      return;
    }
    seenSceneIds.add(sceneId);

    const scene = scenesById.get(sceneId);
    if (!scene) {
      for (const { frame, index } of group.entries) {
        add(diagnostics, 'frame_scene_missing', '画面帧与字幕脚本不一致，无法继续渲染。', {
          frame_id: frame.id,
          scene_id: sceneId,
          index,
        });
      }
      return;
    }

    // 同一场景多帧仅允许 beat 展开帧（每帧带唯一 beat_id），否则视为重复绑定
    if (group.entries.length > 1) {
      const beatIds = new Set();
      group.entries.forEach(({ frame, index }, entryIndex) => {
        const beatId = frameBeatId(frame);
        if ((!beatId && entryIndex > 0) || (beatId && beatIds.has(beatId))) {
          add(diagnostics, 'frame_scene_duplicate', '画面帧重复绑定同一个字幕场景，无法继续渲染。', {
            frame_id: frame.id,
            scene_id: sceneId,
            index,
            ...(beatId ? { beat_id: beatId } : {}),
          });
        }
        if (beatId) beatIds.add(beatId);
      });
    }

    const expectedSceneAtIndex = scenes[groupIndex];
    const expectedSceneId = firstNonEmptyString(expectedSceneAtIndex && expectedSceneAtIndex.id);
    if (expectedSceneId && expectedSceneId !== sceneId) {
      add(diagnostics, 'frame_scene_order_mismatch', '画面帧顺序与字幕脚本顺序不一致，无法继续渲染。', {
        index: firstEntry.index,
        expected_scene_id: expectedSceneId,
        actual_scene_id: sceneId,
        frame_id: firstEntry.frame.id,
      });
    }

    const expectedNarration = String(getNarrationText(scene));
    for (const { frame } of group.entries) {
      const actualNarration = String(getNarrationText(frame));
      if (actualNarration !== expectedNarration) {
        add(diagnostics, 'frame_narration_mismatch', '画面帧旁白与字幕脚本不一致，无法继续渲染。', {
          frame_id: frame.id,
          scene_id: sceneId,
          expected_narration_length: expectedNarration.length,
          actual_narration_length: actualNarration.length,
        });
      }
    }

    if (checkCaptions) {
      const beatExpanded = group.entries.some(({ frame }) => Boolean(frameBeatId(frame)));
      if (!beatExpanded) {
        const frame = firstEntry.frame;
        const actualCaptions = comparableFrameCaptions(frame, scene);
        const expectedCaptions = comparableSceneCaptions(scene, frame);
        if (normalizeCaptions(actualCaptions) !== normalizeCaptions(expectedCaptions)) {
          add(diagnostics, 'frame_captions_mismatch', '画面帧字幕与字幕脚本不一致，无法继续渲染。', {
            frame_id: frame.id,
            scene_id: sceneId,
            expected_caption_count: expectedCaptions.length,
            actual_caption_count: actualCaptions.length,
          });
        }
      } else {
        // beat 展开帧：整场景字幕按 beat 窗口切片后应与各帧字幕一致（与建帧侧共用同一切窗算法）
        const sceneDurationSec = group.entries.reduce((total, { frame }) => total + frameDurationSec(frame), 0);
        const sceneCaptions = normalizeCaptionsForFrame({
          id: scene.id || sceneId,
          scene_id: sceneId,
          duration_sec: sceneDurationSec,
          narration_text: scene.narration_text,
          captions: scene.captions,
        });
        let offsetSec = 0;
        for (const { frame } of group.entries) {
          const durationSec = frameDurationSec(frame);
          const expectedCaptions = normalizeCaptionsForFrame({
            id: frame.id || sceneId,
            scene_id: sceneId,
            duration_sec: durationSec,
            narration_text: scene.narration_text,
            captions: sliceCaptionsToWindow(sceneCaptions, offsetSec, durationSec),
          });
          const actualCaptions = comparableFrameCaptions(frame, scene);
          if (normalizeCaptions(actualCaptions) !== normalizeCaptions(expectedCaptions)) {
            add(diagnostics, 'frame_captions_mismatch', '画面帧字幕与字幕脚本不一致，无法继续渲染。', {
              frame_id: frame.id,
              scene_id: sceneId,
              beat_id: frameBeatId(frame),
              expected_caption_count: expectedCaptions.length,
              actual_caption_count: actualCaptions.length,
            });
          }
          offsetSec += durationSec;
        }
      }
    }
  });

  scenes.forEach((scene, index) => {
    const sceneId = String(scene.id || '');
    if (!seenSceneIds.has(sceneId)) {
      add(diagnostics, 'frame_scene_missing', '字幕脚本场景缺少对应画面帧，无法继续渲染。', {
        scene_id: sceneId,
        scene_index: index,
      });
    }
  });

  const audioInput = audio || objectOrEmpty(project).audio;
  if (checkAudio && audioInput && hasAudioPath(audioInput)) {
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
