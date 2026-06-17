const assert = require('assert');

const agent = require('../server/services/creative-video/html-video/frameHtmlAgent');

const graph = {
  synopsis: '两帧讲清价格差异',
  nodes: [
    { id: 'scene_01', kind: 'data', label: '基础版', durationSec: 3, data: { title: '价格', unit: '元', items: [{ label: '基础版', value: 12 }] } },
    { id: 'scene_02', kind: 'text', label: '专业版', durationSec: 3, text: '专业版适合团队协作。' },
  ],
  edges: [{ from: 'scene_01', to: 'scene_02', kind: 'sequence' }],
};

const prompt = agent.buildFrameHtmlPrompt({
  graph,
  node: graph.nodes[0],
  index: 0,
  total: 2,
  sceneSpec: {
    title: '价格对比',
    scenes: [
      { id: 'scene_01', narration_text: '先看基础版价格。' },
      { id: 'scene_02', narration_text: '再看专业版。' },
    ],
  },
  creativeContext: {
    input: { title: '原始标题', raw_text: '原始内容。' },
    source_context: { summary: '来源摘要。' },
    brief: { summary: '简短解释价格。' },
    comments_summary: '评论关注价格门槛。',
    secondary_comments_summary: '二级评论追问团队价。',
    audio: { narration_text: '旁白摘要。' },
  },
  target: { resolution: { width: 1920, height: 1080 }, aspect_ratio: '16:9' },
  template: {
    id: 'bold_signal',
    name: '信号卡片',
    description: '深色背景和橙色焦点卡片滑入。',
    tags: ['产品', '功能'],
    inputs: { examples: [{ card_title: '带上你自己的 Agent。' }] },
  },
});

assert.match(prompt, /scene_01/);
assert.match(prompt, /1\/2/);
assert.match(prompt, /基础版/);
assert.match(prompt, /两帧讲清价格差异/);
assert.match(prompt, /下一帧/);
assert.match(prompt, /专业版/);
assert.match(prompt, /1920x1080/);
assert.match(prompt, /信号卡片/);
assert.match(prompt, /深色背景和橙色焦点卡片滑入/);
assert.match(prompt, /来源摘要/);
assert.match(prompt, /原始内容/);
assert.match(prompt, /简短解释价格/);
assert.match(prompt, /评论关注价格门槛/);
assert.match(prompt, /二级评论追问团队价/);
assert.match(prompt, /旁白摘要/);
assert.match(prompt, /```html/);
assert.match(prompt, /完整 HTML/);
assert.match(prompt, /full-bleed/);
assert.match(prompt, /data-/);
assert.match(prompt, /不要输出解释/);
assert.match(prompt, /不要让每一帧都使用相同主布局/);
assert.match(prompt, /不要只改底部 caption/);
assert.match(prompt, /Search \/ GitHub \/ Tech Forums \/ Docs \/ Issues/);
assert.match(prompt, /\[object Object\]/);
assert.match(prompt, /不要发明源素材中没有的精确事实/);

const fenced = agent.extractHtmlDocument([
  '说明',
  '```html',
  '<!doctype html><html><head><title>A</title></head><body><main>A</main></body></html>',
  '```',
].join('\n'));
assert.equal(fenced.success, true);
assert.match(fenced.html, /<!doctype html>/i);

const raw = agent.extractHtmlDocument('<!DOCTYPE html><html><body>Raw</body></html>');
assert.equal(raw.success, true);
assert.match(raw.html, /Raw/);

const rawWithProse = agent.extractHtmlDocument('Here is the HTML:\n<!doctype html><html><body>ok</body></html>\nThanks');
assert.equal(rawWithProse.success, true);
assert.equal(rawWithProse.html, '<!doctype html><html><body>ok</body></html>');

assert.equal(agent.extractHtmlDocument('').success, false);
assert.equal(agent.extractHtmlDocument('这里只是解释，没有 HTML').success, false);

(async () => {
  let calls = 0;
  const result = await agent.generateFrameHtml({
    model: {
      callTextModel: async ({ messages }) => {
        calls += 1;
        const promptText = messages[0].content;
        if (calls === 1) {
          assert.match(promptText, /scene_01/);
          return { success: true, text: '不是 HTML' };
        }
        assert.match(promptText, /只返回一个完整 HTML/);
        return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01">OK</main></body></html>' };
      },
    },
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
  });
  assert.equal(result.success, true);
  assert.equal(calls, 2);
  assert.match(result.html, /data-frame-id/);

  const failed = await agent.generateFrameHtml({
    model: { callTextModel: async () => ({ success: true, text: '仍然不是 HTML' }) },
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
  });
  assert.equal(failed.success, false);
  assert.match(failed.message, /未返回有效 HTML/);

  console.log('html-video frame html agent tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
