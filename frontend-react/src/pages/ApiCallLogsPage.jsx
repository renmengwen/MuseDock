import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Copy, FileClock, Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/api/client.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx';
import { cn } from '@/lib/utils.js';

const STATES = { all: '全部状态', success: '成功', error: '失败或中断', invalid: '返回不规范', pending: '接收中' };
const CATEGORIES = { text: '文本 / 视觉模型', image: '图片生成', tts: '语音合成', transcription: '音频转写',
  research: '搜索 / 素材查询', source: '来源读取', download: '文件下载', api: 'API 请求' };
const PREVIEW_CHARACTERS = 100000;
const timeLabel = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未完成';
const durationLabel = value => value < 1000 ? `${value || 0} 毫秒` : `${(value / 1000).toFixed(1)} 秒`;

function RecordState({ record }) {
  return <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium',
    record.state === 'success' ? 'bg-green-50 text-green-700' : record.state === 'pending' ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-700')}>
    {STATES[record.state] || '待核实'}
  </span>;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* 局域网或权限受限时使用选区复制。 */ }
  }
  const previousFocus = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
  // Radix 弹窗会把焦点限制在弹窗内，备用复制的选区也必须位于同一容器。
  (previousFocus?.closest?.('[role="dialog"]') || document.body).appendChild(textarea);
  try {
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('复制失败');
  } finally { textarea.remove(); previousFocus?.focus?.(); }
}

export function ApiCallLogsPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const workflowId = params.get('workflow') || '';
  const state = Object.hasOwn(STATES, params.get('state')) ? params.get('state') : 'all';
  const [workflowInput, setWorkflowInput] = useState(workflowId);
  const [records, setRecords] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailVersion, setDetailVersion] = useState(0);
  const [copying, setCopying] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const requestRef = useRef({ sequence: 0, controller: null });
  const copyLock = useRef(false);
  const fallbackBack = workflowId ? `/creative/${encodeURIComponent(workflowId)}` : '/creative';
  const back = typeof location.state?.from === 'string' && /^\/(?:creative|editor|settings)(?:\/|\?|$)/.test(location.state.from)
    ? location.state.from : fallbackBack;

  const loadRecords = useCallback(async before => {
    requestRef.current.controller?.abort();
    const controller = new AbortController();
    const sequence = ++requestRef.current.sequence;
    requestRef.current.controller = controller;
    setLoading(before ? 'more' : 'refresh');
    setError('');
    if (!before) { setRecords([]); setNextCursor(null); }
    try {
      const result = await api.listApiCallLogs({ workflowId, state: state === 'all' ? '' : state, before, signal: controller.signal });
      if (requestRef.current.sequence !== sequence) return;
      setRecords(previous => before ? [...previous, ...result.records] : result.records);
      setNextCursor(result.nextCursor);
      setWarning(result.warning || '');
    } catch (failure) {
      if (requestRef.current.sequence === sequence && !controller.signal.aborted) setError(failure.message || '加载 API 调用记录失败，请重试。');
    } finally {
      if (requestRef.current.sequence === sequence) setLoading('');
    }
  }, [workflowId, state]);

  useEffect(() => {
    setWorkflowInput(workflowId);
    loadRecords();
    return () => { requestRef.current.sequence += 1; requestRef.current.controller?.abort(); };
  }, [loadRecords, workflowId]);

  useEffect(() => {
    setDetail(null);
    setDetailError('');
    setCopyMessage('');
    if (!selectedId) { setDetailLoading(false); return; }
    const controller = new AbortController();
    setDetailLoading(true);
    api.getApiCallLog(selectedId, controller.signal).then(result => {
      if (!controller.signal.aborted) setDetail(result.record);
    }).catch(failure => {
      if (!controller.signal.aborted) setDetailError(failure.message || '读取 API 返回详情失败，请重试。');
    }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, detailVersion]);

  function applyFilter(nextWorkflow, nextState) {
    const next = new URLSearchParams();
    if (nextWorkflow.trim()) next.set('workflow', nextWorkflow.trim());
    if (nextState !== 'all') next.set('state', nextState);
    setParams(next);
  }

  async function copyRecord(kind) {
    if (!detail || copyLock.current) return;
    copyLock.current = true;
    setCopying(kind);
    setCopyMessage('');
    try {
      await copyText(kind === 'body' ? detail.body_text : JSON.stringify({
        应用: 'MuseDock', 说明: 'API 返回诊断（已脱敏）', ...detail,
      }, null, 2));
      setCopyMessage(kind === 'body' ? '已复制返回正文。' : '已复制完整诊断信息。');
    } catch { setCopyMessage('复制失败，请选中下方正文手动复制。'); }
    finally { copyLock.current = false; setCopying(''); }
  }

  return (
    <main className="min-h-screen min-w-0 bg-page px-6 py-7 text-fg-1 max-[640px]:px-4">
      <div className="mx-auto grid w-full max-w-7xl min-w-0 gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-3">
            <Button asChild variant="ghost" size="sm" className="w-fit px-0"><Link to={back}><ArrowLeft size={15} />返回创作</Link></Button>
            <h1 className="m-0 flex items-center gap-2 text-2xl font-bold"><FileClock size={24} />API 调用记录</h1>
            <p className="m-0 text-sm leading-6 text-fg-3">查看每次请求的返回结果，包含成功、失败、格式异常与重试。可复制正文或完整诊断信息。</p>
          </div>
          <Button variant="outline" disabled={Boolean(loading)} onClick={() => loadRecords()}>
            {loading === 'refresh' ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
            {loading === 'refresh' ? '正在加载记录...' : '刷新记录'}
          </Button>
        </header>

        <section className="grid min-w-0 gap-4 rounded-lg border border-line-2 bg-surface-1 p-4" aria-label="API 记录筛选">
          <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); applyFilter(workflowInput, state); }}>
            <div className="grid min-w-0 flex-1 basis-64 gap-2"><label htmlFor="api-workflow-filter" className="text-sm font-medium">创作任务 ID</label>
              <Input id="api-workflow-filter" value={workflowInput} onChange={event => setWorkflowInput(event.target.value)} maxLength={200} placeholder="留空查看所有任务与设置中的请求" />
            </div>
            <div className="grid w-44 gap-2"><label id="api-state-label" className="text-sm font-medium">返回状态</label>
              <Select value={state} onValueChange={value => applyFilter(workflowId, value)}>
                <SelectTrigger aria-labelledby="api-state-label"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(STATES).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={Boolean(loading)}>筛选记录</Button>
            {workflowId || state !== 'all' ? <Button variant="ghost" disabled={Boolean(loading)} onClick={() => applyFilter('', 'all')}>查看全部</Button> : null}
          </form>
          <p className="m-0 text-xs leading-5 text-fg-3">记录保存在本机，从启用此功能后开始留存。历史请求没有保存的返回无法补录。查看与复制不会重新调用模型。</p>
        </section>

        {warning ? <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">{warning}</p> : null}
        {error ? <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}<Button variant="outline" size="sm" disabled={Boolean(loading)} onClick={() => loadRecords()}>重新加载</Button></div> : null}
        <section className="min-w-0 overflow-hidden rounded-lg border border-line-2 bg-surface-1" aria-label="API 调用列表" aria-busy={Boolean(loading)}>
          <Table className="min-w-[860px]">
            <TableHeader><TableRow><TableHead>调用时间</TableHead><TableHead>请求</TableHead><TableHead>状态</TableHead><TableHead>HTTP</TableHead><TableHead>耗时</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
            <TableBody>
              {records.map(record => <TableRow key={record.id}>
                <TableCell className="text-xs text-fg-3">{timeLabel(record.created_at)}</TableCell>
                <TableCell className="max-w-[420px] whitespace-normal">
                  <div className="font-medium">{CATEGORIES[record.category] || 'API 请求'}{record.context.repair != null ? ` · ${record.context.repair ? '自动补正' : '首次生成'}` : ''}</div>
                  <div className="mt-1 break-all text-xs text-fg-3">{record.model || `${record.method} ${record.endpoint}`}</div>
                  {record.workflow_id ? <div className="mt-1 break-all text-xs text-fg-3">任务：{record.workflow_id}</div> : null}
                </TableCell>
                <TableCell><RecordState record={record} />{record.body_truncated ? <div className="mt-1 text-xs text-amber-700">正文已截断</div> : null}</TableCell>
                <TableCell className="font-mono text-xs">{record.http_status ?? '未收到'}</TableCell>
                <TableCell className="text-xs">{record.state === 'pending' ? '接收中' : durationLabel(record.duration_ms)}</TableCell>
                <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => setSelectedId(record.id)} aria-label={`查看 API 返回详情 ${record.sequence}`}>查看详情</Button></TableCell>
              </TableRow>)}
              {!records.length ? <TableRow><TableCell colSpan={6} className="py-14 text-center text-sm text-fg-3">
                {loading ? <span className="inline-flex items-center gap-2" role="status"><Loader2 size={16} className="animate-spin" />正在加载 API 调用记录...</span> : error ? '记录加载失败，请重试。' : '暂无符合条件的 API 调用记录。'}
              </TableCell></TableRow> : null}
            </TableBody>
          </Table>
          {nextCursor ? <div className="border-t border-line-1 p-4 text-center"><Button variant="outline" disabled={Boolean(loading)} onClick={() => loadRecords(nextCursor)}>
            {loading === 'more' ? <Loader2 size={14} className="animate-spin" /> : null}{loading === 'more' ? '正在加载更早的记录...' : '加载更早的记录'}
          </Button></div> : null}
        </section>
        <p className="m-0 text-xs text-fg-3" role="status">{loading ? '正在读取本地记录...' : `已显示 ${records.length} 条记录`}</p>
      </div>

      <Dialog open={Boolean(selectedId)} onOpenChange={open => { if (!open) setSelectedId(''); }}>
        <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-5xl">
          <DialogHeader className="shrink-0 pr-6"><DialogTitle>API 返回详情</DialogTitle><DialogDescription>凭据与链接签名已脱敏。正文可能包含创作内容，请按需选择要反馈的信息。</DialogDescription></DialogHeader>
          {detailLoading ? <p className="flex items-center gap-2 py-8 text-sm" role="status"><Loader2 size={16} className="animate-spin" />正在读取 API 返回正文...</p> : null}
          {detailError ? <div className="grid gap-3 text-sm text-danger" role="alert">{detailError}<Button className="w-fit" variant="outline" onClick={() => setDetailVersion(value => value + 1)}>重试读取详情</Button></div> : null}
          {detail ? <>
            <div className="grid min-h-0 gap-4 overflow-y-auto">
              <div className="flex flex-wrap items-center gap-3 text-sm"><RecordState record={detail} /><span>HTTP {detail.http_status ?? '未收到响应'}</span><span>{durationLabel(detail.duration_ms)}</span><span>{detail.response_bytes.toLocaleString()} 字节</span></div>
              <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-surface-2 p-3 text-xs leading-5">
                <dt className="text-fg-3">接口</dt><dd className="m-0 break-all font-mono">{detail.method} {detail.endpoint}</dd>
                <dt className="text-fg-3">模型</dt><dd className="m-0 break-all">{detail.model || '此请求未指定模型'}</dd>
                <dt className="text-fg-3">开始 / 结束</dt><dd className="m-0">{timeLabel(detail.created_at)} / {timeLabel(detail.completed_at)}</dd>
                <dt className="text-fg-3">任务 / 阶段</dt><dd className="m-0 break-all">{detail.workflow_id || '无关联创作任务'}{detail.context.stage ? ` / ${detail.context.stage}` : ''}</dd>
                <dt className="text-fg-3">调用位置</dt><dd className="m-0 break-all">{detail.operation || '后台任务'}{detail.context.attemptNumber ? ` · 第 ${detail.context.attemptNumber} 版` : ''}{detail.context.repair != null ? (detail.context.repair ? ' · 自动补正' : ' · 首次生成') : ''}</dd>
                <dt className="text-fg-3">记录 ID</dt><dd className="m-0 break-all font-mono">{detail.id}</dd>
              </dl>
              {detail.error || detail.validation.length ? <div className="grid gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700" aria-label="API 错误与校验结果">
                {detail.error ? <p className="m-0 whitespace-pre-wrap break-words">{detail.error}</p> : null}
                {detail.validation.map((item, index) => <p key={index} className="m-0 whitespace-pre-wrap break-words">{typeof item === 'string' ? item : JSON.stringify(item)}</p>)}
              </div> : null}
              {detail.transport_status === 'incomplete' ? <p className="m-0 text-sm text-amber-800">这条记录不完整，正文仅包含已取得的部分；没有正文时不能推断供应商未执行请求。</p> : null}
              {detail.body_truncated ? <p className="m-0 text-sm text-amber-800">响应超过单条记录的 64 MiB 上限，已保存前 64 MiB；复制的正文也只包含已保存部分。</p> : null}
              <div className="grid min-w-0 gap-2"><h2 className="m-0 text-sm font-semibold">返回正文（已脱敏{detail.body_encoding === 'base64' ? '，二进制以 Base64 保存' : ''}）</h2>
                {detail.body_text.length > PREVIEW_CHARACTERS ? <p className="m-0 text-xs text-fg-3">当前预览前 10 万字符，复制按钮会复制这条记录中保存的全部正文。</p> : null}
                <pre tabIndex={0} className="m-0 max-h-[42vh] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100 [overflow-wrap:anywhere]" aria-label="API 返回正文">{detail.body_text.slice(0, PREVIEW_CHARACTERS) || (detail.state === 'pending' ? '正在接收返回，可稍后刷新详情。' : detail.http_status == null ? '未收到 HTTP 响应。' : '未取得返回正文。')}</pre>
              </div>
              <details className="rounded-lg border border-line-1 p-3 text-xs"><summary className="cursor-pointer font-medium">响应头（已脱敏）</summary><pre className="mb-0 overflow-auto whitespace-pre-wrap leading-6 [overflow-wrap:anywhere]">{JSON.stringify(detail.response_headers, null, 2)}</pre></details>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line-1 pt-3">
              <Button disabled={!detail.body_text || Boolean(copying)} onClick={() => copyRecord('body')}>{copying === 'body' ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}复制返回正文</Button>
              <Button variant="outline" disabled={Boolean(copying)} onClick={() => copyRecord('diagnostic')}>{copying === 'diagnostic' ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}复制完整诊断</Button>
              {detail.state === 'pending' ? <Button variant="ghost" disabled={detailLoading} onClick={() => setDetailVersion(value => value + 1)}><RefreshCw size={14} />刷新详情</Button> : null}
              {copyMessage ? <span className="inline-flex items-center gap-1 text-xs text-fg-2" role="status">{copyMessage.startsWith('已复制') ? <Check size={14} /> : null}{copyMessage}</span> : null}
            </div>
          </> : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
