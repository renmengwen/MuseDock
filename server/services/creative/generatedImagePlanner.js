const defaultAiTextModel = require('../ai/aiTextModel');

const DEFAULT_MAX_SCENES = 4;

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sceneIdSet(sceneSpec = {}) {
  return new Set((Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [])
    .map(scene => safeString(scene?.id))
    .filter(Boolean));
}

function buildPlannerPrompt({ sceneSpec = {}, assetContext = {}, maxScenes = DEFAULT_MAX_SCENES } = {}) {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const assets = Array.isArray(assetContext.assets) ? assetContext.assets : [];
  const sceneLines = scenes.map(scene => {
    const headline = safeString(scene?.visual_text?.headline);
    return `- ${scene.id}：${safeString(scene.narration_text).slice(0, 120)}${headline ? `（画面标题：${headline}）` : ''}`;
  });
  const describeAsset = asset => `- ${safeString(asset.id)}：${safeString(asset.alt || asset.title).slice(0, 80)}`;
  const articleAssets = assets.filter(asset => asset.source !== 'search' && asset.source !== 'generated');
  const searchAssets = assets.filter(asset => asset.source === 'search');
  const quota = Math.min(DEFAULT_MAX_SCENES, Math.max(0, Math.round(Number(maxScenes) || DEFAULT_MAX_SCENES)));
  return [
    '你是短视频主视觉规划器。请只输出严格 JSON，不要输出 Markdown、解释或额外文本。',
    '',
    `任务：从下列场景中挑选最多 ${quota} 个"缺少强来源素材、但非常需要具象主视觉"的场景，为每个场景写一条 AI 生图 prompt。`,
    '',
    '场景列表：',
    ...(sceneLines.length ? sceneLines : ['（无）']),
    '',
    '已有来源图片（article，真实来源素材，这些图片能覆盖的主题不需要重复生图）：',
    ...(articleAssets.length ? articleAssets.map(describeAsset) : ['（无）']),
    '',
    '已有搜索补图（search/Pexels，只能做背景/氛围，不能作为主视觉，不要因为存在这些图就跳过生图）：',
    ...(searchAssets.length ? searchAssets.map(describeAsset) : ['（无）']),
    '',
    '挑选规则：',
    '- 适合生图：产品、人物、地点、事件、情绪、氛围、隐喻等具象画面。',
    '- 不要选：数据、流程、时间线、代码结构类场景（这些由 HTML 动画表达更清楚）。',
    '- 只有 article 来源图片能覆盖的主题才不重复生图；search/Pexels 补图不算覆盖。',
    '- 一个都不适合时输出空数组。',
    '',
    'generation_prompt 写法要求：',
    '- 用中文，60~200 字，描述画面主体、环境、光线、构图和风格，竖幅短视频风格。',
    '- 基于场景旁白的事实，不要虚构来源中没有的具体人名、品牌、数据。',
    '- 不要把旁白原文直接当 prompt。',
    '',
    '输出 JSON schema：',
    JSON.stringify({ plans: [{ scene_id: 'scene_01', generation_prompt: 'string' }] }, null, 2),
  ].join('\n');
}

function parsePlannerResponse(text, sceneSpec = {}, { maxScenes = DEFAULT_MAX_SCENES } = {}) {
  let data = null;
  try {
    const raw = safeString(text).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    data = JSON.parse(raw);
  } catch {
    return { ok: false, plans: [], message: '主视觉规划输出不是有效 JSON。' };
  }
  const validSceneIds = sceneIdSet(sceneSpec);
  const seen = new Set();
  const quota = Math.min(DEFAULT_MAX_SCENES, Math.max(0, Math.round(Number(maxScenes) || DEFAULT_MAX_SCENES)));
  const plans = (Array.isArray(data?.plans) ? data.plans : [])
    .map(plan => ({
      scene_id: safeString(plan?.scene_id),
      generation_prompt: safeString(plan?.generation_prompt),
    }))
    .filter(plan => plan.scene_id && plan.generation_prompt && validSceneIds.has(plan.scene_id))
    .filter(plan => {
      if (seen.has(plan.scene_id)) return false;
      seen.add(plan.scene_id);
      return true;
    })
    .slice(0, quota);
  return { ok: true, plans };
}

async function planGeneratedImages({ sceneSpec = {}, assetContext = {}, maxScenes = DEFAULT_MAX_SCENES, services = {} } = {}) {
  const aiTextModel = services.aiTextModel || defaultAiTextModel;
  const prompt = buildPlannerPrompt({ sceneSpec, assetContext, maxScenes });
  const response = await aiTextModel.callTextModel({
    audit: {
      agent: 'generated_image_planner',
      stage: 'gen_images',
      sub_stage: 'plan_generated_images',
    },
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  });
  if (!response || response.success === false) {
    return { success: false, plans: [], message: response?.message || '主视觉规划模型调用失败。' };
  }
  const parsed = parsePlannerResponse(response.text, sceneSpec, { maxScenes });
  if (!parsed.ok) return { success: false, plans: [], message: parsed.message };
  return {
    success: true,
    plans: parsed.plans,
    message: parsed.plans.length ? `已规划 ${parsed.plans.length} 个生图场景。` : '没有需要生图的场景。',
  };
}

module.exports = {
  DEFAULT_MAX_SCENES,
  buildPlannerPrompt,
  parsePlannerResponse,
  planGeneratedImages,
};
