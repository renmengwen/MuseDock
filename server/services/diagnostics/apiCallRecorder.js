const { AsyncLocalStorage } = require('async_hooks');
const { isUtf8 } = require('buffer');
const { getApiCallStore } = require('./apiCallStore');
const { requestSecrets, redactUrl, redactText, redactValue, redactBody, redactHeaders, redactBuffer } = require('./apiCallRedaction');

const contextStorage = new AsyncLocalStorage();
const RECORD_REFS = Symbol('apiCallRecords');
const pendingCaptures = new Set();
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
let storageWarning = '';

function safelyRecord(callback) {
  try { return callback(); }
  catch {
    storageWarning = 'API 调用记录写入失败，请检查本地存储空间与写入权限；部分返回可能未保存。';
    return null;
  }
}

function runWithApiCallContext(context, callback) {
  const parent = contextStorage.getStore() || {};
  return contextStorage.run({ ...parent, ...context, scopes: parent.scopes || [], insideFetch: false }, callback);
}

function apiCallContextMiddleware(req, res, next) {
  if (req.path.startsWith('/api-call-logs')) return next();
  const match = req.path.match(/^\/creative-workflows\/([^/]+)/);
  const workflowId = match && !['modes', 'assets'].includes(match[1]) ? match[1] : '';
  return runWithApiCallContext({ workflowId, operation: `${req.method} ${req.path}`,
    store: req.app.locals.apiCallStore, directory: req.app.locals.apiCallLogDirectory }, next);
}

function requestInfo(input, options, context, details, secrets) {
  let model = '';
  if (typeof options.body === 'string') {
    try { model = String(JSON.parse(options.body)?.model || ''); } catch { /* 请求仍交给原 API。 */ }
  }
  return {
    workflow_id: String(context.workflowId || ''), category: details.category || context.category || 'api',
    operation: redactText(context.operation || '', secrets), model: redactText(model || context.model || '', secrets),
    endpoint: redactText(redactUrl(String(input?.url || input)), secrets),
    method: String(options.method || input?.method || 'GET').toUpperCase(),
    context_json: JSON.stringify(redactValue({
      taskId: context.taskId || '', attemptId: context.attemptId || '', stage: context.stage || '',
      attemptNumber: context.attemptNumber ?? null, repair: context.repair ?? null,
    }, secrets)),
  };
}

async function captureResponse(response, reference, startedAt, control) {
  const { store, id, secrets } = reference;
  const chunks = [];
  let bytes = 0;
  let failure = '';
  let truncated = false;
  let reader;
  let finished = false;
  control.cancel = () => {
    if (finished) return Promise.resolve();
    failure = '调用方已取消响应读取，记录仅保留取消前收到的内容。';
    return reader?.cancel().catch(() => {});
  };
  const contentType = response.headers?.get?.('content-type') || '';
  try {
    if (response.body) {
      reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        const remaining = MAX_CAPTURE_BYTES - bytes;
        chunks.push(chunk.subarray(0, remaining));
        bytes += Math.min(chunk.length, remaining);
        if (chunk.length > remaining) {
          truncated = true;
          // 只取消诊断副本，不取消业务响应，也不等待另一个 tee 分支结束。
          reader.cancel().catch(() => {});
          break;
        }
      }
    }
  } catch (error) {
    failure = redactText(error?.message || '读取返回正文时连接中断。', secrets);
  } finally { finished = true; reader?.releaseLock(); }
  const buffer = Buffer.concat(chunks, bytes);
  // 网关可能把 JSON/HTML 错误标成二进制；先检查实际字节，不能因此跳过脱敏。
  const looksTextual = isUtf8(buffer) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(buffer.toString('utf8'));
  const binary = !looksTextual;
  const body = binary ? redactBuffer(buffer, secrets).toString('base64') : redactBody(buffer.toString('utf8'), contentType, secrets);
  const patch = {
    transport_status: failure ? 'incomplete' : 'complete', completed_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt, response_bytes: bytes, body_encoding: binary ? 'base64' : 'utf8',
    body_text: body, body_truncated: truncated ? 1 : 0,
  };
  if (failure) patch.error = failure;
  if (!failure && !truncated && /json/i.test(contentType) && response.ok) {
    try { JSON.parse(buffer.toString('utf8')); }
    catch { patch.result_status = 'invalid'; patch.validation_json = JSON.stringify(['接口返回的正文不是有效 JSON。']); }
  }
  safelyRecord(() => store.update(id, patch));
}

function responseWithCoordinatedCancel(response, control) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  let finished = false;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) { finished = true; reader.releaseLock(); controller.close(); }
        else controller.enqueue(value);
      } catch (error) {
        if (!finished) { finished = true; reader.releaseLock(); controller.error(error); }
      }
    },
    cancel(reason) {
      finished = true;
      // tee 两侧必须同时取消；只取消业务侧会等待诊断侧 EOF，拖住原本可立即完成的取消。
      const captureCancellation = control.cancel?.();
      const businessCancellation = reader.cancel(reason);
      return Promise.all([captureCancellation, businessCancellation]).finally(() => reader.releaseLock());
    },
  }, { highWaterMark: 0 });
  const consumingResponse = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  const bodyMethods = new Set(['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text']);
  const wrap = consuming => new Proxy(response, {
    get(target, property) {
      if (property === 'body' || property === 'bodyUsed') return consuming[property];
      if (property === 'clone') return () => wrap(consuming.clone());
      if (bodyMethods.has(property) && typeof consuming[property] === 'function') return consuming[property].bind(consuming);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return wrap(consumingResponse);
}

// 在实际请求点使用，保留 fetch 注入、重试次数、超时和业务读取方式。
// 只有显式应用/任务上下文才记录；独立单测不会写入用户的默认数据目录。
function recordedFetch(fetchImpl, details = {}) {
  if (typeof fetchImpl !== 'function') return fetchImpl;
  return async function fetchAndRecord(input, options = {}) {
    const context = contextStorage.getStore();
    if (!context || context.insideFetch) return fetchImpl(input, options);
    const store = safelyRecord(() => context.store || getApiCallStore(context.directory));
    if (!store) return fetchImpl(input, options);
    const url = String(input?.url || input);
    const secrets = safelyRecord(() => requestSecrets(url, { ...options, headers: options.headers || input?.headers }));
    if (!secrets) return fetchImpl(input, options);
    const startedAt = Date.now();
    const id = safelyRecord(() => store.start(requestInfo(input, options, context, details, secrets)));
    if (!id) return fetchImpl(input, options);
    const reference = { id, store, secrets };
    for (const scope of context.scopes || []) scope.push(reference);
    let response;
    try {
      response = await contextStorage.run({ ...context, insideFetch: true }, () => fetchImpl(input, options));
    } catch (error) {
      safelyRecord(() => store.update(id, { transport_status: 'error', completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt, error: redactText([error?.message, error?.cause?.code, error?.cause?.message].filter(Boolean).join('；') || '请求未收到响应。', secrets) }));
      throw error;
    }
    safelyRecord(() => store.update(id, { transport_status: 'receiving', http_status: response?.status ?? null,
      content_type: response?.headers?.get?.('content-type') || '', headers_json: JSON.stringify(redactHeaders(response?.headers, secrets)) }));
    try {
      // 同次响应的副本不发第二次请求；业务取消时同时停止副本，保留原有取消语义。
      const control = {};
      const capture = captureResponse(response.clone(), reference, startedAt, control);
      pendingCaptures.add(capture);
      capture.catch(() => {
        storageWarning = '部分 API 返回正文未能保存，请检查本地存储空间与写入权限。';
        safelyRecord(() => store.update(id, { transport_status: 'incomplete', completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt, error: '响应记录处理失败，未能保存完整正文。' }));
      })
        .finally(() => pendingCaptures.delete(capture));
      return responseWithCoordinatedCancel(response, control);
    } catch {
      safelyRecord(() => store.update(id, { transport_status: 'incomplete', completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt, error: '当前请求实现不支持读取响应副本，已记录状态但未取得正文。' }));
    }
    return response;
  };
}

function annotateReferences(references, { status, validation, message = '' } = {}) {
  for (const { store, id, secrets } of references) {
    safelyRecord(() => store.update(id, {
      ...(status ? { result_status: status } : {}),
      ...(validation ? { validation_json: JSON.stringify(redactValue(validation, secrets)) } : {}),
      ...(message ? { error: redactText(message, secrets) } : {}),
    }));
  }
}

function annotateApiCallResult(result, details) {
  annotateReferences(result?.[RECORD_REFS] || [], details);
}

async function recordModelCall(callback, details = {}) {
  const context = contextStorage.getStore();
  if (!context) return callback();
  const references = [];
  try {
    const result = await contextStorage.run({ ...context, ...details, scopes: [...(context.scopes || []), references] }, callback);
    // 同一模型调用可能重试多次：旧失败记录保留原状态，只标注最后一次返回的处理结果。
    if (references.length && result && typeof result === 'object') {
      const last = references.slice(-1);
      if (result.success === false) annotateReferences(last, { status: 'error', message: result.message || 'API 返回未通过处理。' });
      safelyRecord(() => {
        Object.defineProperty(result, RECORD_REFS, { value: last, configurable: true });
        result.api_call_ids = references.map(reference => reference.id);
      });
    }
    return result;
  } catch (error) {
    annotateReferences(references.slice(-1), { status: 'error', message: error?.message || 'API 返回处理失败。' });
    throw error;
  }
}

async function flushApiCallRecords() {
  await Promise.allSettled([...pendingCaptures]);
}

module.exports = { recordedFetch, runWithApiCallContext, apiCallContextMiddleware, recordModelCall,
  annotateApiCallResult, flushApiCallRecords, getApiCallStorageWarning: () => storageWarning };
