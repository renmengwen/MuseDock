const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));

export function dragRegion(base, handle, dx, dy, canvas) {
  if (handle === 'move') return { ...base, x: clamp(base.x + dx, 0, canvas.width - base.width),
    y: clamp(base.y + dy, 0, canvas.height - base.height) };
  let left = base.x; let right = left + base.width; let top = base.y; let bottom = top + base.height;
  const min = Math.min(20, base.width, base.height);
  if (handle.includes('l')) left = clamp(left + dx, 0, right - min);
  if (handle.includes('r')) right = clamp(right + dx, left + min, canvas.width);
  if (handle.includes('t')) top = clamp(top + dy, 0, bottom - min);
  if (handle.includes('b')) bottom = clamp(bottom + dy, top + min, canvas.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function resizedPolygon(element, region) {
  const from = element.region;
  return element.polygon?.map(([x, y]) => [region.x + Math.round((x - from.x) * (region.width - 1) / Math.max(1, from.width - 1)),
    region.y + Math.round((y - from.y) * (region.height - 1) / Math.max(1, from.height - 1))]);
}

export function reorderRegions(elements, from, to) {
  const next = [...elements];
  const [element] = next.splice(from, 1);
  next.splice(to, 0, element);
  return next;
}
