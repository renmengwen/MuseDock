import { useEffect, useState } from 'react';
import { Download, FileText, TriangleAlert } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { CreativeVideoPreview } from '../CreativeVideoPreview.jsx';
import { WhiteboardSceneTable } from './WhiteboardSceneTable.jsx';

const PANELS = [ ['full_narration', '旁白'], ['lineart_generation', '线稿'], ['annotation_drafting', '落墨'], ['scene_render', '单幕'], ['final_delivery', '成片'] ];
export function WhiteboardMediaPanel({ media, scenes = [], onReviewLowCoverage, onRecoverAnnotationPreview, recoveringPreview = false, actionsDisabled = false }) {
  const [tab, setTab] = useState(media.stage);
  useEffect(() => setTab(media.stage), [media.stage]);
  const files = new Map(media.artifacts.map(file => [file.id, file]));
  const sceneTitles = new Map(scenes.map(scene => [scene.id, scene.title]));
  const url = file => files.get(file?.id)?.url || '';
  const current = media.current;
  const canvas = { width: media.recipe?.width || 1920, height: media.recipe?.height || 1080 };
  const narration = current.full_narration;
  const final = current.final_delivery;
  const download = (file, label) => url(file) && <Button asChild variant="outline" size="sm" className="max-[760px]:min-h-11"><a href={`${url(file)}?download=1`} download><Download size={14} />{label}</a></Button>;
  const empty = <p className="py-6 text-center text-sm text-fg-3">完成前面的步骤后，此处会显示当前产物。</p>;
  const lowCoverageScenes = media.lowCoverage || [];
  const lowCoverageByScene = new Map(lowCoverageScenes.map(entry => [entry.sceneId, entry]));
  const pendingLowCoverage = !current.annotation_drafting && lowCoverageScenes.length > 0;
  const annotationAttempts = new Map((media.attempts || []).filter(attempt => attempt.stage === 'annotation_drafting').map(attempt => [attempt.sceneId, attempt]));
  // 按方案顺序展示已完成、待确认和未完成幕，并发完成顺序不影响分镜编号。
  const annotationScenes = current.annotation_drafting?.scenes || scenes.map(scene =>
    media.annotations?.[scene.id] || lowCoverageByScene.get(scene.id) || { sceneId: scene.id, attempt: annotationAttempts.get(scene.id) });
  const lineartScenes = current.lineart_generation?.scenes || scenes.map(scene =>
    media.lineart?.[scene.id] || { sceneId: scene.id });
  return (
    <div className="grid min-w-0 gap-4" aria-label="白板媒体产物">
      <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-4">
        <TabsList className="grid h-auto w-full grid-cols-5" aria-label="媒体阶段">{PANELS.map(([id, label]) => <TabsTrigger key={id} value={id} className="min-h-10 px-1 text-xs">{label}</TabsTrigger>)}</TabsList>
        <TabsContent value="full_narration" className="min-w-0">
          {narration ? <div className="grid gap-4">
            <p className="m-0 text-sm">真实时长 <strong>{(narration.durationMs / 1000).toFixed(2)} 秒</strong>{narration.audio ? ' · 24 kHz 单声道' : ' · 静音 SRT'}</p>
            {narration.audio ? <audio controls preload="metadata" src={url(narration.audio)} className="w-full" aria-label="完整白板旁白" /> : null}
            <div className="flex flex-wrap gap-2">{download(narration.audio, '下载完整旁白')}{download(narration.subtitles, '下载字幕 SRT')}</div>
            <p className="m-0 text-xs leading-6 text-fg-3">{narration.audio ? '字幕文字来自已确认正文，时间来自同一次语音响应的原生字级证据。' : '使用输入 SRT 的真实时钟。'}</p>
          </div> : empty}
        </TabsContent>
        {PANELS.slice(1, 4).map(([stage]) => <TabsContent key={stage} value={stage} className="min-w-0">
          {stage === 'annotation_drafting' && pendingLowCoverage ? <div className="mb-3 flex items-start gap-2 rounded-md border border-danger/25 p-3 text-xs leading-6 text-danger" role="alert">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <div className="grid gap-2"><span>有 {lowCoverageScenes.length} 幕的落墨标注未完整覆盖线稿（不足 97%）。预览会展示当前落墨效果，并用红色标出遗漏墨迹。接受后遗漏部分保持空白，不会在片尾补显。</span>
              {onReviewLowCoverage ? <Button variant="outline" size="sm" disabled={actionsDisabled} className="justify-self-start" onClick={onReviewLowCoverage}>查看预览并决定是否接受</Button> : null}</div>
          </div> : null}
          <WhiteboardSceneTable key={current[stage]?.identity || (stage === 'annotation_drafting' && pendingLowCoverage ? 'low-coverage' : stage)}
            stage={stage} scenes={stage === 'annotation_drafting' ? annotationScenes : stage === 'lineart_generation' ? lineartScenes : current[stage]?.scenes}
            sceneTitles={sceneTitles} canvas={canvas} getUrl={url} renderDownload={download}
            onReviewLowCoverage={onReviewLowCoverage} onRecoverAnnotationPreview={onRecoverAnnotationPreview}
            recoveringPreview={recoveringPreview} actionsDisabled={actionsDisabled} />
        </TabsContent>)}
        <TabsContent value="final_delivery" className="min-w-0">
          {final ? <div className="grid gap-4"><CreativeVideoPreview videoUrl={url(final.video)} posterUrl={url(final.poster)} width={final.validation.width} height={final.validation.height} /><div className="flex flex-wrap gap-2">{download(final.video, '下载最终视频')}{download(narration?.subtitles, '下载字幕')}</div>
            <p className="m-0 text-xs leading-6 text-fg-3">{final.validation.width} × {final.validation.height} · 60 fps · H.264{final.validation.audio ? ' / AAC' : ' · 静音'} · {(final.validation.durationMs / 1000).toFixed(2)} 秒</p>
            <details className="rounded-md border border-line-1 p-3 text-xs"><summary className="cursor-pointer text-fg-2">技术验证与版本身份</summary><p className="break-all font-mono leading-6 text-fg-3">{final.identity}</p><p className="text-fg-3">已检查编码、帧数、时长、音轨并完整解码。</p><a href={url(final.receipt)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink underline"><FileText size={13} />查看验证记录</a></details>
          </div> : empty}
        </TabsContent>
      </Tabs>
    </div>
  );
}
