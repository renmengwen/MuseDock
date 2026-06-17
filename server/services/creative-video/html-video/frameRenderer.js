const path = require('path');

const defaultAdapter = require('./hyperframesPlaywrightAdapter');

function resolveFrameHtmlPath(frame, options) {
  const sourcePath = frame.html_path || frame.htmlPath || frame.sourcePath;
  if (!sourcePath || path.isAbsolute(sourcePath) || !options.projectDir) {
    return sourcePath;
  }
  const projectDir = path.resolve(options.projectDir);
  const resolved = path.resolve(projectDir, sourcePath);
  const relative = path.relative(projectDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('帧 HTML 路径不能逃逸工程目录。');
  }
  return resolved;
}

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
    const result = await adapter.render(
      {
        template: { sourcePath: resolveFrameHtmlPath(frame, options) },
        config: {
          outputPath,
          resolution: options.resolution || frame.resolution || { width: 1280, height: 720 },
          fps: options.fps || frame.fps || 30,
          duration: frame.duration_sec || frame.durationSec || options.duration || 5,
          durationMode: frame.duration_mode || frame.durationMode || 'explicit',
        },
        frame,
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
    return {
      success: false,
      frame_id: frame.id || null,
      output_path: outputPath,
      diagnostics: [{
        code: error.code || 'render_failed',
        stage: 'render',
        user_message: state.message,
        details: { message: error.message },
      }],
      message: state.message,
      code: error.code || 'render_failed',
    };
  }
}

module.exports = {
  renderFrame,
  resolveFrameHtmlPath,
};
