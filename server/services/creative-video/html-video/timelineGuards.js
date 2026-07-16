const path = require('path');

const defaultLayoutQaService = require('./layoutQaService');
const { createDiagnostic } = require('./diagnostics');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function report(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  try {
    await onProgress(event);
  } catch (_) {
    // 进度回调不能影响渲染主流程。
  }
}

function getOutputConfig(project) {
  return objectOrEmpty(project.output || project.render || {});
}

function frameHtmlAbsolutePath(projectDir, frame = {}) {
  const htmlPath = String(frame.html_path || frame.htmlPath || '').trim();
  if (!htmlPath) return '';
  return path.isAbsolute(htmlPath) ? htmlPath : path.join(projectDir, htmlPath);
}

function summarizeLayoutIssue(issue = {}) {
  return issue.message
    || issue.user_message
    || issue.code
    || '检测到文字或元素遮挡、出框、被裁切等布局问题。';
}

async function inspectProjectLayoutBeforeRender({
  projectDir,
  project,
  services = {},
  onProgress = null,
  ignoreFrameIds = [],
} = {}) {
  const layoutQaService = services.layoutQaService || defaultLayoutQaService;
  const outputConfig = getOutputConfig(project);
  const resolution = outputConfig.resolution || {};
  const frames = Array.isArray(project.frames) ? project.frames : [];
  const diagnostics = [];
  const reports = [];
  const ignoredFrames = new Set((Array.isArray(ignoreFrameIds) ? ignoreFrameIds : [])
    .map(value => String(value || '').trim())
    .filter(Boolean));

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const frameId = frame.id || frame.scene_id || `frame_${index + 1}`;
    if (ignoredFrames.has(String(frameId))) continue;
    const htmlPath = frameHtmlAbsolutePath(projectDir, frame);
    await report(onProgress, {
      type: 'html_video_layout_qa_started',
      stage: 'project',
      sub_stage: 'layout_qa',
      message: `正在检查第 ${index + 1}/${frames.length} 帧布局遮挡...`,
      frame_id: frameId,
      data: { frame_id: frameId, index, total: frames.length },
    });

    if (!htmlPath) {
      diagnostics.push(createDiagnostic({
        code: 'layout_qa_failed',
        stage: 'project',
        sub_stage: 'layout_qa',
        frame_id: frameId,
        user_message: `第 ${index + 1} 帧缺少 HTML 文件，无法进行布局检查。`,
        retryable: true,
        repair_action: 'retry_frame_html',
        fallback_allowed: false,
        details: { frame_id: frameId },
      }));
      continue;
    }

    let layoutQa;
    try {
      layoutQa = await layoutQaService.inspectFrameHtmlLayout({
        htmlPath,
        frame,
        resolution,
        durationSec: frame.duration_sec ?? frame.durationSec,
      });
    } catch (error) {
      diagnostics.push(createDiagnostic({
        code: 'layout_qa_failed',
        stage: 'project',
        sub_stage: 'layout_qa',
        frame_id: frameId,
        user_message: `第 ${index + 1} 帧布局检查失败：${error.message || '未知错误'}`,
        retryable: true,
        repair_action: 'retry_frame_html',
        fallback_allowed: false,
        details: { frame_id: frameId, error: error.message || String(error) },
      }));
      continue;
    }

    reports.push({ frame_id: frameId, ...layoutQa });
    if (!layoutQa.success) {
      diagnostics.push(createDiagnostic({
        code: 'layout_qa_failed',
        stage: 'project',
        sub_stage: 'layout_qa',
        frame_id: frameId,
        user_message: `第 ${index + 1} 帧布局检查未通过：${summarizeLayoutIssue(layoutQa.issues?.[0])}`,
        retryable: true,
        repair_action: 'retry_frame_html',
        fallback_allowed: false,
        details: {
          frame_id: frameId,
          html_path: frame.html_path || frame.htmlPath || '',
          issues: layoutQa.issues || [],
          metrics: layoutQa.metrics || {},
        },
      }));
    }

    await report(onProgress, {
      type: 'html_video_layout_qa_done',
      stage: 'project',
      sub_stage: 'layout_qa',
      message: layoutQa.success
        ? `第 ${index + 1}/${frames.length} 帧布局检查通过。`
        : `第 ${index + 1}/${frames.length} 帧布局检查发现遮挡问题。`,
      frame_id: frameId,
      data: { frame_id: frameId, layout_qa: layoutQa },
    });
  }

  return {
    success: diagnostics.length === 0,
    diagnostics,
    reports,
  };
}

function expectedDurationSec(project) {
  return (Array.isArray(project.frames) ? project.frames : [])
    .reduce((total, frame) => total + Number(frame.duration_sec || frame.durationSec || 0), 0);
}

function roundDuration(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function maxCaptionEndSec(frame) {
  return (Array.isArray(frame?.captions) ? frame.captions : [])
    .reduce((max, caption) => Math.max(max, Number(caption?.end ?? caption?.end_sec ?? 0) || 0), 0);
}

function isDurationLocked(project) {
  const output = objectOrEmpty(project?.output);
  return output.duration_locked === true || output.lock_duration === true;
}

function syncTimelineDuration(project, frame, durationSec) {
  const timeline = objectOrEmpty(project?.timeline);
  for (const track of Array.isArray(timeline.tracks) ? timeline.tracks : []) {
    for (const item of Array.isArray(track?.items) ? track.items : []) {
      if (
        item.id === frame.id
        || item.frame_id === frame.id
        || item.ref === frame.id
        || (frame.scene_id && item.scene_id === frame.scene_id)
      ) {
        item.duration_sec = durationSec;
        if (item.duration != null) item.duration = durationSec;
      }
    }
  }
}

function retimeTimelineStarts(project) {
  const timeline = objectOrEmpty(project?.timeline);
  const frames = Array.isArray(project?.frames) ? project.frames : [];
  const frameStarts = new Map();
  let cursor = 0;
  for (const frame of frames) {
    frameStarts.set(frame.id, roundDuration(cursor));
    if (frame.scene_id) frameStarts.set(frame.scene_id, roundDuration(cursor));
    cursor += Number(frame.duration_sec || frame.durationSec || 0);
  }

  for (const track of Array.isArray(timeline.tracks) ? timeline.tracks : []) {
    for (const item of Array.isArray(track?.items) ? track.items : []) {
      const start = frameStarts.get(item.frame_id) ?? frameStarts.get(item.ref) ?? frameStarts.get(item.scene_id);
      if (start != null) {
        item.start_sec = start;
        if (item.start != null) item.start = start;
      }
    }
  }
}

function fitFrameDurationsToCaptions(project, toleranceSec = 0.2) {
  const diagnostics = [];
  const locked = isDurationLocked(project);
  let changed = false;
  for (const frame of Array.isArray(project?.frames) ? project.frames : []) {
    const duration = Number(frame.duration_sec ?? frame.durationSec ?? frame.duration ?? 0);
    const captionEnd = maxCaptionEndSec(frame);
    if (Number.isFinite(duration) && duration > 0 && captionEnd > duration + toleranceSec) {
      if (locked) {
        diagnostics.push(createDiagnostic({
          code: 'caption_duration_exceeds_frame',
          stage: 'timeline-consistency',
          sub_stage: 'timeline_check',
          user_message: '字幕时间超过锁定的画面时长，无法继续渲染。请缩短旁白或解除固定时长。',
          frame_id: frame.id || frame.scene_id || '',
          details: {
            frame_id: frame.id || frame.scene_id || '',
            duration_sec: duration,
            caption_end_sec: captionEnd,
            diff_sec: roundDuration(captionEnd - duration),
            duration_locked: true,
          },
          fallback_allowed: false,
        }));
        continue;
      }

      const diff = captionEnd - duration;
      const tooLarge = diff > 8 || captionEnd > duration * 2 || captionEnd > 30;
      if (tooLarge) {
        diagnostics.push(createDiagnostic({
          code: 'caption_duration_exceeds_reasonable_frame',
          stage: 'timeline-consistency',
          sub_stage: 'timeline_check',
          user_message: '字幕时间异常超出画面时长，已停止渲染。请重新生成该段配音或缩短字幕时间。',
          frame_id: frame.id || frame.scene_id || '',
          retryable: true,
          repair_action: 'retry_frame_html',
          details: {
            frame_id: frame.id || frame.scene_id || '',
            duration_sec: duration,
            caption_end_sec: roundDuration(captionEnd),
            diff_sec: roundDuration(diff),
          },
          fallback_allowed: false,
        }));
        continue;
      }

      const nextDuration = roundDuration(captionEnd);
      frame.duration_sec = nextDuration;
      if (frame.durationSec != null) frame.durationSec = nextDuration;
      if (frame.duration != null) frame.duration = nextDuration;
      syncTimelineDuration(project, frame, nextDuration);
      changed = true;
      diagnostics.push(createDiagnostic({
        code: 'frame_duration_auto_extended',
        stage: 'timeline-consistency',
        sub_stage: 'timeline_check',
        severity: 'warning',
        user_message: '已按字幕时长自动延长画面帧。',
        frame_id: frame.id || frame.scene_id || '',
        details: {
          frame_id: frame.id || frame.scene_id || '',
          previous_duration_sec: duration,
          duration_sec: nextDuration,
          caption_end_sec: roundDuration(captionEnd),
          diff_sec: roundDuration(captionEnd - duration),
        },
        fallback_allowed: true,
      }));
    }
  }
  if (changed) retimeTimelineStarts(project);
  return {
    ok: !diagnostics.some(item => item.fallback_allowed === false),
    changed,
    diagnostics,
  };
}

function validateReasonableTimelineDuration(project, options = {}) {
  const actual = expectedDurationSec(project);
  const hasExplicitTarget = Object.prototype.hasOwnProperty.call(options, 'targetDurationSec');
  const target = Number(hasExplicitTarget
    ? options.targetDurationSec
    : (
      project?.target?.duration_sec
      ?? project?.output?.duration
      ?? 0
  ));
  if (!Number.isFinite(target) || target <= 0) return { ok: true, duration_sec: actual };
  const softAllowed = Math.max(target * 1.5, target + 30);
  const grace = Math.max(5, Math.min(target * 0.5, 30));
  const allowed = softAllowed + grace;
  if (actual > allowed) {
    return {
      ok: false,
      code: 'timeline_duration_unreasonable',
      message: `视频时间轴异常：目标 ${target.toFixed(2)} 秒，当前 ${actual.toFixed(2)} 秒。`,
      target_duration_sec: target,
      duration_sec: actual,
      soft_allowed_duration_sec: softAllowed,
      grace_duration_sec: grace,
      allowed_duration_sec: allowed,
    };
  }
  return {
    ok: true,
    target_duration_sec: target,
    duration_sec: actual,
    soft_allowed_duration_sec: softAllowed,
    grace_duration_sec: grace,
    allowed_duration_sec: allowed,
    within_grace_duration: actual > softAllowed,
  };
}

function resolveTargetDurationSec(project, targetDurationSec) {
  const rawTarget = targetDurationSec ?? project?.target?.duration_sec;
  const parsed = Number(rawTarget);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

module.exports = {
  objectOrEmpty,
  report,
  getOutputConfig,
  inspectProjectLayoutBeforeRender,
  expectedDurationSec,
  fitFrameDurationsToCaptions,
  validateReasonableTimelineDuration,
  resolveTargetDurationSec,
};
