const ARTICLE_MAX = 8000;
const README_MAX = 10000;
const FETCH_TIMEOUT_MS = 12000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function safeString(value) {
  return String(value || '').trim();
}

function extractUrls(text, max = 3) {
  const raw = String(text || '');
  const matches = raw.match(/https?:\/\/[^\s<>"'`)\]}，。；;]+/gi) || [];
  const seen = new Set();
  const urls = [];
  for (const match of matches) {
    const url = match.replace(/[.,;:!?，。；：！？]+$/, '');
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
      if (urls.length >= max) break;
    }
  }
  return urls;
}

function assertPublicHttpUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`URL 无效：${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`只支持 http(s) URL：${parsed.protocol}`);
  }

  // 首版只校验 URL 字面量和手动重定向目标；不解析 DNS 结果，如开放给不可信用户需在连接层增强。
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host === '0.0.0.0'
    || host === '::'
    || host === '::1'
    || host.endsWith('.localhost')
    || host.endsWith('.internal')
    || host.endsWith('.local')
    || isPrivateIpv6Host(host)
  ) {
    throw new Error(`出于安全原因，不能读取本机或内网地址：${host}`);
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    const invalid = parts.some(part => !Number.isInteger(part) || part < 0 || part > 255);
    if (invalid) {
      throw new Error(`URL 主机无效：${host}`);
    }
    if (isNonPublicIpv4(parts)) {
      throw new Error(`出于安全原因，不能读取本机或内网地址：${host}`);
    }
  }

  return parsed;
}

function isPrivateIpv6Host(host) {
  const normalized = host.replace(/^\[|\]$/g, '');
  if (!normalized.includes(':')) return false;
  const mapped = ipv4FromMappedIpv6(normalized);
  if (mapped && isNonPublicIpv4(mapped)) return true;
  const compatible = ipv4FromCompatibleIpv6(normalized);
  if (compatible && isNonPublicIpv4(compatible)) return true;
  return (
    normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('100:')
    || normalized.startsWith('2001:db8:')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
  );
}

function ipv4FromCompatibleIpv6(host) {
  const match = host.match(/^::([0-9a-f]{1,4})(?::([0-9a-f]{1,4}))?$/i);
  if (!match) return null;
  const high = match[2] ? parseInt(match[1], 16) : 0;
  const low = parseInt(match[2] || match[1], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return [
    (high >> 8) & 255,
    high & 255,
    (low >> 8) & 255,
    low & 255,
  ];
}

function ipv4FromMappedIpv6(host) {
  const match = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!match) return null;
  const high = parseInt(match[1], 16);
  const low = parseInt(match[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return [
    (high >> 8) & 255,
    high & 255,
    (low >> 8) & 255,
    low & 255,
  ];
}

function isNonPublicIpv4(parts) {
  const [a, b, c] = parts;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
  );
}

function classifySourceUrl(rawUrl) {
  const parsed = assertPublicHttpUrl(rawUrl);
  if (parsed.hostname.toLowerCase() !== 'github.com') {
    return { kind: 'article' };
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  const reserved = new Set([
    'about',
    'advisories',
    'apps',
    'collections',
    'events',
    'features',
    'explore',
    'login',
    'marketplace',
    'notifications',
    'orgs',
    'pricing',
    'search',
    'settings',
    'sponsors',
    'topics',
    'trending',
  ]);
  if (parts.length >= 2 && !reserved.has(parts[0].toLowerCase())) {
    return {
      kind: 'github_repo',
      owner: parts[0],
      repo: parts[1].replace(/\.git$/, ''),
    };
  }
  return { kind: 'article' };
}

async function fetchSource(rawUrl, options = {}) {
  let classification = { kind: 'article' };
  try {
    const parsed = assertPublicHttpUrl(rawUrl);
    classification = classifySourceUrl(parsed.href);
    if (classification.kind === 'github_repo') {
      return await fetchGithubRepo(classification.owner, classification.repo, parsed.href, options);
    }
    return await fetchArticle(parsed.href, options);
  } catch (error) {
    return {
      success: false,
      kind: classification.kind || 'article',
      url: safeString(rawUrl),
      title: '',
      markdown: '',
      truncated: false,
      message: error.message || '读取外部来源失败。',
      diagnostic: { code: 'SOURCE_FETCH_FAILED' },
    };
  }
}

async function fetchArticle(url, options = {}) {
  const html = await fetchText(url, { accept: 'text/html,application/xhtml+xml' }, options);
  const title = extractTitle(html) || url;
  let body = htmlToMarkdown(extractMainHtml(html));
  if (countVisibleLength(body) < 80) {
    throw new Error('未能读取文章正文，请确认链接可公开访问。');
  }
  const truncated = body.length > ARTICLE_MAX;
  if (truncated) body = body.slice(0, ARTICLE_MAX).trimEnd();
  return {
    success: true,
    kind: 'article',
    url,
    title,
    markdown: `# ${title}\n\nSource: ${url}\n\n${body}`.trim(),
    truncated,
    metadata: {},
  };
}

async function fetchGithubRepo(owner, repo, url, options = {}) {
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const ghHeaders = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  let meta;
  try {
    meta = JSON.parse(await fetchText(api, ghHeaders, options));
  } catch (error) {
    throw mapGithubError(error);
  }

  const readme = await fetchText(`${api}/readme`, {
    ...ghHeaders,
    accept: 'application/vnd.github.raw',
  }, options).catch(() => '');
  const tree = await fetchTopLevelTree(api, ghHeaders, options).catch(() => []);

  const title = meta.full_name || `${owner}/${repo}`;
  const lines = [`# ${title}`, '', `Source: ${url}`, ''];
  if (meta.description) lines.push(`> ${meta.description}`, '');

  const facts = [];
  if (meta.language) facts.push(`Language: ${meta.language}`);
  if (typeof meta.stargazers_count === 'number') facts.push(`Stars: ${meta.stargazers_count.toLocaleString('en-US')}`);
  if (meta.license?.spdx_id && meta.license.spdx_id !== 'NOASSERTION') facts.push(`License: ${meta.license.spdx_id}`);
  if (meta.homepage) facts.push(`Homepage: ${meta.homepage}`);
  if (Array.isArray(meta.topics) && meta.topics.length) facts.push(`Topics: ${meta.topics.join(', ')}`);
  if (facts.length) lines.push(...facts.map(item => `- ${item}`), '');

  if (tree.length) {
    lines.push('## Top-level structure', '', ...tree.map(item => `- ${item}`), '');
  }

  let readmeText = String(readme || '').trim();
  const truncated = readmeText.length > README_MAX;
  if (truncated) readmeText = readmeText.slice(0, README_MAX).trimEnd();
  if (readmeText) lines.push('## README', '', readmeText);

  return {
    success: true,
    kind: 'github_repo',
    url,
    title,
    markdown: lines.join('\n').trim(),
    truncated,
    metadata: {
      owner,
      repo,
      language: meta.language || '',
      stars: typeof meta.stargazers_count === 'number' ? meta.stargazers_count : null,
      topics: Array.isArray(meta.topics) ? meta.topics : [],
    },
  };
}

function mapGithubError(error) {
  const message = String(error && error.message || '');
  if (/HTTP 404/.test(message)) {
    return new Error('读取 GitHub 仓库失败：请确认仓库公开可访问。');
  }
  if (/HTTP 403/.test(message)) {
    return new Error('读取 GitHub 仓库失败：GitHub API 访问受限，请稍后重试。');
  }
  return new Error(`读取 GitHub 仓库失败：${message || '未知错误'}`);
}

async function fetchTopLevelTree(api, headers, options) {
  const raw = await fetchText(`${api}/contents`, headers, options);
  const items = JSON.parse(raw);
  return (Array.isArray(items) ? items : [])
    .filter(item => item && item.name)
    .slice(0, 40)
    .map(item => item.type === 'dir' ? `${item.name}/` : item.name);
}

async function fetchText(url, headers, options = {}) {
  let currentUrl = assertPublicHttpUrl(url).href;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前运行环境不支持 fetch，无法读取外部来源。');
  }
  const signal = options.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetchImpl(currentUrl, {
      headers: { 'user-agent': UA, ...headers },
      redirect: 'manual',
      signal,
    });
    if (!response) {
      throw new Error('HTTP NO_RESPONSE');
    }
    if (response.status >= 300 && response.status < 400) {
      if (redirects >= 5) {
        throw new Error('重定向次数过多，已停止读取外部来源。');
      }
      const location = getHeader(response.headers, 'location');
      if (!location) {
        throw new Error(`HTTP ${response.status}`);
      }
      currentUrl = assertPublicHttpUrl(new URL(location, currentUrl).href).href;
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  }
  throw new Error('重定向次数过多，已停止读取外部来源。');
}

function getHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return '';
}

function extractBalanced(html, tag, openTagRe) {
  const match = openTagRe.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length;
  const tagRe = new RegExp(`<(/)?${tag}\\b[^>]*>`, 'gi');
  tagRe.lastIndex = start;
  let depth = 1;
  let next;
  while ((next = tagRe.exec(html))) {
    if (next[1]) {
      depth -= 1;
      if (depth === 0) return html.slice(start, next.index);
    } else if (!/\/>$/.test(next[0])) {
      depth += 1;
    }
  }
  return html.slice(start);
}

function extractMainHtml(html) {
  const wx = extractBalanced(html, 'div', /<div[^>]*\bid=["']js_content["'][^>]*>/i);
  if (wx && wx.length > 80) return wx;
  const article = extractBalanced(html, 'article', /<article[^>]*>/i);
  if (article && article.length > 80) return article;
  const main = extractBalanced(html, 'main', /<main[^>]*>/i);
  if (main && main.length > 80) return main;
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return body && body[1] ? body[1] : html;
}

function extractTitle(html) {
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const meta of metas) {
    const property = getHtmlAttribute(meta, 'property');
    if (property && property.toLowerCase() === 'og:title') {
      const content = getHtmlAttribute(meta, 'content');
      if (content) return decodeEntities(content).replace(/\s+/g, ' ').trim();
    }
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title && title[1] ? decodeEntities(title[1]).replace(/\s+/g, ' ').trim() : '';
}

function getHtmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match && match[2] ? match[2] : '';
}

function htmlToMarkdown(html) {
  let text = String(html || '');
  text = text.replace(/<(script|style|noscript|svg|head|nav|footer|form|iframe)[^>]*>[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, inner) => `\n\n${'#'.repeat(Number(level))} ${stripInline(inner)}\n`);
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner) => `\n- ${stripInline(inner)}`);
  text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, inner) => {
    const label = stripInline(inner);
    return label ? `[${label}](${href})` : '';
  });
  text = text.replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*>/gi, (_match, alt, src) => `![${alt}](${src})`);
  text = text.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, (_match, src) => `![](${src})`);
  text = text.replace(/<(p|div|section|article|tr|h[1-6]|ul|ol|blockquote)[^>]*>/gi, '\n');
  text = text.replace(/<\/(p|div|section|article|tr|li|ul|ol|blockquote)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);
  return text
    .split('\n')
    .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripInline(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function countVisibleLength(value) {
  return Array.from(String(value || '').replace(/\s+/g, '')).reduce((total, char) => (
    total + (/[\u4e00-\u9fff]/.test(char) ? 2 : 1)
  ), 0);
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => safeCodePoint(parseInt(decimal, 10)));
}

function safeCodePoint(number) {
  try {
    return Number.isFinite(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  } catch {
    return '';
  }
}

module.exports = {
  extractUrls,
  assertPublicHttpUrl,
  classifySourceUrl,
  fetchSource,
  htmlToMarkdown,
};
