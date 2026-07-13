// 视觉观察告警读取链（visual_inspect.warnings 兜底 report.warnings）。
// 纯函数模块：成功/失败任务详情与恢复建议共用，避免两份读取逻辑漂移；
// 不含 JSX，node 可直跑测试。

export function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function warningIdentity(warning) {
  return [warning?.code ?? null, warning?.message ?? null];
}

export function visualWarningsSignature(warnings) {
  const list = arrayOrEmpty(warnings);
  return list.length ? JSON.stringify(list.map(warningIdentity)) : '';
}

export function collectVisualWarnings(workflow) {
  const rawWorkflow = plainObject(workflow?.workflow);
  const hyperframes = plainObject(workflow?.result?.hyperframes_freeform || rawWorkflow.result?.hyperframes_freeform);
  const visualInspect = plainObject(hyperframes.visual_inspect);
  const warnings = [
    ...arrayOrEmpty(visualInspect.warnings),
    ...arrayOrEmpty(plainObject(visualInspect.report).warnings),
  ];
  const seen = new Set();
  return warnings.filter(warning => {
    if (!warning || typeof warning !== 'object') return false;
    const key = JSON.stringify(warningIdentity(warning));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 默认折叠展示的告警条数上限。
export const VISUAL_WARNINGS_COLLAPSED_LIMIT = 6;

// 折叠态只显示前 6 条，展开态显示全部；6 条以内始终全显。
export function visibleWarnings(warnings, expanded) {
  const list = arrayOrEmpty(warnings);
  if (expanded || list.length <= VISUAL_WARNINGS_COLLAPSED_LIMIT) return list;
  return list.slice(0, VISUAL_WARNINGS_COLLAPSED_LIMIT);
}

// 是否需要在任务详情中展示视觉观察告警区块（无告警时不占位）。
export function shouldShowVisualWarnings(workflow) {
  return collectVisualWarnings(workflow).length > 0;
}
