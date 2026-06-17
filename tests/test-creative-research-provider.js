const assert = require('assert/strict');

const {
  defaultResearchProvider,
  defaultWebSearchProvider,
} = require('../server/services/creativeWorkflows');

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
  const result = await defaultResearchProvider({
    query: 'OpenAI 最新产品新闻',
    aiModelConfig: {
      getRuntimeConfig: async () => ({ modelId: 'gpt-5.5' }),
    },
    aiTextModel: {
      callTextModel: async request => {
        calls.push(request);
        if (calls.length === 1) {
          return {
            success: true,
            text: '',
            raw_response: {
              choices: [{
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [{
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'web_search',
                      arguments: JSON.stringify({ query: 'OpenAI latest product news' }),
                    },
                  }],
                },
              }],
            },
          };
        }
        assert.equal(request.tools, undefined);
        assert.equal(request.tool_choice, undefined);
        assert.ok(request.messages.some(message => message.role === 'tool' && message.tool_call_id === 'call_1'));
        return {
          success: true,
          text: 'OpenAI 发布了最新产品动态，详见官方来源。',
          raw_response: { choices: [{ message: { content: 'OpenAI 发布了最新产品动态，详见官方来源。' } }] },
        };
      },
    },
    webSearchProvider: async ({ query, limit }) => {
      assert.equal(query, 'OpenAI latest product news');
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
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tool_choice.function.name, 'web_search');

  console.log('creative research provider tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
