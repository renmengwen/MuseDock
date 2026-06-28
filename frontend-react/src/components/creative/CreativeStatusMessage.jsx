import { getStatusMessageClass } from './creativeDisplay.js';
import { cn } from '@/lib/utils.js';

const MESSAGE_CLASS = {
  loading: 'border-blue-100 bg-blue-50 text-blue-700',
  success: 'border-green-100 bg-green-50 text-green-700',
  error: 'border-red-100 bg-red-50 text-red-700',
  info: 'border-[#edf0f4] bg-white text-[#4b5563]',
};

export function CreativeStatusMessage({ status, message, fallback = '创作任务已打开，正在获取最新进度...' }) {
  const type = getStatusMessageClass(status);
  return (
    <div className={cn('min-h-[54px] rounded-lg border px-4 py-3 text-[13px] leading-relaxed', MESSAGE_CLASS[type])} aria-live="polite">
      {message || fallback}
    </div>
  );
}
