const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const aiModelConfig = require('../server/services/ai/aiModelConfig');
const diagnostics = require('../server/services/ai/aiProviderDiagnostics');
const { runWithApiCallContext, flushApiCallRecords } = require('../server/services/diagnostics/apiCallRecorder');

const KEY = 'fixture-provider-secret-1234';
const PROVIDER = { id: 'fixture', baseUrl: 'https://api.example.invalid/custom/v1', protocol: 'openai-responses', apiKey: KEY };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
});
const catalog = () => json({ data: [{ id: 'fixture-model' }] });

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-provider-diagnostics-'));
  const configPath = path.join(root, 'ai-models.json');
  const originalDiagnose = diagnostics.diagnoseProvider;
  let server;
  let slowServer;
  let passed = 0;
  const pass = title => { passed += 1; console.log(`PASS ${title}`); };
  const diagnose = (provider = PROVIDER, options = {}) => originalDiagnose(provider, { configPath, fetchImpl: async () => catalog(), ...options });
  try {
    await aiModelConfig.saveConfig({ providers: { fixture: { ...PROVIDER, models: { text: { enabled: true, modelId: 'saved-model' } } } }, active: { text: 'fixture/text' } }, { configPath });
    const originalConfig = await fs.readFile(configPath, 'utf8');
    const requests = [];
    const probe = await diagnose({ ...PROVIDER, apiKey: '', baseUrl: `${PROVIDER.baseUrl}/` }, { fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return catalog();
    } });
    assert.equal(probe.success, true);
    assert.equal(probe.data.httpStatus, 200);
    assert.ok(probe.data.latencyMs >= 0);
    assert.match(probe.data.message, /尚未验证/);
    assert.equal(probe.data.models, undefined);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `${PROVIDER.baseUrl}/models`);
    assert.equal(requests[0].options.method, 'GET');
    assert.equal(requests[0].options.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(requests[0].options.body, undefined);
    assert.equal(requests[0].options.redirect, 'manual');
    assert.equal(await fs.readFile(configPath, 'utf8'), originalConfig);
    assert.ok(!JSON.stringify(probe).includes(KEY));
    pass('草稿探针复用已保存密钥，仅请求模型目录，保留路径，不写配置或生成内容');

    const models = await diagnose(PROVIDER, { mode: 'models', fetchImpl: async () => json({ data: [
      { id: 'z-model', display_name: '中文名称', api_key: KEY }, { id: 'a-model' }, { id: 'z-model' },
      { id: '' }, { name: 'missing-id' }, { id: KEY }, { id: 'named-model', display_name: `回显 ${KEY}` },
    ] }) });
    assert.equal(models.success, true);
    assert.deepEqual(models.data.models.map(item => item.id), ['a-model', 'named-model', 'z-model']);
    assert.deepEqual(models.data.models[2], { id: 'z-model', name: '中文名称' });
    assert.ok(!JSON.stringify(models).includes(KEY));
    const empty = await diagnose(PROVIDER, { mode: 'models', fetchImpl: async () => json({ data: [] }) });
    assert.equal(empty.success, true);
    assert.deepEqual(empty.data.models, []);
    assert.match(empty.data.message, /为空/);
    pass('模型目录排序去重、保留名称、过滤异常 ID 与敏感字段，空目录明确提示');

    const anthropic = { ...PROVIDER, protocol: 'anthropic-messages' };
    const pages = [];
    const anthropicModels = await diagnose(anthropic, { mode: 'models', fetchImpl: async (url, options) => {
      pages.push(new URL(url));
      assert.equal(options.headers['x-api-key'], KEY);
      assert.equal(options.headers['anthropic-version'], '2023-06-01');
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(new URL(url).searchParams.get('limit'), '100');
      return pages.length === 1
        ? json({ data: [{ id: 'claude-b' }], has_more: true, last_id: 'claude-b' })
        : json({ data: [{ id: 'claude-a' }, { id: 'claude-b' }], has_more: false });
    } });
    assert.equal(anthropicModels.success, true);
    assert.equal(pages.length, 2);
    assert.equal(pages[1].searchParams.get('after_id'), 'claude-b');
    assert.equal(pages[1].pathname, '/custom/v1/models');
    assert.deepEqual(anthropicModels.data.models.map(item => item.id), ['claude-a', 'claude-b']);
    let probeCalls = 0;
    const anthropicProbe = await diagnose(anthropic, { fetchImpl: async url => {
      probeCalls += 1;
      assert.equal(new URL(url).searchParams.get('limit'), '1');
      return json({ data: [{ id: 'claude-b' }], has_more: true, last_id: 'claude-b' });
    } });
    assert.equal(anthropicProbe.success, true);
    assert.equal(probeCalls, 1);
    pass('Anthropic 认证及版本头、游标分页和单请求探针');

    let called = false;
    const noRequest = async () => { called = true; return catalog(); };
    for (const [input, code] of [
      [null, 'INVALID_PROVIDER'], [[], 'INVALID_PROVIDER'], [{}, 'NOT_CONFIGURED'],
      [{ ...PROVIDER, protocol: 'unknown' }, 'UNSUPPORTED_PROTOCOL'],
      [{ ...PROVIDER, baseUrl: 'file:///tmp/models' }, 'INVALID_BASE_URL'],
      [{ ...PROVIDER, baseUrl: 'https://user:pass@example.invalid/v1' }, 'INVALID_BASE_URL'],
      [{ ...PROVIDER, baseUrl: 'https://api.example.invalid/v1?token=fixture' }, 'INVALID_BASE_URL'],
      [{ ...PROVIDER, id: '__proto__', apiKey: '' }, 'NOT_CONFIGURED'],
      [{ ...PROVIDER, apiKey: '', baseUrl: 'https://other.example.invalid/v1' }, 'API_KEY_REQUIRED'],
      [{ ...PROVIDER, apiKey: '', baseUrl: 'http://api.example.invalid/custom/v1' }, 'API_KEY_REQUIRED'],
      [{ ...PROVIDER, apiKey: '', baseUrl: 'https://api.example.invalid:444/custom/v1' }, 'API_KEY_REQUIRED'],
    ]) {
      const result = await diagnose(input, { fetchImpl: noRequest });
      assert.equal(result.code, code);
      assert.equal(result.success, false);
    }
    assert.equal(called, false);
    const changedDraft = await diagnose({ ...PROVIDER, baseUrl: 'https://other.example.invalid/v1', apiKey: 'fixture-new-key' }, { fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer fixture-new-key');
      return catalog();
    } });
    assert.equal(changedDraft.success, true);
    pass('配置缺失和非法地址不发请求，已保存密钥限制原来源，显式新密钥可检测新地址');

    for (const [status, code] of [[401, 'AUTH_FAILED'], [402, 'QUOTA_EXCEEDED'], [403, 'PERMISSION_DENIED'],
      [404, 'MODELS_UNSUPPORTED'], [405, 'MODELS_UNSUPPORTED'], [429, 'RATE_LIMITED'], [500, 'UPSTREAM_UNAVAILABLE'], [307, 'REDIRECTED']]) {
      let count = 0;
      const result = await diagnose(PROVIDER, { fetchImpl: async () => {
        count += 1;
        return json({ error: `回显 ${KEY}` }, status, { location: 'https://other.example.invalid/models' });
      } });
      assert.equal(result.code, code);
      assert.equal(result.httpStatus, status);
      assert.equal(count, 1, '诊断不自动重试或跟随重定向');
      assert.ok(!JSON.stringify(result).includes(KEY));
    }
    for (const body of ['<!doctype html><h1>登录</h1>', JSON.stringify({ error: 'bad key' }), JSON.stringify({ data: [{}] }), JSON.stringify({ success: false, data: [] })]) {
      const result = await diagnose(PROVIDER, { fetchImpl: async () => new Response(body) });
      assert.equal(result.code, 'INVALID_RESPONSE');
      assert.equal(result.httpStatus, 200);
    }
    const network = await diagnose(PROVIDER, { fetchImpl: async () => { throw new Error(`fetch failed ${KEY}`); } });
    assert.equal(network.code, 'NETWORK_ERROR');
    assert.ok(!JSON.stringify(network).includes(KEY));
    pass('HTTP 错误分类、网络失败脱敏，HTML 与错误 JSON 不会误报成功');

    for (const response of [json({ data: [] }, 200, { 'content-length': String(3 * 1024 * 1024) }), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
      const tooLarge = await diagnose(PROVIDER, { fetchImpl: async () => response });
      assert.equal(tooLarge.code, 'RESPONSE_TOO_LARGE');
    }
    const repeated = await diagnose(anthropic, { mode: 'models', fetchImpl: async () => json({ data: [{ id: 'same' }], has_more: true, last_id: 'same' }) });
    assert.equal(repeated.code, 'INVALID_PAGINATION');
    let pageCount = 0;
    const limited = await diagnose(anthropic, { mode: 'models', fetchImpl: async () => {
      pageCount += 1;
      return json({ data: [{ id: `model-${pageCount}` }], has_more: true, last_id: `model-${pageCount}` });
    } });
    assert.equal(limited.success, true);
    assert.equal(limited.data.truncated, true);
    assert.equal(pageCount, 20);
    const modelLimit = await diagnose(PROVIDER, { mode: 'models', fetchImpl: async () => json({ data: Array.from({ length: 2001 }, (_, i) => ({ id: `model-${i}` })) }) });
    assert.equal(modelLimit.data.models.length, 2000);
    assert.equal(modelLimit.data.truncated, true);
    pass('响应大小、分页循环、页数及模型数量有界，截断明确标记');

    const slow = express();
    slow.get('/v1/models', (_req, res) => {
      res.type('application/json'); res.write('{"data":[');
      const timer = setTimeout(() => res.end(']}'), 2000);
      res.on('close', () => clearTimeout(timer));
    });
    slowServer = await new Promise(resolve => { const listener = slow.listen(0, '127.0.0.1', () => resolve(listener)); });
    const timeout = await diagnose({ ...PROVIDER, baseUrl: `http://127.0.0.1:${slowServer.address().port}/v1` }, { timeoutMs: 80, fetchImpl: fetch });
    assert.equal(timeout.code, 'TIMEOUT');
    assert.ok(timeout.latencyMs < 1500, '超时必须覆盖正文读取');
    const cancel = new AbortController();
    cancel.abort();
    const cancelled = await diagnose(PROVIDER, { signal: cancel.signal, fetchImpl: async (_url, options) => { options.signal.throwIfAborted(); return catalog(); } });
    assert.equal(cancelled.code, 'CANCELLED');
    pass('真实本地 HTTP 慢正文会超时，调用方可取消');

    const records = new Map();
    const store = { start(info) { const id = String(records.size + 1); records.set(id, info); return id; },
      update(id, patch) { records.set(id, { ...records.get(id), ...patch }); } };
    await runWithApiCallContext({ store }, () => diagnose(PROVIDER, { mode: 'models', fetchImpl: async () => json({ data: [{ id: 'fixture-model', api_key: KEY }] }) }));
    await runWithApiCallContext({ store }, () => diagnose(PROVIDER, { fetchImpl: async () => json({ error: `API Key ${KEY}` }, 401) }));
    await flushApiCallRecords();
    assert.equal(records.size, 2);
    assert.ok([...records.values()].every(record => record.transport_status === 'complete'));
    assert.ok(!JSON.stringify([...records.values()]).includes(KEY));
    assert.match(records.get('2').body_text, /已隐藏/);
    pass('成功及失败响应进入现有调用记录，密钥脱敏');

    let routeRequests = 0;
    diagnostics.diagnoseProvider = (input, options) => originalDiagnose(input, { ...options, configPath, fetchImpl: async () => { routeRequests += 1; return catalog(); } });
    const app = express(); app.use(express.json()); app.use('/api/config', require('../server/routes/config'));
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const action of ['probe', 'models']) {
      const response = await fetch(`${base}/api/config/ai-models/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: { ...PROVIDER, apiKey: '' } }) });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.success, true);
      if (action === 'models') assert.deepEqual(body.data.models, [{ id: 'fixture-model', name: 'fixture-model' }]);
      assert.ok(!JSON.stringify(body).includes(KEY));
    }
    const invalid = await fetch(`${base}/api/config/ai-models/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(invalid.status, 400);
    assert.equal(routeRequests, 2);
    assert.equal(await fs.readFile(configPath, 'utf8'), originalConfig);
    pass('实际配置路由支持草稿探针及目录查询，不持久化且不泄露密钥');
    console.log(`供应商诊断测试通过：${passed} 组。`);
  } finally {
    diagnostics.diagnoseProvider = originalDiagnose;
    for (const listener of [server, slowServer]) {
      if (listener) { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); }
    }
    assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    assert.ok(path.basename(root).startsWith('musedock-provider-diagnostics-'));
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
