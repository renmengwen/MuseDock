import { useEffect, useState } from 'react';
import { firstText } from './creativeDisplay.js';
import {
  collectVisualWarnings,
  visibleWarnings,
  visualWarningsSignature,
  VISUAL_WARNINGS_COLLAPSED_LIMIT,
} from './creativeVisualWarnings.js';

// 视觉观察告警摘要：成功与失败任务共用。
// aria-live 区域始终挂载（sr-only 脱离布局流，空态不占父级 grid 间距），
// 否则区域与内容同时插入 DOM 时多数屏幕阅读器不会播报；区域内只播报摘要文案，完整列表放在可见 wrapper 中。
export function CreativeVisualWarnings({ workflow }) {
  const [expanded, setExpanded] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const visualWarnings = collectVisualWarnings(workflow);
  const warningsSignature = visualWarningsSignature(visualWarnings);
  useEffect(() => {
    setExpanded(false);
    setAnnouncement('');
    if (!warningsSignature) return undefined;
    const timer = window.setTimeout(() => {
      setAnnouncement(`视觉观察告警 ${visualWarnings.length} 条`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [warningsSignature]);

  const shownWarnings = visibleWarnings(visualWarnings, expanded);
  const hiddenCount = visualWarnings.length - VISUAL_WARNINGS_COLLAPSED_LIMIT;

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {/* 可见内容整体条件渲染：无告警时不产生任何参与布局的元素，父级 grid 不残留空 item */}
      {visualWarnings.length ? (
        <div className="grid gap-2 border-l-2 border-line-2 pl-3">
          <div className="text-[13px] font-bold leading-normal text-fg-1">视觉观察告警 {visualWarnings.length} 条（不影响成片，仅供参考）</div>
          <ol className="m-0 grid list-decimal gap-1 pl-4 text-[13px] leading-relaxed text-fg-2">
            {shownWarnings.map((warning, index) => (
              <li key={`${warning.code || 'warning'}-${index}`}>
                {warning.code ? <span className="font-mono text-xs text-fg-3">[{warning.code}] </span> : null}
                {firstText(warning.message, warning.code, '视觉观察告警。')}
              </li>
            ))}
          </ol>
          {/* 展开/收起按钮放在 aria-live 区域之外，避免点击后屏幕阅读器整段重播。 */}
          {visualWarnings.length > VISUAL_WARNINGS_COLLAPSED_LIMIT ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(value => !value)}
              className="justify-self-start bg-transparent p-0 text-xs leading-normal text-fg-3 underline underline-offset-2 hover:text-fg-2"
            >
              {expanded ? '收起' : `展开其余 ${hiddenCount} 条`}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
