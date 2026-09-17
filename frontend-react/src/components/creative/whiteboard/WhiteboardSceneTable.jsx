import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx';
import { cn } from '@/lib/utils.js';
import { WhiteboardCoverageImages } from './WhiteboardCoverageReview.jsx';
import { WhiteboardRequestDetails } from './WhiteboardRequestDetails.jsx';
import { WhiteboardLineartPromptEditor } from './WhiteboardLineartPromptEditor.jsx';

const STAGES = {
  lineart_generation: { label: '线稿', file: 'image', summary: '状态 / 文件', description: '查看、编辑并保存本幕线稿提示词，生成后可在这里检查画面。' },
  annotation_drafting: { label: '落墨', file: 'preview', summary: '分区 / 覆盖率', description: '查看区域编号与落墨顺序，检查独立画面是否分别揭示。' },
  scene_render: { label: '单幕', file: 'video', summary: '时长 / 进度', description: '播放本幕视频，检查绘制节奏与画面停留。' },
};

function sceneSummary(stage, scene) {
  if (stage === 'annotation_drafting') {
    const coverage = Number.isFinite(scene.coverage?.coverageRatio) ? `${(scene.coverage.coverageRatio * 100).toFixed(1)}%` : '暂无覆盖率';
    return Number.isInteger(scene.coverage?.regions) ? `${scene.coverage.regions} 区 · ${coverage}` : coverage;
  }
  if (stage === 'scene_render') {
    return Number.isFinite(scene.validation?.durationMs) ? `${(scene.validation.durationMs / 1000).toFixed(2)} 秒` : '暂无数据';
  }
  return 'PNG 图像';
}

function missingSceneSummary(stage, scene) {
  if (stage === 'scene_render') {
    if (scene.progress?.phase === 'failed' || (!scene.progress && scene.attempt?.status === 'failed')) {
      return (scene.attempt?.errorCode || scene.progress?.errorCode) === 'MEDIA_TIMEOUT' ? '渲染超时 · 可重试' : '渲染失败 · 可重试';
    }
    const progress = scene.progress;
    if (progress && progress.phase !== 'queued') {
      const phase = { preparing: '准备绘制', drawing: '正在绘制', encoding: '正在编码', validating: '校验视频', previews: '生成预览' }[progress.phase] || '处理中';
      return `${phase} · ${progress.writtenFrames}/${progress.totalFrames} 帧`;
    }
    return scene.attempt && !['validated', 'accepted'].includes(scene.attempt.status) ? '正在渲染...' : '等待渲染';
  }
  if (stage === 'annotation_drafting' && !scene.preview) {
    if (scene.attempt?.status === 'failed') return '编排失败';
    if (scene.attempt?.status === 'unknown_external_outcome') return '结果待核实';
    if (scene.attempt) return '正在编排...';
    return '等待编排';
  }
  if (stage === 'lineart_generation' && !scene.image) {
    if (scene.attempt?.status === 'failed') return '生成失败';
    if (scene.attempt?.status === 'unknown_external_outcome') return '结果待核实';
    if (['prepared', 'requesting', 'candidate_ready'].includes(scene.attempt?.status)) return '正在生成...';
    return '等待生成';
  }
  return '文件不可用';
}

function previewStyle(canvas) {
  return { aspectRatio: `${canvas.width} / ${canvas.height}`,
    ...(canvas.height > canvas.width ? { maxWidth: `${60 * canvas.width / canvas.height}dvh` } : {}) };
}

function SceneImage({ src, alt, label, canvas }) {
  const [status, setStatus] = useState('loading');
  return (
    <div className="relative mx-auto flex w-full items-center justify-center overflow-hidden rounded-md border border-line-1 bg-page" style={previewStyle(canvas)}>
      <img src={src} alt={alt} onLoad={() => setStatus('ready')} onError={() => setStatus('failed')} className={cn('h-full w-full object-contain', status === 'failed' && 'hidden')} />
      {status === 'loading' ? <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-page text-sm text-fg-3"><Loader2 size={16} className="animate-spin" />正在加载{label}...</div> : null}
      {status === 'failed' ? <p role="alert" className="m-0 p-5 text-center text-sm leading-6 text-danger">图片读取失败，请关闭详情后重试，并检查本地文件是否完整。</p> : null}
    </div>
  );
}

function SceneVideo({ src, canvas }) {
  const [status, setStatus] = useState('loading');
  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-md border border-line-1 bg-ink" style={previewStyle(canvas)}>
      <video src={src} controls controlsList="nodownload" playsInline preload="metadata" onLoadedMetadata={() => setStatus('ready')} onError={() => setStatus('failed')} className="block h-full w-full object-contain" aria-label="当前单幕视频">
        当前浏览器不支持直接播放视频。
      </video>
      {status === 'loading' ? <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-page text-sm text-fg-3"><Loader2 size={16} className="animate-spin" />正在加载单幕视频...</div> : null}
      {status === 'failed' ? <div className="absolute inset-0 flex items-center justify-center bg-page p-5"><p role="alert" className="m-0 text-center text-sm leading-6 text-danger">视频读取失败，请关闭详情后重试，并检查本地文件是否完整。</p></div> : null}
    </div>
  );
}

export function WhiteboardSceneTable({ stage, scenes = [], sceneTitles, canvas = { width: 1920, height: 1080 }, getUrl, renderOpenFile, fileStatus, onFileContextChange,
  onReviewLowCoverage, onRecoverAnnotationPreview, recoveringPreview = false, actionsDisabled = false,
  onSaveLineartPrompt, promptSavingDisabled = false, onDetailsOpenChange }) {
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const triggerRef = useRef(null);
  const settings = STAGES[stage];
  const selectedIndex = scenes.findIndex(scene => scene.sceneId === selectedSceneId);
  const selected = scenes[selectedIndex];
  const selectedHasPreview = Boolean(selected && getUrl(selected[settings.file]));
  const titleFor = (scene, index) => sceneTitles.get(scene.sceneId) || scene[settings.file]?.name || `分镜 ${index + 1}`;
  const hasRequestDetails = scene => stage === 'annotation_drafting' && Boolean(scene.attempt);
  const hasPrompt = scene => stage === 'lineart_generation' && Boolean(scene.prompt?.imagePrompt);
  useEffect(() => () => onDetailsOpenChange?.(false), [onDetailsOpenChange]);

  function openScene(scene, event) {
    if (!getUrl(scene[settings.file]) && !hasRequestDetails(scene) && !hasPrompt(scene)) return;
    if (scene.kind === 'annotation_coverage_review' && onReviewLowCoverage) {
      if (!actionsDisabled) onReviewLowCoverage();
      return;
    }
    triggerRef.current = event.target.closest('button') || event.currentTarget.querySelector('button');
    onFileContextChange?.();
    setSelectedSceneId(scene.sceneId);
    onDetailsOpenChange?.(true);
  }

  if (!scenes.length) return <p className="m-0 py-12 text-center text-sm leading-6 text-fg-3">暂无{settings.label}产物，完成前面的步骤后会显示在这里。</p>;

  return (
    <Dialog open={Boolean(selected)} onOpenChange={open => {
      if (!open && !promptSaving) { setSelectedSceneId(''); onDetailsOpenChange?.(false); }
    }}>
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-3">
          <span>共 {scenes.length} 幕</span><span>点击分镜查看{settings.label}详情</span>
        </div>
        <div className="overflow-hidden rounded-md border border-line-1">
          <Table className="table-fixed" aria-label={`${settings.label}分镜列表`}>
            <TableHeader className="bg-surface-2">
              <TableRow className="border-line-1 hover:bg-surface-2">
                <TableHead scope="col" className="pl-4 text-xs text-fg-3">分镜</TableHead>
                <TableHead scope="col" className="w-24 text-xs text-fg-3 sm:w-32">{settings.summary}</TableHead>
                <TableHead scope="col" className="w-24 pr-3 text-right text-xs text-fg-3 sm:w-28">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenes.map((scene, index) => {
                const available = Boolean(getUrl(scene[settings.file]));
                const inspectable = available || hasRequestDetails(scene) || hasPrompt(scene);
                const needsReview = stage === 'annotation_drafting' && scene.coverage?.coverageRatio < 0.97 && !scene.coverageAcceptance;
                const failed = ['annotation_drafting', 'lineart_generation'].includes(stage) && !available && scene.attempt?.status === 'failed';
                const canRecover = stage === 'annotation_drafting' && failed && scene.attempt.received?.candidate && onRecoverAnnotationPreview;
                return (
                  <TableRow key={scene.sceneId} onClick={event => openScene(scene, event)} className={cn('border-line-1 focus-within:bg-surface-2', inspectable && 'cursor-pointer hover:bg-surface-2', (needsReview || failed) && 'bg-danger/5')}>
                    <TableCell className="whitespace-normal py-4 pl-4">
                      <div className="flex items-start gap-3"><span className="shrink-0 pt-0.5 font-mono text-xs text-fg-3">{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 break-words font-medium leading-6 text-fg-1">{titleFor(scene, index)}</span></div>
                    </TableCell>
                    <TableCell className={cn('whitespace-normal text-xs leading-6 text-fg-3', failed && 'text-danger')}>{available ? <>{sceneSummary(stage, scene)}{scene.coverage?.coverageRatio < 0.97 ? <span className="block text-danger">{scene.coverageAcceptance ? '已人工接受' : '覆盖不足 · 待确认'}</span> : null}</> : missingSceneSummary(stage, scene)}</TableCell>
                    <TableCell className="pr-3 text-right">
                      <div className="flex flex-col items-end gap-1">{canRecover ? <Button variant="outline" size="sm" disabled={actionsDisabled} onClick={event => { event.stopPropagation(); onRecoverAnnotationPreview(scene.sceneId); }}
                        aria-label={`恢复第 ${index + 1} 幕落墨预览`} className="gap-1 px-2 text-xs max-[760px]:min-h-11">{recoveringPreview ? <Loader2 size={14} className="animate-spin" /> : null}{recoveringPreview ? '正在恢复...' : '恢复预览'}</Button>
                        : null}<Button variant="ghost" size="sm" disabled={!inspectable || (needsReview && actionsDisabled)} aria-haspopup="dialog" aria-label={`查看第 ${index + 1} 幕${settings.label}详情`} className="gap-1 px-2 text-xs max-[760px]:min-h-11">{needsReview && onReviewLowCoverage ? '检查并处理' : '查看详情'}<ArrowUpRight size={14} /></Button></div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <DialogContent
        showCloseButton={!promptSaving}
        className="flex max-h-[90dvh] w-[min(1040px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[1040px] [&>[data-slot=dialog-close]]:grid [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:place-items-center max-[760px]:[&_button]:min-h-11"
        onCloseAutoFocus={event => { if (triggerRef.current?.isConnected) { event.preventDefault(); triggerRef.current.focus(); } }}
      >
        <DialogHeader className="shrink-0 border-b border-line-1 p-5 pr-16 text-left">
          <DialogTitle className="break-words leading-7">{settings.label}{stage === 'annotation_drafting' && selected && !selectedHasPreview ? '请求' : ''}详情{selected ? ` · ${selectedIndex + 1}. ${titleFor(selected, selectedIndex)}` : ''}</DialogTitle>
          <DialogDescription>{stage === 'annotation_drafting' && selected && !selectedHasPreview ? '查看本幕的请求结果、时间和处理建议。' : settings.description}</DialogDescription>
        </DialogHeader>
        {selected ? <>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-5 max-[560px]:p-3 [&>*]:shrink-0">
            {hasPrompt(selected) ? <WhiteboardLineartPromptEditor key={selected.sceneId} scene={selected} onSave={onSaveLineartPrompt}
              disabled={promptSavingDisabled} onSavingChange={setPromptSaving} /> : null}
            {stage === 'lineart_generation' && !selectedHasPreview ? <p className="m-0 rounded-md border border-line-1 bg-surface-2 p-3 text-sm leading-6 text-fg-3">
              {missingSceneSummary(stage, selected)}，当前没有可显示的线稿图片。{selected.attempt?.status === 'unknown_external_outcome'
                ? '可以先保存提示词，仍需核实外部结果后授权新请求。'
                : selected.attempt?.status === 'failed' ? '可以调整并保存提示词，再继续制作。' : '提示词已可查看和编辑。'}
            </p> : null}
            {selectedHasPreview ? <>{stage === 'scene_render'
              ? <SceneVideo key={getUrl(selected.video)} src={getUrl(selected.video)} canvas={canvas} />
              : stage === 'annotation_drafting' && selected.resultPreview && selected.coverage?.coverageRatio < 0.97
              ? <WhiteboardCoverageImages scene={selected} canvas={canvas} getUrl={getUrl} />
              : <SceneImage key={getUrl(selected[settings.file])} src={getUrl(selected[settings.file])} alt={`${titleFor(selected, selectedIndex)}${settings.label}`} label={settings.label} canvas={canvas} />}
            {stage === 'lineart_generation' && selected.imageTexts ? <div className="grid gap-1 text-xs leading-6 text-fg-3"><strong className="text-fg-2">画内原文核对</strong><p className="m-0 break-words">{selected.imageTexts.length ? selected.imageTexts.map(text => `「${text}」`).join('、') : '本幕不添加文字'}</p><p className="m-0">请核对错字、漏字和额外文字，确认后继续落墨编排。</p></div> : null}
            {stage === 'annotation_drafting' ? <div className="grid gap-2 text-xs leading-6 text-fg-3">
              <p className="m-0">{sceneSummary(stage, selected)}。区域按编号依次完成描线与添彩，末尾保留至少半秒。</p>
              {selected.coverage?.coverageRatio < 0.97 ? <p className="m-0 text-danger">{selected.coverageAcceptance ? '已人工接受当前覆盖情况。' : '当前覆盖情况需要你决定是否接受。'}未覆盖部分保持空白，不会在片尾补显。</p> : null}
              {selected.visualGrouping?.reason ? <p className="m-0"><span className="font-semibold text-fg-2">分组依据：</span>{selected.visualGrouping.reason}</p> : null}
            </div> : null}
            {stage === 'scene_render' ? <p className="m-0 text-xs leading-6 text-fg-3">本幕时长 {sceneSummary(stage, selected)}，可播放或拖动进度条检查细节。</p> : null}</> : null}
            {hasRequestDetails(selected) ? selectedHasPreview
              ? <details className="rounded-md border border-line-1 p-3"><summary className="mb-2 cursor-pointer text-xs text-fg-2">查看本幕请求记录</summary><WhiteboardRequestDetails scene={selected} hasPreview /></details>
              : <WhiteboardRequestDetails scene={selected} canRecover={selected.attempt.status === 'failed' && Boolean(selected.attempt.received?.candidate && onRecoverAnnotationPreview)} /> : null}
          </div>
          <DialogFooter className="shrink-0 border-t border-line-1 p-4 sm:justify-between">
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-2">
                {stage === 'lineart_generation' ? renderOpenFile(selected.image, '打开线稿') : null}
                {stage === 'annotation_drafting' ? <>{renderOpenFile(selected.preview, '打开落墨预览')}{renderOpenFile(selected.resultPreview, '打开当前落墨效果')}{renderOpenFile(selected.annotation, '打开区域编排')}</> : null}
                {stage === 'scene_render' ? renderOpenFile(selected.video, '打开单幕视频') : null}
                {renderOpenFile(selected[settings.file], '打开所在文件夹', 'folder')}
              </div>
              {fileStatus}
            </div>
            <DialogClose asChild><Button variant="outline" disabled={promptSaving}>关闭详情</Button></DialogClose>
          </DialogFooter>
        </> : null}
      </DialogContent>
    </Dialog>
  );
}
