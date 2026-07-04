const assert = require('assert/strict');

const {
  defaultResearchProvider,
  defaultWebSearchProvider,
} = require('../server/services/creative/creativeWorkflows');

async function run() {
  const search = await defaultWebSearchProvider({
    query: 'OpenAI 新闻',
    limit: 2,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => `
        <html><body>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2Fnews%2F" class='result-link'>OpenAI News</a>
          <td class='result-snippet'>Official OpenAI news.</td>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2Fnews%2Fproduct%2Dreleases%2F" class='result-link'>OpenAI Product Releases</a>
          <td class='result-snippet'>Product updates from OpenAI.</td>
        </body></html>
      `,
    }),
  });
  assert.deepEqual(search.results, [
    {
      title: 'OpenAI News',
      url: 'https://openai.com/news/',
      summary: 'Official OpenAI news.',
    },
    {
      title: 'OpenAI Product Releases',
      url: 'https://openai.com/news/product-releases/',
      summary: 'Product updates from OpenAI.',
    },
  ]);

  const calls = [];
  let searchCalls = 0;
  const result = await defaultResearchProvider({
    query: 'OpenAI 最新产品新闻',
    aiModelConfig: {
      getRuntimeConfig: async () => ({ modelId: 'gpt-5.5' }),
    },
    aiTextModel: {
      callTextModel: async request => {
        calls.push(request);
        assert.equal(request.tools, undefined);
        assert.equal(request.tool_choice, undefined);
        assert.ok(request.messages.some(message => message.content.includes('https://openai.com/news/')));
        return {
          success: true,
          text: 'OpenAI 发布了最新产品动态，详见官方来源。',
          raw_response: { choices: [{ message: { content: 'OpenAI 发布了最新产品动态，详见官方来源。' } }] },
        };
      },
    },
    webSearchProvider: async ({ query, limit }) => {
      searchCalls += 1;
      assert.equal(query, 'OpenAI 最新产品新闻');
      assert.equal(limit, 5);
      return {
        results: [{
          title: 'OpenAI News',
          url: 'https://openai.com/news/',
          summary: 'OpenAI 官方新闻页面。',
        }],
      };
    },
  });

  assert.equal(result.summary, 'OpenAI 发布了最新产品动态，详见官方来源。');
  assert.deepEqual(result.sources, [{
    title: 'OpenAI News',
    url: 'https://openai.com/news/',
    summary: 'OpenAI 官方新闻页面。',
  }]);
  assert.equal(searchCalls, 1);
  assert.equal(calls.length, 1);

  const longResearchQuery = '疑似触发供应商风控的话题\n这里是很长的正文，不应该整段拿去搜索。';
  const fallbackCalls = [];
  const fallbackSearchQueries = [];
  const fallback = await defaultResearchProvider({
    query: longResearchQuery,
    aiTextModel: {
      callTextModel: async request => {
        fallbackCalls.push(request);
        assert.equal(request.tools, undefined);
        assert.equal(request.tool_choice, undefined);
        return { success: false, message: 'provider 调用失败：HTTP 400' };
      },
    },
    webSearchProvider: async ({ query }) => {
      fallbackSearchQueries.push(query);
      return {
        results: [{
          title: query === longResearchQuery ? '全文搜索结果' : '短主题搜索结果',
          url: query === longResearchQuery ? 'https://example.com/full' : 'https://example.com/short',
          summary: '供应商拒绝总结时仍应保留搜索来源。',
        }],
      };
    },
  });
  assert.deepEqual(fallbackSearchQueries, [longResearchQuery, '疑似触发供应商风控的话题']);
  assert.equal(fallbackCalls.length, 2);
  assert.match(fallbackCalls[0].messages[1].content, /这里是很长的正文/);
  assert.doesNotMatch(fallbackCalls[1].messages[1].content, /这里是很长的正文/);
  assert.match(fallback.summary, /短主题搜索结果/);
  assert.deepEqual(fallback.sources, [{
    title: '短主题搜索结果',
    url: 'https://example.com/short',
    summary: '供应商拒绝总结时仍应保留搜索来源。',
  }]);

  console.log('creative research provider tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
