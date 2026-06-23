const path = require('path');
const fs = require('fs/promises');

const defaultMaterializer = require('./materializer');
const defaultFrameRenderer = require('./frameRenderer');
const defaultLayoutQaService = require('./layoutQaService');
const defaultFfmpegComposer = require('./ffmpegComposer');
const projectStore = require('./projectStore');
const { addExport, addRevision, saveProject, createProjectDir } = projectStore;
const { normalizeProject } = require('./projectSchema');
const { createDiagnostic, normalizeDiagnostics } = require('./diagnostics');
const { findFrameByAnyId, canonicalFrameId, sanitizePathSegment } = require('./frameIdentity');
const { findDraft } = require('./htmlVideoDraftService');

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
        || item.scene_id === frame.scene_id
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
          user_message: '字幕时间超过锁定的画面时长，无法继续渲染。请缩短旁白或解除固定时长。',
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

      const nextDuration = roundDuration(captionEnd);
      frame.duration_sec = nextDuration;
      if (frame.durationSec != null) frame.durationSec = nextDuration;
      if (frame.duration != null) frame.duration = nextDuration;
      syncTimelineDuration(project, frame, nextDuration);
      changed = true;
      diagnostics.push(createDiagnostic({
        code: 'frame_duration_auto_extended',
        stage: 'timeline-consistency',
        severity: 'warning',
        user_message: '已按字幕时长自动延长画面帧。',
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
    project,
    diagnostics,
    errors: diagnostics.filter(item => item.fallback_allowed === false),
    changed,
  };
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
      user_message: `读取旁白音频清单失败：${error.message}`,
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
      user_message: concat.message || '旁白音频拼接失败。',
      details: { stderr: concat.stderr },
    }));
    return null;
  }
  return concat.output_path || outputPath;
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

async function renderHtmlVideoProject({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
  templateRegistry,
  services = {},
  skipRender = false,
  onProgress = null,
} = {}) {
  const materializer = services.materializer || defaultMaterializer;
  const frameRenderer = services.frameRenderer || defaultFrameRenderer;
  const ffmpegComposer = services.ffmpegComposer || defaultFfmpegComposer;
  const resolvedProjectDir = await ensureProjectDir({ rootDir, workflowId, runId, projectDir });
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

  const outputConfig = getOutputConfig(nextProject);
  const timingFit = fitFrameDurationsToCaptions(nextProject);
  diagnostics.push(...timingFit.diagnostics);
  if (timingFit.changed) {
    await saveProject(resolvedProjectDir, nextProject);
  }
  if (timingFit.errors.length) {
    return {
      success: false,
      message: timingFit.errors[0].user_message,
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      diagnostics,
    };
  }

  const renderedFrames = [];
  const frames = Array.isArray(nextProject.frames) ? nextProject.frames : [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const frameOutput = path.join(resolvedProjectDir, 'frames', `${frame.id || frame.scene_id}.mp4`);
    const rendered = await frameRenderer.renderFrame(frame, {
      projectDir: resolvedProjectDir,
      project: nextProject,
      outputPath: frameOutput,
      resolution: outputConfig.resolution,
      fps: outputConfig.fps,
      onProgress: progress => report(onProgress, {
        type: 'html_video_frame_render_progress',
        stage: 'project',
        message: progress?.message || `正在渲染第 ${index + 1}/${frames.length} 帧...`,
        frame_id: frame.id || frame.scene_id,
        frame_progress: progress?.percent,
        data: {
          frame_id: frame.id || frame.scene_id,
          index,
          total: frames.length,
          percent: progress?.percent,
        },
      }),
    });
    diagnostics.push(...normalizeDiagnostics(rendered.diagnostics, { stage: 'render', details: { frame_id: frame.id } }));
    if (!rendered.success) {
      diagnostics.push(createDiagnostic({
        code: 'render_failed',
        stage: 'render',
        user_message: rendered.message || 'html-video 帧渲染失败。',
        details: { frame_id: frame.id, output_path: rendered.output_path },
      }));
      return {
        success: false,
        message: rendered.message || 'html-video 帧渲染失败。',
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        diagnostics,
      };
    }
    renderedFrames.push({
      path: rendered.output_path,
      engine: frame.engine,
      encoding: rendered.meta?.encoding,
      frame_id: frame.id,
    });
  }

  const videoPath = path.join(resolvedProjectDir, 'exports', 'output.mp4');
  await report(onProgress, {
    type: 'html_video_compose_started',
    stage: 'project',
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
    diagnostics.push(createDiagnostic({
      code: 'compose_failed',
      stage: 'compose',
      user_message: concat.message || 'html-video 视频合成失败。',
      details: { strategy: concat.strategy, stderr: concat.stderr },
    }));
    return {
      success: false,
      message: concat.message || 'html-video 视频合成失败。',
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      diagnostics,
    };
  }

  const narrationPath = await resolveNarrationPath(nextProject, resolvedProjectDir, ffmpegComposer, diagnostics);
  const mux = await ffmpegComposer.muxAudioWithFfmpeg({
    videoPath: concat.output_path || videoPath,
    outputPath: path.join(resolvedProjectDir, 'exports', 'output-audio.mp4'),
    narrationPath,
    musicPath: nextProject.audio?.music_path,
    videoDurationSec: expectedDurationSec(nextProject),
    ...(nextProject.audio?.mix || {}),
  });
  if (!mux.success) {
    diagnostics.push(createDiagnostic({
      code: 'compose_failed',
      stage: 'compose',
      user_message: mux.message || 'html-video 音频混流失败。',
      details: { stderr: mux.stderr },
    }));
    return {
      success: false,
      message: mux.message || 'html-video 音频混流失败。',
      project: nextProject,
      project_dir: resolvedProjectDir,
      html_video_project_path: resolvedProjectDir,
      diagnostics,
    };
  }

  const finalOutput = mux.output_path || concat.output_path || videoPath;
  if (typeof ffmpegComposer.verifyDurationWithFfprobe === 'function') {
    const durationCheck = await ffmpegComposer.verifyDurationWithFfprobe({
      videoPath: finalOutput,
      expectedDurationSec: expectedDurationSec(nextProject),
      toleranceSec: 1.5,
    });
    if (durationCheck.skipped) {
      diagnostics.push(createDiagnostic({
        code: durationCheck.code || 'ffprobe_skipped',
        stage: 'compose',
        user_message: durationCheck.message || '已跳过导出时长校验。',
        details: durationCheck,
      }));
    } else if (!durationCheck.success) {
      diagnostics.push(createDiagnostic({
        code: durationCheck.code || 'duration_mismatch',
        stage: 'compose',
        user_message: durationCheck.message || '导出视频时长校验失败。',
        details: durationCheck,
      }));
      return {
        success: false,
        message: durationCheck.message || '导出视频时长校验失败。',
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        diagnostics,
      };
    }
  }

  addExport(nextProject, {
    format: 'mp4',
    path: path.relative(resolvedProjectDir, finalOutput).replace(/\\/g, '/'),
    absolute_path: finalOutput,
    render_mode: 'html-video',
  });
  addRevision(nextProject, {
    summary: 'html-video 工程渲染完成。',
    change: { type: 'render', output_path: finalOutput },
  });
  nextProject.status = 'rendered';
  await saveProject(resolvedProjectDir, nextProject);
  await report(onProgress, {
    type: 'html_video_export_ready',
    stage: 'project',
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
  diagnostics.push(...normalizeDiagnostics(rendered.diagnostics, { stage: 'render', details: { frame_id: frameId } }));
  if (!rendered.success) {
    diagnostics.push(createDiagnostic({
      code: 'render_failed',
      stage: 'render',
      user_message: rendered.message || 'html-video 帧渲染失败。',
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
  renderProject: renderHtmlVideoProject,
  exportProject: exportHtmlVideoProject,
  rerenderProject: renderHtmlVideoProject,
  applyEditPatch: require('./editPatchService').applyEditPatch,
};
