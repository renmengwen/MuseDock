const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sourceAssets = require('../server/services/source/sourceAssets');

function makeImageResponse(bytes = 'image') {
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

function publicLookup() {
  return [{ address: '93.184.216.34', family: 4 }];
}

async function testExtractMarkdownImagesResolvesAndDedupes() {
  const images = sourceAssets.extractMarkdownImages(
    '![图一](/a.png)\n\n![重复](https://example.com/a.png)\n\n![图二](https://cdn.example.com/b.webp)',
    'https://example.com/post',
  );
  assert.deepEqual(images, [
    { url: 'https://example.com/a.png', alt: '图一', source: 'article' },
    { url: 'https://cdn.example.com/b.webp', alt: '图二', source: 'article' },
  ]);
}

async function testExtractMarkdownImagesIncludesHtmlImgTags() {
  const images = sourceAssets.extractMarkdownImages(
    '<table><tr><td><img src=".github/assets/detail.png" alt="任务详情"></td><td><img src="/editor.png"></td></tr></table>',
    'https://example.com/readme',
  );
  assert.deepEqual(images, [
    { url: 'https://example.com/.github/assets/detail.png', alt: '任务详情', source: 'article' },
    { url: 'https://example.com/editor.png', alt: '', source: 'article' },
  ]);
}

async function testPrepareDownloadsArticleImageWithoutPexelsBackfill() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-assets-test-'));
  const requested = [];
  const result = await sourceAssets.prepareSourceAssets({
    sourceMaterial: {
      url: 'https://example.com/post',
      title: 'AI 开源项目',
      description: '介绍一个 React AI 开源项目',
      markdown: '# 标题\n\n![架构图](https://example.com/a.png)',
      metadata: { language: 'JavaScript', topics: ['ai', 'react'] },
    },
    assetDir: path.join(dir, 'assets'),
    now: '2026-06-27T00:00:00.000Z',
    maxArticleImages: 6,
    maxSearchImages: 1,
    deps: {
      pexelsApiKey: 'pexels-key',
      fetchImpl: async (url) => {
        requested.push(url);
        if (String(url).startsWith('https://api.pexels.com/')) {
          return new Response(JSON.stringify({
            photos: [{
              src: { large2x: 'https://images.pexels.com/photo.jpg' },
              alt: '代码屏幕',
              photographer: 'Tester',
              url: 'https://pexels.com/photo',
            }],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return makeImageResponse(`bytes:${url}`);
      },
      lookupHost: publicLookup,
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].source, 'article');
  assert.equal(result.assets[0].origin, 'source_extract');
  assert.equal(result.assets[0].origin_detail, 'article_embedded');
  assert.equal(result.assets[0].requirement, 'optional');
  assert.equal(result.assets[0].evidence_class, 'direct_source');
  assert.equal(result.assets[0].alt, '架构图');
  assert.ok(fs.existsSync(result.assets[0].local_path));
  assert.equal(result.search, null);
  assert.ok(!requested.some(url => String(url).startsWith('https://api.pexels.com/')));
}

async function testPrepareDownloadsPexelsWhenNoArticleImages() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-assets-pexels-success-test-'));
  const requested = [];
  const result = await sourceAssets.prepareSourceAssets({
    sourceMaterial: {
      title: 'AI 开源项目',
      description: '介绍一个 React AI 开源项目',
      markdown: '# 标题\n\n没有图片。',
      metadata: { language: 'JavaScript', topics: ['ai', 'react'] },
    },
    assetDir: path.join(dir, 'assets'),
    now: '2026-06-27T00:00:00.000Z',
    maxArticleImages: 6,
    maxSearchImages: 1,
    deps: {
      pexelsApiKey: 'pexels-key',
      fetchImpl: async (url) => {
        requested.push(url);
        if (String(url).startsWith('https://api.pexels.com/')) {
          return new Response(JSON.stringify({
            photos: [{
              src: { large2x: 'https://images.pexels.com/photo.jpg' },
              alt: '代码屏幕',
              photographer: 'Tester',
              url: 'https://pexels.com/photo',
            }],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return makeImageResponse(`bytes:${url}`);
      },
      lookupHost: publicLookup,
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].source, 'search');
  assert.equal(result.assets[0].origin, 'stock_search');
  assert.equal(result.assets[0].origin_detail, 'pexels');
  assert.equal(result.assets[0].provider, 'pexels');
  assert.equal(result.assets[0].requirement, 'optional');
  assert.equal(result.assets[0].evidence_class, 'contextual');
  assert.equal(result.assets[0].attribution.provider, 'Pexels');
  assert.ok(fs.existsSync(result.assets[0].local_path));
  assert.ok(requested.some(url => String(url).startsWith('https://api.pexels.com/')));
}

async function testMissingPexelsKeyDoesNotFail() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-assets-empty-test-'));
  const result = await sourceAssets.prepareSourceAssets({
    sourceMaterial: {
      title: '没有图片的文章',
      markdown: '只有正文，没有图片。',
    },
    assetDir: path.join(dir, 'assets'),
    now: '2026-06-27T00:00:00.000Z',
    deps: {
      pexelsApiKey: '',
      fetchImpl: async () => {
        throw new Error('不应该请求网络');
      },
    },
  });

  assert.equal(result.status, 'empty');
  assert.deepEqual(result.assets, []);
  assert.match(result.diagnostics[0].message, /PEXELS_API_KEY/);
}

async function testPexelsHttpFailureAddsDiagnostic() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-assets-pexels-fail-test-'));
  const result = await sourceAssets.prepareSourceAssets({
    sourceMaterial: {
      title: '没有图片的文章',
      markdown: '只有正文，没有图片。',
    },
    assetDir: path.join(dir, 'assets'),
    now: '2026-06-27T00:00:00.000Z',
    deps: {
      pexelsApiKey: 'bad-key',
      fetchImpl: async (url) => {
        assert.ok(String(url).startsWith('https://api.pexels.com/'));
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      },
    },
  });

  assert.equal(result.status, 'empty');
  assert.deepEqual(result.assets, []);
  assert.equal(result.diagnostics[0].code, 'pexels_auth_failed');
  assert.match(result.diagnostics[0].message, /Pexels API Key/);
}

async function testRejectsPrivateImageUrlBeforeFetch() {
  let called = false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-assets-private-test-'));
  const result = await sourceAssets.prepareSourceAssets({
    sourceMaterial: {
      title: '需要搜图',
      markdown: '没有文章图片。',
    },
    assetDir: path.join(dir, 'assets'),
    maxSearchImages: 1,
    deps: {
      searchImages: async () => ({
        success: true,
        images: [{ url: 'https://private.example/a.png', alt: '内网' }],
        queries: ['需要搜图'],
      }),
      fetchImpl: async () => {
        called = true;
        return makeImageResponse();
      },
      lookupHost: () => [{ address: '10.0.0.8', family: 4 }],
    },
  });

  assert.equal(called, false);
  assert.equal(result.status, 'empty');
  assert.match(result.diagnostics[0].message, /内网|本机/);
}

async function testRejectsPrivateRedirect() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-assets-redirect-test-'));
  const requested = [];
  const result = await sourceAssets.prepareSourceAssets({
    sourceMaterial: {
      markdown: '![跳转](https://example.com/redirect.png)',
    },
    assetDir: path.join(dir, 'assets'),
    maxSearchImages: 0,
    deps: {
      fetchImpl: async (url) => {
        requested.push(url);
        return new Response('', {
          status: 302,
          headers: { location: 'http://127.0.0.1/private.png' },
        });
      },
      lookupHost: publicLookup,
    },
  });

  assert.deepEqual(requested, ['https://example.com/redirect.png']);
  assert.equal(result.status, 'empty');
  assert.match(result.diagnostics[0].message, /内网|本机/);
}

async function testRejectsOversizedImageByHeader() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-assets-size-test-'));
  const result = await sourceAssets.prepareSourceAssets({
    sourceMaterial: {
      markdown: '![大图](https://example.com/large.png)',
    },
    assetDir: path.join(dir, 'assets'),
    maxSearchImages: 0,
    deps: {
      fetchImpl: async () => new Response(Buffer.from('tiny'), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(9 * 1024 * 1024),
        },
      }),
      lookupHost: publicLookup,
    },
  });

  assert.equal(result.status, 'empty');
  assert.match(result.diagnostics[0].message, /大小限制|超过/);
}

async function testKeepsAvifExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-assets-avif-test-'));
  const result = await sourceAssets.prepareSourceAssets({
    sourceMaterial: {
      markdown: '![avif](https://example.com/photo)',
    },
    assetDir: path.join(dir, 'assets'),
    maxSearchImages: 0,
    deps: {
      fetchImpl: async () => new Response(Buffer.from('avif'), {
        status: 200,
        headers: { 'content-type': 'image/avif' },
      }),
      lookupHost: publicLookup,
    },
  });

  assert.equal(result.status, 'ready');
  assert.match(result.assets[0].path, /\.avif$/);
}

async function testGithubRelativeImagesUseRawUrl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-assets-github-test-'));
  const requested = [];
  const result = await sourceAssets.prepareSourceAssets({
    sourceMaterial: {
      kind: 'github_repo',
      url: 'https://github.com/owner/repo',
      markdown: '![demo](docs/demo.png)',
      metadata: { owner: 'owner', repo: 'repo', default_branch: 'develop' },
    },
    assetDir: path.join(dir, 'assets'),
    maxSearchImages: 0,
    deps: {
      fetchImpl: async (url) => {
        requested.push(url);
        return makeImageResponse();
      },
      lookupHost: publicLookup,
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(requested[0], 'https://raw.githubusercontent.com/owner/repo/develop/docs/demo.png');
  assert.equal(result.assets[0].url, requested[0]);
  assert.equal(result.assets[0].origin_detail, 'github_readme');
  assert.equal(result.assets[0].provider, 'github');
}

async function testGithubRaw429FallsBackToApiRaw() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-assets-github-api-test-'));
  const requested = [];
  const result = await sourceAssets.prepareSourceAssets({
    sourceMaterial: {
      kind: 'github_repo',
      url: 'https://github.com/owner/repo',
      markdown: '![demo](.github/assets/demo.png)',
      metadata: { owner: 'owner', repo: 'repo', default_branch: 'main' },
    },
    assetDir: path.join(dir, 'assets'),
    maxSearchImages: 0,
    deps: {
      fetchImpl: async (url) => {
        requested.push(url);
        if (String(url).startsWith('https://raw.githubusercontent.com/')) {
          return new Response('', { status: 429 });
        }
        return makeImageResponse();
      },
      lookupHost: publicLookup,
    },
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(requested, [
    'https://raw.githubusercontent.com/owner/repo/main/.github/assets/demo.png',
    'https://api.github.com/repos/owner/repo/contents/.github/assets/demo.png?ref=main',
  ]);
}

async function testSearchFallbackWhenArticleImagesAllFail() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-assets-fallback-test-'));
  const result = await sourceAssets.prepareSourceAssets({
    sourceMaterial: {
      title: '补图文章',
      markdown: Array.from({ length: 6 }, (_, index) => `![坏图${index}](https://example.com/bad-${index}.png)`).join('\n'),
    },
    assetDir: path.join(dir, 'assets'),
    maxArticleImages: 6,
    maxSearchImages: 1,
    deps: {
      searchImages: async () => ({
        success: true,
        images: [{ url: 'https://images.example.com/fallback.png', alt: '补图' }],
        queries: ['补图文章'],
      }),
      fetchImpl: async (url) => {
        if (String(url).includes('/bad-')) {
          return new Response('', { status: 404 });
        }
        return makeImageResponse();
      },
      lookupHost: publicLookup,
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].source, 'search');
  assert.equal(result.search.success, true);
}

(async () => {
  await testExtractMarkdownImagesResolvesAndDedupes();
  await testExtractMarkdownImagesIncludesHtmlImgTags();
  await testPrepareDownloadsArticleImageWithoutPexelsBackfill();
  await testPrepareDownloadsPexelsWhenNoArticleImages();
  await testMissingPexelsKeyDoesNotFail();
  await testPexelsHttpFailureAddsDiagnostic();
  await testRejectsPrivateImageUrlBeforeFetch();
  await testRejectsPrivateRedirect();
  await testRejectsOversizedImageByHeader();
  await testKeepsAvifExtension();
  await testGithubRelativeImagesUseRawUrl();
  await testGithubRaw429FallsBackToApiRaw();
  await testSearchFallbackWhenArticleImagesAllFail();
  console.log('source assets tests passed');
})();
