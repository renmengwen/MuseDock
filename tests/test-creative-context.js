const assert = require('assert');

const {
  AWEME_ID_PATTERN,
  normalizeCreativeInput,
  createTextSourceContext,
  createDisabledResearchContext,
  createDisabledAssetContext,
  buildCreativeContext,
} = require('../server/services/creativeContext');

function testNormalizesTextInput() {
  const result = normalizeCreativeInput({
    input: '  做一期关于本地 AI 视频工作流的科普  ',
    useResearch: false,
  });

  assert.equal(result.success, true);
  assert.equal(result.mode, 'text');
  assert.equal(result.raw_text, '做一期关于本地 AI 视频工作流的科普');
  assert.equal(result.aweme_id, '');
  assert.equal(result.douyin_url, '');
  assert.equal(result.use_research, false);
  assert.deepEqual(result.asset_ids, []);
}

function testNormalizesDouyinVideoUrl() {
  const url = 'https://www.douyin.com/video/7345678901234567890';
  const result = normalizeCreativeInput({
    input: url,
    useResearch: true,
    assetIds: [],
  });

  assert.equal(result.success, true);
  assert.equal(result.mode, 'douyin');
  assert.equal(result.raw_text, '');
  assert.equal(result.aweme_id, '7345678901234567890');
  assert.equal(result.douyin_url, url);
  assert.equal(result.use_research, true);
  assert.deepEqual(result.asset_ids, []);
}

function testNormalizesDouyinId() {
  const result = normalizeCreativeInput({ input: '7345678901234567890' });

  assert.equal(result.success, true);
  assert.equal(result.mode, 'douyin');
  assert.equal(result.aweme_id, '7345678901234567890');
  assert.equal(result.douyin_url, '');
}

function testRejectsEmptyInput() {
  const result = normalizeCreativeInput({ input: '   ' });

  assert.equal(result.success, false);
  assert.match(result.message, /请输入视频方向、抖音 ID 或抖音链接/);
}

function testRejectsAssetsForPhaseOne() {
  const result = normalizeCreativeInput({
    input: '做一期关于本地 AI 视频工作流的科普',
    assetIds: ['asset-1'],
  });

  assert.equal(result.success, false);
  assert.match(result.message, /图片素材将在下一阶段开放/);
}

function testBuildsStableCreativeContext() {
  const now = '2026-06-12T08:00:00.000Z';
  const input = normalizeCreativeInput({
    input: '做一期关于本地 AI 视频工作流的科普',
    useResearch: false,
  });
  const sourceContext = createTextSourceContext(input.raw_text);
  const researchContext = createDisabledResearchContext({ now });
  const assetContext = createDisabledAssetContext({ now });

  const context = buildCreativeContext({
    input,
    sourceContext,
    researchContext,
    assetContext,
    now,
  });

  assert.deepEqual(context, {
    created_at: now,
    input,
    source_context: {
      status: 'ready',
      kind: 'text',
      summary: '做一期关于本地 AI 视频工作流的科普',
      transcript: '做一期关于本地 AI 视频工作流的科普',
      comments_summary: '',
      douyin_metadata: {},
      diagnostics: {
        source_type: 'creative_text',
      },
    },
    research_context: {
      status: 'disabled',
      query: '',
      sources: [],
      summary: '',
      updated_at: now,
    },
    asset_context: {
      status: 'disabled',
      assets: [],
      updated_at: now,
    },
  });
  assert.match(context.source_context.summary, /本地 AI 视频工作流/);
  assert.equal(context.research_context.status, 'disabled');
  assert.equal(context.asset_context.status, 'disabled');
  assert.deepEqual(context.asset_context.assets, []);
}

function run() {
  assert.equal(AWEME_ID_PATTERN.test('12345'), true);
  assert.equal(AWEME_ID_PATTERN.test('1234'), false);
  assert.equal(AWEME_ID_PATTERN.test('1'.repeat(33)), false);

  testNormalizesTextInput();
  testNormalizesDouyinVideoUrl();
  testNormalizesDouyinId();
  testRejectsEmptyInput();
  testRejectsAssetsForPhaseOne();
  testBuildsStableCreativeContext();
  console.log('creative context tests passed');
}

run();
