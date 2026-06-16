const path = require('path');

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

async function ensureProjectDir({ rootDir, workflowId, runId, projectDir }) {
  if (projectDir) return projectDir;
  return createProjectDir({ rootDir, workflowId, runId });
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

  const mux = await ffmpegComposer.muxAudioWithFfmpeg({
    videoPath: concat.output_path || videoPath,
    outputPath: path.join(resolvedProjectDir, 'exports', 'output-audio.mp4'),
    narrationPath: nextProject.audio?.narration_path,
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

module.exports = {
  renderHtmlVideoProject,
};
