import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AudioLines, Check, Copy, Download, ExternalLink, LoaderCircle, RotateCw } from 'lucide-react';
import { api } from '@/api/client.js';
import { Button } from '@/components/ui/button.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { useTranscriptionHistory, isTranscriptionRunning as isRunning } from '@/hooks/useTranscriptionHistory.js';
import { TranscriptionHistory, formatTranscriptionDate } from './TranscriptionHistory.jsx';

export function TranscriptionTool({ compact = false }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [autoCorrect, setAutoCorrect] = useState(false);
  const [capabilities, setCapabilities] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState('raw');
  const [downloadKind, setDownloadKind] = useState('');
  const [notice, setNotice] = useState('');
  const [login, setLogin] = useState(null);
  const [loginAction, setLoginAction] = useState('');
  const submittingRef = useRef(false);
  const {
    history, historyLoading, historyError, skippedCount, job, selectedId, detailLoading, detailError,
    activeJob, pollError, selectJob, rememberJob, clearJob, refreshHistory, refreshStatus,
  } = useTranscriptionHistory(open);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const busy = submitting || !!activeJob;
  const navigationDisabled = submitting || !!downloadKind || !!loginAction;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getTranscriptionCapabilities()
      .then(response => { if (!cancelled) setCapabilities(response.data); })
      .catch(cause => { if (!cancelled) setError(cause.message || '读取转写配置失败，请重新打开工具。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    setVersion(job?.result?.correctedText ? 'corrected' : 'raw');
  }, [job?.id, job?.result?.correctedText]);

  function openHistory(id) {
    if (submittingRef.current || navigationDisabled) return;
    setError(''); setNotice('');
    void selectJob(id);
  }

  function newTranscription() {
    if (submittingRef.current || navigationDisabled || busy) return;
    clearJob();
    setSource(''); setError(''); setNotice('');
  }

  async function start(event) {
    event.preventDefault();
    if (submittingRef.current || busy || !source.trim()) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(''); setNotice('');
    try {
      const result = await api.createTranscription({ source: source.trim(), autoCorrect });
      rememberJob(result.data);
    } catch (cause) { setError(cause.message); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }

  async function retryCorrection() {
    if (submittingRef.current || busy) return;
    submittingRef.current = true;
    setSubmitting(true); setError(''); setNotice('');
    try { rememberJob((await api.retryTranscriptionCorrection(job.id)).data); }
    catch (cause) { setError(cause.message); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }

  async function loginToDouyin(check = false) {
    if (loginAction) return;
    setLoginAction(check ? 'checking' : 'opening'); setError('');
    try { setLogin((await (check ? api.checkTranscriptionLogin() : api.startTranscriptionLogin())).data); }
    catch (cause) { setError(cause.message); }
    finally { setLoginAction(''); }
  }

  async function download(kind) {
    if (downloadKind || !job?.files?.[kind]) return;
    setDownloadKind(kind); setError(''); setNotice('');
    try {
      const response = await fetch(job.files[kind].url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || '下载失败，请刷新任务状态后重试。');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = job.files[kind].name;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('文件已准备好，请查看浏览器下载记录。');
    } catch (cause) { setError(cause.message || '无法下载文件，请检查网络后重试。'); }
    finally { setDownloadKind(''); }
  }

  async function copyText() {
    const copiedId = job.id;
    try {
      await navigator.clipboard.writeText(version === 'corrected' ? job.result.correctedText : job.result.rawText);
      if (selectedIdRef.current === copiedId) setNotice('文本已复制。');
    } catch { if (selectedIdRef.current === copiedId) setError('浏览器不允许自动复制，请选中文本复制或下载 TXT。'); }
  }

  const textKind = version === 'corrected' ? 'correctedText' : 'rawText';
  const srtKind = version === 'corrected' ? 'correctedSrt' : 'rawSrt';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size={compact ? 'icon' : 'default'}
          className={compact ? 'size-[34px] rounded-lg text-fg-2' : 'h-11 w-full justify-start gap-2 px-2.5 text-fg-2'}
          aria-label="打开抖音转写工具" title="抖音转写">
          <AudioLines size={16} />
          {!compact && <span>抖音转写</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(820px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 transition-none sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b border-line-1 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2"><AudioLines className="size-5" />抖音转写</DialogTitle>
          <DialogDescription>每次转写单独保存，随时查看历史文字与字幕。</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[260px_minmax(0,1fr)] md:overflow-hidden">
          <TranscriptionHistory items={history} selectedId={selectedId} loading={historyLoading} error={historyError}
            skippedCount={skippedCount} disabled={navigationDisabled} newDisabled={busy || historyLoading}
            onSelect={openHistory} onNew={newTranscription} onRefresh={() => void refreshHistory()} />
          <div className="min-w-0 space-y-4 p-4 sm:p-5 md:min-h-0 md:overflow-y-auto" aria-label="转写工作区">
            {activeJob && activeJob.id !== selectedId && <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-1 bg-surface-2 p-3 text-xs text-fg-2">
              <span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />有一条转写正在进行，完成后可以新建。</span>
              <Button variant="outline" size="sm" onClick={() => openHistory(activeJob.id)} disabled={navigationDisabled}>查看进行中的转写</Button>
            </div>}
            {pollError && <div role="alert" className="grid gap-2 rounded-md border border-line-1 p-3 text-sm text-danger">
              <p className="m-0">{pollError}</p>
              <Button variant="outline" size="sm" onClick={refreshStatus}><RotateCw className="size-4" />刷新状态</Button>
            </div>}
            {!selectedId && <form className="grid gap-4" onSubmit={start}>
              <div className="grid gap-1">
                <h3 className="m-0 text-base font-semibold text-fg-1">新建转写</h3>
                <p className="m-0 text-sm text-fg-3">粘贴公开视频链接，提取完整文字和句级字幕。</p>
              </div>
              <label className="grid gap-2">
                <span className="text-sm font-medium">抖音链接或分享文案</span>
                <Textarea aria-label="抖音链接或分享文案" value={source} onChange={event => setSource(event.target.value)}
                  placeholder="粘贴 https://v.douyin.com/... 或完整视频链接" maxLength={4096} rows={3} disabled={busy} />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                <div className="grid gap-1">
                  <label id="transcription-correction-label" className="text-sm font-medium">自动校订</label>
                  <span className="text-xs text-muted-foreground">纠正错字和标点，保留原始转写与字幕时间。</span>
                </div>
                <Select value={autoCorrect ? 'on' : 'off'} onValueChange={value => setAutoCorrect(value === 'on')} disabled={busy}>
                  <SelectTrigger className="w-40 bg-background" aria-labelledby="transcription-correction-label"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">否，仅转写</SelectItem>
                    <SelectItem value="on">是，调用分析模型</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {loading ? <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" />正在读取转写配置...</p> : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{capabilities?.asrReady ? `FunASR · ${capabilities.asrModel}` : '尚未配置 FunASR'}
                    {autoCorrect && (capabilities?.textReady ? ` · 校订：${capabilities.textModel}` : ' · 尚未配置分析模型')}</span>
                  <Link to="/settings?section=models" state={{ from: window.location.pathname }} onClick={() => setOpen(false)} className="underline underline-offset-4">配置模型</Link>
                </div>
              )}
              <Button type="submit" className="min-h-11 md:min-h-9" disabled={busy || loading || historyLoading || !!loginAction || !source.trim() || !capabilities?.asrReady || (autoCorrect && !capabilities?.textReady)}>
                {busy && !pollError ? <LoaderCircle className="size-4 animate-spin" /> : <AudioLines className="size-4" />}
                {submitting ? '正在提交...' : busy ? '等待当前转写完成' : '开始转写'}
              </Button>
            </form>}

            {error && <p role="alert" className="m-0 rounded-md border border-danger p-3 text-sm text-danger">{error}</p>}
            {detailLoading && <p role="status" className="m-0 flex items-center gap-2 py-8 text-sm text-fg-3"><LoaderCircle className="size-4 animate-spin" />正在加载这条转写...</p>}
            {detailError && <div role="alert" className="grid gap-3 rounded-md border border-line-1 p-4 text-sm text-danger">
              <p className="m-0">{detailError}</p>
              <Button variant="outline" onClick={() => openHistory(selectedId)} disabled={navigationDisabled || detailLoading}>重新加载这条转写</Button>
            </div>}

            {job && <section className="grid gap-3" aria-label="转写进度">
              <div className="grid gap-2 border-b border-line-1 pb-3">
                <h3 className="m-0 break-words text-base font-semibold text-fg-1">{job.title || job.source?.title || '正在准备转写'}</h3>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-3">
                  <time dateTime={job.createdAt}>{formatTranscriptionDate(job.createdAt)}</time>
                  {job.source?.url && <Button variant="ghost" size="sm" asChild className="px-0 text-xs text-fg-2">
                    <a href={job.source.url} target="_blank" rel="noopener noreferrer">查看原视频<ExternalLink className="size-3.5" /></a>
                  </Button>}
                </div>
              </div>
              <div className="flex items-start gap-2 text-sm" role="status" aria-live="polite">
                {isRunning(job) && !pollError ? <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" /> : job.status === 'succeeded' ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : null}
                <span>{job.message}</span>
              </div>
              {isRunning(job) && !pollError && <div role="progressbar" aria-label="转写进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress} className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${job.progress || 0}%` }} />
              </div>}
              {isRunning(job) && <p className="m-0 text-xs text-muted-foreground">切换历史或关闭弹框后任务继续运行。</p>}
              {job.canRetryCorrection && <Button variant="outline" size="sm" onClick={retryCorrection} disabled={busy}>
                <RotateCw />{submitting ? '正在提交校订...' : '仅重试校订'}
              </Button>}
            </section>}

            {job?.result && <section className="grid gap-3" aria-label="转写结果">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{(job.result.durationMs / 1000).toFixed(1)} 秒 · {job.result.sentenceCount} 条字幕</span>
                {job.correctionCount !== undefined && <span>已校订 {job.correctionCount} 条</span>}
              </div>
              <Tabs value={version} onValueChange={setVersion}>
                <TabsList aria-label="转写版本">
                  <TabsTrigger value="raw">原始转写</TabsTrigger>
                  <TabsTrigger value="corrected" disabled={!job.result.correctedText}>校订版</TabsTrigger>
                </TabsList>
                <TabsContent value="raw"><pre className="m-0 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-3 font-sans text-sm leading-7">{job.result.rawText}</pre></TabsContent>
                <TabsContent value="corrected"><pre className="m-0 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-3 font-sans text-sm leading-7">{job.result.correctedText}</pre></TabsContent>
              </Tabs>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={copyText}><Copy />复制文本</Button>
                <Button variant="outline" size="sm" onClick={() => download(textKind)} disabled={!!downloadKind}><Download />下载 TXT</Button>
                <Button variant="outline" size="sm" onClick={() => download(srtKind)} disabled={!!downloadKind}><Download />下载 SRT</Button>
                {job.files.corrections && <Button variant="ghost" size="sm" onClick={() => download('corrections')} disabled={!!downloadKind}>下载校订记录</Button>}
              </div>
              {(downloadKind || notice) && <p role="status" className="m-0 text-xs text-muted-foreground">{downloadKind ? '正在准备下载文件...' : notice}</p>}
            </section>}

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button variant="ghost" size="sm" disabled={!!loginAction || busy} onClick={() => loginToDouyin(false)}>
                {loginAction === 'opening' && <LoaderCircle className="size-4 animate-spin" />}{loginAction === 'opening' ? '正在打开登录...' : '登录抖音'}
              </Button>
              {login && !login.loggedIn && <Button variant="ghost" size="sm" disabled={!!loginAction || busy} onClick={() => loginToDouyin(true)}>
                {loginAction === 'checking' && <LoaderCircle className="size-4 animate-spin" />}{loginAction === 'checking' ? '正在检查登录...' : '检查登录状态'}
              </Button>}
              <span className="text-xs text-muted-foreground" role="status">{login?.message || '使用本机 Chrome 登录后，可读取你有权访问的公开视频。'}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
