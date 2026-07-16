const path = require('path');

const defaultAdapter = require('./hyperframesPlaywrightAdapter');
const { resolveFrameRenderSource } = require('./frameRenderSource');
const { DEFAULT_OUTPUT_RESOLUTION } = require('./projectSchema');

async function renderFrame(frame = {}, options = {}) {
  const adapter = options.adapter || defaultAdapter;
  const state = options.state || {};
  const outputPath = options.outputPath
    || frame.output_path
    || frame.outputPath
    || path.join(options.workDir || process.cwd(), `${frame.id || 'frame'}.mp4`);

  state.status = 'rendering';
  state.frame_id = frame.id || null;
  state.message = '正在渲染 html-video 帧...';

  let progressQueue = Promise.resolve();
  const enqueueProgress = (percent, message) => {
    state.progress = percent;
    state.message = message;
    if (typeof options.onProgress !== 'function') return progressQueue;
    progressQueue = progressQueue
      .then(() => options.onProgress({ frame, percent, message }))
      .catch(() => {});
    return progressQueue;
  };

  try {
    const source = resolveFrameRenderSource({
      projectDir: options.projectDir || options.workDir,
      project: options.project || {},
      frame,
    });
    const result = await adapter.render(
      {
        template: {
          id: source.frame_id || 'frame',
          engine: source.engine,
          sourcePath: source.absolute_html_path,
        },
        config: {
          outputPath,
          resolution: options.resolution || frame.resolution || DEFAULT_OUTPUT_RESOLUTION,
          fps: options.fps || frame.fps || 30,
          duration: source.duration_sec,
          durationMode: frame.duration_mode || frame.durationMode || 'explicit',
        },
        frame,
        security: {
          projectDir: options.projectDir || options.workDir,
          assets: Array.isArray(options.project?.assets) ? options.project.assets : [],
          frameId: source.frame_id || frame.id || frame.scene_id || '',
        },
      },
      {
        onProgress: (percent, message) => {
          return enqueueProgress(percent, message);
        },
      },
      options.adapterDeps || {},
    );
    await progressQueue;
    state.status = 'done';
    state.output_path = result.output_path || result.outputPath || outputPath;
    state.message = 'html-video 帧渲染完成。';
    return {
      success: true,
      frame_id: frame.id || null,
      output_path: state.output_path,
      meta: result.meta || {},
      diagnostics: result.diagnostics || [],
    };
  } catch (error) {
    await progressQueue;
    state.status = 'failed';
    state.message = `html-video 帧渲染失败：${error.message}`;
    const policyFailure = error.code === 'runtime_visual_asset_policy_violation';
    return {
      success: false,
      frame_id: frame.id || null,
      output_path: outputPath,
      diagnostics: [{
        code: error.code || 'render_failed',
        stage: 'render',
        sub_stage: policyFailure ? 'frame_html' : 'render',
        frame_id: error.frame_id || frame.id || frame.scene_id || null,
        user_message: state.message,
        retryable: true,
        repair_action: policyFailure ? 'retry_frame_html' : 'retry_render',
        details: { message: error.message, ...(error.details || {}) },
      }],
      message: state.message,
      code: error.code || 'render_failed',
    };
  }
}

module.exports = {
  renderFrame,
};
