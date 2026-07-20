const assert = require('assert');

const { computeCameraTransform } = require('../server/services/creative-video/html-video/cameraMath');

const canvas = { canvas_width: 1080, canvas_height: 1920 };
const standardSafe = { left: 108, top: 120, right: 972, bottom: 1440 };
const biasedSafe = { left: 60, top: 240, right: 720, bottom: 1320 };

function args(overrides = {}) {
  return {
    image_width: 1600,
    image_height: 900,
    ...canvas,
    fit: 'cover',
    region: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
    safe_rect: standardSafe,
    fill_factor: 0.8,
    max_zoom: 3,
    ...overrides,
  };
}

function isFiniteTree(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return true;
  return Object.values(value).every(isFiniteTree);
}

function assertNoOp(input, reason) {
  let result;
  assert.doesNotThrow(() => { result = computeCameraTransform(input); });
  assert.equal(result.applied, false);
  assert.equal(result.reason, reason);
  assert.deepEqual(Object.keys(result), [
    'applied', 'reason', 'fit', 'base_scale', 'zoom', 'image_rect', 'focus_canvas', 'target_point',
  ]);
  assert.equal(isFiniteTree(result), true, 'no-op 不得包含 NaN/Infinity');
}

{
  const cover = computeCameraTransform(args({
    image_width: 2000,
    image_height: 1000,
    canvas_width: 1000,
    canvas_height: 1000,
    region: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
    safe_rect: { left: 0, top: 0, right: 1000, bottom: 1000 },
    fill_factor: 0.8,
    max_zoom: 3,
  }));
  assert.deepEqual(cover, {
    applied: true,
    reason: 'applied',
    fit: 'cover',
    base_scale: 1,
    zoom: 2,
    image_rect: { left: -1500, top: -500, width: 4000, height: 2000 },
    focus_canvas: { x: 500, y: 500 },
    target_point: { x: 500, y: 500 },
  });

  const contain = computeCameraTransform({ ...args({
    image_width: 2000,
    image_height: 1000,
    canvas_width: 1000,
    canvas_height: 1000,
    fit: 'contain',
    region: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
    safe_rect: { left: 0, top: 0, right: 1000, bottom: 1000 },
    fill_factor: 0.8,
    max_zoom: 3,
  }) });
  assert.deepEqual(contain, {
    applied: true,
    reason: 'applied',
    fit: 'contain',
    base_scale: 0.5,
    zoom: 3,
    image_rect: { left: -1000, top: -250, width: 3000, height: 1500 },
    focus_canvas: { x: 500, y: 500 },
    target_point: { x: 500, y: 500 },
  });
}

const images = [
  ['横图', 1600, 900],
  ['竖图', 900, 1600],
  ['方图', 1000, 1000],
];
const regions = [
  ['中心', { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }],
  ['左上', { x: 0, y: 0, width: 0.2, height: 0.2 }],
  ['右上', { x: 0.8, y: 0, width: 0.2, height: 0.2 }],
  ['左下', { x: 0, y: 0.8, width: 0.2, height: 0.2 }],
  ['右下', { x: 0.8, y: 0.8, width: 0.2, height: 0.2 }],
  ['普通', { x: 0.18, y: 0.27, width: 0.34, height: 0.26 }],
  ['接近全图', { x: 0.01, y: 0.01, width: 0.98, height: 0.98 }],
  ['极小', { x: 0.499, y: 0.499, width: 0.002, height: 0.002 }],
];

for (const fit of ['cover', 'contain']) {
  for (const [imageName, image_width, image_height] of images) {
    for (const [regionName, region] of regions) {
      for (const max_zoom of [1.5, 2.4, 3]) {
        for (const safe_rect of [standardSafe, biasedSafe]) {
          for (const focus_point of [undefined, {
            x: region.x + region.width * 0.4,
            y: region.y + region.height * 0.6,
          }]) {
            const result = computeCameraTransform(args({
              image_width,
              image_height,
              fit,
              region,
              focus_point,
              max_zoom,
              safe_rect,
            }));
            assert.equal(isFiniteTree(result), true, `${fit}/${imageName}/${regionName} 必须全为有限数`);
            if (!result.applied) {
              assert.equal(result.reason, 'focus_outside_safe_rect', `${fit}/${imageName}/${regionName} 只允许因 clamp 不可满足降级`);
              continue;
            }
            assert.equal(result.zoom >= 1 && result.zoom <= max_zoom, true);
            assert.deepEqual(result.target_point, {
              x: (safe_rect.left + safe_rect.right) / 2,
              y: (safe_rect.top + safe_rect.bottom) / 2,
            });
            assert.equal(result.focus_canvas.x >= safe_rect.left - 1e-9, true);
            assert.equal(result.focus_canvas.x <= safe_rect.right + 1e-9, true);
            assert.equal(result.focus_canvas.y >= safe_rect.top - 1e-9, true);
            assert.equal(result.focus_canvas.y <= safe_rect.bottom + 1e-9, true);
            if (fit === 'cover') {
              assert.equal(result.image_rect.left <= 1e-9, true, 'cover 左侧不得露底');
              assert.equal(result.image_rect.top <= 1e-9, true, 'cover 顶部不得露底');
              assert.equal(result.image_rect.left + result.image_rect.width >= canvas.canvas_width - 1e-9, true, 'cover 右侧不得露底');
              assert.equal(result.image_rect.top + result.image_rect.height >= canvas.canvas_height - 1e-9, true, 'cover 底部不得露底');
            }
          }
        }
      }
    }
  }
}

{
  const large = computeCameraTransform(args({
    fit: 'contain',
    region: { x: 0.01, y: 0.01, width: 0.98, height: 0.98 },
    max_zoom: 3,
  }));
  assert.equal(large.zoom, 1, '超大 region 不得反向缩小');

  const tiny = computeCameraTransform(args({
    fit: 'contain',
    region: { x: 0.499, y: 0.499, width: 0.002, height: 0.002 },
    max_zoom: 2.4,
  }));
  assert.equal(tiny.zoom, 2.4, '极小 region 必须受 max_zoom 限制');

  const backgroundVisible = computeCameraTransform(args({
    image_width: 2000,
    image_height: 500,
    fit: 'contain',
    region: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
    max_zoom: 1,
  }));
  assert.equal(backgroundVisible.applied, true);
  assert.equal(backgroundVisible.image_rect.height < canvas.canvas_height, true, 'contain 前景允许露出背景层');
}

for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
  for (const key of ['image_width', 'image_height', 'canvas_width', 'canvas_height']) {
    assertNoOp(args({ [key]: value }), 'invalid_dimensions');
  }
}
for (const fit of [undefined, null, '', 'camera', 'Cover']) assertNoOp(args({ fit }), 'invalid_fit');
for (const region of [
  null,
  { x: Number.NaN, y: 0, width: 0.2, height: 0.2 },
  { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 0.2 },
  { x: -0.1, y: 0, width: 0.2, height: 0.2 },
  { x: 0, y: -0.1, width: 0.2, height: 0.2 },
  { x: 0, y: 0, width: 0, height: 0.2 },
  { x: 0, y: 0, width: 0.2, height: -1 },
  { x: 0.9, y: 0, width: 0.2, height: 0.2 },
  { x: 0, y: 0.9, width: 0.2, height: 0.2 },
]) assertNoOp(args({ region }), 'invalid_region');
for (const focus_point of [
  null,
  { x: Number.NaN, y: 0.5 },
  { x: 0.5, y: Number.POSITIVE_INFINITY },
  { x: -0.1, y: 0.5 },
  { x: 0.5, y: 1.1 },
  { x: 0.1, y: 0.5 },
]) assertNoOp(args({ focus_point }), 'invalid_focus_point');
for (const safe_rect of [
  undefined,
  null,
  { left: Number.NaN, top: 0, right: 100, bottom: 100 },
  { left: 0, top: 0, right: Number.POSITIVE_INFINITY, bottom: 100 },
  { left: -1, top: 0, right: 100, bottom: 100 },
  { left: 0, top: -1, right: 100, bottom: 100 },
  { left: 0, top: 0, right: 1081, bottom: 100 },
  { left: 0, top: 0, right: 100, bottom: 1921 },
  { left: 100, top: 0, right: 100, bottom: 100 },
  { left: 0, top: 100, right: 100, bottom: 100 },
]) assertNoOp(args({ safe_rect }), 'invalid_safe_rect');
for (const [key, values] of Object.entries({
  fill_factor: [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1, 1.1],
  max_zoom: [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 0.99],
})) {
  for (const value of values) assertNoOp(args({ [key]: value }), 'invalid_zoom_policy');
}

assertNoOp(args({
  image_width: 1000,
  image_height: 1000,
  canvas_width: 1000,
  canvas_height: 1000,
  region: { x: 0, y: 0, width: 0.1, height: 0.1 },
  safe_rect: { left: 400, top: 400, right: 600, bottom: 600 },
  max_zoom: 1,
}), 'focus_outside_safe_rect');

{
  const input = args({
    region: { x: 0.2, y: 0.3, width: 0.2, height: 0.2 },
    focus_point: { x: 0.25, y: 0.35 },
    safe_rect: { ...standardSafe },
  });
  const before = structuredClone(input);
  const first = computeCameraTransform(input);
  const second = computeCameraTransform(input);
  assert.deepEqual(input, before, '不得修改输入');
  assert.deepEqual(second, first, '相同输入必须确定性输出');
  assert.equal(isFiniteTree(first), true);
}

console.log('html-video camera math tests passed');
