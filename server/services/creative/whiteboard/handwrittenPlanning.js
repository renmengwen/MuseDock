const { WhiteboardError, renderingFor } = require('./contracts');

const CONTRACT = 'handwritten-semantic-regions-v1';
const MAX_REGIONS = 24;
const MIN_REVEAL_MS = 100;
const HOLD_MS = 500;

function prompt({ scene, cues, revision, canvas, imageTexts = [] }) {
  const duration = scene.endMs - scene.startMs;
  const budget = Number.isFinite(duration) ? Math.min(MAX_REGIONS, Math.max(1, Math.floor((duration - HOLD_MS) / MIN_REVEAL_MS))) : MAX_REGIONS;
  return [
    `实际检查这张 ${canvas.width}×${canvas.height} 白底手写图解，按本幕叙事顺序标注语义区域。`,
    '保留图中的原始手写字形与黑、红、蓝、橙配色；标题、人物、词组、气泡、关系线、结论可分别揭示。人物与词组必须完整，不按单字笔顺拆分，不强制切成固定数量，也不用整图大框合并能够独立揭示的元素。',
    '每个 region 完整包围该语义元素。人物邻接气泡或箭头时，可增加 polygon 沿空白边界避开邻近墨迹；不能让矩形或多边形边界穿过文字和气泡边线。后续区域的有效形状会从当前区域扣除，protectedRegions 通常为 []。',
    '全部有效墨迹包括强调线、箭头、装饰线都要有归属，覆盖率至少 97%；未标注内容不会在片尾补显。逐区以原色起笔，沿图像笔迹渐显，不是真实汉字笔顺。',
    `只返回 schemaVersion=3 的 JSON 对象。visualGrouping={mode,reason}，mode 为 semantic_regions（多个语义区域）或 single_continuous（一个不可拆分的完整图形），reason 为 8–600 字的具体中文分组依据。elements 为 1–${budget} 项数组，硬上限 ${MAX_REGIONS}；短幕合并相关元素以保证每区至少 ${MIN_REVEAL_MS} 毫秒，末尾保留 ${HOLD_MS} 毫秒。`,
    'elements 每项包含 label、region、direction、weight、protectedRegions，可选 polygon。label 为 1–80 字中文名称；region={x,y,width,height} 是画布内的整数矩形；polygon 是 3–32 个 [x,y] 整数点组成的简单多边形，所有点均位于本区域矩形内，不自交；省略时使用矩形。direction 只能为 left-to-right、right-to-left、top-to-bottom、bottom-to-top；weight 是大于 0 且不超过 100 的相对绘制权重；protectedRegions 最多 8 个矩形。',
    '程序根据实际幕长与权重分配时间，不输出时间、路径、批准或状态。',
    `画内原文核对清单：${JSON.stringify(imageTexts)}。先检查实图文字，不擅自补写或改字；无法辨认的区域在 label 中说明，不能声称已经核对通过。`,
    `本幕与真实字幕时间：${JSON.stringify({ scene, cues })}`,
    revision ? `用户对本幕的明确修订：${revision}` : '',
  ].filter(Boolean).join('\n');
}

function validRect(rect, canvas) {
  return rect && typeof rect === 'object' && !Array.isArray(rect)
    && Object.keys(rect).every(key => ['x', 'y', 'width', 'height'].includes(key))
    && ['x', 'y', 'width', 'height'].every(key => Number.isInteger(rect[key]))
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= canvas.width && rect.y + rect.height <= canvas.height;
}

function validPolygon(points, rect) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 32 || !rect
    || points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isInteger)
      || point[0] < rect.x || point[1] < rect.y || point[0] >= rect.x + rect.width || point[1] >= rect.y + rect.height)
    || new Set(points.map(point => point.join(','))).size !== points.length) return false;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a, b, p) => cross(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0])
    && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
  const intersects = (a, b, c, d) => (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
    || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 2; j < points.length; j += 1) {
      if (i === 0 && j === points.length - 1) continue;
      if (intersects(a, b, points[j], points[(j + 1) % points.length])) return false;
    }
  }
  return Math.abs(area) > 0;
}

function validate(candidate, canvas, scene) {
  if (!candidate || candidate.schemaVersion !== 3 || !Array.isArray(candidate.elements)
    || !candidate.elements.length || candidate.elements.length > MAX_REGIONS) return ['白底手写图解使用 schemaVersion=3，elements 必须包含 1–24 个语义区域。'];
  const errors = [];
  if (Object.keys(candidate).some(key => !['schemaVersion', 'visualGrouping', 'elements'].includes(key))) errors.push('候选包含合同外字段。');
  const grouping = candidate.visualGrouping;
  if (!grouping || !['semantic_regions', 'single_continuous'].includes(grouping.mode)
    || typeof grouping.reason !== 'string' || grouping.reason.trim().length < 8 || grouping.reason.length > 600
    || Object.keys(grouping).some(key => !['mode', 'reason'].includes(key))) errors.push('visualGrouping 必须说明语义分区及具体中文依据。');
  if (grouping?.mode === 'single_continuous' && candidate.elements.length !== 1) errors.push('single_continuous 只能有一个完整区域。');
  if (grouping?.mode === 'semantic_regions' && candidate.elements.length < 2) errors.push('semantic_regions 至少需要两个语义区域。');
  if (scene && scene.endMs - scene.startMs < candidate.elements.length * MIN_REVEAL_MS + HOLD_MS) errors.push('本幕时长不足，请合并区域，保证每区至少 100 毫秒与片尾半秒停留。');
  for (const [index, element] of candidate.elements.entries()) {
    if (!element || typeof element !== 'object' || Array.isArray(element)) { errors.push(`区域 ${index + 1} 必须为对象。`); continue; }
    if (Object.keys(element).some(key => !['label', 'region', 'polygon', 'direction', 'weight', 'protectedRegions'].includes(key))) errors.push(`区域 ${index + 1} 包含合同外字段。`);
    if (typeof element.label !== 'string' || !element.label.trim() || element.label.length > 80) errors.push('label 必须是简短中文名称。');
    if (!validRect(element.region, canvas)) errors.push(`区域 ${index + 1} 超出画布或不是整数矩形。`);
    if (element.polygon !== undefined && !validPolygon(element.polygon, element.region)) errors.push(`区域 ${index + 1} 的 polygon 必须是矩形内不自交的 3–32 个不同整数点。`);
    if (!['left-to-right', 'right-to-left', 'top-to-bottom', 'bottom-to-top'].includes(element.direction)) errors.push('direction 不受支持。');
    if (!Number.isFinite(element.weight) || element.weight <= 0 || element.weight > 100) errors.push('weight 必须是 0 至 100 的正数。');
    if (!Array.isArray(element.protectedRegions) || element.protectedRegions.length > 8 || element.protectedRegions.some(rect => !validRect(rect, canvas))) errors.push('protectedRegions 必须是最多 8 个画布内矩形。');
  }
  return errors;
}

function materialize(candidate, scene, imageSha256, timingIdentity, canvas, visualStyle) {
  const errors = validate(candidate, canvas, scene);
  if (errors.length) throw new WhiteboardError('CANDIDATE_INVALID', errors.join(' '));
  const available = scene.endMs - scene.startMs - HOLD_MS - candidate.elements.length * MIN_REVEAL_MS;
  const total = candidate.elements.reduce((sum, element) => sum + element.weight, 0);
  let weight = 0;
  return { schemaVersion: 1, sceneId: scene.id, canvas: { ...canvas }, sceneDurationMs: scene.endMs - scene.startMs,
    imageSha256, timingIdentity, rendering: renderingFor(visualStyle),
    elements: candidate.elements.map((element, index) => {
      const startMs = index * MIN_REVEAL_MS + Math.round(available * weight / total);
      weight += element.weight;
      const endMs = (index + 1) * MIN_REVEAL_MS + Math.round(available * weight / total);
      return { id: `element_${index + 1}`, sequence: index + 1, label: element.label, region: element.region,
        ...(element.polygon ? { polygon: element.polygon } : {}),
        reveal: { startMs, durationMs: endMs - startMs, direction: element.direction, protectedRegions: element.protectedRegions } };
    }) };
}

function lineartPrompt(artifact, scene, canvas, revision) {
  renderingFor(artifact.visualStyle);
  return [
    `绘制白底手写图解。构图比例 ${artifact.aspectRatio || '16:9'}，最终画布 ${canvas.width}×${canvas.height}；${canvas.height > canvas.width ? '画面高度明显大于宽度，按纵向安排语义区域' : '按横向画布安排语义区域'}。尺寸和比例只描述纸面，不能画成文字或设备。`,
    artifact.visualStyle.promptRecipe,
    `本幕画面：${scene.imagePrompt}`,
    `唯一允许的画内原文 imageTexts：${JSON.stringify(scene.imageTexts)}。逐字检查，不用同义词替代，不额外添加气泡文字、装饰问号或字幕。空数组表示不画文字。`,
    '底部约 18% 保持完全空白，供可选的两行字幕使用；标题、结论和人物避开该区域及四周边缘。',
    '纯白画布，红蓝关键词从起笔就保留原色；不要添加暖米黄纸色，不绘制实体白板、手机、屏幕或画外绘图手。',
    revision ? `用户对本幕的明确修订：${revision}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = { CONTRACT, prompt, validate, materialize, lineartPrompt };
