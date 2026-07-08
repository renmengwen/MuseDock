const aiModelConfig = require('./aiModelConfig');

function normalizeBaseUrl(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function readJsonResponse(response, apiKey) {
  if (response && typeof response.text === 'function') {
    try {
      const text = await response.text();
      try {
        return {
          data: JSON.parse(text),
          parseError: '',
          rawText: '',
          contentType: response.headers?.get?.('content-type') || '',
        };
      } catch (error) {
        return {
          data: null,
          parseError: error?.message || '响应不是有效 JSON',
          rawText: sanitizeErrorDetail(text, apiKey),
          contentType: response.headers?.get?.('content-type') || '',
        };
      }
    } catch {
      // Fall through to response.json() for fetch-compatible test doubles.
    }
  }

  try {
    return {
      data: await response.json(),
      parseError: '',
      rawText: '',
      contentType: response?.headers?.get?.('content-type') || '',
    };
  } catch (error) {
    return {
      data: null,
      parseError: error?.message || '响应不是有效 JSON',
      rawText: '',
      contentType: response?.headers?.get?.('content-type') || '',
    };
  }
}

function decodeChunk(value, decoder = new TextDecoder(), options = {}) {
  if (typeof value === 'string') return value;
  return decoder.decode(value, options);
}

async function readWithChunkTimeout(reader, chunkTimeoutMs) {
  if (!chunkTimeoutMs || chunkTimeoutMs <= 0) return reader.read();
  return Promise.race([
    reader.read(),
    wait(chunkTimeoutMs).then(() => {
      throw new Error(`流式响应块读取超时：${Math.round(chunkTimeoutMs / 1000)} 秒内未收到新数据。`);
    }),
  ]);
}

async function readStreamResponse(response, apiKey, options = {}) {
  if (!response?.body || typeof response.body.getReader !== 'function') {
    return {
      success: false,
      text: '',
      raw_response: { message: '流式响应缺少可读取的 body。' },
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const events = [];
  const chunkTimeoutMs = Number(options.chunkTimeoutMs) || 0;

  while (true) {
    const { done, value } = await readWithChunkTimeout(reader, chunkTimeoutMs);
    if (done) break;
    buffer += decodeChunk(value, decoder, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() || '';

    for (const part of parts) {
      const lines = part.split(/\r?\n/).map(line => line.trim());
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (error) {
          return {
            success: false,
            text,
            raw_response: {
              message: '流式响应包含无效 JSON 片段。',
              parse_error: sanitizeErrorDetail(error?.message, apiKey),
              preview: sanitizeErrorDetail(data.slice(0, 500), apiKey),
            },
          };
        }
        events.push(sanitizeRawResponse(parsed, apiKey));
        const delta = extractContentText(parsed?.choices?.[0]?.delta?.content);
        if (typeof delta === 'string') text += delta;
      }
    }
  }
  buffer += decoder.decode();

  return {
    success: true,
    text,
    raw_response: { stream: true, chunks: events },
  };
}

function getProviderError(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'object') return '';
  const error = rawResponse.error;
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  if (typeof rawResponse.message === 'string') return rawResponse.message;
  return '';
}

function sanitizeErrorDetail(detail, apiKey) {
  const text = normalizeString(detail);
  if (!text) return '';
  return apiKey ? text.split(apiKey).join('[已隐藏]') : text;
}

function sanitizeRawResponse(value, apiKey) {
  if (!apiKey || value == null) return value;
  if (typeof value === 'string') {
    return sanitizeErrorDetail(value, apiKey);
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeRawResponse(item, apiKey));
  }
  if (typeof value === 'object') {
    const sanitized = {};
    for (const [key, item] of Object.entries(value)) {
      sanitized[key] = sanitizeRawResponse(item, apiKey);
    }
    return sanitized;
  }
  return value;
}

function toModelInfo(provider, modelId, protocol) {
  return {
    provider,
    model_id: modelId,
    protocol,
  };
}

function attachNormalizedToolCalls(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'object') return rawResponse;
  const normalized = normalizeToolCalls(rawResponse);
  if (normalized.length > 0) {
    rawResponse.normalized_tool_calls = normalized;
  }
  return rawResponse;
}

function extractContentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value
      .map(item => extractContentText(item))
      .filter(part => typeof part === 'string');
    return parts.length ? parts.join('') : undefined;
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string' || Array.isArray(value.content)) {
      return extractContentText(value.content);
    }
  }
  return undefined;
}

function extractOutputArrayText(output) {
  if (!Array.isArray(output)) return undefined;
  const parts = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const text = extractContentText(item.content);
    if (typeof text === 'string') parts.push(text);
  }
  return parts.length ? parts.join('') : undefined;
}

function extractResponseText(rawResponse) {
  const chatText = extractContentText(rawResponse?.choices?.[0]?.message?.content);
  if (typeof chatText === 'string') return chatText;
  const outputText = extractContentText(rawResponse?.output_text);
  if (typeof outputText === 'string') return outputText;
  const contentText = extractContentText(rawResponse?.content);
  if (typeof contentText === 'string') return contentText;
  return extractOutputArrayText(rawResponse?.output);
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractUsage(rawResponse) {
  const usage = rawResponse?.usage || (
    Array.isArray(rawResponse?.chunks)
      ? rawResponse.chunks.findLast(chunk => chunk?.usage)?.usage
      : null
  );
  if (!usage || typeof usage !== 'object') return null;
  return {
    prompt_tokens: nullableNumber(usage.prompt_tokens ?? usage.input_tokens),
    completion_tokens: nullableNumber(usage.completion_tokens ?? usage.output_tokens),
    total_tokens: nullableNumber(usage.total_tokens),
    cached_tokens: nullableNumber(
      usage.cached_tokens
      ?? usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens
      ?? usage.input_token_details?.cached_tokens,
    ),
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryStatus(status) {
  return [502, 503, 504].includes(Number(status));
}

function normalizeProtocol(value) {
  return aiModelConfig.MODEL_PROTOCOLS?.includes(value) ? value : aiModelConfig.DEFAULT_MODEL_PROTOCOL || 'openai-responses';
}

function parseDataUrl(value) {
  const match = normalizeString(value).match(/^data:([^;,]+);base64,(.+)$/);
  return match ? { mediaType: match[1], data: match[2] } : null;
}

function parseMaybeJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function normalizeToolCalls(rawResponse = {}) {
  const calls = [];
  const chatCalls = rawResponse?.choices?.[0]?.message?.tool_calls;
  if (Array.isArray(chatCalls)) calls.push(...chatCalls);

  if (Array.isArray(rawResponse?.output)) {
    for (const item of rawResponse.output) {
      if (item?.type !== 'function_call') continue;
      calls.push({
        id: item.call_id || item.id || '',
        type: 'function',
        function: {
          name: item.name || '',
          arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
        },
      });
    }
  }

  if (Array.isArray(rawResponse?.content)) {
    for (const item of rawResponse.content) {
      if (item?.type !== 'tool_use') continue;
      calls.push({
        id: item.id || '',
        type: 'function',
        function: {
          name: item.name || '',
          arguments: JSON.stringify(item.input || {}),
        },
      });
    }
  }

  return calls.filter(call => call?.function?.name);
}

function normalizeToolsForOpenAi(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map(tool => {
    if (tool?.type === 'function' && tool.function) {
      return {
        type: 'function',
        name: tool.function.name,
        description: tool.function.description || '',
        parameters: tool.function.parameters || {},
      };
    }
    return tool;
  });
}

function normalizeToolsForAnthropic(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map(tool => {
    const fn = tool?.type === 'function' ? tool.function : tool;
    return {
      name: fn?.name || '',
      description: fn?.description || '',
      input_schema: fn?.parameters || fn?.input_schema || { type: 'object' },
    };
  }).filter(tool => tool.name);
}

function contentToText(value) {
  const text = extractContentText(value);
  return typeof text === 'string' ? text : '';
}

function toOpenAiContent(content, role) {
  if (typeof content === 'string') {
    return [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: content }];
  }
  if (!Array.isArray(content)) return [];
  return content.map(item => {
    if (typeof item === 'string') return { type: role === 'assistant' ? 'output_text' : 'input_text', text: item };
    if (item?.type === 'text') return { type: role === 'assistant' ? 'output_text' : 'input_text', text: item.text || '' };
    if (item?.type === 'image_url') return { type: 'input_image', image_url: item.image_url?.url || '' };
    return item;
  }).filter(item => item.type !== 'input_image' || item.image_url);
}

function toOpenAiInput(messages = []) {
  const input = [];
  const instructions = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'system') {
      const text = contentToText(message.content);
      if (text) instructions.push(text);
      continue;
    }
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id || message.id || '',
        output: typeof message.content === 'string' ? message.content : JSON.stringify(message.content || ''),
      });
      continue;
    }
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const content = toOpenAiContent(message.content, role);
    if (content.length) input.push({ role, content });
    if (Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: toolCall.id || '',
          name: toolCall.function?.name || '',
          arguments: toolCall.function?.arguments || '{}',
        });
      }
    }
  }
  return { input, instructions: instructions.join('\n\n') };
}

function toAnthropicContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(item => {
    if (typeof item === 'string') return { type: 'text', text: item };
    if (item?.type === 'text') return { type: 'text', text: item.text || '' };
    if (item?.type === 'image_url') {
      const dataUrl = parseDataUrl(item.image_url?.url);
      if (dataUrl) {
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: dataUrl.mediaType,
            data: dataUrl.data,
          },
        };
      }
      return { type: 'text', text: item.image_url?.url || '' };
    }
    return item;
  });
}

function toAnthropicMessages(messages = [], response_format) {
  const result = [];
  const system = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'system') {
      const text = contentToText(message.content);
      if (text) system.push(text);
      continue;
    }
    if (message.role === 'tool') {
      result.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.tool_call_id || message.id || '',
          content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content || ''),
        }],
      });
      continue;
    }
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const content = toAnthropicContent(message.content);
    const normalizedContent = Array.isArray(content) ? content : (content ? [{ type: 'text', text: content }] : []);
    if (Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        normalizedContent.push({
          type: 'tool_use',
          id: toolCall.id || '',
          name: toolCall.function?.name || '',
          input: parseMaybeJson(toolCall.function?.arguments),
        });
      }
    }
    if (normalizedContent.length) result.push({ role, content: normalizedContent });
  }
  if (response_format?.type === 'json_object') {
    system.push('请只输出有效 JSON，不要包含 Markdown 代码围栏或额外说明。');
  }
  return { messages: result, system: system.join('\n\n') };
}

function buildOpenAiResponsesBody({ modelId, messages, temperature, tools, tool_choice, response_format }) {
  const { input, instructions } = toOpenAiInput(messages);
  return JSON.stringify({
    model: modelId,
    input,
    ...(instructions ? { instructions } : {}),
    temperature,
    ...(tools ? { tools: normalizeToolsForOpenAi(tools) } : {}),
    ...(tool_choice ? { tool_choice } : {}),
    ...(response_format ? { text: { format: response_format } } : {}),
  });
}

function buildAnthropicMessagesBody({ modelId, messages, temperature, tools, response_format, maxTokens }) {
  const mapped = toAnthropicMessages(messages, response_format);
  return JSON.stringify({
    model: modelId,
    max_tokens: Math.max(1, Number(maxTokens) || 4096),
    messages: mapped.messages,
    ...(mapped.system ? { system: mapped.system } : {}),
    ...(Number.isFinite(Number(temperature)) ? { temperature } : {}),
    ...(tools ? { tools: normalizeToolsForAnthropic(tools) } : {}),
  });
}

function createTimeoutSignal(timeoutMs) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0 || typeof AbortController !== 'function') {
    return { signal: undefined, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`分析模型请求超时：${Math.round(ms / 1000)} 秒内未返回结果。`));
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

function getAbortErrorMessage(error, timeoutMs) {
  const reasonMessage = normalizeString(error?.cause?.message || error?.message);
  if (reasonMessage && !/^This operation was aborted$/i.test(reasonMessage)) {
    return reasonMessage;
  }
  return `分析模型请求超时：${Math.round(Number(timeoutMs) / 1000)} 秒内未返回结果。`;
}

async function postModelRequest({ protocol, baseUrl, apiKey, modelId, messages, temperature, fetchImpl, timeoutMs, tools, tool_choice, response_format, maxTokens }) {
  const timeout = createTimeoutSignal(timeoutMs);
  const resolvedProtocol = normalizeProtocol(protocol);
  const isAnthropic = resolvedProtocol === 'anthropic-messages';
  try {
    const response = await fetchImpl(`${baseUrl}${isAnthropic ? '/messages' : '/responses'}`, {
      method: 'POST',
      headers: isAnthropic ? {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      } : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: isAnthropic
        ? buildAnthropicMessagesBody({ modelId, messages, temperature, tools, response_format, maxTokens })
        : buildOpenAiResponsesBody({ modelId, messages, temperature, tools, tool_choice, response_format }),
      signal: timeout.signal,
    });
    if (response && typeof response === 'object') {
      Object.defineProperty(response, '__cleanupTimeout', {
        value: timeout.cleanup,
        enumerable: false,
        configurable: true,
      });
    }
    return response;
  } catch (error) {
    timeout.cleanup();
    if (error?.name === 'AbortError' || timeout.signal?.aborted) {
      throw new Error(getAbortErrorMessage(error, timeoutMs));
    }
    throw error;
  }
}

function cleanupResponseTimeout(response) {
  if (typeof response?.__cleanupTimeout === 'function') {
    response.__cleanupTimeout();
  }
}

function isAbortLikeError(error) {
  return error?.name === 'AbortError' || /abort|aborted|超时|timeout/i.test(normalizeString(error?.message));
}

function getFetchErrorDetail(error, apiKey) {
  const parts = [
    normalizeString(error?.message),
    normalizeString(error?.cause?.code),
    normalizeString(error?.cause?.message),
  ].filter(Boolean);
  return sanitizeErrorDetail([...new Set(parts)].join('：'), apiKey);
}

function isRetryableNetworkError(error) {
  if (!error) return false;
  if (isAbortLikeError(error)) return false;
  const code = normalizeString(error?.cause?.code || error?.code).toUpperCase();
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)) {
    return true;
  }
  return /fetch failed|network|socket|connect|econnreset|etimedout|eai_again|enotfound/i.test(
    `${normalizeString(error?.message)} ${normalizeString(error?.cause?.message)}`,
  );
}

async function callTextModel(options = {}) {
  const {
    messages = [],
    configPath,
    fetchImpl = global.fetch,
    temperature = 0.4,
    textConfig,
    maxRetries = 1,
    retryDelayMs = 1200,
    stream = false,
    fallbackToNonStreamOnGatewayTimeout = false,
    requestTimeoutMs = 180000,
    streamChunkTimeoutMs,
    logger,
    tools,
    tool_choice,
    response_format,
    maxTokens,
  } = options;

  const log = logger && typeof logger === 'object' ? logger : null;

  const config = textConfig || await aiModelConfig.getRuntimeConfig('text', { configPath });
  const provider = normalizeString(config && config.provider);
  const protocol = normalizeProtocol(config && config.protocol);
  const apiKey = normalizeString(config && config.apiKey);
  const baseUrl = normalizeBaseUrl(config && config.baseUrl);
  const modelId = normalizeString(config && config.modelId);

  if (!config || config.enabled !== true || !apiKey || !baseUrl || !modelId) {
    return {
      success: false,
      configured: false,
      message: '分析模型未配置，请先在 AI 模型配置中填写分析模型的 API Key、Base URL 和模型 ID。',
    };
  }

  if (typeof fetchImpl !== 'function') {
    return {
      success: false,
      configured: true,
      message: '分析模型请求失败：当前运行环境缺少 fetch 实现。',
      model: toModelInfo(provider, modelId, protocol),
    };
  }

  const totalMessageChars = messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
  const effectiveStream = false;
  const requestLabel = `[AI] ${provider}/${modelId} protocol=${protocol} stream=${effectiveStream} msgs=${messages.length} chars=${totalMessageChars} timeout=${Math.round(requestTimeoutMs / 1000)}s`;
  if (log) log.info(`${requestLabel} — 开始请求`);

  let response;
  let attempt = 0;
  let lastFetchError = null;
  const retryLimit = Math.max(0, Number(maxRetries) || 0);
  const t0 = Date.now();
  while (attempt <= retryLimit) {
    try {
      response = await postModelRequest({
        protocol,
        baseUrl,
        apiKey,
        modelId,
        messages,
        temperature,
        fetchImpl,
        timeoutMs: requestTimeoutMs,
        tools,
        tool_choice,
        response_format,
        maxTokens,
      });
      lastFetchError = null;
    } catch (error) {
      lastFetchError = error;
      if (isAbortLikeError(error)) {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        if (log) log.warn(`${requestLabel} — 第 ${attempt + 1} 次请求超时 (${elapsed}s)，${attempt < retryLimit ? '重试中...' : '重试已用尽'}`);
        if (attempt < retryLimit) {
          await wait(retryDelayMs * (attempt + 1));
          attempt += 1;
          continue;
        }
      }
      if (isRetryableNetworkError(error)) {
        const detail = getFetchErrorDetail(error, apiKey) || '网络请求异常';
        if (log) log.warn(`${requestLabel} — 第 ${attempt + 1} 次网络请求失败：${detail}，${attempt < retryLimit ? '重试中...' : '重试已用尽'}`);
        if (attempt < retryLimit) {
          await wait(retryDelayMs * (attempt + 1));
          attempt += 1;
          continue;
        }
      }
      if (!isAbortLikeError(error)) {
        const detail = getFetchErrorDetail(error, apiKey) || '网络请求异常';
        return {
          success: false,
          configured: true,
          message: `分析模型调用失败：${detail}`,
          model: toModelInfo(provider, modelId, protocol),
        };
      }
      // All retries exhausted on timeout — break to try fallback below
      break;
    }

    if (!shouldRetryStatus(response.status) || attempt >= retryLimit) break;
    if (log) log.warn(`${requestLabel} — 第 ${attempt + 1} 次请求返回 HTTP ${response.status}，重试中...`);
    cleanupResponseTimeout(response);
    await wait(retryDelayMs * (attempt + 1));
    attempt += 1;
  }

  const timedOut = isAbortLikeError(lastFetchError);
  const canFallbackToNonStream = effectiveStream && fallbackToNonStreamOnGatewayTimeout
    && (shouldRetryStatus(response?.status) || timedOut);
  if (canFallbackToNonStream) {
    if (log) log.warn(`${requestLabel} — 流式请求失败${timedOut ? '(超时)' : '(HTTP ' + response?.status + ')'}，降级为非流式重试`);
    if (response) cleanupResponseTimeout(response);
    await wait(retryDelayMs * (attempt + 1));
    try {
      response = await postModelRequest({
        protocol,
        baseUrl,
        apiKey,
        modelId,
        messages,
        temperature,
        fetchImpl,
        timeoutMs: requestTimeoutMs,
        tools,
        tool_choice,
        response_format,
        maxTokens,
      });
    } catch (error) {
      const detail = sanitizeErrorDetail(error && error.message, apiKey) || '网络请求异常';
      return {
        success: false,
        configured: true,
        message: `分析模型调用失败：${detail}`,
        model: toModelInfo(provider, modelId, protocol),
        fallback: {
          from_stream: true,
          reason: timedOut ? 'stream_timeout' : 'gateway_timeout',
        },
      };
    }
    if (response.ok) {
      const parsedResponse = await readJsonResponse(response, apiKey);
      cleanupResponseTimeout(response);
      const rawResponse = attachNormalizedToolCalls(sanitizeRawResponse(parsedResponse.data, apiKey));
      const text = extractResponseText(rawResponse);
      if (typeof text === 'string') {
        return {
          success: true,
          configured: true,
          text,
          model: toModelInfo(provider, modelId, protocol),
          raw_response: rawResponse,
          usage: extractUsage(rawResponse),
          fallback: {
            from_stream: true,
            reason: timedOut ? 'stream_timeout' : 'gateway_timeout',
          },
        };
      }
    }
  }

  if (!response) {
    const elapsed = Math.round((Date.now() - t0) / 1000);
    if (log) log.error(`${requestLabel} — 所有请求均超时 (${elapsed}s, ${attempt + 1} 次尝试)`);
    const detail = sanitizeErrorDetail(lastFetchError && lastFetchError.message, apiKey) || '网络请求异常';
    return {
      success: false,
      configured: true,
      message: `分析模型调用失败：${detail}`,
      model: toModelInfo(provider, modelId, protocol),
    };
  }

  if (!response.ok) {
    const parsedResponse = await readJsonResponse(response, apiKey);
    cleanupResponseTimeout(response);
    const rawResponse = attachNormalizedToolCalls(sanitizeRawResponse(parsedResponse.data, apiKey));
    const detail = sanitizeErrorDetail(getProviderError(rawResponse), apiKey)
      || sanitizeErrorDetail(parsedResponse.rawText, apiKey).slice(0, 500)
      || `HTTP ${response.status}`;
    return {
      success: false,
      configured: true,
      message: `${provider || '分析模型'} 调用失败：${detail}`,
      model: toModelInfo(provider, modelId, protocol),
      raw_response: rawResponse,
    };
  }

  if (effectiveStream) {
    let streamResult;
    try {
      streamResult = await readStreamResponse(response, apiKey, {
        chunkTimeoutMs: streamChunkTimeoutMs,
      });
    } catch (error) {
      cleanupResponseTimeout(response);
      if (fallbackToNonStreamOnGatewayTimeout && isAbortLikeError(error)) {
        if (log) log.warn(`${requestLabel} — 流式响应读取超时，降级为非流式重试`);
        try {
          const fallbackResponse = await postModelRequest({
            protocol,
            baseUrl,
            apiKey,
            modelId,
            messages,
            temperature,
            fetchImpl,
            timeoutMs: requestTimeoutMs,
            tools,
            tool_choice,
            response_format,
            maxTokens,
          });
          if (fallbackResponse.ok) {
            const parsedResponse = await readJsonResponse(fallbackResponse, apiKey);
            cleanupResponseTimeout(fallbackResponse);
            const rawResponse = attachNormalizedToolCalls(sanitizeRawResponse(parsedResponse.data, apiKey));
            const text = extractResponseText(rawResponse);
            if (typeof text === 'string') {
              return {
                success: true,
                configured: true,
                text,
                model: toModelInfo(provider, modelId, protocol),
                raw_response: rawResponse,
                usage: extractUsage(rawResponse),
                fallback: {
                  from_stream: true,
                  reason: 'stream_timeout',
                },
              };
            }
          } else {
            cleanupResponseTimeout(fallbackResponse);
          }
        } catch (fallbackError) {
          const detail = sanitizeErrorDetail(fallbackError && fallbackError.message, apiKey) || '网络请求异常';
          return {
            success: false,
            configured: true,
            message: `分析模型调用失败：${detail}`,
            model: toModelInfo(provider, modelId, protocol),
            fallback: {
              from_stream: true,
              reason: 'stream_timeout',
            },
          };
        }
      }
      const detail = sanitizeErrorDetail(isAbortLikeError(error)
        ? getAbortErrorMessage(error, requestTimeoutMs)
        : error?.message, apiKey) || '读取流式响应失败';
      return {
        success: false,
        configured: true,
        message: `${provider || '分析模型'} 流式响应读取失败：${detail}`,
        model: toModelInfo(provider, modelId, protocol),
      };
    }
    cleanupResponseTimeout(response);
    if (!streamResult.success) {
      return {
        success: false,
        configured: true,
        message: `${provider || '分析模型'} 流式响应解析失败：${getProviderError(streamResult.raw_response) || '响应格式无效'}`,
        model: toModelInfo(provider, modelId, protocol),
        raw_response: streamResult.raw_response,
      };
    }
    if (!streamResult.text) {
      return {
        success: false,
        configured: true,
        message: `${provider || '分析模型'} 流式返回结果缺少文本内容。`,
        model: toModelInfo(provider, modelId, protocol),
        raw_response: streamResult.raw_response,
      };
    }
    const elapsed = Math.round((Date.now() - t0) / 1000);
    if (log) log.info(`${requestLabel} — 流式请求成功 (${elapsed}s, ${streamResult.text.length} 字符)`);
    return {
      success: true,
      configured: true,
      text: streamResult.text,
      model: toModelInfo(provider, modelId, protocol),
      raw_response: streamResult.raw_response,
      usage: extractUsage(streamResult.raw_response),
    };
  }

  const parsedResponse = await readJsonResponse(response, apiKey);
  cleanupResponseTimeout(response);
  let rawResponse = attachNormalizedToolCalls(sanitizeRawResponse(parsedResponse.data, apiKey));

  if (parsedResponse.parseError && parsedResponse.rawText) {
    return {
      success: false,
      configured: true,
      message: `${provider || '分析模型'} 返回了非 JSON 响应，请检查 Base URL 是否指向所选协议地址。`,
      model: toModelInfo(provider, modelId, protocol),
      raw_response: {
        content_type: parsedResponse.contentType,
        parse_error: sanitizeErrorDetail(parsedResponse.parseError, apiKey),
        preview: parsedResponse.rawText.slice(0, 500),
      },
    };
  }

  let text = extractResponseText(rawResponse);

  for (let missingTextRetry = 0; typeof text !== 'string' && missingTextRetry < retryLimit; missingTextRetry += 1) {
    if (log) log.warn(`${requestLabel} — 返回结果缺少文本内容，重试中...`);
    await wait(retryDelayMs * (missingTextRetry + 1));
    let retryResponse;
    try {
      retryResponse = await postModelRequest({
        protocol,
        baseUrl,
        apiKey,
        modelId,
        messages,
        temperature,
        fetchImpl,
        timeoutMs: requestTimeoutMs,
        tools,
        tool_choice,
        response_format,
        maxTokens,
      });
    } catch (error) {
      const detail = getFetchErrorDetail(error, apiKey) || '网络请求异常';
      return {
        success: false,
        configured: true,
        message: `分析模型调用失败：${detail}`,
        model: toModelInfo(provider, modelId, protocol),
      };
    }
    if (!retryResponse.ok) {
      const retryParsed = await readJsonResponse(retryResponse, apiKey);
      cleanupResponseTimeout(retryResponse);
      rawResponse = attachNormalizedToolCalls(sanitizeRawResponse(retryParsed.data, apiKey));
      break;
    }
    const retryParsed = await readJsonResponse(retryResponse, apiKey);
    cleanupResponseTimeout(retryResponse);
    rawResponse = attachNormalizedToolCalls(sanitizeRawResponse(retryParsed.data, apiKey));
    text = extractResponseText(rawResponse);
  }

  if (typeof text !== 'string') {
    return {
      success: false,
      configured: true,
      message: `${provider || '分析模型'} 返回结果缺少文本内容。`,
      model: toModelInfo(provider, modelId, protocol),
      raw_response: rawResponse,
    };
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  if (log) log.info(`${requestLabel} — 非流式请求成功 (${elapsed}s, ${text.length} 字符)`);
  return {
    success: true,
    configured: true,
    text,
    model: toModelInfo(provider, modelId, protocol),
    raw_response: rawResponse,
    usage: extractUsage(rawResponse),
  };
}

module.exports = {
  callTextModel,
};
