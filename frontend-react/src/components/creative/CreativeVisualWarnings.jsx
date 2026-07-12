import { useState } from 'react';
import { firstText } from './creativeDisplay.js';
import { collectVisualWarnings, visibleWarnings, VISUAL_WARNINGS_COLLAPSED_LIMIT } from './creativeVisualWarnings.js';

// 视觉观察告警摘要：成功与失败任务共用；无告警时返回 null 不占位。
export function CreativeVisualWarnings({ workflow }) {
  const [expanded, setExpanded] = useState(false);
  const visualWarnings = collectVisualWarnings(workflow);
  if (!visualWarnings.length) return null;

  const shownWarnings = visibleWarnings(visualWarnings, expanded);
  const hiddenCount = visualWarnings.length - VISUAL_WARNINGS_COLLAPSED_LIMIT;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="视觉观察告警"
      className="grid gap-2 border-l-2 border-line-2 pl-3"
    >
      <div className="text-[13px] font-bold leading-normal text-fg-1">视觉观察告警 {visualWarnings.length} 条（不影响成片，仅供参考）</div>
      <ol className="m-0 grid list-decimal gap-1 pl-4 text-[13px] leading-relaxed text-fg-2">
        {shownWarnings.map((warning, index) => (
          <li key={`${warning.code || 'warning'}-${index}`}>
            {warning.code ? <span className="font-mono text-xs text-fg-3">[{warning.code}] </span> : null}
            {firstText(warning.message, warning.code, '视觉观察告警。')}
          </li>
        ))}
      </ol>
      {visualWarnings.length > VISUAL_WARNINGS_COLLAPSED_LIMIT ? (
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="justify-self-start bg-transparent p-0 text-xs leading-normal text-fg-3 underline underline-offset-2 hover:text-fg-2"
        >
          {expanded ? '收起' : `展开其余 ${hiddenCount} 条`}
        </button>
      ) : null}
    </div>
  );
}
