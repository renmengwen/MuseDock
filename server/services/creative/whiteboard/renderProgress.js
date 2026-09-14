const PHASES = new Set(['preparing', 'drawing', 'encoding', 'validating', 'previews']);

function normalizeRenderProgress(value) {
  if (value?.type !== 'render_progress' || !PHASES.has(value.phase)
    || !Number.isInteger(value.writtenFrames) || !Number.isInteger(value.totalFrames)
    || value.totalFrames < 1 || value.writtenFrames < 0 || value.writtenFrames > value.totalFrames
    || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0) return null;
  return { type: 'render_progress', phase: value.phase, writtenFrames: value.writtenFrames,
    totalFrames: value.totalFrames, elapsedMs: Math.round(value.elapsedMs) };
}

function sceneFrameCount(scene) {
  return Math.ceil(scene.endMs * 60 / 1000) - Math.ceil(scene.startMs * 60 / 1000);
}

// 内置 Windows FFmpeg 2018 / libavcodec 58 的 x264 多线程存在严重等待。
// 仅调整执行线程数，不改变画幅、帧率、CRF、绘制算法或已批准的输入。
function encoderThreadsFor(version, platform = process.platform) {
  const major = Number(String(version).match(/^libavcodec\s+(\d+)\./m)?.[1]);
  return platform === 'win32' && (!Number.isFinite(major) || major < 59) ? 1 : 2;
}

module.exports = { normalizeRenderProgress, sceneFrameCount, encoderThreadsFor };
