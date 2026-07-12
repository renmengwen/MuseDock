// 视觉观察告警读取链（visual_inspect.warnings 兜底 report.warnings）。
// 纯函数模块：成功/失败任务详情与恢复建议共用，避免两份读取逻辑漂移；
// 不含 JSX，node 可直跑测试。

export function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
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
    const key = [warning.code, warning.message].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 是否需要在任务详情中展示视觉观察告警区块（无告警时不占位）。
export function shouldShowVisualWarnings(workflow) {
  return collectVisualWarnings(workflow).length > 0;
}
