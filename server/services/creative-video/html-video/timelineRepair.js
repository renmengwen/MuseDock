const requiredNarration = require('../../hyperframes/requiredNarrationLiterals');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function roundDuration(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function readDuration(record) {
  const input = objectOrEmpty(record);
  for (const key of ['duration_sec', 'durationSec', 'duration', 'actual_duration_sec', 'audio_duration_sec']) {
    const value = Number(input[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const sceneTotal = arrayOrEmpty(input.scenes).reduce((total, scene) => total + (readDuration(scene) || 0), 0);
  if (sceneTotal > 0) return sceneTotal;
  return null;
}

function frameDuration(frame) {
  const duration = Number(frame?.duration_sec ?? frame?.durationSec ?? frame?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function timelineDurationSec(project) {
  const frames = arrayOrEmpty(objectOrEmpty(project).frames);
  if (frames.length) {
    return roundDuration(frames.reduce((total, frame) => total + frameDuration(frame), 0));
  }
  return roundDuration(arrayOrEmpty(objectOrEmpty(objectOrEmpty(project).timeline).tracks)
    .flatMap(track => arrayOrEmpty(track?.items))
    .reduce((total, item) => total + frameDuration(item), 0));
}

function resolveTargetDuration(project, targetDurationSec) {
  const input = objectOrEmpty(project);
  const target = Number(targetDurationSec ?? input.target?.duration_sec ?? input.output?.duration);
  return Number.isFinite(target) && target > 0 ? target : null;
}

function analyzeTimelineMismatch({
  project,
  sceneSpec,
  targetDurationSec,
  audioManifest,
} = {}) {
  void sceneSpec;
  const target = resolveTargetDuration(project, targetDurationSec);
  const timelineDuration = timelineDurationSec(project);
  const audioDuration = readDuration(audioManifest || objectOrEmpty(project).audio);
  if (!target) {
    return {
      ok: true,
      target_duration_sec: null,
      frame_duration_sec: timelineDuration,
      timeline_duration_sec: timelineDuration,
      audio_duration_sec: audioDuration,
      requires_script_repair: false,
      repair_action: '',
    };
  }

  if (audioDuration != null && audioDuration > target) {
    return {
      ok: false,
      code: 'timeline_duration_unreasonable',
      target_duration_sec: roundDuration(target),
      frame_duration_sec: timelineDuration,
      timeline_duration_sec: timelineDuration,
      audio_duration_sec: roundDuration(audioDuration),
      requires_script_repair: true,
      repair_action: 'repair_script_and_timeline',
      message: `旁白时长超过目标：目标 ${target.toFixed(2)} 秒，旁白 ${audioDuration.toFixed(2)} 秒。`,
    };
  }

  if (timelineDuration > target) {
    return {
      ok: false,
      code: 'timeline_duration_unreasonable',
      target_duration_sec: roundDuration(target),
      frame_duration_sec: timelineDuration,
      timeline_duration_sec: timelineDuration,
      audio_duration_sec: audioDuration == null ? null : roundDuration(audioDuration),
      requires_script_repair: false,
      repair_action: 'repair_timeline',
      message: `时间轴时长超过目标：目标 ${target.toFixed(2)} 秒，当前 ${timelineDuration.toFixed(2)} 秒。`,
    };
  }

  return {
    ok: true,
    target_duration_sec: roundDuration(target),
    frame_duration_sec: timelineDuration,
    timeline_duration_sec: timelineDuration,
    audio_duration_sec: audioDuration == null ? null : roundDuration(audioDuration),
    requires_script_repair: false,
    repair_action: '',
  };
}

function sceneDuration(scene) {
  const duration = Number(scene?.duration_sec ?? scene?.durationSec ?? scene?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function shortenText(text, ratio) {
  const value = String(text ?? '');
  if (!value || ratio >= 1) return value;
  const limit = Math.max(1, Math.floor(value.length * ratio));
  return value.length > limit ? value.slice(0, limit).trim() : value;
}

function compressNarrationForTarget(sceneSpec, targetDurationSec) {
  const nextSceneSpec = clone(objectOrEmpty(sceneSpec));
  const scenes = arrayOrEmpty(nextSceneSpec.scenes);
  const target = Number(targetDurationSec);
  const totalDuration = scenes.reduce((total, scene) => total + sceneDuration(scene), 0);
  const ratio = Number.isFinite(target) && target > 0 && totalDuration > target
    ? target / totalDuration
    : 1;

  nextSceneSpec.scenes = scenes.map(scene => {
    const nextScene = clone(scene);
    if (Object.prototype.hasOwnProperty.call(nextScene, 'narration_text')) {
      nextScene.narration_text = shortenText(nextScene.narration_text, ratio);
    }
    if (Object.prototype.hasOwnProperty.call(nextScene, 'narrationText')) {
      nextScene.narrationText = shortenText(nextScene.narrationText, ratio);
    }
    if (Array.isArray(nextScene.captions)) {
      nextScene.captions = nextScene.captions.map(caption => {
        const nextCaption = clone(caption);
        if (Object.prototype.hasOwnProperty.call(nextCaption, 'text')) {
          nextCaption.text = shortenText(nextCaption.text, ratio);
        }
        return nextCaption;
      });
    }
    return nextScene;
  });
  const requiredLiteralValidation = requiredNarration.validateRequiredNarrationLiterals(
    nextSceneSpec.scenes,
    nextSceneSpec.required_narration_literals,
  );
  if (!requiredLiteralValidation.ok) {
    return {
      success: false,
      code: requiredLiteralValidation.code,
      message: `${requiredLiteralValidation.message} 已拒绝可能破坏原句的恢复截断，请重新生成压缩旁白。`,
      missing: requiredLiteralValidation.missing,
    };
  }
  return nextSceneSpec;
}

function scaledDurations(frames, targetDurationSec) {
  const target = Number(targetDurationSec);
  const current = frames.reduce((total, frame) => total + frameDuration(frame), 0);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(current) || current <= 0 || current <= target) {
    return frames.map(frame => roundDuration(frameDuration(frame)));
  }
  const scale = target / current;
  let used = 0;
  return frames.map((frame, index) => {
    if (index === frames.length - 1) {
      return roundDuration(Math.max(0.001, target - used));
    }
    const duration = roundDuration(frameDuration(frame) * scale);
    used = roundDuration(used + duration);
    return duration;
  });
}

function setDuration(record, duration) {
  if (!record || typeof record !== 'object') return;
  record.duration_sec = duration;
  if (Object.prototype.hasOwnProperty.call(record, 'durationSec')) record.durationSec = duration;
  if (Object.prototype.hasOwnProperty.call(record, 'duration')) record.duration = duration;
}

function scaleCaptions(frame, scale) {
  if (!frame || typeof frame !== 'object' || !Array.isArray(frame.captions) || !Number.isFinite(scale) || scale <= 0) return;
  frame.captions = frame.captions.map(caption => {
    const nextCaption = clone(caption);
    for (const key of ['start', 'start_sec', 'end', 'end_sec', 'duration', 'duration_sec']) {
      if (!Object.prototype.hasOwnProperty.call(nextCaption, key)) continue;
      const value = Number(nextCaption[key]);
      if (Number.isFinite(value) && value >= 0) {
        nextCaption[key] = roundDuration(value * scale);
      }
    }
    return nextCaption;
  });
}

function matchFrame(frame, item) {
  return item.id === frame.id
    || item.frame_id === frame.id
    || item.ref === frame.id
    || item.scene_id === frame.scene_id
    || item.id === frame.scene_id
    || item.frame_id === frame.scene_id
    || item.ref === frame.scene_id;
}

function syncTimeline(project, frames, durations) {
  let cursor = 0;
  const tracks = arrayOrEmpty(objectOrEmpty(project.timeline).tracks);
  frames.forEach((frame, index) => {
    const duration = durations[index];
    for (const track of tracks) {
      for (const item of arrayOrEmpty(track.items)) {
        if (!matchFrame(frame, item)) continue;
        setDuration(item, duration);
        item.start_sec = roundDuration(cursor);
        if (Object.prototype.hasOwnProperty.call(item, 'start')) item.start = roundDuration(cursor);
      }
    }
    cursor += duration;
  });
}

function syncContentGraph(project, frames, durations) {
  const nodes = arrayOrEmpty(objectOrEmpty(project.content_graph).nodes);
  frames.forEach((frame, index) => {
    const node = nodes.find(item => item.id === frame.id || item.id === frame.scene_id || item.scene_id === frame.scene_id)
      || nodes[index];
    if (!node) return;
    const duration = durations[index];
    node.durationSec = duration;
    if (Object.prototype.hasOwnProperty.call(node, 'duration_sec')) node.duration_sec = duration;
    if (Object.prototype.hasOwnProperty.call(node, 'duration')) node.duration = duration;
  });
}

function repairProjectTimeline({
  project,
  sceneSpec,
  targetDurationSec,
  audioManifest,
} = {}) {
  const nextProject = clone(objectOrEmpty(project));
  const frames = arrayOrEmpty(nextProject.frames);
  const analysis = analyzeTimelineMismatch({
    project: nextProject,
    sceneSpec,
    targetDurationSec,
    audioManifest,
  });
  const target = resolveTargetDuration(nextProject, targetDurationSec);
  if (!frames.length || !target) {
    return { ok: true, project: nextProject, analysis, diagnostics: [] };
  }

  const previousDurations = frames.map(frame => frameDuration(frame));
  const durations = scaledDurations(frames, target);
  frames.forEach((frame, index) => {
    const previous = previousDurations[index];
    const next = durations[index];
    setDuration(frame, next);
    if (previous > 0) scaleCaptions(frame, next / previous);
  });
  syncTimeline(nextProject, frames, durations);
  syncContentGraph(nextProject, frames, durations);

  return {
    ok: true,
    project: nextProject,
    analysis,
    diagnostics: [],
  };
}

module.exports = {
  analyzeTimelineMismatch,
  compressNarrationForTarget,
  repairProjectTimeline,
};
