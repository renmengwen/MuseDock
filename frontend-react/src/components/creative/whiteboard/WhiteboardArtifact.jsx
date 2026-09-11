import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs.jsx';

function timeLabel(ms) {
  const totalSeconds = Math.round(ms / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function WhiteboardArtifact({ artifact }) {
  if (!artifact) return <p className="m-0 py-10 text-center text-sm text-fg-3">方案准备好后，正文、分镜与制作设置会显示在这里。</p>;
  const plan = artifact.productionPlan;
  const canvas = artifact.canvas || { width: 1920, height: 1080 };
  const cueById = new Map(artifact.cues.map(cue => [cue.id, cue]));
  return (
    <Tabs defaultValue="narration" className="min-w-0 gap-4">
      <TabsList className="grid w-full grid-cols-3 max-[760px]:h-14" aria-label="方案内容">
        <TabsTrigger value="narration">旁白正文</TabsTrigger>
        <TabsTrigger value="scenes">分镜 · {artifact.scenes.length}</TabsTrigger>
        <TabsTrigger value="production">制作方案</TabsTrigger>
      </TabsList>
      <TabsContent value="narration" className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-fg-3">
          <span>{artifact.timingKind === 'source_srt' ? 'SRT 原始时间轴' : '草案目标时长'} · {timeLabel(artifact.durationMs)}</span>
          <span>· {artifact.narrationLanguage === 'zh-CN' ? '简体中文' : artifact.narrationLanguage === 'en-US' ? '英语（美国）' : '英语（英国）'}</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-sm leading-8 text-fg-1">{artifact.narrationText}</div>
        <p className="mt-5 border-t border-line-1 pt-3 text-xs leading-relaxed text-fg-3">这里保留已确认的旁白正文。首次音频制作直接生成完整旁白，实际时长与字幕请在产物区检查。</p>
      </TabsContent>
      <TabsContent value="scenes" className="min-w-0">
        <div className="divide-y divide-line-1">
          {artifact.scenes.map((scene, index) => (
            <article key={scene.id} className="py-4 first:pt-0">
              <div className="flex items-start justify-between gap-3">
                <h3 className="m-0 text-sm font-semibold text-fg-1"><span className="mr-2 font-mono text-fg-3">{String(index + 1).padStart(2, '0')}</span>{scene.title}</h3>
                <span className="shrink-0 font-mono text-xs text-fg-3">{timeLabel(scene.startMs)}–{timeLabel(scene.endMs)}</span>
              </div>
              <p className="mb-3 mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-fg-2">{scene.cueIds.map(id => cueById.get(id)?.text).join('\n')}</p>
              <div className="grid gap-1.5 text-xs leading-6 text-fg-3"><span className="font-semibold text-fg-2">画面构思</span><p className="m-0 whitespace-pre-wrap break-words">{scene.imagePrompt}</p></div>
            </article>
          ))}
        </div>
        {artifact.timingKind === 'provisional' ? <p className="text-xs leading-relaxed text-fg-3">分镜时间为草案估算。后续以完整旁白和对应字幕的真实时间为准。</p> : null}
      </TabsContent>
      <TabsContent value="production">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-4 text-sm">
          <dt className="text-fg-3">视觉模板</dt><dd className="m-0 text-fg-1">{artifact.visualStyle.displayName}<p className="mb-0 mt-1 text-xs leading-6 text-fg-3">{artifact.visualStyle.description}</p></dd>
          <dt className="text-fg-3">画笔</dt><dd className="m-0">{plan.handDisplayMode === 'show' ? '显示画笔' : '隐藏画笔'}</dd>
          <dt className="text-fg-3">成片字幕</dt><dd className="m-0">{plan.burnSubtitles ? '烧录字幕' : '不烧录字幕'}</dd>
          <dt className="text-fg-3">背景音乐</dt><dd className="m-0">不使用 BGM</dd>
          <dt className="text-fg-3">生图方式</dt><dd className="m-0">逐幕独立生成</dd>
          <dt className="text-fg-3">旁白服务</dt><dd className="m-0">{plan.narrationMode === 'disabled' ? '静音 SRT' : artifact.narrationService?.displayName || '未配置'}{plan.narrationMode !== 'disabled' && !artifact.narrationService?.configured ? <p className="mb-0 mt-1 text-xs leading-relaxed text-fg-3">开始旁白制作前需配置服务，并重新确认调用合同。</p> : null}</dd>
          <dt className="text-fg-3">后续确认</dt><dd className="m-0">{plan.agentApprovalEnabled ? '授权 AI 在允许范围内推进' : '由我逐阶段确认'}</dd>
          <dt className="text-fg-3">画幅</dt><dd className="m-0">{canvas.width} × {canvas.height} · {artifact.aspectRatio || '16:9'}</dd>
        </dl>
        <p className="mb-0 mt-6 border-t border-line-1 pt-3 text-xs leading-relaxed text-fg-3">确认绑定当前内容、分镜与以上设置。制作产物可逐阶段检查，也可按本次授权自动推进；修改会使相关下游重新等待确认。</p>
      </TabsContent>
    </Tabs>
  );
}
