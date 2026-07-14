const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  clearCaches,
  normalizeDiagnostic,
  formatBytes,
  getDirectorySize,
  getStorageOverview,
  getSystemHealth,
} = require('../server/services/systemMaintenance');

async function createTempRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'system-health-'));
}

async function writeFile(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content);
}

async function run() {
  clearCaches();

  const rootDir = await createTempRoot();
  const mediaRoot = path.join(rootDir, 'media');
  const browserDataRoot = path.join(rootDir, 'browser-data');
  const cookieFile = path.join(rootDir, 'cookies', 'douyin.json');

  await writeFile(path.join(rootDir, 'data', 'creative-workflows', 'workflow.json'), '12345');
  await writeFile(path.join(mediaRoot, 'cache', 'asset.bin'), '1234567890');
  await writeFile(path.join(rootDir, 'data', 'render-outputs', 'output.txt'), '123');
  await writeFile(path.join(browserDataRoot, 'profile', 'state.json'), '1234567');
  await writeFile(cookieFile, '1234');

  let environmentCalls = 0;
  const services = {
    environmentDoctor: async () => {
      environmentCalls += 1;
      return {
        ok: true,
        diagnostics: [
          { ok: true, code: 'ffmpeg_available', message: 'ffmpeg 可用。', path: 'ffmpeg' },
          { code: 'playwright_missing', detail: 'Cannot find module playwright' },
        ],
      };
    },
    aiModelConfig: {
      getPublicConfig: async () => ({
        providers: {
          openai: {
            name: 'OpenAI',
            hasApiKey: true,
            models: {
              text: { enabled: true, modelId: 'gpt-4.1', supportsMultimodal: true },
              tts: { enabled: true, modelId: 'tts-1' },
            },
          },
        },
        active: {
          text: 'openai/text',
          tts: 'openai/tts',
        },
      }),
    },
  };

  const first = await getSystemHealth({
    rootDir,
    mediaRoot,
    browserDataRoot,
    cookieFile,
    services,
    nowMs: 1_000,
  });
  const second = await getSystemHealth({
    rootDir,
    mediaRoot,
    browserDataRoot,
    cookieFile,
    services,
    nowMs: 11_000,
  });

  assert.strictEqual(environmentCalls, 1, '10 秒内两次调用应只执行一次 environmentDoctor');
  assert.strictEqual(first.environment, second.environment, '环境检测应命中缓存对象');
  assert.deepStrictEqual(first.environment.diagnostics[0], {
    ok: true,
    code: 'ffmpeg_available',
    message: 'ffmpeg 可用。',
    detail: '',
    path: 'ffmpeg',
  });
  assert.deepStrictEqual(first.environment.diagnostics[1], {
    ok: false,
    code: 'playwright_missing',
    message: 'Playwright 未安装或无法加载。',
    detail: 'Cannot find module playwright',
    path: '',
  });

  const afterTtl = await getSystemHealth({
    rootDir,
    mediaRoot,
    browserDataRoot,
    cookieFile,
    services,
    nowMs: 71_000,
  });
  assert.strictEqual(environmentCalls, 2, '70 秒后应重新执行环境检测');
  assert.ok(afterTtl.environment.ok);

  const refreshed = await getSystemHealth({
    rootDir,
    mediaRoot,
    browserDataRoot,
    cookieFile,
    services,
    refresh: true,
    nowMs: 72_000,
  });
  assert.strictEqual(environmentCalls, 3, 'refresh: true 应强制刷新环境缓存');
  assert.ok(refreshed.storage.creativeWorkflows.bytes > 0);

  assert.deepStrictEqual(normalizeDiagnostic({ ok: true, code: 'ffmpeg_available', path: 'ffmpeg' }), {
    ok: true,
    code: 'ffmpeg_available',
    message: 'ffmpeg 可用。',
    detail: '',
    path: 'ffmpeg',
  });
  assert.strictEqual(formatBytes(1536), '1.5 KB');
  assert.strictEqual(await getDirectorySize(path.join(rootDir, 'missing')), 0);

  const storage = await getStorageOverview({ rootDir, mediaRoot, browserDataRoot, cookieFile });
  for (const key of ['creativeWorkflows', 'mediaCache', 'renderOutputs', 'browserData', 'cookies']) {
    assert.ok(storage[key], `${key} should exist`);
    assert.strictEqual(typeof storage[key].bytes, 'number', `${key}.bytes should be number`);
    assert.strictEqual(typeof storage[key].display, 'string', `${key}.display should be string`);
  }

  assert.deepStrictEqual(first.models, {
    analysis: {
      configured: true,
      provider: 'OpenAI',
      providerId: 'openai',
      modelId: 'gpt-4.1',
      supportsMultimodal: true,
    },
    tts: {
      configured: true,
      provider: 'OpenAI',
      providerId: 'openai',
      modelId: 'tts-1',
    },
  });

  assert.deepStrictEqual(Object.keys(first).sort(), ['environment', 'models', 'storage']);

  const throwing = await getSystemHealth({
    rootDir,
    mediaRoot,
    browserDataRoot,
    cookieFile,
    services: {
      ...services,
      environmentDoctor: async () => {
        throw new Error('spawn ffmpeg ENOENT');
      },
    },
    refresh: true,
    nowMs: 73_000,
  });
  assert.strictEqual(throwing.environment.ok, false);
  assert.deepStrictEqual(throwing.environment.diagnostics, [
    {
      ok: false,
      code: 'environment_check_failed',
      message: '运行环境检测失败。',
      detail: 'spawn ffmpeg ENOENT',
      path: '',
    },
  ]);

  await fsp.rm(rootDir, { recursive: true, force: true });
  console.log('system health service tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
