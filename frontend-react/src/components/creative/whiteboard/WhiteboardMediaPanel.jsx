import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, FolderOpen, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { useLocalFileActions } from '@/hooks/useLocalFileActions.js';
import { CreativeVideoPreview } from '../CreativeVideoPreview.jsx';
import { WhiteboardSceneTable } from './WhiteboardSceneTable.jsx';

const PANELS = [ ['full_narration', '旁白'], ['lineart_generation', '线稿'], ['annotation_drafting', '落墨'], ['scene_render', '单幕'], ['final_delivery', '成片'] ];
export function WhiteboardMediaPanel({ media, scenes = [], onReviewLowCoverage, onRecoverAnnotationPreview, recoveringPreview = false, actionsDisabled = false,
  onSaveLineartPrompt, promptSavingDisabled = false }) {
  const [tab, setTab] = useState(media.stage);
  const detailsOpen = useRef(false);
  const onDetailsOpenChange = useCallback(open => { detailsOpen.current = open; }, []);
  const fileActions = useLocalFileActions();
  useEffect(() => {
    if (!detailsOpen.current) { setTab(media.stage); fileActions.clearMessage(); }
  }, [media.stage]);
  const files = new Map(media.artifacts.map(file => [file.id, file]));
  const sceneTitles = new Map(scenes.map(scene => [scene.id, scene.title]));
  const url = file => files.get(file?.id)?.url || '';
  const current = media.current;
  const canvas = { width: media.recipe?.width || 1920, height: media.recipe?.height || 1080 };
  const narration = current.full_narration;
  const silent = media.narrationMode === 'disabled' || (narration && !narration.audio);
  const final = current.final_delivery;
  const openFile = (file, label, target = 'file') => url(file) && <Button variant="outline" size="sm" className="max-[760px]:min-h-11"
    disabled={fileActions.opening} onClick={() => void fileActions.openFile(url(file), label.replace(/^打开/, ''), target)}>
    {target === 'folder' ? <FolderOpen size={14} /> : <FileText size={14} />}{label}
  </Button>;
  const fileStatus = fileActions.message ? <p role={fileActions.error ? 'alert' : 'status'} className={`m-0 flex items-center gap-2 text-xs ${fileActions.error ? 'text-danger' : 'text-fg-3'}`}>
    {fileActions.opening && <LoaderCircle size={14} className="animate-spin" />}{fileActions.message}
  </p> : null;
  const empty = <p className="py-6 text-center text-sm text-fg-3">完成前面的步骤后，此处会显示当前产物。</p>;
  const lowCoverageScenes = media.lowCoverage || [];
  const lowCoverageByScene = new Map(lowCoverageScenes.map(entry => [entry.sceneId, entry]));
  const pendingLowCoverage = !current.annotation_drafting && lowCoverageScenes.length > 0;
  const annotationAttempts = new Map();
  for (const attempt of media.attempts || []) {
    if (attempt.stage !== 'annotation_drafting') continue;
    if (!annotationAttempts.has(attempt.sceneId)) annotationAttempts.set(attempt.sceneId, []);
    annotationAttempts.get(attempt.sceneId).push(attempt);
  }
  // 按方案顺序展示已完成、待确认和未完成幕，并发完成顺序不影响分镜编号。
  const annotationScenes = (current.annotation_drafting?.scenes || scenes.map(scene =>
    media.annotations?.[scene.id] || lowCoverageByScene.get(scene.id) || { sceneId: scene.id })).map(scene => {
    const attempts = annotationAttempts.get(scene.sceneId) || [];
    return { ...scene, attempts, attempt: attempts.at(-1) };
  });
  const lineartAttempts = new Map((media.attempts || []).filter(attempt => attempt.stage === 'lineart_generation').map(attempt => [attempt.sceneId, attempt]));
  const lineartBindings = new Map((current.lineart_generation?.scenes || Object.values(media.lineart || {})).map(scene => [scene.sceneId, scene]));
  const lineartScenes = scenes.map(scene => ({
    ...(lineartBindings.get(scene.id) || { sceneId: scene.id }), imageTexts: scene.imageTexts,
    prompt: media.lineartPromptDetails?.[scene.id] || { imagePrompt: scene.imagePrompt, revision: media.overrides?.[`lineart_generation:${scene.id}`] || '' },
    attempt: lineartAttempts.get(scene.id),
  }));
  const renderProgress = new Map((media.sceneRenderProgress?.scenes || []).map(row => [row.sceneId, row]));
  const renderAttempts = new Map((media.attempts || []).filter(attempt => attempt.stage === 'scene_render').map(attempt => [attempt.sceneId, attempt]));
  const renderedScenes = current.scene_render?.scenes || scenes.map(scene => ({
    ...(media.scenes?.[scene.id] || { sceneId: scene.id }),
    progress: renderProgress.get(scene.id), attempt: renderAttempts.get(scene.id),
  }));
  return (
    <div className="grid min-w-0 gap-4" aria-label="白板媒体产物">
      <Tabs value={tab} onValueChange={value => { setTab(value); fileActions.clearMessage(); }} className="min-w-0 gap-4">
        <TabsList className="grid h-auto w-full grid-cols-5" aria-label="媒体阶段">{PANELS.map(([id, label]) => <TabsTrigger key={id} value={id} className="min-h-10 px-1 text-xs">{silent && id === 'full_narration' ? '字幕' : label}</TabsTrigger>)}</TabsList>
        <TabsContent value="full_narration" className="min-w-0">
          {narration ? <div className="grid gap-4">
            <p className="m-0 text-sm">{narration.timingKind === 'planned' ? '计划时长' : '时间轴时长'} <strong>{(narration.durationMs / 1000).toFixed(2)} 秒</strong>{narration.audio ? ' · 24 kHz 单声道' : narration.timingKind === 'planned' ? ' · 无旁白，使用计划时间轴' : ' · 无旁白，使用 SRT 时间轴'}</p>
            {narration.audio ? <audio controls controlsList="nodownload" preload="metadata" src={url(narration.audio)} className="w-full" aria-label="完整白板旁白" /> : null}
            <div className="flex flex-wrap gap-2">{openFile(narration.audio, '打开完整旁白')}{openFile(final?.subtitles || narration.subtitles, '打开字幕 SRT')}{openFile(narration.audio || final?.subtitles || narration.subtitles, '打开所在文件夹', 'folder')}</div>
            <p className="m-0 text-xs leading-6 text-fg-3">{narration.audio ? '字幕文字来自已确认正文，时间来自同一次语音响应的原生字级证据。' : narration.timingKind === 'planned' ? '按已确认的目标时长与文本长度安排字幕和动画，未生成旁白。请检查字幕阅读节奏和分镜时长。' : '使用输入 SRT 的时间轴，未生成旁白。'}</p>
            {media.bgm ? <p className="m-0 text-xs leading-6 text-fg-3">已开启背景音乐，将在最终成片中混入；此处仅检查旁白和字幕。</p> : null}
          </div> : empty}
        </TabsContent>
        {PANELS.slice(1, 4).map(([stage]) => <TabsContent key={stage} value={stage} className="min-w-0">
          {stage === 'annotation_drafting' && pendingLowCoverage ? <div className="mb-3 flex items-start gap-2 rounded-md border border-danger/25 p-3 text-xs leading-6 text-danger" role="alert">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <div className="grid gap-2"><span>有 {lowCoverageScenes.length} 幕的落墨标注未完整覆盖线稿（不足 97%）。预览会展示当前落墨效果，并用红色标出遗漏墨迹。接受后遗漏部分保持空白，不会在片尾补显。</span>
              {onReviewLowCoverage ? <Button variant="outline" size="sm" disabled={actionsDisabled} className="justify-self-start" onClick={onReviewLowCoverage}>查看预览并决定是否接受</Button> : null}</div>
          </div> : null}
          <WhiteboardSceneTable key={stage === 'lineart_generation' ? `${media.id}:${stage}` : current[stage]?.identity || (stage === 'annotation_drafting' && pendingLowCoverage ? 'low-coverage' : stage)}
            stage={stage} scenes={stage === 'annotation_drafting' ? annotationScenes : stage === 'lineart_generation' ? lineartScenes : renderedScenes}
            sceneTitles={sceneTitles} canvas={canvas} getUrl={url} renderOpenFile={openFile} fileStatus={fileStatus} onFileContextChange={fileActions.clearMessage}
            onReviewLowCoverage={onReviewLowCoverage} onRecoverAnnotationPreview={onRecoverAnnotationPreview}
            recoveringPreview={recoveringPreview} actionsDisabled={actionsDisabled}
            onSaveLineartPrompt={onSaveLineartPrompt} promptSavingDisabled={promptSavingDisabled} onDetailsOpenChange={onDetailsOpenChange} />
        </TabsContent>)}
        <TabsContent value="final_delivery" className="min-w-0">
          {final ? <div className="grid gap-4"><CreativeVideoPreview videoUrl={url(final.video)} posterUrl={url(final.poster)} width={final.validation.width} height={final.validation.height} showFileActions={false} /><div className="flex flex-wrap gap-2">{openFile(final.video, '打开最终视频')}{openFile(final.subtitles || narration?.subtitles, '打开字幕')}{openFile(final.video, '打开所在文件夹', 'folder')}</div>
            <p className="m-0 text-xs leading-6 text-fg-3">{final.validation.width} × {final.validation.height} · 60 fps · H.264{final.validation.audio ? ' / AAC' : ' · 静音'} · {(final.validation.durationMs / 1000).toFixed(2)} 秒</p>
            <p className="m-0 text-xs leading-6 text-fg-3">背景音乐：{final.bgm ? `已加入 ${final.bgm.title}（轻钢琴）` : '不使用 BGM'}</p>
            <details className="rounded-md border border-line-1 p-3 text-xs"><summary className="cursor-pointer text-fg-2">技术验证与版本身份</summary><p className="break-all font-mono leading-6 text-fg-3">{final.identity}</p><p className="text-fg-3">已检查编码、帧数、时长、音轨并完整解码。</p>{openFile(final.receipt, '打开验证记录')}</details>
          </div> : empty}
        </TabsContent>
      </Tabs>
      {fileStatus}
    </div>
  );
}
