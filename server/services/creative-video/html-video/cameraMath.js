const finite = value => typeof value === 'number' && Number.isFinite(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function noOp(reason, fit = null) {
  return {
    applied: false,
    reason,
    fit,
    base_scale: null,
    zoom: 1,
    image_rect: null,
    focus_canvas: null,
    target_point: null,
  };
}

function computeCameraTransform(args) {
  const input = object(args) ? args : {};
  const { image_width: iw, image_height: ih, canvas_width: width, canvas_height: height } = input;
  if (![iw, ih, width, height].every(value => finite(value) && value > 0)) {
    return noOp('invalid_dimensions');
  }

  const { fit } = input;
  if (fit !== 'cover' && fit !== 'contain') return noOp('invalid_fit');

  const { region } = input;
  if (!object(region)
    || ![region.x, region.y, region.width, region.height].every(finite)
    || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
    || region.x + region.width > 1 || region.y + region.height > 1) {
    return noOp('invalid_region', fit);
  }

  const focus = input.focus_point === undefined
    ? { x: region.x + region.width / 2, y: region.y + region.height / 2 }
    : input.focus_point;
  if (!object(focus) || ![focus.x, focus.y].every(finite)
    || focus.x < region.x || focus.x > region.x + region.width
    || focus.y < region.y || focus.y > region.y + region.height) {
    return noOp('invalid_focus_point', fit);
  }

  const safe = input.safe_rect;
  if (!object(safe) || ![safe.left, safe.top, safe.right, safe.bottom].every(finite)
    || safe.left < 0 || safe.top < 0 || safe.right > width || safe.bottom > height
    || safe.left >= safe.right || safe.top >= safe.bottom) {
    return noOp('invalid_safe_rect', fit);
  }

  const fillFactor = input.fill_factor;
  const maxZoom = input.max_zoom;
  if (!finite(fillFactor) || fillFactor <= 0 || fillFactor >= 1
    || !finite(maxZoom) || maxZoom < 1) {
    return noOp('invalid_zoom_policy', fit);
  }

  const baseScale = fit === 'cover'
    ? Math.max(width / iw, height / ih)
    : Math.min(width / iw, height / ih);
  const baseRegionWidth = region.width * iw * baseScale;
  const baseRegionHeight = region.height * ih * baseScale;
  const candidateZoom = Math.min(
    (safe.right - safe.left) / baseRegionWidth,
    (safe.bottom - safe.top) / baseRegionHeight,
  ) * fillFactor;
  const zoom = Math.min(maxZoom, Math.max(1, candidateZoom));
  const scale = baseScale * zoom;
  const renderWidth = iw * scale;
  const renderHeight = ih * scale;
  if (![baseScale, zoom, renderWidth, renderHeight].every(value => finite(value) && value > 0)) {
    return noOp('invalid_dimensions', fit);
  }

  const target = {
    x: (safe.left + safe.right) / 2,
    y: (safe.top + safe.bottom) / 2,
  };
  let left = target.x - focus.x * renderWidth;
  let top = target.y - focus.y * renderHeight;
  if (fit === 'cover') {
    left = Math.min(0, Math.max(width - renderWidth, left));
    top = Math.min(0, Math.max(height - renderHeight, top));
  }

  const focusCanvas = {
    x: left + focus.x * renderWidth,
    y: top + focus.y * renderHeight,
  };
  const epsilon = 1e-9;
  if (focusCanvas.x < safe.left - epsilon || focusCanvas.x > safe.right + epsilon
    || focusCanvas.y < safe.top - epsilon || focusCanvas.y > safe.bottom + epsilon) {
    return noOp('focus_outside_safe_rect', fit);
  }

  return {
    applied: true,
    reason: 'applied',
    fit,
    base_scale: baseScale,
    zoom,
    image_rect: { left, top, width: renderWidth, height: renderHeight },
    focus_canvas: focusCanvas,
    target_point: target,
  };
}

module.exports = { computeCameraTransform };
