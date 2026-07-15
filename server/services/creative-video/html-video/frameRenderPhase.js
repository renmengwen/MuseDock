const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const defaultMaterializer = require('./materializer');
const defaultFrameRenderer = require('./frameRenderer');
const projectStore = require('./projectStore');
const { saveProject, createProjectDir } = projectStore;
const { normalizeProject, markCheckpointFrame, markCheckpointStage } = require('./projectSchema');
const { createDiagnostic, normalizeDiagnostics } = require('./diagnostics');
const { sanitizePathSegment } = require('./frameIdentity');
const { objectOrEmpty, report, getOutputConfig } = require('./timelineGuards');

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

function relativeProjectPath(projectDir, filePath) {
  return path.relative(projectDir, filePath).replace(/\\/g, '/');
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
  services = {},
} = {}) {
  const materializer = services.materializer || defaultMaterializer;
  const resolvedProjectDir = await ensureProjectDir({ rootDir, workflowId, runId, projectDir });
  const materialized = await materializer.materializeProject({
    projectDir: resolvedProjectDir,
    project: normalizeProject(project),
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

module.exports = {
  markRenderCheckpoint,
  renderCheckpointKey,
  relativeProjectPath,
  resolveNarrationPath,
  collectRenderedFramesFromProject,
  missingRenderedFrameIds,
  ensureProjectDir,
  createProject,
  materializeProject,
  renderHtmlVideoFrames,
};
