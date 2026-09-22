import { useRef } from 'react';
import { ArrowUp, Clapperboard, Globe2, ImagePlay, ImagePlus, Loader2, PenLine, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs.jsx';
import { WhiteboardInputFields } from './whiteboard/WhiteboardInputFields.jsx';
import { IllustratedInputFields } from './illustrated/IllustratedInputFields.jsx';
import { cn } from '@/lib/utils.js';

function CreativeHeroHeader() {
  return (
    <div className="grid w-full max-w-[776px] justify-items-center gap-3">
      <div className="inline-flex items-center gap-2.5 text-[#111827]">
        <h1 className="m-0 text-2xl font-bold leading-tight tracking-normal text-[#111827]">嘿，今天我们来做点什么？</h1>
      </div>
    </div>
  );
}

function CreativePromptComposer({
  input,
  setInput,
  creationModeId = 'hyperframes-v1',
  onCreationModeChange,
  whiteboardDraft,
  onWhiteboardDraftChange,
  illustratedDraft,
  onIllustratedDraftChange,
  modeCatalog,
  status,
  message,
  useResearch,
  setUseResearch,
  isBusy,
  submitDisabled,
  onSubmit,
  uploadedAssets = [],
  onSelectAssets,
  onRequirementChange,
  onDeleteAsset,
}) {
  const fileInputRef = useRef(null);

  return (
    <form
      className="grid min-h-0 w-[min(100%,776px)] gap-3 rounded-[20px] border border-line-2 bg-surface-1 p-4 shadow-[var(--shadow-panel)] max-[760px]:w-full"
      onSubmit={onSubmit}
    >
      <Tabs value={creationModeId} onValueChange={onCreationModeChange} className="gap-4">
        <TabsList className="grid h-12 w-full grid-cols-3 bg-surface-2 p-1 max-[760px]:h-14" aria-label="创作模式">
          <TabsTrigger value="hyperframes-v1" disabled={isBusy} className="min-w-0 gap-2 px-2 text-[13px] max-[760px]:min-h-11 max-[420px]:whitespace-normal max-[420px]:text-xs max-[420px]:leading-4 max-[420px]:[&_svg]:hidden"><Clapperboard size={16} /><span>HyperFrames <span className="max-[420px]:block">动态视频</span></span></TabsTrigger>
          <TabsTrigger value="whiteboard-stream-v1" disabled={isBusy || modeCatalog?.status !== 'ready'} className="min-w-0 gap-2 px-2 text-[13px] max-[760px]:min-h-11 max-[420px]:whitespace-normal max-[420px]:text-xs max-[420px]:leading-4 max-[420px]:[&_svg]:hidden"><PenLine size={16} /><span>线稿白板动画</span><span className="hidden rounded border border-line-2 px-1 py-0.5 font-mono text-[10px] text-fg-3 sm:inline">Agent</span></TabsTrigger>
          <TabsTrigger value="illustrated-narration-v1" disabled={isBusy || !modeCatalog?.illustrated} className="min-w-0 gap-2 px-2 text-[13px] max-[760px]:min-h-11 max-[420px]:whitespace-normal max-[420px]:text-xs max-[420px]:leading-4 max-[420px]:[&_svg]:hidden"><ImagePlay size={16} /><span>旁白配图视频</span></TabsTrigger>
        </TabsList>
        <TabsContent value="hyperframes-v1" className="grid gap-3">
          <p className="m-0 px-1 text-xs leading-6 text-fg-3">自动研究和组织素材，生成可继续编辑的动态视频工程。</p>
      <label className="sr-only" htmlFor="creative-input">
        输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接
      </label>
      <Textarea
        id="creative-input"
        value={input}
        onChange={event => setInput(event.target.value)}
        disabled={isBusy}
        className="min-h-[74px] max-h-[220px] resize-y border-0 bg-transparent px-1 py-0 text-base leading-[1.55] text-fg-1 shadow-none placeholder:text-fg-3 focus-visible:ring-0 disabled:text-fg-3"
        placeholder="粘贴文章/GitHub 链接，或输入你想生成的视频方向"
        rows={4}
      />

      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        disabled={isBusy}
        onChange={onSelectAssets}
      />

      {uploadedAssets.length ? (
        <div className="grid gap-2" aria-label="已选择的创作图片">
          {uploadedAssets.map(asset => (
            <div key={asset.clientId} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-line-1 bg-surface-1 p-2 max-[560px]:grid-cols-[56px_minmax(0,1fr)]">
              <img
                className="h-14 w-16 rounded-md border border-line-1 object-cover max-[560px]:h-12 max-[560px]:w-14"
                src={asset.previewUrl}
                alt={`${asset.fileName} 缩略图`}
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{asset.fileName}</div>
                <div className="mt-1 text-xs text-fg-3" role={asset.error ? 'alert' : 'status'} aria-live="polite">
                  {asset.status === 'uploading' ? '正在上传图片…' : null}
                  {asset.status === 'updating_requirement' ? '正在更新使用约束…' : null}
                  {asset.status === 'deleting' ? '正在删除图片…' : null}
                  {asset.status === 'ready' ? (asset.error || '图片已暂存') : null}
                  {asset.status === 'failed' ? (asset.error || '图片上传失败，请重试。') : null}
                </div>
                <label className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={asset.requirement === 'required'}
                    disabled={isBusy || asset.status !== 'ready'}
                    aria-label={`将 ${asset.fileName} 设为必须使用`}
                    onChange={event => onRequirementChange(asset.clientId, event.target.checked)}
                  />
                  <span>必须使用</span>
                </label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-danger max-[560px]:col-start-2 max-[560px]:justify-self-start"
                disabled={isBusy || !['ready', 'failed'].includes(asset.status)}
                aria-label={`删除图片 ${asset.fileName}`}
                onClick={() => onDeleteAsset(asset.clientId)}
              >
                <Trash2 size={14} />
                <span>删除图片</span>
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 max-[720px]:items-end">
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border-line-1 bg-white px-3 text-[13px] text-fg-3"
            disabled={isBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus size={15} />
            <span>添加图片</span>
          </Button>
          <Button
            type="button"
            className={cn(
              'inline-flex min-h-[34px] items-center gap-1.5 rounded-full px-3 text-[13px] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-[.62]',
              useResearch
                ? '-translate-y-px border-ink bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--accent-primary)] hover:bg-surface-2 hover:text-ink'
                : 'border-line-1 bg-white text-fg-3 hover:bg-white hover:text-fg-3',
            )}
            variant="outline"
            disabled={isBusy}
            onClick={() => setUseResearch(!useResearch)}
          >
            <Globe2 size={15} />
            <span>联网获取最新资料</span>
          </Button>
        </div>

        <Button
          className="flex-none rounded-full bg-ink text-white hover:-translate-y-px hover:bg-ink-strong disabled:opacity-[.64]"
          size="default"
          type="submit"
          disabled={submitDisabled}
          aria-label="生成动态视频"
          title="生成动态视频"
        >
          {isBusy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={19} />}
          <span className="max-[480px]:sr-only">{isBusy ? '正在创建...' : '生成动态视频'}</span>
        </Button>
      </div>
        </TabsContent>
        <TabsContent value="whiteboard-stream-v1" className="grid gap-4">
          <p className="m-0 px-1 text-xs leading-6 text-fg-3">白板创作 Agent 先整理内容、分镜和制作方案，由你确认后完成本阶段。</p>
          {whiteboardDraft ? <WhiteboardInputFields draft={whiteboardDraft} onChange={onWhiteboardDraftChange} catalog={modeCatalog?.whiteboard} disabled={isBusy} /> : null}
          <Button type="submit" className="justify-self-end max-[760px]:min-h-11" disabled={submitDisabled}>{isBusy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}{isBusy ? '正在启动白板创作 Agent...' : '启动白板创作 Agent'}</Button>
        </TabsContent>
        <TabsContent value="illustrated-narration-v1" className="grid gap-4">
          {illustratedDraft ? <IllustratedInputFields draft={illustratedDraft} onChange={onIllustratedDraftChange} disabled={isBusy}/> : null}
          <Button type="submit" className="min-h-11 justify-self-end" disabled={submitDisabled}>{isBusy ? <Loader2 size={16} className="animate-spin"/> : <ArrowUp size={16}/>} {isBusy ? '正在准备文稿与分镜...' : '创建旁白配图任务'}</Button>
        </TabsContent>
      </Tabs>
      {modeCatalog?.status === 'loading' ? <p className="m-0 text-xs text-fg-3" role="status">正在加载创作模式...</p> : null}
      {modeCatalog?.status === 'failed' ? <div className="flex items-center justify-between gap-3 text-xs text-danger" role="alert"><span>{modeCatalog.error}</span><Button type="button" variant="ghost" size="sm" onClick={modeCatalog.reload} disabled={isBusy}>重新加载模式</Button></div> : null}
      {message && ['creating', 'failed'].includes(status) ? <p className={cn('m-0 text-xs leading-relaxed', status === 'failed' ? 'text-danger' : 'text-fg-3')} role={status === 'failed' ? 'alert' : 'status'}>{message}</p> : null}
    </form>
  );
}

function CreativeInputForm(props) {
  return <CreativePromptComposer {...props} />;
}

export function CreativeComposer(props) {
  return (
    <div className="grid w-full justify-items-center gap-[22px]">
      <CreativeHeroHeader />
      <CreativeInputForm {...props} />
    </div>
  );
}
