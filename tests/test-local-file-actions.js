const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const express = require('express');
const { openLocalFile, assertLocalFileRequest, isLoopback, LocalFileError } = require('../server/services/localFiles');
const creativeRouter = require('../server/routes/creativeWorkflows');

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-local-file-'));
  let server;
  try {
    const file = path.join(root, "字幕 & ' 测试.srt");
    await fs.writeFile(file, '1\n00:00:00,100 --> 00:00:00,800\n本地字幕。\n', 'utf8');
    const canonical = await fs.realpath(file);
    const calls = [];
    const executeImpl = async (command, args, options) => { calls.push({ command, args, options }); };
    for (const target of ['file', 'folder']) {
      await openLocalFile(file, { platform: 'win32', target, executeImpl });
      const call = calls.at(-1);
      assert.equal(call.command, 'powershell.exe');
      assert.equal(call.options.windowsHide, true);
      const encoded = call.args.at(-1).match(/FromBase64String\('([^']+)'\)/)[1];
      assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), target === 'file' ? canonical : path.dirname(canonical));
      assert.ok(!call.args.at(-1).includes(file), '文件路径不能作为命令拼接');
    }
    for (const [platform, command] of [['darwin', 'open'], ['linux', 'xdg-open']]) {
      await openLocalFile(file, { platform, executeImpl });
      assert.equal(calls.at(-1).command, command);
      assert.deepEqual(calls.at(-1).args, [canonical]);
      await openLocalFile(file, { platform, target: 'folder', executeImpl });
      assert.deepEqual(calls.at(-1).args, [path.dirname(canonical)]);
    }
    await assert.rejects(openLocalFile(path.join(root, 'missing.srt'), { executeImpl }), error => error.status === 404);
    const executable = path.join(root, 'fixture.cmd');
    await fs.writeFile(executable, 'fixture');
    await assert.rejects(openLocalFile(executable, { executeImpl }), error => error.code === 'LOCAL_FILE_TYPE_UNSUPPORTED');
    await assert.rejects(openLocalFile(file, { executeImpl: async () => { throw new Error('private-command-detail'); } }),
      error => error.code === 'LOCAL_FILE_OPEN_FAILED' && !error.message.includes('private-command-detail'));

    for (const host of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1', 'localhost']) assert.equal(isLoopback(host), true);
    for (const host of ['192.168.1.2', 'example.invalid', 'localhost.example.invalid', '127.0.0.999']) assert.equal(isLoopback(host), false);
    const request = (headers = {}, remoteAddress = '127.0.0.1', body = { target: 'file' }) => ({
      socket: { remoteAddress }, body,
      get: name => ({ host: 'localhost:3000', origin: 'http://localhost:5173', ...headers }[name]),
      is: type => type === 'application/json',
    });
    assert.equal(assertLocalFileRequest(request()), 'file');
    for (const denied of [request({}, '192.168.1.5'), request({ host: 'example.invalid' }),
      request({ origin: 'https://example.invalid' }), request({ origin: 'null' }), request({ 'sec-fetch-site': 'cross-site' })]) {
      assert.throws(() => assertLocalFileRequest(denied), error => error.status === 403);
    }
    assert.throws(() => assertLocalFileRequest(request({}, '127.0.0.1', { target: 'file', path: '/arbitrary' })), error => error.status === 400);

    const clientSource = await fs.readFile(path.resolve('frontend-react/src/api/client.js'), 'utf8');
    const { api, resolveLocalFileUrl } = await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString('base64')}`);
    const fileUrl = '/api/transcriptions/example/files/correctedSrt';
    assert.equal(resolveLocalFileUrl(`${fileUrl}?download=1#preview`), fileUrl);
    assert.equal(resolveLocalFileUrl(`http://localhost${fileUrl}`), fileUrl);
    for (const url of [`https://example.invalid${fileUrl}`, 'file:///tmp/a.srt', '/api/config/maintenance/cleanup', '//example.invalid/a']) {
      assert.equal(resolveLocalFileUrl(url), '');
    }
    const nativeFetch = global.fetch;
    const requests = [];
    try {
      global.fetch = async (url, options) => {
        requests.push({ url, options });
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      };
      await api.openLocalFile(`${fileUrl}?download=1`, 'folder');
      assert.equal(requests[0].url, fileUrl);
      assert.equal(requests[0].options.method, 'POST');
      assert.deepEqual(JSON.parse(requests[0].options.body), { target: 'folder' });
      await assert.rejects(api.openLocalFile('/api/config/maintenance/cleanup'));
      assert.equal(requests.length, 1);
    } finally { global.fetch = nativeFetch; }

    const opened = [];
    const resolved = [];
    const app = express();
    app.use(express.json());
    app.locals.localFileOpener = async (filePath, options) => { opened.push({ filePath, ...options }); };
    const resolve = async (kind, id, reference) => {
      resolved.push({ kind, id, reference });
      return reference === 'missing' ? { success: false, statusCode: 404, message: '文件不存在。' }
        : reference === 'changed' ? { success: false, statusCode: 409, message: '文件已变化。' }
          : { success: true, file_path: file };
    };
    app.locals.creativeWorkflows = {
      getWhiteboardMediaFile: (id, reference) => resolve('whiteboard', id, reference),
      getHtmlVideoProjectExportFile: (id, reference) => resolve('export', id, reference),
      getHtmlVideoProjectFile: (id, reference) => resolve('project', id, reference),
    };
    app.use('/api/creative-workflows', creativeRouter);
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}/api/creative-workflows`;
    const post = (url, body = { target: 'file' }, headers = {}) => fetch(base + url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    for (const [url, kind, reference] of [
      ['/123456/whiteboard/media/asset-1', 'whiteboard', 'asset-1'],
      ['/123456/html-video-project/exports/export-1/file', 'export', 'export-1'],
      ['/123456/html-video-project/files/exports/output.mp4', 'project', 'exports/output.mp4'],
    ]) {
      const response = await post(url);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).success, true);
      assert.deepEqual(resolved.at(-1), { kind, id: '123456', reference });
      assert.deepEqual(opened.at(-1), { filePath: file, target: 'file' });
    }
    assert.equal((await post('/123456/whiteboard/media/asset-1', { target: 'folder' })).status, 200);
    assert.equal(opened.at(-1).target, 'folder');
    const count = opened.length;
    const resolvedCount = resolved.length;
    assert.equal((await post('/123456/whiteboard/media/asset-1', { target: 'file' }, { Origin: 'https://example.invalid' })).status, 403);
    assert.equal(resolved.length, resolvedCount, '非本机来源应在读取文件之前被拒绝');
    assert.equal((await post('/123456/whiteboard/media/missing')).status, 404);
    assert.equal((await post('/123456/whiteboard/media/changed')).status, 409);
    assert.equal((await post('/invalid/whiteboard/media/asset-1')).status, 400);
    assert.equal((await post('/123456/whiteboard/media/asset-1', { target: 'file', path: file })).status, 400);
    assert.equal(opened.length, count, '无效请求和缺失或变化的文件不能触发系统打开');
    app.locals.localFileOpener = async () => { throw new LocalFileError('LOCAL_FILE_OPEN_FAILED', '测试：无法打开默认应用。', 500); };
    const failure = await post('/123456/whiteboard/media/asset-1');
    assert.equal(failure.status, 500);
    assert.equal((await failure.json()).message, '测试：无法打开默认应用。');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().then(() => console.log('本地文件操作测试通过：平台参数、路径编码、可信来源、产物解析、文件夹与失败反馈。'))
  .catch(error => { console.error(error); process.exitCode = 1; });
