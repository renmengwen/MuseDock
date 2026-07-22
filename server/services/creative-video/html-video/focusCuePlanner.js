const crypto = require('crypto');

const { canonicalCaptionTrack } = require('./visualPlanService');

// 聚焦过渡预算：合并后 cue 覆盖的字幕总窗口短于该值时，camera_zoom 降级为 highlight_only。
const FOCUS_TRANSITION_BUDGET_SEC = 1;
const TIME_EPSILON_SEC = 0.001;
const ZOOM_TRUST_LEVELS = new Set(['A', 'B', 'C']);
const CUE_TRUST_LEVELS = new Set(['A', 'B', 'C']);
const LATIN_ALNUM_RE = /[A-Za-z0-9]/;
const HAN_RE = /\p{Script=Han}/u;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 与 buildVisualPlan 的 scene/sceneId/duration 取法保持完全一致，canonical captions 才能与 shot.caption_ids 对上。
function sceneDurationSec(scene = {}) {
  const candidates = [
    scene.speech_duration_sec,
    scene.speechDurationSec,
    scene.duration_sec,
    scene.durationSec,
    scene.target_duration_sec,
    scene.targetDurationSec,
    scene.duration,
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 6;
}

function captionMapsBySceneId(sceneSpec = {}, mediaOptions = {}) {
  const scenes = Array.isArray(sceneSpec?.scenes) ? sceneSpec.scenes : [];
  const maps = new Map();
  scenes.forEach((sceneInput, sceneIndex) => {
    const scene = sceneInput && typeof sceneInput === 'object' ? sceneInput : {};
    const sceneId = text(scene.id || scene.scene_id) || `scene_${String(sceneIndex + 1).padStart(2, '0')}`;
    if (maps.has(sceneId)) return;
    const canonical = canonicalCaptionTrack(scene, sceneId, sceneDurationSec(scene), mediaOptions);
    maps.set(sceneId, new Map(canonical.captions.map(caption => [text(caption.id), caption])));
  });
  return maps;
}

function firstAssetById(creativeContext = {}) {
  const assets = Array.isArray(creativeContext?.asset_context?.assets)
    ? creativeContext.asset_context.assets
    : [];
  const byId = new Map();
  for (const asset of assets) {
    const id = text(asset?.id || asset?.asset_id);
    if (id && !byId.has(id)) byId.set(id, asset);
  }
  return byId;
}

function usableRegions(asset = {}) {
  const regions = Array.isArray(asset?.focus_regions) ? asset.focus_regions : [];
  return regions.filter(region => (
    region && typeof region === 'object' && !Array.isArray(region) && text(region.id) && text(region.label)
  ));
}

// 通用匹配器：在原文 code point 边界上做大小写不敏感扫描，返回原文 UTF-16 索引与实际片段。
// 拉丁词边界：term 端点是 [A-Za-z0-9] 时，该侧相邻字符不得也是 [A-Za-z0-9]（防 "star" 误命中 "restart"）；
// 单汉字 term 若紧邻其他汉字则拒绝（防“头”误命中“镜头/头部”）；多字 CJK 保持子串匹配。
// 被拒绝的位置继续向后扫描。
function keywordOccurrenceMatch(captionText, term) {
  const source = String(captionText || '');
  const query = String(term || '');
  const needle = query.toLowerCase();
  if (!needle) return null;
  const foldedSource = source.toLowerCase();
  const boundaryBefore = LATIN_ALNUM_RE.test(needle[0]);
  const boundaryAfter = LATIN_ALNUM_RE.test(needle[needle.length - 1]);
  const singleHan = Array.from(needle).length === 1 && HAN_RE.test(needle);
  const points = [];
  let offset = 0;
  for (const value of source) {
    points.push({ value, start: offset, end: offset + value.length });
    offset += value.length;
  }
  // ponytail: 前缀折叠是 O(n²)，但 canonical caption 有 34 字上限；上限放开后再引入专用 case-fold offset 映射。
  const boundaryByFoldedOffset = new Map([[0, { sourceOffset: 0, pointIndex: 0 }]]);
  for (let index = 0; index < points.length; index += 1) {
    const sourceOffset = points[index].end;
    boundaryByFoldedOffset.set(source.slice(0, sourceOffset).toLowerCase().length, {
      sourceOffset,
      pointIndex: index + 1,
    });
  }
  let from = 0;
  while (from + needle.length <= foldedSource.length) {
    const index = foldedSource.indexOf(needle, from);
    if (index < 0) return null;
    const start = boundaryByFoldedOffset.get(index);
    const end = boundaryByFoldedOffset.get(index + needle.length);
    if (start && end) {
      const before = points[start.pointIndex - 1]?.value || '';
      const after = points[end.pointIndex]?.value || '';
      if ((!boundaryBefore || !LATIN_ALNUM_RE.test(before))
        && (!boundaryAfter || !LATIN_ALNUM_RE.test(after))
        && (!singleHan || (!HAN_RE.test(before) && !HAN_RE.test(after)))) {
        return {
          index: start.sourceOffset,
          end: end.sourceOffset,
          keyword: source.slice(start.sourceOffset, end.sourceOffset),
        };
      }
    }
    from = index + 1;
  }
  return null;
}

function keywordOccurrence(captionText, term) {
  return keywordOccurrenceMatch(captionText, term)?.keyword || '';
}

function mainCanvasOccurrence(captionText, regions) {
  const occurrence = String(captionText || '').match(/主(?:视频|预览|编辑)画布/u);
  if (!occurrence) return null;
  const canvasRegions = regions.filter(region => (
    [region.label, ...(Array.isArray(region.aliases) ? region.aliases : [])]
      .map(text)
      .some(term => /^(?:主(?:视频|预览|编辑)画布|视频画面|编辑预览区|编辑画面|主预览区)$/u.test(term))
  ));
  return canvasRegions.length === 1 ? { region: canvasRegions[0], keyword: occurrence[0] } : null;
}

function taskInfoCardOccurrence(captionText, regions) {
  const occurrence = String(captionText || '').match(/任务信息卡(?:片)?/u);
  if (!occurrence) return null;
  const cardRegions = regions.filter(region => (
    [region.label, ...(Array.isArray(region.aliases) ? region.aliases : [])]
      .map(text)
      .some(term => /^(?:页面任务信息卡|任务信息卡(?:片)?)$/u.test(term))
  ));
  return cardRegions.length === 1 ? { region: cardRegions[0], keyword: occurrence[0] } : null;
}

function resolveCaptionFocus(caption, regions) {
  const captionText = typeof caption.text === 'string' ? caption.text : '';
  const hits = [];
  for (const region of regions) {
    const terms = [region.label, ...(Array.isArray(region.aliases) ? region.aliases : [])];
    for (const term of terms) {
      const keyword = keywordOccurrence(captionText, text(term));
      if (!keyword) continue;
      hits.push({ region, keyword });
      break;
    }
  }
  // 同一 caption 命中多个 region 时无法消歧，放弃聚焦。
  if (hits.length === 1) return hits[0];
  if (hits.length > 0) return null;
  const fallbackHits = [
    mainCanvasOccurrence(captionText, regions),
    taskInfoCardOccurrence(captionText, regions),
  ].filter(Boolean);
  return fallbackHits.length === 1 ? fallbackHits[0] : null;
}

function cueId(shot, regionIdValue, captionIds) {
  const hash = crypto.createHash('sha256')
    .update(['focus_cue', text(shot.id) || text(shot.asset_id), regionIdValue, ...captionIds].join('\n'))
    .digest('hex')
    .slice(0, 16);
  return `cue_${hash}`;
}

function focusCuesForShot({ shot, regions, captionById }) {
  // 同 region 连续合并（REQ-D-09）：未命中的 caption 不打断合并，命中其他 region 的 caption 打断。
  const runs = [];
  let current = null;
  for (const rawCaptionId of (Array.isArray(shot.caption_ids) ? shot.caption_ids : [])) {
    const caption = captionById.get(text(rawCaptionId));
    if (!caption) continue;
    const hit = resolveCaptionFocus(caption, regions);
    if (!hit) continue;
    if (current && current.region === hit.region) {
      current.caption_ids.push(text(caption.id));
      current.keywords_by_caption_id[text(caption.id)] = hit.keyword;
      current.captions.push(caption);
      continue;
    }
    current = {
      region: hit.region,
      keyword: hit.keyword,
      caption_ids: [text(caption.id)],
      keywords_by_caption_id: { [text(caption.id)]: hit.keyword },
      captions: [caption],
    };
    runs.push(current);
  }
  const cues = [];
  for (const run of runs) {
    const trustLevel = text(run.region.trust_level).toUpperCase();
    if (!CUE_TRUST_LEVELS.has(trustLevel)) continue;
    const windowSec = Math.max(...run.captions.map(caption => Number(caption.end)))
      - Math.min(...run.captions.map(caption => Number(caption.start)));
    const zoomAllowed = ZOOM_TRUST_LEVELS.has(trustLevel)
      && windowSec + TIME_EPSILON_SEC >= FOCUS_TRANSITION_BUDGET_SEC;
    cues.push({
      id: cueId(shot, text(run.region.id), run.caption_ids),
      caption_ids: run.caption_ids,
      keyword: run.keyword,
      keywords_by_caption_id: run.keywords_by_caption_id,
      region_id: text(run.region.id),
      effect: zoomAllowed ? 'camera_zoom' : 'highlight_only',
      ...(zoomAllowed ? { zoom: trustLevel === 'C' ? 'soft' : 'auto' } : {}),
      return_policy: 'hold_or_next',
    });
  }
  return cues;
}

// 确定性摄影机规划：只 enrich image_sequence shot 的 camera，不做 I/O、不打模型调用，
// cue 不写 start_sec/end_sec（运行时从 caption 派生），diagram/无图 beat 与 motion_overlay 保持原样。
// 无 cue 的 shot 不写 camera：帧输入指纹整包哈希 visual_beat，空 camera 会让存量工程 resume 全量失配重生成。
function planFocusCues({ visualPlan = {}, creativeContext = {}, sceneSpec = {}, mediaOptions = {} } = {}) {
  const beats = Array.isArray(visualPlan?.beats) ? visualPlan.beats : [];
  if (!beats.length) return visualPlan;
  const captionMaps = captionMapsBySceneId(sceneSpec, mediaOptions);
  const assetById = firstAssetById(creativeContext);
  for (const beat of beats) {
    const base = beat?.visual_base;
    if (!base || base.type !== 'image_sequence' || !Array.isArray(base.shots)) continue;
    const captionById = captionMaps.get(text(beat.scene_id)) || new Map();
    for (const shot of base.shots) {
      if (!shot || typeof shot !== 'object') continue;
      const focusCues = focusCuesForShot({
        shot,
        regions: usableRegions(assetById.get(text(shot.asset_id))),
        captionById,
      });
      if (!focusCues.length) continue;
      shot.camera = { initial_view: 'overview', focus_cues: focusCues };
    }
  }
  return visualPlan;
}

module.exports = {
  FOCUS_TRANSITION_BUDGET_SEC,
  keywordOccurrence,
  keywordOccurrenceMatch,
  planFocusCues,
};
