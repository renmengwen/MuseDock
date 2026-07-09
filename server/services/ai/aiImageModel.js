const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const aiModelConfig = require('./aiModelConfig');

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value) {
  return safeString(value).replace(/\/+$/, '');
}

function sanitizeErrorDetail(detail, apiKey) {
  const text = safeString(detail);
  if (!text) return '';
  return apiKey ? text.split(apiKey).join('[已隐藏]') : text;
}

function extensionFromMime(mime) {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  return '.png';
}

function isGptImageModel(modelId = '') {
  return safeString(modelId).toLowerCase().startsWith('gpt-image-');
}

function normalizeGptImageSize(size = '') {
  const text = safeString(size);
  if (text === '1600x2848') return '1024x1536';
  if (text === '2848x1600') return '1536x1024';
  return text || '1024x1024';
}

async function readLimitedImageBuffer(response, maxBytes = MAX_IMAGE_BYTES) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('图片超过大小限制（30MB）。');
  }
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > maxBytes) {
          await reader.cancel?.();
          throw new Error('图片超过大小限制（30MB）。');
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks, total);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error('图片超过大小限制（30MB）。');
  }
  return buffer;
}

async function generateImages(request = {}) {
  const runtime = await aiModelConfig.getRuntimeConfig('image', { configPath: request.configPath });
  if (!runtime || runtime.enabled !== true || !runtime.apiKey || !runtime.baseUrl || !runtime.modelId) {
    return { success: false, configured: false, images: [], message: '生图模型未配置，已跳过图片生成。' };
  }
  const fetchImpl = request.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { success: false, configured: true, images: [], message: '当前运行环境不支持 fetch。' };
  }
  const prompt = safeString(request.prompt);
  if (!prompt) {
    return { success: false, configured: true, images: [], message: '生图 prompt 为空。' };
  }

  const maxImages = Number.isFinite(Number(request.maxImages))
    ? Math.min(10, Math.max(1, Math.round(Number(request.maxImages))))
    : 1;
  const referenceImages = Array.isArray(request.referenceImages)
    ? request.referenceImages.map(safeString).filter(Boolean).slice(0, 10)
    : [];
  const isGptImage = isGptImageModel(runtime.modelId);
  const body = isGptImage
    ? {
      model: runtime.modelId,
      prompt,
      size: normalizeGptImageSize(request.size),
      quality: safeString(request.quality) || 'high',
      output_format: 'png',
      n: maxImages,
    }
    : {
      model: runtime.modelId,
      prompt,
      size: safeString(request.size) || '2K',
      watermark: false,
      output_format: 'png',
      response_format: 'url',
    };
  if (referenceImages.length) body.image = referenceImages;
  if (!isGptImage && maxImages > 1) {
    body.sequential_image_generation = 'auto';
    body.sequential_image_generation_options = { max_images: maxImages };
  }

  let response;
  try {
    response = await fetchImpl(`${normalizeBaseUrl(runtime.baseUrl)}/images/generations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${runtime.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: request.signal || AbortSignal.timeout(Number(request.timeoutMs) || 180000),
    });
  } catch (error) {
    return {
      success: false,
      configured: true,
      images: [],
      message: `生图请求失败：${sanitizeErrorDetail(error?.message, runtime.apiKey) || '网络错误'}`,
    };
  }

  let data = null;
  let rawText = '';
  try {
    rawText = await response.text();
    data = JSON.parse(rawText);
  } catch {}
  const providerError = data?.error?.message || data?.message || '';
  if (!response.ok || providerError) {
    return {
      success: false,
      configured: true,
      images: [],
      message: `生图模型返回错误（HTTP ${response.status}）：${sanitizeErrorDetail(providerError || rawText, runtime.apiKey) || '未知错误'}`,
    };
  }
  const images = (Array.isArray(data?.data) ? data.data : [])
    .map(item => ({
      url: safeString(item?.url),
      b64_json: safeString(item?.b64_json),
      size: safeString(item?.size),
      revised_prompt: safeString(item?.revised_prompt),
      mime: `image/${safeString(data?.output_format) || 'png'}`,
    }))
    .filter(item => item.url || item.b64_json);
  if (!images.length) {
    return { success: false, configured: true, images: [], message: '生图模型未返回任何图片。' };
  }
  return {
    success: true,
    configured: true,
    images,
    message: `已生成 ${images.length} 张图片。`,
    model_info: { provider: runtime.provider, model_id: runtime.modelId, protocol: runtime.protocol },
  };
}

async function downloadGeneratedImages({ images = [], assetDir, fetchImpl, startIndex = 0 } = {}) {
  const impl = fetchImpl || globalThis.fetch;
  if (typeof impl !== 'function') {
    return { success: false, files: [], failures: [{ message: '当前运行环境不支持 fetch。' }] };
  }
  if (!assetDir) {
    return { success: false, files: [], failures: [{ message: '缺少 assetDir。' }] };
  }
  await fsp.mkdir(assetDir, { recursive: true });
  const files = [];
  const failures = [];
  for (let index = 0; index < images.length; index += 1) {
    const b64Json = safeString(images[index]?.b64_json);
    if (b64Json) {
      try {
        const buffer = Buffer.from(b64Json, 'base64');
        if (!buffer.length) throw new Error('base64 内容为空。');
        if (buffer.length > MAX_IMAGE_BYTES) throw new Error('图片超过大小限制（30MB）。');
        const mime = safeString(images[index]?.mime).startsWith('image/') ? safeString(images[index].mime) : 'image/png';
        if (mime === 'image/svg+xml') throw new Error('不支持 SVG 图片。');
        const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 10);
        const fileName = `generated-image-${String(startIndex + index + 1).padStart(2, '0')}-${hash}${extensionFromMime(mime)}`;
        const localPath = path.join(assetDir, fileName);
        await fsp.writeFile(localPath, buffer);
        files.push({ url: '', local_path: localPath, file_name: fileName, bytes: buffer.length, mime });
      } catch (error) {
        failures.push({ message: `base64 图片落盘失败：${safeString(error?.message) || '未知错误'}` });
      }
      continue;
    }
    const url = safeString(images[index]?.url);
    if (!url) continue;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      failures.push({ url, message: '下载失败：URL 无效。' });
      continue;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      failures.push({ url, message: `下载失败：不支持的协议 ${parsed.protocol}` });
      continue;
    }
    try {
      const response = await impl(url, { signal: AbortSignal.timeout(60000) });
      if (!response || !response.ok) {
        failures.push({ url, message: `下载失败：HTTP ${response?.status || 'NO_RESPONSE'}` });
        continue;
      }
      const mime = safeString(response.headers?.get?.('content-type')).split(';')[0] || 'image/png';
      if (!mime.startsWith('image/') || mime === 'image/svg+xml') {
        failures.push({ url, message: `下载失败：响应不是图片（${mime || '未知类型'}）。` });
        continue;
      }
      const buffer = await readLimitedImageBuffer(response, MAX_IMAGE_BYTES);
      const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
      const fileName = `generated-image-${String(startIndex + index + 1).padStart(2, '0')}-${hash}${extensionFromMime(mime)}`;
      const localPath = path.join(assetDir, fileName);
      await fsp.writeFile(localPath, buffer);
      files.push({ url, local_path: localPath, file_name: fileName, bytes: buffer.length, mime });
    } catch (error) {
      failures.push({ url, message: `下载失败：${safeString(error?.message) || '未知错误'}` });
    }
  }
  return { success: files.length > 0, files, failures };
}

async function isConfigured({ configPath } = {}) {
  const runtime = await aiModelConfig.getRuntimeConfig('image', { configPath });
  return Boolean(runtime && runtime.enabled === true && runtime.apiKey && runtime.baseUrl && runtime.modelId);
}

module.exports = {
  generateImages,
  downloadGeneratedImages,
  isConfigured,
  readLimitedImageBuffer,
};
