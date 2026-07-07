const { tolerantParseJson } = require('./contentGraphAgent');

function buildSfxPlanningPrompt({ target = {}, rules = {}, sfxLibrary = [], scenes = [] } = {}) {
  return [
    '你是 html-video 自动音效编排助手。',
    '只能返回 JSON，不要返回 Markdown、HTML、CSS、JS、URL、ffmpeg 命令或解释。',
    '音效 ID 只能从 sfx_library 里选择，不要编造新 ID。',
    '输出格式：{"sfx_events":[{"scene_id":"scene_01","time_sec":0.2,"sfx_id":"mixkit-whoosh-fast-transition","confidence":0.8,"intensity":"medium","volume_db":-16,"reason":"标题快速入场"}]}',
    'target：',
    JSON.stringify({
      duration_sec: target.duration_sec ?? target.durationSec ?? target.duration,
      aspect_ratio: target.aspect_ratio ?? target.aspectRatio,
    }),
    'rules：',
    JSON.stringify(rules || {}),
    'sfx_library：',
    JSON.stringify(Array.isArray(sfxLibrary) ? sfxLibrary : []),
    'scenes：',
    JSON.stringify(Array.isArray(scenes) ? scenes : []),
  ].join('\n');
}

function parseSfxPlanningResponse(text) {
  let data;
  try {
    data = tolerantParseJson(text);
  } catch (error) {
    return { success: false, code: 'sfx_ai_parse_failed', message: error.message || '自动音效编排结果不是有效 JSON。', events: [] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, code: 'sfx_ai_parse_failed', message: '自动音效编排结果不是 JSON 对象。', events: [] };
  }
  const events = Array.isArray(data.sfx_events) ? data.sfx_events : [];
  return { success: true, events };
}

async function planSfxEvents({ model, target, rules, sfxLibrary, scenes } = {}) {
  if (!model || typeof model.callTextModel !== 'function') {
    return { success: false, code: 'sfx_ai_not_configured', message: '自动音效编排模型未配置。', events: [] };
  }
  const response = await model.callTextModel({
    messages: [{ role: 'user', content: buildSfxPlanningPrompt({ target, rules, sfxLibrary, scenes }) }],
    audit: { agent: 'sfx-planner', stage: 'audio', sub_stage: 'sfx', attempt: 1 },
  });
  if (!response || response.success === false) {
    return { success: false, code: 'sfx_ai_failed', message: response?.message || '自动音效编排失败。', events: [] };
  }
  return parseSfxPlanningResponse(response.text || response.content || '');
}

module.exports = {
  buildSfxPlanningPrompt,
  parseSfxPlanningResponse,
  planSfxEvents,
};
