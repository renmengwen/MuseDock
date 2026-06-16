const assert = require('assert');

const selectorAgent = require('../server/services/creative-video/html-video/templateSelectorAgent');
const inputAgent = require('../server/services/creative-video/html-video/templateInputAgent');

const sceneSpec = {
  title: 'AI 生成视频的边界',
  aspect_ratio: '16:9',
  scenes: [{
    id: 'scene_01',
    start: 0,
    duration: 6,
    kind: 'text',
    narration_text: '默认生产路径中，AI 只能选择模板和填写结构化字段。',
    captions: [],
    visual_text: {
      headline: '权限收束',
      keywords: ['JSON', '模板', '安全'],
      cards: ['不直接写 HTML', '字段经过校验'],
    },
  }],
};

const compactIndex = [{
  id: 'frame-glitch-title',
  name: '故障风标题',
  description: '高冲突、科技感、故障风标题模板',
  category: 'title',
  best_for: ['科技产品发布', '冲突感开场'],
  aspect_support: ['16:9'],
}, {
  id: 'soft-story-card',
  name: '柔和故事卡片',
  description: '适合生活方式与温和叙事',
  category: 'story',
  best_for: ['生活方式'],
  aspect_support: ['16:9'],
}];

const template = {
  id: 'frame-glitch-title',
  name: '故障风标题',
  description: '高冲突、科技感、故障风标题模板',
  inputs: {
    schema: {
      type: 'object',
      required: ['headline', 'style', 'keywords', 'score'],
      properties: {
        headline: { type: 'string', minLength: 2, maxLength: 8 },
        subtitle: { type: 'string', maxLength: 16 },
        style: { type: 'string', enum: ['glitch', 'clean'] },
        keywords: {
          type: 'array',
          minLength: 1,
          maxLength: 3,
          items: { type: 'string', maxLength: 6 },
        },
        score: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
};

const selectionPrompt = selectorAgent.buildTemplateSelectionPrompt({
  sceneSpec,
  compactIndex,
  target: { aspect_ratio: '16:9', duration: 6 },
});
assert.ok(selectionPrompt.includes('只返回 JSON'));
assert.ok(selectionPrompt.includes('"template_id": "frame-glitch-title"'));
assert.ok(selectionPrompt.includes('"confidence": 0.86'));
assert.ok(selectionPrompt.includes('不要输出 Markdown'));
assert.ok(selectionPrompt.includes('不要输出 HTML'));
assert.ok(selectionPrompt.includes('frame-glitch-title'));

const selectionOk = selectorAgent.parseTemplateSelectionResponse(
  JSON.stringify({
    template_id: 'frame-glitch-title',
    reason: '内容偏科技感和冲突感，适合故障风标题模板',
    confidence: 0.86,
  }),
  { compactIndex },
);
assert.equal(selectionOk.success, true);
assert.equal(selectionOk.template_id, 'frame-glitch-title');
assert.equal(selectionOk.confidence, 0.86);

for (const [label, text, options] of [
  ['Markdown', '```json\n{"template_id":"frame-glitch-title","reason":"ok","confidence":0.8}\n```', { compactIndex }],
  ['完整 HTML', '<!doctype html><html><body>bad</body></html>', { compactIndex }],
  ['未知 template_id', '{"template_id":"unknown","reason":"bad","confidence":0.5}', { compactIndex }],
  ['被过滤 template_id', '{"template_id":"soft-story-card","reason":"bad","confidence":0.5}', {
    compactIndex,
    allowedTemplateIds: ['frame-glitch-title'],
  }],
]) {
  const result = selectorAgent.parseTemplateSelectionResponse(text, options);
  assert.equal(result.success, false, `${label} 应失败`);
  assert.equal(typeof result.user_message, 'string');
  assert.ok(result.user_message.includes('模板') || result.user_message.includes('JSON') || result.user_message.includes('HTML'));
  assert.equal(result.fallback_allowed, true);
  assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length > 0);
}

const inputPrompt = inputAgent.buildTemplateInputPrompt({
  sceneSpec,
  template,
  creativeContext: { input: { raw_text: '请做一个科技感短视频' } },
});
assert.ok(inputPrompt.includes('只返回 JSON'));
assert.ok(inputPrompt.includes('禁止输出 HTML、CSS、JS'));
assert.ok(inputPrompt.includes('inputs.schema'));
assert.ok(inputPrompt.includes('"headline"'));

const inputOk = inputAgent.parseTemplateInputResponse(JSON.stringify({
  headline: '权限收束',
  subtitle: '默认路径只填结构化字段',
  style: 'glitch',
  keywords: ['JSON', '模板'],
  score: 0.9,
}), { template });
assert.equal(inputOk.success, true);
assert.deepEqual(inputOk.inputs.keywords, ['JSON', '模板']);

for (const [label, payload, expectedDiagnostic] of [
  ['缺失 required', { headline: '权限收束', keywords: ['JSON'], score: 0.5 }, '缺少必填字段'],
  ['类型错误', { headline: '权限收束', style: 'glitch', keywords: 'JSON', score: 0.5 }, '类型应为 array'],
  ['超长', { headline: '这个标题已经明显太长了', style: 'glitch', keywords: ['JSON'], score: 0.5 }, '长度不能超过'],
  ['枚举错误', { headline: '权限收束', style: 'retro', keywords: ['JSON'], score: 0.5 }, '必须是以下值之一'],
  ['数组项错误', { headline: '权限收束', style: 'glitch', keywords: ['结构化字段太长'], score: 0.5 }, 'keywords[0] 长度不能超过'],
  ['数值越界', { headline: '权限收束', style: 'glitch', keywords: ['JSON'], score: 2 }, '不能大于'],
]) {
  const result = inputAgent.parseTemplateInputResponse(JSON.stringify(payload), { template });
  assert.equal(result.success, false, `${label} 应失败`);
  assert.equal(result.fallback_allowed, true);
  assert.ok(result.user_message.includes('模板字段'));
  assert.ok(result.diagnostics.some(item => item.includes(expectedDiagnostic)), `${label} diagnostics 应包含 ${expectedDiagnostic}`);
}

const htmlInput = inputAgent.parseJsonOnlyResponse('<script>alert(1)</script>');
assert.equal(htmlInput.success, false);
assert.ok(htmlInput.user_message.includes('HTML'));
assert.equal(htmlInput.fallback_allowed, true);

console.log('html video template agent tests passed');
