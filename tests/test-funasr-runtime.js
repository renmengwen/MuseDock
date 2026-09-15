const assert = require('assert/strict');
const http = require('http');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { spawn } = require('child_process');
const { createFunasrRuntime } = require('../server/services/transcription/funasrRuntime');

const config = { builtin: true, provider: 'funasr', baseUrl: 'http://127.0.0.1:18000/v1',
  pythonPath: 'python-fixture', modelCache: 'C:/模型缓存' };
const ready = { status: 'ready', model: 'paraformer', timing_source: 'funasr_sentence_info' };
const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status });
const refused = () => new TypeError('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) });

class Child extends EventEmitter {
  constructor() { super(); this.stdin = new PassThrough(); this.stderr = new PassThrough(); this.killCount = 0; }
  unref() {}
  kill() { this.killCount += 1; queueMicrotask(() => this.emit('close', 0)); return true; }
}

function fixture(overrides = {}) {
  const state = { started: false, ready: false, requests: [], launches: [], pythonChecks: [] };
  state.runtime = createFunasrRuntime({ env: {}, startTimeoutMs: 100, probeTimeoutMs: 50, pollIntervalMs: 2,
    fetchImpl: async (url, options) => {
      state.requests.push(url);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers?.Authorization, undefined);
      if (state.fetch) return state.fetch(url);
      if (!state.ready) throw refused();
      return response(ready);
    },
    execute: async (file, args, options) => {
      state.pythonChecks.push(file);
      assert.equal(options.windowsHide, true);
      assert.equal(options.shell, false);
      assert.ok(args.includes('-c'));
      if (state.pythonError) throw state.pythonError;
    },
    spawnImpl: (file, args, options) => {
      const child = new Child();
      state.started = true;
      state.launches.push({ file, args, options, child });
      state.onLaunch?.(child);
      return child;
    }, ...overrides,
  });
  return state;
}

async function withTimeout(operation, milliseconds = 5000) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('测试等待超时')), milliseconds);
  })]); } finally { clearTimeout(timer); }
}

async function realProcessLifecycle() {
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  let child;
  let closed;
  let launches = 0;
  const runtime = createFunasrRuntime({ env: process.env, startTimeoutMs: 5000, probeTimeoutMs: 250, pollIntervalMs: 20,
    execute: async () => {},
    spawnImpl: (_file, args, options) => {
      launches += 1;
      assert.equal(args[args.indexOf('--port') + 1], String(port));
      assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1');
      const source = `const http = require('http');
        const server = http.createServer((req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(${JSON.stringify(ready)}));
        });
        server.listen(${port}, '127.0.0.1');
        process.stdin.resume();
        process.stdin.on('end', () => process.exit(0));`;
      child = spawn(process.execPath, ['-e', source], options);
      closed = new Promise(resolve => child.once('close', resolve));
      return child;
    },
  });
  try {
    const local = { ...config, baseUrl: `http://127.0.0.1:${port}/v1` };
    assert.equal((await runtime.ensure(local)).started, true);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`).then(result => result.json())).status, 'ready');
    assert.equal((await runtime.ensure(local)).started, false);
    assert.equal(launches, 1);
  } finally {
    runtime.close();
    if (closed) await withTimeout(closed);
  }
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
}

async function run() {
  const external = fixture();
  for (const value of [
    { ...config, builtin: false },
    { ...config, baseUrl: 'https://127.0.0.1:18000/v1' },
    { ...config, baseUrl: 'http://example.invalid/v1' },
    { ...config, baseUrl: 'http://127.0.0.1.example.invalid/v1' },
  ]) assert.equal((await external.runtime.ensure(value)).started, false);
  assert.equal(external.requests.length, 0, '外部或供应商服务不能触发本地探测及启动');
  const manual = fixture({ env: { FUNASR_AUTO_START: '0' } });
  await manual.runtime.ensure(config);
  assert.equal(manual.requests.length, 0);

  const existing = fixture();
  existing.ready = true;
  assert.equal((await existing.runtime.ensure(config)).started, false);
  existing.runtime.close();
  assert.equal(existing.pythonChecks.length, 0, '健康服务无需本机安装 Python');
  assert.equal(existing.launches.length, 0);

  const localhostService = fixture();
  localhostService.ready = true;
  await localhostService.runtime.ensure({ ...config, baseUrl: 'http://localhost:18000/v1' });
  assert.equal(localhostService.requests[0], 'http://localhost:18000/health', '探测应使用配置的原始主机名，兼容 IPv6 localhost');
  assert.equal(localhostService.launches.length, 0);

  const compatible = fixture();
  compatible.fetch = url => url.endsWith('/health') ? response({}, 404) : response({ data: [{ id: 'paraformer' }] });
  await compatible.runtime.ensure(config);
  assert.equal(compatible.requests.at(-1), 'http://127.0.0.1:18000/v1/models');
  assert.equal(compatible.launches.length, 0);

  const occupied = fixture();
  occupied.fetch = () => response({ status: 'ok' });
  await assert.rejects(occupied.runtime.ensure(config), error => error.code === 'ASR_PORT_IN_USE');
  assert.equal(occupied.launches.length, 0);
  const authenticated = fixture();
  authenticated.fetch = () => response({}, 401);
  await assert.rejects(authenticated.runtime.ensure(config), error => error.code === 'ASR_LOCAL_AUTH_REQUIRED');
  const unreachable = fixture();
  unreachable.fetch = () => { throw new DOMException('timeout', 'TimeoutError'); };
  await assert.rejects(unreachable.runtime.ensure(config), error => error.code === 'ASR_HEALTH_UNAVAILABLE');
  assert.equal(unreachable.launches.length, 0, '无响应不等于端口空闲');

  const startup = fixture({ env: { FUNASR_API_KEY: 'must-not-inherit', MODELSCOPE_CACHE: 'override-cache' } });
  startup.onLaunch = () => setTimeout(() => { startup.ready = true; }, 15);
  const firstProgress = [];
  const secondProgress = [];
  await Promise.all([
    startup.runtime.ensure(config, { onProgress: event => firstProgress.push(event.message) }),
    startup.runtime.ensure({ ...config, baseUrl: 'http://localhost:18000/v1' }, { onProgress: event => secondProgress.push(event.message) }),
  ]);
  assert.equal(startup.launches.length, 1, '并发及 localhost 别名共用一次启动');
  assert.equal(startup.pythonChecks.length, 1);
  const launched = startup.launches[0];
  assert.equal(launched.file, config.pythonPath);
  assert.equal(launched.options.windowsHide, true);
  assert.equal(launched.options.shell, false);
  assert.equal(launched.options.env.FUNASR_API_KEY, '');
  assert.equal(launched.args[launched.args.indexOf('--model-cache') + 1], 'override-cache');
  assert.ok(launched.args.includes('--parent-stdin'));
  assert.ok(firstProgress.some(message => message.includes('加载模型')));
  assert.ok(secondProgress.some(message => message.includes('已就绪')));
  await startup.runtime.ensure(config);
  assert.equal(startup.launches.length, 1, '后续转写复用进程');
  startup.runtime.close();
  assert.equal(launched.child.killCount, 1);
  assert.equal(launched.child.stdin.writableEnded, true);

  const missing = fixture();
  missing.pythonError = new Error('fixture missing dependency');
  await assert.rejects(missing.runtime.ensure(config), error => error.code === 'ASR_PYTHON_NOT_READY');
  assert.equal(missing.launches.length, 0);
  const failed = fixture();
  failed.onLaunch = child => queueMicrotask(() => {
    child.stderr.emit('data', Buffer.from('ModuleNotFoundError: fixture-secret https://example.invalid/?token=private'));
    child.emit('close', 1);
  });
  await assert.rejects(failed.runtime.ensure(config), error => error.code === 'ASR_DEPENDENCIES_MISSING'
    && !/fixture-secret|token=|example\.invalid/.test(error.message));
  failed.onLaunch = () => { failed.ready = true; };
  assert.equal((await failed.runtime.ensure(config)).started, true, '失败后新任务可以重新启动');
  failed.runtime.close();

  const stalled = fixture({ startTimeoutMs: 20 });
  await assert.rejects(stalled.runtime.ensure(config), error => error.code === 'ASR_START_TIMEOUT');
  assert.equal(stalled.launches[0].child.killCount, 1, '超时终止自己启动的进程');
  const loading = fixture({ startTimeoutMs: 20 });
  loading.fetch = () => response({ status: 'loading' }, 503);
  await assert.rejects(loading.runtime.ensure(config), error => error.code === 'ASR_START_TIMEOUT');
  assert.equal(loading.launches.length, 0, '已在加载的外部服务不能重复启动或关闭');
  const badPath = fixture();
  await assert.rejects(badPath.runtime.ensure({ ...config, baseUrl: 'http://localhost:8000/invalid' }),
    error => error.code === 'ASR_AUTOSTART_URL_INVALID');
  assert.equal(badPath.launches.length, 0);

  await realProcessLifecycle();
}

run().then(() => console.log('FunASR 自动启动测试通过：服务探测、启动去重、模型就绪、环境与端口错误、超时、配置隔离及真实子进程退出。'))
  .catch(error => { console.error(error); process.exitCode = 1; });
