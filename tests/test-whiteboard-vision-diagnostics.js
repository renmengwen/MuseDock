const assert = require('node:assert/strict');
const { structuredVision } = require('../server/services/creative/whiteboard/mediaModels');
const { safeVisionDiagnostics } = require('../server/services/creative/whiteboard/visionDiagnostics');

const textConfig = { enabled: true, apiKey: 'fixture-key', baseUrl: 'https://example.invalid/v1',
  modelId: 'gpt-6-astra', supportsMultimodal: true };
const privateText = 'private-provider-canary';
const completeText = JSON.stringify({ ok: true });
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status });

async function checkFailure(fetchResult, category, code = 'UNKNOWN_EXTERNAL_OUTCOME', expectedHttp) {
  let calls = 0; let assessments = 0;
  const requests = [];
  let failure;
  await assert.rejects(structuredVision({ textConfig, prompt: '仅输出测试 JSON',
    validate: () => [], assessCandidate: () => { assessments += 1; }, onRequest: repair => requests.push(repair),
    services: { fetchImpl: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.max_output_tokens, 10000, '诊断不能更改模型输出预算');
      return fetchResult();
    } },
  }), error => { failure = error; return error.code === code; });
  assert.equal(calls, 1, '未知结果不能自动重发请求');
  assert.equal(assessments, 0, '未完成响应不能发布候选');
  assert.deepEqual(requests, [0]);
  assert.equal(failure.diagnostics.category, category);
  assert.equal(failure.diagnostics.httpStatus, expectedHttp);
  assert.equal(JSON.stringify({ message: failure.message, diagnostics: failure.diagnostics }).includes(privateText), false);
  assert.ok(!Object.hasOwn(failure.diagnostics, 'raw_response'));
  return failure;
}

(async () => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    await checkFailure(() => jsonResponse({ error: { message: privateText, code: privateText }, status: 200 }, status),
      'http_rejected', 'VISION_REQUEST_REJECTED', status);
  }
  for (const status of [408, 500, 502, 503, 504]) {
    await checkFailure(() => jsonResponse({ error: { message: privateText } }, status), 'http_error', 'UNKNOWN_EXTERNAL_OUTCOME', status);
  }
  for (const text of [undefined, '', completeText]) {
    const error = await checkFailure(() => jsonResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens', privateText },
      ...(text === undefined ? {} : { output_text: text }), id: privateText }), 'output_limit', 'UNKNOWN_EXTERNAL_OUTCOME', 200);
    assert.equal(error.diagnostics.providerStatus, 'incomplete');
    assert.equal(error.diagnostics.stopReason, 'max_output_tokens');
    assert.equal(error.diagnostics.hasExtractedText, Boolean(text));
    assert.equal(error.diagnostics.responseReceived, true);
  }
  for (const raw of [
    { choices: [{ message: { content: completeText }, finish_reason: 'length' }] },
    { content: [{ type: 'text', text: completeText }], stop_reason: 'max_tokens' },
  ]) await checkFailure(() => jsonResponse(raw), 'output_limit', 'UNKNOWN_EXTERNAL_OUTCOME', 200);
  await checkFailure(() => jsonResponse({ status: 'incomplete', output_text: completeText }), 'response_incomplete', 'UNKNOWN_EXTERNAL_OUTCOME', 200);
  for (const raw of [
    { output: [{ content: [{ type: 'refusal', refusal: privateText }] }] },
    { content: [{ type: 'text', text: completeText }], stop_reason: 'refusal' },
    { choices: [{ message: { content: completeText }, finish_reason: 'content_filter' }] },
  ]) await checkFailure(() => jsonResponse(raw), 'refusal', 'UNKNOWN_EXTERNAL_OUTCOME', 200);
  for (const raw of [{ output: [] }, { output_text: '' }, { output_text: '  ' }]) {
    await checkFailure(() => jsonResponse(raw), 'missing_text', 'UNKNOWN_EXTERNAL_OUTCOME', 200);
  }
  await checkFailure(() => new Response(`<html>${privateText}</html>`, { status: 200 }), 'invalid_response', 'UNKNOWN_EXTERNAL_OUTCOME', 200);
  const network = await checkFailure(() => { throw Object.assign(new Error(privateText), { cause: { code: 'ECONNRESET', message: privateText } }); }, 'network_error');
  assert.equal(network.diagnostics.responseReceived, false);
  await checkFailure(() => { throw Object.assign(new Error(privateText), { name: 'AbortError' }); }, 'timeout');
  await checkFailure(() => { throw Object.assign(new Error(privateText), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }); }, 'timeout');

  const invalidMetadata = await checkFailure(() => jsonResponse({ status: privateText,
    incomplete_details: { reason: privateText }, output: [], headers: { Authorization: privateText } }), 'missing_text', 'UNKNOWN_EXTERNAL_OUTCOME', 200);
  assert.equal(invalidMetadata.diagnostics.providerStatus, undefined);
  assert.equal(invalidMetadata.diagnostics.stopReason, undefined);
  const sanitized = safeVisionDiagnostics({ category: 'output_limit', message: privateText, httpStatus: privateText,
    responseReceived: privateText, raw_response: privateText, providerStatus: privateText, stopReason: privateText });
  assert.deepEqual(Object.keys(sanitized).sort(), ['category', 'message']);
  assert.equal(JSON.stringify(sanitized).includes(privateText), false);

  let calls = 0;
  const requests = [];
  const result = await structuredVision({ textConfig, prompt: '返回测试候选',
    validate: candidate => candidate.ok === true ? [] : ['缺少 ok'], onRequest: repair => requests.push(repair),
    services: { fetchImpl: async () => jsonResponse({ status: 'completed', output_text: ++calls === 1 ? '{invalid' : completeText }) },
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(requests, [0, 1], '已完成响应的格式补正仍共享原有一次预算');
  assert.equal(calls, 2);
  console.log('PASS 白板视觉诊断：真实适配器替身、HTTP 分类、截断/空响应/拒绝/网络/超时、单请求保护、脱敏和格式补正');
})().catch(error => { console.error(error); process.exitCode = 1; });
