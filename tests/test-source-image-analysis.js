const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  analyzeSourceImageAssets,
} = require('../server/services/source/sourceImageAnalysis');

async function testDisabledMarksAllAssetsDisabled() {
  const assets = [
    { id: 'article_01', type: 'image', source: 'article', local_path: 'a.png' },
    { id: 'search_01', type: 'image', source: 'search', local_path: 'b.png' },
  ];
  const result = await analyzeSourceImageAssets({ enabled: false, assets });

  assert.equal(result.status, 'disabled');
  assert.match(result.summary, /已关闭/);
  assert.equal(result.assets.length, 2);
  assert.deepEqual(result.assets.map(asset => asset.image_analysis.status), ['disabled', 'disabled']);
}

async function testEnabledAnalyzesArticleImageWithMultimodalJson() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-image-analysis-test-'));
  const imagePath = path.join(dir, 'article.png');
  fs.writeFileSync(imagePath, Buffer.from('png-bytes'));
  const calls = [];

  const result = await analyzeSourceImageAssets({
    enabled: true,
    runtime: { provider: 'openai-compatible', modelId: 'vision-model' },
    assets: [{
      id: 'article_01',
      type: 'image',
      source: 'article',
      local_path: imagePath,
      mime: 'image/png',
      alt: '产品截图',
      url: 'https://example.com/article.png',
    }],
    model: {
      callTextModel: async request => {
        calls.push(request);
        assert.equal(request.provider, 'openai-compatible');
        assert.equal(request.modelId, 'vision-model');
        assert.equal(request.textConfig.modelId, 'vision-model');
        assert.ok(Array.isArray(request.messages[0].content));
        assert.equal(request.messages[0].content[0].type, 'text');
        assert.equal(request.messages[0].content[1].type, 'image_url');
        assert.match(request.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
        return {
          success: true,
          text: '```json\n{"visual_type":"screenshot","summary":"产品界面截图","contains_text":true,"text_readability":"clear","best_usage":"hero","fit":"high","should_use":true,"relevance_keywords":["产品","界面","AI","截图","演示","多余"],"avoid_reason":""}\n```',
        };
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.status, 'ready');
  assert.equal(result.assets[0].image_analysis.status, 'ready');
  assert.equal(result.assets[0].image_analysis.visual_type, 'screenshot');
  assert.equal(result.assets[0].image_analysis.fit, 'high');
  assert.equal(result.assets[0].image_analysis.should_use, true);
  assert.deepEqual(result.assets[0].image_analysis.relevance_keywords, ['产品', '界面', 'AI', '截图', '演示', '多余']);
}

async function testModelFailureReturnsStructuredFailedStatus() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-image-analysis-fail-test-'));
  const imagePath = path.join(dir, 'article.png');
  fs.writeFileSync(imagePath, Buffer.from('png-bytes'));

  const result = await analyzeSourceImageAssets({
    enabled: true,
    assets: [{
      id: 'article_01',
      type: 'image',
      source: 'article',
      local_path: imagePath,
      mime: 'image/png',
    }],
    model: {
      callTextModel: async () => ({ success: false, message: '模型失败：限流' }),
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.assets[0].image_analysis.status, 'failed');
  assert.match(result.assets[0].image_analysis.message, /模型失败/);
}

async function testEnabledSkipsSearchAssetsWithoutModelCall() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-image-analysis-skip-test-'));
  const imagePath = path.join(dir, 'article.png');
  fs.writeFileSync(imagePath, Buffer.from('png-bytes'));
  let calls = 0;

  const result = await analyzeSourceImageAssets({
    enabled: true,
    assets: [
      { id: 'article_01', type: 'image', source: 'article', local_path: imagePath, mime: 'image/png' },
      { id: 'search_01', type: 'image', source: 'search', local_path: imagePath, mime: 'image/png' },
      { id: 'pexels_01', type: 'image', source: 'pexels', local_path: imagePath, mime: 'image/png' },
    ],
    model: {
      callTextModel: async () => {
        calls += 1;
        return {
          success: true,
          text: '{"visual_type":"screenshot","summary":"文章图","contains_text":false,"text_readability":"","best_usage":"showcase","fit":"contain","should_use":true,"relevance_keywords":[],"avoid_reason":""}',
        };
      },
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(calls, 1);
  assert.equal(result.assets.find(asset => asset.id === 'search_01').image_analysis.status, 'skipped');
  assert.equal(result.assets.find(asset => asset.id === 'pexels_01').image_analysis.status, 'skipped');
}

async function testPartialStatusWhenSomeArticleImagesFail() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-image-analysis-partial-test-'));
  const firstPath = path.join(dir, 'first.png');
  const secondPath = path.join(dir, 'second.png');
  fs.writeFileSync(firstPath, Buffer.from('png-bytes'));
  fs.writeFileSync(secondPath, Buffer.from('png-bytes'));
  let calls = 0;

  const result = await analyzeSourceImageAssets({
    enabled: true,
    assets: [
      { id: 'article_01', type: 'image', source: 'article', local_path: firstPath, mime: 'image/png' },
      { id: 'article_02', type: 'image', source: 'article', local_path: secondPath, mime: 'image/png' },
    ],
    model: {
      callTextModel: async () => {
        calls += 1;
        if (calls === 2) return { success: false, message: '模型失败：第二张失败' };
        return {
          success: true,
          text: '{"visual_type":"screenshot","summary":"第一张成功","contains_text":false,"text_readability":"","best_usage":"showcase","fit":"contain","should_use":true,"relevance_keywords":[],"avoid_reason":""}',
        };
      },
    },
  });

  assert.equal(result.status, 'partial');
  assert.match(result.summary, /1 张失败后降级/);
  assert.equal(result.assets[0].image_analysis.status, 'ready');
  assert.equal(result.assets[1].image_analysis.status, 'failed');
}

(async () => {
  await testDisabledMarksAllAssetsDisabled();
  await testEnabledAnalyzesArticleImageWithMultimodalJson();
  await testModelFailureReturnsStructuredFailedStatus();
  await testEnabledSkipsSearchAssetsWithoutModelCall();
  await testPartialStatusWhenSomeArticleImagesFail();
  console.log('source image analysis tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
