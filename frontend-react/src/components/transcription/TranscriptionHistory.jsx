import { useState } from 'react';
import { History, LoaderCircle, Plus, RotateCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { isTranscriptionRunning } from '@/hooks/useTranscriptionHistory.js';
import { cn } from '@/lib/utils.js';

const STATUS_TEXT = {
  queued: '等待中', running: '进行中', succeeded: '已完成',
  partial: '部分完成', failed: '失败', interrupted: '已中断',
};

export function formatTranscriptionDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    : '时间未记录';
}

export function TranscriptionHistory({ items, selectedId, loading, error, skippedCount, disabled, newDisabled, onSelect, onNew, onRefresh }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const search = query.trim().toLowerCase();
  const filtered = items.filter(item => {
    const matchesStatus = status === 'all' || (status === 'active' ? isTranscriptionRunning(item)
      : status === 'attention' ? ['partial', 'failed', 'interrupted'].includes(item.status) : item.status === status);
    return matchesStatus && (!search || [item.title, item.source?.url, item.source?.awemeId]
      .some(value => String(value || '').toLowerCase().includes(search)));
  });

  return (
    <aside aria-label="转写历史" className="flex min-h-0 min-w-0 flex-col gap-3 border-b border-line-1 bg-surface-2 p-4 md:border-b-0 md:border-r">
      <Button className="min-h-11 w-full md:min-h-9" onClick={onNew} disabled={disabled || newDisabled}>
        <Plus className="size-4" />新建转写
      </Button>
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-fg-1"><History className="size-4" />转写历史 <span className="font-normal text-fg-3">{items.length}</span></h3>
        <Button variant="ghost" size="icon-sm" aria-label="刷新转写历史" title="刷新转写历史" onClick={onRefresh} disabled={loading || disabled}>
          <RotateCw className={cn('size-4', loading && 'animate-spin')} />
        </Button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-fg-3" />
        <Input aria-label="搜索转写历史" placeholder="搜索视频标题或链接" value={query} onChange={event => setQuery(event.target.value)} className="bg-surface-1 pl-8" />
      </div>
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger aria-label="筛选转写状态" className="w-full bg-surface-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          <SelectItem value="succeeded">已完成</SelectItem>
          <SelectItem value="active">进行中</SelectItem>
          <SelectItem value="attention">需处理</SelectItem>
        </SelectContent>
      </Select>
      {loading && <p role="status" className="m-0 flex items-center gap-2 text-xs text-fg-3"><LoaderCircle className="size-3.5 animate-spin" />正在加载转写历史...</p>}
      {error && <div role="alert" className="grid gap-2 text-xs text-danger">
        <p className="m-0 break-words">{error}</p>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>重新加载历史</Button>
      </div>}
      {skippedCount > 0 && <p role="status" className="m-0 text-xs text-fg-3">有 {skippedCount} 条记录文件缺失或损坏，其余历史仍可查看。</p>}
      <ul aria-label="转写历史记录" className="m-0 grid max-h-48 list-none content-start gap-1 overflow-y-auto p-0 md:max-h-none md:flex-1">
        {filtered.map(item => <li key={item.id} className="min-w-0">
          <Button variant="ghost" onClick={() => onSelect(item.id)} disabled={disabled} aria-pressed={selectedId === item.id}
            data-transcription-id={item.id}
            className={cn('h-auto min-h-20 w-full flex-col items-stretch gap-2 whitespace-normal rounded-md border px-3 py-2.5 text-left font-normal',
              selectedId === item.id ? 'border-line-2 bg-surface-hover text-fg-1' : 'border-transparent text-fg-2 hover:bg-surface-hover')}>
            <span className="line-clamp-2 break-words text-sm font-medium leading-5">{item.title || '抖音转写'}</span>
            <span className="flex flex-wrap items-center justify-between gap-1 text-xs">
              <span className={cn('flex items-center gap-1.5', item.status === 'failed' ? 'text-danger' : 'text-fg-3')}>
                {isTranscriptionRunning(item) && <LoaderCircle className="size-3 animate-spin" />}
                {STATUS_TEXT[item.status] || '状态未知'}
              </span>
              <span className="text-fg-3">{item.hasCorrectedText ? '已校订' : item.hasResult ? '原始版' : ''}</span>
            </span>
            <time dateTime={item.createdAt || undefined} className="text-xs tabular-nums text-fg-3">{formatTranscriptionDate(item.createdAt)}</time>
          </Button>
        </li>)}
      </ul>
      {!loading && !error && !filtered.length && <div className="grid gap-2 py-3 text-center text-xs text-fg-3">
        <p className="m-0 text-sm text-fg-2">{items.length ? '没有找到匹配的转写' : '还没有转写记录'}</p>
        {items.length ? <Button variant="ghost" size="sm" onClick={() => { setQuery(''); setStatus('all'); }}>清除筛选</Button>
          : <p className="m-0">开始转写后会自动保存在这里。</p>}
      </div>}
      <p className="m-0 text-xs leading-5 text-fg-3">记录保存在本机，按转写时间倒序排列。</p>
    </aside>
  );
}
