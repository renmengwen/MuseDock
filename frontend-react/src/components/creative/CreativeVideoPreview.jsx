export function CreativeVideoPreview({ videoUrl, posterUrl, width, height }) {
  const portrait = width > 0 && height > width;
  return (
    <section className="overflow-hidden rounded-lg border border-[#e7e9ee] bg-white shadow-[0_12px_32px_rgba(15,23,42,.08)]" style={portrait ? { width: '100%', maxWidth: `${60 * width / height}dvh`, marginInline: 'auto' } : undefined} aria-label="生成视频预览">
      <video className="h-full w-full max-h-[calc(100vh-340px)] object-contain bg-[#05070a]" style={portrait ? { maxHeight: '60dvh', aspectRatio: `${width} / ${height}` } : undefined} src={videoUrl} poster={posterUrl || undefined} controls playsInline preload="metadata">
        当前浏览器不支持直接播放视频。
      </video>
    </section>
  );
}
