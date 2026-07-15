const { closestFrameAt, uniqueMatchedFrames, isBlankFrameMetric } = require('./frameSampling');

function analyzeTimedSafetyMetrics({ frames = [], opening = [], boundaryGroups = [] } = {}) {
  const issues = [];
  const openingBlank = uniqueMatchedFrames(opening
    .map(time => closestFrameAt(frames, time))
    .filter(Boolean))
    .filter(isBlankFrameMetric);
  if (openingBlank.length >= 2) {
    issues.push({
      code: 'blank_opening_frame',
      message: '开头抽样帧接近空白，可能录入了页面加载白屏。',
      times: openingBlank.map(frame => frame.time_sec),
    });
  }
  for (const group of boundaryGroups) {
    // P2-3：白屏阻断只消费安全点（safety_times）；差分专用点（diff_times）落在
    // 空白区不应改变安全检查口径。旧形态组（无 safety_times）回落 times，向后兼容。
    const safetyTimes = Array.isArray(group.safety_times) ? group.safety_times : group.times;
    const blank = uniqueMatchedFrames(safetyTimes
      .map(time => closestFrameAt(frames, time))
      .filter(Boolean))
      .filter(isBlankFrameMetric);
    if (blank.length >= 2) {
      issues.push({
        code: 'blank_segment_boundary',
        message: `镜头边界 ${group.boundary_sec}s 附近出现连续空白帧。`,
        boundary_sec: group.boundary_sec,
        times: blank.map(frame => frame.time_sec),
      });
    }
  }
  return {
    issues,
    metrics: {
      timed_sample_count: frames.length,
      blank_timed_sample_count: frames.filter(isBlankFrameMetric).length,
      sampled_boundary_count: boundaryGroups.length,
    },
  };
}

// 差分用真实指标字段（readRgbFrameMetrics 产出）：average_luma 与 edge_score 均为 0-255 标度
//（edge_score = 相邻像素亮度差平均，累计的是 0-255 亮度差），两分量统一 /255 归一到 0-1
// 后共用 diffThreshold，避免 edge 原始梯度微小变化（量级几十）单独触发（P2-5）。
function boundaryDiffScore(before = {}, after = {}) {
  const luma = Math.abs((Number(after.average_luma) || 0) - (Number(before.average_luma) || 0)) / 255;
  const edges = Math.abs((Number(after.edge_score) || 0) - (Number(before.edge_score) || 0)) / 255;
  return Math.max(luma, edges);
}

function analyzeAssetFirstBoundaries(boundaryGroups = [], { diffThreshold = 0.25 } = {}) {
  const warnings = [];
  const hasFiniteMetrics = frame => (
    Number.isFinite(Number(frame?.average_luma)) && Number.isFinite(Number(frame?.edge_score))
  );
  for (const group of Array.isArray(boundaryGroups) ? boundaryGroups : []) {
    if (group.same_scene !== true) continue;
    if (!group.before || !group.after) continue; // 成对采样缺帧时跳过，不误报
    // 指标非有限值（如兜底空对象）与缺帧同语义：跳过该组
    if (!hasFiniteMetrics(group.before) || !hasFiniteMetrics(group.after)) continue;
    const score = boundaryDiffScore(group.before, group.after);
    if (score > diffThreshold) {
      warnings.push({
        code: 'asset_first_boundary_refresh',
        severity: 'warning',
        message: `同 scene 边界 ${group.boundary_sec}s 前后画面差异 ${score.toFixed(2)}，疑似整帧重刷。`,
        details: { scene_id: group.scene_id, boundary_sec: group.boundary_sec, score },
      });
    }
  }
  return warnings;
}

function analyzeAssetFirstCaptionRegion(frames = [], { minVariance = 0.01 } = {}) {
  const warnings = [];
  for (const frame of Array.isArray(frames) ? frames : []) {
    if (frame.caption_active !== true) continue;
    const variance = Number(frame.bottom_region?.variance) || 0;
    if (variance < minVariance) {
      warnings.push({
        code: 'asset_first_caption_invisible',
        severity: 'warning',
        message: `${frame.time}s 字幕应显示但底部字幕区无可读内容。`,
        details: { time: frame.time, variance },
      });
    }
  }
  return warnings;
}

// 信息密度：无图 beat（has_asset !== true）的帧内元素统计低于阈值 => warning。
// review P2-3(b)：scene_html 回落展开把整 scene 统计复制到组内每个 beat（stats_scope:'scene'），
// 该类条目按 scene 去重只报一条、message 说明是 scene 级聚合观察，避免被 scene 总数掩盖/重复。
// TODO(P2-3b)：真正的逐 beat 密度分析需要渲染期分 beat 截帧统计，本轮不做。
function analyzeAssetFirstInformation(beatsInfo = [], { minElements = 3 } = {}) {
  const warnings = [];
  const seenScenes = new Set();
  for (const beat of Array.isArray(beatsInfo) ? beatsInfo : []) {
    if (!beat || beat.has_asset === true) continue;
    const sceneScoped = beat.stats_scope === 'scene';
    if (sceneScoped) {
      const sceneKey = String(beat.scene_id || '');
      if (seenScenes.has(sceneKey)) continue;
      seenScenes.add(sceneKey);
    }
    const elements = (Number(beat.text_blocks) || 0) + (Number(beat.cards) || 0) + (Number(beat.graphics) || 0);
    if (elements < minElements) {
      warnings.push({
        code: 'asset_first_low_information',
        severity: 'warning',
        message: sceneScoped
          ? `scene ${beat.scene_id} 画面元素仅 ${elements} 个（< ${minElements}），信息密度不足（scene 级聚合观察，非逐 beat 统计）。`
          : `无图 beat ${beat.beat_id} 画面元素仅 ${elements} 个（< ${minElements}），信息密度不足。`,
        details: {
          beat_id: beat.beat_id,
          elements,
          min_elements: minElements,
          ...(sceneScoped ? { stats_scope: 'scene', scene_id: beat.scene_id } : {}),
        },
      });
    }
  }
  return warnings;
}

// 风格漂移：相邻帧平均色任一通道突变超过阈值 => 单条 warning（取全片最大突变点）。
// sceneCutTimes（跨 scene 边界秒列表）给出时，横跨任一边界 ±0.35s 的帧对跳过——
// 跨 scene 硬切是合法设计，style_drift 语义是同场景内漂移/整体断裂（P2-4）。
function analyzeAssetFirstStyleDrift(frames = [], { maxMeanShift = 96, sceneCutTimes = [] } = {}) {
  const cuts = (Array.isArray(sceneCutTimes) ? sceneCutTimes : [])
    .map(Number)
    .filter(Number.isFinite);
  const frameTime = frame => Number(frame.time ?? frame.time_sec);
  const list = (Array.isArray(frames) ? frames : []).filter(frame => (
    Array.isArray(frame?.mean_rgb)
    && frame.mean_rgb.length >= 3
    && frame.mean_rgb.slice(0, 3).every(value => Number.isFinite(Number(value)))
  ));
  let worst = null;
  for (let index = 1; index < list.length; index += 1) {
    const previousTime = frameTime(list[index - 1]);
    const currentTime = frameTime(list[index]);
    // 帧对时间区间与任一跨 scene 边界 ±0.35s 相交 => 该对差分归因于合法硬切，跳过
    if (
      Number.isFinite(previousTime) && Number.isFinite(currentTime)
      && cuts.some(cut => previousTime <= cut + 0.35 && currentTime >= cut - 0.35)
    ) continue;
    const previous = list[index - 1].mean_rgb;
    const current = list[index].mean_rgb;
    const shift = Math.max(
      Math.abs(Number(current[0]) - Number(previous[0])),
      Math.abs(Number(current[1]) - Number(previous[1])),
      Math.abs(Number(current[2]) - Number(previous[2])),
    );
    if (shift > maxMeanShift && (!worst || shift > worst.shift)) {
      worst = {
        shift,
        time: list[index].time ?? list[index].time_sec ?? null,
        from_time: list[index - 1].time ?? list[index - 1].time_sec ?? null,
      };
    }
  }
  if (!worst) return [];
  return [{
    code: 'asset_first_style_drift',
    severity: 'warning',
    message: `帧平均色在 ${worst.time}s 附近突变（差值 ${Math.round(worst.shift)} > ${maxMeanShift}），疑似整体风格漂移。`,
    details: {
      time: worst.time,
      from_time: worst.from_time,
      shift: Math.round(worst.shift * 100) / 100,
      max_mean_shift: maxMeanShift,
    },
  }];
}

// style_drift 观测窗口（P2-4）：生产顺序抽帧 fps=2/maxFrames=24 只覆盖前 ~12s，
// timed 采样帧（opening + 边界组）覆盖全片时间点且同样携带 mean_rgb。
// 二者合并、按时间排序、同一时间点（毫秒精度）去重后作为 style_drift 输入，
// 使 40s+ 级的整体断裂也可观测。无时间戳的帧（人工注入等）保留在末尾原顺序。
function mergeStyleDriftObservationFrames(sequentialFrames = [], timedFrames = []) {
  const seen = new Set();
  const timeless = [];
  const timestamped = [];
  for (const frame of [...(Array.isArray(sequentialFrames) ? sequentialFrames : []), ...(Array.isArray(timedFrames) ? timedFrames : [])]) {
    if (!frame) continue;
    const time = Number(frame.time ?? frame.time_sec);
    if (!Number.isFinite(time)) {
      timeless.push(frame);
      continue;
    }
    const key = (Math.round(time * 1000) / 1000).toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    timestamped.push({ frame, time });
  }
  timestamped.sort((left, right) => left.time - right.time);
  return [...timestamped.map(item => item.frame), ...timeless];
}

// 素材缺失：复用 workflow 级 asset_usage_report（R6：真实结构无 report.missing 字段）。
// review P2-6：生产端 expected_in_frames 实际写的是 scene_id（htmlVideoWorkflow 的 asset usage
// 报告按 sceneId 收集），首个值按真实语义放 details.scene_id，beat_id 不再伪装（恒 null）；
// 定向重试由 repairActionForQaIssue 按 scene_id 查该 scene 的全部 beat。拿不到时置 null，不伪造。
function mapAssetUsageToQaWarnings(report = {}) {
  const missing = Array.isArray(report?.missing_required_asset_ids)
    ? report.missing_required_asset_ids.filter(Boolean)
    : [];
  if (!missing.length) return [];
  const assetsById = new Map((Array.isArray(report?.assets) ? report.assets : [])
    .filter(asset => asset && asset.asset_id)
    .map(asset => [String(asset.asset_id), asset]));
  return missing.map(assetId => {
    const asset = assetsById.get(String(assetId)) || {};
    const expected = Array.isArray(asset.expected_in_frames) ? asset.expected_in_frames.filter(Boolean) : [];
    return {
      code: 'asset_first_asset_missing',
      severity: 'warning',
      message: `必用素材 ${assetId} 未进入最终画面。`,
      details: {
        asset_id: assetId,
        expected_in_frames: expected,
        scene_id: expected.length ? expected[0] : null,
        beat_id: null,
      },
    };
  });
}

// overlay 校验：透传 render_decisions[].overlay_check 的字幕安全区违规与人工复核项。
// scene_html 回落展开会把整场景 stats 复制到组内每个 beat（stats_scope:'scene' 标记，
// 见 mergeFrameStatsIntoDecisions），该类决策按 scene_id+reason_code 去重只报一条，避免 N 倍重复。
function mapOverlayChecksToQaWarnings(decisions = []) {
  const warnings = [];
  const seenSceneScoped = new Set();
  for (const decision of Array.isArray(decisions) ? decisions : []) {
    const check = decision?.overlay_check;
    const captionOverlap = check?.valid === false && check.reason_code === 'overlay_in_caption_safe_area';
    const positionIndeterminate = check?.indeterminate === true;
    if (!captionOverlap && !positionIndeterminate) continue;
    const warningCode = captionOverlap
      ? 'asset_first_overlay_caption_overlap'
      : 'asset_first_overlay_position_indeterminate';
    const sceneScoped = decision.stats_scope === 'scene';
    // P2-7：scene_html 下整 scene stats 复制 + 按 scene 去重后，decision.beat_id 是复制组
    // 首个 beat 而非真实越界 beat——真实定位在 validateOverlayHtml 的 details.beat_scope
    //（frameHtmlStatsEntry 原样存整个返回值，details 已保留）。scene 级条目 beat_id 用
    // beat_scope（拿不到置 null，不伪造）；beat 级条目维持 decision.beat_id（本就准确）。
    const beatScope = check.details && typeof check.details === 'object'
      ? (check.details.beat_scope || null)
      : null;
    if (sceneScoped) {
      // 去重键纳入 beat_scope：同 scene 不同越界 beat 是不同问题，不得被静默吞掉
      const key = `${String(decision.scene_id || '')}:${warningCode}:${String(beatScope || '')}`;
      if (seenSceneScoped.has(key)) continue;
      seenSceneScoped.add(key);
    }
    warnings.push({
      code: warningCode,
      severity: 'warning',
      message: positionIndeterminate
        ? (check.message || 'motion overlay 定位值无法静态确认安全区合规，请人工复核。')
        : (sceneScoped
          ? `scene ${decision.scene_id} 的 motion overlay 落入字幕安全区。`
          : `beat ${decision.beat_id} 的 motion overlay 落入字幕安全区。`),
      details: {
        beat_id: sceneScoped ? beatScope : decision.beat_id,
        overlay_beat_scope: beatScope,
        reason_code: check.reason_code || (positionIndeterminate ? 'overlay_position_indeterminate' : ''),
        reason: check.message || '',
        ...(sceneScoped ? { stats_scope: 'scene', scene_id: decision.scene_id } : {}),
      },
    });
  }
  return warnings;
}

// beatsInfo 从 render_decisions 构造（R4 已把 text_blocks/cards/graphics 合并进决策）。
// has_asset 按 route_role==='asset_overlay' 判定：asset_first 路由仅在 beat 携带 asset_refs
// 时给该角色，语义等价于回查 visual_plan 且实现更简单。无任何统计字段的决策跳过
//（stats 未合并时不对该 beat 做密度判断，避免误报）。
function beatsInfoFromRenderDecisions(decisions = []) {
  const beatsInfo = [];
  for (const decision of Array.isArray(decisions) ? decisions : []) {
    if (!decision || !decision.beat_id) continue;
    const hasStats = ['text_blocks', 'cards', 'graphics']
      .some(key => Number.isFinite(Number(decision[key])));
    if (!hasStats) continue;
    beatsInfo.push({
      beat_id: decision.beat_id,
      has_asset: decision.route_role === 'asset_overlay',
      text_blocks: Number(decision.text_blocks) || 0,
      cards: Number(decision.cards) || 0,
      graphics: Number(decision.graphics) || 0,
      // P2-3(b)：scene_html 回落展开标记透传，供信息密度分析按 scene 去重
      ...(decision.stats_scope === 'scene' ? { stats_scope: 'scene', scene_id: decision.scene_id } : {}),
    });
  }
  return beatsInfo;
}

// 成对边界组装：同 scene 边界前后各取最近采样帧供差分；缺帧留空由分析函数跳过。
// 优先消费组内 diff_times（pairedGroupFields 产出的差分点，单一事实来源），
// 旧形态组（无 diff_times）回落 boundary_sec∓0.3 重算，避免偏移量双处硬编码漂移。
function assembleBoundaryGroupsForDiff(boundaryGroups = [], frames = []) {
  return (Array.isArray(boundaryGroups) ? boundaryGroups : [])
    .filter(group => group.same_scene === true)
    .map(group => {
      const diffTimes = Array.isArray(group.diff_times) && group.diff_times.length
        ? group.diff_times
        : [group.boundary_sec - 0.3, group.boundary_sec + 0.3];
      return {
        ...group,
        before: closestFrameAt(frames, Math.min(...diffTimes)),
        after: closestFrameAt(frames, Math.max(...diffTimes)),
      };
    });
}

// 字幕区帧视图：采样帧时间对 voice window 求交得 caption_active，携带底部条带统计；
// timedFrames 与 fps 网格可能在同一时间点各出一帧，按 time_sec（毫秒精度）去重避免成对重复告警
function captionRegionFramesFromSamples(frames = [], voiceWindows = []) {
  const windows = Array.isArray(voiceWindows) ? voiceWindows : [];
  const seenTimes = new Set();
  const result = [];
  for (const frame of Array.isArray(frames) ? frames : []) {
    if (!frame || !frame.bottom_region || !Number.isFinite(Number(frame.time_sec))) continue;
    const time = Number(frame.time_sec);
    const key = (Math.round(time * 1000) / 1000).toFixed(3);
    if (seenTimes.has(key)) continue;
    seenTimes.add(key);
    result.push({
      time,
      caption_active: windows.some(window => time >= window.start && time <= window.end),
      bottom_region: frame.bottom_region,
    });
  }
  return result;
}

module.exports = {
  analyzeTimedSafetyMetrics,
  analyzeAssetFirstBoundaries,
  analyzeAssetFirstCaptionRegion,
  analyzeAssetFirstInformation,
  analyzeAssetFirstStyleDrift,
  mergeStyleDriftObservationFrames,
  mapAssetUsageToQaWarnings,
  mapOverlayChecksToQaWarnings,
  beatsInfoFromRenderDecisions,
  assembleBoundaryGroupsForDiff,
  captionRegionFramesFromSamples,
};
