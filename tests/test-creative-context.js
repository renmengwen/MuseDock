const assert = require('assert');
const sourceFetch = require('../server/services/source/sourceFetch');

const {
  AWEME_ID_PATTERN,
  normalizeCreativeInput,
  extractAwemeId,
  createTextSourceContext,
  createDisabledResearchContext,
  createDisabledAssetContext,
  buildCreativeContext,
} = require('../server/services/creative/creativeContext');

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
      source_url: '',
      source_hint: '',
      ignored_url_count: 0,
      use_research: false,
      skip_validation: false,
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

function testNormalizesNoProtocolDouyinVideoUrl() {
  const noProtocolDouyin = normalizeCreativeInput({
    input: 'www.douyin.com/video/7345678901234567890',
  });
  const mixedNoProtocolDouyin = normalizeCreativeInput({
    input: '请分析 www.douyin.com/video/7345678901234567890 做成短视频',
  });

  assert.equal(noProtocolDouyin.success, true);
  assert.equal(noProtocolDouyin.data.mode, 'douyin');
  assert.equal(noProtocolDouyin.data.aweme_id, '7345678901234567890');
  assert.equal(mixedNoProtocolDouyin.success, true);
  assert.equal(mixedNoProtocolDouyin.data.mode, 'douyin');
  assert.equal(mixedNoProtocolDouyin.data.aweme_id, '7345678901234567890');
}

function testDoesNotTreatExternalNoProtocolVideoPathAsDouyin() {
  const externalNoProtocol = normalizeCreativeInput({
    input: 'www.example.com/video/7345678901234567890',
  });
  const textWithVideoPath = normalizeCreativeInput({
    input: '文本 /video/7345678901234567890',
  });

  assert.equal(externalNoProtocol.success, true);
  assert.equal(externalNoProtocol.data.mode, 'text');
  assert.equal(externalNoProtocol.data.aweme_id, '');
  assert.equal(textWithVideoPath.success, true);
  assert.equal(textWithVideoPath.data.mode, 'text');
  assert.equal(textWithVideoPath.data.aweme_id, '');
}

function testNormalizesDouyinId() {
  const result = normalizeCreativeInput({ input: '7345678901234567890' });

  assert.equal(result.success, true);
  assert.equal(result.data.mode, 'douyin');
  assert.equal(result.data.aweme_id, '7345678901234567890');
  assert.equal(result.data.douyin_url, '');
}

function testNormalizesBareDouyinQueryFragments() {
  for (const input of [
    'modal_id=7345678901234567890',
    '?modal_id=7345678901234567890',
    'aweme_id=7345678901234567890',
  ]) {
    const result = normalizeCreativeInput({ input });

    assert.equal(result.success, true);
    assert.equal(result.data.mode, 'douyin');
    assert.equal(result.data.aweme_id, '7345678901234567890');
  }
}

function testRejectsEmptyInput() {
  const result = normalizeCreativeInput({
    input: '   ',
    useResearch: true,
    skipValidation: true,
  });

  assert.equal(result.success, false);
  assert.match(result.message, /请输入视频方向、抖音 ID 或抖音链接/);
  assert.equal(result.data.use_research, true);
  assert.equal(result.data.skip_validation, true);
}

function testRejectsDouyinLinksWithoutVideoId() {
  const shortLink = normalizeCreativeInput({
    input: 'https://v.douyin.com/abcde/',
  });
  const badDouyin = normalizeCreativeInput({
    input: '请分析 https://v.douyin.com/abcde/ 做成短视频',
  });
  const douyinLinkWithoutId = normalizeCreativeInput({
    input: 'https://www.douyin.com/user/MS4wLjABAAAA',
  });
  const badNoProtocolDouyin = normalizeCreativeInput({
    input: 'v.douyin.com/abcde/',
  });
  const mixedBadNoProtocolDouyin = normalizeCreativeInput({
    input: '请分析 v.douyin.com/abcde/ 做成短视频',
  });
  const noProtocolUser = normalizeCreativeInput({
    input: 'www.douyin.com/user/MS4wLjABAAAA',
  });
  const badDouyinWithFlags = normalizeCreativeInput({
    input: 'https://v.douyin.com/abcde/',
    useResearch: true,
    skipValidation: true,
  });
  const badDouyinPlusExternalVideo = normalizeCreativeInput({
    input: '请参考 https://v.douyin.com/abcde/ 和 https://example.com/video/7345678901234567890',
  });
  const normalUrl = normalizeCreativeInput({
    input: 'https://example.com/no-id',
  });

  assert.equal(shortLink.success, false);
  assert.match(shortLink.message, /暂时无法从抖音链接中识别视频 ID/);
  assert.equal(badDouyin.success, false);
  assert.match(badDouyin.message, /暂时无法从抖音链接中识别视频 ID/);
  assert.equal(douyinLinkWithoutId.success, false);
  assert.match(douyinLinkWithoutId.message, /暂时无法从抖音链接中识别视频 ID/);
  assert.equal(badNoProtocolDouyin.success, false);
  assert.match(badNoProtocolDouyin.message, /暂时无法从抖音链接中识别视频 ID/);
  assert.equal(mixedBadNoProtocolDouyin.success, false);
  assert.match(mixedBadNoProtocolDouyin.message, /暂时无法从抖音链接中识别视频 ID/);
  assert.equal(noProtocolUser.success, false);
  assert.match(noProtocolUser.message, /暂时无法从抖音链接中识别视频 ID/);
  assert.equal(badDouyinWithFlags.success, false);
  assert.equal(badDouyinWithFlags.data.use_research, true);
  assert.equal(badDouyinWithFlags.data.skip_validation, true);
  assert.equal(badDouyinPlusExternalVideo.success, false);
  assert.match(badDouyinPlusExternalVideo.message, /暂时无法从抖音链接中识别视频 ID/);
  assert.equal(normalUrl.success, true);
  assert.equal(normalUrl.data.mode, 'source_url');
  assert.equal(normalUrl.data.source_url, 'https://example.com/no-id');
  assert.equal(normalUrl.data.source_hint, '');
}

function testNormalizesSourceUrls() {
  const wechatUrl = 'https://mp.weixin.qq.com/s/demo';
  const wechat = normalizeCreativeInput({
    input: `请做成观点解读视频 ${wechatUrl}`,
    useResearch: true,
  });
  const github = normalizeCreativeInput({
    input: 'https://github.com/owner/repo',
  });
  const multiple = normalizeCreativeInput({
    input: '先看 https://example.com/a 再看 https://example.com/b',
  });
  const many = normalizeCreativeInput({
    input: 'https://a.com/1 https://b.com/2 https://c.com/3 https://d.com/4',
  });
  const externalVideoUrl = normalizeCreativeInput({
    input: 'https://example.com/video/7345678901234567890',
  });
  const punctuated = normalizeCreativeInput({
    input: '请分析 https://example.com/a。',
  });
  const chineseEnumerationComma = normalizeCreativeInput({
    input: 'https://a.com/1、https://b.com/2',
  });

  assert.equal(wechat.success, true);
  assert.equal(wechat.data.mode, 'source_url');
  assert.equal(wechat.data.source_url, wechatUrl);
  assert.equal(wechat.data.source_hint, '请做成观点解读视频');
  assert.equal(wechat.data.raw_text, `请做成观点解读视频 ${wechatUrl}`);
  assert.equal(wechat.data.use_research, true);

  assert.equal(github.success, true);
  assert.equal(github.data.mode, 'source_url');
  assert.equal(github.data.source_url, 'https://github.com/owner/repo');
  assert.equal(github.data.source_hint, '');

  assert.equal(multiple.success, true);
  assert.equal(multiple.data.mode, 'source_url');
  assert.equal(multiple.data.source_url, 'https://example.com/a');
  assert.equal(multiple.data.source_hint, '先看 再看 https://example.com/b');
  assert.equal(multiple.data.ignored_url_count, 1);

  assert.equal(many.success, true);
  assert.equal(many.data.mode, 'source_url');
  assert.equal(many.data.source_url, 'https://a.com/1');
  assert.equal(many.data.ignored_url_count, 3);

  assert.equal(externalVideoUrl.success, true);
  assert.equal(externalVideoUrl.data.mode, 'source_url');
  assert.equal(externalVideoUrl.data.source_url, 'https://example.com/video/7345678901234567890');
  assert.equal(externalVideoUrl.data.aweme_id, '');

  assert.equal(punctuated.success, true);
  assert.equal(punctuated.data.source_hint, '请分析');

  assert.equal(chineseEnumerationComma.success, true);
  assert.equal(chineseEnumerationComma.data.mode, 'source_url');
  assert.equal(chineseEnumerationComma.data.source_url, 'https://a.com/1');
  assert.equal(chineseEnumerationComma.data.source_hint, 'https://b.com/2');
  assert.equal(chineseEnumerationComma.data.ignored_url_count, 1);
}

function testCountsAllIgnoredSourceUrlsWithoutFixedCap() {
  const urls = Array.from(
    { length: 25 },
    (_, index) => `https://example.com/${index + 1}`
  );
  const result = normalizeCreativeInput({
    input: urls.join(' '),
  });

  assert.equal(result.success, true);
  assert.equal(result.data.mode, 'source_url');
  assert.equal(result.data.source_url, 'https://example.com/1');
  assert.equal(result.data.ignored_url_count, 24);
  assert.match(result.data.source_hint, /https:\/\/example\.com\/25/);
}

function testCountsLargeSourceUrlListWithoutRepeatedExtraction() {
  const originalExtractUrls = sourceFetch.extractUrls;
  let extractCallCount = 0;
  sourceFetch.extractUrls = function wrappedExtractUrls(...args) {
    extractCallCount += 1;
    return originalExtractUrls.apply(this, args);
  };

  try {
    const urls = Array.from(
      { length: 1000 },
      (_, index) => `https://example.com/${index + 1}`
    );
    const result = normalizeCreativeInput({
      input: urls.join(' '),
    });

    assert.equal(result.success, true);
    assert.equal(result.data.mode, 'source_url');
    assert.equal(result.data.source_url, 'https://example.com/1');
    assert.equal(result.data.ignored_url_count, 999);
    assert.match(result.data.source_hint, /https:\/\/example\.com\/1000/);
    assert.ok(
      extractCallCount <= 4,
      `expected URL extraction to stay single-pass, got ${extractCallCount} calls`
    );
  } finally {
    sourceFetch.extractUrls = originalExtractUrls;
  }
}

function testKeepsUnselectedDuplicateUrlInSourceHint() {
  const duplicate = normalizeCreativeInput({
    input: '请分析 https://example.com/a https://example.com/a',
  });
  const tripleDuplicate = normalizeCreativeInput({
    input: '请分析 https://example.com/a https://example.com/a https://example.com/a',
  });

  assert.equal(duplicate.success, true);
  assert.equal(duplicate.data.mode, 'source_url');
  assert.equal(duplicate.data.source_url, 'https://example.com/a');
  assert.equal(duplicate.data.source_hint, '请分析 https://example.com/a');
  assert.equal(duplicate.data.ignored_url_count, 1);

  assert.equal(tripleDuplicate.success, true);
  assert.equal(tripleDuplicate.data.mode, 'source_url');
  assert.equal(tripleDuplicate.data.source_url, 'https://example.com/a');
  assert.equal(tripleDuplicate.data.source_hint, '请分析 https://example.com/a https://example.com/a');
  assert.equal(tripleDuplicate.data.ignored_url_count, 2);
}

function testCountsUrlsSeparatedByChineseBookTitleAndParentheses() {
  const result = normalizeCreativeInput({
    input: '参考《https://example.com/a》（https://example.com/b）',
  });

  assert.equal(result.success, true);
  assert.equal(result.data.mode, 'source_url');
  assert.equal(result.data.source_url, 'https://example.com/a');
  assert.match(result.data.source_hint, /https:\/\/example\.com\/b/);
  assert.equal(result.data.ignored_url_count, 1);
}

function testRejectsAssetsForPhaseOne() {
  const result = normalizeCreativeInput({
    input: TEXT_INPUT,
    assetIds: ['asset-1'],
    useResearch: true,
    skipValidation: true,
  });

  assert.equal(result.success, false);
  assert.match(result.message, /图片素材将在下一阶段开放/);
  assert.equal(result.data.use_research, true);
  assert.equal(result.data.skip_validation, true);
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
  assert.equal(
    extractAwemeId('https://example.com/video/7345678901234567890'),
    ''
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
    source_url: '',
    source_hint: '',
    ignored_url_count: 0,
    use_research: false,
    skip_validation: false,
    asset_ids: [],
    created_at: now,
  });
  assert.equal(emptyContext.input.skip_validation, false);
  assert.deepEqual(partialContext.input, {
    mode: 'text',
    raw_text: '',
    aweme_id: '',
    douyin_url: '',
    source_url: '',
    source_hint: '',
    ignored_url_count: 0,
    use_research: false,
    skip_validation: false,
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
  testNormalizesNoProtocolDouyinVideoUrl();
  testDoesNotTreatExternalNoProtocolVideoPathAsDouyin();
  testNormalizesDouyinId();
  testNormalizesBareDouyinQueryFragments();
  testRejectsEmptyInput();
  testRejectsDouyinLinksWithoutVideoId();
  testNormalizesSourceUrls();
  testCountsAllIgnoredSourceUrlsWithoutFixedCap();
  testCountsLargeSourceUrlListWithoutRepeatedExtraction();
  testKeepsUnselectedDuplicateUrlInSourceHint();
  testCountsUrlsSeparatedByChineseBookTitleAndParentheses();
  testRejectsAssetsForPhaseOne();
  testExtractsAwemeIdFromSupportedInputs();
  testBuildsStableCreativeContext();
  testBuildsDefaultContextsWhenMissing();
  testBuildsStableInputSchemaFromMissingOrPartialInput();
  testBuildsPendingDouyinSourceContextWhenMissing();
  console.log('creative context tests passed');
}

run();
