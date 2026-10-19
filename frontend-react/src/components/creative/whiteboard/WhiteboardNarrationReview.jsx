import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';

const timestamp = ms => Number.isFinite(ms) ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : '位置待核对';
export function WhiteboardNarrationReview({ attempt, onAccept, accepting = false, acceptError = '' }) {
  const player = useRef(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [playError, setPlayError] = useState('');
  const [reload, setReload] = useState(0);
  const reviewUrl = attempt.review?.url;
  useEffect(() => {
    setReport(null); setError(''); setPlayError('');
    if (!reviewUrl) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(reviewUrl, { signal: controller.signal });
        if (!response.ok) throw new Error('识别对照读取失败，请刷新任务或重试。');
        const data = await response.json();
        if (data.kind !== 'narration_review' || data.audioSha256 !== attempt.raw.sha256) throw new Error('识别对照与当前音频不匹配，请检查保留产物。');
        if (!controller.signal.aborted) setReport(data);
      } catch (failure) { if (!controller.signal.aborted) setError(failure.message || '识别对照读取失败，请重试。'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [reviewUrl, attempt.raw.sha256, reload]);
  async function seek(ms) {
    if (!player.current || !Number.isFinite(ms)) return;
    player.current.currentTime = Math.max(0, ms / 1000 - 1);
    try { await player.current.play(); setPlayError(''); }
    catch { setPlayError('自动播放未成功，请点击播放器的播放按钮。'); }
  }
  return <section className="grid min-w-0 gap-3 rounded-lg border border-amber-300/60 bg-amber-50/40 p-3" aria-label="待核对旁白">
    <div className="grid gap-1"><h4 className="m-0 text-sm font-semibold">已保留音频 · 校验未通过</h4>
      <p className="m-0 text-xs leading-6 text-fg-3">可直接试听和拖动进度。试听不会重新配音，也不会将此音频标记为通过。</p></div>
    <audio ref={player} controls preload="metadata" src={`${attempt.raw.url}?playback=1`} className="w-full" aria-label="试听待核对旁白"
      onError={() => setPlayError('音频暂时无法播放，请刷新页面，或下载音频后试听。')} />
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm" variant="outline"><a href={`${attempt.raw.url}?download=1`}>下载本次音频</a></Button>
      {attempt.review?.url ? <Button asChild size="sm" variant="outline"><a href={`${attempt.review.url}?download=1`}>下载识别对照</a></Button> : null}
    </div>
    {playError ? <p className="m-0 text-xs text-danger" role="alert">{playError}</p> : null}
    {loading ? <p className="m-0 text-xs" role="status">正在加载原文与独立识别对照...</p> : null}
    {error ? <div className="grid gap-2"><p className="m-0 text-xs text-danger" role="alert">{error}</p><Button size="sm" variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}>重新加载对照</Button></div> : null}
    {!reviewUrl ? <p className="m-0 text-xs leading-6 text-fg-3">本次没有可展示的识别对照，请先试听；读取音频不会触发模型请求。</p> : null}
    {report ? <>
      <p className="m-0 text-xs leading-6 text-fg-3">{report.comparisonAvailable ? `${report.differences.length} 处文字差异` : '正文较长，请使用全文对照'} · {report.lowConfidenceWordCount} 个低置信字词。差异可能来自识别错误或配音读错，需要试听判断；定位时间来自附近的识别字词，缺字本身没有声音时间点。</p>
      {report.differences?.length ? <ol className="m-0 grid max-h-72 list-none gap-2 overflow-y-auto p-0" aria-label="识别差异">
        {report.differences.map((item, index) => <li key={index} className="grid gap-1 rounded-md border border-line-1 bg-surface-1 p-2 text-xs leading-6">
          <Button size="sm" variant="outline" className="justify-self-start" disabled={!Number.isFinite(item.startMs)} onClick={() => seek(item.startMs)}>试听 {timestamp(item.startMs)} 附近</Button>
          <span>原文：<strong>{item.expected || '（无对应文字）'}</strong></span>
          <span>识别：<strong>{item.recognized || '（未识别到）'}</strong></span>
          <span className="break-words text-fg-3">原文附近：{item.sourceContext}</span>
        </li>)}
      </ol> : null}
      <details className="min-w-0 text-xs leading-6"><summary className="cursor-pointer font-semibold">查看完整原文与独立识别</summary>
        <div className="mt-2 grid max-h-80 gap-3 overflow-y-auto"><div><strong>已确认原文</strong><p className="whitespace-pre-wrap break-words">{report.sourceText}</p></div>
          <div><strong>独立识别原文（未经校订）</strong><p className="whitespace-pre-wrap break-words">{report.recognizedText}</p></div></div>
      </details>
      <p className="m-0 text-xs leading-6 text-fg-3">请先试听差异位置。确认声音无误时，可接受本次等长单字差异：字幕按已确认原文显示，保留原始识别与声学边界；接着继续图片等制作步骤。声音存在漏读或重复时请重新配音。</p>
      {onAccept ? <Button disabled={accepting || loading} onClick={() => onAccept(attempt)}>{accepting ? '正在确认音频并准备继续制作...' : '已试听，确认音频并继续制作'}</Button> : null}
      {acceptError ? <p className="m-0 text-xs text-danger" role="alert">{acceptError}</p> : null}
    </> : null}
  </section>;
}
