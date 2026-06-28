const fsp = require('fs/promises');
const path = require('path');

const creativeContext = require('./creativeContext');
const mediaPipeline = require('../mediaPipeline');
const defaultSourceAssets = require('../source/sourceAssets');

// ponytail: 纯小助手与 creativeWorkflows 各持一份，避免为 safeString(159处)/readJson/writeJson 改全局
function safeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
}

async function writeJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getSourceUrlLoadingMessage(sourceUrl, kindHint = '') {
  const url = safeString(sourceUrl).toLowerCase();
  if (url.includes('mp.weixin.qq.com')) return '正在读取微信公众号文章...';
  if (kindHint === 'github_repo' || url.includes('github.com/')) return '正在读取 GitHub 仓库信息...';
  return '正在读取网页文章...';
}

async function writeSyntheticTextWorkspace(record, mediaRoot, now) {
  const paths = mediaPipeline.getMediaPaths(record.aweme_id, mediaRoot);
  const text = safeString(record.creative_context?.input?.raw_text);
  await fsp.mkdir(paths.framesDir, { recursive: true });

  await writeJson(paths.metadata, {
    aweme_id: record.aweme_id,
    source_type: 'creative_text',
    title: text.slice(0, 80),
    description: text,
    creative_workflow_id: record.workflow_id,
    created_at: record.created_at,
    updated_at: now,
  });

  await writeJson(paths.transcript, {
    success: true,
    status: 'done',
    source_type: 'creative_text',
    text,
    updated_at: now,
  });

  await writeJson(paths.analysisInput, {
    aweme_id: record.aweme_id,
    video: {
      title: text.slice(0, 80),
      description: text,
      author: {},
      statistics: {},
      aweme_url: '',
    },
    local_assets: {
      dir: paths.dir,
      metadata: paths.metadata,
      video: '',
      audio: '',
      frames: [],
    },
    comments_summary: {
      status: 'disabled',
      message: '纯文本创作来源暂无评论素材。',
    },
    transcript: {
      status: 'done',
      path: paths.transcript,
    },
    steps: {
      metadata: { status: 'done', path: paths.metadata },
      transcript: { status: 'done', path: paths.transcript },
      analysis_input: { status: 'done', path: paths.analysisInput },
    },
    creative_context: record.creative_context,
    updated_at: now,
  });

  return {
    success: true,
    message: '纯文本来源资料已准备完成。',
    paths,
  };
}

function summarizeMarkdown(markdown, fallback = '') {
  const text = safeString(markdown)
    .split(/\r?\n/)
    .map(line => line.replace(/^#{1,6}\s+/, '').trim())
    .filter(Boolean)
    .join(' ');
  return (text || safeString(fallback)).slice(0, 240);
}

function buildSourceDescription(sourceMaterial = {}) {
  const title = safeString(sourceMaterial.title);
  const summary = summarizeMarkdown(sourceMaterial.markdown, sourceMaterial.description || sourceMaterial.url);
  if (title && summary && summary !== title) {
    return `${title}：${summary}`;
  }
  return title || summary || safeString(sourceMaterial.url);
}

function createSourceDescription(sourceMaterial = {}) {
  return buildSourceDescription(sourceMaterial);
}

function normalizeFetchedSource(fetchResult = {}, requestedUrl = '') {
  const data = fetchResult.data && typeof fetchResult.data === 'object' ? fetchResult.data : fetchResult;
  const sourceUrl = safeString(data.url || data.source_url || requestedUrl);
  const markdown = safeString(data.markdown || data.text || data.content);
  const title = safeString(data.title) || sourceUrl;
  const description = safeString(data.description || data.summary) || summarizeMarkdown(markdown, title);
  return {
    kind: safeString(data.kind || data.source_kind || 'web_page'),
    url: sourceUrl,
    title,
    description,
    markdown,
    truncated: data.truncated === true,
    metadata: data.metadata || data.source_metadata || {},
    diagnostics: data.diagnostics || fetchResult.diagnostics || {},
  };
}

function createFetchedSourceContext(record, sourceMaterial = {}, now) {
  const description = buildSourceDescription(sourceMaterial);
  const input = record.creative_context?.input || record.input || {};
  const ignoredUrlCount = Number(input.ignored_url_count) || 0;
  return {
    ...(record.source_context || {}),
    status: 'ready',
    kind: 'source_url',
    summary: description,
    transcript: safeString(sourceMaterial.markdown),
    comments_summary: '',
    source_url: sourceMaterial.url,
    source_kind: sourceMaterial.kind,
    title: sourceMaterial.title,
    description,
    source_metadata: {
      ...(sourceMaterial.metadata || {}),
      kind: safeString(sourceMaterial.kind),
      url: safeString(sourceMaterial.url || input.source_url),
      title: safeString(sourceMaterial.title),
      truncated: sourceMaterial.truncated === true,
      source_url: sourceMaterial.url,
      source_kind: sourceMaterial.kind,
      user_hint: safeString(record.creative_context?.input?.source_hint),
    },
    diagnostics: {
      ...(sourceMaterial.diagnostics || {}),
      source_type: 'source_url',
      source_kind: safeString(sourceMaterial.kind),
      fetched_at: now,
      ignored_url_count: ignoredUrlCount,
      prepared_at: now,
    },
  };
}

function normalizeSourceFetchDiagnostics(fetchResult = {}) {
  const data = fetchResult?.data && typeof fetchResult.data === 'object' ? fetchResult.data : fetchResult;
  return {
    ...(data?.diagnostics && typeof data.diagnostics === 'object' ? data.diagnostics : {}),
    ...(data?.diagnostic && typeof data.diagnostic === 'object' ? data.diagnostic : {}),
    ...(fetchResult?.diagnostics && typeof fetchResult.diagnostics === 'object' ? fetchResult.diagnostics : {}),
    ...(fetchResult?.diagnostic && typeof fetchResult.diagnostic === 'object' ? fetchResult.diagnostic : {}),
  };
}

function updateFailedSourceUrlSourceContext(record, requestedUrl, failure = {}, now) {
  const data = failure?.data && typeof failure.data === 'object' ? failure.data : failure;
  const sourceUrl = safeString(data?.url || data?.source_url || requestedUrl);
  const sourceKind = safeString(data?.kind || data?.source_kind);
  const message = safeString(data?.message || data?.error || failure?.message || failure?.error)
    || '外部来源读取失败。';
  const diagnostics = normalizeSourceFetchDiagnostics(failure);
  const sourceContext = {
    ...(record.source_context || {}),
    status: 'failed',
    kind: 'source_url',
    summary: message,
    source_url: sourceUrl,
    source_kind: sourceKind,
    source_metadata: {
      ...(record.source_context?.source_metadata || {}),
      ...(data?.metadata && typeof data.metadata === 'object' ? data.metadata : {}),
      url: sourceUrl,
      source_url: sourceUrl,
      source_kind: sourceKind,
      user_hint: safeString(record.creative_context?.input?.source_hint),
    },
    diagnostics: {
      ...(record.source_context?.diagnostics || {}),
      ...diagnostics,
      source_type: 'source_url',
      failed_at: now,
      message,
    },
  };
  record.source_context = sourceContext;
  record.creative_context = {
    ...(record.creative_context || {}),
    source_context: sourceContext,
  };
  return sourceContext;
}

async function writeSyntheticSourceWorkspace(record, mediaRoot, fetched = {}, now) {
  const sourceMaterial = fetched || {};
  const paths = mediaPipeline.getMediaPaths(record.aweme_id, mediaRoot);
  const userHint = safeString(record.creative_context?.input?.source_hint);
  const description = buildSourceDescription(sourceMaterial);
  const sourceContext = createFetchedSourceContext(record, sourceMaterial, now);
  const creativeContextWithSource = {
    ...(record.creative_context || {}),
    source_context: sourceContext,
  };

  await fsp.mkdir(paths.framesDir, { recursive: true });

  const sourceMaterialPayload = {
    kind: sourceMaterial.kind,
    url: sourceMaterial.url,
    title: sourceMaterial.title,
    description,
    markdown: sourceMaterial.markdown,
    truncated: sourceMaterial.truncated === true,
    user_hint: userHint,
    metadata: sourceMaterial.metadata || {},
  };

  await writeJson(paths.metadata, {
    aweme_id: record.aweme_id,
    source_type: 'source_url',
    source_kind: sourceMaterial.kind,
    source_url: sourceMaterial.url,
    title: sourceMaterial.title,
    description,
    user_hint: userHint,
    source_material: sourceMaterialPayload,
    creative_workflow_id: record.workflow_id,
    created_at: record.created_at,
    updated_at: now,
  });

  await writeJson(paths.transcript, {
    success: true,
    status: 'done',
    source_type: 'source_url',
    source_kind: sourceMaterial.kind,
    source_url: sourceMaterial.url,
    title: sourceMaterial.title,
    text: sourceMaterial.markdown,
    truncated: sourceMaterial.truncated === true,
    user_hint: userHint,
    updated_at: now,
  });

  await writeJson(paths.analysisInput, {
    aweme_id: record.aweme_id,
    video: {
      title: sourceMaterial.title,
      description,
      author: {},
      statistics: {},
      aweme_url: '',
      source_url: sourceMaterial.url,
    },
    local_assets: {
      dir: paths.dir,
      metadata: paths.metadata,
      video: '',
      audio: '',
      frames: [],
    },
    comments_summary: {
      status: 'disabled',
      message: '外部来源创作暂无评论素材。',
    },
    transcript: {
      status: 'done',
      path: paths.transcript,
    },
    source_material: sourceMaterialPayload,
    steps: {
      metadata: { status: 'done', path: paths.metadata },
      transcript: { status: 'done', path: paths.transcript },
      analysis_input: { status: 'done', path: paths.analysisInput },
    },
    creative_context: creativeContextWithSource,
    updated_at: now,
  });

  record.source_context = sourceContext;
  record.creative_context = creativeContextWithSource;

  return {
    success: true,
    message: '外部来源资料已读取并准备完成。',
    paths,
    source_context: sourceContext,
  };
}

async function prepareSourceUrl(record, mediaRoot, now, services = {}, reportStage = null) {
  const sourceUrl = safeString(record.creative_context?.input?.source_url || record.input?.source_url);
  if (!sourceUrl) {
    const message = '外部来源链接为空，请重新输入文章或 GitHub 仓库链接。';
    updateFailedSourceUrlSourceContext(record, sourceUrl, {
      message,
    }, now);
    return {
      success: false,
      message,
    };
  }

  const fetcher = services.sourceFetch;
  if (!fetcher || typeof fetcher.fetchSource !== 'function') {
    updateFailedSourceUrlSourceContext(record, sourceUrl, {
      url: sourceUrl,
      message: '外部来源抓取服务未配置。',
      diagnostic: { code: 'SOURCE_FETCH_UNCONFIGURED' },
    }, now);
    return {
      success: false,
      message: '外部来源抓取服务未配置。',
    };
  }

  if (typeof reportStage === 'function') {
    await reportStage(getSourceUrlLoadingMessage(sourceUrl), 15, { source_url: sourceUrl });
  }

  let fetched;
  try {
    fetched = await fetcher.fetchSource(sourceUrl);
  } catch (error) {
    const diagnostic = {
      code: 'SOURCE_FETCH_EXCEPTION',
      error: safeString(error && error.message),
    };
    const message = '读取外部来源失败，请确认链接可公开访问。';
    updateFailedSourceUrlSourceContext(record, sourceUrl, {
      url: sourceUrl,
      message,
      diagnostic,
    }, now);
    return {
      success: false,
      message,
      diagnostic,
    };
  }

  if (!fetched || fetched.success === false) {
    const message = safeString(fetched?.message || fetched?.error) || '读取外部来源失败，请确认链接可公开访问。';
    updateFailedSourceUrlSourceContext(record, sourceUrl, {
      ...(fetched || {}),
      url: sourceUrl,
      message,
    }, now);
    return {
      success: false,
      message,
      result: fetched,
    };
  }

  const sourceMaterial = normalizeFetchedSource(fetched, sourceUrl);
  if (!sourceMaterial.markdown) {
    updateFailedSourceUrlSourceContext(record, sourceUrl, {
      ...(fetched || {}),
      url: sourceMaterial.url,
      kind: sourceMaterial.kind,
      message: '外部来源读取失败：未生成可用于创作的 Markdown 内容。',
      diagnostics: sourceMaterial.diagnostics,
    }, now);
    return {
      success: false,
      message: '外部来源读取失败：未生成可用于创作的 Markdown 内容。',
      result: fetched,
    };
  }

  if (typeof reportStage === 'function') {
    await reportStage('外部来源资料已读取，正在准备创作上下文...', 70, {
      source_url: sourceUrl,
      source_kind: fetched.kind,
      title: fetched.title || '',
    });
  }

  return writeSyntheticSourceWorkspace(record, mediaRoot, sourceMaterial, now);
}

function hasPreparedLocalMedia(analysisInput = {}, status = {}) {
  if (status && Object.prototype.hasOwnProperty.call(status, 'assets')) {
    const localAssets = analysisInput.local_assets || {};
    const localVideo = safeString(localAssets.video);
    const statusVideo = safeString(status.assets?.video?.path);
    const analysisFrames = Array.isArray(localAssets.frames) ? localAssets.frames : [];
    const statusFramePaths = new Set(
      (Array.isArray(status.frames) ? status.frames : [])
        .map(frame => safeString(frame?.path))
        .filter(Boolean)
        .map(framePath => path.resolve(framePath)),
    );
    const hasMatchingFrame = analysisFrames.some(framePath => (
      statusFramePaths.has(path.resolve(safeString(framePath)))
    ));
    return !!(
      (localVideo && statusVideo && path.resolve(localVideo) === path.resolve(statusVideo))
      || hasMatchingFrame
    );
  }

  const localAssets = analysisInput.local_assets || {};
  const analysisFrames = Array.isArray(localAssets.frames) ? localAssets.frames : [];
  return !!(
    safeString(localAssets.video)
    || analysisFrames.length > 0
  );
}

function hasReusableDouyinSource(status) {
  return !!(
    status
    && status.success !== false
    && status.exists
    && status.analysis_input
    && hasPreparedLocalMedia(status.analysis_input, status)
  );
}

function createDouyinDetailFailureMessage(detail = {}) {
  if (detail.needLogin) {
    return '需要先登录抖音后才能获取视频资料，请扫码登录后重试。';
  }
  if (detail.needVerify) {
    return '抖音需要完成验证后才能获取视频资料，请完成验证后重试。';
  }
  const detailMessage = safeString(detail.message || detail.error);
  return detailMessage
    ? `获取抖音视频资料失败：${detailMessage}`
    : '获取抖音视频资料失败，请稍后重试。';
}

function resolveDouyinDetailGetter(services = {}) {
  if (typeof services.getVideoDetail === 'function') {
    return services.getVideoDetail;
  }
  if (typeof services.douyinDetailService?.getVideoDetail === 'function') {
    return services.douyinDetailService.getVideoDetail.bind(services.douyinDetailService);
  }
  return require('../../scraper/douyin').getVideoDetail;
}

function updatePreparedDouyinSourceContext(record, metadata = {}, result = {}, now) {
  const analysisInput = result.analysis_input || {};
  const video = analysisInput.video || {};
  const title = safeString(metadata.title || video.title);
  const description = safeString(metadata.description || video.description);
  const sourceContext = {
    ...(record.source_context || {}),
    ...(record.creative_context?.source_context || {}),
    status: 'ready',
    kind: 'douyin',
    summary: title || description || `抖音视频 ${record.aweme_id}`,
    transcript: safeString(record.creative_context?.source_context?.transcript),
    comments_summary: safeString(record.creative_context?.source_context?.comments_summary),
    douyin_metadata: {
      ...(record.creative_context?.source_context?.douyin_metadata || {}),
      ...metadata,
      aweme_id: safeString(metadata.aweme_id || record.aweme_id),
      title,
      description,
    },
    diagnostics: {
      ...(record.creative_context?.source_context?.diagnostics || {}),
      source_type: 'douyin',
      prepared_at: now,
      cache: result.cache || null,
      steps: result.steps || {},
    },
  };

  record.source_context = sourceContext;
  record.creative_context = {
    ...record.creative_context,
    source_context: sourceContext,
  };
  return sourceContext;
}

async function prepareDouyinSource(record, mediaRoot, now, services = {}) {
  const pipeline = services.mediaPipeline || mediaPipeline;
  const awemeId = safeString(record.aweme_id);
  const status = await pipeline.getStatus(awemeId, { rootDir: mediaRoot });

  if (hasReusableDouyinSource(status)) {
    updatePreparedDouyinSourceContext(record, status.metadata || {}, {
      analysis_input: status.analysis_input,
      cache: { metadata: 'local', force: false },
      steps: status.steps || {},
    }, now);
    return {
      success: true,
      message: '已复用本地抖音素材。',
      status,
    };
  }

  let metadata = status?.metadata?.aweme_id ? status.metadata : null;
  let detail = null;

  if (!metadata) {
    const getVideoDetail = resolveDouyinDetailGetter(services);
    detail = await getVideoDetail(awemeId);
    if (!detail || detail.success === false || detail.needLogin || detail.needVerify) {
      return {
        success: false,
        message: createDouyinDetailFailureMessage(detail || {}),
        detail_diagnostic: detail?.diagnostic,
      };
    }
    metadata = detail.data;
  }

  if (!metadata?.aweme_id) {
    return {
      success: false,
      aweme_id: awemeId,
      message: '抖音视频资料缺少 aweme_id，无法准备本地素材。',
      detail_diagnostic: detail?.diagnostic,
    };
  }

  const prepared = await pipeline.prepareDouyinMedia(awemeId, metadata, {
    rootDir: mediaRoot,
    force: false,
  });
  if (!prepared || prepared.success === false) {
    return {
      success: false,
      message: safeString(prepared?.message || prepared?.error) || '抖音素材准备失败，请稍后重试。',
      result: prepared,
    };
  }

  const preparedStatus = await pipeline.getStatus(awemeId, { rootDir: mediaRoot });
  if (!hasReusableDouyinSource(preparedStatus)) {
    return {
      success: false,
      message: '抖音素材准备失败：未生成可用的本地视频或关键帧。',
      result: prepared,
      status: preparedStatus,
    };
  }

  updatePreparedDouyinSourceContext(record, preparedStatus.metadata || metadata, {
    ...preparedStatus,
    cache: prepared.cache || { metadata: detail ? 'remote' : 'local', force: false },
  }, now);
  return {
    ...prepared,
    success: true,
    message: detail ? '抖音来源资料已获取并准备完成。' : '已复用本地抖音元数据并准备素材。',
    detail_diagnostic: detail?.diagnostic,
    elapsed: detail?.elapsed,
  };
}

async function prepareSource(record, mediaRoot, now, services = {}, reportStage = null) {
  if (record.creative_context?.input?.mode === 'text') {
    return writeSyntheticTextWorkspace(record, mediaRoot, now);
  }

  if (record.creative_context?.input?.mode === 'source_url') {
    return prepareSourceUrl(record, mediaRoot, now, services, reportStage);
  }

  return prepareDouyinSource(record, mediaRoot, now, services);
}

function buildSourceMaterialForAssets(record = {}) {
  const input = record.creative_context?.input || record.input || {};
  if (input.mode === 'douyin') return null;
  const sourceContext = record.creative_context?.source_context || record.source_context || {};
  if (input.mode === 'text') {
    const rawText = safeString(input.raw_text);
    return rawText ? {
      kind: 'text',
      url: '',
      title: rawText.slice(0, 80),
      description: rawText,
      markdown: rawText,
      metadata: {},
    } : null;
  }
  return {
    kind: safeString(sourceContext.source_kind || sourceContext.source_metadata?.kind || 'article'),
    url: safeString(sourceContext.source_url || sourceContext.source_metadata?.url || input.source_url),
    title: safeString(sourceContext.title || sourceContext.source_metadata?.title || input.source_hint),
    description: safeString(sourceContext.description || sourceContext.summary || input.source_hint),
    markdown: safeString(sourceContext.transcript || sourceContext.markdown),
    metadata: sourceContext.source_metadata || {},
  };
}

async function writeAssetContextToAnalysisInput(record, mediaRoot, assetContext) {
  const paths = mediaPipeline.getMediaPaths(record.aweme_id, mediaRoot);
  let analysisInput = {};
  try {
    analysisInput = await readJson(paths.analysisInput);
  } catch {
    return;
  }
  analysisInput.local_assets = {
    ...(analysisInput.local_assets || {}),
    images: Array.isArray(assetContext.assets)
      ? assetContext.assets.map(asset => asset.local_path || asset.path).filter(Boolean)
      : [],
    source_assets: assetContext,
  };
  analysisInput.creative_context = {
    ...(analysisInput.creative_context || {}),
    asset_context: assetContext,
  };
  await writeJson(paths.analysisInput, analysisInput);
}

async function prepareSourceAssetContext(record, mediaRoot, now, services = {}, reportStage = null) {
  const inputMode = record.creative_context?.input?.mode || record.input?.mode || '';
  if (inputMode === 'douyin') {
    const assetContext = creativeContext.createDisabledAssetContext({ now });
    record.asset_context = assetContext;
    record.creative_context = {
      ...(record.creative_context || {}),
      asset_context: assetContext,
    };
    return {
      success: true,
      skipped: true,
      message: '抖音来源已使用原视频素材，跳过图片补图。',
      asset_context: assetContext,
    };
  }

  const sourceMaterial = buildSourceMaterialForAssets(record);
  if (!sourceMaterial?.markdown && !sourceMaterial?.title && !sourceMaterial?.description) {
    const assetContext = {
      ...creativeContext.createDisabledAssetContext({ now }),
      status: 'empty',
      summary: '没有可用于提取或搜索图片的来源内容。',
    };
    record.asset_context = assetContext;
    record.creative_context = {
      ...(record.creative_context || {}),
      asset_context: assetContext,
    };
    return {
      success: true,
      message: assetContext.summary,
      asset_context: assetContext,
    };
  }

  if (typeof reportStage === 'function') {
    await reportStage('正在提取文章图片并补充搜索素材...', 25);
  }

  const paths = mediaPipeline.getMediaPaths(record.aweme_id, mediaRoot);
  const service = services.sourceAssets || defaultSourceAssets;
  const assetContext = await service.prepareSourceAssets({
    sourceMaterial,
    projectDir: paths.dir,
    assetDir: path.join(paths.dir, 'assets'),
    now,
    deps: {
      fetchImpl: services.fetchImpl,
      pexelsApiKey: services.pexelsApiKey,
    },
  });
  record.asset_context = assetContext;
  record.creative_context = {
    ...(record.creative_context || {}),
    asset_context: assetContext,
  };
  await writeAssetContextToAnalysisInput(record, mediaRoot, assetContext);
  return {
    success: true,
    message: assetContext.summary || '图片素材准备完成。',
    asset_context: assetContext,
  };
}

module.exports = {
  prepareSource,
  prepareSourceAssetContext,
};
