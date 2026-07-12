// 视觉 QA 共享常量与工具：htmlVideoWorkflow / resumeExecutor / retryPlanner 三处
// 对「阻断性白屏问题」的判定必须字面一致，避免主流程与 resume 路径漂移。
// 本模块保持零依赖（纯常量/纯函数），供各消费方单向引用。

// 阻断性视觉问题 code：开头白屏 / 镜头边界白屏
const BLOCKING_VISUAL_QA_CODES = ['blank_opening_frame', 'blank_segment_boundary'];

function isBlockingVisualQaCode(code) {
  return BLOCKING_VISUAL_QA_CODES.includes(String(code || '').trim());
}

// P1-6：视觉质检 warnings（asset_first 观测通道）非阻断透出时的投影摘要。
// details 只保留定位字段（beat_id/scene_id/time 等）控制投影体积。
function summarizeVisualQaWarnings(warnings) {
  if (!Array.isArray(warnings)) return [];
  return warnings
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const details = item.details && typeof item.details === 'object' && !Array.isArray(item.details)
        ? item.details
        : {};
      const summary = {};
      for (const key of ['beat_id', 'scene_id', 'frame_id', 'time', 'boundary_sec', 'overlay_beat_scope']) {
        if (details[key] !== undefined) summary[key] = details[key];
      }
      if (Array.isArray(details.beats)) {
        const beatIds = details.beats.map(beat => beat?.beat_id).filter(Boolean).slice(0, 20);
        if (beatIds.length) summary.beat_ids = beatIds;
      }
      if (Array.isArray(details.missing_required_asset_ids)) {
        summary.missing_required_asset_ids = details.missing_required_asset_ids.slice(0, 20);
      }
      return {
        code: String(item.code || ''),
        severity: String(item.severity || 'warning'),
        message: String(item.message || ''),
        ...(Object.keys(summary).length ? { details: summary } : {}),
      };
    });
}

module.exports = {
  BLOCKING_VISUAL_QA_CODES,
  isBlockingVisualQaCode,
  summarizeVisualQaWarnings,
};
