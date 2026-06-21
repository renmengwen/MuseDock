import { getStatusMessageClass } from './creativeDisplay.js';

export function CreativeStatusMessage({ status, message, fallback = '创作任务已打开，正在获取最新进度...' }) {
  return (
    <div className={`creativeDetailMessage ${getStatusMessageClass(status)}`} aria-live="polite">
      {message || fallback}
    </div>
  );
}
