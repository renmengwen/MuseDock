const crypto = require('crypto');
const fsp = require('fs/promises');
const https = require('https');
const path = require('path');

const { normalizeVisualAsset } = require('./visualAssetContract');

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_NETWORK_BYTES = 8 * 1024 * 1024;
const MAX_HEADER_BYTES = 32 * 1024;
const NETWORK_TIMEOUT_MS = 12000;
const VIEWPORT = { width: 1440, height: 900 };
const DOM_EVIDENCE_LIMITS = { scan: 1000, elements: 200, text: 160 };
const STATIC_HOSTS = new Set([
  'avatars.githubusercontent.com',
  'camo.githubusercontent.com',
  'github.githubassets.com',
  'objects.githubusercontent.com',
  'private-user-images.githubusercontent.com',
  'raw.githubusercontent.com',
  'repository-images.githubusercontent.com',
  'user-images.githubusercontent.com',
]);
const FAILURE_MESSAGE = 'GitHub 仓库页面截图失败，已保留其他视觉素材。';
const DOM_EVIDENCE_FAILURE = {
  code: 'page_capture_dom_evidence_unavailable',
  message: '页面 DOM 证据采集失败，已继续保留页面截图。',
  details: { category: 'evaluate_failed' },
};

function emptyResult(diagnostic = null) {
  return {
    status: 'empty',
    assets: [],
    diagnostics: diagnostic ? [diagnostic] : [],
  };
}

function failedResult(category) {
  return emptyResult({
    code: 'page_capture_failed',
    message: FAILURE_MESSAGE,
    details: { category },
  });
}

function githubRepositoryUrl(sourceMaterial = {}) {
  if (sourceMaterial.kind !== 'github_repo') return '';
  const owner = String(sourceMaterial.metadata?.owner || '').trim();
  const repo = String(sourceMaterial.metadata?.repo || '').trim();
  if (!/^(?!-)(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) return '';
  if (!/^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/.test(repo)) return '';
  return `https://github.com/${owner}/${repo}`;
}

function sameRepositoryRoot(rawUrl, canonicalUrl) {
  try {
    const actual = new URL(rawUrl);
    const expected = new URL(canonicalUrl);
    const actualPath = actual.pathname.replace(/\/+$/, '');
    return actual.protocol === 'https:'
      && actual.hostname.toLowerCase() === 'github.com'
      && !actual.port
      && !actual.username
      && !actual.password
      && !actual.search
      && !actual.hash
      && actualPath === expected.pathname;
  } catch {
    return false;
  }
}

function requestIsAllowed(request, canonicalUrl) {
  const type = request.resourceType();
  const url = request.url();
  if (type === 'document') return sameRepositoryRoot(url, canonicalUrl);
  if (type !== 'stylesheet') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      && !parsed.port
      && !parsed.username
      && !parsed.password
      && STATIC_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function headerValues(response, targetName) {
  const values = [];
  const raw = Array.isArray(response.rawHeaders) ? response.rawHeaders : [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    if (String(raw[index]).toLowerCase() === targetName) values.push(String(raw[index + 1]).trim());
  }
  if (values.length) return values;
  const value = response.headers?.[targetName];
  return Array.isArray(value) ? value.map(item => String(item).trim())
    : value === undefined ? [] : [String(value).trim()];
}

function contentLength(response) {
  const values = headerValues(response, 'content-length');
  if (!values.length) return null;
  if (new Set(values).size !== 1 || !/^\d+$/.test(values[0])) throw new Error('invalid content length');
  const bytes = Number(values[0]);
  if (!Number.isSafeInteger(bytes)) throw new Error('invalid content length');
  return bytes;
}

function responseContentType(response, resourceType) {
  const values = headerValues(response, 'content-type');
  if (values.length !== 1) throw new Error('invalid content type');
  const contentType = values[0];
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
  const expected = resourceType === 'document' ? 'text/html' : 'text/css';
  if (mediaType !== expected) throw new Error('unexpected content type');
  return contentType;
}

async function fetchBounded(url, resourceType, budget, requestImpl = https.request) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    let request;
    try {
      request = requestImpl(url, {
        method: 'GET',
        agent: false,
        maxHeaderSize: MAX_HEADER_BYTES,
        timeout: NETWORK_TIMEOUT_MS,
        headers: {
          Accept: resourceType === 'document' ? 'text/html' : 'text/css',
          'Accept-Encoding': 'identity',
          'User-Agent': 'MuseDock/0.0.1 page-capture',
        },
      }, response => {
        (async () => {
          const status = Number(response.statusCode || 0);
          if (status < 200 || status >= 300) throw new Error('unsuccessful response');
          const encodings = headerValues(response, 'content-encoding').map(value => value.toLowerCase());
          if (encodings.some(value => value !== 'identity')) throw new Error('encoded response rejected');
          const contentType = responseContentType(response, resourceType);
          const declaredBytes = contentLength(response);
          const remaining = MAX_PAGE_NETWORK_BYTES - budget.used;
          if (remaining <= 0) throw new Error('page network budget exhausted');
          if (declaredBytes !== null && (declaredBytes > MAX_RESPONSE_BYTES || declaredBytes > remaining)) {
            throw new Error('declared response too large');
          }

          const chunks = [];
          let received = 0;
          for await (const rawChunk of response) {
            const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
            received += chunk.length;
            budget.used += chunk.length;
            if (received > MAX_RESPONSE_BYTES || budget.used > MAX_PAGE_NETWORK_BYTES) {
              response.destroy();
              throw new Error('response too large');
            }
            chunks.push(chunk);
          }
          if (declaredBytes !== null && received !== declaredBytes) throw new Error('content length mismatch');
          return { status, contentType, body: Buffer.concat(chunks, received) };
        })().then(
          result => finish(resolve, result),
          error => {
            response.destroy();
            finish(reject, error);
          },
        );
      });
    } catch (error) {
      finish(reject, error);
      return;
    }
    request.once('error', error => finish(reject, error));
    request.once('timeout', () => request.destroy(new Error('network timeout')));
    request.end();
  });
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function writeFileAtomic(filePath, buffer, deps = {}) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  try {
    await (deps.writeFile || fsp.writeFile)(tempPath, buffer);
    await (deps.renameFile || fsp.rename)(tempPath, filePath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function resolveCapturePath(projectDir, fileName) {
  if (!String(projectDir || '').trim()) throw new Error('missing project directory');
  const projectRoot = path.resolve(projectDir);
  const assetDir = path.join(projectRoot, 'assets');
  await fsp.mkdir(assetDir, { recursive: true });
  const [realProjectRoot, realAssetDir] = await Promise.all([
    fsp.realpath(projectRoot),
    fsp.realpath(assetDir),
  ]);
  if (!inside(realProjectRoot, realAssetDir)) throw new Error('asset directory escaped project');
  const filePath = path.join(realAssetDir, fileName);
  if (!inside(realAssetDir, filePath)) throw new Error('capture path escaped asset directory');
  return filePath;
}

async function loadPlaywright(importPlaywright) {
  const runtime = importPlaywright ? await importPlaywright() : await import('playwright-core');
  const chromium = runtime?.chromium || runtime?.default?.chromium;
  if (!chromium || typeof chromium.launch !== 'function') throw new Error('missing chromium runtime');
  return chromium;
}

async function collectPageCaptureEvidence(page) {
  const raw = await page.evaluate(({ viewport, limits }) => {
    const elements = [];
    const excludedTags = new Set(['html', 'body', 'head', 'script', 'style', 'noscript', 'template', 'meta', 'link', 'base']);
    const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
    const candidates = document.querySelectorAll('*');
    for (let index = 0; index < Math.min(candidates.length, limits.scan); index += 1) {
      if (elements.length >= limits.elements) break;
      const element = candidates[index];
      const tag = String(element.tagName || '').toLowerCase();
      if (excludedTags.has(tag)) continue;
      const directText = Array.from(element.childNodes)
        .filter(node => node.nodeType === 3)
        .map(node => node.textContent)
        .join(' ');
      const text = [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        directText,
        element.children.length ? '' : element.innerText,
      ].map(normalizeText).find(Boolean)?.slice(0, limits.text) || '';
      if (!text) continue;
      let hidden = false;
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)
          || Number(style.opacity) === 0) {
          hidden = true;
          break;
        }
      }
      if (hidden) continue;
      const rect = element.getBoundingClientRect();
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
        || rect.width <= 0 || rect.height <= 0) continue;
      const right = rect.x + rect.width;
      const bottom = rect.y + rect.height;
      if (right <= 0 || bottom <= 0 || rect.x >= viewport.width || rect.y >= viewport.height) continue;
      const left = Math.max(0, rect.x);
      const top = Math.max(0, rect.y);
      const clippedRight = Math.min(viewport.width, right);
      const clippedBottom = Math.min(viewport.height, bottom);
      elements.push({
        tag,
        text,
        region: {
          x: left / viewport.width,
          y: top / viewport.height,
          width: (clippedRight - left) / viewport.width,
          height: (clippedBottom - top) / viewport.height,
        },
      });
    }
    return {
      scroll: {
        x: Number.isFinite(window.scrollX) ? window.scrollX : 0,
        y: Number.isFinite(window.scrollY) ? window.scrollY : 0,
      },
      elements,
    };
  }, { viewport: VIEWPORT, limits: DOM_EVIDENCE_LIMITS });
  return {
    version: 1,
    viewport: { ...VIEWPORT },
    scroll: raw.scroll,
    elements: raw.elements,
  };
}

async function captureGithubRepositoryPage({ sourceMaterial = {}, projectDir = '', now = '', deps = {} } = {}) {
  const canonicalUrl = githubRepositoryUrl(sourceMaterial);
  if (!canonicalUrl) return emptyResult();

  let browser = null;
  let context = null;
  let page = null;
  let category = 'runtime_unavailable';
  try {
    const chromium = await loadPlaywright(deps.importPlaywright);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    context = await browser.newContext({
      viewport: VIEWPORT,
      javaScriptEnabled: false,
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    page = await context.newPage();
    const networkBudget = { used: 0 };
    await page.route('**/*', async route => {
      if (!requestIsAllowed(route.request(), canonicalUrl)) {
        await route.abort();
        return;
      }
      let response;
      try {
        response = await fetchBounded(
          route.request().url(),
          route.request().resourceType(),
          networkBudget,
          deps.httpsRequest || https.request,
        );
      } catch {
        await route.abort();
        return;
      }
      await route.fulfill(response);
    });

    category = 'navigation_failed';
    const response = await page.goto(canonicalUrl, { waitUntil: 'load', timeout: 12000 });
    if (!response || typeof response.ok !== 'function' || !response.ok()) {
      category = 'http_failed';
      throw new Error('github page returned unsuccessful response');
    }
    category = 'redirect_rejected';
    if (!sameRepositoryRoot(page.url(), canonicalUrl)) throw new Error('github page redirected away');

    let pageCaptureEvidence = {
      version: 1,
      viewport: { ...VIEWPORT },
      scroll: { x: 0, y: 0 },
      elements: [],
    };
    let evidenceDiagnostic = null;
    try {
      pageCaptureEvidence = await collectPageCaptureEvidence(page);
    } catch {
      evidenceDiagnostic = DOM_EVIDENCE_FAILURE;
    }

    category = 'capture_invalid';
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    const bytes = Buffer.isBuffer(screenshot)
      ? screenshot
      : screenshot instanceof Uint8Array ? Buffer.from(screenshot) : Buffer.alloc(0);
    if (!bytes.length || bytes.length > MAX_CAPTURE_BYTES) throw new Error('invalid screenshot size');

    const hash = crypto.createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 16);
    const fileName = `github-page-${hash}.png`;
    category = 'write_failed';
    const filePath = await resolveCapturePath(projectDir, fileName);
    if (deps.writeFileAtomic) await deps.writeFileAtomic(filePath, bytes);
    else await writeFileAtomic(filePath, bytes, deps);

    return {
      status: 'ready',
      assets: [normalizeVisualAsset({
        id: `page_capture_github_${hash}`,
        media_type: 'image',
        origin: 'page_capture',
        origin_detail: 'github_repository_page',
        provider: 'chromium',
        requirement: 'optional',
        evidence_class: 'direct_source',
        status: 'ready',
        path: `assets/${fileName}`,
        local_path: filePath,
        url: canonicalUrl,
        mime: 'image/png',
        bytes: bytes.length,
        captured_at: now || new Date().toISOString(),
        page_capture_evidence: pageCaptureEvidence,
      })],
      diagnostics: evidenceDiagnostic ? [evidenceDiagnostic] : [],
      updated_at: now || new Date().toISOString(),
    };
  } catch {
    return failedResult(category);
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

module.exports = {
  MAX_CAPTURE_BYTES,
  MAX_PAGE_NETWORK_BYTES,
  MAX_RESPONSE_BYTES,
  captureGithubRepositoryPage,
};
