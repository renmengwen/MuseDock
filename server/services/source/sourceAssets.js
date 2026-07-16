const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns/promises');
const net = require('net');
const { normalizeVisualAsset } = require('../creative/visualAssetContract');

const DEFAULT_MAX_ARTICLE_IMAGES = 6;
const DEFAULT_MAX_SEARCH_IMAGES = 3;
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 3;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function safeString(value) {
  return String(value || '').trim();
}

function extractMarkdownImages(markdown = '', baseUrl = '') {
  const images = [];
  const seen = new Set();
  const addImage = (rawUrl, alt = '') => {
    const resolved = resolvePublicImageUrl(rawUrl, baseUrl);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    images.push({ url: resolved, alt: safeString(alt), source: 'article' });
  };
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of String(markdown || '').matchAll(pattern)) {
    addImage(match[2], match[1]);
  }
  const imgPattern = /<img\b[^>]*>/gi;
  for (const match of String(markdown || '').matchAll(imgPattern)) {
    addImage(extractHtmlAttribute(match[0], 'src'), extractHtmlAttribute(match[0], 'alt'));
  }
  return images;
}

function extractHtmlAttribute(tag = '', name = '') {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = String(tag || '').match(pattern);
  return safeString(match?.[1] || match?.[2] || match?.[3]);
}

function resolvePublicImageUrl(rawUrl, baseUrl = '') {
  const text = safeString(rawUrl);
  if (!text || /^(data|blob|file|javascript):/i.test(text)) return '';
  try {
    const url = baseUrl ? new URL(text, baseUrl) : new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (isBlockedHostname(url.hostname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function extensionFromMime(mime = '', url = '') {
  const lower = String(mime || '').toLowerCase();
  if (lower.includes('png')) return '.png';
  if (lower.includes('webp')) return '.webp';
  if (lower.includes('gif')) return '.gif';
  if (lower.includes('jpeg') || lower.includes('jpg')) return '.jpg';
  if (lower.includes('avif')) return '.avif';
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ['.png', '.webp', '.gif', '.jpg', '.jpeg', '.avif'].includes(ext) ? ext : '.jpg';
  } catch {
    return '.jpg';
  }
}

function normalizeHostname(hostname = '') {
  return safeString(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function ipv4ToNumber(ip) {
  return ip.split('.').reduce((total, part) => ((total << 8) + Number(part)) >>> 0, 0);
}

function isBlockedIpv4(ip) {
  const value = ipv4ToNumber(ip);
  const ranges = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  return ranges.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToNumber(base) & mask);
  });
}

function isBlockedIpv6(ip) {
  const lower = ip.toLowerCase();
  const mappedIpv4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4[1]);
  return lower === '::'
    || lower === '::1'
    || lower.startsWith('fc')
    || lower.startsWith('fd')
    || lower.startsWith('fe8')
    || lower.startsWith('fe9')
    || lower.startsWith('fea')
    || lower.startsWith('feb')
    || lower.startsWith('ff');
}

function isBlockedHostname(hostname = '') {
  const host = normalizeHostname(hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) return isBlockedIpv4(host);
  if (ipVersion === 6) return isBlockedIpv6(host);
  return false;
}

async function assertPublicHttpUrl(rawUrl, deps = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('图片 URL 无效。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('图片 URL 必须是 HTTP 或 HTTPS。');
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error('图片 URL 指向内网或本机地址，已拒绝下载。');
  }
  const lookupHost = deps.lookupHost || dns.lookup;
  const records = await Promise.resolve(lookupHost(url.hostname, { all: true })).catch(() => []);
  const addresses = Array.isArray(records) ? records : [records];
  if (!addresses.length) throw new Error('图片 URL 域名无法解析。');
  if (addresses.some(record => isBlockedHostname(record?.address || record))) {
    throw new Error('图片 URL 解析到内网或本机地址，已拒绝下载。');
  }
  return url.href;
}

function contentLengthTooLarge(headers) {
  const size = Number(getHeader(headers, 'content-length'));
  return Number.isFinite(size) && size > MAX_IMAGE_BYTES;
}

async function readImageBuffer(response) {
  if (contentLengthTooLarge(response.headers)) {
    throw new Error('图片超过大小限制。');
  }
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > MAX_IMAGE_BYTES) {
        throw new Error('图片超过大小限制。');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('图片超过大小限制。');
  }
  return buffer;
}

async function downloadImageAsset(image, index, assetDir, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { success: false, message: '当前运行环境不支持 fetch，无法下载图片素材。' };
  }
  let currentUrl = await assertPublicHttpUrl(image.url, deps);
  let response = null;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await fetchImpl(currentUrl, {
      headers: {
        'user-agent': UA,
        accept: 'image/webp,image/apng,image/png,image/jpeg,image/gif,image/*;q=0.8',
      },
      redirect: 'manual',
      signal: deps.signal || AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (response && response.status >= 300 && response.status < 400) {
      if (redirects >= 5) return { success: false, message: '图片下载重定向次数过多。' };
      const location = getHeader(response.headers, 'location');
      if (!location) return { success: false, message: `图片下载失败：HTTP ${response.status}` };
      currentUrl = await assertPublicHttpUrl(new URL(location, currentUrl).href, deps);
      continue;
    }
    break;
  }
  if (!response || !response.ok) {
    if (response?.status === 429) {
      const fallbackUrl = githubApiContentUrlFromRaw(currentUrl);
      if (fallbackUrl) {
        response = await fetchImpl(fallbackUrl, {
          headers: {
            'user-agent': UA,
            accept: 'application/vnd.github.raw,image/*;q=0.8',
          },
          redirect: 'manual',
          signal: deps.signal || AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        currentUrl = fallbackUrl;
      }
    }
  }
  if (!response || !response.ok) {
    return { success: false, message: `图片下载失败：HTTP ${response ? response.status : 'NO_RESPONSE'}` };
  }
  const mime = getHeader(response.headers, 'content-type').split(';')[0].trim().toLowerCase();
  if (mime && !mime.startsWith('image/')) {
    return { success: false, message: `远端内容不是图片：${mime}` };
  }
  if (mime === 'image/svg+xml') {
    return { success: false, message: '暂不支持 SVG 图片素材。' };
  }
  const buffer = await readImageBuffer(response);
  if (!buffer.length) {
    return { success: false, message: '图片为空或超过大小限制。' };
  }
  await fsp.mkdir(assetDir, { recursive: true });
  const source = image.source === 'search' ? 'search' : 'article';
  const ext = extensionFromMime(mime, currentUrl);
  const hash = crypto.createHash('sha1').update(currentUrl).digest('hex').slice(0, 10);
  const fileName = `${source}-image-${String(index + 1).padStart(2, '0')}-${hash}${ext}`;
  const filePath = path.join(assetDir, fileName);
  await fsp.writeFile(filePath, buffer);
  return {
    success: true,
    asset: normalizeVisualAsset({
      id: `${source}_${String(index + 1).padStart(2, '0')}`,
      type: 'image',
      source,
      origin_detail: safeString(image.origin_detail),
      provider: safeString(image.provider),
      url: currentUrl,
      path: `assets/${fileName}`,
      local_path: filePath,
      alt: safeString(image.alt),
      mime: mime || 'image/jpeg',
      bytes: buffer.length,
      title: safeString(image.title || image.alt),
      attribution: image.attribution || null,
    }),
  };
}

function getHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key] || '';
  }
  return '';
}

function buildSearchQueries(sourceMaterial = {}, max = 3) {
  const fields = [
    sourceMaterial.title,
    sourceMaterial.description,
    sourceMaterial.metadata?.language,
    Array.isArray(sourceMaterial.metadata?.topics) ? sourceMaterial.metadata.topics.join(' ') : '',
  ];
  const text = fields.map(safeString).filter(Boolean).join(' ');
  const compact = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return [];
  const first = compact.split(/\s+/).slice(0, 8).join(' ');
  const queries = [first];
  if (/github|repo|代码|开源|javascript|python|react|node/i.test(compact)) {
    queries.push('software development code');
  }
  if (/ai|人工智能|模型|智能/i.test(compact)) {
    queries.push('artificial intelligence technology');
  }
  return Array.from(new Set(queries.map(safeString).filter(Boolean))).slice(0, max);
}

function githubRawBaseUrl(sourceMaterial = {}) {
  if (safeString(sourceMaterial.kind) !== 'github_repo') return '';
  const metadata = sourceMaterial.metadata || {};
  const owner = safeString(metadata.owner);
  const repo = safeString(metadata.repo);
  if (!owner || !repo) return '';
  const branch = encodeURIComponent(safeString(metadata.default_branch) || 'main');
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${branch}/`;
}

function githubApiContentUrlFromRaw(rawUrl = '') {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return '';
  }
  if (url.hostname !== 'raw.githubusercontent.com') return '';
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 4) return '';
  const [owner, repo, branch, ...fileParts] = parts;
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${fileParts.map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`;
}

async function searchPexelsImages(sourceMaterial = {}, deps = {}) {
  const apiKey = safeString(deps.pexelsApiKey || process.env.PEXELS_API_KEY || process.env.PEXELS_API_KEYS);
  if (!apiKey) {
    return { success: false, skipped: true, code: 'pexels_key_missing', message: '未配置 PEXELS_API_KEY，已跳过 AI 搜图补图。', images: [] };
  }
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { success: false, skipped: true, code: 'fetch_missing', message: '当前运行环境不支持 fetch，已跳过 AI 搜图补图。', images: [] };
  }

  const queries = buildSearchQueries(sourceMaterial);
  const images = [];
  const seen = new Set();
  const failures = [];
  for (const query of queries) {
    if (images.length >= DEFAULT_MAX_SEARCH_IMAGES) break;
    const url = new URL('https://api.pexels.com/v1/search');
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', '3');
    url.searchParams.set('orientation', 'portrait');
    const response = await fetchImpl(url.href, {
      headers: { authorization: apiKey, 'user-agent': UA },
      signal: deps.signal || AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!response || !response.ok) {
      failures.push(response?.status || 'NO_RESPONSE');
      continue;
    }
    const data = await response.json().catch(() => ({}));
    const photos = Array.isArray(data.photos) ? data.photos : [];
    for (const photo of photos) {
      const imageUrl = safeString(photo?.src?.large2x || photo?.src?.large || photo?.src?.original);
      if (!imageUrl || seen.has(imageUrl)) continue;
      seen.add(imageUrl);
      images.push({
        url: imageUrl,
        alt: safeString(photo.alt || query),
        title: safeString(photo.alt || query),
        source: 'search',
        attribution: {
          provider: 'Pexels',
          photographer: safeString(photo.photographer),
          url: safeString(photo.url),
        },
      });
      if (images.length >= DEFAULT_MAX_SEARCH_IMAGES) break;
    }
  }
  if (!images.length && failures.length) {
    const code = failures.some(status => status === 401 || status === 403)
      ? 'pexels_auth_failed'
      : failures.some(status => status === 429)
        ? 'pexels_rate_limited'
        : 'pexels_request_failed';
    const message = code === 'pexels_auth_failed'
      ? 'Pexels API Key 无效或无权限，已跳过 AI 搜图补图。'
      : code === 'pexels_rate_limited'
        ? 'Pexels 请求频率受限，已跳过 AI 搜图补图。'
        : `Pexels 搜图请求失败：HTTP ${failures.join('、')}。`;
    return { success: false, code, message, images: [], queries };
  }
  return { success: true, images, queries };
}

async function prepareSourceAssets({
  sourceMaterial = {},
  projectDir = '',
  assetDir = '',
  now = '',
  maxArticleImages = DEFAULT_MAX_ARTICLE_IMAGES,
  maxSearchImages = DEFAULT_MAX_SEARCH_IMAGES,
  deps = {},
} = {}) {
  const targetAssetDir = assetDir || path.join(projectDir, 'assets');
  const diagnostics = [];
  const articleOriginDetail = safeString(sourceMaterial.kind) === 'github_repo'
    ? 'github_readme'
    : 'article_embedded';
  const articleProvider = safeString(sourceMaterial.kind) === 'github_repo' ? 'github' : '';
  const articleImages = extractMarkdownImages(sourceMaterial.markdown, githubRawBaseUrl(sourceMaterial) || sourceMaterial.url)
    .slice(0, maxArticleImages)
    .map(image => ({ ...image, origin_detail: articleOriginDetail, provider: articleProvider }));
  let candidates = [...articleImages];
  let searchResult = null;
  const runSearch = async () => {
    const result = await (deps.searchImages || searchPexelsImages)(sourceMaterial, deps).catch(error => ({
      success: false,
      code: 'search_failed',
      message: `AI 搜图失败：${safeString(error.message) || '未知错误'}`,
      images: [],
    }));
    if (result?.message) {
      diagnostics.push({ code: result.code || 'image_search', message: result.message });
    }
    return result;
  };
  if (!candidates.length && maxSearchImages > 0) {
    searchResult = await runSearch();
    const searchImages = Array.isArray(searchResult?.images) ? searchResult.images.slice(0, maxSearchImages) : [];
    candidates.push(...searchImages.map(image => ({ ...image, source: 'search' })));
  }

  const assets = [];
  let downloadIndex = 0;
  const downloadCandidates = async (items) => {
    for (let start = 0; start < items.length && assets.length < maxArticleImages + maxSearchImages;) {
      const remaining = maxArticleImages + maxSearchImages - assets.length;
      const batch = items.slice(start, start + Math.min(DOWNLOAD_CONCURRENCY, remaining));
      start += batch.length;
      const baseIndex = downloadIndex;
      downloadIndex += batch.length;
      const results = await Promise.all(batch.map((candidate, offset) => downloadImageAsset(
        candidate,
        baseIndex + offset,
        targetAssetDir,
        deps,
      ).catch(error => ({
        success: false,
        message: safeString(error.message) || '图片下载失败。',
      }))));
      results.forEach((result, offset) => {
        if (result.success && result.asset) {
          assets.push(result.asset);
        } else {
          diagnostics.push({ code: 'image_download_failed', url: batch[offset].url, message: result.message || '图片下载失败。' });
        }
      });
    }
  };
  await downloadCandidates(candidates);
  if (!assets.length && articleImages.length && !searchResult && maxSearchImages > 0) {
    searchResult = await runSearch();
    const searchImages = Array.isArray(searchResult?.images) ? searchResult.images.slice(0, maxSearchImages) : [];
    await downloadCandidates(searchImages.map(image => ({ ...image, source: 'search' })));
  }

  return {
    status: assets.length ? 'ready' : 'empty',
    assets,
    updated_at: now || new Date().toISOString(),
    diagnostics,
    summary: assets.length
      ? `已准备 ${assets.length} 张图片素材。`
      : '未发现可用图片素材。',
    search: searchResult ? {
      success: searchResult.success === true,
      skipped: searchResult.skipped === true,
      queries: searchResult.queries || [],
      message: searchResult.message || '',
    } : null,
  };
}

module.exports = {
  extractMarkdownImages,
  buildSearchQueries,
  searchPexelsImages,
  prepareSourceAssets,
};
