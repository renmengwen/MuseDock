const assert = require('assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const pageCaptureAssets = require('../server/services/creative/pageCaptureAssets');
const creativeSourcePrep = require('../server/services/creative/creativeSourcePrep');

const CANONICAL_URL = 'https://github.com/openai/codex';
const CAPTURE_BYTES = Buffer.from('fake-png-capture');
let suiteRoot = '';

async function createTestDir(label) {
  return fsp.mkdtemp(path.join(suiteRoot, `${label}-`));
}

async function cleanupSuiteRoot() {
  const resolvedTemp = path.resolve(os.tmpdir());
  const resolvedRoot = path.resolve(suiteRoot);
  const relative = path.relative(resolvedTemp, resolvedRoot);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), '清理目标必须位于系统临时目录内');
  assert.ok(path.basename(resolvedRoot).startsWith('page-capture-suite-'), '清理目标必须属于本测试前缀');
  await fsp.rm(resolvedRoot, { recursive: true, force: true });
}

function githubSource(overrides = {}) {
  return {
    kind: 'github_repo',
    url: 'http://127.0.0.1/should-not-be-used',
    title: 'openai/codex',
    markdown: '# openai/codex',
    metadata: { owner: 'openai', repo: 'codex' },
    ...overrides,
  };
}

function makeFakePlaywright({
  screenshot = CAPTURE_BYTES,
  evaluateDom = { scroll: { x: 0, y: 0 }, elements: [] },
  evaluateError = null,
  status = 200,
  finalUrl = CANONICAL_URL,
  redirects = {},
  responses = {},
  gotoError = null,
  fulfillError = null,
} = {}) {
  const calls = {
    importCount: 0,
    launches: [],
    contexts: [],
    gotos: [],
    gotoErrors: [],
    screenshots: [],
    screenshotPages: [],
    evaluations: [],
    sequence: [],
    routedDocuments: [],
    networkRequests: [],
    requestOptions: [],
    destroyedRequests: [],
    destroyedResponses: [],
    fulfilledResponses: [],
    routeTerminalAttempts: [],
    routeHandler: null,
    currentUrl: CANONICAL_URL,
    pageClosed: false,
    contextClosed: false,
    browserClosed: false,
  };
  const httpsRequest = (url, options, onResponse) => {
    calls.networkRequests.push(String(url));
    calls.requestOptions.push(options);
    const request = new EventEmitter();
    request.end = () => queueMicrotask(() => {
      const configured = responses[String(url)] || {};
      if (configured.timeout) {
        request.emit('timeout');
        return;
      }
      const responseStatus = redirects[String(url)] ? 302 : (configured.status ?? status);
      const headers = configured.headers || (redirects[String(url)]
        ? { location: redirects[String(url)] }
        : { 'content-type': String(url).endsWith('.css') ? 'text/css' : 'text/html' });
      const chunks = configured.chunks || [Buffer.from(`body:${url}`)];
      const response = Readable.from((async function* streamChunks() {
        for (const chunk of chunks) {
          configured.onChunk?.(chunk);
          yield chunk;
        }
      })());
      response.statusCode = responseStatus;
      response.headers = headers;
      response.rawHeaders = configured.rawHeaders || Object.entries(headers).flatMap(([name, value]) => [name, String(value)]);
      const destroy = response.destroy.bind(response);
      response.destroy = error => {
        calls.destroyedResponses.push({ url: String(url), error });
        return destroy(error);
      };
      onResponse(response);
    });
    request.destroy = error => {
      calls.destroyedRequests.push({ url: String(url), error });
      queueMicrotask(() => request.emit('error', error || new Error('destroyed')));
    };
    return request;
  };
  const page = {
    route: async (_pattern, handler) => { calls.routeHandler = handler; },
    goto: async (url, options) => {
      calls.gotos.push({ url, options });
      assert.equal(typeof calls.routeHandler, 'function', 'route 必须在 goto 前注册');
      calls.routedDocuments.push(url);
      let action;
      try {
        action = await invokeRoute(calls.routeHandler, url, 'document', { calls, fulfillError });
      } catch (error) {
        calls.gotoErrors.push(error);
        throw error;
      }
      if (action === 'abort') throw new Error('navigation aborted');
      calls.currentUrl = calls.networkRequests.at(-1) || finalUrl;
      if (gotoError) throw gotoError;
      return {
        ok: () => status >= 200 && status < 300,
        status: () => status,
        url: () => calls.currentUrl,
      };
    },
    url: () => calls.currentUrl,
    evaluate: async (callback, argument) => {
      calls.sequence.push('evaluate');
      calls.evaluations.push({ page, argument });
      if (evaluateError) throw evaluateError;
      const previous = {
        document: global.document,
        window: global.window,
        getComputedStyle: global.getComputedStyle,
      };
      const elements = evaluateDom.elements.map(item => ({
        tagName: item.tag,
        textContent: item.text,
        getBoundingClientRect: () => item.rect,
        __style: item.style || {},
      }));
      global.document = { querySelectorAll: () => elements };
      global.window = {
        scrollX: evaluateDom.scroll?.x || 0,
        scrollY: evaluateDom.scroll?.y || 0,
      };
      global.getComputedStyle = element => ({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        ...element.__style,
      });
      try {
        return callback(argument);
      } finally {
        global.document = previous.document;
        global.window = previous.window;
        global.getComputedStyle = previous.getComputedStyle;
      }
    },
    screenshot: async options => {
      calls.sequence.push('screenshot');
      calls.screenshotPages.push(page);
      calls.screenshots.push(options);
      return screenshot;
    },
    close: async () => { calls.pageClosed = true; },
  };
  const context = {
    newPage: async () => page,
    close: async () => { calls.contextClosed = true; },
  };
  const browser = {
    newContext: async options => {
      calls.contexts.push(options);
      return context;
    },
    close: async () => { calls.browserClosed = true; },
  };
  return {
    calls,
    httpsRequest,
    importPlaywright: async () => {
      calls.importCount += 1;
      return {
        chromium: {
          launch: async options => {
            calls.launches.push(options);
            return browser;
          },
        },
      };
    },
    get deps() {
      return { importPlaywright: this.importPlaywright, httpsRequest };
    },
  };
}

async function invokeRoute(handler, url, resourceType = 'document', fake = {}) {
  let action = '';
  const calls = fake.calls || { networkRequests: [], fulfilledResponses: [], routeTerminalAttempts: [] };
  let terminalCount = 0;
  try {
    await handler({
      request: () => ({
        url: () => url,
        resourceType: () => resourceType,
      }),
      fulfill: async options => {
        terminalCount += 1;
        action = 'fulfill';
        calls.routeTerminalAttempts.push({ url, action });
        calls.fulfilledResponses.push(options);
        if (fake.fulfillError) throw fake.fulfillError;
      },
      abort: async () => {
        terminalCount += 1;
        action = 'abort';
        calls.routeTerminalAttempts.push({ url, action });
      },
    });
  } finally {
    assert.equal(terminalCount, 1, '每个 route 只能执行一次终态动作');
  }
  return action;
}

async function testCapturesCanonicalGithubRepositoryPage() {
  const projectDir = await createTestDir('success');
  const fake = makeFakePlaywright();
  const result = await pageCaptureAssets.captureGithubRepositoryPage({
    sourceMaterial: githubSource(),
    projectDir,
    now: '2026-07-16T00:00:00.000Z',
    deps: fake.deps,
  });

  assert.equal(fake.calls.importCount, 1);
  assert.deepEqual(fake.calls.launches, [{ channel: 'chrome', headless: true }]);
  assert.deepEqual(fake.calls.contexts, [{
    viewport: { width: 1440, height: 900 },
    javaScriptEnabled: false,
    acceptDownloads: false,
    serviceWorkers: 'block',
  }]);
  assert.deepEqual(fake.calls.gotos, [{
    url: CANONICAL_URL,
    options: { waitUntil: 'load', timeout: 12000 },
  }]);
  assert.deepEqual(fake.calls.routedDocuments, [CANONICAL_URL]);
  assert.deepEqual(fake.calls.fulfilledResponses[0], {
    status: 200,
    contentType: 'text/html',
    body: Buffer.from(`body:${CANONICAL_URL}`),
  });
  assert.equal(fake.calls.requestOptions[0].agent, false);
  assert.equal(fake.calls.requestOptions[0].maxHeaderSize, 32 * 1024);
  assert.equal(fake.calls.requestOptions[0].headers['Accept-Encoding'], 'identity');
  assert.ok(!Object.keys(fake.calls.requestOptions[0].headers).some(name => /cookie|authorization|referer/i.test(name)));
  assert.deepEqual(fake.calls.screenshots, [{ type: 'png', fullPage: false }]);
  assert.deepEqual(fake.calls.sequence, ['evaluate', 'screenshot']);
  assert.equal(fake.calls.evaluations[0].page, fake.calls.screenshotPages[0]);
  assert.equal(result.status, 'ready');
  assert.equal(result.assets.length, 1);
  assert.deepEqual({
    origin: result.assets[0].origin,
    origin_detail: result.assets[0].origin_detail,
    provider: result.assets[0].provider,
    requirement: result.assets[0].requirement,
    evidence_class: result.assets[0].evidence_class,
    status: result.assets[0].status,
    url: result.assets[0].url,
    mime: result.assets[0].mime,
    bytes: result.assets[0].bytes,
  }, {
    origin: 'page_capture',
    origin_detail: 'github_repository_page',
    provider: 'chromium',
    requirement: 'optional',
    evidence_class: 'direct_source',
    status: 'ready',
    url: CANONICAL_URL,
    mime: 'image/png',
    bytes: CAPTURE_BYTES.length,
  });
  assert.match(result.assets[0].path, /^assets\/github-page-[a-f0-9]{16}\.png$/);
  assert.ok(path.resolve(result.assets[0].local_path).startsWith(`${path.resolve(projectDir, 'assets')}${path.sep}`));
  assert.deepEqual(await fsp.readFile(result.assets[0].local_path), CAPTURE_BYTES);
  assert.deepEqual(result.assets[0].page_capture_evidence, {
    version: 1,
    viewport: { width: 1440, height: 900 },
    scroll: { x: 0, y: 0 },
    elements: [],
  });
  assert.equal(fake.calls.pageClosed, true);
  assert.equal(fake.calls.contextClosed, true);
  assert.equal(fake.calls.browserClosed, true);

  const second = makeFakePlaywright({ screenshot: Buffer.from('updated-png') });
  const retried = await pageCaptureAssets.captureGithubRepositoryPage({
    sourceMaterial: githubSource(),
    projectDir,
    deps: second.deps,
  });
  assert.equal(retried.assets[0].id, result.assets[0].id);
  assert.equal(retried.assets[0].path, result.assets[0].path);
  assert.deepEqual(await fsp.readFile(retried.assets[0].local_path), Buffer.from('updated-png'));
}

async function testCollectsBoundedVisibleDomEvidenceBeforeScreenshot() {
  const repeated = {
    tag: 'SPAN',
    text: '  同名   候选  ',
    rect: { x: 144, y: 180, width: 144, height: 90 },
  };
  const hidden = [
    { tag: 'DIV', text: 'display', rect: { x: 1, y: 1, width: 10, height: 10 }, style: { display: 'none' } },
    { tag: 'DIV', text: 'hidden', rect: { x: 1, y: 1, width: 10, height: 10 }, style: { visibility: 'hidden' } },
    { tag: 'DIV', text: 'visibility', rect: { x: 1, y: 1, width: 10, height: 10 }, style: { visibility: 'collapse' } },
    { tag: 'DIV', text: 'opacity', rect: { x: 1, y: 1, width: 10, height: 10 }, style: { opacity: '0' } },
    { tag: 'DIV', text: 'zero', rect: { x: 1, y: 1, width: 0, height: 10 } },
    { tag: 'DIV', text: 'outside', rect: { x: 1440, y: 1, width: 10, height: 10 } },
    { tag: 'DIV', text: '   ', rect: { x: 1, y: 1, width: 10, height: 10 } },
  ];
  const filler = Array.from({ length: 205 }, (_, index) => ({
    tag: 'P',
    text: `条目 ${index}`,
    rect: { x: 10, y: 10, width: 10, height: 10 },
  }));
  const fake = makeFakePlaywright({
    evaluateDom: {
      scroll: { x: 12, y: 34 },
      elements: [
        { tag: 'BUTTON', text: `  ${'长'.repeat(170)}  `, rect: { x: -144, y: 90, width: 288, height: 180 } },
        repeated,
        { ...repeated, rect: { x: 432, y: 270, width: 144, height: 90 } },
        ...hidden,
        ...filler,
      ],
    },
  });
  const result = await pageCaptureAssets.captureGithubRepositoryPage({
    sourceMaterial: githubSource(),
    projectDir: await createTestDir('dom-evidence'),
    deps: fake.deps,
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(fake.calls.sequence, ['evaluate', 'screenshot']);
  assert.equal(fake.calls.evaluations.length, 1);
  const evidence = result.assets[0].page_capture_evidence;
  assert.deepEqual(evidence.viewport, { width: 1440, height: 900 });
  assert.deepEqual(evidence.scroll, { x: 12, y: 34 });
  assert.equal(evidence.elements.length, 200);
  assert.deepEqual(evidence.elements[0], {
    tag: 'button',
    text: '长'.repeat(160),
    region: { x: 0, y: 0.1, width: 0.1, height: 0.2 },
  });
  assert.equal(evidence.elements.filter(item => item.text === '同名 候选').length, 2);
  assert.ok(!evidence.elements.some(item => ['display', 'hidden', 'visibility', 'opacity', 'zero', 'outside'].includes(item.text)));
  assert.ok(evidence.elements.every(item => Object.values(item.region).every(value => value >= 0 && value <= 1)));
  assert.equal(Object.hasOwn(evidence, 'focus_regions'), false);
  assert.equal(Object.hasOwn(evidence, 'trust_level'), false);
  assert.ok(evidence.elements.every(item => !Object.hasOwn(item, 'focus_regions') && !Object.hasOwn(item, 'trust_level')));
}

async function testEvaluateFailureKeepsCaptureReadyWithSafeDiagnostic() {
  const projectDir = await createTestDir('evaluate-failure');
  const secret = `DOM failed ${projectDir} token=secret`;
  const fake = makeFakePlaywright({ evaluateError: new Error(secret) });
  const result = await pageCaptureAssets.captureGithubRepositoryPage({
    sourceMaterial: githubSource(),
    projectDir,
    deps: fake.deps,
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(fake.calls.sequence, ['evaluate', 'screenshot']);
  assert.deepEqual(await fsp.readFile(result.assets[0].local_path), CAPTURE_BYTES);
  assert.deepEqual(result.assets[0].page_capture_evidence, {
    version: 1,
    viewport: { width: 1440, height: 900 },
    scroll: { x: 0, y: 0 },
    elements: [],
  });
  assert.deepEqual(result.diagnostics, [{
    code: 'page_capture_dom_evidence_unavailable',
    message: '页面 DOM 证据采集失败，已继续保留页面截图。',
    details: { category: 'evaluate_failed' },
  }]);
  assert.ok(!JSON.stringify(result).includes(secret));
}

async function testRequestInterceptionAllowsOnlyExpectedGithubResources() {
  const projectDir = await createTestDir('routes');
  const fake = makeFakePlaywright();
  await pageCaptureAssets.captureGithubRepositoryPage({
    sourceMaterial: githubSource(),
    projectDir,
    deps: fake.deps,
  });
  assert.equal(await invokeRoute(fake.calls.routeHandler, CANONICAL_URL), 'fulfill');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://github.com:443/openai/codex'), 'fulfill');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://github.githubassets.com/assets/app.css', 'stylesheet'), 'fulfill');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://github.githubassets.com:443/assets/app.css', 'stylesheet'), 'fulfill');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'http://github.com/openai/codex'), 'abort');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'http://github.githubassets.com/assets/app.css', 'stylesheet'), 'abort');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://github.com:444/openai/codex'), 'abort');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://user:pass@github.com/openai/codex'), 'abort');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://github.com.evil.example/openai/codex'), 'abort');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://github.githubassets.com.evil.example/assets/app.css', 'stylesheet'), 'abort');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://github.githubassets.com:444/assets/app.css', 'stylesheet'), 'abort');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://user:pass@github.githubassets.com/assets/app.css', 'stylesheet'), 'abort');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'http://127.0.0.1/private'), 'abort');
  const requestCount = fake.calls.networkRequests.length;
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://github.githubassets.com/assets/icon.png', 'image'), 'abort');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://github.githubassets.com/assets/font.woff2', 'font'), 'abort');
  assert.equal(fake.calls.networkRequests.length, requestCount, '图片和字体不得进入网络层');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://evil.example/tracker.png', 'image'), 'abort');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'wss://github.com/socket', 'websocket'), 'abort');
  assert.equal(await invokeRoute(fake.calls.routeHandler, 'https://github.com/openai/codex/video.mp4', 'media'), 'abort');
}

async function startRoutedCapture(fake) {
  await pageCaptureAssets.captureGithubRepositoryPage({
    sourceMaterial: githubSource(),
    projectDir: await createTestDir('bounded'),
    deps: fake.deps,
  });
  return fake.calls.routeHandler;
}

async function testBoundedNetworkBodiesAndHeaders() {
  const twoMiB = 2 * 1024 * 1024;
  const eightMiB = 8 * 1024 * 1024;
  const css = index => `https://github.githubassets.com/assets/bounded-${index}.css`;
  const responses = {
    [CANONICAL_URL]: { headers: { 'content-type': 'text/html' }, chunks: [Buffer.alloc(1)] },
    [css(1)]: { headers: { 'content-type': 'text/css' }, chunks: [Buffer.alloc(twoMiB)] },
    [css(2)]: { headers: { 'content-type': 'text/css' }, chunks: [Buffer.alloc(twoMiB)] },
    [css(3)]: { headers: { 'content-type': 'text/css' }, chunks: [Buffer.alloc(twoMiB)] },
    [css(4)]: { headers: { 'content-type': 'text/css' }, chunks: [Buffer.alloc(twoMiB - 1)] },
    [css(5)]: { headers: { 'content-type': 'text/css' }, chunks: [Buffer.alloc(1)] },
  };
  const total = makeFakePlaywright({ responses });
  const totalRoute = await startRoutedCapture(total);
  for (let index = 1; index <= 4; index += 1) {
    assert.equal(await invokeRoute(totalRoute, css(index), 'stylesheet', { calls: total.calls }), 'fulfill');
  }
  assert.equal(await invokeRoute(totalRoute, css(5), 'stylesheet', { calls: total.calls }), 'abort');
  assert.equal(total.calls.destroyedResponses.at(-1).url, css(5));

  const cases = [
    ['missing length overflow', {
      headers: { 'content-type': 'text/css' },
      chunks: [Buffer.alloc(twoMiB), Buffer.alloc(1)],
    }],
    ['declared too large', {
      headers: { 'content-type': 'text/css', 'content-length': String(twoMiB + 1) },
      chunks: [Buffer.alloc(0)],
    }],
    ['invalid length', {
      headers: { 'content-type': 'text/css', 'content-length': 'nope' },
      chunks: [Buffer.alloc(1)],
    }],
    ['conflicting length', {
      headers: { 'content-type': 'text/css', 'content-length': '1' },
      rawHeaders: ['Content-Type', 'text/css', 'Content-Length', '1', 'content-length', '2'],
      chunks: [Buffer.alloc(1)],
    }],
    ['lying small length', {
      headers: { 'content-type': 'text/css', 'content-length': '1' },
      chunks: [Buffer.alloc(2)],
    }],
    ['compressed', {
      headers: { 'content-type': 'text/css', 'content-encoding': 'gzip' },
      chunks: [Buffer.alloc(1)],
    }],
    ['wrong type', {
      headers: { 'content-type': 'text/html' },
      chunks: [Buffer.alloc(1)],
    }],
  ];
  for (const [name, response] of cases) {
    const url = css(name.replaceAll(' ', '-'));
    const fake = makeFakePlaywright({ responses: { [url]: response } });
    const handler = await startRoutedCapture(fake);
    assert.equal(await invokeRoute(handler, url, 'stylesheet', { calls: fake.calls }), 'abort', name);
    assert.equal(fake.calls.fulfilledResponses.length, 1, `${name} 不得 fulfill 非法响应`);
    assert.equal(fake.calls.destroyedResponses.at(-1).url, url, `${name} 必须销毁响应`);
  }

  const identityUrl = css('identity');
  const identity = makeFakePlaywright({ responses: {
    [identityUrl]: {
      headers: {
        'content-type': 'text/css; charset=utf-8',
        'content-encoding': 'identity',
        'set-cookie': 'secret=1',
        connection: 'keep-alive',
      },
      chunks: [Buffer.from('body{}')],
    },
  } });
  const identityRoute = await startRoutedCapture(identity);
  assert.equal(await invokeRoute(identityRoute, identityUrl, 'stylesheet', { calls: identity.calls }), 'fulfill');
  assert.deepEqual(identity.calls.fulfilledResponses.at(-1), {
    status: 200,
    contentType: 'text/css; charset=utf-8',
    body: Buffer.from('body{}'),
  });
  assert.ok(eightMiB > twoMiB);
}

async function testOverflowChunksConsumePageBudgetImmediately() {
  const twoMiB = 2 * 1024 * 1024;
  const css = index => `https://github.githubassets.com/assets/overflow-budget-${index}.css`;
  let postBudgetChunks = 0;
  const fake = makeFakePlaywright({ responses: {
    [CANONICAL_URL]: { headers: { 'content-type': 'text/html' }, chunks: [Buffer.alloc(0)] },
    [css(1)]: { headers: { 'content-type': 'text/css' }, chunks: [Buffer.alloc(twoMiB), Buffer.alloc(1)] },
    [css(2)]: { headers: { 'content-type': 'text/css' }, chunks: [Buffer.alloc(twoMiB)] },
    [css(3)]: { headers: { 'content-type': 'text/css' }, chunks: [Buffer.alloc(twoMiB)] },
    [css(4)]: { headers: { 'content-type': 'text/css' }, chunks: [Buffer.alloc(twoMiB)] },
    [css(5)]: {
      headers: { 'content-type': 'text/css' },
      chunks: [Buffer.alloc(1)],
      onChunk: () => { postBudgetChunks += 1; },
    },
  } });
  const handler = await startRoutedCapture(fake);

  assert.equal(await invokeRoute(handler, css(1), 'stylesheet', { calls: fake.calls }), 'abort');
  assert.equal(await invokeRoute(handler, css(2), 'stylesheet', { calls: fake.calls }), 'fulfill');
  assert.equal(await invokeRoute(handler, css(3), 'stylesheet', { calls: fake.calls }), 'fulfill');
  assert.equal(await invokeRoute(handler, css(4), 'stylesheet', { calls: fake.calls }), 'abort');
  assert.equal(await invokeRoute(handler, css(5), 'stylesheet', { calls: fake.calls }), 'abort');
  assert.equal(postBudgetChunks, 0, '总预算耗尽后不得再从响应 body 读取 chunk');
}

async function testFulfillFailureDoesNotAttemptAbort() {
  const projectDir = await createTestDir('fulfill-failure');
  const fulfillError = new Error(`fulfill failed ${projectDir} cookie=secret`);
  const fake = makeFakePlaywright({ fulfillError });
  const result = await pageCaptureAssets.captureGithubRepositoryPage({
    sourceMaterial: githubSource(),
    projectDir,
    deps: fake.deps,
  });

  assert.deepEqual(fake.calls.routeTerminalAttempts, [{ url: CANONICAL_URL, action: 'fulfill' }]);
  assert.equal(fake.calls.gotoErrors[0], fulfillError, 'fulfill 原错误必须传播到导航失败边界');
  assert.deepEqual(result, {
    status: 'empty',
    assets: [],
    diagnostics: [{
      code: 'page_capture_failed',
      message: 'GitHub 仓库页面截图失败，已保留其他视觉素材。',
      details: { category: 'navigation_failed' },
    }],
  });
  assert.equal(fake.calls.pageClosed, true);
  assert.equal(fake.calls.contextClosed, true);
  assert.equal(fake.calls.browserClosed, true);
}

async function testNetworkTimeoutDestroysRequestAndAbortsOnce() {
  const url = 'https://github.githubassets.com/assets/timeout.css';
  const fake = makeFakePlaywright({ responses: { [url]: { timeout: true } } });
  const handler = await startRoutedCapture(fake);
  assert.equal(await invokeRoute(handler, url, 'stylesheet', { calls: fake.calls }), 'abort');
  assert.equal(fake.calls.destroyedRequests.at(-1).url, url);
}

async function testRejectsFirstHopRedirectBeforeBrowserRequestsNextHop() {
  const projectDir = await createTestDir('redirect');
  const redirectUrl = 'https://github.com/login';
  const fake = makeFakePlaywright({ redirects: { [CANONICAL_URL]: redirectUrl } });
  const result = await pageCaptureAssets.captureGithubRepositoryPage({
    sourceMaterial: githubSource(),
    projectDir,
    deps: fake.deps,
  });
  assert.deepEqual(fake.calls.routedDocuments, [CANONICAL_URL]);
  assert.deepEqual(fake.calls.networkRequests, [CANONICAL_URL]);
  assert.ok(!fake.calls.networkRequests.includes(redirectUrl));
  assert.equal(result.diagnostics[0].details.category, 'navigation_failed');
  assert.equal(fake.calls.pageClosed, true);
  assert.equal(fake.calls.contextClosed, true);
  assert.equal(fake.calls.browserClosed, true);
}

async function testRejectsStaticRedirectsBeforeBrowserRequestsNextHop() {
  for (const resourceType of ['stylesheet']) {
    const url = `https://github.githubassets.com/assets/file.${resourceType}`;
    const redirectUrl = `https://evil.example/${resourceType}`;
    const fake = makeFakePlaywright({ redirects: { [url]: redirectUrl } });
    await pageCaptureAssets.captureGithubRepositoryPage({
      sourceMaterial: githubSource(),
      projectDir: await createTestDir('static-redirect'),
      deps: fake.deps,
    });
    fake.calls.networkRequests.length = 0;
    assert.equal(await invokeRoute(fake.calls.routeHandler, url, resourceType, { calls: fake.calls }), 'abort');
    assert.deepEqual(fake.calls.networkRequests, [url]);
    assert.ok(!fake.calls.networkRequests.includes(redirectUrl));
  }
}

async function testNonGithubAndInvalidMetadataDoNotStartPlaywright() {
  let imports = 0;
  const deps = { importPlaywright: async () => { imports += 1; throw new Error('不应启动'); } };
  for (const sourceMaterial of [
    githubSource({ kind: 'article' }),
    githubSource({ metadata: {} }),
    githubSource({ metadata: { owner: '../local', repo: 'codex' } }),
    githubSource({ metadata: { owner: 'openai', repo: 'codex/../../local' } }),
  ]) {
    const result = await pageCaptureAssets.captureGithubRepositoryPage({ sourceMaterial, projectDir: os.tmpdir(), deps });
    assert.deepEqual(result.assets, []);
    assert.deepEqual(result.diagnostics, []);
  }
  assert.equal(imports, 0);
}

async function testFailuresReturnSafeDiagnosticWithoutAssetsOrFiles() {
  const cases = [
    ['navigation_failed', makeFakePlaywright({ status: 404 }), {}],
    ['navigation_failed', makeFakePlaywright({ status: 304 }), {}],
    ['navigation_failed', makeFakePlaywright({ redirects: { [CANONICAL_URL]: 'https://github.com/login' } }), {}],
    ['navigation_failed', makeFakePlaywright({ gotoError: new Error(`timeout ${os.tmpdir()} cookie=secret`) }), {}],
    ['capture_invalid', makeFakePlaywright({ screenshot: Buffer.alloc(0) }), {}],
    ['capture_invalid', makeFakePlaywright({ screenshot: Buffer.alloc(8 * 1024 * 1024 + 1) }), {}],
    ['write_failed', makeFakePlaywright(), { renameFile: async () => { throw new Error(`EPERM ${os.tmpdir()}`); } }],
  ];
  for (const [category, fake, extraDeps] of cases) {
    const projectDir = await createTestDir(category);
    const result = await pageCaptureAssets.captureGithubRepositoryPage({
      sourceMaterial: githubSource(),
      projectDir,
      deps: { ...fake.deps, ...extraDeps },
    });
    assert.deepEqual(result.assets, []);
    assert.equal(result.diagnostics.length, 1);
    assert.deepEqual(result.diagnostics[0], {
      code: 'page_capture_failed',
      message: 'GitHub 仓库页面截图失败，已保留其他视觉素材。',
      details: { category },
    });
    const serialized = JSON.stringify(result.diagnostics);
    assert.ok(!serialized.includes(projectDir));
    assert.ok(!/cookie|stack|secret/i.test(serialized));
    const files = fs.existsSync(path.join(projectDir, 'assets'))
      ? await fsp.readdir(path.join(projectDir, 'assets'))
      : [];
    assert.deepEqual(files, []);
    assert.equal(fake.calls.pageClosed, true);
    assert.equal(fake.calls.contextClosed, true);
    assert.equal(fake.calls.browserClosed, true);
  }

  const projectDir = await createTestDir('runtime');
  const missingRuntime = await pageCaptureAssets.captureGithubRepositoryPage({
    sourceMaterial: githubSource(),
    projectDir,
    deps: { importPlaywright: async () => { throw new Error(`missing ${projectDir}`); } },
  });
  assert.deepEqual(missingRuntime.assets, []);
  assert.deepEqual(missingRuntime.diagnostics[0], {
    code: 'page_capture_failed',
    message: 'GitHub 仓库页面截图失败，已保留其他视觉素材。',
    details: { category: 'runtime_unavailable' },
  });
}

async function testScreenshotBufferReuseAndUint8Fallback() {
  const projectDir = await createTestDir('buffer');
  let written = null;
  const fake = makeFakePlaywright({ screenshot: CAPTURE_BYTES });
  await pageCaptureAssets.captureGithubRepositoryPage({
    sourceMaterial: githubSource(),
    projectDir,
    deps: {
      ...fake.deps,
      writeFileAtomic: async (filePath, bytes) => {
        written = bytes;
        await fsp.writeFile(filePath, bytes);
      },
    },
  });
  assert.equal(written, CAPTURE_BYTES, 'Playwright 已返回 Buffer 时不得再复制');

  const uint8 = new Uint8Array([1, 2, 3, 4]);
  const fallback = makeFakePlaywright({ screenshot: uint8 });
  await pageCaptureAssets.captureGithubRepositoryPage({
    sourceMaterial: githubSource(),
    projectDir,
    deps: {
      ...fallback.deps,
      writeFileAtomic: async (filePath, bytes) => {
        written = bytes;
        await fsp.writeFile(filePath, bytes);
      },
    },
  });
  assert.equal(Buffer.isBuffer(written), true);
  assert.deepEqual(written, Buffer.from(uint8));
}

async function testDefaultWriterCleansTempAfterRenameFailure() {
  const projectDir = await createTestDir('rename-failure');
  const fake = makeFakePlaywright();
  const result = await pageCaptureAssets.captureGithubRepositoryPage({
    sourceMaterial: githubSource(),
    projectDir,
    deps: {
      ...fake.deps,
      renameFile: async () => { throw new Error('rename failed'); },
    },
  });
  assert.equal(result.diagnostics[0].details.category, 'write_failed');
  assert.deepEqual(await fsp.readdir(path.join(projectDir, 'assets')), []);
}

async function testRejectsEscapingAssetLink() {
  const root = await createTestDir('link');
  const projectDir = path.join(root, 'project');
  const outsideDir = path.join(root, 'outside');
  const linkPath = path.join(projectDir, 'assets');
  await Promise.all([
    fsp.mkdir(projectDir),
    fsp.mkdir(outsideDir),
  ]);
  let linked = false;
  try {
    await fsp.symlink(outsideDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    linked = true;
  } catch (error) {
    console.log(`page capture asset link test skipped: ${error.code || error.message}`);
    return;
  }
  try {
    for (const target of [projectDir, outsideDir, linkPath]) {
      const relative = path.relative(root, target);
      assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), '清理目标必须位于测试临时目录内');
    }
    const fake = makeFakePlaywright();
    const result = await pageCaptureAssets.captureGithubRepositoryPage({
      sourceMaterial: githubSource(),
      projectDir,
      deps: fake.deps,
    });
    assert.equal(result.diagnostics[0].details.category, 'write_failed');
    assert.deepEqual(await fsp.readdir(outsideDir), []);
  } finally {
    if (linked) await fsp.unlink(linkPath).catch(() => {});
    await fsp.rm(root, { recursive: true, force: true });
  }
}

function visualAsset(id, origin, extra = {}) {
  const profiles = {
    user_upload: { evidence_class: 'user_supplied', requirement: 'preferred' },
    source_extract: { evidence_class: 'direct_source', requirement: 'optional' },
    stock_search: { evidence_class: 'contextual', requirement: 'optional' },
  };
  return {
    id,
    origin,
    media_type: 'image',
    status: 'ready',
    path: `assets/${id}.png`,
    ...profiles[origin],
    ...extra,
  };
}

async function testSourcePrepMergesCaptureBeforeAnalysisAndDedupesRetry() {
  const mediaRoot = await createTestDir('source-prep');
  const fake = makeFakePlaywright();
  const analyzedOrigins = [];
  const record = {
    aweme_id: '202607160000000001',
    input: { mode: 'source_url', source_url: CANONICAL_URL },
    creative_context: {
      input: { mode: 'source_url', source_url: CANONICAL_URL },
      source_context: {
        source_kind: 'github_repo',
        source_url: CANONICAL_URL,
        title: 'openai/codex',
        transcript: '# openai/codex',
        source_metadata: { kind: 'github_repo', owner: 'openai', repo: 'codex' },
      },
      asset_context: {
        status: 'ready',
        assets: [visualAsset('upload_01', 'user_upload')],
        diagnostics: [{ code: 'upload_kept', message: '上传素材已保留。' }],
      },
    },
  };
  const services = {
    sourceAssets: {
      prepareSourceAssets: async () => ({
        status: 'ready',
        assets: [
          visualAsset('readme_01', 'source_extract', { origin_detail: 'github_readme' }),
          visualAsset('pexels_01', 'stock_search', { origin_detail: 'pexels', provider: 'pexels' }),
        ],
        diagnostics: [{ code: 'pexels_kept', message: 'Pexels 素材已保留。' }],
      }),
    },
    pageCaptureAssets: {
      captureGithubRepositoryPage: input => pageCaptureAssets.captureGithubRepositoryPage({
        ...input,
        deps: fake.deps,
      }),
    },
    sourceImageAnalysis: {
      analyzeSourceImageAssets: async ({ assets }) => {
        analyzedOrigins.push(assets.map(asset => asset.origin));
        return { status: 'disabled', summary: '未启用分析。', assets };
      },
    },
  };

  await creativeSourcePrep.prepareSourceAssetContext(record, mediaRoot, '2026-07-16T00:00:00.000Z', services);
  await creativeSourcePrep.prepareSourceAssetContext(record, mediaRoot, '2026-07-16T00:00:01.000Z', services);

  const ids = record.asset_context.assets.map(asset => asset.id);
  assert.deepEqual(ids.slice(0, 3), ['upload_01', 'readme_01', 'pexels_01']);
  assert.equal(record.asset_context.assets.filter(asset => asset.origin === 'page_capture').length, 1);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(record.asset_context.diagnostics, [
    { code: 'upload_kept', message: '上传素材已保留。' },
    { code: 'pexels_kept', message: 'Pexels 素材已保留。' },
  ]);
  assert.ok(analyzedOrigins.every(origins => origins.includes('page_capture')));
}

async function testSourcePrepKeepsAssetsWhenCaptureFails() {
  const mediaRoot = await createTestDir('source-prep-failure');
  const record = {
    aweme_id: '202607160000000002',
    creative_context: {
      input: { mode: 'source_url', source_url: CANONICAL_URL },
      source_context: {
        source_kind: 'github_repo',
        source_url: CANONICAL_URL,
        title: 'openai/codex',
        transcript: '# openai/codex',
        source_metadata: { kind: 'github_repo', owner: 'openai', repo: 'codex' },
      },
      asset_context: { status: 'ready', assets: [visualAsset('upload_01', 'user_upload')], diagnostics: [] },
    },
  };
  await creativeSourcePrep.prepareSourceAssetContext(record, mediaRoot, '', {
    sourceAssets: { prepareSourceAssets: async () => ({ status: 'empty', assets: [], diagnostics: [] }) },
    pageCaptureAssets: {
      captureGithubRepositoryPage: async () => ({
        status: 'empty',
        assets: [],
        diagnostics: [{
          code: 'page_capture_failed',
          message: 'GitHub 仓库页面截图失败，已保留其他视觉素材。',
          details: { category: 'navigation_failed' },
        }],
      }),
    },
    sourceImageAnalysis: {
      analyzeSourceImageAssets: async ({ assets }) => ({ status: 'disabled', assets }),
    },
  });
  assert.deepEqual(record.asset_context.assets.map(asset => asset.id), ['upload_01']);
  assert.equal(record.asset_context.status, 'ready');
  assert.equal(record.asset_context.diagnostics[0].code, 'page_capture_failed');
}

function sourcePrepRecord(awemeId) {
  return {
    aweme_id: awemeId,
    creative_context: {
      input: { mode: 'source_url', source_url: CANONICAL_URL },
      source_context: {
        source_kind: 'github_repo',
        source_url: CANONICAL_URL,
        title: 'openai/codex',
        transcript: '# openai/codex',
        source_metadata: { kind: 'github_repo', owner: 'openai', repo: 'codex' },
      },
      asset_context: {
        status: 'ready',
        assets: [visualAsset('upload_01', 'user_upload')],
        diagnostics: [{ code: 'existing_kept', message: '既有素材保留。' }],
      },
    },
  };
}

function sourcePrepServices(pageCaptureService, analyzedIds) {
  return {
    sourceAssets: {
      prepareSourceAssets: async () => ({
        status: 'ready',
        assets: [visualAsset('readme_01', 'source_extract', { origin_detail: 'github_readme' })],
        diagnostics: [{ code: 'source_kept', message: '来源素材保留。' }],
      }),
    },
    pageCaptureAssets: pageCaptureService,
    sourceImageAnalysis: {
      analyzeSourceImageAssets: async ({ assets }) => {
        analyzedIds.push(assets.map(asset => asset.id));
        return { status: 'disabled', assets };
      },
    },
  };
}

async function testSourcePrepCatchesAllCaptureServiceFailures() {
  const mediaRoot = await createTestDir('service-failures');
  const services = [
    { captureGithubRepositoryPage() { throw new Error('sync local path'); } },
    { captureGithubRepositoryPage: async () => { throw new Error('rejected secret'); } },
    {},
    { captureGithubRepositoryPage: () => null },
  ];
  for (let index = 0; index < services.length; index += 1) {
    const analyzedIds = [];
    const record = sourcePrepRecord(`20260716000000001${index}`);
    await creativeSourcePrep.prepareSourceAssetContext(
      record,
      mediaRoot,
      '',
      sourcePrepServices(services[index], analyzedIds),
    );
    assert.deepEqual(record.asset_context.assets.map(asset => asset.id), ['upload_01', 'readme_01']);
    assert.deepEqual(analyzedIds, [['upload_01', 'readme_01']]);
    assert.deepEqual(record.asset_context.diagnostics, [
      { code: 'existing_kept', message: '既有素材保留。' },
      { code: 'source_kept', message: '来源素材保留。' },
      {
        code: 'page_capture_failed',
        message: 'GitHub 仓库页面截图失败，已保留其他视觉素材。',
        details: { category: 'capture_service_failed' },
      },
    ]);
  }
}

async function testSourcePrepAcceptsNonPromiseCaptureContext() {
  const mediaRoot = await createTestDir('service-non-promise');
  const analyzedIds = [];
  const record = sourcePrepRecord('202607160000000020');
  const pageAsset = {
    id: 'page_capture_01',
    media_type: 'image',
    origin: 'page_capture',
    origin_detail: 'github_repository_page',
    provider: 'chromium',
    requirement: 'optional',
    evidence_class: 'direct_source',
    status: 'ready',
    path: 'assets/github-page.png',
  };
  await creativeSourcePrep.prepareSourceAssetContext(record, mediaRoot, '', sourcePrepServices({
    captureGithubRepositoryPage: () => ({ status: 'ready', assets: [pageAsset], diagnostics: [] }),
  }, analyzedIds));
  assert.deepEqual(record.asset_context.assets.map(asset => asset.id), ['upload_01', 'readme_01', 'page_capture_01']);
  assert.deepEqual(analyzedIds, [['upload_01', 'readme_01', 'page_capture_01']]);
}

(async () => {
  suiteRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'page-capture-suite-'));
  try {
    await testCapturesCanonicalGithubRepositoryPage();
    await testCollectsBoundedVisibleDomEvidenceBeforeScreenshot();
    await testEvaluateFailureKeepsCaptureReadyWithSafeDiagnostic();
    await testRequestInterceptionAllowsOnlyExpectedGithubResources();
    await testBoundedNetworkBodiesAndHeaders();
    await testOverflowChunksConsumePageBudgetImmediately();
    await testFulfillFailureDoesNotAttemptAbort();
    await testNetworkTimeoutDestroysRequestAndAbortsOnce();
    await testRejectsFirstHopRedirectBeforeBrowserRequestsNextHop();
    await testRejectsStaticRedirectsBeforeBrowserRequestsNextHop();
    await testNonGithubAndInvalidMetadataDoNotStartPlaywright();
    await testFailuresReturnSafeDiagnosticWithoutAssetsOrFiles();
    await testScreenshotBufferReuseAndUint8Fallback();
    await testDefaultWriterCleansTempAfterRenameFailure();
    await testRejectsEscapingAssetLink();
    await testSourcePrepMergesCaptureBeforeAnalysisAndDedupesRetry();
    await testSourcePrepKeepsAssetsWhenCaptureFails();
    await testSourcePrepCatchesAllCaptureServiceFailures();
    await testSourcePrepAcceptsNonPromiseCaptureContext();
  } finally {
    await cleanupSuiteRoot();
  }
  console.log('page capture assets tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
