const fsp = require('fs/promises');
const path = require('path');

const htmlVideoProjectApi = require('../creative-video/htmlVideoProjectApi');
const { projectStore: htmlVideoProjectStore, workflow: htmlVideoWorkflow } = htmlVideoProjectApi;
const {
  safeString,
  plainObject,
  isPathSameOrInside,
  readWorkflow,
  DEFAULT_MEDIA_ROOT,
} = require('./workflowStore');
const { syncProjectStageSummariesFromCheckpoint } = require('./workflowStageRunner');
const { normalizeFocusRegions } = require('./visualAssetContract');

function assetKey(asset, fallback = '') {
  return safeString(asset?.id || asset?.asset_id || fallback);
}

function normalizeProjectVisualAsset(asset, projectDir) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return null;
  const id = assetKey(asset);
  if (!id) return null;
  const normalized = { ...asset, id };
  if (Object.prototype.hasOwnProperty.call(asset, 'focus_regions')) {
    normalized.focus_regions = normalizeFocusRegions(asset.focus_regions);
  }
  const relativePath = safeString(asset.path);
  if (relativePath && projectDir) {
    try {
      normalized.local_path = htmlVideoProjectStore.resolveProjectPath(projectDir, relativePath);
      normalized.frame_src = safeString(asset.frame_src) || `../${relativePath.replace(/\\/g, '/')}`;
    } catch {}
  }
  return normalized;
}

function mergeProjectVisualAssets(assetContext, project, projectDir) {
  const context = plainObject(assetContext);
  const assets = Array.isArray(context.assets) ? context.assets : [];
  const nextAssets = [...assets];
  const indexById = new Map(assets
    .map((asset, index) => [assetKey(asset, `asset_${index + 1}`), index])
    .filter(([id]) => id));
  let changed = false;
  for (const asset of (Array.isArray(project?.assets) ? project.assets : [])) {
    const normalized = normalizeProjectVisualAsset(asset, projectDir);
    const id = assetKey(normalized);
    if (!id) continue;
    if (indexById.has(id)) {
      if (Object.prototype.hasOwnProperty.call(normalized, 'focus_regions')) {
        const index = indexById.get(id);
        const current = nextAssets[index];
        if (JSON.stringify(current?.focus_regions) !== JSON.stringify(normalized.focus_regions)) {
          nextAssets[index] = { ...current, focus_regions: normalized.focus_regions };
          changed = true;
        }
      }
      continue;
    }
    indexById.set(id, nextAssets.length);
    nextAssets.push(normalized);
    changed = true;
  }
  if (!changed) return context;
  return {
    ...context,
    status: context.status || 'ready',
    assets: nextAssets,
  };
}

function applyProjectVisualAssetsToRecord(record, project, projectDir) {
  if (!record || !Array.isArray(project?.assets) || !project.assets.length) return record;
  record.asset_context = mergeProjectVisualAssets(record.asset_context, project, projectDir);
  if (record.creative_context && typeof record.creative_context === 'object' && !Array.isArray(record.creative_context)) {
    record.creative_context = {
      ...record.creative_context,
      asset_context: mergeProjectVisualAssets(record.creative_context.asset_context, project, projectDir),
    };
  }
  return record;
}

function applyAssetUsageReportToRecord(record, assetUsageReport) {
  if (!record || !assetUsageReport || !Array.isArray(assetUsageReport.assets)) return record;
  if (record.asset_context && typeof record.asset_context === 'object' && !Array.isArray(record.asset_context)) {
    record.asset_context = {
      ...record.asset_context,
      asset_usage_report: assetUsageReport,
    };
  }
  if (record.creative_context?.asset_context && typeof record.creative_context.asset_context === 'object' && !Array.isArray(record.creative_context.asset_context)) {
    record.creative_context = {
      ...record.creative_context,
      asset_context: {
        ...record.creative_context.asset_context,
        asset_usage_report: assetUsageReport,
      },
    };
  }
  if (record.result?.hyperframes_freeform) {
    record.result.hyperframes_freeform.project = {
      ...(record.result.hyperframes_freeform.project || {}),
      asset_usage_report: assetUsageReport,
    };
  }
  return record;
}

function buildProjectAssetUsageReport(project, projectDir, record) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) return null;
  if (project?.asset_usage_report
    && Array.isArray(project.asset_usage_report.assets)
    && Array.isArray(project.asset_usage_report.required_asset_ids)) {
    return project.asset_usage_report;
  }
  if (htmlVideoWorkflow && typeof htmlVideoWorkflow.buildAssetUsageReport === 'function') {
    return htmlVideoWorkflow.buildAssetUsageReport({
      project,
      projectDir,
      creativeContext: project?.creative_context || record?.creative_context || {},
    });
  }
  return null;
}

async function resolveTrustedHtmlVideoProjectDir(record, projectDir, options = {}) {
  const resolvedProjectDir = safeString(projectDir);
  const workflowId = safeString(record?.workflow_id || record?.aweme_id);
  if (!resolvedProjectDir || !workflowId) return '';
  const realProjectDir = await fsp.realpath(resolvedProjectDir).catch(() => '');
  if (!realProjectDir) return '';
  const mediaRoot = safeString(options.mediaRoot || DEFAULT_MEDIA_ROOT);
  const allowedRoots = [];
  if (mediaRoot) {
    const workflowDir = path.resolve(mediaRoot, workflowId);
    const realWorkflowDir = await fsp.realpath(workflowDir).catch(() => '');
    if (realWorkflowDir) allowedRoots.push(realWorkflowDir);
  }
  return allowedRoots.some(root => isPathSameOrInside(realProjectDir, root)) ? realProjectDir : '';
}

async function syncProjectStageSummariesFromProjectDir(record, projectDir, options = {}) {
  const resolvedProjectDir = safeString(projectDir);
  if (!resolvedProjectDir) return record;
  try {
    const trustedProjectDir = await resolveTrustedHtmlVideoProjectDir(record, resolvedProjectDir, options);
    if (!trustedProjectDir) return record;
    const projectPath = htmlVideoProjectStore.resolveProjectPath(trustedProjectDir, 'project.json');
    const project = JSON.parse(await fsp.readFile(projectPath, 'utf8'));
    syncProjectStageSummariesFromCheckpoint(record, project.generation_checkpoint);
    applyProjectVisualAssetsToRecord(record, project, trustedProjectDir);
    const assetUsageReport = buildProjectAssetUsageReport(project, trustedProjectDir, record);
    applyAssetUsageReportToRecord(record, assetUsageReport);
  } catch {
    // checkpoint 只是辅助恢复状态，读取失败不能覆盖主阶段错误。
  }
  return record;
}

function projectPathFromStageResult(value) {
  if (!value || typeof value !== 'object') return '';
  const hyperframes = value.hyperframes_freeform || {};
  return safeString(
    value.html_video_project_path
    || value.project_dir
    || value.project?.html_video_project_path
    || value.project?.project_dir
    || value.result?.html_video_project_path
    || value.result?.project_dir
    || value.result?.project?.html_video_project_path
    || value.result?.project?.project_dir
    || hyperframes.html_video_project_path
    || hyperframes.project_dir
    || hyperframes.project?.html_video_project_path
    || hyperframes.project?.project_dir,
  );
}

function extractStageHtmlVideoProjectPath(record) {
  const stages = Array.isArray(record?.stages) ? record.stages : [];
  for (const stage of stages) {
    const found = projectPathFromStageResult(stage?.result || stage?.data || stage);
    if (found) return found;
  }
  const stageResults = record?.stage_results;
  if (stageResults && typeof stageResults === 'object') {
    for (const result of Object.values(stageResults)) {
      const found = projectPathFromStageResult(result);
      if (found) return found;
    }
  }
  return '';
}

function extractHtmlVideoProjectPathFromWorkflow(record) {
  const hyperframes = record?.result?.hyperframes_freeform || {};
  const project = hyperframes.project || {};
  return safeString(
    record?.last_failure?.project_dir
    || project.html_video_project_path
    || project.project_dir
    || hyperframes.html_video_project_path
    || hyperframes.project_dir
    // 运行中任务：进度事件广播的工程目录，供轮询时水合生成图等工程内素材
    || record?.active_project_dir
    || extractStageHtmlVideoProjectPath(record),
  );
}

function assetHydrationFingerprint(record) {
  const focusAssets = assets => (Array.isArray(assets) ? assets : []).map((asset, index) => ({
    id: assetKey(asset, `asset_${index + 1}`),
    ...(Object.prototype.hasOwnProperty.call(asset || {}, 'focus_regions')
      ? { focus_regions: asset.focus_regions }
      : {}),
  }));
  return JSON.stringify({
    assets: focusAssets(record?.asset_context?.assets),
    creative_assets: focusAssets(record?.creative_context?.asset_context?.assets),
    usage_report: record?.asset_context?.asset_usage_report
      || record?.result?.hyperframes_freeform?.project?.asset_usage_report
      || null,
  });
}

function normalizeComparablePath(value) {
  const text = safeString(value);
  if (!text) return '';
  const normalized = path.normalize(text);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function findMatchingHtmlVideoExport(project, projectDir, outputPath) {
  const output = normalizeComparablePath(outputPath);
  if (!output || !Array.isArray(project?.exports)) return null;
  return project.exports.find(item => {
    const exportPath = safeString(item?.path);
    const candidates = [
      item?.absolute_path,
      exportPath && projectDir ? path.resolve(projectDir, exportPath) : '',
      exportPath,
    ].map(normalizeComparablePath).filter(Boolean);
    return safeString(item?.id) && candidates.includes(output);
  }) || null;
}

function pickWorkflowRenderOutputUrl(record) {
  const renderStageUrl = Array.isArray(record?.stages)
    ? record.stages.find(stage => stage?.id === 'render')?.result?.render?.output_url
    : '';
  const candidates = [
    record?.render_output_url,
    record?.result?.video?.output_url,
    record?.result?.render?.output_url,
    record?.result?.hyperframes_freeform?.render?.output_url,
    record?.render?.output_url,
    record?.hyperframes_freeform?.render?.output_url,
    renderStageUrl,
  ];
  return candidates.find(value => typeof value === 'string' && value.trim()) || '';
}

function buildHtmlVideoExportFileUrl(workflowId, exportId) {
  return `/api/creative-workflows/${encodeURIComponent(String(workflowId))}/html-video-project/exports/${encodeURIComponent(String(exportId))}/file`;
}

async function enrichWorkflowVideoUrls(record) {
  const workflowId = safeString(record?.workflow_id);
  const render = record?.result?.hyperframes_freeform?.render;
  const outputPath = safeString(render?.output_path || render?.outputPath);
  if (workflowId && render && !safeString(render.output_url) && outputPath) {
    const projectDir = extractHtmlVideoProjectPathFromWorkflow(record);
    if (projectDir) {
      try {
        const project = await htmlVideoProjectStore.loadProject(projectDir);
        const exportItem = findMatchingHtmlVideoExport(project, projectDir, outputPath);
        if (exportItem) render.output_url = buildHtmlVideoExportFileUrl(workflowId, exportItem.id);
      } catch {}
    }
  }
  // 归一：提供稳定顶层 render_output_url，前端优先读它，减少对多层嵌套结构的猜测。
  const canonicalUrl = pickWorkflowRenderOutputUrl(record);
  if (canonicalUrl) record.render_output_url = canonicalUrl;
  return record;
}

async function readWorkflowAndHtmlVideoProject(workflowId, rootDir) {
  let record;
  try {
    record = await readWorkflow(workflowId, rootDir);
  } catch {
    return { record: null, project: null, projectDir: '', error: { success: false, code: 'NOT_FOUND', message: '未找到创作任务。' } };
  }
  const projectDir = extractHtmlVideoProjectPathFromWorkflow(record);
  if (!projectDir) {
    return { record, project: null, projectDir: '', error: null };
  }
  try {
    const project = await htmlVideoProjectStore.loadProject(projectDir);
    return { record, project, projectDir, error: null };
  } catch (error) {
    try {
      const stat = await fsp.stat(projectDir);
      if (stat.isDirectory()) {
        return {
          record,
          project: {
            workflow_id: safeString(workflowId),
            generation_checkpoint: {
              stages: {
                validate_project: {
                  status: 'failed',
                  diagnostic_code: 'project_read_failed',
                },
              },
            },
          },
          projectDir,
          projectLoadError: error,
          error: null,
        };
      }
    } catch {
      // fall through to the existing hard failure when the project directory itself is gone
    }
    return {
      record,
      project: null,
      projectDir,
      error: {
        success: false,
        code: 'NO_HTML_VIDEO_PROJECT',
        message: `读取 html-video 工程失败：${error.message}`,
      },
    };
  }
}

async function loadWorkflowWithHtmlVideoProject(workflowId, rootDir) {
  let record;
  try {
    record = await readWorkflow(workflowId, rootDir);
  } catch {
    return { record: null, project: null, projectDir: '', error: { success: false, code: 'NOT_FOUND', message: '未找到创作任务。' } };
  }
  const projectDir = extractHtmlVideoProjectPathFromWorkflow(record);
  if (!projectDir) {
    return { record, project: null, projectDir: '', error: { success: false, code: 'NO_HTML_VIDEO_PROJECT', message: '该创作任务尚未生成 html-video 工程。' } };
  }
  try {
    const project = await htmlVideoProjectStore.loadProject(projectDir);
    return { record, project, projectDir, error: null };
  } catch (error) {
    return {
      record,
      project: null,
      projectDir,
      error: {
        success: false,
        code: 'NO_HTML_VIDEO_PROJECT',
        message: `读取 html-video 工程失败：${error.message}`,
      },
    };
  }
}

module.exports = {
  assetKey,
  normalizeProjectVisualAsset,
  mergeProjectVisualAssets,
  applyProjectVisualAssetsToRecord,
  applyAssetUsageReportToRecord,
  buildProjectAssetUsageReport,
  resolveTrustedHtmlVideoProjectDir,
  syncProjectStageSummariesFromProjectDir,
  projectPathFromStageResult,
  extractStageHtmlVideoProjectPath,
  extractHtmlVideoProjectPathFromWorkflow,
  assetHydrationFingerprint,
  normalizeComparablePath,
  findMatchingHtmlVideoExport,
  pickWorkflowRenderOutputUrl,
  buildHtmlVideoExportFileUrl,
  enrichWorkflowVideoUrls,
  readWorkflowAndHtmlVideoProject,
  loadWorkflowWithHtmlVideoProject,
};
