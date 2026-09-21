const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createDouyinBrowserLauncher, DouyinBrowserError } = require('../server/scraper/douyinBrowser');

async function withFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-douyin-browser-'));
  const activePortFile = path.join(root, 'DevToolsActivePort');
  const requests = [];
  const processes = [];
  const writes = [];
  const endpoint = 'ws://127.0.0.1:38457/devtools/browser/fixture-browser';
  const options = {
    userDataDir: root,
    findChromePath: () => 'fixture-chrome.exe',
    startupTimeoutMs: 1000,
    pollIntervalMs: 5,
    browserType: {
      connectOverCDP: async (url, connectionOptions) => {
        requests.push({ url, ...connectionOptions });
        if (url !== endpoint) throw new Error('404: unrelated browser service');
        return { fixtureConnection: requests.length };
      },
    },
    spawnProcess: (_executable, args, spawnOptions) => {
      const child = new EventEmitter();
      child.exitCode = null;
      child.unref = () => {};
      processes.push({ args, spawnOptions, child });
      writes.push(fs.writeFile(activePortFile, '38457\n/devtools/browser/fixture-browser\n'));
      return child;
    },
  };
  try { await run({ root, activePortFile, endpoint, requests, processes, options }); }
  finally {
    await Promise.all(writes);
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function run() {
  await withFixture(async ({ activePortFile, endpoint, requests, processes, options }) => {
    // 模拟旧连接已失效、原端口被返回 404 的其他浏览器服务占用。
    await fs.writeFile(activePortFile, '9222\n/devtools/browser/old-browser\n');
    const result = await createDouyinBrowserLauncher(options).start(false);
    assert.equal(result.isNew, true);
    assert.equal(processes.length, 1);
    assert.ok(processes[0].args.includes('--remote-debugging-port=0'), '由 Chrome 分配空闲端口');
    assert.ok(processes[0].args.includes(`--user-data-dir=${options.userDataDir}`), '继续使用原专用登录目录');
    assert.ok(!processes[0].args.some(arg => arg.startsWith('--headless')), '登录窗口应可见');
    assert.equal(requests.at(-1).url, endpoint);
    assert.ok(requests.every(request => request.timeout > 0), '每次连接都必须有超时');

    const restarted = createDouyinBrowserLauncher({ ...options, findChromePath: () => null });
    const reused = await restarted.start(false);
    assert.equal(reused.isNew, false, '服务重启后从同一配置目录恢复连接');
    assert.equal(processes.length, 1, '有效登录窗口无需重新启动');
  });

  await withFixture(async ({ activePortFile, requests, processes, options }) => {
    await fs.writeFile(activePortFile, '9222\nws://example.invalid/devtools/browser/foreign\n');
    const result = await createDouyinBrowserLauncher(options).start(false);
    assert.equal(result.isNew, true);
    assert.equal(processes.length, 1);
    assert.ok(requests.every(request => request.url.startsWith('ws://127.0.0.1:38457/')), '损坏的发现文件不得改变连接主机');
  });

  await withFixture(async ({ options, processes }) => {
    const launcher = createDouyinBrowserLauncher(options);
    const [first, second] = await Promise.all([launcher.start(false), launcher.start(false)]);
    assert.equal(processes.length, 1, '并发请求只能启动一个专用 Chrome');
    assert.notEqual(first.browser, second.browser, '每个调用保留独立连接');
    assert.equal(second.isNew, false);
  });

  await withFixture(async ({ options, processes }) => {
    const launcher = createDouyinBrowserLauncher({ ...options, findChromePath: () => null });
    await assert.rejects(launcher.start(false), error => error instanceof DouyinBrowserError
      && error.code === 'DOUYIN_CHROME_NOT_FOUND' && /安装 Chrome/.test(error.message));
    assert.equal(processes.length, 0);
  });

  await withFixture(async ({ options }) => {
    const launcher = createDouyinBrowserLauncher({ ...options,
      spawnProcess: () => {
        const child = new EventEmitter();
        child.unref = () => {};
        process.nextTick(() => child.emit('error', new Error('private-path must-not-leak')));
        return child;
      },
    });
    await assert.rejects(launcher.start(false), error => error instanceof DouyinBrowserError
      && error.code === 'DOUYIN_CHROME_START_FAILED' && !error.message.includes('must-not-leak'));
  });

  await withFixture(async ({ root, options }) => {
    const invalidProfile = path.join(root, 'file-instead-of-directory');
    await fs.writeFile(invalidProfile, 'fixture');
    const launcher = createDouyinBrowserLauncher({ ...options, userDataDir: invalidProfile });
    await assert.rejects(launcher.start(false), error => error.code === 'DOUYIN_CHROME_PROFILE_UNAVAILABLE');
  });

  await withFixture(async ({ options }) => {
    const launcher = createDouyinBrowserLauncher({ ...options, startupTimeoutMs: 25,
      spawnProcess: () => {
        const child = new EventEmitter();
        child.unref = () => {};
        return child;
      },
    });
    await assert.rejects(launcher.start(false), error => error.code === 'DOUYIN_CHROME_CONNECT_TIMEOUT' && error.status === 504);
  });
}

run().then(() => console.log('抖音 Chrome 启动测试通过：端口冲突、重启复用、无效发现文件、并发启动、缺少 Chrome、启动失败、目录异常和连接超时。'))
  .catch(error => { console.error(error); process.exitCode = 1; });
