const { WhiteboardError } = require('./contracts');
const { redactText } = require('../../diagnostics/apiCallRedaction');

const REJECTED_HTTP = [400, 401, 403, 404, 422, 429];
const PROVIDER_STATUSES = ['completed', 'incomplete', 'failed', 'cancelled', 'queued', 'in_progress'];
const STOP_REASONS = ['max_output_tokens', 'length', 'max_tokens', 'content_filter', 'refusal'];
const DESCRIPTIONS = {
  output_limit: '视觉模型达到输出上限，未返回完整的编排结果。',
  response_incomplete: '视觉模型返回的响应尚未完成，无法作为完整编排使用。',
  missing_text: '已收到视觉服务响应，但没有可用的正文内容。',
  invalid_response: '已收到视觉服务响应，但响应格式无法解析。',
  candidate_invalid: '模型返回的编排未通过校验，具体问题如下。',
  timeout: '等待视觉模型响应超时，未取得完整结果。',
  network_error: '视觉模型请求发生网络连接异常，未取得完整结果。',
  request_interrupted: '视觉模型请求中断，无法确认完整结果。',
  refusal: '视觉服务拒绝输出所需内容，未取得可用编排。',
  http_rejected: '视觉服务明确拒绝了请求。',
  http_error: '视觉服务返回异常状态，未取得完整结果。',
  unknown: '视觉模型没有返回完整结果，现有证据不足以确定具体原因。',
};
const HTTP_GUIDANCE = {
  400: '请检查分析模型的请求参数与接口协议。',
  401: '请在模型设置中检查 API Key 是否有效。',
  403: '请检查当前账号是否有权调用该模型。',
  404: '请检查模型名称与接口地址是否正确。',
  422: '请检查模型支持的参数与图像输入格式。',
  429: '请检查服务额度或限流状态，稍后再试。',
};

function validHttpStatus(value) { return Number.isInteger(value) && value >= 100 && value <= 599; }

// 元数据仅接受固定枚举。校验问题由本地校验器生成，脱敏并限制长度；不复制供应商正文或异常消息。
function safeVisionDiagnostics(value, secrets = []) {
  if (!value || typeof value !== 'object') return undefined;
  const category = Object.hasOwn(DESCRIPTIONS, value.category) ? value.category : 'unknown';
  const result = { category, message: DESCRIPTIONS[category] };
  if (validHttpStatus(value.httpStatus)) result.httpStatus = value.httpStatus;
  if (PROVIDER_STATUSES.includes(value.providerStatus)) result.providerStatus = value.providerStatus;
  if (STOP_REASONS.includes(value.stopReason)) result.stopReason = value.stopReason;
  for (const key of ['responseReceived', 'hasExtractedText']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (category === 'candidate_invalid' && Array.isArray(value.validationErrors)) {
    const errors = value.validationErrors.filter(error => typeof error === 'string' && error.trim());
    result.validationErrors = errors.slice(0, 64).map(error => redactText(error, secrets).slice(0, 2048));
    if (value.validationTruncated === true || errors.length > 64 || errors.some(error => error.length > 2048)) result.validationTruncated = true;
  }
  return result;
}

function transportCategory(error, signal) {
  const code = error?.cause?.code || error?.code;
  return signal?.aborted || ['AbortError', 'TimeoutError'].includes(error?.name)
    || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code)
    ? 'timeout' : 'network_error';
}

function visionDiagnostics({ response, httpStatus, transport } = {}) {
  const raw = response?.raw_response;
  const providerStatus = PROVIDER_STATUSES.includes(raw?.status) ? raw.status : undefined;
  const stopReason = [raw?.incomplete_details?.reason, raw?.choices?.[0]?.finish_reason, raw?.stop_reason]
    .find(value => STOP_REASONS.includes(value));
  const refusal = Boolean(raw?.choices?.[0]?.message?.refusal)
    || (Array.isArray(raw?.output) && raw.output.some(item => Array.isArray(item?.content)
      && item.content.some(part => part?.type === 'refusal')));
  const hasExtractedText = typeof response?.text === 'string' && response.text.trim().length > 0;
  const responseReceived = validHttpStatus(httpStatus) || Boolean(response && Object.hasOwn(response, 'raw_response'));
  let category = 'unknown';
  if (REJECTED_HTTP.includes(httpStatus)) category = 'http_rejected';
  else if (validHttpStatus(httpStatus) && httpStatus >= 400) category = 'http_error';
  else if (transport) category = transport;
  else if (['max_output_tokens', 'length', 'max_tokens'].includes(stopReason)) category = 'output_limit';
  else if (refusal || ['content_filter', 'refusal'].includes(stopReason)) category = 'refusal';
  else if (providerStatus && providerStatus !== 'completed') category = 'response_incomplete';
  else if (raw && Object.hasOwn(raw, 'parse_error') && Object.hasOwn(raw, 'preview')) category = 'invalid_response';
  else if (!hasExtractedText && responseReceived) category = 'missing_text';
  return safeVisionDiagnostics({ category, httpStatus, providerStatus, stopReason, hasExtractedText,
    ...(responseReceived || transport ? { responseReceived } : {}) });
}

function visionRequestError(diagnostics) {
  const safe = safeVisionDiagnostics(diagnostics);
  const rejected = safe.category === 'http_rejected';
  const status = safe.httpStatus ? `（HTTP ${safe.httpStatus}）` : '';
  const guidance = rejected ? HTTP_GUIDANCE[safe.httpStatus]
    : '请查看分镜请求详情，核实外部结果后再授权新请求。';
  return Object.assign(new WhiteboardError(rejected ? 'VISION_REQUEST_REJECTED' : 'UNKNOWN_EXTERNAL_OUTCOME',
    `${safe.message}${status}${guidance || ''}`, rejected ? 400 : 409), { diagnostics: safe });
}

module.exports = { safeVisionDiagnostics, transportCategory, visionDiagnostics, visionRequestError };
