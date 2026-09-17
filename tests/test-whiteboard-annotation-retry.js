const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const models = require('../server/services/creative/whiteboard/mediaModels');
const { canvasFor, VISUAL_PRESETS, HANDWRITTEN_PRESET_ID } = require('../server/services/creative/whiteboard/contracts');
const { safeVisionDiagnostics } = require('../server/services/creative/whiteboard/visionDiagnostics');
const textModel = require('../server/services/ai/aiTextModel');
const { createApiCallStore } = require('../server/services/diagnostics/apiCallStore');
const { runWithApiCallContext, flushApiCallRecords } = require('../server/services/diagnostics/apiCallRecorder');

const canvas = canvasFor('4:3');
const visualStyle = VISUAL_PRESETS.find(item => item.id === HANDWRITTEN_PRESET_ID);
const scene = { id: 'scene_1', startMs: 0, endMs: 11853, cueIds: [] };
const badCandidate = { schemaVersion: 3,
  visualGrouping: { mode: 'semantic_regions', reason: '两组词组与各自箭头分别揭示，使用多边形边界避开相邻图形。' },
  elements: [
    { label: '第一组词与箭头', region: { x: 691, y: 356, width: 322, height: 121 },
      polygon: [[832, 356], [1013, 356], [1013, 435], [837, 435], [821, 427], [741, 462], [728, 467], [728, 476], [691, 458], [719, 436], [721, 447], [811, 411], [832, 393]],
      direction: 'right-to-left', weight: 1, protectedRegions: [] },
    { label: '第二组词与箭头', region: { x: 739, y: 577, width: 238, height: 159 },
      polygon: [[783, 577], [977, 577], [977, 654], [827, 654], [758, 736], [739, 727], [802, 642], [783, 642]],
      direction: 'top-to-bottom', weight: 1, protectedRegions: [] },
  ] };
const correctedCandidate = structuredClone(badCandidate);
correctedCandidate.elements[0].polygon[1][0] = 1012;
correctedCandidate.elements[0].polygon[2][0] = 1012;
correctedCandidate.elements[1].polygon[1][0] = 976;
correctedCandidate.elements[1].polygon[2][0] = 976;
correctedCandidate.elements[1].polygon[4][1] = 735;

const config = { enabled: true, provider: 'fixture', apiKey: 'fixture-annotation-secret',
  baseUrl: 'https://example.invalid/v1', modelId: 'fixture-text', protocol: 'openai-responses', supportsMultimodal: true };
const validate = candidate => models.validateAnnotation(candidate, canvas, visualStyle, scene);
const prompt = models.annotationPrompt({ scene, cues: [], canvas, visualStyle, imageTexts: [] });

(async () => {
  const initialErrors = validate(badCandidate);
  assert.equal(initialErrors.length, 2);
  assert.match(initialErrors[0], /区域 1.*第 2 个点 \[1013,356\].*x=691\.\.1012.*y=356\.\.476/);
  assert.match(initialErrors[1], /区域 2.*第 5 个点 \[758,736\].*x=739\.\.976.*y=577\.\.735/);
  assert.deepEqual(validate(correctedCandidate), []);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-annotation-retry-'));
  const store = createApiCallStore({ directory: root });
  try {
    const requests = [];
    const diagnostics = [];
    let calls = 0;
    let assessments = 0;
    const result = await runWithApiCallContext({ store, workflowId: 'boundary-repair-fixture' }, () => models.structuredVision({
      textConfig: config, prompt, validate, onValidation: value => diagnostics.push(value),
      assessCandidate: candidate => { assessments += 1; assert.deepEqual(candidate, correctedCandidate); },
      services: {
        aiTextModel: { callTextModel: request => {
          requests.push(structuredClone(request.messages));
          assert.equal(request.maxRetries, 0);
          return textModel.callTextModel(request);
        } },
        fetchImpl: async () => {
          calls += 1;
          if (calls === 2) {
            const feedback = requests.at(-1).at(-1).content;
            assert.ok(initialErrors.every(error => feedback.includes(error)), '一次补正必须收到全部具体坐标问题');
            assert.match(feedback, /保留已正确的分区/);
            assert.deepEqual(JSON.parse(requests.at(-1).at(-2).content), badCandidate, '补正保留上一份完整候选');
          }
          return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(calls === 1 ? badCandidate : correctedCandidate),
            validationErrors: ['private-provider-error-canary'] }), { headers: { 'content-type': 'application/json' } });
        },
      },
    }));
    assert.deepEqual(result, correctedCandidate);
    assert.equal(calls, 2, '首个请求加一次定向补正');
    assert.equal(assessments, 1, '无效候选不得进入预览或发布');
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].category, 'candidate_invalid');
    assert.equal(diagnostics[0].httpStatus, 200);
    assert.deepEqual(diagnostics[0].validationErrors, initialErrors);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private-provider-error-canary|fixture-annotation-secret/);
    assert.deepEqual(safeVisionDiagnostics(JSON.parse(JSON.stringify(diagnostics[0]))), diagnostics[0]);
    await flushApiCallRecords();
    const records = store.list({ workflowId: 'boundary-repair-fixture' }).records.sort((a, b) => a.sequence - b.sequence);
    assert.equal(records.length, 2);
    assert.deepEqual(records.map(record => record.state), ['invalid', 'success']);
    assert.deepEqual(records[0].validation, initialErrors);
    assert.deepEqual(records[1].validation, []);
    assert.deepEqual(JSON.parse(JSON.parse(store.get(records[0].id).body_text).output_text), badCandidate, '原始返回单独保留，不覆盖失败证据');

    let failedCalls = 0;
    const failedDiagnostics = [];
    await assert.rejects(models.structuredVision({ textConfig: config, prompt, validate,
      onValidation: value => failedDiagnostics.push(value), services: {
        aiTextModel: { callTextModel: async () => { failedCalls += 1; return { success: true, text: JSON.stringify(badCandidate) }; } },
        fetchImpl: async () => { throw new Error('测试禁止真实网络请求'); },
      },
    }), error => error.code === 'CANDIDATE_INVALID' && error.diagnostics.validationErrors.every((value, index) => value === initialErrors[index]));
    assert.equal(failedCalls, 2, '仍然无效时不能无限重试');
    assert.equal(failedDiagnostics.length, 2, '首次和补正失败都保留具体原因');
    const safe = safeVisionDiagnostics({ category: 'candidate_invalid', message: 'private-provider-error-canary',
      raw_response: 'private-provider-error-canary', validationErrors: [`API Key=${config.apiKey}`, null] }, [config.apiKey]);
    assert.doesNotMatch(JSON.stringify(safe), /fixture-annotation-secret|private-provider-error-canary/);
    assert.equal(safe.validationErrors.length, 1);
    assert.equal(safeVisionDiagnostics({ category: 'timeout', validationErrors: ['private-provider-error-canary'] }).validationErrors, undefined);
    const long = safeVisionDiagnostics({ category: 'candidate_invalid', validationErrors: Array(65).fill('错'.repeat(3000)) });
    assert.equal(long.validationErrors.length, 64);
    assert.equal(long.validationErrors[0].length, 2048);
    assert.equal(long.validationTruncated, true);
    console.log('PASS 落墨定向补正：真实边界回归、逐点反馈、原候选保留、一次补正预算、请求诊断与 API 日志；真实 provider 调用 0。');
  } finally {
    await flushApiCallRecords();
    store.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('musedock-annotation-retry-'));
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
