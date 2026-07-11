const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const defaultMaterializer = require('./materializer');
const defaultFrameRenderer = require('./frameRenderer');
const defaultLayoutQaService = require('./layoutQaService');
const defaultFfmpegComposer = require('./ffmpegComposer');
const projectStore = require('./projectStore');
const { addExport, addRevision, saveProject, createProjectDir } = projectStore;
const { normalizeProject, markCheckpointFrame, markCheckpointStage } = require('./projectSchema');
const { createDiagnostic, normalizeDiagnostics } = require('./diagnostics');
const { findFrameByAnyId, canonicalFrameId, sanitizePathSegment } = require('./frameIdentity');
const { findDraft } = require('./htmlVideoDraftService');
const { analyzeTimelineMismatch } = require('./timelineRepair');
const sfxEventService = require('./sfxEventService');

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
} = {}) {
  const layoutQaService = services.layoutQaService || defaultLayoutQaService;
  const outputConfig = getOutputConfig(project);
  const resolution = outputConfig.resolution || {};
  const frames = Array.isArray(project.frames) ? project.frames : [];
  const diagnostics = [];
  const reports = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const frameId = frame.id || frame.scene_id || `frame_${index + 1}`;
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

async function fileHash(filePath) {
  try {
    return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
  } catch {
    return '';
  }
}

function markRenderCheckpoint(project, sceneId, patch = {}) {
  return markCheckpointFrame(project, 'render', sceneId, patch);
}

// 渲染检查点键：旧工程帧与场景 1:1（frame.id === scene_id），沿用 scene_id 优先；
// beat 展开帧同场景有多帧，必须按帧（beat）唯一键控，否则合成会重复取同一段 mp4；
// scene_html 的 scene 级帧（id = scene:<scene_id>、beat_id 为空）必须按 frame.id 键控，
// 否则会错位成 scene_id 与 frameHtmlPhase/retry 的 scene:<id> 键对不上（R2）。
function renderCheckpointKey(frame = {}) {
  const frameId = String(frame.id || '').trim();
  if (frameId.startsWith('scene:')) return frameId;
  const beatId = String(frame.beat_id || frame.beatId || '').trim();
  if (beatId) return String(frame.id || beatId).trim();
  return String(frame.scene_id || frame.id || '').trim();
}

function markComposeCheckpoint(project, patch = {}) {
  return markCheckpointStage(project, 'compose', patch);
}

function markDurationVerifyCheckpoint(project, patch = {}) {
  return markCheckpointStage(project, 'duration_verify', patch);
}

function markVisualInspectCheckpoint(project, patch = {}) {
  return markCheckpointStage(project, 'visual_inspect', patch);
}

function relativeProjectPath(projectDir, filePath) {
  return path.relative(projectDir, filePath).replace(/\\/g, '/');
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

async function resolveNarrationPath(project, projectDir, ffmpegComposer, diagnostics) {
  if (project.audio?.narration_path) {
    return path.isAbsolute(project.audio.narration_path)
      ? project.audio.narration_path
      : path.join(projectDir, project.audio.narration_path);
  }
  const manifestPath = project.audio?.tts_manifest_path;
  if (!manifestPath) return null;
  const absoluteManifestPath = path.isAbsolute(manifestPath) ? manifestPath : path.join(projectDir, manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(absoluteManifestPath, 'utf8'));
  } catch (error) {
    diagnostics.push(createDiagnostic({
      code: 'tts_manifest_missing',
      stage: 'compose',
      sub_stage: 'compose',
      user_message: `读取旁白音频清单失败：${error.message}`,
      retryable: true,
      repair_action: 'retry_compose',
      details: { manifest_path: manifestPath },
    }));
    return null;
  }
  const sceneFiles = (Array.isArray(manifest.scenes) ? manifest.scenes : [])
    .map(scene => scene.path || (scene.relative_path ? path.join(projectDir, scene.relative_path) : null))
    .filter(Boolean)
    .map(filePath => ({ path: path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath) }));
  if (!sceneFiles.length) return null;
  if (typeof ffmpegComposer.concatAudioWithFfmpeg !== 'function') return sceneFiles[0].path;
  const outputPath = path.join(projectDir, 'exports', 'narration-track.mp3');
  const concat = await ffmpegComposer.concatAudioWithFfmpeg(sceneFiles, outputPath, projectDir);
  if (!concat.success) {
    diagnostics.push(createDiagnostic({
      code: 'compose_failed',
      stage: 'compose',
      sub_stage: 'compose',
      user_message: concat.message || '旁白音频拼接失败。',
      retryable: true,
      repair_action: 'retry_compose',
      details: { stderr: concat.stderr },
    }));
    return null;
  }
  return concat.output_path || outputPath;
}

function collectRenderedFramesFromProject(project, projectDir) {
  const renderedFrames = [];
  const checkpointFrames = objectOrEmpty(project?.generation_checkpoint?.stages?.render?.frames);
  for (const frame of Array.isArray(project?.frames) ? project.frames : []) {
    const frameId = frame.id || frame.scene_id || '';
    const checkpointKey = renderCheckpointKey(frame);
    const checkpoint = objectOrEmpty(checkpointFrames[checkpointKey] || checkpointFrames[frameId]);
    if (checkpoint.status !== 'done') continue;
    const mp4Path = String(checkpoint.mp4_path || frame.mp4_path || frame.preview_mp4_path || '').trim();
    if (!mp4Path) continue;
    renderedFrames.push({
      path: path.isAbsolute(mp4Path) ? mp4Path : path.join(projectDir, mp4Path),
      engine: frame.engine,
      encoding: frame.encoding || checkpoint.encoding,
      frame_id: frameId,
    });
  }
  return renderedFrames;
}

function missingRenderedFrameIds(project) {
  const missing = [];
  const checkpointFrames = objectOrEmpty(project?.generation_checkpoint?.stages?.render?.frames);
  for (const frame of Array.isArray(project?.frames) ? project.frames : []) {
    const frameId = frame.id || frame.scene_id || '';
    const checkpointKey = renderCheckpointKey(frame);
    const checkpoint = objectOrEmpty(checkpointFrames[checkpointKey] || checkpointFrames[frameId]);
    const mp4Path = String(checkpoint.mp4_path || frame.mp4_path || frame.preview_mp4_path || '').trim();
    if (checkpoint.status !== 'done' || !mp4Path) {
      missing.push(checkpointKey || frameId);
    }
  }
  return missing.filter(Boolean);
}

async function ensureProjectDir({ rootDir, workflowId, runId, projectDir }) {
  if (projectDir) return projectDir;
  return createProjectDir({ rootDir, workflowId, runId });
}

async function createProject({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
} = {}) {
  const resolvedProjectDir = await ensureProjectDir({ rootDir, workflowId, runId, projectDir });
  const nextProject = normalizeProject(project);
  await saveProject(resolvedProjectDir, nextProject);
  return {
    success: true,
    project: nextProject,
    project_dir: resolvedProjectDir,
    html_video_project_path: resolvedProjectDir,
  };
}

async function materializeProject({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
  templateRegistry,
  services = {},
} = {}) {
  const materializer = services.materializer || defaultMaterializer;
  const resolvedProjectDir = await ensureProjectDir({ rootDir, workflowId, runId, projectDir });
  const materialized = await materializer.materializeProject({
    projectDir: resolvedProjectDir,
    project: normalizeProject(project),
    templateRegistry,
  });
  const nextProject = normalizeProject(materialized.project);
  await saveProject(resolvedProjectDir, nextProject);
  return {
    success: true,
    project: nextProject,
    project_dir: resolvedProjectDir,
    html_video_project_path: resolvedProjectDir,
    diagnostics: normalizeDiagnostics(materialized.diagnostics, { stage: 'materialize' }),
  };
}

async function renderHtmlVideoFrames({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
  frameIds,
  templateRegistry,
  services = {},
  onProgress = null,
  materialize = false,
} = {}) {
  const materializer = services.materializer || defaultMaterializer;
  const frameRenderer = services.frameRenderer || defaultFrameRenderer;
  const resolvedProjectDir = await ensureProjectDir({ rootDir, workflowId, runId, projectDir });
  let nextProject = normalizeProject(project);
  const diagnostics = [];

  if (materialize) {
    const materialized = await materializer.materializeProject({
      projectDir: resolvedProjectDir,
      project: nextProject,
      templateRegistry,
    });
    nextProject = normalizeProject(materialized.project);
    diagnostics.push(...normalizeDiagnostics(materialized.diagnostics, { stage: 'materialize' }));
  }
  await saveProject(resolvedProjectDir, nextProject);

  const outputConfig = getOutputConfig(nextProject);
  const allFrames = Array.isArray(nextProject.frames) ? nextProject.frames : [];
  const requestedFrameIds = (Array.isArray(frameIds) ? frameIds : (frameIds ? [frameIds] : []))
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const requested = new Set(requestedFrameIds);
  const frames = requested.size
    ? allFrames.filter(frame => requested.has(String(frame.id || '')) || requested.has(String(frame.scene_id || '')))
    : allFrames;
  if (requested.size) {
    const matched = new Set(frames.flatMap(frame => [String(frame.id || ''), String(frame.scene_id || '')].filter(Boolean)));
    const missing = requestedFrameIds.filter(id => !matched.has(id));
    if (missing.length) {
      const diagnostic = createDiagnostic({
        code: 'frame_not_found',
        stage: 'render',
        sub_stage: 'render',
        user_message: `未找到要渲染的帧：${missing.join(', ')}。`,
        retryable: false,
        details: { frame_ids: missing },
      });
      return {
        success: false,
        message: diagnostic.user_message,
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        rendered_frames: [],
        diagnostics: [diagnostic],
      };
    }
  }
  const renderedFrames = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const allFrameIndex = allFrames.indexOf(frame);
    const progressIndex = allFrameIndex >= 0 ? allFrameIndex : index;
    const frameId = frame.id || frame.scene_id || `frame_${progressIndex + 1}`;
    const checkpointKey = renderCheckpointKey(frame) || frameId;
    // scene_html 的帧 id 带 ':'（scene:<id>），Windows 文件名非法，落盘名统一净化；
    // 既有 beat/scene id 只含字母数字下划线，sanitize 为恒等变换，输出文件名不变
    const outputName = sanitizePathSegment(frame.id || frame.scene_id || frameId);
    const frameOutput = path.join(resolvedProjectDir, 'frames', `${outputName}.mp4`);
    const rendered = await frameRenderer.renderFrame(frame, {
      projectDir: resolvedProjectDir,
      project: nextProject,
      outputPath: frameOutput,
      resolution: outputConfig.resolution,
      fps: outputConfig.fps,
      onProgress: progress => report(onProgress, {
        type: 'html_video_frame_render_progress',
        stage: 'project',
        sub_stage: 'render',
        message: progress?.message || `正在渲染第 ${progressIndex + 1}/${allFrames.length} 帧...`,
        frame_id: frameId,
        frame_progress: progress?.percent,
        data: {
          frame_id: frameId,
          index: progressIndex,
          total: allFrames.length,
          percent: progress?.percent,
        },
      }),
    });
    diagnostics.push(...normalizeDiagnostics(rendered.diagnostics, {
      stage: 'render',
      sub_stage: 'render',
      frame_id: frameId,
      details: { frame_id: frameId },
    }));
    if (!rendered.success) {
      nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
        markRenderCheckpoint(current, checkpointKey, {
          status: 'failed',
          diagnostic_code: rendered.code || 'render_failed',
        });
        markCheckpointStage(current, 'render', { status: 'failed' });
        return current;
      });
      diagnostics.push(createDiagnostic({
        code: 'render_failed',
        stage: 'render',
        sub_stage: 'render',
        frame_id: frameId,
        user_message: rendered.message || 'html-video 帧渲染失败。',
        retryable: true,
        repair_action: 'retry_render',
        details: { frame_id: frameId, output_path: rendered.output_path },
      }));
      return {
        success: false,
        message: rendered.message || 'html-video 帧渲染失败。',
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        rendered_frames: renderedFrames,
        diagnostics,
      };
    }

    const outputHash = rendered.output_hash || rendered.meta?.output_hash || await fileHash(rendered.output_path);
    nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
      markRenderCheckpoint(current, checkpointKey, {
        status: 'done',
        mp4_path: relativeProjectPath(resolvedProjectDir, rendered.output_path),
        output_hash: outputHash || '',
        diagnostic_code: '',
      });
      markCheckpointStage(current, 'render', {
        status: requested.size && frames.length !== allFrames.length ? 'partial' : 'done',
      });
      return current;
    });
    renderedFrames.push({
      path: rendered.output_path,
      engine: frame.engine,
      encoding: rendered.meta?.encoding,
      frame_id: frameId,
    });
  }

  return {
    success: true,
    project: nextProject,
    project_dir: resolvedProjectDir,
    html_video_project_path: resolvedProjectDir,
    rendered_frames: renderedFrames,
    diagnostics,
  };
}

async function composeHtmlVideoProject({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
  services = {},
  onProgress = null,
  targetDurationSec,
} = {}) {
  void targetDurationSec;
  const ffmpegComposer = services.ffmpegComposer || defaultFfmpegComposer;
  const resolvedProjectDir = await ensureProjectDir({ rootDir, workflowId, runId, projectDir });
  let nextProject = normalizeProject(project);
  await saveProject(resolvedProjectDir, nextProject);
  const diagnostics = [];
  const outputConfig = getOutputConfig(nextProject);
  const missingRendered = missingRenderedFrameIds(nextProject);
  if (missingRendered.length) {
    nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
      markComposeCheckpoint(current, {
        status: 'failed',
        output_path: '',
        output_audio_path: '',
        diagnostic_code: 'render_checkpoint_missing',
      });
      return current;
    });
    const diagnostic = createDiagnostic({
      code: 'render_checkpoint_missing',
      stage: 'compose',
      sub_stage: 'compose',
      user_message: `缺少已渲染帧，无法合成：${missingRendered.join(', ')}。`,
      retryable: true,
      repair_action: 'rerender_frames',
      details: { frame_ids: missingRendered },
    });
    return {
      success: false,
      message: diagnostic.user_message,
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      rendered_frames: [],
      diagnostics: [diagnostic],
    };
  }
  const renderedFrames = collectRenderedFramesFromProject(nextProject, resolvedProjectDir);
  const videoPath = path.join(resolvedProjectDir, 'exports', 'output.mp4');
  await report(onProgress, {
    type: 'html_video_compose_started',
    stage: 'project',
    sub_stage: 'compose',
    message: '正在合成 html-video 成片...',
    data: {
      frame_count: renderedFrames.length,
      output_path: videoPath,
    },
  });
  const concat = await ffmpegComposer.concatFramesWithFfmpeg(renderedFrames, videoPath, resolvedProjectDir, {
    fps: outputConfig.fps,
  });
  if (!concat.success) {
    nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
      markComposeCheckpoint(current, {
        status: 'failed',
        output_path: relativeProjectPath(resolvedProjectDir, videoPath),
        output_audio_path: '',
        diagnostic_code: concat.code || 'compose_failed',
      });
      return current;
    });
    diagnostics.push(createDiagnostic({
      code: 'compose_failed',
      stage: 'compose',
      sub_stage: 'compose',
      user_message: concat.message || 'html-video 视频合成失败。',
      retryable: true,
      repair_action: 'retry_compose',
      details: { strategy: concat.strategy, stderr: concat.stderr },
    }));
    return {
      success: false,
      message: concat.message || 'html-video 视频合成失败。',
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      rendered_frames: renderedFrames,
      diagnostics,
    };
  }

  let finalOutput = concat.output_path || videoPath;
  const composeVideoOutput = finalOutput;
  const audioDisabled = nextProject.audio?.status === 'skipped'
    && nextProject.audio?.reason === 'disabled_by_settings';
  const audioStatus = String(nextProject.audio?.status || '').trim().toLowerCase();
  const hasAudioIntent = !audioDisabled && (
    /^(ready|done|generated|rendered|mixed)$/i.test(audioStatus)
    || Boolean(nextProject.audio?.narration_path || nextProject.audio?.tts_manifest_path || nextProject.audio?.music_path)
  );
  let audioTrackCheck = null;
  if (!audioDisabled) {
    const narrationPath = await resolveNarrationPath(nextProject, resolvedProjectDir, ffmpegComposer, diagnostics);
    const { events: sfxEvents, dropped: sfxDropped } = sfxEventService.resolveProjectSfxEventsForMux({
      project: nextProject,
      projectDir: resolvedProjectDir,
      // 仅 asset_first 启用旁白避让；hf_first 不传 voiceWindows，混音输出与现状逐字节一致
      voiceWindows: nextProject.visual_strategy === 'asset_first'
        ? sfxEventService.buildVoiceWindowsFromProject(nextProject)
        : [],
    });
    if (sfxDropped.length) {
      diagnostics.push(createDiagnostic({
        code: 'sfx_event_dropped',
        stage: 'compose',
        sub_stage: 'compose',
        severity: 'warning',
        user_message: `${sfxDropped.length} 条自动音效素材不可用，导出时已跳过。`,
        details: { dropped: sfxDropped },
      }));
    }
    const muxOptions = {
      videoPath: finalOutput,
      outputPath: path.join(resolvedProjectDir, 'exports', 'output-audio.mp4'),
      narrationPath,
      musicPath: nextProject.audio?.music_path,
      videoDurationSec: expectedDurationSec(nextProject),
      ...(nextProject.audio?.mix || {}),
    };
    let mux = await ffmpegComposer.muxAudioWithFfmpeg({ ...muxOptions, sfxEvents });
    if (!mux.success && sfxEvents.length) {
      diagnostics.push(createDiagnostic({
        code: 'sfx_mix_failed',
        stage: 'compose',
        sub_stage: 'compose',
        severity: 'warning',
        user_message: '自动音效混入失败，已尝试导出无音效版本。',
        details: { stderr: mux.stderr },
      }));
      mux = await ffmpegComposer.muxAudioWithFfmpeg({ ...muxOptions, sfxEvents: [] });
    }
    if (!mux.success) {
      nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
        markComposeCheckpoint(current, {
          status: 'failed',
          output_path: relativeProjectPath(resolvedProjectDir, composeVideoOutput),
          output_audio_path: '',
          diagnostic_code: mux.code || 'compose_failed',
        });
        return current;
      });
      diagnostics.push(createDiagnostic({
        code: 'compose_failed',
        stage: 'compose',
        sub_stage: 'compose',
        user_message: mux.message || 'html-video 音频混流失败。',
        retryable: true,
        repair_action: 'retry_compose',
        details: { stderr: mux.stderr },
      }));
      return {
        success: false,
        message: mux.message || 'html-video 音频混流失败。',
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        rendered_frames: renderedFrames,
        diagnostics,
      };
    }
    finalOutput = mux.output_path || finalOutput;
  }

  if (hasAudioIntent && typeof ffmpegComposer.verifyAudioStreamWithFfprobe === 'function') {
    await report(onProgress, {
      type: 'html_video_audio_verify_started',
      stage: 'project',
      sub_stage: 'compose',
      message: '正在校验导出视频音频轨...',
      data: {
        output_path: finalOutput,
      },
    });
    audioTrackCheck = await ffmpegComposer.verifyAudioStreamWithFfprobe({
      videoPath: finalOutput,
    });
    if (audioTrackCheck.skipped) {
      diagnostics.push(createDiagnostic({
        code: audioTrackCheck.code || 'ffprobe_skipped',
        stage: 'compose',
        sub_stage: 'compose',
        severity: 'warning',
        user_message: audioTrackCheck.message || '已跳过导出音频轨校验。',
        details: audioTrackCheck,
      }));
      await report(onProgress, {
        type: 'html_video_audio_verify_done',
        stage: 'project',
        sub_stage: 'compose',
        message: '已跳过导出视频音频轨校验。',
        data: audioTrackCheck,
      });
    } else if (!audioTrackCheck.success) {
      nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
        markComposeCheckpoint(current, {
          status: 'failed',
          output_path: relativeProjectPath(resolvedProjectDir, composeVideoOutput),
          output_audio_path: finalOutput !== composeVideoOutput ? relativeProjectPath(resolvedProjectDir, finalOutput) : '',
          diagnostic_code: 'render_output_missing_audio',
        });
        return current;
      });
      const diagnostic = createDiagnostic({
        code: 'render_output_missing_audio',
        stage: 'compose',
        sub_stage: 'compose',
        user_message: audioTrackCheck.message || '导出成片缺少音频轨，已停止发布该文件。',
        retryable: true,
        repair_action: 'retry_compose',
        details: audioTrackCheck,
      });
      diagnostics.push(diagnostic);
      return {
        success: false,
        message: diagnostic.user_message,
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        output_path: finalOutput,
        rendered_frames: renderedFrames,
        diagnostics,
        audio_track_check: audioTrackCheck,
      };
    } else {
      await report(onProgress, {
        type: 'html_video_audio_verify_done',
        stage: 'project',
        sub_stage: 'compose',
        message: '导出视频音频轨校验完成。',
        data: audioTrackCheck,
      });
    }
  }
  nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
    markComposeCheckpoint(current, {
      status: 'done',
      output_path: relativeProjectPath(resolvedProjectDir, composeVideoOutput),
      output_audio_path: finalOutput !== composeVideoOutput ? relativeProjectPath(resolvedProjectDir, finalOutput) : '',
      diagnostic_code: '',
    });
    return current;
  });

  let durationCheck = null;
  const expectedDuration = expectedDurationSec(nextProject);
  if (typeof ffmpegComposer.verifyDurationWithFfprobe === 'function') {
    await report(onProgress, {
      type: 'html_video_duration_verify_started',
      stage: 'project',
      sub_stage: 'duration_verify',
      message: '正在校验导出视频时长...',
      data: {},
    });
    durationCheck = await ffmpegComposer.verifyDurationWithFfprobe({
      videoPath: finalOutput,
      expectedDurationSec: expectedDuration,
      toleranceSec: 1.5,
    });
    if (durationCheck.skipped) {
      nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
        markDurationVerifyCheckpoint(current, {
          status: 'skipped',
          expected_duration_sec: expectedDuration,
          actual_duration_sec: null,
          diagnostic_code: durationCheck.code || '',
        });
        return current;
      });
      diagnostics.push(createDiagnostic({
        code: durationCheck.code || 'ffprobe_skipped',
        stage: 'compose',
        sub_stage: 'duration_verify',
        user_message: durationCheck.message || '已跳过导出时长校验。',
        details: durationCheck,
      }));
      await report(onProgress, {
        type: 'html_video_duration_verify_done',
        stage: 'project',
        sub_stage: 'duration_verify',
        message: '已跳过导出视频时长校验。',
        data: durationCheck,
      });
    } else if (!durationCheck.success) {
      nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
        markDurationVerifyCheckpoint(current, {
          status: 'failed',
          expected_duration_sec: durationCheck.expected_duration_sec ?? expectedDuration,
          actual_duration_sec: durationCheck.actual_duration_sec ?? durationCheck.duration_sec ?? null,
          diagnostic_code: 'duration_mismatch',
        });
        return current;
      });
      diagnostics.push(createDiagnostic({
        code: 'duration_mismatch',
        stage: 'compose',
        sub_stage: 'duration_verify',
        user_message: durationCheck.message || '导出视频时长校验失败。',
        retryable: true,
        repair_action: 'retry_duration_verify',
        details: durationCheck,
      }));
      return {
        success: false,
        message: durationCheck.message || '导出视频时长校验失败。',
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        output_path: finalOutput,
        rendered_frames: renderedFrames,
        diagnostics,
        duration_check: durationCheck,
      };
    } else {
      nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
        markDurationVerifyCheckpoint(current, {
          status: 'done',
          expected_duration_sec: durationCheck.expected_duration_sec ?? expectedDuration,
          actual_duration_sec: durationCheck.actual_duration_sec ?? durationCheck.duration_sec ?? null,
          diagnostic_code: '',
        });
        return current;
      });
      await report(onProgress, {
        type: 'html_video_duration_verify_done',
        stage: 'project',
        sub_stage: 'duration_verify',
        message: '导出视频时长校验完成。',
        data: durationCheck,
      });
    }
  } else {
    nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
      markDurationVerifyCheckpoint(current, {
        status: 'skipped',
        expected_duration_sec: expectedDuration,
        actual_duration_sec: null,
        diagnostic_code: 'ffprobe_unavailable',
      });
      return current;
    });
  }

  const exportEntry = addExport(nextProject, {
    format: 'mp4',
    path: path.relative(resolvedProjectDir, finalOutput).replace(/\\/g, '/'),
    absolute_path: finalOutput,
    render_mode: 'html-video',
  });
  // addExport 去重会把第二次起的记录改名为 output-audio-N.mp4，但 mux 始终覆盖写
  // output-audio.mp4，需把成片复制到去重后的路径，否则记录指向不存在的文件（播放报“文件不存在”）。
  const exportAbs = projectStore.resolveProjectPath(resolvedProjectDir, exportEntry.path);
  if (path.resolve(exportAbs) !== path.resolve(finalOutput)) {
    await fs.copyFile(finalOutput, exportAbs);
    exportEntry.absolute_path = exportAbs;
  }
  addRevision(nextProject, {
    summary: 'html-video 工程渲染完成。',
    change: { type: 'render', output_path: finalOutput },
  });
  nextProject.status = 'rendered';
  await saveProject(resolvedProjectDir, nextProject);
  await report(onProgress, {
    type: 'html_video_export_ready',
    stage: 'project',
    sub_stage: 'compose',
    message: 'html-video 成片已导出。',
    data: {
      output_path: finalOutput,
      export_count: nextProject.exports?.length || 0,
    },
  });

  return {
    success: true,
    message: 'html-video 工程已渲染。',
    project: nextProject,
    project_dir: resolvedProjectDir,
    html_video_project_path: resolvedProjectDir,
    output_path: finalOutput,
    rendered_frames: renderedFrames,
    diagnostics,
    duration_check: durationCheck,
    audio_track_check: audioTrackCheck,
  };
}

async function renderHtmlVideoProject({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
  templateRegistry,
  services = {},
  skipRender = false,
  runLayoutQa = false,
  onProgress = null,
  targetDurationSec,
} = {}) {
  const materializer = services.materializer || defaultMaterializer;
  const resolvedProjectDir = await ensureProjectDir({ rootDir, workflowId, runId, projectDir });
  const trustedTargetDurationSec = resolveTargetDurationSec(project, targetDurationSec);
  let nextProject = normalizeProject(project);
  const diagnostics = [];

  const materialized = await materializer.materializeProject({
    projectDir: resolvedProjectDir,
    project: nextProject,
    templateRegistry,
  });
  nextProject = normalizeProject(materialized.project);
  diagnostics.push(...normalizeDiagnostics(materialized.diagnostics, { stage: 'materialize' }));
  await saveProject(resolvedProjectDir, nextProject);

  if (skipRender) {
    return {
      success: true,
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      diagnostics,
    };
  }

  const timingFit = fitFrameDurationsToCaptions(nextProject);
  diagnostics.push(...timingFit.diagnostics);
  if (!timingFit.ok) {
    const firstError = timingFit.diagnostics.find(item => item.fallback_allowed === false);
    return {
      success: false,
      message: firstError?.user_message || '视频时间轴异常，已停止渲染。',
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      diagnostics,
    };
  }
  if (timingFit.changed) {
    await saveProject(resolvedProjectDir, nextProject);
  }

  const timelineDurationOptions = Number.isFinite(trustedTargetDurationSec) && trustedTargetDurationSec > 0
    ? { targetDurationSec: trustedTargetDurationSec }
    : {};
  const timelineDuration = validateReasonableTimelineDuration(nextProject, timelineDurationOptions);
  if (!timelineDuration.ok) {
    const mismatch = analyzeTimelineMismatch({
      project: nextProject,
      targetDurationSec: trustedTargetDurationSec,
      audioManifest: nextProject.audio,
    });
    diagnostics.push(createDiagnostic({
      code: timelineDuration.code,
      stage: 'timeline-consistency',
      sub_stage: 'timeline_check',
      user_message: timelineDuration.message || '视频时间轴异常，已停止渲染。',
      retryable: true,
      repair_action: mismatch.repair_action || 'repair_timeline',
      details: {
        ...timelineDuration,
        timeline_mismatch: mismatch,
      },
      fallback_allowed: false,
    }));
    return {
      success: false,
      code: timelineDuration.code,
      message: timelineDuration.message || '视频时间轴异常，已停止渲染。',
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      diagnostics,
    };
  }

  if (runLayoutQa === true) {
    const layoutQa = await inspectProjectLayoutBeforeRender({
      projectDir: resolvedProjectDir,
      project: nextProject,
      services,
      onProgress,
    });
    diagnostics.push(...layoutQa.diagnostics);
    if (!layoutQa.success) {
      return {
        success: false,
        code: 'layout_qa_failed',
        message: layoutQa.diagnostics[0]?.user_message || 'html-video 帧布局检查未通过，已停止渲染。',
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        diagnostics,
        layout_qa: layoutQa.reports,
      };
    }
  }

  const rendered = await renderHtmlVideoFrames({
    rootDir,
    workflowId,
    runId,
    projectDir: resolvedProjectDir,
    project: nextProject,
    templateRegistry,
    services,
    onProgress,
    materialize: false,
  });
  diagnostics.push(...normalizeDiagnostics(rendered.diagnostics));
  if (!rendered.success) {
    return {
      success: false,
      message: rendered.message || 'html-video 帧渲染失败。',
      project: rendered.project || nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      rendered_frames: rendered.rendered_frames || [],
      diagnostics,
    };
  }

  const composed = await composeHtmlVideoProject({
    rootDir,
    workflowId,
    runId,
    projectDir: resolvedProjectDir,
    project: rendered.project,
    services,
    onProgress,
    targetDurationSec: trustedTargetDurationSec,
  });
  diagnostics.push(...normalizeDiagnostics(composed.diagnostics));
  if (!composed.success) {
    return {
      success: false,
      message: composed.message || 'html-video 工程渲染失败。',
      project: composed.project || rendered.project,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      output_path: composed.output_path,
      rendered_frames: rendered.rendered_frames || [],
      diagnostics,
      duration_check: composed.duration_check,
    };
  }

  return {
    success: true,
    message: 'html-video 工程已渲染。',
    project: composed.project,
    project_dir: resolvedProjectDir,
    html_video_project_path: resolvedProjectDir,
    output_path: composed.output_path,
    rendered_frames: rendered.rendered_frames || composed.rendered_frames || [],
    diagnostics,
    duration_check: composed.duration_check,
  };
}

async function materializeHtmlVideoProject(options = {}) {
  const result = await renderHtmlVideoProject({
    ...options,
    skipRender: true,
    mode: 'materialize',
  });
  return {
    ...result,
    message: result.message || 'HTML 已重新生成。',
  };
}

async function renderHtmlVideoFramePreview(options = {}) {
  const frameId = String(options.frameId || options.frame_id || '');
  const draftId = String(options.draftId || options.draft_id || '').trim();
  if (!frameId) {
    return { success: false, message: '缺少要渲染的帧 ID。', diagnostics: [] };
  }
  const frameRenderer = options.services?.frameRenderer || defaultFrameRenderer;
  const materialized = await materializeProject(options);
  const diagnostics = [...normalizeDiagnostics(materialized.diagnostics, { stage: 'materialize' })];
  if (!materialized.success) {
    return materialized;
  }
  const nextProject = normalizeProject(materialized.project);
  const targetFrame = findFrameByAnyId(nextProject, frameId);
  if (!targetFrame) {
    return {
      success: false,
      message: '未找到要渲染的帧。',
      project: nextProject,
      project_dir: materialized.project_dir,
      html_video_project_path: materialized.html_video_project_path,
      diagnostics,
    };
  }
  let frameToRender = targetFrame;
  let previewName = sanitizePathSegment(canonicalFrameId(targetFrame) || frameId);
  if (draftId) {
    const draft = findDraft(nextProject, frameId, draftId);
    if (!draft || draft.status === 'discarded') {
      return {
        success: false,
        code: 'DRAFT_NOT_FOUND',
        message: '未找到要预览的草稿。',
        project: nextProject,
        project_dir: materialized.project_dir,
        html_video_project_path: materialized.html_video_project_path,
        diagnostics,
      };
    }
    frameToRender = { ...targetFrame, html_path: draft.html_path };
    previewName = `${previewName}-${sanitizePathSegment(draft.id)}`;
  }
  const outputConfig = getOutputConfig(nextProject);
  const previewPath = path.join(materialized.project_dir, 'inspect', 'previews', `${previewName}.mp4`);
  let layoutQa = null;
  if (options.runLayoutQa === true || options.run_layout_qa === true) {
    const layoutQaService = options.services?.layoutQaService || defaultLayoutQaService;
    const sourcePath = path.isAbsolute(frameToRender.html_path)
      ? frameToRender.html_path
      : path.join(materialized.project_dir, frameToRender.html_path);
    layoutQa = await layoutQaService.inspectFrameHtmlLayout({
      htmlPath: sourcePath,
      frame: frameToRender,
      resolution: outputConfig.resolution,
      durationSec: frameToRender.duration_sec,
    });
  }
  const rendered = await frameRenderer.renderFrame(frameToRender, {
    projectDir: materialized.project_dir,
    project: nextProject,
    outputPath: previewPath,
    resolution: outputConfig.resolution,
    fps: outputConfig.fps,
    runLayoutQa: options.runLayoutQa === true || options.run_layout_qa === true,
  });
  diagnostics.push(...normalizeDiagnostics(rendered.diagnostics, {
    stage: 'render',
    sub_stage: 'render',
    frame_id: frameId,
    details: { frame_id: frameId },
  }));
  if (!rendered.success) {
    diagnostics.push(createDiagnostic({
      code: 'render_failed',
      stage: 'render',
      sub_stage: 'render',
      frame_id: frameId,
      user_message: rendered.message || 'html-video 帧渲染失败。',
      retryable: true,
      repair_action: 'retry_render',
      details: { frame_id: frameId, output_path: rendered.output_path },
    }));
    return {
      success: false,
      message: rendered.message || 'html-video 帧渲染失败。',
      project: nextProject,
      project_dir: materialized.project_dir,
      html_video_project_path: materialized.html_video_project_path,
      diagnostics,
    };
  }
  return {
    success: true,
    message: '单帧预览已更新。',
    project: nextProject,
    project_dir: materialized.project_dir,
    html_video_project_path: materialized.html_video_project_path,
    preview_frame_id: frameId,
    preview_draft_id: draftId || null,
    preview_path: rendered.output_path,
    layout_qa: layoutQa || rendered.layout_qa || null,
    diagnostics,
  };
}

async function exportHtmlVideoProject(options = {}) {
  return renderHtmlVideoProject({
    ...options,
    skipRender: false,
    mode: 'export',
  });
}

module.exports = {
  createProject,
  materializeProject,
  materializeHtmlVideoProject,
  renderHtmlVideoFramePreview,
  exportHtmlVideoProject,
  renderHtmlVideoProject,
  renderHtmlVideoFrames,
  composeHtmlVideoProject,
  fitFrameDurationsToCaptions,
  validateReasonableTimelineDuration,
  markRenderCheckpoint,
  markComposeCheckpoint,
  markDurationVerifyCheckpoint,
  markVisualInspectCheckpoint,
  renderCheckpointKey,
  renderProject: renderHtmlVideoProject,
  exportProject: exportHtmlVideoProject,
  rerenderProject: renderHtmlVideoProject,
  applyEditPatch: require('./editPatchService').applyEditPatch,
};
