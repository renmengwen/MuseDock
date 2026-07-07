const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const aiModelConfig = require('../server/services/ai/aiModelConfig');
const aiTextModel = require('../server/services/ai/aiTextModel');

function makeStreamResponse(chunks) {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(chunk instanceof Uint8Array ? chunk : encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-text-model-test-'));
  const configPath = path.join(root, 'ai-models.json');

  const missing = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'hello' }],
    configPath,
  });
  assert.strictEqual(missing.success, false);
  assert.strictEqual(missing.configured, false);
  assert.match(missing.message, /分析模型未配置/);

  await aiModelConfig.saveConfig({
    models: {
      text: {
        enabled: true,
        provider: 'OpenAI',
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com/v1/',
        modelId: 'gpt-test',
        note: '',
      },
    },
  }, { configPath });

  let requestedUrl = '';
  let requestedOptions = null;
  const ok = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: '生成 JSON' }],
    configPath,
    response_format: { type: 'json_object' },
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"summary":"ok"}' } }],
          debug: { request: { authorization: 'Bearer sk-test' } },
        }),
      };
    },
  });

  assert.strictEqual(ok.success, true);
  assert.strictEqual(ok.text, '{"summary":"ok"}');
  assert.strictEqual(ok.model.provider, 'OpenAI');
  assert.strictEqual(ok.model.model_id, 'gpt-test');
  assert.strictEqual(ok.usage, null);
  assert.doesNotMatch(JSON.stringify(ok.raw_response), /sk-test/);
  assert.strictEqual(requestedUrl, 'https://api.example.com/v1/chat/completions');
  assert.strictEqual(requestedOptions.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(requestedOptions.body);
  assert.strictEqual(body.model, 'gpt-test');
  assert.deepStrictEqual(body.messages, [{ role: 'user', content: '生成 JSON' }]);
  assert.deepStrictEqual(body.response_format, { type: 'json_object' });
  assert.ok(requestedOptions.signal, 'text model requests should include an AbortSignal');
  assert.strictEqual(typeof requestedOptions.signal.aborted, 'boolean');

  const usageResult = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'usage' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'usage ok' } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 3,
          total_tokens: 13,
          prompt_tokens_details: {
            cached_tokens: 4,
          },
        },
      }),
    }),
  });
  assert.strictEqual(usageResult.success, true);
  assert.deepStrictEqual(usageResult.usage, {
    prompt_tokens: 10,
    completion_tokens: 3,
    total_tokens: 13,
    cached_tokens: 4,
  });

  const usageAliasResult = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'usage alias' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'usage alias ok' } }],
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          input_token_details: {
            cached_tokens: 7,
          },
        },
      }),
    }),
  });
  assert.strictEqual(usageAliasResult.success, true);
  assert.deepStrictEqual(usageAliasResult.usage, {
    prompt_tokens: 12,
    completion_tokens: 4,
    total_tokens: null,
    cached_tokens: 7,
  });

  const usageInvalidNumberResult = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'usage invalid number' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'usage invalid ok' } }],
        usage: {
          prompt_tokens: 'bad',
          completion_tokens: 2,
        },
      }),
    }),
  });
  assert.strictEqual(usageInvalidNumberResult.success, true);
  assert.deepStrictEqual(usageInvalidNumberResult.usage, {
    prompt_tokens: null,
    completion_tokens: 2,
    total_tokens: null,
    cached_tokens: null,
  });

  let injectedRequestOptions = null;
  const injected = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'injected config' }],
    textConfig: {
      enabled: true,
      provider: 'InjectedProvider',
      apiKey: 'sk-injected',
      baseUrl: 'https://injected.example.com/v1/',
      modelId: 'injected-model',
    },
    fetchImpl: async (url, options) => {
      assert.strictEqual(url, 'https://injected.example.com/v1/chat/completions');
      injectedRequestOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'injected ok' } }],
        }),
      };
    },
  });
  assert.strictEqual(injected.success, true);
  assert.strictEqual(injected.text, 'injected ok');
  assert.strictEqual(injected.model.provider, 'InjectedProvider');
  assert.strictEqual(injected.model.model_id, 'injected-model');
  assert.strictEqual(injectedRequestOptions.headers.Authorization, 'Bearer sk-injected');
  assert.strictEqual(JSON.parse(injectedRequestOptions.body).model, 'injected-model');

  const failed = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'fail' }],
    configPath,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          message: 'rate limited sk-test',
          details: {
            headers: {
              authorization: 'Bearer sk-test',
            },
          },
        },
      }),
    }),
  });
  assert.strictEqual(failed.success, false);
  assert.strictEqual(failed.configured, true);
  assert.match(failed.message, /rate limited/);
  assert.doesNotMatch(failed.message, /sk-test/);
  assert.doesNotMatch(JSON.stringify(failed.raw_response), /sk-test/);

  const plainTextFailed = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'plain text fail' }],
    configPath,
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      headers: { get: () => 'text/plain; charset=utf-8' },
      text: async () => 'This chat was flagged for possible cybersecurity risk sk-test',
    }),
  });
  assert.strictEqual(plainTextFailed.success, false);
  assert.match(plainTextFailed.message, /possible cybersecurity risk/);
  assert.doesNotMatch(plainTextFailed.message, /sk-test/);

  let retryCalls = 0;
  const retried = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'retry timeout' }],
    configPath,
    retryDelayMs: 1,
    fetchImpl: async () => {
      retryCalls += 1;
      if (retryCalls === 1) {
        return {
          ok: false,
          status: 504,
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'retry ok' } }],
        }),
      };
    },
  });
  assert.strictEqual(retried.success, true);
  assert.strictEqual(retried.text, 'retry ok');
  assert.strictEqual(retryCalls, 2);

  let streamRequestBody = null;
  const streamed = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'stream json' }],
    configPath,
    stream: true,
    fetchImpl: async (url, options) => {
      assert.strictEqual(url, 'https://api.example.com/v1/chat/completions');
      streamRequestBody = JSON.parse(options.body);
      return new Response(
        makeStreamResponse([
          'data: {"choices":[{"delta":{"content":"{\\"summary\\":"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"\\"stream ok\\"}"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    },
  });
  assert.strictEqual(streamed.success, true);
  assert.strictEqual(streamed.text, '{"summary":"stream ok"}');
  assert.strictEqual(streamRequestBody.stream, true);
  assert.strictEqual(streamed.usage, null);

  const encoder = new TextEncoder();
  const splitChineseBytes = encoder.encode('data: {"choices":[{"delta":{"content":"中文正常"}}]}\n\n');
  const splitPoint = 'data: {"choices":[{"delta":{"content":"'.length + 1;
  const streamedSplitUtf8 = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'stream split utf8' }],
    configPath,
    stream: true,
    fetchImpl: async () => new Response(
      makeStreamResponse([
        splitChineseBytes.slice(0, splitPoint),
        splitChineseBytes.slice(splitPoint),
        'data: [DONE]\n\n',
      ]),
      {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      },
    ),
  });
  assert.strictEqual(streamedSplitUtf8.success, true);
  assert.strictEqual(streamedSplitUtf8.text, '中文正常');
  assert.doesNotMatch(streamedSplitUtf8.text, /\uFFFD/);

  const fallbackBodies = [];
  const streamFallback = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'stream fallback' }],
    configPath,
    stream: true,
    maxRetries: 1,
    retryDelayMs: 1,
    fallbackToNonStreamOnGatewayTimeout: true,
    fetchImpl: async (url, options) => {
      assert.strictEqual(url, 'https://api.example.com/v1/chat/completions');
      const requestBody = JSON.parse(options.body);
      fallbackBodies.push(requestBody);
      if (fallbackBodies.length <= 2) {
        return {
          ok: false,
          status: 504,
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'non-stream fallback ok' } }],
        }),
      };
    },
  });
  assert.strictEqual(streamFallback.success, true);
  assert.strictEqual(streamFallback.text, 'non-stream fallback ok');
  assert.strictEqual(fallbackBodies.length, 3);
  assert.strictEqual(fallbackBodies[0].stream, true);
  assert.strictEqual(fallbackBodies[1].stream, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(fallbackBodies[2], 'stream'), false);
  assert.deepStrictEqual(streamFallback.fallback, {
    from_stream: true,
    reason: 'gateway_timeout',
  });

  let timeoutCalls = 0;
  const timeoutRetry = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'timeout retry' }],
    configPath,
    stream: true,
    maxRetries: 2,
    retryDelayMs: 1,
    requestTimeoutMs: 50,
    fetchImpl: async () => {
      timeoutCalls += 1;
      if (timeoutCalls <= 2) {
        const err = new Error('分析模型请求超时：0 秒内未返回结果。');
        err.name = 'AbortError';
        throw err;
      }
      return new Response(
        makeStreamResponse([
          'data: {"choices":[{"delta":{"content":"timeout retry ok"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  assert.strictEqual(timeoutRetry.success, true);
  assert.strictEqual(timeoutRetry.text, 'timeout retry ok');
  assert.strictEqual(timeoutCalls, 3);

  let timeoutExhaustedCalls = 0;
  const timeoutExhausted = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'timeout exhausted' }],
    configPath,
    stream: true,
    maxRetries: 1,
    retryDelayMs: 1,
    requestTimeoutMs: 50,
    fetchImpl: async () => {
      timeoutExhaustedCalls += 1;
      const err = new Error('分析模型请求超时：0 秒内未返回结果。');
      err.name = 'AbortError';
      throw err;
    },
  });
  assert.strictEqual(timeoutExhausted.success, false);
  assert.strictEqual(timeoutExhaustedCalls, 2);
  assert.match(timeoutExhausted.message, /超时/);

  let timeoutFallbackCalls = 0;
  const timeoutFallback = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'timeout fallback' }],
    configPath,
    stream: true,
    maxRetries: 1,
    retryDelayMs: 1,
    requestTimeoutMs: 50,
    fallbackToNonStreamOnGatewayTimeout: true,
    fetchImpl: async (url, options) => {
      timeoutFallbackCalls += 1;
      const body = JSON.parse(options.body);
      if (timeoutFallbackCalls <= 2 && body.stream !== false) {
        const err = new Error('分析模型请求超时：0 秒内未返回结果。');
        err.name = 'AbortError';
        throw err;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'timeout fallback ok' } }],
        }),
      };
    },
  });
  assert.strictEqual(timeoutFallback.success, true);
  assert.strictEqual(timeoutFallback.text, 'timeout fallback ok');
  assert.deepStrictEqual(timeoutFallback.fallback, {
    from_stream: true,
    reason: 'stream_timeout',
  });

  const streamReadTimeoutBodies = [];
  const streamReadTimeoutFallback = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'stream read timeout fallback' }],
    configPath,
    stream: true,
    maxRetries: 0,
    retryDelayMs: 1,
    requestTimeoutMs: 50,
    fallbackToNonStreamOnGatewayTimeout: true,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      streamReadTimeoutBodies.push(body);
      if (body.stream === true) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
          },
          pull() {
            const err = new Error('分析模型请求超时：0 秒内未返回结果。');
            err.name = 'AbortError';
            throw err;
          },
        });
        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'stream read timeout fallback ok' } }],
        }),
      };
    },
  });
  assert.strictEqual(streamReadTimeoutFallback.success, true);
  assert.strictEqual(streamReadTimeoutFallback.text, 'stream read timeout fallback ok');
  assert.strictEqual(streamReadTimeoutBodies.length, 2);
  assert.strictEqual(streamReadTimeoutBodies[0].stream, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(streamReadTimeoutBodies[1], 'stream'), false);
  assert.deepStrictEqual(streamReadTimeoutFallback.fallback, {
    from_stream: true,
    reason: 'stream_timeout',
  });

  let networkRetryCalls = 0;
  const networkRetried = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'network retry' }],
    configPath,
    retryDelayMs: 1,
    maxRetries: 1,
    fetchImpl: async () => {
      networkRetryCalls += 1;
      if (networkRetryCalls === 1) {
        const err = new TypeError('fetch failed');
        err.cause = Object.assign(new Error('connect ETIMEDOUT 104.21.73.139:443'), {
          code: 'ETIMEDOUT',
        });
        throw err;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'network retry ok' } }],
        }),
      };
    },
  });
  assert.strictEqual(networkRetried.success, true);
  assert.strictEqual(networkRetried.text, 'network retry ok');
  assert.strictEqual(networkRetryCalls, 2);

  const networkFailed = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'network fail' }],
    configPath,
    fetchImpl: async () => {
      const err = new TypeError('fetch failed');
      err.cause = Object.assign(new Error('connect ECONNRESET 104.21.73.139:443'), {
        code: 'ECONNRESET',
      });
      throw err;
    },
  });
  assert.strictEqual(networkFailed.success, false);
  assert.strictEqual(networkFailed.configured, true);
  assert.strictEqual(networkFailed.model.provider, 'OpenAI');
  assert.strictEqual(networkFailed.model.model_id, 'gpt-test');
  assert.match(networkFailed.message, /分析模型调用失败/);
  assert.match(networkFailed.message, /ECONNRESET/);
  assert.match(networkFailed.message, /connect ECONNRESET/);
  assert.doesNotMatch(networkFailed.message, /sk-test/);

  const invalidJson = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'invalid json' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json sk-test');
      },
    }),
  });
  assert.strictEqual(invalidJson.success, false);
  assert.strictEqual(invalidJson.configured, true);
  assert.match(invalidJson.message, /缺少文本内容/);
  assert.doesNotMatch(invalidJson.message, /sk-test/);

  const htmlResponse = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'html response' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: name => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
      },
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
      text: async () => '<!doctype html><html><title>PipeApi - AI API Gateway</title></html>',
    }),
  });
  assert.strictEqual(htmlResponse.success, false);
  assert.strictEqual(htmlResponse.configured, true);
  assert.match(htmlResponse.message, /返回了非 JSON 响应/);
  assert.match(htmlResponse.message, /Base URL/);
  assert.match(htmlResponse.raw_response.preview, /PipeApi/);
  assert.doesNotMatch(htmlResponse.message, /sk-test/);
  assert.doesNotMatch(JSON.stringify(htmlResponse.raw_response), /sk-test/);

  const missingText = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'missing text' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: {} }] }),
    }),
  });
  assert.strictEqual(missingText.success, false);
  assert.strictEqual(missingText.configured, true);
  assert.match(missingText.message, /缺少文本内容/);
  assert.doesNotMatch(missingText.message, /sk-test/);

  const contentParts = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'content parts' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: [
              { type: 'text', text: '数组' },
              { type: 'text', text: '内容' },
            ],
          },
        }],
      }),
    }),
  });
  assert.strictEqual(contentParts.success, true);
  assert.strictEqual(contentParts.text, '数组内容');

  let missingTextAttempts = 0;
  const missingTextRetry = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'missing text retry' }],
    configPath,
    maxRetries: 1,
    retryDelayMs: 1,
    fetchImpl: async () => {
      missingTextAttempts += 1;
      return {
        ok: true,
        status: 200,
        json: async () => missingTextAttempts === 1
          ? ({ choices: [{ message: { content: null } }] })
          : ({ choices: [{ message: { content: '重试成功' } }] }),
      };
    },
  });
  assert.strictEqual(missingTextRetry.success, true);
  assert.strictEqual(missingTextRetry.text, '重试成功');
  assert.strictEqual(missingTextAttempts, 2);
}

run().then(() => {
  console.log('ai text model tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
