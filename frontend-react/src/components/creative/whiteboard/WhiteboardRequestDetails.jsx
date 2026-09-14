const STATUS_TEXT = {
  prepared: '准备请求', requesting: '正在请求', candidate_ready: '已保存候选',
  validated: '已完成', accepted: '已接受', failed: '处理失败', unknown_external_outcome: '结果待核实',
};
const ERROR_TEXT = {
  CANDIDATE_INVALID: '模型返回的编排格式未通过校验。',
  ANNOTATION_COVERAGE_LOW: '落墨覆盖率不足，已保存的预览可供检查。',
  ANNOTATION_PREVIEW_FAILED: '未生成完整的落墨预览，请检查本地文件与运行环境。',
  VISION_REQUEST_REJECTED: '视觉服务拒绝了请求，请检查模型设置、权限或限流状态。',
  VISION_NOT_CONFIGURED: '请先在设置中配置支持多模态输入的分析模型。',
  STALE_IDENTITY: '本幕输入或产物版本已经变化，需要检查当前版本。',
};

function timeText(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '未记录';
}

function reasonText(attempt) {
  if (attempt.diagnostics?.message) return attempt.diagnostics.message;
  if (attempt.status === 'unknown_external_outcome') return '旧记录未保存具体原因，无法判断是超时、输出截断还是其他响应问题。';
  if (ERROR_TEXT[attempt.errorCode]) return ERROR_TEXT[attempt.errorCode];
  if (attempt.status === 'failed') return attempt.received?.candidate
    ? '已保存编排候选，但本次处理未完成；旧记录没有更多诊断信息。'
    : '本次处理未完成，旧记录没有保存具体原因。';
  return '';
}

export function WhiteboardRequestDetails({ scene, hasPreview = false, canRecover = false }) {
  const attempts = scene.attempts || (scene.attempt ? [scene.attempt] : []);
  const latest = attempts.at(-1);
  if (!latest) return null;
  const unknown = latest.status === 'unknown_external_outcome';
  const failed = latest.status === 'failed';
  const savedCandidate = Boolean(latest.received?.candidate);
  const advice = unknown
    ? '本幕已暂停。请先核对供应商的调用记录与结果，再决定是否使用左侧“核实后授权新请求”；新的请求可能重复计费，已完成的分镜会复用。'
    : failed && canRecover
    ? '本次编排候选已保存，可使用“恢复预览”先尝试本地恢复。'
    : failed && savedCandidate
    ? '本次编排候选已保存。请先处理左侧的当前任务提示，再按可用操作恢复或继续制作。'
    : failed ? '请根据原因检查模型设置或本地运行环境，再使用左侧的可用操作继续制作。' : '';

  return <section aria-label="本幕请求详情" className="grid min-w-0 gap-4 text-sm leading-6">
    {!hasPreview ? <div className="rounded-md border border-line-1 bg-surface-2 p-4">
      <p className="m-0 font-semibold text-fg-1">当前没有可显示的落墨预览</p>
      <p className="mb-0 mt-1 text-fg-3">{savedCandidate ? '已保存本次编排候选，预览尚未就绪。' : '本次请求没有保存可恢复的编排候选。'}下面的记录可用于了解请求状态。</p>
    </div> : null}
    <dl className="m-0 grid grid-cols-2 gap-3 rounded-md border border-line-1 p-4 text-xs sm:grid-cols-4">
      {[['最新结果', STATUS_TEXT[latest.status] || '状态未记录'], ['本幕尝试', `${attempts.length} 次`],
        ['本次候选', savedCandidate ? '已保存' : '未保存'], ['落墨预览', hasPreview ? '可查看' : '未就绪']].map(([label, value]) =>
        <div key={label}><dt className="text-fg-3">{label}</dt><dd className="m-0 mt-1 font-medium text-fg-1">{value}</dd></div>)}
    </dl>
    {advice ? <p className="m-0 rounded-md border border-line-1 p-4 text-fg-2">{advice}</p> : null}
    <ol aria-label="本幕请求记录" className="m-0 grid list-none gap-3 p-0">
      {[...attempts].reverse().map((attempt, index) => {
        const reason = reasonText(attempt);
        const elapsed = Date.parse(attempt.completedAt) - Date.parse(attempt.createdAt);
        return <li key={attempt.id} className="min-w-0 rounded-md border border-line-1 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 font-medium text-fg-1">
            <span>第 {attempts.length - index} 次 · {attempt.external === false ? '本地处理' : '模型请求'}</span>
            <span className={['failed', 'unknown_external_outcome'].includes(attempt.status) ? 'text-danger' : 'text-fg-2'}>{STATUS_TEXT[attempt.status] || '状态未记录'}</span>
          </div>
          <div className="mt-2 grid gap-1 text-xs text-fg-3 sm:grid-cols-2">
            <span>开始：{timeText(attempt.createdAt)}</span><span>结束：{timeText(attempt.completedAt)}</span>
            {Number.isFinite(elapsed) && elapsed >= 0 ? <span>耗时：{(elapsed / 1000).toFixed(1)} 秒</span> : null}
            {typeof attempt.diagnostics?.responseReceived === 'boolean' ? <span>{attempt.diagnostics.responseReceived ? '本地已收到服务响应' : '本地未取得服务响应'}</span> : null}
            {Number.isInteger(attempt.diagnostics?.httpStatus) ? <span>服务状态：HTTP {attempt.diagnostics.httpStatus}</span> : null}
          </div>
          {reason ? <p className="mb-0 mt-2 break-words text-sm text-fg-2">{reason}</p> : null}
        </li>;
      })}
    </ol>
  </section>;
}
