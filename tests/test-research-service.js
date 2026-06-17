const assert = require('assert/strict');

const {
  createResearchContext,
  normalizeSource,
} = require('../server/services/researchService');

async function run() {
  const now = '2026-06-12T11:00:00.000Z';
  const query = '今天 AI 视频热点';

  const disabled = await createResearchContext({ enabled: false, query, now });
  assert.deepEqual(disabled, {
    status: 'disabled',
    query: '',
    sources: [],
    summary: '',
    updated_at: now,
  });

  const missingProvider = await createResearchContext({
    enabled: true,
    query: `  ${query}  `,
    now,
  });
  assert.equal(missingProvider.status, 'failed');
  assert.equal(missingProvider.query, query);
  assert.deepEqual(missingProvider.sources, []);
  assert.match(missingProvider.summary, /联网研究服务未配置/);
  assert.equal(missingProvider.updated_at, now);

  let providerInput = null;
  const ready = await createResearchContext({
    enabled: true,
    query,
    now,
    provider: async input => {
      providerInput = input;
      return {
        summary: '热点摘要',
        sources: [
          {
            title: 'AI 视频工具更新',
            url: 'https://example.com/ai-video',
            published_at: '2026-06-12T08:00:00.000Z',
            summary: '新模型发布。',
            evidence: '官方发布说明',
            extra: 'ignored',
          },
          {
            title: '行业观察',
            url: 'https://example.com/trends',
            retrieved_at: '2026-06-12T10:30:00.000Z',
          },
        ],
      };
    },
  });
  assert.deepEqual(providerInput, { query });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.query, query);
  assert.equal(ready.summary, '热点摘要');
  assert.deepEqual(ready.sources, [
    {
      title: 'AI 视频工具更新',
      url: 'https://example.com/ai-video',
      published_at: '2026-06-12T08:00:00.000Z',
      retrieved_at: now,
      summary: '新模型发布。',
      evidence: '官方发布说明',
    },
    {
      title: '行业观察',
      url: 'https://example.com/trends',
      published_at: '',
      retrieved_at: '2026-06-12T10:30:00.000Z',
      summary: '',
      evidence: '',
    },
  ]);
  assert.equal(ready.updated_at, now);

  const emptyResult = await createResearchContext({
    enabled: true,
    query,
    now,
    provider: async () => ({ summary: '', sources: [] }),
  });
  assert.equal(emptyResult.status, 'failed');
  assert.equal(emptyResult.query, query);
  assert.deepEqual(emptyResult.sources, []);
  assert.match(emptyResult.summary, /没有返回可用资料/);
  assert.equal(emptyResult.updated_at, now);

  const failed = await createResearchContext({
    enabled: true,
    query,
    now,
    provider: async () => {
      throw new Error('网络超时');
    },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.query, query);
  assert.deepEqual(failed.sources, []);
  assert.match(failed.summary, /联网研究失败/);
  assert.match(failed.summary, /网络超时/);
  assert.equal(failed.updated_at, now);

  assert.deepEqual(normalizeSource({}), {
    title: '',
    url: '',
    published_at: '',
    retrieved_at: '',
    summary: '',
    evidence: '',
  });

  console.log('research service tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
