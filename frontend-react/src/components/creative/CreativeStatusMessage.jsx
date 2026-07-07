import { Link } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import { getStatusMessageClass } from './creativeDisplay.js';
import { cn } from '@/lib/utils.js';

const MESSAGE_CLASS = {
  loading: 'border-[#d9dde5] bg-[#f8fafc] text-[#30343b]',
  success: 'border-green-100 bg-green-50 text-green-700',
  error: 'border-red-100 bg-red-50 text-red-700',
  info: 'border-[#edf0f4] bg-white text-[#4b5563]',
};

export function CreativeStatusMessage({ status, message, fallback = '创作任务已打开，正在获取最新进度...' }) {
  const type = getStatusMessageClass(status);
  const text = message || fallback;
  // ponytail: 后端只回传 message 字符串，无错误码可用，按文案匹配；有结构化错误码后改判 code
  const needsModelConfig = /模型未配置/.test(text);
  return (
    <div className={cn('flex min-h-[54px] flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-3 text-[13px] leading-relaxed', MESSAGE_CLASS[type])} aria-live="polite">
      <span className="min-w-0 break-words">{text}</span>
      {needsModelConfig ? (
        <Link
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#d9dde5] bg-white px-2.5 py-1 text-xs font-bold text-[#30343b] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#111827]"
          to="/settings?section=models"
        >
          <Settings2 size={13} />
          <span>前往模型配置</span>
        </Link>
      ) : null}
    </div>
  );
}
