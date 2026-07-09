const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const aiModelConfig = require('../server/services/ai/aiModelConfig');
const aiImageModel = require('../server/services/ai/aiImageModel');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-image-model-test-'));
  const configPath = path.join(root, 'ai-models.json');

  assert.strictEqual(await aiImageModel.isConfigured({ configPath }), false);
  const missing = await aiImageModel.generateImages({ prompt: '一张测试图', configPath });
  assert.strictEqual(missing.success, false);
  assert.strictEqual(missing.configured, false);
  assert.match(missing.message, /生图模型未配置/);

  await aiModelConfig.saveConfig({
    providers: {
      volcark: {
        name: '火山方舟',
        protocol: 'openai-responses',
        apiKey: 'ark-test-key',
        baseUrl: 'https://ark.example.com/api/v3/',
        models: {
          image: { enabled: true, modelId: 'doubao-seedream-5-0-260128' },
        },
      },
    },
    active: { image: 'volcark/image' },
  }, { configPath });
  assert.strictEqual(await aiImageModel.isConfigured({ configPath }), true);

  let requestedUrl = '';
  let requestedOptions = null;
  const fetchImpl = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        data: [
          { url: 'https://cdn.example.com/img-1.png', size: '1600x2848' },
          { url: 'https://cdn.example.com/img-2.png', size: '1600x2848' },
        ],
      }),
    };
  };

  const ok = await aiImageModel.generateImages({
    prompt: '主视觉：城市夜景航拍',
    size: '1600x2848',
    maxImages: 2,
    referenceImages: ['data:image/png;base64,AAAA'],
    configPath,
    fetchImpl,
  });
  assert.strictEqual(ok.success, true);
  assert.strictEqual(ok.images.length, 2);
  assert.strictEqual(ok.images[0].url, 'https://cdn.example.com/img-1.png');
  assert.strictEqual(requestedUrl, 'https://ark.example.com/api/v3/images/generations');
  assert.strictEqual(requestedOptions.headers.authorization, 'Bearer ark-test-key');
  const body = JSON.parse(requestedOptions.body);
  assert.strictEqual(body.model, 'doubao-seedream-5-0-260128');
  assert.strictEqual(body.size, '1600x2848');
  assert.strictEqual(body.watermark, false);
  assert.strictEqual(body.response_format, 'url');
  assert.strictEqual(body.sequential_image_generation, 'auto');
  assert.strictEqual(body.sequential_image_generation_options.max_images, 2);
  assert.deepStrictEqual(body.image, ['data:image/png;base64,AAAA']);

  await aiImageModel.generateImages({ prompt: '单图', configPath, fetchImpl });
  const singleBody = JSON.parse(requestedOptions.body);
  assert.strictEqual(singleBody.sequential_image_generation, undefined);
  assert.strictEqual(singleBody.image, undefined);

  const failFetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ error: { code: 'RateLimit', message: 'too many ark-test-key' } }),
  });
  const failed = await aiImageModel.generateImages({ prompt: 'x', configPath, fetchImpl: failFetch });
  assert.strictEqual(failed.success, false);
  assert.ok(!failed.message.includes('ark-test-key'));

  const assetDir = path.join(root, 'assets');
  const downloadFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: name => (name === 'content-type' ? 'image/png' : '') },
    arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
  });
  const downloaded = await aiImageModel.downloadGeneratedImages({
    images: [{ url: 'https://cdn.example.com/img-1.png' }],
    assetDir,
    fetchImpl: downloadFetch,
  });
  assert.strictEqual(downloaded.success, true);
  assert.strictEqual(downloaded.files.length, 1);
  assert.ok(downloaded.files[0].file_name.startsWith('generated-image-01-'));
  assert.ok(fs.existsSync(downloaded.files[0].local_path));
  assert.strictEqual(downloaded.files[0].mime, 'image/png');

  const badMimeFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: name => (name === 'content-type' ? 'text/html' : '') },
    arrayBuffer: async () => new Uint8Array([1]).buffer,
  });
  const badMime = await aiImageModel.downloadGeneratedImages({
    images: [{ url: 'https://cdn.example.com/evil.html' }],
    assetDir,
    fetchImpl: badMimeFetch,
  });
  assert.strictEqual(badMime.success, false);
  assert.match(badMime.failures[0].message, /不是图片/);

  const hugeFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: name => (name === 'content-type' ? 'image/png' : String(40 * 1024 * 1024)) },
    arrayBuffer: async () => { throw new Error('content-length 超限时不应读取 body'); },
  });
  const huge = await aiImageModel.downloadGeneratedImages({
    images: [{ url: 'https://cdn.example.com/huge.png' }],
    assetDir,
    fetchImpl: hugeFetch,
  });
  assert.strictEqual(huge.success, false);
  assert.match(huge.failures[0].message, /超过大小限制/);

  const streamHugeFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: name => (name === 'content-type' ? 'image/png' : '') },
    body: {
      getReader: () => {
        let count = 0;
        return {
          read: async () => {
            count += 1;
            if (count > 31) return { done: true };
            return { done: false, value: new Uint8Array(1024 * 1024) };
          },
          cancel: async () => {},
        };
      },
    },
  });
  const streamHuge = await aiImageModel.downloadGeneratedImages({
    images: [{ url: 'https://cdn.example.com/stream-huge.png' }],
    assetDir,
    fetchImpl: streamHugeFetch,
  });
  assert.strictEqual(streamHuge.success, false);
  assert.match(streamHuge.failures[0].message, /超过大小限制/);

  console.log('test-ai-image-model passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
