export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const text = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
  return `${text} ${units[unitIndex]}`;
}

export function getFileName(filePath = '') {
  return String(filePath).split(/[\\/]/).filter(Boolean).pop() || '';
}

export function getFramePreviewUrl(awemeId, frameName) {
  if (!awemeId || !frameName) return '';
  return `/api/media/douyin/${encodeURIComponent(awemeId)}/files/frames/${encodeURIComponent(frameName)}`;
}

export function normalizeFrameAsset(frame, awemeId) {
  if (typeof frame === 'string') {
    const name = getFileName(frame);
    return {
      path: frame,
      name,
      bytes: null,
      preview_url: getFramePreviewUrl(awemeId, name),
    };
  }

  const path = frame?.path || '';
  const name = frame?.name || getFileName(path);
  return {
    path,
    name,
    bytes: typeof frame?.bytes === 'number' ? frame.bytes : null,
    preview_url: frame?.preview_url || getFramePreviewUrl(awemeId, name),
  };
}

export function getDisplayFrames(status = {}) {
  const currentFrames = Array.isArray(status.frames) ? status.frames : [];
  const legacyFrames = Array.isArray(status.analysis_input?.local_assets?.frames)
    ? status.analysis_input.local_assets.frames
    : [];
  const sourceFrames = currentFrames.length ? currentFrames : legacyFrames;
  return sourceFrames.map(frame => normalizeFrameAsset(frame, status.aweme_id));
}
