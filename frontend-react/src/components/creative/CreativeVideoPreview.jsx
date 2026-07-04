export function CreativeVideoPreview({ videoUrl }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#e7e9ee] bg-white shadow-[0_12px_32px_rgba(15,23,42,.08)]" aria-label="生成视频预览">
      <video className="h-full w-full max-h-[calc(100vh-340px)] object-contain bg-[#05070a]" src={videoUrl} controls playsInline preload="metadata">
        当前浏览器不支持直接播放视频。
      </video>
    </section>
  );
}
