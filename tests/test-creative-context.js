const assert = require('assert');

const {
  AWEME_ID_PATTERN,
  normalizeCreativeInput,
  extractAwemeId,
  createTextSourceContext,
  createDisabledResearchContext,
  createDisabledAssetContext,
  buildCreativeContext,
} = require('../server/services/creativeContext');

const TEXT_INPUT = '做一期关于本地 AI 视频工作流的科普';

function testNormalizesTextInput() {
  const result = normalizeCreativeInput({
    input: `  ${TEXT_INPUT}  `,
    useResearch: false,
  });

  assert.deepEqual(result, {
    success: true,
    data: {
      mode: 'text',
      raw_text: TEXT_INPUT,
      aweme_id: '',
      douyin_url: '',
      use_research: false,
      asset_ids: [],
    },
  });
}

function testUseResearchOnlyAcceptsBooleanTrue() {
  const stringTrue = normalizeCreativeInput({
    input: TEXT_INPUT,
    useResearch: 'true',
  });
  const numericTrue = normalizeCreativeInput({
    input: TEXT_INPUT,
    useResearch: 1,
  });
  const booleanTrue = normalizeCreativeInput({
    input: TEXT_INPUT,
    useResearch: true,
  });

  assert.equal(stringTrue.data.use_research, false);
  assert.equal(numericTrue.data.use_research, false);
  assert.equal(booleanTrue.data.use_research, true);
}

function testNormalizesDouyinVideoUrl() {
  const url = 'https://www.douyin.com/video/7345678901234567890';
  const result = normalizeCreativeInput({
    input: url,
    useResearch: true,
    assetIds: [],
  });

  assert.equal(result.success, true);
  assert.equal(result.data.mode, 'douyin');
  assert.equal(result.data.raw_text, '');
  assert.equal(result.data.aweme_id, '7345678901234567890');
  assert.equal(result.data.douyin_url, url);
  assert.equal(result.data.use_research, true);
  assert.deepEqual(result.data.asset_ids, []);
}

function testNormalizesDouyinId() {
  const result = normalizeCreativeInput({ input: '7345678901234567890' });

  assert.equal(result.success, true);
  assert.equal(result.data.mode, 'douyin');
  assert.equal(result.data.aweme_id, '7345678901234567890');
  assert.equal(result.data.douyin_url, '');
}

function testRejectsEmptyInput() {
  const result = normalizeCreativeInput({ input: '   ' });

  assert.equal(result.success, false);
  assert.match(result.message, /请输入视频方向、抖音 ID 或抖音链接/);
}

function testRejectsDouyinLinksWithoutVideoId() {
  const shortLink = normalizeCreativeInput({
    input: 'https://v.douyin.com/abcde/',
  });
  const douyinLinkWithoutId = normalizeCreativeInput({
    input: 'https://www.douyin.com/user/MS4wLjABAAAA',
  });
  const normalUrl = normalizeCreativeInput({
    input: 'https://example.com/no-id',
  });

  assert.equal(shortLink.success, false);
  assert.match(shortLink.message, /暂时无法从抖音链接中识别视频 ID/);
  assert.equal(douyinLinkWithoutId.success, false);
  assert.match(douyinLinkWithoutId.message, /暂时无法从抖音链接中识别视频 ID/);
  assert.equal(normalUrl.success, true);
  assert.equal(normalUrl.data.mode, 'text');
  assert.equal(normalUrl.data.raw_text, 'https://example.com/no-id');
}

function testRejectsAssetsForPhaseOne() {
  const result = normalizeCreativeInput({
    input: TEXT_INPUT,
    assetIds: ['asset-1'],
  });

  assert.equal(result.success, false);
  assert.match(result.message, /图片素材将在下一阶段开放/);
  assert.deepEqual(result.data.asset_ids, []);
}

function testExtractsAwemeIdFromSupportedInputs() {
  assert.equal(
    extractAwemeId('7345678901234567890'),
    '7345678901234567890'
  );
  assert.equal(
    extractAwemeId('https://www.douyin.com/video/7345678901234567890'),
    '7345678901234567890'
  );
  assert.equal(
    extractAwemeId('https://www.douyin.com/?modal_id=7345678901234567891'),
    '7345678901234567891'
  );
  assert.equal(
    extractAwemeId('https://www.douyin.com/share/video?aweme_id=7345678901234567892'),
    '7345678901234567892'
  );
}

function testBuildsStableCreativeContext() {
  const now = '2026-06-12T08:00:00.000Z';
  const input = normalizeCreativeInput({
    input: TEXT_INPUT,
    useResearch: false,
  }).data;
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
    input: {
      ...input,
      created_at: now,
    },
    source_context: {
      status: 'ready',
      kind: 'text',
      summary: TEXT_INPUT,
      transcript: TEXT_INPUT,
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

function testBuildsDefaultContextsWhenMissing() {
  const now = '2026-06-12T09:00:00.000Z';
  const input = normalizeCreativeInput({
    input: TEXT_INPUT,
    useResearch: false,
  }).data;

  const context = buildCreativeContext({ input, now });

  assert.equal(Object.prototype.hasOwnProperty.call(context, 'created_at'), false);
  assert.equal(context.input.created_at, now);
  assert.equal(context.source_context.status, 'ready');
  assert.equal(context.source_context.kind, 'text');
  assert.equal(context.source_context.summary, TEXT_INPUT);
  assert.equal(context.research_context.status, 'disabled');
  assert.equal(context.research_context.updated_at, now);
  assert.equal(context.asset_context.status, 'disabled');
  assert.deepEqual(context.asset_context.assets, []);
  assert.equal(context.asset_context.updated_at, now);
}

function testBuildsStableInputSchemaFromMissingOrPartialInput() {
  const now = '2026-06-12T10:00:00.000Z';
  const emptyContext = buildCreativeContext({ now });
  const partialContext = buildCreativeContext({
    input: {
      mode: 'text',
    },
    now,
  });

  assert.deepEqual(emptyContext.input, {
    mode: '',
    raw_text: '',
    aweme_id: '',
    douyin_url: '',
    use_research: false,
    asset_ids: [],
    created_at: now,
  });
  assert.deepEqual(partialContext.input, {
    mode: 'text',
    raw_text: '',
    aweme_id: '',
    douyin_url: '',
    use_research: false,
    asset_ids: [],
    created_at: now,
  });
}

function testBuildsPendingDouyinSourceContextWhenMissing() {
  const now = '2026-06-12T11:00:00.000Z';
  const url = 'https://www.douyin.com/video/7345678901234567890';
  const input = normalizeCreativeInput({
    input: url,
  }).data;

  const context = buildCreativeContext({ input, now });

  assert.deepEqual(context.source_context, {
    status: 'pending',
    kind: 'douyin',
    summary: '',
    transcript: '',
    comments_summary: '',
    douyin_metadata: {
      aweme_id: '7345678901234567890',
      douyin_url: url,
    },
    diagnostics: {},
  });
}

function run() {
  assert.equal(AWEME_ID_PATTERN.test('12345'), true);
  assert.equal(AWEME_ID_PATTERN.test('1234'), false);
  assert.equal(AWEME_ID_PATTERN.test('1'.repeat(33)), false);

  testNormalizesTextInput();
  testUseResearchOnlyAcceptsBooleanTrue();
  testNormalizesDouyinVideoUrl();
  testNormalizesDouyinId();
  testRejectsEmptyInput();
  testRejectsDouyinLinksWithoutVideoId();
  testRejectsAssetsForPhaseOne();
  testExtractsAwemeIdFromSupportedInputs();
  testBuildsStableCreativeContext();
  testBuildsDefaultContextsWhenMissing();
  testBuildsStableInputSchemaFromMissingOrPartialInput();
  testBuildsPendingDouyinSourceContextWhenMissing();
  console.log('creative context tests passed');
}

run();
