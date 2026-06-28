const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
      { id: 'scene_03', narration_text: '第三帧完整旁白不应进入当前帧 prompt。' },
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
assert.match(prompt, /data-text-key="headline"/);
assert.match(prompt, /data-text-key="subtitle"/);
assert.match(prompt, /data-text-key="body"/);
assert.match(prompt, /data-hv-canvas/);
assert.match(prompt, /captions|字幕/);
assert.match(prompt, /不要输出解释/);
assert.match(prompt, /不要让每一帧都使用相同主布局/);
assert.match(prompt, /不要只改底部 caption/);
assert.match(prompt, /Search \/ GitHub \/ Tech Forums \/ Docs \/ Issues/);
assert.match(prompt, /\[object Object\]/);
assert.match(prompt, /不要发明源素材中没有的精确事实/);
assert.doesNotMatch(prompt, /第三帧完整旁白不应进入当前帧 prompt/);

const dynamicInputIndex = prompt.indexOf('---- 本次动态输入 ----');
assert.notEqual(dynamicInputIndex, -1);
[
  '固定系统规则：',
  '硬性要求：',
  'Selected template metadata',
].forEach(label => {
  const index = prompt.indexOf(label);
  assert.notEqual(index, -1);
  assert.ok(index < dynamicInputIndex, `${label} should be before dynamic input`);
});
[
  '当前帧：',
  '当前 frame content graph node：',
  'scene_spec 摘要：',
].forEach(label => {
  const index = prompt.indexOf(label);
  assert.notEqual(index, -1);
  assert.ok(index > dynamicInputIndex, `${label} should be after dynamic input`);
});

const assetPrompt = agent.buildFrameHtmlPrompt({
  graph,
  node: graph.nodes[0],
  index: 0,
  total: 2,
  creativeContext: {
    source_context: { summary: '来源摘要。' },
    asset_context: {
      status: 'ready',
      assets: [{
        id: 'article_01',
        source: 'article',
        alt: '价格表截图',
        path: 'assets/source-image-01.png',
        frame_src: '../assets/source-image-01.png',
      }],
    },
  },
  target: { resolution: { width: 1920, height: 1080 } },
});

assert.match(assetPrompt, /可用图片素材/);
assert.match(assetPrompt, /\.\.\/assets\/source-image-01\.png/);
assert.match(assetPrompt, /禁止引用外部图片 URL/);
assert.match(assetPrompt, /object-fit: contain/);
assert.match(assetPrompt, /不要做纯图片轮播/);

const continuityPrompt = agent.buildFrameHtmlPrompt({
  graph,
  node: graph.nodes[1],
  index: 1,
  total: 2,
  target: { resolution: { width: 1920, height: 1080 } },
  template: {
    id: 'bold_signal',
    name: '信号卡片',
    description: '深色背景和橙色焦点卡片滑入。',
  },
  visualStyleReferenceHtml: '<!doctype html><html><body><main class="orange-signal" style="background:#1a1a1a;color:#FF5722"><h1>首帧视觉锚点</h1></main></body></html>',
  previousFrameHtml: '<!doctype html><html><body><main class="orange-flow"><section>上一帧橙黑流程图</section></main></body></html>',
});

assert.match(continuityPrompt, /全片视觉锚点|视觉锚点/);
assert.match(continuityPrompt, /相邻上一帧|上一帧 HTML/);
assert.match(continuityPrompt, /orange-signal/);
assert.match(continuityPrompt, /#1a1a1a/);
assert.match(continuityPrompt, /#FF5722/);
assert.match(continuityPrompt, /orange-flow/);
assert.match(continuityPrompt, /保持同一套调色板、字体、背景语言、组件形状和 motion vocabulary/);
assert.match(continuityPrompt, /允许当前帧更换构图/);
assert.match(continuityPrompt, /不要切换到新的蓝紫科技风|不要另起一套视觉主题/);

const templateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-html-template-'));
const templateSourcePath = path.join(templateDir, 'source.html');
fs.writeFileSync(templateSourcePath, [
  '<!doctype html>',
  '<html><head><style>',
  '@keyframes heroEnter { from { transform: translateY(80px); } to { transform: translateY(0); } }',
  '.hero { animation: heroEnter 900ms ease-out both; }',
  '</style></head><body><main class="hero">模板源码动效</main></body></html>',
].join('\n'));

const sourceBackedPrompt = agent.buildFrameHtmlPrompt({
  graph,
  node: { ...graph.nodes[0], durationSec: 8 },
  index: 0,
  total: 2,
  target: { resolution: { width: 1920, height: 1080 } },
  template: {
    id: 'source_backed_template',
    name: '带源码模板',
    description: '模板源码内有主体入场动画。',
    __dir: templateDir,
    source_entry: 'source.html',
    tags: ['motion'],
    inputs: { examples: [{ headline: '示例' }] },
  },
});

assert.match(sourceBackedPrompt, /Template HTML/);
assert.match(sourceBackedPrompt, /REQUIRED visual style/i);
assert.match(sourceBackedPrompt, /@keyframes heroEnter/);
assert.match(sourceBackedPrompt, /模板源码动效/);
assert.match(sourceBackedPrompt, /opens with an animation timeline/i);
assert.match(sourceBackedPrompt, /window\.__hvPlayAll|GSAP|@keyframes|animation/);
assert.match(sourceBackedPrompt, /超过 6 秒|长于 6 秒/);
assert.match(sourceBackedPrompt, /sub-beats/);
assert.match(sourceBackedPrompt, /主体/);
assert.match(sourceBackedPrompt, /禁止只有角落|不要只有角落/);

const retryPrompt = agent.buildRetryPrompt({
  node: { id: 'scene_01', durationSec: 8 },
  target: { resolution: { width: 1920, height: 1080 } },
});
assert.match(retryPrompt, /animation timeline/i);
assert.match(retryPrompt, /window\.__hvPlayAll|GSAP|@keyframes|animation/);

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
        return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">基础版</h1><p data-text-key="subtitle">价格</p><section data-text-key="body">基础版价格 12 元</section></main></body></html>' };
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

  let dimensionCalls = 0;
  const dimensionResult = await agent.generateFrameHtml({
    model: {
      callTextModel: async ({ messages }) => {
        dimensionCalls += 1;
        if (dimensionCalls === 1) {
          return {
            success: true,
            text: [
              '```html',
              '<!doctype html><html><head>',
              '<meta name="viewport" content="width=1920,height=1080,initial-scale=1.0">',
              '<style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden}</style>',
              '</head><body><main>横屏错误尺寸</main></body></html>',
              '```',
            ].join('\n'),
          };
        }
        const retryText = messages[0].content;
        assert.match(retryText, /1080x1920/);
        assert.match(retryText, /不要输出 1920x1080|不能使用 1920x1080/);
        return {
          success: true,
          text: [
            '```html',
            '<!doctype html><html><head>',
            '<meta name="viewport" content="width=1080,height=1920,initial-scale=1.0">',
            '<style>html,body{margin:0;width:1080px;height:1920px;overflow:hidden}</style>',
            '</head><body><main><h1 data-text-key="headline">基础版</h1><p data-text-key="subtitle">价格</p><section data-text-key="body">基础版价格 12 元</section></main></body></html>',
            '```',
          ].join('\n'),
        };
      },
    },
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
    target: { resolution: { width: 1080, height: 1920 }, aspect_ratio: '9:16' },
  });
  assert.equal(dimensionResult.success, true);
  assert.equal(dimensionCalls, 2);
  assert.match(dimensionResult.html, /width=1080,height=1920/);

  const decorativeFrameHtml = [
    '<!doctype html><html><head>',
    '<meta name="viewport" content="width=1920,height=1080,initial-scale=1.0">',
    '<style>',
    'html,body{margin:0;width:1920px;height:1080px;overflow:hidden}',
    '.corner-frame span{width:140px;height:140px}',
    '</style>',
    '</head><body data-hv-canvas data-width="1920" data-height="1080">',
    '<div class="corner-frame"><span></span></div>',
    '<main><h1 data-text-key="headline">基础版</h1><p data-text-key="subtitle">价格</p><section data-text-key="body">基础版价格 12 元</section></main>',
    '</body></html>',
  ].join('');
  const decorativeValidation = agent.validateHtmlTargetResolution(decorativeFrameHtml, {
    resolution: { width: 1920, height: 1080 },
  });
  assert.equal(decorativeValidation.success, true);

  const nestedStageHtml = [
    '<!doctype html><html><head>',
    '<meta name="viewport" content="width=1920,height=1080,initial-scale=1.0">',
    '<style>',
    'html,body{margin:0;width:1920px;height:1080px;overflow:hidden}',
    '.stage{width:900px;height:870px}',
    '</style>',
    '</head><body data-hv-canvas data-width="1920" data-height="1080">',
    '<div class="stage"><h1 data-text-key="headline">基础版</h1><p data-text-key="subtitle">价格</p><section data-text-key="body">基础版价格 12 元</section></div>',
    '</body></html>',
  ].join('');
  const nestedStageValidation = agent.validateHtmlTargetResolution(nestedStageHtml, {
    resolution: { width: 1920, height: 1080 },
  });
  assert.equal(nestedStageValidation.success, true);

  const onlyStageHtml = [
    '<!doctype html><html><head>',
    '<style>.stage{width:900px;height:870px}</style>',
    '</head><body>',
    '<div class="stage"><h1 data-text-key="headline">基础版</h1><p data-text-key="subtitle">价格</p><section data-text-key="body">基础版价格 12 元</section></div>',
    '</body></html>',
  ].join('');
  const onlyStageValidation = agent.validateHtmlTargetResolution(onlyStageHtml, {
    resolution: { width: 1920, height: 1080 },
  });
  assert.equal(onlyStageValidation.success, false);
  assert.match(onlyStageValidation.message, /css:\.stage 使用 900x870/);

  const dimensionFailed = await agent.generateFrameHtml({
    model: {
      callTextModel: async () => ({
        success: true,
        text: '<!doctype html><html><head><meta name="viewport" content="width=1920,height=1080"><style>html,body{width:1920px;height:1080px}</style></head><body>bad</body></html>',
      }),
    },
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
    target: { resolution: { width: 1080, height: 1920 }, aspect_ratio: '9:16' },
  });
  assert.equal(dimensionFailed.success, false);
  assert.match(dimensionFailed.message, /尺寸|画幅/);

  const failedHtml = await agent.generateFrameHtml({
    model: {
      callTextModel: async () => ({
        success: true,
        text: [
          '<!doctype html><html><head>',
          '<style>.stage{width:900px;height:870px}</style>',
          '</head><body>',
          '<div class="stage"><h1 data-text-key="headline">基础版</h1><p data-text-key="subtitle">价格</p><section data-text-key="body">基础版价格 12 元</section></div>',
          '</body></html>',
        ].join(''),
      }),
    },
    frameId: 'scene_failed',
    attempt: 2,
    shortPrompt: true,
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
    target: { resolution: { width: 1920, height: 1080 }, aspect_ratio: '16:9' },
  });
  assert.equal(failedHtml.success, false);
  assert.match(failedHtml.failed_html, /\.stage/);
  assert.match(failedHtml.diagnostics[0].details.failed_html, /\.stage/);

  let shortPromptInvalidCalls = 0;
  const shortPromptInvalid = await agent.generateFrameHtml({
    model: {
      callTextModel: async request => {
        shortPromptInvalidCalls += 1;
        assert.equal(request.stream, false);
        assert.equal(request.temperature, 0);
        return { success: true, text: '不是 HTML' };
      },
    },
    frameId: 'scene_01',
    attempt: 2,
    modelOptions: { temperature: 0 },
    shortPrompt: true,
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
    target: { resolution: { width: 1080, height: 1920 }, aspect_ratio: '9:16' },
  });
  assert.equal(shortPromptInvalid.success, false);
  assert.equal(shortPromptInvalidCalls, 1);
  assert.equal(shortPromptInvalid.diagnostics[0].code, 'frame_html_invalid');

  let retryBlankCalls = 0;
  const retryBlankResult = await agent.generateFrameHtml({
    model: {
      callTextModel: async () => {
        retryBlankCalls += 1;
        if (retryBlankCalls === 1) {
          return {
            success: true,
            text: '<!doctype html><html><head><meta name="viewport" content="width=1920,height=1080"><style>html,body{width:1920px;height:1080px}</style></head><body>bad</body></html>',
          };
        }
        return { success: true, text: '' };
      },
    },
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
    target: { resolution: { width: 1080, height: 1920 }, aspect_ratio: '9:16' },
  });
  assert.equal(retryBlankResult.success, false);
  assert.equal(retryBlankCalls, 2);
  assert.doesNotMatch(retryBlankResult.message, /缺少文本|返回结果缺少文本内容/);
  assert.equal(retryBlankResult.diagnostics[0].code, 'frame_html_invalid');
  assert.doesNotMatch(retryBlankResult.diagnostics[0].user_message, /缺少文本|返回结果缺少文本内容/);
  assert.equal(retryBlankResult.diagnostics[0].sub_stage, 'frame_html');
  assert.equal(retryBlankResult.diagnostics[0].frame_id, 'scene_01');
  assert.equal(retryBlankResult.diagnostics[0].retryable, true);
  assert.equal(retryBlankResult.diagnostics[0].repair_action, 'retry_frame_html');

  let retryMissingFailureCalls = 0;
  const retryMissingFailureResult = await agent.generateFrameHtml({
    model: {
      callTextModel: async () => {
        retryMissingFailureCalls += 1;
        if (retryMissingFailureCalls === 1) {
          return {
            success: true,
            text: '<!doctype html><html><head><meta name="viewport" content="width=1920,height=1080"><style>html,body{width:1920px;height:1080px}</style></head><body>bad</body></html>',
          };
        }
        return { success: false, message: '文本模型 返回结果缺少文本内容。' };
      },
    },
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
    target: { resolution: { width: 1080, height: 1920 }, aspect_ratio: '9:16' },
  });
  assert.equal(retryMissingFailureResult.success, false);
  assert.equal(retryMissingFailureCalls, 2);
  assert.equal(retryMissingFailureResult.diagnostics[0].code, 'frame_html_invalid');
  assert.doesNotMatch(retryMissingFailureResult.message, /缺少文本|返回结果缺少文本内容/);
  assert.doesNotMatch(retryMissingFailureResult.diagnostics[0].user_message, /缺少文本|返回结果缺少文本内容/);

  let invalidRetryBlankCalls = 0;
  const invalidRetryBlankResult = await agent.generateFrameHtml({
    model: {
      callTextModel: async () => {
        invalidRetryBlankCalls += 1;
        return invalidRetryBlankCalls === 1
          ? { success: true, text: '仍然不是 HTML' }
          : { success: true, text: '' };
      },
    },
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
  });
  assert.equal(invalidRetryBlankResult.success, false);
  assert.equal(invalidRetryBlankCalls, 2);
  assert.doesNotMatch(invalidRetryBlankResult.message, /缺少文本|返回结果缺少文本内容/);
  assert.equal(invalidRetryBlankResult.diagnostics[0].code, 'frame_html_invalid');
  assert.doesNotMatch(invalidRetryBlankResult.diagnostics[0].user_message, /缺少文本|返回结果缺少文本内容/);

  let invalidRetryMissingFailureCalls = 0;
  const invalidRetryMissingFailureResult = await agent.generateFrameHtml({
    model: {
      callTextModel: async () => {
        invalidRetryMissingFailureCalls += 1;
        return invalidRetryMissingFailureCalls === 1
          ? { success: true, text: '仍然不是 HTML' }
          : { success: false, message: '文本模型 返回结果缺少文本内容。' };
      },
    },
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
  });
  assert.equal(invalidRetryMissingFailureResult.success, false);
  assert.equal(invalidRetryMissingFailureCalls, 2);
  assert.equal(invalidRetryMissingFailureResult.diagnostics[0].code, 'frame_html_invalid');
  assert.doesNotMatch(invalidRetryMissingFailureResult.message, /缺少文本|返回结果缺少文本内容/);
  assert.doesNotMatch(invalidRetryMissingFailureResult.diagnostics[0].user_message, /缺少文本|返回结果缺少文本内容/);

  const failed = await agent.generateFrameHtml({
    model: { callTextModel: async () => ({ success: true, text: '仍然不是 HTML' }) },
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
  });
  assert.equal(failed.success, false);
  assert.match(failed.message, /未返回有效 HTML/);
  assert.equal(failed.diagnostics[0].code, 'frame_html_invalid');
  assert.equal(failed.diagnostics[0].sub_stage, 'frame_html');
  assert.equal(failed.diagnostics[0].frame_id, 'scene_01');
  assert.equal(failed.diagnostics[0].retryable, true);
  assert.equal(failed.diagnostics[0].repair_action, 'retry_frame_html');

  const providerMissing = await agent.generateFrameHtml({
    model: { callTextModel: async () => ({ success: true, text: '' }) },
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
  });
  assert.equal(providerMissing.success, false);
  assert.equal(providerMissing.diagnostics[0].code, 'provider_missing_text');
  assert.equal(providerMissing.diagnostics[0].sub_stage, 'frame_html');
  assert.equal(providerMissing.diagnostics[0].frame_id, 'scene_01');
  assert.equal(providerMissing.diagnostics[0].retryable, true);
  assert.equal(providerMissing.diagnostics[0].repair_action, 'retry_frame_html');

  console.log('html-video frame html agent tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
