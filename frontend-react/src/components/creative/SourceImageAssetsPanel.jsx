import { useState } from 'react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.jsx';
import { cn } from '@/lib/utils.js';
import { firstText } from './creativeDisplay.js';

const IMAGE_ANALYSIS_STATUS_TEXT = {
  ready: '已完成',
  partial: '部分完成',
  failed: '失败后降级',
  disabled: '已关闭',
  skipped: '已跳过',
};

const IMAGE_ANALYSIS_STATUS_CLASS = {
  ready: 'bg-green-50 text-green-700 ring-green-200',
  partial: 'bg-amber-50 text-amber-700 ring-amber-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
  disabled: 'bg-slate-100 text-slate-700 ring-slate-200',
  skipped: 'bg-slate-100 text-slate-600 ring-slate-200',
  default: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const SOURCE_LABEL_TEXT = {
  article: '文章图片',
  github: 'GitHub 图片',
  github_readme: 'GitHub README',
  readme: 'README 图片',
  pexels: 'Pexels 补图',
  search: '搜索补图',
  upload: '上传图片',
};

function formatImageAnalysisStatus(status) {
  return IMAGE_ANALYSIS_STATUS_TEXT[String(status || '').trim()] || '未分析';
}

function sourceLabel(source) {
  const key = String(source || '').trim();
  return SOURCE_LABEL_TEXT[key] || key || '来源图片';
}

function getAssetImageSrc(asset, assetId, workflowId) {
  if (assetId && workflowId) {
    return `/api/creative-workflows/${encodeURIComponent(workflowId)}/assets/${encodeURIComponent(assetId)}/file`;
  }
  const src = firstText(asset?.preview_url, asset?.thumbnail_url, asset?.url);
  return /^(https?:\/\/|\/api\/|data:image\/)/i.test(src) ? src : '';
}

function SourceImageThumbnail({ asset, assetId, workflowId, className }) {
  const [failed, setFailed] = useState(false);
  const src = getAssetImageSrc(asset, assetId, workflowId);
  if (src && !failed) {
    return (
      <img
        className={cn('h-full w-full rounded-md object-cover', className)}
        src={src}
        alt={firstText(asset.alt, asset.title, assetId, '来源图片')}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className={cn('grid h-full w-full place-items-center rounded-md bg-white px-2 text-center font-mono text-[11px] font-bold text-[#69717e]', className)}>
      {assetId}
    </div>
  );
}

function SourceImageAssetsDialog({ assets, diagnostics, usageById, workflowId }) {
  const sharedAnalysisMessage = Array.from(new Set(assets
    .map(asset => firstText(asset.image_analysis?.message))
    .filter(Boolean))).length === 1
    ? firstText(assets[0]?.image_analysis?.message)
    : '';

  return (
    <DialogContent className="max-h-[86vh] w-[min(1080px,calc(100vw-32px))] max-w-[calc(100vw-32px)] overflow-auto sm:max-w-[1080px]">
      <DialogHeader>
        <DialogTitle>来源图片列表</DialogTitle>
        <DialogDescription>查看已提取图片、分析状态和最终引用情况。</DialogDescription>
      </DialogHeader>

      {sharedAnalysisMessage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-[#92400e]">
          分析说明：{sharedAnalysisMessage}
        </div>
      ) : null}

      {assets.length ? (
        <div className="grid gap-3">
          {assets.map((asset, index) => {
            const assetId = firstText(asset.id, asset.asset_id, `asset_${index + 1}`);
            const analysis = asset.image_analysis || {};
            const usage = usageById.get(assetId);
            const usedInFrames = Array.isArray(usage?.used_in_frames) ? usage.used_in_frames.filter(Boolean) : [];
            const used = usage?.used === true || usedInFrames.length > 0 || Number(usage?.usage_count || 0) > 0;
            const status = analysis.status || '';
            const title = firstText(asset.alt, asset.title, asset.name, asset.path, asset.url, assetId);
            const metaLine = [analysis.visual_type, analysis.best_usage, analysis.fit]
              .map(item => String(item || '').trim())
              .filter(Boolean)
              .join(' / ');

            return (
              <article key={`${assetId}-${index}`} className="grid grid-cols-[132px_minmax(0,1fr)] gap-3 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 max-[640px]:grid-cols-1">
                <div className="aspect-[16/10] w-full overflow-hidden rounded-md border border-[#d9dde5] bg-white">
                  <SourceImageThumbnail asset={asset} assetId={assetId} workflowId={workflowId} />
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <strong className="min-w-0 break-words text-[13px] leading-snug text-[#111827]">{title}</strong>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-[#5f6876] ring-1 ring-[#e1e5eb]">{sourceLabel(asset.source)}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold ring-1', IMAGE_ANALYSIS_STATUS_CLASS[status] || IMAGE_ANALYSIS_STATUS_CLASS.default)}>
                      {formatImageAnalysisStatus(status)}
                    </span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold ring-1', used ? 'bg-green-50 text-green-700 ring-green-200' : 'bg-slate-100 text-slate-700 ring-slate-200')}>
                      {usage ? (used ? '已用于镜头' : '最终未引用') : '未生成引用报告'}
                    </span>
                  </div>
                  {analysis.summary ? <p className="mt-2 text-[13px] leading-relaxed text-[#30343b]">{analysis.summary}</p> : null}
                  {metaLine ? <p className="mt-1 text-xs leading-relaxed text-[#69717e]">类型/用途/适配：{metaLine}</p> : null}
                  {usedInFrames.length ? <p className="mt-1 text-xs leading-relaxed text-[#69717e]">引用镜头：{usedInFrames.join('、')}</p> : null}
                  {analysis.message && analysis.message !== sharedAnalysisMessage ? <p className="mt-1 text-xs leading-relaxed text-[#b45309]">分析说明：{analysis.message}</p> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[#d9dde5] bg-[#fafbfc] px-3 py-2 text-[13px] text-[#69717e]">暂无来源图片素材。</div>
      )}

      {diagnostics.length ? (
        <div className="grid gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3">
          <strong className="text-xs font-bold text-[#5f6876]">诊断信息</strong>
          {diagnostics.slice(0, 4).map((item, index) => {
            const code = firstText(item.code, item.type, item.status, 'diagnostic');
            const message = firstText(item.user_message, item.message, item.reason, item.url, '已记录素材处理诊断。');
            return (
              <div key={`${code}-${index}`} className="flex items-start justify-between gap-3 border-t border-[#edf0f4] pt-2 text-xs leading-relaxed max-[640px]:flex-col">
                <span className="min-w-0 break-words text-[#30343b]">{code === 'download_failed' ? '下载失败' : code}：{message}</span>
                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 font-bold text-[#5f6876] ring-1 ring-[#e1e5eb]">{code}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </DialogContent>
  );
}

export function SourceImageAssetsPanel({ workflow, compact = false }) {
  const assetContext = workflow?.asset_context || workflow?.creative_context?.asset_context || null;
  const assets = Array.isArray(assetContext?.assets) ? assetContext.assets : [];
  const diagnostics = Array.isArray(assetContext?.diagnostics) ? assetContext.diagnostics : [];
  const usageReport = assetContext?.asset_usage_report
    || workflow?.result?.hyperframes_freeform?.project?.asset_usage_report
    || workflow?.result?.hyperframes_freeform?.html_video_project?.asset_usage_report
    || workflow?.html_video_project?.asset_usage_report
    || null;
  const hasUsageReport = Array.isArray(usageReport?.assets);
  const usageById = new Map((Array.isArray(usageReport?.assets) ? usageReport.assets : [])
    .map(item => [String(item.asset_id || item.id || '').trim(), item])
    .filter(([id]) => id));

  if (!assetContext && !assets.length && !diagnostics.length) return null;

  const contextStatus = assetContext?.image_analysis?.status || assetContext?.status || '';
  const assetWorkflowId = firstText(workflow?.workflow_id, workflow?.id);
  const usedAssetCount = assets.filter((asset, index) => {
    const assetId = firstText(asset.id, asset.asset_id, `asset_${index + 1}`);
    const usage = usageById.get(assetId);
    const usedInFrames = Array.isArray(usage?.used_in_frames) ? usage.used_in_frames.filter(Boolean) : [];
    return usage?.used === true || usedInFrames.length > 0 || Number(usage?.usage_count || 0) > 0;
  }).length;
  const rootClass = compact
    ? 'grid gap-3 border-t border-[#edf0f4] pt-3'
    : 'grid gap-3.5 rounded-lg border border-[#e7e9ee] bg-white p-4';
  const statsClass = compact
    ? 'grid grid-cols-3 gap-3 text-[13px] max-[640px]:grid-cols-1'
    : 'grid grid-cols-3 gap-3 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] max-[640px]:grid-cols-1';

  if (compact) {
    const usedLabel = hasUsageReport ? `已用于镜头 ${usedAssetCount} 张` : '已用于镜头 未生成';
    return (
      <section className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-[#edf0f4] pt-3" aria-label="来源图片素材">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px]">
          <span className="font-bold text-[#111827]">来源图片素材</span>
          <span className="text-[#69717e]">{assets.length} 张 · {usedLabel} · 诊断 {diagnostics.length} 条</span>
        </div>
        <div className="inline-flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className={cn('rounded-full px-3 py-1 text-xs font-bold ring-1', IMAGE_ANALYSIS_STATUS_CLASS[contextStatus] || IMAGE_ANALYSIS_STATUS_CLASS.default)}>
            图片分析：{formatImageAnalysisStatus(contextStatus)}
          </span>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm" type="button">
                <Eye size={14} />
                <span>{assets.length ? `查看图片列表（${assets.length}）` : '查看素材诊断'}</span>
              </Button>
            </DialogTrigger>
            <SourceImageAssetsDialog assets={assets} diagnostics={diagnostics} usageById={usageById} workflowId={assetWorkflowId} />
          </Dialog>
        </div>
      </section>
    );
  }

  return (
    <section className={rootClass} aria-label="来源图片素材">
      <div className="flex items-start justify-between gap-3 max-[720px]:flex-col">
        <div className="min-w-0">
          <h3 className="m-0 text-[15px] font-bold leading-snug text-[#111827]">来源图片素材</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[#69717e]">
            {assetContext?.summary || assetContext?.image_analysis?.summary || '展示文章/GitHub 图片的分析状态、引用结果和准备诊断。'}
          </p>
        </div>
        <div className="inline-flex shrink-0 flex-wrap items-center justify-end gap-2 max-[720px]:justify-start">
          <span className={cn('rounded-full px-3 py-1 text-xs font-bold ring-1', IMAGE_ANALYSIS_STATUS_CLASS[contextStatus] || IMAGE_ANALYSIS_STATUS_CLASS.default)}>
            图片分析：{formatImageAnalysisStatus(contextStatus)}
          </span>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm" type="button">
                <Eye size={14} />
                <span>{assets.length ? `查看图片列表（${assets.length}）` : '查看素材诊断'}</span>
              </Button>
            </DialogTrigger>
            <SourceImageAssetsDialog assets={assets} diagnostics={diagnostics} usageById={usageById} workflowId={assetWorkflowId} />
          </Dialog>
        </div>
      </div>

      {assets.length ? (
        <div className={statsClass}>
          <div className="min-w-0">
            <div className="text-xs font-bold text-[#8a93a2]">图片素材</div>
            <div className="mt-1 font-semibold text-[#111827]">{assets.length} 张</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-[#8a93a2]">已用于镜头</div>
            <div className="mt-1 font-semibold text-[#111827]">{hasUsageReport ? `${usedAssetCount} 张` : '未生成'}</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-[#8a93a2]">诊断信息</div>
            <div className="mt-1 font-semibold text-[#111827]">{diagnostics.length} 条</div>
          </div>
        </div>
      ) : (
        <div className={compact ? 'text-[13px] text-[#69717e]' : 'rounded-lg border border-dashed border-[#d9dde5] bg-[#fafbfc] px-3 py-2 text-[13px] text-[#69717e]'}>暂无来源图片素材。</div>
      )}
    </section>
  );
}
