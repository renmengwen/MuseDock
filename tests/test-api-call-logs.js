const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');
const express = require('express');
const { createApiCallStore } = require('../server/services/diagnostics/apiCallStore');
const { recordedFetch, runWithApiCallContext, apiCallContextMiddleware, flushApiCallRecords, getApiCallStorageWarning } = require('../server/services/diagnostics/apiCallRecorder');
const { callTextModel } = require('../server/services/ai/aiTextModel');
const workflows = require('../server/services/creative/creativeWorkflows');
const apiCallLogsRouter = require('../server/routes/apiCallLogs');
const { redactBody } = require('../server/services/diagnostics/apiCallRedaction');

const TEXT_CONFIG = { enabled: true, provider: 'fixture', apiKey: 'fixture-secret-key-only',
  baseUrl: 'https://api.example.invalid/v1', modelId: 'fixture-text', protocol: 'openai-responses' };
const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', ...headers },
});

async function seedWhiteboardCalls(store, rootDir) {
  let sequence = 0;
  let providerCalls = 0;
  let malformed = true;
  const options = { rootDir, mediaRoot: path.join(rootDir, 'media'), services: {
    idFactory: () => `20260916120000${String(++sequence).padStart(6, '0')}`,
    aiModelConfig: { getRuntimeConfig: async type => type === 'tts' ? null : TEXT_CONFIG },
    fetchImpl: async () => {
      providerCalls += 1;
      return jsonResponse({ output_text: malformed ? `不是 JSON 的模型返回，第 ${providerCalls} 次。\n末尾诊断内容。` : JSON.stringify({
        schemaVersion: 1, title: '成功方案与返回记录', summary: '说明如何把大任务拆成一个具体的小动作。',
        cues: [{ id: 'cue_1', text: '面对复杂任务时，我们常常先寻找更容易的事情。把任务拆成一个今天就能完成的小动作，开始就会变得具体。' }],
        scenes: [{ id: 'scene_1', title: '开始行动', cueIds: ['cue_1'], imagePrompt: '暖米黄纸张上，一个人把大纸张拆成三张小纸条，粗黑轮廓和少量平涂，主体分离，四周留白。' }],
      }) });
    },
  } };
  const payload = { creationModeId: 'whiteboard-stream-v1', input: { inputMode: 'topic', content: '如何开始一个小任务',
    rewritePolicy: 'generate', targetDurationSeconds: 60, narrationLanguage: 'zh-CN', visualStylePreset: 'warm-paper-minimal-v1' } };
  const failed = await workflows.createCreativeWorkflow(payload, options);
  const failedResult = await runWithApiCallContext({ store }, () => workflows.runCreativeWorkflow(failed.workflow_id, options));
  assert.equal(failedResult.code, 'CANDIDATE_INVALID');
  malformed = false;
  const successful = await workflows.createCreativeWorkflow(payload, options);
  const successfulResult = await runWithApiCallContext({ store }, () => workflows.runCreativeWorkflow(successful.workflow_id, options));
  assert.equal(successfulResult.success, true);
  assert.equal(successfulResult.status, 'waiting_approval');
  await flushApiCallRecords();
  return { failedId: failed.workflow_id, successfulId: successful.workflow_id, options, providerCalls: () => providerCalls };
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-api-call-test-'));
  const directory = path.join(root, 'logs');
  let store = createApiCallStore({ directory });
  let server;
  let passed = 0;
  const pass = title => { passed += 1; console.log(`PASS ${title}`); };
  try {
    const payload = { output_text: '成功返回，保留全部正文。', nested: { api_key: 'another-secret', Cookie: 'session=provider-session',
      plain: `回显 ${TEXT_CONFIG.apiKey}`, url: 'https://user:password@example.invalid/asset?signature=download-secret&expires=123' } };
    let callCount = 0;
    const original = await runWithApiCallContext({ store, workflowId: 'success-task' }, () => recordedFetch(async () => {
      callCount += 1;
      return jsonResponse(payload, 200, { 'set-cookie': 'session=header-secret', 'x-request-id': 'fixture-request-id' });
    }, { category: 'text' })('https://api.example.invalid/v1/responses?api_key=url-secret', {
      method: 'POST', headers: { Authorization: `Bearer ${TEXT_CONFIG.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'fixture-model', instructions: `只返回 JSON。${TEXT_CONFIG.apiKey}`,
        input: [{ role: 'user', content: '请生成方案' }], api_key: 'request-body-secret',
        link: 'https://example.invalid/a?signature=request-signature' }),
    }));
    assert.deepEqual(await original.json(), payload, '日志不能改变交给业务代码的原始 Response');
    await flushApiCallRecords();
    assert.equal(callCount, 1, '读取与保存返回不能发起第二次请求');
    const first = store.get(store.list({ workflowId: 'success-task' }).records[0].id);
    assert.equal(first.state, 'success');
    assert.equal(first.model, 'fixture-model');
    assert.equal(first.request_body_status, 'captured');
    assert.equal(JSON.parse(first.request_body_text).input[0].content, '请生成方案');
    assert.equal(JSON.parse(first.request_body_text).api_key, '[已隐藏]');
    assert.equal(store.list({ workflowId: 'success-task' }).records[0].request_body_text, undefined, '列表不加载请求体');
    assert.match(first.body_text, /成功返回，保留全部正文/);
    assert.doesNotMatch(JSON.stringify(first), /fixture-secret-key-only|request-body-secret|request-signature|another-secret|provider-session|download-secret|header-secret|url-secret|user:password/);
    assert.equal(first.response_headers['x-request-id'], 'fixture-request-id');
    assert.equal(first.response_headers['set-cookie'], '[已隐藏]');
    pass('成功返回和请求入参保存，业务响应不变，正文/响应头/签名链接脱敏');

    const longRequest = JSON.stringify({ model: 'fixture-model', input: '长'.repeat(750000) });
    const longResult = await runWithApiCallContext({ store, workflowId: 'long-request' }, () => recordedFetch(async () => jsonResponse({ ok: true }))(
      'https://example.invalid/responses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: longRequest }));
    await longResult.text();
    await flushApiCallRecords();
    const longLog = store.get(store.list({ workflowId: 'long-request' }).records[0].id);
    assert.equal(longLog.request_bytes, Buffer.byteLength(longRequest));
    assert.equal(longLog.request_body_truncated, 1);
    assert.ok(Buffer.byteLength(longLog.request_body_text) <= 2 * 1024 * 1024);
    const binaryRequest = Buffer.from([0, 1, 2, 3]);
    await runWithApiCallContext({ store, workflowId: 'binary-request' }, () => recordedFetch(async () => jsonResponse({ ok: true }))(
      'https://example.invalid/audio', { method: 'POST', body: binaryRequest }));
    await flushApiCallRecords();
    const binaryRequestLog = store.get(store.list({ workflowId: 'binary-request' }).records[0].id);
    assert.equal(binaryRequestLog.request_body_status, 'omitted');
    assert.equal(binaryRequestLog.request_body_text, '');
    pass('请求体限额与二进制请求体跳过');

    const longHtml = `<!doctype html><pre>${'错误详情。'.repeat(2000)}\nAPI_KEY=${TEXT_CONFIG.apiKey}\n尾部定位信息</pre>`;
    const denied = await runWithApiCallContext({ store, workflowId: 'http-error' }, () => callTextModel({ textConfig: TEXT_CONFIG,
      messages: [{ role: 'user', content: '返回测试' }], maxRetries: 0,
      fetchImpl: async () => new Response(longHtml, { status: 401, headers: { 'content-type': 'text/html' } }),
    }));
    assert.equal(denied.success, false);
    await flushApiCallRecords();
    const deniedLog = store.get(denied.api_call_ids[0]);
    assert.equal(deniedLog.http_status, 401);
    assert.equal(deniedLog.state, 'error');
    assert.match(deniedLog.body_text, /尾部定位信息/);
    assert.ok(deniedLog.body_text.length > 500);
    assert.doesNotMatch(JSON.stringify(deniedLog), /fixture-secret-key-only/);
    pass('非 JSON 的 HTTP 错误保留超过 500 字的正文');

    const malformedWithSecrets = '{"debug":{"refreshToken":"unknown-refresh-secret","apiKey":"unknown-api-secret"},"message":"secret=unknown-inline-secret"';
    const redactedMalformed = redactBody(malformedWithSecrets, 'application/json');
    assert.doesNotMatch(redactedMalformed, /unknown-refresh-secret|unknown-api-secret|unknown-inline-secret/);
    assert.match(redactedMalformed, /refreshToken/);
    assert.match(redactedMalformed, /已隐藏/);
    pass('不规范 JSON 中嵌套或夹在错误文案里的敏感字段同样脱敏');

    const exactJson = '{ "aweme_id":7123456789012345678, "ratio":1.2300e+4, "negative_zero":-0, "message":"原始返回" }';
    assert.equal(redactBody(exactJson, 'application/json'), exactJson);
    const exactSse = `data: ${exactJson}\r\n\r\ndata: [DONE]\r\n\r\n`;
    assert.equal(redactBody(exactSse, 'text/event-stream'), exactSse);
    const escapedKey = '{"\\u0061pi_key":{"nested":["credential-object"]},"id":7123456789012345678}';
    const escapedRedaction = redactBody(escapedKey, 'application/json');
    assert.doesNotMatch(escapedRedaction, /credential-object/);
    assert.match(escapedRedaction, /7123456789012345678/);
    assert.equal(JSON.parse(escapedRedaction).api_key, '[已隐藏]');
    pass('JSON 与 SSE 保留长数字 ID、数值写法和换行，转义敏感字段仍脱敏');

    let retryCount = 0;
    const retried = await runWithApiCallContext({ store, workflowId: 'retry-task' }, () => callTextModel({ textConfig: TEXT_CONFIG,
      messages: [{ role: 'user', content: '返回测试' }], maxRetries: 1, retryDelayMs: 0,
      fetchImpl: async () => ++retryCount === 1 ? jsonResponse({ error: { message: '临时网关错误' } }, 503) : jsonResponse({ output_text: '重试成功' }),
    }));
    assert.equal(retried.success, true);
    assert.equal(retryCount, 2);
    await flushApiCallRecords();
    const retryLogs = store.list({ workflowId: 'retry-task' }).records;
    assert.equal(retryLogs.length, 2);
    assert.equal(retryLogs[0].state, 'success');
    assert.equal(retryLogs[1].state, 'error');
    pass('自动重试逐次留存，后一次成功不覆盖前一次失败');

    const seeded = await seedWhiteboardCalls(store, path.join(root, 'workflows'));
    const draftLogs = store.list({ workflowId: seeded.failedId }).records;
    assert.equal(draftLogs.length, 2);
    assert.deepEqual(draftLogs.map(record => record.context.repair), [1, 0]);
    assert.ok(draftLogs.every(record => record.state === 'invalid'));
    assert.ok(draftLogs.every(record => record.validation.some(message => /JSON/.test(message))));
    assert.equal(new Set(draftLogs.map(record => record.context.attemptId)).size, 1);
    for (const log of draftLogs) assert.match(store.get(log.id).body_text, /末尾诊断内容/);
    assert.equal(store.list({ workflowId: seeded.successfulId }).records[0].state, 'success');
    assert.equal(seeded.providerCalls(), 3);
    pass('真实白板流程：首次无效 JSON 与补正分别记录，成功方案同样可查');

    const sse = `data: ${JSON.stringify({ delta: '流式中文内容', api_key: 'sse-secret' })}\n\ndata: [DONE]\n\n`;
    const stream = await runWithApiCallContext({ store, workflowId: 'stream-task' }, () => recordedFetch(async () => new Response(sse, {
      headers: { 'content-type': 'text/event-stream' },
    }))('https://api.example.invalid/stream'));
    assert.equal(await stream.text(), sse);
    await flushApiCallRecords();
    const streamLog = store.get(store.list({ workflowId: 'stream-task' }).records[0].id);
    assert.match(streamLog.body_text, /流式中文内容/);
    assert.match(streamLog.body_text, /\[DONE\]/);
    assert.doesNotMatch(streamLog.body_text, /sse-secret/);
    let streamController;
    const partial = await runWithApiCallContext({ store, workflowId: 'partial-task' }, () => recordedFetch(async () => new Response(new ReadableStream({
      start(controller) { streamController = controller; controller.enqueue(new TextEncoder().encode('data: {"delta":"已收到的部分"}\n\n')); },
    }), { headers: { 'content-type': 'text/event-stream' } }))('https://api.example.invalid/stream'));
    const reader = partial.body.getReader();
    await reader.read();
    await new Promise(resolve => setTimeout(resolve, 20));
    streamController.error(new Error('fixture connection interrupted'));
    await assert.rejects(reader.read(), /interrupted/);
    reader.releaseLock();
    await flushApiCallRecords();
    const partialLog = store.get(store.list({ workflowId: 'partial-task' }).records[0].id);
    assert.equal(partialLog.transport_status, 'incomplete');
    assert.match(partialLog.body_text, /已收到的部分/);
    assert.equal(partialLog.state, 'error');
    pass('流式返回保持可读，中断时保留部分正文并标明不完整');

    for (const cancelReader of [false, true]) {
      let sourceCancelled = 0;
      const cancelWorkflow = cancelReader ? 'reader-cancel-task' : 'body-cancel-task';
      const cancellable = await runWithApiCallContext({ store, workflowId: cancelWorkflow }, () => recordedFetch(async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('已收到的取消前内容')); },
        cancel() { sourceCancelled += 1; },
      }), { headers: { 'content-type': 'text/plain' } }))('https://api.example.invalid/stream'));
      const target = cancelReader ? cancellable.body.getReader() : cancellable.body;
      if (cancelReader) await target.read();
      let timer;
      try {
        await Promise.race([target.cancel('fixture stop'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('诊断副本阻塞了业务取消')), 300); })]);
      } finally { clearTimeout(timer); if (cancelReader) target.releaseLock(); }
      assert.equal(sourceCancelled, 1);
      await flushApiCallRecords();
      assert.equal(store.list({ workflowId: cancelWorkflow }).records[0].transport_status, 'incomplete');
    }
    const clonable = await runWithApiCallContext({ store, workflowId: 'clone-task' }, () => recordedFetch(async () => new Response('仍可克隆和重复读取不同副本'))('https://example.invalid/text'));
    const secondCopy = clonable.clone();
    assert.equal(clonable.bodyUsed, false);
    assert.deepEqual(await Promise.all([clonable.text(), secondCopy.text()]), ['仍可克隆和重复读取不同副本', '仍可克隆和重复读取不同副本']);
    assert.equal(clonable.bodyUsed, true);
    await flushApiCallRecords();
    pass('响应 body/reader 取消均及时传递到底层，clone 与 bodyUsed 行为保持正常');

    const image = Buffer.from([137, 80, 78, 71, 0, 1, 2, 255]);
    const binary = await runWithApiCallContext({ store, workflowId: 'binary-task' }, () => recordedFetch(async () => new Response(image, {
      headers: { 'content-type': 'image/png' },
    }), { category: 'download' })('https://example.invalid/image.png'));
    assert.deepEqual(Buffer.from(await binary.arrayBuffer()), image);
    await flushApiCallRecords();
    const binaryLog = store.get(store.list({ workflowId: 'binary-task' }).records[0].id);
    assert.equal(binaryLog.body_encoding, 'base64');
    assert.deepEqual(Buffer.from(binaryLog.body_text, 'base64'), image);

    for (const prefix of ['', '\u0000\u0001']) {
      const wire = Buffer.from(`${prefix}{"message":"echo ${TEXT_CONFIG.apiKey}","token":"mislabelled-secret"}`);
      const mislabeled = await runWithApiCallContext({ store, workflowId: `mime-task-${prefix.length}` }, () => recordedFetch(async () => new Response(wire, {
        headers: { 'content-type': 'application/octet-stream' },
      }))('https://example.invalid/provider', { headers: { authorization: `Bearer ${TEXT_CONFIG.apiKey}` } }));
      assert.deepEqual(Buffer.from(await mislabeled.arrayBuffer()), wire);
      await flushApiCallRecords();
      const log = store.get(store.list({ workflowId: `mime-task-${prefix.length}` }).records[0].id);
      const saved = log.body_encoding === 'base64' ? Buffer.from(log.body_text, 'base64').toString('utf8') : log.body_text;
      assert.doesNotMatch(saved, /fixture-secret-key-only/);
      assert.doesNotMatch(saved, /mislabelled-secret/);
    }
    pass('误报为二进制的错误正文与真正二进制中的已知凭据不会原样落盘');

    const networkResult = await runWithApiCallContext({ store, workflowId: 'network-task' }, () => callTextModel({ textConfig: TEXT_CONFIG,
      maxRetries: 0, messages: [{ role: 'user', content: '错误测试' }], fetchImpl: async () => { throw new Error('fixture network unavailable', { cause: { code: 'ENOTFOUND' } }); },
    }));
    assert.equal(networkResult.success, false);
    const networkLog = store.get(networkResult.api_call_ids[0]);
    assert.equal(networkLog.http_status, null);
    assert.equal(networkLog.transport_status, 'error');
    assert.match(networkLog.error, /ENOTFOUND/);
    pass('二进制响应以 Base64 保存，网络失败明确记录未收到响应');

    const app = express();
    app.locals.apiCallStore = store;
    app.use('/api', apiCallContextMiddleware);
    app.use('/api/api-call-logs', apiCallLogsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const list = await (await fetch(`${origin}/api/api-call-logs?workflow_id=${seeded.failedId}&limit=1`)).json();
    assert.equal(list.records.length, 1);
    assert.ok(list.nextCursor);
    assert.equal(list.records[0].body_text, undefined, '列表不得加载响应正文');
    const next = await (await fetch(`${origin}/api/api-call-logs?workflow_id=${seeded.failedId}&before=${list.nextCursor}&limit=1`)).json();
    assert.notEqual(next.records[0].id, list.records[0].id);
    assert.equal(next.nextCursor, null);
    const detail = await (await fetch(`${origin}/api/api-call-logs/${list.records[0].id}`)).json();
    assert.match(detail.record.body_text, /末尾诊断内容/);
    assert.equal(detail.record.request_body_status, 'captured');
    assert.match(detail.record.request_body_text, /instructions/);
    assert.equal((await fetch(`${origin}/api/api-call-logs/not-a-valid-id`)).status, 400);
    assert.equal((await fetch(`${origin}/api/api-call-logs/00000000-0000-0000-0000-000000000000`)).status, 404);
    const invalidOnly = await (await fetch(`${origin}/api/api-call-logs?state=invalid&workflow_id=${seeded.failedId}`)).json();
    assert.equal(invalidOnly.records.length, 2);
    assert.equal(seeded.providerCalls(), 3, '查询列表/详情不得重新调用 provider');
    assert.equal(store.list({ workflowId: "' OR 1=1 --" }).records.length, 0);
    pass('列表分页与任务/状态筛选、详情、无效 ID、只读查看均通过');

    await new Promise(resolve => server.close(resolve));
    server = null;
    const unfinishedId = store.start({ workflow_id: 'interrupted-process' });
    store.close();
    store = createApiCallStore({ directory });
    assert.equal(store.get(first.id).body_text, first.body_text);
    assert.equal(store.get(unfinishedId).transport_status, 'incomplete');
    pass('重开存储仍可查看旧返回，上次进程未完成的记录明确标记中断');

    const legacyDirectory = path.join(root, 'legacy');
    await fs.mkdir(legacyDirectory);
    const legacyDb = new Database(path.join(legacyDirectory, 'records.sqlite'));
    legacyDb.exec(`CREATE TABLE api_calls (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT '', workflow_id TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
      operation TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '',
      method TEXT NOT NULL DEFAULT 'GET', http_status INTEGER, transport_status TEXT NOT NULL DEFAULT 'complete',
      result_status TEXT NOT NULL DEFAULT '', duration_ms INTEGER NOT NULL DEFAULT 0, response_bytes INTEGER NOT NULL DEFAULT 0,
      body_encoding TEXT NOT NULL DEFAULT 'utf8', body_truncated INTEGER NOT NULL DEFAULT 0,
      content_type TEXT NOT NULL DEFAULT '', body_text TEXT NOT NULL DEFAULT '', headers_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '', context_json TEXT NOT NULL DEFAULT '{}', validation_json TEXT NOT NULL DEFAULT '[]');`);
    legacyDb.prepare('INSERT INTO api_calls (id, created_at, body_text) VALUES (?, ?, ?)').run(randomUUID(), new Date().toISOString(), '旧返回');
    legacyDb.close();
    const migrated = createApiCallStore({ directory: legacyDirectory });
    const oldRecord = migrated.list().records[0];
    assert.equal(migrated.get(oldRecord.id).body_text, '旧返回');
    assert.equal(migrated.get(oldRecord.id).request_body_status, 'unavailable');
    migrated.close();
    pass('已有返回记录原样保留，旧版入参明确不可补录');

    let requestsWithBrokenStorage = 0;
    const unaffected = await runWithApiCallContext({ store: { start() { throw new Error('fixture disk full'); } } }, () => recordedFetch(async () => {
      requestsWithBrokenStorage += 1;
      return new Response('业务响应不变');
    })('https://example.invalid/test'));
    assert.equal(await unaffected.text(), '业务响应不变');
    assert.equal(requestsWithBrokenStorage, 1);
    assert.match(getApiCallStorageWarning(), /写入失败/);
    pass('日志写入失败不改变业务响应或增加请求，并提供明确提示');
    console.log(`API 返回记录：${passed} 组本地验证通过，真实供应商调用 0 次。`);
  } finally {
    await flushApiCallRecords();
    if (server) await new Promise(resolve => server.close(resolve));
    store.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('musedock-api-call-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
}

module.exports = { seedWhiteboardCalls };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
