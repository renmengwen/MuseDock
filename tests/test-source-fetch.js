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
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://127.0.0.1/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://10.0.0.1/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://172.16.0.1/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://172.31.255.255/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://192.0.0.1/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://192.0.2.1/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://192.168.1.2/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://169.254.1.2/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://100.64.0.1/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://198.18.0.1/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://198.51.100.1/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://203.0.113.1/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://224.0.0.1/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://240.0.0.1/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://255.255.255.255/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://[::]/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://[::1]/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://[::127.0.0.1]/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://[::7f00:1]/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://[::ffff:127.0.0.1]/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://[::ffff:10.0.0.1]/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://[100::1]/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://[2001:db8::1]/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://[fc00::1]/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://[fd00::1]/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://[fe80::1]/a'), /不能读取本机或内网地址/);
    assert.equal(sourceFetch.assertPublicHttpUrl('https://example.com/a').hostname, 'example.com');
    assert.equal(sourceFetch.assertPublicHttpUrl('https://fca.example.com/a').hostname, 'fca.example.com');
    assert.equal(sourceFetch.assertPublicHttpUrl('https://fd00.example.com/a').hostname, 'fd00.example.com');
    assert.equal(sourceFetch.assertPublicHttpUrl('https://fe80.example.com/a').hostname, 'fe80.example.com');
  }

  {
    assert.deepEqual(sourceFetch.classifySourceUrl('https://github.com/openai/codex'), {
      kind: 'github_repo',
      owner: 'openai',
      repo: 'codex',
    });
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/search?q=codex').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/settings/profile').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/orgs/foo').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/notifications/beta').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/login/oauth').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/explore/topics').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/pricing/calculator').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/trending/javascript').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/apps/copilot').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/advisories/GHSA-abcd-1234').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/events/foo').kind, 'article');
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
    const html = [
      '<html><head><title>跳转后文章</title></head><body><article>',
      '<p>公开跳转后的正文内容足够长，用于验证手动处理公开到公开的重定向时仍然可以读取文章正文。</p>',
      '<p>这里继续补充视频生成、素材准备和来源摘要的上下文，保证正文长度满足提取逻辑。</p>',
      '</article></body></html>',
    ].join('');
    const result = await sourceFetch.fetchSource('https://example.com/redirect', {
      fetchImpl: async (url) => {
        if (url === 'https://example.com/redirect') {
          return makeResponse('', { status: 302, headers: { location: 'https://example.org/final' } });
        }
        if (url === 'https://example.org/final') {
          return makeResponse(html);
        }
        throw new Error(`unexpected url ${url}`);
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.kind, 'article');
    assert.equal(result.title, '跳转后文章');
    assert.match(result.markdown, /公开跳转后的正文内容/);
  }

  {
    const result = await sourceFetch.fetchSource('https://example.com/redirect-local', {
      fetchImpl: async () => makeResponse('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    });
    assert.equal(result.success, false);
    assert.match(result.message, /不能读取本机或内网地址/);
  }

  {
    const html = [
      '<html><head><meta content="反序标题" property="og:title"></head><body><article>',
      '<p>正文内容足够长，用于验证 og:title 的 content 属性出现在 property 属性之前时也能正确提取标题。</p>',
      '<p>继续补充一段可见文本，覆盖文章提取流程并避免正文过短导致读取失败。</p>',
      '</article></body></html>',
    ].join('');
    const result = await sourceFetch.fetchSource('https://example.com/reversed-og-title', {
      fetchImpl: async () => makeResponse(html),
    });
    assert.equal(result.success, true);
    assert.equal(result.title, '反序标题');
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
    assert.equal(result.kind, 'github_repo');
    assert.match(result.message, /仓库公开可访问/);
  }

  console.log('source fetch tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
