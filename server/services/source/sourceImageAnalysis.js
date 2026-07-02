const fsp = require('fs/promises');
const path = require('path');

const MAX_ANALYZED_IMAGES = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DISABLED_SUMMARY = '来源图片多模态分析已关闭，系统将使用图片说明、URL 和上下文进行轻量匹配。';

function safeString(value) {
  return String(value || '').trim();
}

function disabledAsset(asset) {
  return {
    ...asset,
    image_analysis: {
      status: 'disabled',
      message: DISABLED_SUMMARY,
    },
  };
}

function skippedAsset(asset, message) {
  return {
    ...asset,
    image_analysis: {
      status: 'skipped',
      message,
    },
  };
}

function failedAsset(asset, message) {
  return {
    ...asset,
    image_analysis: {
      status: 'failed',
      message: safeString(message) || '图片多模态分析失败。',
    },
  };
}

function mimeFromAsset(asset = {}) {
  const mime = safeString(asset.mime).toLowerCase();
  if (mime.startsWith('image/')) return mime;
  const ext = path.extname(safeString(asset.local_path) || safeString(asset.path)).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.avif') return 'image/avif';
  return 'image/jpeg';
}

function parseImageAnalysisJson(text) {
  const trimmed = safeString(text);
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function normalizeImageAnalysis(data = {}) {
  return {
    status: 'ready',
    visual_type: safeString(data.visual_type),
    summary: safeString(data.summary),
    contains_text: data.contains_text === true,
    text_readability: safeString(data.text_readability),
    best_usage: safeString(data.best_usage),
    fit: safeString(data.fit),
    should_use: data.should_use === true,
    relevance_keywords: Array.isArray(data.relevance_keywords)
      ? data.relevance_keywords.map(safeString).filter(Boolean).slice(0, 6)
      : [],
    avoid_reason: safeString(data.avoid_reason),
  };
}

function buildPrompt(asset = {}) {
  return [
    '请分析这张来源文章图片是否适合作为视频或图文创作素材。',
    '只返回严格 JSON，不要解释、不要 Markdown。',
    '字段必须包含：visual_type, summary, contains_text, text_readability, best_usage, fit, should_use, relevance_keywords, avoid_reason。',
    `图片说明：${safeString(asset.alt || asset.title) || '无'}`,
    `图片 URL：${safeString(asset.url) || '无'}`,
  ].join('\n');
}

async function analyzeArticleAsset(asset, model, runtime = {}) {
  if (!safeString(asset.local_path)) {
    return failedAsset(asset, '图片缺少本地路径，无法进行多模态分析。');
  }
  let stat;
  try {
    stat = await fsp.stat(asset.local_path);
  } catch {
    return failedAsset(asset, '图片本地文件不存在，无法进行多模态分析。');
  }
  if (!stat.isFile()) {
    return failedAsset(asset, '图片本地路径不是文件，无法进行多模态分析。');
  }
  if (stat.size > MAX_IMAGE_BYTES) {
    return failedAsset(asset, '图片超过 8MB 大小限制，已跳过多模态分析。');
  }
  if (!model || typeof model.callTextModel !== 'function') {
    return failedAsset(asset, '未配置可用的多模态模型调用入口。');
  }

  try {
    const buffer = await fsp.readFile(asset.local_path);
    const mime = mimeFromAsset(asset);
    const request = {
      provider: runtime.provider,
      modelId: runtime.modelId,
      textConfig: runtime,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(asset) },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } },
        ],
      }],
    };
    const response = await model.callTextModel(request);
    if (!response || response.success === false) {
      return failedAsset(asset, response?.message || '模型失败：未返回有效结果。');
    }
    const analysis = normalizeImageAnalysis(parseImageAnalysisJson(response.text));
    return { ...asset, image_analysis: analysis };
  } catch (error) {
    return failedAsset(asset, `模型失败：${safeString(error.message) || '未知错误'}`);
  }
}

async function analyzeSourceImageAssets({
  enabled = false,
  assets = [],
  model = null,
  runtime = {},
} = {}) {
  const inputAssets = Array.isArray(assets) ? assets : [];
  if (enabled !== true) {
    return {
      status: 'disabled',
      assets: inputAssets.map(disabledAsset),
      summary: DISABLED_SUMMARY,
    };
  }

  let analyzedCount = 0;
  const outputAssets = [];
  for (const asset of inputAssets) {
    if (asset?.source !== 'article') {
      outputAssets.push(skippedAsset(asset, '搜索或 Pexels 补图不作为来源证据，已跳过多模态分析。'));
      continue;
    }
    if (analyzedCount >= MAX_ANALYZED_IMAGES) {
      outputAssets.push(skippedAsset(asset, '已达到来源图片多模态分析数量上限。'));
      continue;
    }
    analyzedCount += 1;
    outputAssets.push(await analyzeArticleAsset(asset, model, runtime));
  }

  const readyCount = outputAssets.filter(asset => asset.image_analysis?.status === 'ready').length;
  const failedCount = outputAssets.filter(asset => asset.image_analysis?.status === 'failed').length;
  const status = readyCount && failedCount ? 'partial' : readyCount ? 'ready' : failedCount ? 'failed' : 'skipped';
  return {
    status,
    assets: outputAssets,
    summary: readyCount && failedCount
      ? `已完成 ${readyCount} 张来源图片多模态分析，${failedCount} 张失败后降级。`
      : readyCount
        ? `已完成 ${readyCount} 张来源图片多模态分析。`
      : failedCount
        ? '来源图片多模态分析失败。'
        : '没有可分析的来源图片，已跳过多模态分析。',
  };
}

module.exports = {
  MAX_ANALYZED_IMAGES,
  MAX_IMAGE_BYTES,
  analyzeSourceImageAssets,
  normalizeImageAnalysis,
  parseImageAnalysisJson,
};
