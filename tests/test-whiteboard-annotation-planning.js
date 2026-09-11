const assert = require('node:assert/strict');
const models = require('../server/services/creative/whiteboard/mediaModels');

const region = (x, width, label, weight = 1) => ({ label, region: { x, y: 100, width, height: 800 },
  direction: 'left-to-right', weight, protectedRegions: [] });
const grouped = {
  schemaVersion: 2,
  visualGrouping: { mode: 'independent_clusters', reason: '左侧亲子、中间拉钩人物和右侧情侣之间有连续纸面留白，可以分别揭示。' },
  elements: [region(40, 560, '亲子与玩具', 2), region(650, 570, '拉钩人物'), region(1300, 570, '情侣与纸张')],
};
const continuous = {
  schemaVersion: 2,
  visualGrouping: { mode: 'single_continuous', reason: '树根、树干和枝叶属于同一连续主体，分区会切断相互连接的树干与枝条。' },
  elements: [{ ...region(0, 1920, '完整树木'), region: { x: 0, y: 0, width: 1920, height: 1080 } }],
};
const scene = { id: 'scene_1', cueIds: ['cue_1'], startMs: 2500, endMs: 7000 };
const cues = [{ id: 'cue_1', text: '先说童年的承诺，再说朋友的约定，最后说恋人的永远。', startMs: 2500, endMs: 7000 }];

(async () => {
  assert.deepEqual(models.validateAnnotation(grouped), []);
  assert.deepEqual(models.validateAnnotation(continuous), [], '真实不可分割构图必须仍然允许单区域');
  assert.ok(models.validateAnnotation({ schemaVersion: 1, elements: continuous.elements }).length, '旧版整图模板不能直接通过新候选校验');
  assert.ok(models.validateAnnotation({ schemaVersion: 2, elements: continuous.elements }).some(error => /分组依据|visualGrouping/.test(error)));
  assert.ok(models.validateAnnotation({ ...grouped, elements: continuous.elements }).some(error => /不能合并/.test(error)), '声明多个独立簇却交付一个框必须拒绝');
  assert.ok(models.validateAnnotation({ ...continuous, elements: grouped.elements }).some(error => /不可分割/.test(error)));
  const cutOutside = structuredClone(grouped);
  cutOutside.elements[0].region.x = -1;
  assert.ok(models.validateAnnotation(cutOutside).some(error => /整数矩形/.test(error)));
  const approvalInjection = { ...grouped, approved: true };
  assert.ok(models.validateAnnotation(approvalInjection).some(error => /合同外字段/.test(error)));

  const materialized = models.materializeAnnotation(grouped, scene, 'image-sha', 'timeline-identity');
  assert.equal(materialized.schemaVersion, 1, '正式渲染标注格式保持兼容');
  assert.deepEqual(materialized.elements.map(element => [element.sequence, element.reveal.startMs, element.reveal.durationMs]),
    [[1, 0, 2000], [2, 2000, 1000], [3, 3000, 1000]]);
  assert.equal(materialized.sceneDurationMs - materialized.elements.at(-1).reveal.startMs - materialized.elements.at(-1).reveal.durationMs, 500);

  const prompt = models.annotationPrompt({ scene, cues, revision: '三组按旁白逐一呈现' });
  assert.ok(prompt.includes('先说童年的承诺'));
  assert.ok(prompt.includes('三组按旁白逐一呈现'));
  assert.ok(!prompt.includes('可用整幅画布作一个区域'));
  assert.ok(!prompt.includes('"width":1920'), '不向模型提供可照抄的整图区域实例');

  let calls = 0;
  const textConfig = { enabled: true, apiKey: 'fixture-only', baseUrl: 'https://example.invalid', modelId: 'gpt-6-astra', supportsMultimodal: true };
  const fixed = await models.structuredVision({ textConfig, prompt, validate: models.validateAnnotation, reasoningEffort: 'medium', services: {
    aiTextModel: { callTextModel: async request => {
      calls += 1;
      assert.equal(request.reasoningEffort, 'medium');
      assert.equal(request.maxRetries, 0);
      if (calls === 2) assert.match(request.messages.at(-1).content, /visualGrouping/);
      return { success: true, text: JSON.stringify(calls === 1 ? { schemaVersion: 1, elements: continuous.elements } : grouped) };
    } },
  } });
  assert.equal(calls, 2, '旧模板只允许一次有界补正');
  assert.deepEqual(fixed, grouped);
  calls = 0;
  await assert.rejects(models.structuredVision({ textConfig, prompt, validate: models.validateAnnotation, services: {
    aiTextModel: { callTextModel: async () => { calls += 1; return { success: true, text: JSON.stringify({ ...grouped, elements: continuous.elements }) }; } },
  } }), error => error.code === 'CANDIDATE_INVALID');
  assert.equal(calls, 2, '不能无限补正无效分区');

  const findings = { passed: true, summary: '已逐幕查看图像与区域编号。', issues: [], imageCount: 2,
    sceneReviews: ['scene_1', 'scene_2'].map(sceneId => ({ sceneId, groupsMatchImage: true, orderMatchesNarration: true,
      reason: '可独立呈现的视觉簇分别被完整框选，编号与本幕旁白顺序一致。' })) };
  const reviewContext = { imageCount: 2, annotationSceneIds: ['scene_1', 'scene_2'] };
  assert.deepEqual(models.validateVisualReview(findings, reviewContext), []);
  assert.deepEqual(models.annotationReviewIssues(findings), []);
  assert.ok(models.validateVisualReview({ ...findings, sceneReviews: undefined }, reviewContext).length, '总体通过不能替代逐幕审阅');
  assert.ok(models.validateVisualReview({ ...findings, sceneReviews: [findings.sceneReviews[0], findings.sceneReviews[0]] }, reviewContext).length, '重复场景不能冒充全量审阅');
  const negative = structuredClone(findings);
  negative.sceneReviews[0].groupsMatchImage = false;
  negative.sceneReviews[0].reason = '画面有三个可独立呈现的人物簇，却被一个整图框合并。';
  assert.deepEqual(models.validateVisualReview(negative, reviewContext), [], '负面视觉判断是合法结果，不应为了通过结构校验而改口');
  assert.equal(models.annotationReviewIssues(negative).length, 1, '逐幕不通过必须覆盖 passed=true 的矛盾总评');
  console.log('落墨规划合同通过：独立分组、合法单区域、旧模板补正、串行时钟、逐幕审阅与否定结论保留；真实 provider 调用 0。');
})().catch(error => { console.error(error); process.exitCode = 1; });
