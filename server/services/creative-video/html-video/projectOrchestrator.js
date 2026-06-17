const path = require('path');
const fs = require('fs/promises');

const defaultMaterializer = require('./materializer');
const defaultFrameRenderer = require('./frameRenderer');
const defaultFfmpegComposer = require('./ffmpegComposer');
const projectStore = require('./projectStore');
const { addExport, addRevision, saveProject, createProjectDir } = projectStore;
const { normalizeProject } = require('./projectSchema');
const { createDiagnostic, normalizeDiagnostics } = require('./diagnostics');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getOutputConfig(project) {
  return objectOrEmpty(project.output || project.render || {});
}

function expectedDurationSec(project) {
  return (Array.isArray(project.frames) ? project.frames : [])
    .reduce((total, frame) => total + Number(frame.duration_sec || frame.durationSec || 0), 0);
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
  const renderedFrames = [];
  for (const frame of nextProject.frames) {
    const frameOutput = path.join(resolvedProjectDir, 'frames', `${frame.id || frame.scene_id}.mp4`);
    const rendered = await frameRenderer.renderFrame(frame, {
      projectDir: resolvedProjectDir,
      outputPath: frameOutput,
      resolution: outputConfig.resolution,
      fps: outputConfig.fps,
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
  const targetFrame = nextProject.frames.find(frame => frame.id === frameId);
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
  const outputConfig = getOutputConfig(nextProject);
  const previewPath = path.join(materialized.project_dir, 'inspect', 'previews', `${frameId}.mp4`);
  const rendered = await frameRenderer.renderFrame(targetFrame, {
    projectDir: materialized.project_dir,
    outputPath: previewPath,
    resolution: outputConfig.resolution,
    fps: outputConfig.fps,
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
    preview_path: rendered.output_path,
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
