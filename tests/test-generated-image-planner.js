const assert = require('assert');
const planner = require('../server/services/creative/generatedImagePlanner');

const sceneSpec = {
  title: '测试视频',
  aspect_ratio: '9:16',
  scenes: [
    { id: 'scene_01', narration_text: '城市夜晚的外卖骑手', visual_text: { headline: '深夜骑手' } },
    { id: 'scene_02', narration_text: '订单量数据从 100 涨到 500', visual_text: { headline: '数据增长' } },
    { id: 'scene_03', narration_text: '平台调度算法的压力', visual_text: { headline: '算法压力' } },
  ],
};

async function run() {
  const prompt = planner.buildPlannerPrompt({
    sceneSpec,
    assetContext: {
      assets: [
        { id: 'article_01', source: 'article', alt: '骑手照片' },
        { id: 'search_01', source: 'search', alt: '城市夜景图库图' },
        { id: 'formal_generated', origin: 'ai_generated', alt: '正式字段生成图' },
        { id: 'legacy_generated', source: 'generated', alt: '旧生成图' },
        { id: 'formal_conflict', origin: 'source_extract', source: 'generated', alt: '正式来源图' },
        { id: 'formal_stock', origin: 'stock_search', alt: '正式字段图库图' },
        { id: 'legacy_pexels', source: 'pexels', alt: '旧 Pexels 图库图' },
        { id: 'formal_source_conflict', origin: 'source_extract', source: 'search', alt: '正式来源优先图' },
        { id: 'formal_stock_conflict', origin: 'stock_search', source: 'article', alt: '正式图库优先图' },
      ],
    },
    maxScenes: 4,
  });
  assert.ok(prompt.includes('scene_01'));
  assert.ok(prompt.includes('article_01'));
  assert.ok(prompt.includes('JSON'));
  assert.ok(prompt.includes('不要因为存在这些图就跳过生图'));
  const articleSection = prompt.split('已有搜索补图')[0];
  assert.ok(!articleSection.includes('search_01'));
  assert.ok(!articleSection.includes('formal_generated'));
  assert.ok(!articleSection.includes('legacy_generated'));
  assert.ok(articleSection.includes('formal_conflict'));
  assert.ok(!articleSection.includes('formal_stock'));
  assert.ok(!articleSection.includes('legacy_pexels'));
  assert.ok(articleSection.includes('formal_source_conflict'));
  assert.ok(!articleSection.includes('formal_stock_conflict'));
  const searchSection = prompt.split('已有搜索补图')[1];
  assert.ok(searchSection.includes('search_01'));
  assert.ok(searchSection.includes('formal_stock'));
  assert.ok(searchSection.includes('legacy_pexels'));
  assert.ok(!searchSection.includes('formal_source_conflict'));
  assert.ok(searchSection.includes('formal_stock_conflict'));

  const parsed = planner.parsePlannerResponse(JSON.stringify({
    plans: [
      { scene_id: 'scene_01', generation_prompt: '深夜城市街头，外卖骑手雨中骑行，电影感，竖幅' },
      { scene_id: 'scene_99', generation_prompt: '不存在的场景' },
      { scene_id: 'scene_03', generation_prompt: '' },
    ],
  }), sceneSpec, { maxScenes: 4 });
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.plans.length, 1);
  assert.strictEqual(parsed.plans[0].scene_id, 'scene_01');

  const badJson = planner.parsePlannerResponse('这不是 JSON```', sceneSpec, { maxScenes: 4 });
  assert.strictEqual(badJson.ok, false);
  assert.match(badJson.message, /不是有效 JSON/);
  const badJsonPlanned = await planner.planGeneratedImages({
    sceneSpec,
    assetContext: { assets: [] },
    services: {
      aiTextModel: {
        callTextModel: async () => ({ success: true, text: '模型嘴瓢了，输出了散文' }),
      },
    },
  });
  assert.strictEqual(badJsonPlanned.success, false);
  assert.match(badJsonPlanned.message, /不是有效 JSON/);

  const quotaPrompt = planner.buildPlannerPrompt({ sceneSpec, assetContext: { assets: [] }, maxScenes: 2 });
  assert.ok(quotaPrompt.includes('最多 2 个'));
  const quotaParsed = planner.parsePlannerResponse(JSON.stringify({
    plans: [
      { scene_id: 'scene_01', generation_prompt: '一' },
      { scene_id: 'scene_02', generation_prompt: '二' },
      { scene_id: 'scene_03', generation_prompt: '三' },
    ],
  }), sceneSpec, { maxScenes: 2 });
  assert.strictEqual(quotaParsed.plans.length, 2);

  const duplicateParsed = planner.parsePlannerResponse(JSON.stringify({
    plans: [
      { scene_id: 'scene_01', generation_prompt: '第一条' },
      { scene_id: 'scene_01', generation_prompt: '重复条' },
      { scene_id: 'scene_02', generation_prompt: '第二场景' },
    ],
  }), sceneSpec, { maxScenes: 4 });
  assert.deepStrictEqual(duplicateParsed.plans.map(plan => plan.scene_id), ['scene_01', 'scene_02']);
  assert.strictEqual(duplicateParsed.plans[0].generation_prompt, '第一条');

  const failed = await planner.planGeneratedImages({
    sceneSpec,
    assetContext: { assets: [] },
    services: {
      aiTextModel: {
        callTextModel: async () => ({ success: false, message: '模型超时' }),
      },
    },
  });
  assert.strictEqual(failed.success, false);
  assert.deepStrictEqual(failed.plans, []);
  assert.match(failed.message, /模型超时/);

  const ok = await planner.planGeneratedImages({
    sceneSpec,
    assetContext: { assets: [] },
    services: {
      aiTextModel: {
        callTextModel: async () => ({
          success: true,
          text: JSON.stringify({ plans: [{ scene_id: 'scene_01', generation_prompt: '深夜骑手主视觉' }] }),
        }),
      },
    },
  });
  assert.strictEqual(ok.success, true);
  assert.strictEqual(ok.plans.length, 1);
  assert.strictEqual(ok.plans[0].scene_id, 'scene_01');

  console.log('test-generated-image-planner passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
