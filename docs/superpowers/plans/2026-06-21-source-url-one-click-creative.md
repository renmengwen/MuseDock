# Source URL One-Click Creative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-click creative support for public article URLs, WeChat official-account article URLs, and public GitHub repository URLs by turning fetched source material into the existing synthetic workspace consumed by the html-video generation pipeline.

**Architecture:** Introduce a focused `sourceFetch` service that validates public URLs, fetches article or GitHub repo source material, and returns Markdown. Extend creative input normalization with `mode: 'source_url'`, add a synthetic source workspace writer in `creativeWorkflows`, and keep the existing Agent, TTS, and html-video production path unchanged.

**Tech Stack:** Node.js CommonJS, Express service modules, filesystem JSON stores, React one-click creative page, existing `node tests/*.js` and `node tests/*.mjs` test style.

---

## References

- Spec: `docs/superpowers/specs/2026-06-21-source-url-one-click-creative-design.md`
- Reference implementation: `D:\code3\html-video\packages\cli\src\fetch-source.ts`
- Reference Studio interaction: `D:\code3\html-video\packages\project-studio\public\i18n.js`
- Current input normalization: `server/services/creativeContext.js`
- Current workflow source preparation: `server/services/creativeWorkflows.js`
- Current one-click creative page: `frontend-react/src/pages/OneClickCreativePage.jsx`

## File Map

- Create `server/services/sourceFetch.js`: URL extraction, SSRF guard, article fetch, WeChat `#js_content` extraction, GitHub repo fetch, HTML to Markdown conversion.
- Modify `server/services/creativeContext.js`: add `source_url` fields and `mode: 'source_url'` normalization.
- Modify `server/services/creativeWorkflows.js`: create source URL context, fetch external source in `source` stage, write synthetic source workspace.
- Modify `server/services/creative-video/creativeSpecAgent.js`: strengthen source material grounding in scene spec prompt.
- Modify `server/services/creative-video/html-video/contentGraphAgent.js`: include source transcript and grounding instructions.
- Modify `frontend-react/src/pages/OneClickCreativePage.jsx`: update label, placeholder, empty input message, and default status text.
- Modify `README.md`: document one-click source URL support and first-version boundaries.
- Tests:
  - Create `tests/test-source-fetch.js`
  - Extend `tests/test-creative-context.js`
  - Extend `tests/test-creative-workflows.js`
  - Extend `tests/test-html-video-content-graph.js` or create `tests/test-source-grounding-prompts.js`
  - Extend `tests/test-one-click-creative-page.mjs`

## Implementation Rules

- Work only on `dev`.
- Do not edit files before confirming `git branch --show-current` returns `dev`.
- Keep all user-visible text in Chinese.
- Do not add runtime dependencies for HTML parsing in the first version.
- Do not support private GitHub repos, GitHub tokens, repo clone, full source analysis, login-required pages, or article image downloads.
- If external source fetching fails, fail the workflow `source` stage. Do not silently fallback to treating the URL as plain text.

---

### Task 1: Source Fetch Service

**Files:**
- Create: `server/services/sourceFetch.js`
- Create: `tests/test-source-fetch.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test-source-fetch.js`:

```js
const assert = require('assert/strict');

const sourceFetch = require('../server/services/sourceFetch');

function makeResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

(async () => {
  {
    const urls = sourceFetch.extractUrls('请分析 https://mp.weixin.qq.com/s/abc ，再看 https://github.com/a/b。');
    assert.deepEqual(urls, ['https://mp.weixin.qq.com/s/abc', 'https://github.com/a/b']);
  }

  {
    assert.throws(() => sourceFetch.assertPublicHttpUrl('ftp://example.com/a'), /只支持 http\(s\) URL/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://localhost:3000/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://192.168.1.2/a'), /不能读取本机或内网地址/);
    assert.equal(sourceFetch.assertPublicHttpUrl('https://example.com/a').hostname, 'example.com');
  }

  {
    assert.deepEqual(sourceFetch.classifySourceUrl('https://github.com/openai/codex'), {
      kind: 'github_repo',
      owner: 'openai',
      repo: 'codex',
    });
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/search?q=codex').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://mp.weixin.qq.com/s/abc').kind, 'article');
  }

  {
    const html = [
      '<html><head><meta property="og:title" content="微信文章标题"></head><body>',
      '<div class="rich_media_content" id="js_content">',
      '<section><p>第一段正文说明这篇文章正在讨论如何把 HTML 和浏览器动画变成可复用的视频生产流程。</p>',
      '<p>第二段 <strong>重点</strong> 是把真实来源内容作为视频主题，而不是只拿链接做装饰。</p></section>',
      '</div></body></html>',
    ].join('');
    const result = await sourceFetch.fetchSource('https://mp.weixin.qq.com/s/demo', {
      fetchImpl: async () => makeResponse(html),
      now: () => '2026-06-21T00:00:00.000Z',
    });
    assert.equal(result.success, true);
    assert.equal(result.kind, 'article');
    assert.equal(result.title, '微信文章标题');
    assert.match(result.markdown, /^# 微信文章标题/);
    assert.match(result.markdown, /第一段正文/);
    assert.match(result.markdown, /第二段 重点/);
  }

  {
    const html = '<html><head><title>普通文章</title></head><body><article><h1>标题</h1><p>正文内容足够长，用于验证 article 提取逻辑。文章解释了产品背景、关键能力、落地方式和风险边界。</p><ul><li>要点 A</li></ul></article></body></html>';
    const result = await sourceFetch.fetchSource('https://example.com/post', {
      fetchImpl: async () => makeResponse(html),
    });
    assert.equal(result.success, true);
    assert.equal(result.kind, 'article');
    assert.match(result.markdown, /# 普通文章/);
    assert.match(result.markdown, /正文内容足够长/);
    assert.match(result.markdown, /- 要点 A/);
  }

  {
    const calls = [];
    const result = await sourceFetch.fetchSource('https://github.com/owner/repo', {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/repos/owner/repo')) {
          return makeResponse(JSON.stringify({
            full_name: 'owner/repo',
            description: 'HTML video 工具',
            language: 'JavaScript',
            stargazers_count: 1234,
            topics: ['video', 'html'],
            license: { spdx_id: 'MIT' },
            homepage: 'https://example.com',
          }));
        }
        if (url.endsWith('/repos/owner/repo/readme')) {
          return makeResponse('# README\n\n项目说明。');
        }
        if (url.endsWith('/repos/owner/repo/contents')) {
          return makeResponse(JSON.stringify([
            { name: 'packages', type: 'dir' },
            { name: 'README.md', type: 'file' },
          ]));
        }
        throw new Error(`unexpected url ${url}`);
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.kind, 'github_repo');
    assert.equal(result.title, 'owner/repo');
    assert.match(result.markdown, /Language: JavaScript/);
    assert.match(result.markdown, /Stars: 1,234/);
    assert.match(result.markdown, /- packages\//);
    assert.match(result.markdown, /## README/);
    assert.equal(calls.length, 3);
  }

  {
    const result = await sourceFetch.fetchSource('https://github.com/owner/missing', {
      fetchImpl: async () => makeResponse('not found', { status: 404 }),
    });
    assert.equal(result.success, false);
    assert.match(result.message, /仓库公开可访问/);
  }

  console.log('source fetch tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-source-fetch.js
```

Expected: FAIL with `Cannot find module '../server/services/sourceFetch'`.

- [ ] **Step 3: Implement `sourceFetch`**

Create `server/services/sourceFetch.js`:

```js
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

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host === '0.0.0.0'
    || host === '::1'
    || host.endsWith('.localhost')
    || host.endsWith('.internal')
    || host.endsWith('.local')
  ) {
    throw new Error(`出于安全原因，不能读取本机或内网地址：${host}`);
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    const [a, b] = parts;
    const invalid = parts.some(part => !Number.isInteger(part) || part < 0 || part > 255);
    if (invalid) {
      throw new Error(`URL 主机无效：${host}`);
    }
    if (
      a === 127
      || a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
      || a === 0
    ) {
      throw new Error(`出于安全原因，不能读取本机或内网地址：${host}`);
    }
  }

  return parsed;
}

function classifySourceUrl(rawUrl) {
  const parsed = assertPublicHttpUrl(rawUrl);
  if (parsed.hostname.toLowerCase() !== 'github.com') {
    return { kind: 'article' };
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  const reserved = new Set(['search', 'marketplace', 'topics', 'collections', 'sponsors', 'about', 'features']);
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
  try {
    const parsed = assertPublicHttpUrl(rawUrl);
    const classification = classifySourceUrl(parsed.href);
    if (classification.kind === 'github_repo') {
      return await fetchGithubRepo(classification.owner, classification.repo, parsed.href, options);
    }
    return await fetchArticle(parsed.href, options);
  } catch (error) {
    return {
      success: false,
      kind: 'article',
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
  if (body.replace(/\s+/g, '').length < 80) {
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
  assertPublicHttpUrl(url);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前运行环境不支持 fetch，无法读取外部来源。');
  }
  const signal = options.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetchImpl(url, {
    headers: { 'user-agent': UA, ...headers },
    redirect: 'follow',
    signal,
  });
  if (!response || !response.ok) {
    throw new Error(`HTTP ${response ? response.status : 'NO_RESPONSE'}`);
  }
  return response.text();
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
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (og && og[1]) return decodeEntities(og[1]).replace(/\s+/g, ' ').trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title && title[1] ? decodeEntities(title[1]).replace(/\s+/g, ' ').trim() : '';
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
```

- [ ] **Step 4: Run service test**

Run:

```powershell
node tests/test-source-fetch.js
```

Expected: PASS with `source fetch tests passed`.

- [ ] **Step 5: Commit**

Run:

```powershell
git add server/services/sourceFetch.js tests/test-source-fetch.js
git commit -m "新增外部来源抓取服务"
```

Expected: commit succeeds.

---

### Task 2: Creative Input Normalization

**Files:**
- Modify: `server/services/creativeContext.js`
- Modify: `tests/test-creative-context.js`

- [ ] **Step 1: Extend failing tests**

Append these assertions near the existing URL normalization cases in `tests/test-creative-context.js`:

```js
{
  const article = normalizeCreativeInput({
    input: '请做成观点解读视频 https://mp.weixin.qq.com/s/demo',
    useResearch: true,
  });
  assert.equal(article.success, true);
  assert.equal(article.data.mode, 'source_url');
  assert.equal(article.data.source_url, 'https://mp.weixin.qq.com/s/demo');
  assert.equal(article.data.source_hint, '请做成观点解读视频');
  assert.equal(article.data.raw_text, '请做成观点解读视频 https://mp.weixin.qq.com/s/demo');
  assert.equal(article.data.use_research, true);
}

{
  const repo = normalizeCreativeInput({
    input: 'https://github.com/owner/repo',
  });
  assert.equal(repo.success, true);
  assert.equal(repo.data.mode, 'source_url');
  assert.equal(repo.data.source_url, 'https://github.com/owner/repo');
  assert.equal(repo.data.source_hint, '');
}

{
  const multiple = normalizeCreativeInput({
    input: '先看 https://example.com/a 再看 https://example.com/b',
  });
  assert.equal(multiple.success, true);
  assert.equal(multiple.data.mode, 'source_url');
  assert.equal(multiple.data.source_url, 'https://example.com/a');
  assert.equal(multiple.data.ignored_url_count, 1);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-creative-context.js
```

Expected: FAIL because `mode` is still `text` for non-Douyin URLs.

- [ ] **Step 3: Modify `creativeContext.js`**

At the top of `server/services/creativeContext.js`, import `sourceFetch`:

```js
const sourceFetch = require('./sourceFetch');
```

Extend `createNormalizedData()` with fields:

```js
source_url: '',
source_hint: '',
ignored_url_count: 0,
```

Add helper:

```js
function removeUrlFromText(text, url) {
  const source = safeString(text);
  const target = safeString(url);
  if (!source || !target) return source;
  return source.replace(target, ' ').replace(/\s+/g, ' ').trim();
}
```

In `normalizeCreativeInput()`, after the existing Douyin link failure branch and before returning `mode: 'text'`, add:

```js
  const sourceUrls = sourceFetch.extractUrls(input, 3);
  if (sourceUrls.length > 0) {
    const sourceUrl = sourceUrls[0];
    return createSuccessResponse({
      mode: 'source_url',
      raw_text: input,
      source_url: sourceUrl,
      source_hint: removeUrlFromText(input, sourceUrl),
      ignored_url_count: Math.max(0, sourceUrls.length - 1),
      use_research: useResearch,
      skip_validation: skipValidation,
      asset_ids: assetIds,
    });
  }
```

Export `removeUrlFromText` only if tests need it. Prefer not exporting it.

- [ ] **Step 4: Run normalization tests**

Run:

```powershell
node tests/test-creative-context.js
```

Expected: PASS.

- [ ] **Step 5: Run source fetch tests again**

Run:

```powershell
node tests/test-source-fetch.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add server/services/creativeContext.js tests/test-creative-context.js
git commit -m "识别一键创作外部来源链接"
```

Expected: commit succeeds.

---

### Task 3: Synthetic Source Workspace

**Files:**
- Modify: `server/services/creativeWorkflows.js`
- Modify: `tests/test-creative-workflows.js`

- [ ] **Step 1: Add failing workflow test**

In `tests/test-creative-workflows.js`, add a test near existing text workflow/source tests. Use the test file's existing temp root helpers if available. If no helper fits, add this self-contained block:

```js
{
  const os = require('os');
  const path = require('path');
  const fsp = require('fs/promises');
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'creative-source-url-root-'));
  const mediaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'creative-source-url-media-'));
  const workflows = require('../server/services/creativeWorkflows');

  const created = await workflows.createCreativeWorkflow({
    input: '做成项目解读视频 https://github.com/owner/repo',
    useResearch: false,
  }, {
    rootDir,
    services: {
      now: () => '2026-06-21T00:00:00.000Z',
      idFactory: () => '202606211200000001',
    },
  });

  assert.equal(created.success, true);
  assert.equal(created.creative_context.input.mode, 'source_url');

  const runResult = await workflows.runCreativeWorkflow(created.workflow_id, {
    rootDir,
    mediaRoot,
    services: {
      now: () => '2026-06-21T00:00:00.000Z',
      sourceFetch: {
        fetchSource: async url => ({
          success: true,
          kind: 'github_repo',
          url,
          title: 'owner/repo',
          markdown: '# owner/repo\n\nSource: https://github.com/owner/repo\n\n## README\n\n真实 README 内容。',
          truncated: false,
          metadata: { owner: 'owner', repo: 'repo', language: 'JavaScript' },
        }),
      },
      researchService: {
        createResearchContext: async () => ({ status: 'disabled', sources: [], summary: '', updated_at: '2026-06-21T00:00:00.000Z' }),
      },
      agentRuns: {
        createDouyinHyperframesFreeformRun: async awemeId => ({
          success: true,
          aweme_id: awemeId,
          run_id: 'hyperframes_freeform_001',
          message: '已新建高级成片记录，可以开始生成导演策划。',
        }),
        generateDouyinRunHyperframesFreeformBrief: async () => ({ success: true, message: '成片策划完成。' }),
        synthesizeDouyinRunHyperframesFreeformAudio: async () => ({ success: true, message: '音频轨已生成。' }),
        generateDouyinRunHyperframesFreeformProject: async () => ({
          success: true,
          message: 'html-video 成片完成。',
          hyperframes_freeform: {
            project: { render_mode: 'html-video', html_video_project_path: path.join(mediaRoot, 'project') },
            render: { status: 'rendered' },
          },
        }),
      },
      aiModelConfig: {
        getSkipValidation: async () => true,
      },
    },
  });

  assert.equal(runResult.success, true);
  const analysisPath = path.join(mediaRoot, created.aweme_id, 'analysis_input.json');
  const transcriptPath = path.join(mediaRoot, created.aweme_id, 'transcript.json');
  const metadataPath = path.join(mediaRoot, created.aweme_id, 'metadata.json');
  const analysisInput = JSON.parse(await fsp.readFile(analysisPath, 'utf8'));
  const transcript = JSON.parse(await fsp.readFile(transcriptPath, 'utf8'));
  const metadata = JSON.parse(await fsp.readFile(metadataPath, 'utf8'));

  assert.equal(metadata.source_type, 'source_url');
  assert.equal(metadata.source_kind, 'github_repo');
  assert.equal(metadata.source_url, 'https://github.com/owner/repo');
  assert.match(transcript.text, /真实 README 内容/);
  assert.equal(transcript.user_hint, '做成项目解读视频');
  assert.equal(analysisInput.source_material.kind, 'github_repo');
  assert.match(analysisInput.source_material.markdown, /owner\/repo/);
  assert.equal(analysisInput.creative_context.source_context.kind, 'source_url');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-creative-workflows.js
```

Expected: FAIL because `prepareSource()` does not handle `source_url`.

- [ ] **Step 3: Import `sourceFetch` and resolve service**

In `server/services/creativeWorkflows.js`, add:

```js
const defaultSourceFetch = require('./sourceFetch');
```

In `resolveServices(options = {})`, include:

```js
sourceFetch: services.sourceFetch || defaultSourceFetch,
```

- [ ] **Step 4: Add source context helpers**

Add these helpers near `writeSyntheticTextWorkspace()`:

```js
function summarizeMarkdown(markdown, maxLength = 500) {
  const text = safeString(markdown)
    .replace(/^# .+$/m, ' ')
    .replace(/^Source:\s*\S+$/m, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

function buildSourceDescription(input = {}, fetched = {}) {
  const hint = safeString(input.source_hint);
  const summary = summarizeMarkdown(fetched.markdown, 320);
  return [hint, summary].filter(Boolean).join('\n\n');
}

function createFetchedSourceContext(input = {}, fetched = {}, now = '') {
  const summary = safeString(fetched.title) || summarizeMarkdown(fetched.markdown, 120) || safeString(input.source_url);
  return {
    status: 'ready',
    kind: 'source_url',
    summary,
    transcript: safeString(fetched.markdown),
    comments_summary: '',
    source_metadata: {
      kind: safeString(fetched.kind),
      url: safeString(fetched.url || input.source_url),
      title: safeString(fetched.title),
      truncated: fetched.truncated === true,
      ...(fetched.metadata && typeof fetched.metadata === 'object' ? fetched.metadata : {}),
    },
    diagnostics: {
      source_type: 'source_url',
      source_kind: safeString(fetched.kind),
      fetched_at: now,
      ignored_url_count: Number(input.ignored_url_count) || 0,
    },
  };
}
```

- [ ] **Step 5: Add `writeSyntheticSourceWorkspace()`**

Add this function after `writeSyntheticTextWorkspace()`:

```js
async function writeSyntheticSourceWorkspace(record, mediaRoot, fetched, now) {
  const paths = mediaPipeline.getMediaPaths(record.aweme_id, mediaRoot);
  const input = record.creative_context?.input || record.input || {};
  const sourceContext = createFetchedSourceContext(input, fetched, now);
  const description = buildSourceDescription(input, fetched);

  record.source_context = sourceContext;
  record.creative_context = {
    ...(record.creative_context || {}),
    source_context: sourceContext,
  };

  await fsp.mkdir(paths.framesDir, { recursive: true });
  await writeJson(paths.metadata, {
    aweme_id: record.aweme_id,
    source_type: 'source_url',
    source_kind: safeString(fetched.kind),
    source_url: safeString(fetched.url || input.source_url),
    title: sourceContext.summary.slice(0, 120),
    description,
    creative_workflow_id: record.workflow_id,
    created_at: record.created_at,
    updated_at: now,
  });

  await writeJson(paths.transcript, {
    success: true,
    status: 'done',
    source_type: 'source_url',
    source_kind: safeString(fetched.kind),
    source_url: safeString(fetched.url || input.source_url),
    title: sourceContext.summary,
    text: safeString(fetched.markdown),
    user_hint: safeString(input.source_hint),
    truncated: fetched.truncated === true,
    updated_at: now,
  });

  await writeJson(paths.analysisInput, {
    aweme_id: record.aweme_id,
    video: {
      title: sourceContext.summary,
      description,
      author: {},
      statistics: {},
      aweme_url: '',
    },
    source_material: {
      kind: safeString(fetched.kind),
      url: safeString(fetched.url || input.source_url),
      title: sourceContext.summary,
      markdown: safeString(fetched.markdown),
      user_hint: safeString(input.source_hint),
      truncated: fetched.truncated === true,
      metadata: fetched.metadata || {},
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
      message: '外部来源暂无评论素材。',
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
    message: '外部来源资料已读取并准备完成。',
    source_context: sourceContext,
    paths,
  };
}
```

- [ ] **Step 6: Add `prepareSourceUrl()`**

Add this helper before `prepareSource()`:

```js
async function prepareSourceUrl(record, mediaRoot, now, services = {}) {
  const input = record.creative_context?.input || record.input || {};
  const sourceUrl = safeString(input.source_url);
  if (!sourceUrl) {
    return {
      success: false,
      message: '外部来源链接为空，请重新输入文章或 GitHub 仓库链接。',
    };
  }

  const fetched = await services.sourceFetch.fetchSource(sourceUrl);
  if (!fetched || fetched.success === false) {
    return {
      success: false,
      message: safeString(fetched?.message) || '读取外部来源失败，请确认链接可公开访问。',
      diagnostic: fetched?.diagnostic || null,
    };
  }

  return writeSyntheticSourceWorkspace(record, mediaRoot, fetched, now);
}
```

- [ ] **Step 7: Update `prepareSource()`**

Replace the current function with:

```js
async function prepareSource(record, mediaRoot, now, services = {}) {
  const mode = record.creative_context?.input?.mode;
  if (mode === 'text') {
    return writeSyntheticTextWorkspace(record, mediaRoot, now);
  }
  if (mode === 'source_url') {
    return prepareSourceUrl(record, mediaRoot, now, services);
  }
  return prepareDouyinSource(record, mediaRoot, now, services);
}
```

- [ ] **Step 8: Run workflow tests**

Run:

```powershell
node tests/test-creative-workflows.js
```

Expected: PASS.

- [ ] **Step 9: Run related tests**

Run:

```powershell
node tests/test-creative-context.js
node tests/test-source-fetch.js
node tests/test-agent-runs.js
```

Expected: all PASS.

- [ ] **Step 10: Commit**

Run:

```powershell
git add server/services/creativeWorkflows.js tests/test-creative-workflows.js
git commit -m "接入一键创作外部来源工作区"
```

Expected: commit succeeds.

---

### Task 4: Source Material Grounding Prompts

**Files:**
- Modify: `server/services/creative-video/creativeSpecAgent.js`
- Modify: `server/services/creative-video/html-video/contentGraphAgent.js`
- Create: `tests/test-source-grounding-prompts.js`

- [ ] **Step 1: Write failing prompt test**

Create `tests/test-source-grounding-prompts.js`:

```js
const assert = require('assert/strict');

const creativeSpecAgent = require('../server/services/creative-video/creativeSpecAgent');
const contentGraphAgent = require('../server/services/creative-video/html-video/contentGraphAgent');

const creativeContext = {
  input: {
    mode: 'source_url',
    raw_text: '做成项目解读视频 https://github.com/owner/repo',
    source_url: 'https://github.com/owner/repo',
    source_hint: '做成项目解读视频',
  },
  source_context: {
    kind: 'source_url',
    summary: 'owner/repo',
    transcript: '# owner/repo\n\nSource: https://github.com/owner/repo\n\n## README\n\n这个项目把 HTML 变成视频。',
    source_metadata: {
      kind: 'github_repo',
      url: 'https://github.com/owner/repo',
      title: 'owner/repo',
    },
  },
};

const scenePrompt = creativeSpecAgent.buildSceneSpecPrompt({
  creativeContext,
  target: { duration_sec: 30 },
});

assert.match(scenePrompt, /来源材料是视频主题/);
assert.match(scenePrompt, /不要编造来源材料没有/);
assert.match(scenePrompt, /GitHub repo 视频/);
assert.match(scenePrompt, /owner\/repo/);

const graphPrompt = contentGraphAgent.buildContentGraphPrompt({
  sceneSpec: {
    title: 'owner/repo',
    scenes: [{ id: 'scene_01', narration_text: '这个项目把 HTML 变成视频。' }],
  },
  creativeContext,
  target: { duration_sec: 30 },
});

assert.match(graphPrompt, /SOURCE MATERIAL/);
assert.match(graphPrompt, /每个节点/);
assert.match(graphPrompt, /真实 README 内容|这个项目把 HTML 变成视频/);

console.log('source grounding prompt tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-source-grounding-prompts.js
```

Expected: FAIL because grounding text is not present.

- [ ] **Step 3: Update scene spec prompt**

In `server/services/creative-video/creativeSpecAgent.js`, inside `buildSceneSpecPrompt()`, add these lines before `输出格式必须是：{"scene_spec":{...}}。`:

```js
    '如果 creativeContext.input.mode 是 source_url，来源材料是视频主题，不是装饰素材。',
    'source_context.transcript 是文章、网页或 GitHub repo 的真实来源材料；必须基于其中的具体事实、名字、数字、项目术语和主张生成场景。',
    '不要输出可套用到任何文章或任何仓库的泛泛句子。',
    '不要编造来源材料没有的精确数字、机构、版本、结论或功能。',
    'GitHub repo 视频只能基于 README、仓库描述、语言、目录结构和 topics，不要假装读过全量源码。',
```

- [ ] **Step 4: Update content graph context summary**

In `server/services/creative-video/html-video/contentGraphAgent.js`, update `summarizeCreativeContextForPrompt()` pairs to include source transcript:

```js
    ['来源全文', sourceContext.transcript || sourceContext.markdown || sourceContext.content],
```

Use max length 2400 for `来源全文`. Replace the existing `pairs.forEach` body with:

```js
  pairs.forEach(([label, value]) => {
    const maxLength = label.includes('全文') ? 2400 : label.includes('正文') ? 1600 : 700;
    const text = compactText(value, maxLength);
    if (text) lines.push(`${label}：${text}`);
  });
```

- [ ] **Step 5: Update content graph prompt instructions**

In `buildContentGraphPrompt()`, add these requirement lines after `- 必须保留源素材事实，不要编造来源中没有的精确数字、机构、时间或结论。`:

```js
    '- 如果源素材来自 source_url，SOURCE MATERIAL 是视频真正主题，不是装饰信息。',
    '- 每个节点都必须引用或改写来源材料里的具体事实、名字、数字、产品、项目能力、术语或主张。',
    '- 禁止输出可套用到任何文章或任何仓库的泛泛句子。',
    '- GitHub repo 只能基于 README、仓库描述、语言、目录结构和 topics，不要假装读过全量源码。',
```

Also change the prompt label from:

```js
    '源素材上下文：',
```

to:

```js
    'SOURCE MATERIAL / 源素材上下文：',
```

- [ ] **Step 6: Run prompt tests**

Run:

```powershell
node tests/test-source-grounding-prompts.js
```

Expected: PASS.

- [ ] **Step 7: Run existing html-video content graph test**

Run:

```powershell
node tests/test-html-video-content-graph.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add server/services/creative-video/creativeSpecAgent.js server/services/creative-video/html-video/contentGraphAgent.js tests/test-source-grounding-prompts.js
git commit -m "强化外部来源成片事实约束"
```

Expected: commit succeeds.

---

### Task 5: Frontend Copy and Loading Semantics

**Files:**
- Modify: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Modify: `tests/test-one-click-creative-page.mjs`

- [ ] **Step 1: Inspect the current static UI test shape**

Run:

```powershell
Get-Content -Encoding UTF8 tests\test-one-click-creative-page.mjs | Select-Object -First 120
```

Expected:

- The test defines a `zh` object with `inputLabel`, `emptyInputMessage`, and `creativeInputPlaceholder`.
- The test loops through those strings and checks `page.includes(text)`.
- Do not add duplicate top-level imports.

- [ ] **Step 2: Replace the three `zh` constants**

In `tests/test-one-click-creative-page.mjs`, replace these existing properties in the `zh` object:

```js
  inputLabel: textFromCodePoints([0x8f93, 0x5165, 0x89c6, 0x9891, 0x65b9, 0x5411, 0x3001, 0x6296, 0x97f3, 0x20, 0x49, 0x44, 0x20, 0x6216, 0x6296, 0x97f3, 0x94fe, 0x63a5]),
  emptyInputMessage: textFromCodePoints([0x8bf7, 0x8f93, 0x5165, 0x89c6, 0x9891, 0x65b9, 0x5411, 0x3001, 0x6296, 0x97f3, 0x20, 0x49, 0x44, 0x20, 0x6216, 0x6296, 0x97f3, 0x94fe, 0x63a5]),
  creativeInputPlaceholder: textFromCodePoints([0x5728, 0x8fd9, 0x91cc, 0x8f93, 0x5165, 0x4f60, 0x7684, 0x521b, 0x610f]),
```

with direct UTF-8 strings:

```js
  inputLabel: '输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接',
  emptyInputMessage: '请输入视频方向、抖音链接、文章链接或 GitHub 仓库链接',
  creativeInputPlaceholder: '粘贴文章/GitHub 链接，或输入你想生成的视频方向',
```

Rationale: this test file already uses UTF-8 reads, so direct Chinese strings are acceptable here and make future copy changes easier.

- [ ] **Step 3: Add explicit positive and negative copy assertions**

After the existing loop that checks `page.includes(text)`, add:

```js
assert.match(page, /输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接/);
assert.match(page, /粘贴文章\/GitHub 链接，或输入你想生成的视频方向/);
assert.match(page, /请输入视频方向、抖音链接、文章链接或 GitHub 仓库链接/);
assert.match(page, /填写方向、抖音来源或外部资料链接后，即可创建视频生成任务。/);

assert.doesNotMatch(page, /输入视频方向、抖音 ID 或抖音链接/);
assert.doesNotMatch(page, /在这里输入你的创意/);
assert.doesNotMatch(page, /请输入视频方向、抖音 ID 或抖音链接/);
assert.doesNotMatch(page, /填写方向或抖音来源后，即可创建视频生成任务。/);
```

- [ ] **Step 4: Run test to verify it fails**

Run:

```powershell
node tests/test-one-click-creative-page.mjs
```

Expected: FAIL. Acceptable failure examples:

- `OneClickCreativePage.jsx should include normal Chinese text: 输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接`
- `Expected regular expression not to match input`

If it passes before implementation, inspect the test because it may not be reading the intended `OneClickCreativePage.jsx`.

- [ ] **Step 5: Update form label and placeholder**

In `frontend-react/src/pages/OneClickCreativePage.jsx`, find `function CreativePromptComposer`. Replace only the label text and textarea placeholder. The final block must be:

```jsx
      <label className="creativePromptLabel" htmlFor="creative-input">
        输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接
      </label>
      <textarea
        id="creative-input"
        value={input}
        onChange={event => setInput(event.target.value)}
        disabled={isBusy}
        placeholder="粘贴文章/GitHub 链接，或输入你想生成的视频方向"
        rows={4}
      />
```

- [ ] **Step 6: Update empty input message**

In `submitCreativeWorkflow()`, change:

```js
setMessage('请输入视频方向、抖音 ID 或抖音链接');
```

to:

```js
setMessage('请输入视频方向、抖音链接、文章链接或 GitHub 仓库链接');
```

- [ ] **Step 7: Update default status message**

In `WorkflowStatusPanel`, change the fallback message. The final JSX expression must be:

```js
{message || '填写方向、抖音来源或外部资料链接后，即可创建视频生成任务。'}
```

- [ ] **Step 8: Search for stale copy in the page**

Run:

```powershell
Select-String -Path frontend-react\src\pages\OneClickCreativePage.jsx -Pattern "抖音 ID 或抖音链接|在这里输入你的创意|填写方向或抖音来源"
```

Expected: no output.

If there is output, update the stale string only if it is user-visible one-click creative copy. Do not change unrelated comments or historical task data.

- [ ] **Step 9: Run UI test**

Run:

```powershell
node tests/test-one-click-creative-page.mjs
```

Expected: PASS.

- [ ] **Step 10: Run API client stream test**

Run:

```powershell
node tests/test-creative-task-api-client.mjs
```

Expected: PASS. This confirms the existing SSE client path remains intact.

- [ ] **Step 11: Commit**

Run:

```powershell
git add frontend-react/src/pages/OneClickCreativePage.jsx tests/test-one-click-creative-page.mjs
git commit -m "更新一键创作外部来源入口文案"
```

Expected: commit succeeds.

---

### Task 6: Source Stage Progress Messages

**Files:**
- Modify: `server/services/creativeWorkflows.js`
- Modify: `tests/test-creative-workflows.js`

- [ ] **Step 1: Inspect existing workflow test helpers**

Run:

```powershell
Select-String -Path tests\test-creative-workflows.js -Pattern "function createFakeServices|function createTempDirs|taskContext|runCreativeWorkflow" | ForEach-Object { "$($_.LineNumber):$($_.Line.Trim())" }
```

Expected:

- `createTempDirs()` exists.
- `createFakeServices()` exists and accepts `overrides.services`.
- Some existing tests already pass `taskContext.emit`.

Do not add `const os = require('os')`, `const path = require('path')`, or `const workflows = require(...)` inside the new test. Those are already available at file scope.

- [ ] **Step 2: Add failing progress test function**

In `tests/test-creative-workflows.js`, add this function near the other `async function test...` blocks, preferably after the source URL workspace test added in Task 3:

```js
async function testSourceUrlStageEmitsSpecificProgressMessages() {
  const { rootDir, mediaRoot } = createTempDirs();
  const emitted = [];
  const { services } = createFakeServices({
    services: {
      now: () => '2026-06-21T00:00:00.000Z',
      idFactory: () => '202606211200000002',
      sourceFetch: {
        fetchSource: async url => ({
          success: true,
          kind: 'article',
          url,
          title: '微信文章标题',
          markdown: [
            '# 微信文章标题',
            '',
            'Source: https://mp.weixin.qq.com/s/demo',
            '',
            '这是一篇真实文章正文，包含足够多的信息用于生成视频。',
            '文章讨论了 HTML 视频生产、外部来源读取和真实材料 grounding。',
          ].join('\n'),
          truncated: false,
          metadata: {},
        }),
      },
    },
    agentRuns: {
      generateDouyinRunHyperframesFreeformProject: async () => ({
        success: true,
        status: 'done',
        message: 'html-video 成片完成。',
        hyperframes_freeform: {
          project: {
            render_mode: 'html-video',
            html_video_project_path: path.join(mediaRoot, 'project'),
          },
          render: { status: 'rendered' },
        },
      }),
    },
  });

  const created = await createCreativeWorkflow({
    input: 'https://mp.weixin.qq.com/s/demo',
    useResearch: false,
  }, {
    rootDir,
    services: {
      now: () => '2026-06-21T00:00:00.000Z',
      idFactory: () => '202606211200000002',
    },
  });

  const run = await runCreativeWorkflow(created.workflow_id, {
    rootDir,
    mediaRoot,
    taskContext: {
      emit: async event => emitted.push(event),
    },
    services,
  });

  assert.equal(run.success, true);
  assert.ok(
    emitted.some(event => event.type === 'stage_progress' && event.stage === 'source' && /正在读取微信公众号文章/.test(event.message)),
    'source stage should emit WeChat article loading message',
  );
  assert.ok(
    emitted.some(event => event.type === 'stage_progress' && event.stage === 'source' && /外部来源资料已读取/.test(event.message)),
    'source stage should emit external source done message',
  );
  assert.ok(
    emitted.some(event => event.type === 'stage_done' && event.stage === 'source' && /外部来源资料已读取并准备完成/.test(event.message)),
    'source stage should finish with external source done message',
  );
}
```

- [ ] **Step 3: Register the new test in the test runner**

At the bottom of `tests/test-creative-workflows.js`, find the sequence that awaits each test function. Add:

```js
  await testSourceUrlStageEmitsSpecificProgressMessages();
```

Place it near related source preparation tests, before the final `console.log(...)`.

- [ ] **Step 4: Run test to verify it fails**

Run:

```powershell
node tests/test-creative-workflows.js
```

Expected: FAIL because source URL preparation does not emit specific loading messages.

- [ ] **Step 5: Add loading message helper**

In `server/services/creativeWorkflows.js`, add this helper near other small helper functions, before `prepareSourceUrl()`:

```js
function getSourceUrlLoadingMessage(sourceUrl, kindHint = '') {
  const url = safeString(sourceUrl).toLowerCase();
  if (url.includes('mp.weixin.qq.com')) return '正在读取微信公众号文章...';
  if (kindHint === 'github_repo' || url.includes('github.com/')) return '正在读取 GitHub 仓库信息...';
  return '正在读取网页文章...';
}
```

- [ ] **Step 6: Allow source URL preparation to report progress**

Change `prepareSourceUrl()` signature:

```js
async function prepareSourceUrl(record, mediaRoot, now, services = {}, reportStage = null) {
```

Inside `prepareSourceUrl()`, after validating `sourceUrl` and before `services.sourceFetch.fetchSource(sourceUrl)`, add:

```js
  if (typeof reportStage === 'function') {
    await reportStage(getSourceUrlLoadingMessage(sourceUrl), 15, {
      source_url: sourceUrl,
    });
  }
```

After successful fetch and before `writeSyntheticSourceWorkspace(...)`, add:

```js
  if (typeof reportStage === 'function') {
    await reportStage('外部来源资料已读取，正在准备创作上下文...', 70, {
      source_url: sourceUrl,
      source_kind: fetched.kind,
      title: fetched.title || '',
    });
  }
```

- [ ] **Step 7: Allow generic `prepareSource()` to receive progress reporter**

Change `prepareSource()` signature:

```js
async function prepareSource(record, mediaRoot, now, services = {}, reportStage = null) {
```

In the `mode === 'source_url'` branch, call:

```js
return prepareSourceUrl(record, mediaRoot, now, services, reportStage);
```

- [ ] **Step 8: Pass `reportStage` from source stage**

In `runCreativeWorkflow()`, find the `runStage(record, 'source', ...)` call. Change the source stage handler from:

```js
async () => (
  ensureSuccess(await prepareSource(record, mediaRoot, getNow(services), services), '来源资料准备失败。')
)
```

to:

```js
async ({ reportStage }) => (
  ensureSuccess(await prepareSource(record, mediaRoot, getNow(services), services, reportStage), '来源资料准备失败。')
)
```

- [ ] **Step 9: Check source stage message flow manually in the file**

Run:

```powershell
Select-String -Path server\services\creativeWorkflows.js -Pattern "getSourceUrlLoadingMessage|prepareSourceUrl\\(|prepareSource\\(|runStage\\(record, 'source'"
```

Expected:

- `getSourceUrlLoadingMessage` exists.
- `prepareSourceUrl` has a `reportStage = null` parameter.
- `prepareSource` has a `reportStage = null` parameter.
- The source stage `runStage` handler destructures `{ reportStage }`.

- [ ] **Step 10: Run workflow tests**

Run:

```powershell
node tests/test-creative-workflows.js
```

Expected: PASS.

- [ ] **Step 11: Run source fetch and context tests to catch integration regressions**

Run:

```powershell
node tests/test-source-fetch.js
node tests/test-creative-context.js
```

Expected: both PASS.

- [ ] **Step 12: Commit**

Run:

```powershell
git add server/services/creativeWorkflows.js tests/test-creative-workflows.js
git commit -m "展示外部来源读取进度"
```

Expected: commit succeeds.

---

### Task 7: README Updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Inspect current README wording**

Run:

```powershell
Select-String -Path README.md -Pattern "当前主入口|一键创作任务|打开 `/creative`|小红书关键词|data/media/douyin|补齐小红书" | ForEach-Object { "$($_.LineNumber):$($_.Line.Trim())" }
```

Expected:

- README says the current main entry accepts “一句话、抖音 ID 或抖音链接”.
- README has a feature bullet for one-click creative.
- README separately says 小红书 supports keyword search / note detail / history.
- README later says 小红书评论、素材准备和 AI 成片工作流 still need completion.

Do not delete the 小红书 crawl description. The goal is to avoid implying 小红书 is connected to one-click creative.

- [ ] **Step 2: Update one-click overview**

In `README.md`, update the one-click creative description so it says the homepage accepts:

```text
一句话、抖音 ID、抖音链接、公开文章链接或公开 GitHub 仓库链接
```

Do not say it supports private repos, full source analysis, or login-required pages.

- [ ] **Step 3: Update the feature bullet for one-click creative**

Find the bullet that starts with:

```markdown
- **一键创作任务**：从一句创作方向、抖音 ID 或抖音链接开始
```

Replace the source list so the bullet says:

```markdown
- **一键创作任务**：从一句创作方向、抖音 ID、抖音链接、公开文章链接或公开 GitHub 仓库链接开始，自动串联来源准备、联网研究、素材分析、导演改写、成片策划、音频生成、工程生成、校验、渲染和巡检。
```

- [ ] **Step 4: Add source URL capability bullet**

In the feature list, add a bullet:

```markdown
- **外部来源成片**：一键创作可读取公开微信公众号/网页文章和公开 GitHub 仓库 README，把真实来源内容转为本地创作上下文后生成视频。
```

Place this bullet immediately after `一键创作任务` or before `任务路由化` so it is clearly part of one-click creative.

- [ ] **Step 5: Update one-click usage step**

Find the usage step that currently says:

```markdown
1. 打开 `/creative`，输入视频方向、抖音 ID 或抖音链接。
```

Change it to:

```markdown
1. 打开 `/creative`，输入视频方向、抖音 ID、抖音链接、公开文章链接或公开 GitHub 仓库链接。
```

- [ ] **Step 6: Add boundary note**

Near the one-click creative section, add:

```markdown
外部 URL 首版只读取公开内容：文章页面会提取正文，GitHub 仓库会读取公开 metadata、README 和顶层目录。不支持私有仓库、登录态页面、GitHub Token、clone 仓库或全量源码分析。
```

Place this note after the numbered one-click usage steps and before the stage table. This keeps the boundary visible before users read the generated stages.

- [ ] **Step 7: Update data directory description**

Where README describes `data/media/douyin/<aweme_id>/`, add:

```markdown
纯文本和外部 URL 一键创作会复用同一 synthetic media workspace；目录名仍沿用 `douyin` 结构，但 `metadata.json` 中会标记 `source_type`。
```

Place it immediately after the `data/media/douyin/<aweme_id>/` bullet, not in the API section.

- [ ] **Step 8: Add or update API wording only if needed**

If the README API section describes `POST /api/creative-workflows` only as “创建一键创作任务”, it can remain unchanged.

If it has a sentence explaining accepted inputs, update that sentence to:

```text
请求体 `input` 支持创作方向、抖音 ID、抖音链接、公开文章链接或公开 GitHub 仓库链接。
```

Do not add new public REST endpoints for source URL fetching in README. Source fetching is an internal workflow stage.

- [ ] **Step 9: Review README for misleading wording**

Run:

```powershell
Select-String -Path README.md -Pattern "小红书|GitHub|文章|一键创作|抖音 ID" | ForEach-Object { "$($_.LineNumber):$($_.Line.Trim())" }
```

Expected:

- 一键创作 lines mention public article/GitHub repo support.
- 小红书 lines still only describe crawl/search/history, not one-click creative.
- The existing “补齐小红书评论、素材准备和 AI 成片工作流” line remains or is equivalent.
- The README clearly says private repos, login pages, Token, clone, and full source analysis are not supported.

- [ ] **Step 10: Run markdown grep checks for stale one-click source wording**

Run:

```powershell
Select-String -Path README.md -Pattern "一句话、抖音 ID 或抖音链接|视频方向、抖音 ID 或抖音链接|从一句创作方向、抖音 ID 或抖音链接"
```

Expected: no output.

If there is output, update it unless the sentence is explicitly describing historical behavior.

- [ ] **Step 11: Commit**

Run:

```powershell
git add README.md
git commit -m "更新一键创作外部来源说明"
```

Expected: commit succeeds.

---

### Task 8: Verification Pass

**Files:**
- No source changes unless tests expose regressions.

- [ ] **Step 1: Confirm branch and working tree before verification**

Run:

```powershell
git branch --show-current
git status --short
```

Expected:

- Branch is `dev`.
- `git status --short` is empty, or only contains intentional changes from a failed earlier verification fix.

If the branch is not `dev`, stop. If there are unrelated changes, do not touch them.

- [ ] **Step 2: Run source URL unit tests**

Run:

```powershell
node tests/test-source-fetch.js
node tests/test-creative-context.js
```

Expected: both PASS.

If `test-source-fetch.js` fails:

- URL extraction / SSRF failure means fix `server/services/sourceFetch.js`.
- Article body length failure means compare the fixture text with the 80-character readable body threshold.
- GitHub API mock failure means inspect URL strings used by `fetchGithubRepo()`.

If `test-creative-context.js` fails:

- Check that Douyin ID and Douyin URL still win before generic source URL detection.
- Check that `source_hint` removes only the first URL and preserves surrounding user text.

- [ ] **Step 3: Run workflow integration tests**

Run:

```powershell
node tests/test-creative-workflows.js
```

Expected: PASS.

If it fails in source URL workflow:

- Check `resolveServices()` includes `sourceFetch`.
- Check `prepareSource()` routes `mode === 'source_url'` to `prepareSourceUrl()`.
- Check `writeSyntheticSourceWorkspace()` writes `metadata.json`, `transcript.json`, and `analysis_input.json`.
- Check the source stage passes `reportStage` into `prepareSource()`.

- [ ] **Step 4: Run prompt grounding tests**

Run:

```powershell
node tests/test-source-grounding-prompts.js
node tests/test-html-video-content-graph.js
```

Expected: both PASS.

If grounding tests fail:

- Check `creativeSpecAgent.buildSceneSpecPrompt()` contains source URL grounding instructions.
- Check `contentGraphAgent.buildContentGraphPrompt()` labels the source section as `SOURCE MATERIAL / 源素材上下文`.
- Check `summarizeCreativeContextForPrompt()` includes `sourceContext.transcript`.

- [ ] **Step 5: Run focused frontend/static tests**

Run:

```powershell
node tests/test-one-click-creative-page.mjs
node tests/test-creative-api-client.mjs
node tests/test-creative-task-api-client.mjs
```

Expected: all PASS.

If `test-one-click-creative-page.mjs` fails:

- Check `zh.inputLabel`, `zh.emptyInputMessage`, and `zh.creativeInputPlaceholder` in the test.
- Check `CreativePromptComposer` label and placeholder.
- Check `submitCreativeWorkflow()` empty input message.
- Check `WorkflowStatusPanel` fallback message.

- [ ] **Step 6: Run existing one-click recommended tests**

Run:

```powershell
node tests/test-creative-workflows.js
node tests/test-creative-workflow-routes.js
node tests/test-one-click-creative-page.mjs
node tests/test-creative-task-registry.js
node tests/test-creative-workflow-tasks.js
```

Expected: all PASS.

If route or task tests fail, do not change source URL logic first. These tests usually fail because async task response shape or SSE behavior regressed. Inspect the failure message before editing.

- [ ] **Step 7: Run html-video production focused tests**

Run:

```powershell
node tests/test-html-video-content-graph.js
node tests/test-html-video-template-registry.js
node tests/test-html-video-materializer.js
node tests/test-html-video-playwright-adapter-command.js
node tests/test-html-video-vertical-mvp-smoke.js
```

Expected: all PASS.

If `test-html-video-vertical-mvp-smoke.js` fails due to missing browser/ffmpeg environment, record the environment error in the final report. Do not mask it by weakening the test.

- [ ] **Step 8: Run README consistency checks**

Run:

```powershell
Select-String -Path README.md -Pattern "一句话、抖音 ID 或抖音链接|视频方向、抖音 ID 或抖音链接|从一句创作方向、抖音 ID 或抖音链接"
Select-String -Path README.md -Pattern "私有仓库|登录态|GitHub Token|clone 仓库|全量源码"
Select-String -Path README.md -Pattern "小红书.*一键创作|一键创作.*小红书"
```

Expected:

- First command: no output.
- Second command: at least one boundary note line.
- Third command: no output unless the line explicitly says 小红书成片工作流 still needs completion.

- [ ] **Step 9: Check generated source URL files with a mocked workflow test artifact**

After `node tests/test-creative-workflows.js`, inspect the test output only if the test leaves a temp path in failure output. If the test passed, no manual filesystem inspection is required.

If a failure leaves a temp root path, inspect:

```powershell
Get-ChildItem -Recurse -Filter analysis_input.json <TEMP_ROOT_FROM_FAILURE> | Select-Object -ExpandProperty FullName
Get-Content -Encoding UTF8 <FOUND_ANALYSIS_INPUT_JSON>
```

Expected for source URL tasks:

- `source_material.kind` is `article` or `github_repo`.
- `source_material.markdown` contains fetched Markdown, not only a URL.
- `creative_context.source_context.kind` is `source_url`.

- [ ] **Step 10: Optional real network manual check**

Only run this if network access is allowed and real external URLs are acceptable in the development environment.

Start the app using the repo's normal dev command. If unsure, inspect `package.json` scripts first:

```powershell
Get-Content -Encoding UTF8 package.json
```

Then create one task with:

```text
https://github.com/nexu-io/html-video
```

Expected:

- `source` stage says it is reading GitHub repo info.
- `data/media/douyin/<synthetic_id>/transcript.json` contains README text, not only the URL.
- The task proceeds past `source`.

Then create one task with a public article URL.

Expected:

- `source` stage says it is reading article content.
- `transcript.json` contains article Markdown.
- If the article blocks scraping, workflow fails at `source` with a clear Chinese message.

- [ ] **Step 11: Produce final implementation summary**

In the final worker response, include:

```markdown
## 完成内容
- Task 1: ...
- Task 2: ...

## 提交
- <sha> 新增外部来源抓取服务
- ...

## 验证
- `node tests/test-source-fetch.js` PASS
- ...

## 未完成或风险
- 如无，写“无”。
```

Do not claim optional real network checks were run unless they were actually run.

- [ ] **Step 12: Check git status**

Run:

```powershell
git status --short
```

Expected: empty output after all task commits.

---

## Self-Review Checklist

- Spec coverage:
  - Public article URLs are covered by Tasks 1, 2, 3, 6, 8.
  - WeChat `#js_content` extraction is covered by Task 1.
  - Public GitHub repo metadata/README/top-level directory is covered by Task 1.
  - Existing workflow reuse is covered by Task 3.
  - Prompt grounding is covered by Task 4.
  - Frontend one-input-box path is covered by Task 5.
  - README boundaries are covered by Task 7.
  - Verification is covered by Task 8.
- Scope remains first-version only:
  - No private repo support.
  - No GitHub Token.
  - No repo clone.
  - No full source analysis.
  - No login-required article support.
- Type consistency:
  - `mode: 'source_url'`
  - `source_url`
  - `source_hint`
  - `ignored_url_count`
  - `source_kind`
  - `source_material`
- Required failure behavior:
  - Source fetch failure fails `source` stage.
  - Failure does not fallback to text URL.
