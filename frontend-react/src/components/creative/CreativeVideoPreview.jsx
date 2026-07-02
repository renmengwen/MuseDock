import { Button } from '@/components/ui/button.jsx';

export function CreativeVideoPreview({ videoUrl, onEdit, disabled, title }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#e7e9ee] bg-white shadow-[0_12px_32px_rgba(15,23,42,.08)]" aria-label="生成视频预览">
      <video className="h-full w-full max-h-[calc(100vh-340px)] object-contain bg-[#05070a]" src={videoUrl} controls playsInline preload="metadata">
        当前浏览器不支持直接播放视频。
      </video>
      <div className="flex items-center justify-end border-t border-[#edf0f4] p-3">
        <Button className="mt-3 rounded px-4 py-1.5 text-[13px]" type="button" onClick={onEdit} disabled={disabled} title={title}>
          继续编辑
        </Button>
      </div>
    </section>
  );
}
