import { firstText } from './creativeDisplay.js';
import { collectVisualWarnings } from './creativeVisualWarnings.js';

// 视觉观察告警摘要：成功与失败任务共用；无告警时返回 null 不占位。
export function CreativeVisualWarnings({ workflow }) {
  const visualWarnings = collectVisualWarnings(workflow);
  if (!visualWarnings.length) return null;

  return (
    <div className="grid gap-2 border-l-2 border-line-2 pl-3">
      <div className="text-[13px] font-bold leading-normal text-fg-1">视觉观察告警 {visualWarnings.length} 条（不影响成片，仅供参考）</div>
      <ol className="m-0 grid list-decimal gap-1 pl-4 text-[13px] leading-relaxed text-fg-2">
        {visualWarnings.slice(0, 6).map((warning, index) => (
          <li key={`${warning.code || 'warning'}-${index}`}>
            {warning.code ? <span className="font-mono text-xs text-fg-3">[{warning.code}] </span> : null}
            {firstText(warning.message, warning.code, '视觉观察告警。')}
          </li>
        ))}
      </ol>
      {visualWarnings.length > 6 ? (
        <div className="text-xs leading-normal text-fg-3">其余 {visualWarnings.length - 6} 条可在视觉报告中查看。</div>
      ) : null}
    </div>
  );
}
