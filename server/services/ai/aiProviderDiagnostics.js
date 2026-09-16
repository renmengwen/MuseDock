const aiModelConfig = require('./aiModelConfig');
const { recordedFetch, recordModelCall } = require('../diagnostics/apiCallRecorder');
const { redactText } = require('../diagnostics/apiCallRedaction');

const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 2000;
const MAX_PAGES = 20;

class DiagnosticError extends Error {
  constructor(code, message, status = 400, httpStatus = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.httpStatus = httpStatus;
  }
}

function parseBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch {
    throw new DiagnosticError('INVALID_BASE_URL', '请填写有效的 Base URL，例如 https://api.example.com/v1。');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new DiagnosticError('INVALID_BASE_URL', 'Base URL 需使用 HTTP 或 HTTPS，且不包含账号、密码、查询参数或片段。');
  }
  return url;
}

async function prepareProvider(input, options) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DiagnosticError('INVALID_PROVIDER', '请先填写供应商配置。');
  }
  if (input.protocol && !aiModelConfig.MODEL_PROTOCOLS.includes(input.protocol)) {
    throw new DiagnosticError('UNSUPPORTED_PROTOCOL', '请选择受支持的分析模型协议后重试。');
  }
  const provider = await aiModelConfig.resolveProviderDraft(input, options);
  if (!provider.baseUrl) throw new DiagnosticError('NOT_CONFIGURED', '请先填写供应商的 Base URL。');
  const baseUrl = parseBaseUrl(provider.baseUrl);
  if (!provider.apiKey) {
    throw new DiagnosticError('NOT_CONFIGURED', '请先填写 API Key；已有供应商留空时会沿用已保存的密钥。');
  }
  if (provider.savedKeyBaseUrl !== null) {
    let originalOrigin;
    try { originalOrigin = new URL(provider.savedKeyBaseUrl).origin; } catch { /* 地址不明时不转发已保存密钥。 */ }
    if (originalOrigin !== baseUrl.origin) {
      throw new DiagnosticError('API_KEY_REQUIRED', 'Base URL 的域名、协议或端口已变更，请重新输入 API Key 后再检测。');
    }
  }
  return provider;
}

function httpError(status) {
  if (status >= 300 && status < 400) {
    return new DiagnosticError('REDIRECTED', '供应商地址返回重定向，请在 Base URL 中填写最终 API 地址后重试。', 502, status);
  }
  const failures = {
    400: ['INVALID_REQUEST', '供应商拒绝了模型目录请求，请检查 Base URL 和协议是否匹配。'],
    401: ['AUTH_FAILED', '供应商鉴权失败，请检查 API Key 是否正确或已过期。'],
    402: ['QUOTA_EXCEEDED', '供应商账户余额或配额不足，请前往供应商控制台检查。'],
    403: ['PERMISSION_DENIED', '供应商拒绝访问，请检查密钥权限、账户状态或 IP 访问限制。'],
    404: ['MODELS_UNSUPPORTED', '未找到模型列表接口，请检查 Base URL 是否包含正确的 API 前缀（通常为 /v1）；供应商也可能未开放该接口，可继续手动填写模型 ID。'],
    405: ['MODELS_UNSUPPORTED', '供应商不支持模型列表查询，可继续手动填写模型 ID。'],
    408: ['TIMEOUT', '供应商处理请求超时，请稍后重试。'],
    429: ['RATE_LIMITED', '供应商请求限流或配额已用尽，请稍后重试并检查账户配额。'],
    501: ['MODELS_UNSUPPORTED', '供应商未实现模型列表接口，可继续手动填写模型 ID。'],
  };
  const [code, message] = failures[status] || (status >= 500
    ? ['UPSTREAM_UNAVAILABLE', '供应商服务暂时不可用，请稍后重试。']
    : ['HTTP_ERROR', '供应商返回异常状态，请检查配置或联系供应商。']);
  return new DiagnosticError(code, message, 502, status);
}

async function readJson(response, allowInvalidJson = false) {
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new DiagnosticError('RESPONSE_TOO_LARGE', '供应商模型列表返回过大，请缩小供应商侧的模型范围后重试。', 502, response.status);
  }
  const reader = response.body?.getReader();
  const chunks = [];
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new DiagnosticError('RESPONSE_TOO_LARGE', '供应商模型列表返回过大，请缩小供应商侧的模型范围后重试。', 502, response.status);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); } catch {
    if (allowInvalidJson) return null;
    throw new DiagnosticError('INVALID_RESPONSE', '供应商返回的不是有效 JSON，可能是网页、登录页或网关错误；请检查 Base URL。', 502, response.status);
  }
}

function normalizeModels(data, apiKey, httpStatus) {
  if (!data || !Array.isArray(data.data) || data.error || data.success === false) {
    throw new DiagnosticError('INVALID_RESPONSE', '供应商返回的不是兼容的模型列表（缺少 data 数组或包含错误），无法确认模型目录可用。', 502, httpStatus);
  }
  const models = new Map();
  for (const item of data.data) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (!id || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)) continue;
    // 仅将可用于配置的字段交给页面；供应商回显密钥时不把它当成模型 ID。
    if (id.includes(apiKey)) continue;
    const rawName = typeof item.display_name === 'string' ? item.display_name : id;
    const name = redactText(rawName, [apiKey]).slice(0, 512);
    if (!models.has(id)) models.set(id, { id, name });
  }
  if (data.data.length && !models.size) {
    throw new DiagnosticError('INVALID_RESPONSE', '供应商模型列表中没有有效的模型 ID，请检查接口是否兼容。', 502, httpStatus);
  }
  return [...models.values()];
}

// 协议依据官方 SDK：openai/openai-node src/resources/models.ts；
// anthropics/anthropic-sdk-typescript src/resources/models.ts、src/core/pagination.ts。
// 本项目 Base URL 已包含 API 前缀（例如 /v1），保留自定义路径后追加 /models。
async function queryModels(provider, { mode, fetchImpl, signal }) {
  const anthropic = provider.protocol === 'anthropic-messages';
  const endpoint = `${provider.baseUrl}/models`;
  const headers = anthropic
    ? { Accept: 'application/json', 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' }
    : { Accept: 'application/json', Authorization: `Bearer ${provider.apiKey}` };
  const fetchModels = recordedFetch(fetchImpl, { category: 'api' });
  const models = new Map();
  const cursors = new Set();
  let cursor = '';
  let truncated = false;
  let httpStatus;
  let pages = 0;
  do {
    const url = new URL(endpoint);
    if (anthropic) url.searchParams.set('limit', mode === 'probe' ? '1' : '100');
    if (cursor) url.searchParams.set(anthropic ? 'after_id' : 'after', cursor);
    // 不跟随重定向，避免将 x-api-key 交给另一个地址；不自动重试诊断请求。
    const response = await fetchModels(url.toString(), { method: 'GET', headers, signal, redirect: 'manual' });
    httpStatus = response.status;
    if (!response.ok) {
      // 同样消费有界的错误正文，供现有 API 返回记录保存及脱敏。
      await readJson(response, true);
      throw httpError(response.status);
    }
    const data = await readJson(response);
    const pageModels = normalizeModels(data, provider.apiKey, httpStatus);
    for (const model of pageModels) {
      if (models.has(model.id)) continue;
      if (models.size >= MAX_MODELS) { truncated = true; break; }
      models.set(model.id, model);
    }
    pages += 1;
    if (mode === 'probe') break;
    if (data.has_more !== true) break;
    const nextCursor = typeof data.last_id === 'string' ? data.last_id.trim() : '';
    if (!pageModels.length || !nextCursor || nextCursor.length > 512 || cursors.has(nextCursor)) {
      throw new DiagnosticError('INVALID_PAGINATION', '供应商返回了无法继续翻页的模型列表，请稍后重试或手动填写模型 ID。', 502, httpStatus);
    }
    if (pages >= MAX_PAGES || models.size >= MAX_MODELS) { truncated = true; break; }
    cursors.add(nextCursor);
    cursor = nextCursor;
  } while (!truncated);
  return { models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)), httpStatus, pages, truncated };
}

async function diagnoseProvider(input, options = {}) {
  const startedAt = Date.now();
  let timeout;
  let signal;
  try {
    const provider = await prepareProvider(input, options);
    const mode = options.mode === 'models' ? 'models' : 'probe';
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const result = await queryModels(provider, { mode, fetchImpl: options.fetchImpl || global.fetch, signal });
    const data = { latencyMs: Date.now() - startedAt, httpStatus: result.httpStatus };
    if (mode === 'probe') {
      return { success: true, data: { ...data, code: 'CONNECTED', message: '连接成功，模型目录接口正常响应；尚未验证具体模型的生成能力。' } };
    }
    const message = !result.models.length
      ? '供应商返回的模型列表为空，可检查密钥权限或手动填写模型 ID。'
      : result.truncated
        ? `已获取 ${result.models.length} 个模型，列表达到查询上限，可能仍有其他模型；未列出的模型可手动填写。`
        : `已获取 ${result.models.length} 个模型，可复制模型ID后手动填写。`;
    return { success: true, data: { ...data, ...result, message } };
  } catch (error) {
    const failure = error instanceof DiagnosticError ? error : signal?.aborted
      ? new DiagnosticError(options.signal?.aborted ? 'CANCELLED' : 'TIMEOUT', options.signal?.aborted
        ? '检测已取消。' : '供应商请求超时，请检查网络、代理或 Base URL 后重试。', 504)
      : new DiagnosticError('NETWORK_ERROR', '无法连接供应商，请检查网络、代理、证书或 Base URL 后重试。', 502);
    return { success: false, status: failure.status, code: failure.code, message: failure.message,
      httpStatus: failure.httpStatus, latencyMs: Date.now() - startedAt };
  } finally { clearTimeout(timeout); }
}

module.exports = {
  diagnoseProvider: (input, options) => recordModelCall(() => diagnoseProvider(input, options), { category: 'api' }),
};
