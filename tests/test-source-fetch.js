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
    const urls = sourceFetch.extractUrls('请看（https://example.com/a）');
    assert.deepEqual(urls, ['https://example.com/a']);
  }

  {
    const urls = sourceFetch.extractUrls('（https://example.com/a）、《https://example.com/b》【https://example.com/c】');
    assert.deepEqual(urls, [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
  }

  {
    const urls = sourceFetch.extractUrls([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/a',
      'https://example.com/c',
      'https://example.com/d',
    ].join(' '));
    assert.deepEqual(urls, [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
  }

  {
    assert.throws(() => sourceFetch.assertPublicHttpUrl('not a url'), /URL 无效/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('ftp://example.com/a'), /只支持 http\(s\) URL/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://localhost:3000/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://0.0.0.0/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://test.localhost/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://service.internal/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://printer.local/a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://localhost./a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://x.localhost./a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://service.internal./a'), /不能读取本机或内网地址/);
    assert.throws(() => sourceFetch.assertPublicHttpUrl('http://printer.local./a'), /不能读取本机或内网地址/);
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
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/openai/codex/issues/1').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/openai/codex/tree/main').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/owner/repo/pulls').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/owner/repo/new/main').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/owner/repo/blob/main/file.js').kind, 'article');
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
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/issues/assigned').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/pulls/review-requested').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://github.com/new/import').kind, 'article');
    assert.equal(sourceFetch.classifySourceUrl('https://mp.weixin.qq.com/s/abc').kind, 'article');
  }

  {
    const html = [
      '<html><head><meta property="og:title" content="微信文章标题"></head><body>',
      '<div class="rich_media_content" id="js_content">',
      '<section><p>第一段正文说明这篇文章正在讨论如何把 HTML 和浏览器动画变成可复用的视频生产流程。</p>',
      '<p>第二段 <strong>重点</strong> 是把真实来源内容作为视频主题，而不是只拿链接做装饰。</p></section>',
      '<p>第三段继续补充来源摘要、素材准备、脚本生成和结果校验的完整上下文。</p>',
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
    const html = [
      '<html><head><title>短微信正文</title></head><body>',
      '<div id="js_content"><p>太短</p></div>',
      '<article><p>这是一段很长的页面其他区域内容，用于确认存在短微信正文时不会降级读取 article 区域。</p>',
      '<p>如果实现错误地跳过短的 js_content，这些正文会让读取结果误判为成功。</p></article>',
      '</body></html>',
    ].join('');
    const result = await sourceFetch.fetchSource('https://mp.weixin.qq.com/s/short', {
      fetchImpl: async () => makeResponse(html),
    });
    assert.equal(result.success, false);
    assert.match(result.message, /未能读取文章正文/);
  }

  {
    const html = '<html><head><title>普通文章</title></head><body><article><h1>标题</h1><p>正文内容足够长，用于验证 article 提取逻辑。文章解释了产品背景、关键能力、落地方式和风险边界，并继续补充来源摘要、素材准备、脚本生成和结果校验的完整上下文。</p><ul><li>要点 A</li></ul></article></body></html>';
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
    const html = `<html><head><title>四十字中文正文</title></head><body><article><p>${'中'.repeat(40)}</p></article></body></html>`;
    const result = await sourceFetch.fetchSource('https://example.com/forty-chinese-chars', {
      fetchImpl: async () => makeResponse(html),
    });
    assert.equal(result.success, false);
    assert.match(result.message, /未能读取文章正文/);
  }

  {
    const html = `<html><head><title>八十字中文正文</title></head><body><article><p>${'中'.repeat(80)}</p></article></body></html>`;
    const result = await sourceFetch.fetchSource('https://example.com/eighty-chinese-chars', {
      fetchImpl: async () => makeResponse(html),
    });
    assert.equal(result.success, true);
    assert.match(result.markdown, new RegExp('中{80}'));
  }

  {
    const imageUrl = `https://example.com/${'very-long-image-url-'.repeat(10)}.png`;
    const html = `<html><head><title>只有图片</title></head><body><article><p><img src="${imageUrl}" alt=""></p></article></body></html>`;
    const result = await sourceFetch.fetchSource('https://example.com/image-only', {
      fetchImpl: async () => makeResponse(html),
    });
    assert.equal(result.success, false);
    assert.match(result.message, /未能读取文章正文/);
  }

  {
    const html = [
      '<html><head><title>main fallback</title></head><body>',
      `<main><p>${'主'.repeat(80)}</p></main>`,
      '</body></html>',
    ].join('');
    const result = await sourceFetch.fetchSource('https://example.com/main-fallback', {
      fetchImpl: async () => makeResponse(html),
    });
    assert.equal(result.success, true);
    assert.match(result.markdown, new RegExp('主{80}'));
  }

  {
    const html = [
      '<html><head><title>body fallback</title></head><body>',
      `<p>${'体'.repeat(80)}</p>`,
      '</body></html>',
    ].join('');
    const result = await sourceFetch.fetchSource('https://example.com/body-fallback', {
      fetchImpl: async () => makeResponse(html),
    });
    assert.equal(result.success, true);
    assert.match(result.markdown, new RegExp('体{80}'));
  }

  {
    const html = [
      '<html><head><title>短 article 不降级</title></head><body>',
      '<article><p>太短</p></article>',
      `<section><p>${'身'.repeat(80)}</p></section>`,
      '</body></html>',
    ].join('');
    const result = await sourceFetch.fetchSource('https://example.com/short-article-no-fallback', {
      fetchImpl: async () => makeResponse(html),
    });
    assert.equal(result.success, false);
    assert.match(result.message, /未能读取文章正文/);
  }

  {
    const html = [
      '<html><head><title>短 main 不降级</title></head><body>',
      '<main><p>太短</p></main>',
      `<section><p>${'身'.repeat(80)}</p></section>`,
      '</body></html>',
    ].join('');
    const result = await sourceFetch.fetchSource('https://example.com/short-main-no-fallback', {
      fetchImpl: async () => makeResponse(html),
    });
    assert.equal(result.success, false);
    assert.match(result.message, /未能读取文章正文/);
  }

  {
    assert.equal(sourceFetch.htmlToMarkdown('<p><img alt="说明" src="/a.png"></p>'), '![说明](/a.png)');
    assert.equal(sourceFetch.htmlToMarkdown('<p><img src="/a.png" alt="说明"></p>'), '![说明](/a.png)');
    assert.match(sourceFetch.htmlToMarkdown('<p><a href="/target"><img alt="图" src="/image.png"></a></p>'), /!\[图\]\(\/image\.png\)/);
    assert.match(sourceFetch.htmlToMarkdown('<ul><li><a href="/a">链接</a></li></ul>'), /- \[链接\]\(\/a\)/);
    assert.match(sourceFetch.htmlToMarkdown('<h2><a href="/a">标题链接</a></h2>'), /## \[标题链接\]\(\/a\)/);
    assert.match(sourceFetch.htmlToMarkdown('<ul><li><img alt="图" src="/a.png"></li></ul>'), /- !\[图\]\(\/a\.png\)/);
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
    const result = await sourceFetch.fetchSource('https://example.com/network-error', {
      fetchImpl: async () => {
        throw new Error('network boom');
      },
    });
    assert.equal(result.success, false);
    assert.match(result.message, /读取外部来源失败/);
    assert.notEqual(result.message, 'network boom');
  }

  {
    const result = await sourceFetch.fetchSource('https://example.com/server-error', {
      fetchImpl: async () => makeResponse('server error', { status: 500 }),
    });
    assert.equal(result.success, false);
    assert.match(result.message, /读取外部来源失败/);
    assert.notEqual(result.message, 'HTTP 500');
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
    const readme = 'R'.repeat(10050);
    const contents = Array.from({ length: 45 }, (_item, index) => ({
      name: `item-${String(index + 1).padStart(2, '0')}`,
      type: index % 2 === 0 ? 'dir' : 'file',
    }));
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
          return makeResponse(readme);
        }
        if (url.endsWith('/repos/owner/repo/contents')) {
          return makeResponse(JSON.stringify(contents));
        }
        throw new Error(`unexpected url ${url}`);
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.kind, 'github_repo');
    assert.equal(result.title, 'owner/repo');
    assert.match(result.markdown, /Language: JavaScript/);
    assert.match(result.markdown, /Stars: 1,234/);
    assert.match(result.markdown, /- item-01\//);
    assert.match(result.markdown, /- item-40/);
    assert.doesNotMatch(result.markdown, /- item-41\//);
    assert.match(result.markdown, /## README/);
    assert.equal(result.truncated, true);
    assert.equal(result.markdown.split('## README\n\n')[1].length, 10000);
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

  {
    const result = await sourceFetch.fetchSource('https://github.com/owner/readme-fail', {
      fetchImpl: async (url) => {
        if (url.endsWith('/repos/owner/readme-fail')) {
          return makeResponse(JSON.stringify({ full_name: 'owner/readme-fail' }));
        }
        if (url.endsWith('/repos/owner/readme-fail/readme')) {
          return makeResponse('readme failed', { status: 500 });
        }
        if (url.endsWith('/repos/owner/readme-fail/contents')) {
          return makeResponse(JSON.stringify([]));
        }
        throw new Error(`unexpected url ${url}`);
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.kind, 'github_repo');
    assert.match(result.message, /读取 GitHub README 失败/);
  }

  {
    const result = await sourceFetch.fetchSource('https://github.com/owner/contents-fail', {
      fetchImpl: async (url) => {
        if (url.endsWith('/repos/owner/contents-fail')) {
          return makeResponse(JSON.stringify({ full_name: 'owner/contents-fail' }));
        }
        if (url.endsWith('/repos/owner/contents-fail/readme')) {
          return makeResponse('# README');
        }
        if (url.endsWith('/repos/owner/contents-fail/contents')) {
          return makeResponse('contents failed', { status: 500 });
        }
        throw new Error(`unexpected url ${url}`);
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.kind, 'github_repo');
    assert.match(result.message, /读取 GitHub 仓库目录失败/);
  }

  console.log('source fetch tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
