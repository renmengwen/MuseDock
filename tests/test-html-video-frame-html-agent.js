const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agent = require('../server/services/creative-video/html-video/frameHtmlAgent');
const inspection = require('../server/services/creative-video/html-video/frameHtmlInspection');

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
assert.doesNotMatch(prompt, /信号卡片/);
assert.doesNotMatch(prompt, /深色背景和橙色焦点卡片滑入/);
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
assert.match(prompt, /步骤、流程、时间线、编号卡片/);
assert.match(prompt, /4、1、2、3/);
assert.match(prompt, /nth-of-type/);
assert.match(prompt, /data-index|--i:n|nth-child/);
assert.match(prompt, /安全区/);
assert.match(prompt, /140px 字幕安全区/);
assert.match(prompt, /装饰层、遮罩、扫描线/);
assert.match(prompt, /position:absolute/);
assert.match(prompt, /\[object Object\]/);
assert.match(prompt, /不要发明源素材中没有的精确事实/);
assert.match(prompt, /visual_text\.keywords\/cards/);
assert.match(prompt, /禁止把 narration_text 或 captions 的原句、近似原句搬进画面/);
assert.doesNotMatch(prompt, /第三帧完整旁白不应进入当前帧 prompt/);
assert.doesNotMatch(prompt, /布局修复要求/);

const layoutRepairPrompt = agent.buildFrameHtmlPrompt({
  graph,
  node: graph.nodes[0],
  index: 0,
  total: 2,
  sceneSpec: { title: '价格对比', scenes: [{ id: 'scene_01', narration_text: '先看基础版价格。' }] },
  creativeContext: {},
  target: { resolution: { width: 1920, height: 1080 } },
  layoutFeedback: '检测到文本元素互相重叠：「生成第一条自动化视频」与「从接口开始」互相遮挡',
});
assert.match(layoutRepairPrompt, /布局修复要求/);
assert.match(layoutRepairPrompt, /生成第一条自动化视频/);
assert.match(layoutRepairPrompt, /保持文案内容不变/);

const dynamicInputIndex = prompt.indexOf('---- 本次动态输入 ----');
assert.notEqual(dynamicInputIndex, -1);
[
  '固定系统规则：',
  '硬性要求：',
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
  node: {
    ...graph.nodes[0],
    asset_refs: [{ asset_id: 'article_01', usage: 'showcase_with_callouts', reason: '匹配价格表截图说明' }],
  },
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
        image_analysis: {
          status: 'ready',
          visual_type: 'screenshot',
          summary: '展示会员价格表与套餐限制',
          best_usage: '完整展示并标注关键价格',
        },
      }],
    },
  },
  target: { resolution: { width: 1920, height: 1080 } },
});

assert.match(assetPrompt, /可用图片素材/);
assert.match(assetPrompt, /\.\.\/assets\/source-image-01\.png/);
assert.match(assetPrompt, /本帧推荐来源图片/);
assert.match(assetPrompt, /article_01/);
assert.match(assetPrompt, /screenshot/);
assert.match(assetPrompt, /展示会员价格表与套餐限制/);
assert.match(assetPrompt, /匹配价格表截图说明/);
assert.match(assetPrompt, /禁止引用外部图片 URL/);
assert.match(assetPrompt, /object-fit: contain/);
assert.doesNotMatch(assetPrompt, /不要做纯图片轮播|图片应与.*混排/);
assert.match(assetPrompt, /不要求额外框选、高亮或数据卡/);
assert.match(assetPrompt, /必须在 HTML 中引用该图片的 src/);

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

const styleProfilePrompt = agent.buildFrameHtmlPrompt({
  frameId: 'scene_01_b1',
  graph: { nodes: [{ id: 'scene_01_b1', kind: 'text' }] },
  node: { id: 'scene_01_b1', kind: 'text', label: '概念开场' },
  index: 0,
  total: 1,
  sceneSpec: { scenes: [] },
  creativeContext: {},
  target: { aspect_ratio: '16:9' },
  template: { id: 'frame-glitch-title', name: 'Glitch Title' },
  styleProfile: {
    id: 'clean_education',
    palette: ['#F7F4EA', '#222222', '#2F80ED'],
    layout_language: 'annotated_diagram',
    motion_language: 'draw_reveal',
  },
});
assert.match(styleProfilePrompt, /clean_education/);
assert.match(styleProfilePrompt, /#2F80ED/);
assert.match(styleProfilePrompt, /style_profile「clean_education」/);
assert.doesNotMatch(styleProfilePrompt, /延续模板「Glitch Title」/);
assert.doesNotMatch(styleProfilePrompt, /REQUIRED visual style/i);
assert.doesNotMatch(styleProfilePrompt, /继承所选模板 metadata/);

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

// 模板穿线已删除：即使传入带可读源码的 template，prompt 也不得包含模板身份与源码段
assert.doesNotMatch(sourceBackedPrompt, /Selected template metadata/);
assert.doesNotMatch(sourceBackedPrompt, /Template HTML/);
assert.doesNotMatch(sourceBackedPrompt, /REQUIRED visual style/i);
assert.doesNotMatch(sourceBackedPrompt, /@keyframes heroEnter/);
assert.doesNotMatch(sourceBackedPrompt, /模板源码动效/);
assert.match(sourceBackedPrompt, /opens with an animation timeline/i);
assert.match(sourceBackedPrompt, /window\.__hvPlayAll|GSAP|@keyframes|animation/);
assert.match(sourceBackedPrompt, /超过 6 秒|长于 6 秒/);
assert.match(sourceBackedPrompt, /sub-beats/);
assert.match(sourceBackedPrompt, /主体/);
assert.match(sourceBackedPrompt, /禁止只有角落|不要只有角落/);

const styleProfileSourceBackedPrompt = agent.buildFrameHtmlPrompt({
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
  },
  styleProfile: { id: 'clean_education' },
});
assert.match(styleProfileSourceBackedPrompt, /style_profile「clean_education」/);
assert.doesNotMatch(styleProfileSourceBackedPrompt, /REQUIRED visual style/i);
assert.doesNotMatch(styleProfileSourceBackedPrompt, /继承所选模板 metadata/);
assert.doesNotMatch(styleProfileSourceBackedPrompt, /@keyframes heroEnter/);

const retryPrompt = agent.buildRetryPrompt({
  node: { id: 'scene_01', durationSec: 8 },
  target: { resolution: { width: 1920, height: 1080 } },
  validationMessage: 'HTML 画幅尺寸不符合目标 1920x1080。',
  sceneSpec: { scenes: [{ id: 'scene_01', visual_text: { headline: '基础版' }, narration_text: '价格说明' }] },
});
assert.match(retryPrompt, /animation timeline/i);
assert.match(retryPrompt, /window\.__hvPlayAll|GSAP|@keyframes|animation/);
assert.match(retryPrompt, /HTML skeleton|<!doctype html>/i);
assert.doesNotMatch(retryPrompt, /Template HTML|Visual continuity lock|Source context summary/);
assert.match(retryPrompt, /提炼成关键词\/短语再上画面/);
assert.match(retryPrompt, /禁止照抄旁白或字幕原句/);

const retryPromptWithKeywords = agent.buildRetryPrompt({
  node: { id: 'scene_01' },
  target: { resolution: { width: 1920, height: 1080 } },
  sceneSpec: {
    scenes: [{
      id: 'scene_01',
      visual_text: { headline: '基础版', keywords: ['价格', '对比'], cards: ['基础版 12 元'] },
      narration_text: '价格说明的完整旁白原句',
    }],
  },
});
assert.doesNotMatch(retryPromptWithKeywords, /价格说明的完整旁白原句/);
assert.match(retryPromptWithKeywords, /基础版 12 元/);

const styleProfileRetryPrompt = agent.buildRetryPrompt({
  node: { id: 'scene_01' },
  target: { resolution: { width: 1920, height: 1080 } },
  template: { id: 'frame-glitch-title', name: 'Glitch Title' },
  styleProfile: { id: 'clean_education' },
});
assert.match(styleProfileRetryPrompt, /style_profile「clean_education」/);
assert.doesNotMatch(styleProfileRetryPrompt, /延续模板「Glitch Title」/);

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
assert.equal(agent.extractHtmlDocument('').code, 'provider_missing_text');
const noHtmlDocument = agent.extractHtmlDocument('这里只是解释，没有 HTML');
assert.equal(noHtmlDocument.success, false);
assert.equal(noHtmlDocument.code, 'html_document_extract_failed');

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

  const auditedRequests = [];
  const auditedRetry = await agent.generateFrameHtml({
    model: {
      callTextModel: async request => {
        auditedRequests.push(request);
        return auditedRequests.length === 1
          ? {
            success: true,
            text: '<!doctype html><html><head><meta name="viewport" content="width=1920,height=1080"><style>html,body{width:1920px;height:1080px}</style></head><body>bad</body></html>',
          }
          : {
            success: true,
            text: '<!doctype html><html><head><meta name="viewport" content="width=1080,height=1920"><style>html,body{width:1080px;height:1920px}</style></head><body><h1 data-text-key="headline">基础版</h1><p data-text-key="subtitle">价格</p><section data-text-key="body">基础版价格 12 元</section></body></html>',
          };
      },
    },
    modelOptions: {
      audit: {
        agent: 'FrameHtmlAgent',
        stage: 'frame_html',
        sub_stage: 'frame_html',
        frame_id: 'scene_01',
        attempt: 1,
      },
    },
    graph,
    node: graph.nodes[0],
    index: 0,
    total: 2,
    target: { resolution: { width: 1080, height: 1920 }, aspect_ratio: '9:16' },
  });
  assert.equal(auditedRetry.success, true);
  assert.equal(auditedRequests.length, 2);
  assert.equal(auditedRequests[0].audit.repair_attempt, undefined);
  assert.equal(auditedRequests[1].audit.attempt, 1);
  assert.equal(auditedRequests[1].audit.repair_attempt, 1);

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
  assert.equal(dimensionFailed.diagnostics[0].code, 'html_validation_failed');
  assert.equal(dimensionFailed.diagnostics[0].details.validation_code, 'frame_html_invalid');

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
  assert.equal(failedHtml.diagnostics[0].code, 'html_validation_failed');
  assert.equal(failedHtml.diagnostics[0].details.validation_code, 'frame_html_invalid');
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
  assert.equal(shortPromptInvalid.diagnostics[0].code, 'html_document_extract_failed');

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
  assert.match(retryBlankResult.message, /首版 HTML 未通过校验/);
  assert.match(retryBlankResult.message, /修复重试时模型返回空内容/);
  assert.equal(retryBlankResult.diagnostics[0].code, 'html_validation_failed');
  assert.match(retryBlankResult.diagnostics[0].user_message, /首版 HTML 未通过校验/);
  assert.equal(retryBlankResult.diagnostics[0].sub_stage, 'frame_html');
  assert.equal(retryBlankResult.diagnostics[0].frame_id, 'scene_01');
  assert.equal(retryBlankResult.diagnostics[0].retryable, true);
  assert.equal(retryBlankResult.diagnostics[0].repair_action, 'retry_frame_html');
  assert.equal(retryBlankResult.diagnostics[0].details.validation_code, 'frame_html_invalid');
  assert.equal(retryBlankResult.diagnostics[0].details.retry_provider_missing_text, true);
  assert.match(retryBlankResult.failed_html, /width=1920,height=1080/);

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
  assert.equal(retryMissingFailureResult.diagnostics[0].code, 'html_validation_failed');
  assert.match(retryMissingFailureResult.message, /首版 HTML 未通过校验/);
  assert.match(retryMissingFailureResult.message, /修复重试时模型返回空内容/);
  assert.equal(retryMissingFailureResult.diagnostics[0].details.retry_provider_missing_text, true);
  assert.match(retryMissingFailureResult.failed_html, /width=1920,height=1080/);

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
  assert.equal(invalidRetryBlankResult.diagnostics[0].code, 'html_document_extract_failed');
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
  assert.equal(invalidRetryMissingFailureResult.diagnostics[0].code, 'html_document_extract_failed');
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
  assert.match(failed.message, /未返回完整 HTML/);
  assert.equal(failed.diagnostics[0].code, 'html_document_extract_failed');
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

  const assetContextForValidation = {
    asset_context: {
      assets: [
        {
          id: 'article_01',
          requirement: 'required',
          path: 'assets/source-image-01.png',
          frame_src: '../assets/source-image-01.png',
          image_analysis: { should_use: true },
        },
        {
          id: 'article_02',
          path: 'assets/avoid-image-02.png',
          frame_src: '../assets/avoid-image-02.png',
          image_analysis: { should_use: false, avoid_reason: '画面不可读' },
        },
      ],
    },
  };
  const assetNode = {
    ...graph.nodes[0],
    asset_refs: [{ asset_id: 'article_01', usage: 'showcase', reason: '价格表截图必须展示' }],
  };
  const missingAssetUsage = agent.validateFrameAssetUsage(
    '<!doctype html><html><body><main>基础版价格</main></body></html>',
    { node: assetNode, creativeContext: assetContextForValidation },
  );
  assert.equal(missingAssetUsage.success, false);
  assert.equal(missingAssetUsage.code, 'frame_html_required_source_asset_missing');
  assert.equal(missingAssetUsage.details.required_src, '../assets/source-image-01.png');

  const nonRequiredUsage = agent.validateFrameAssetUsage(
    '<!doctype html><html><body><main>基础版价格</main></body></html>',
    {
      node: {
        ...graph.nodes[0],
        asset_refs: [
          { asset_id: 'preferred_01', usage: 'subject' },
          { asset_id: 'optional_01', usage: 'showcase' },
          { asset_id: 'legacy_01', usage: 'background' },
        ],
      },
      creativeContext: {
        asset_context: {
          assets: [
            { id: 'preferred_01', requirement: 'preferred', path: 'assets/preferred.png' },
            { id: 'optional_01', requirement: 'optional', path: 'assets/optional.png' },
            { id: 'legacy_01', path: 'assets/legacy.png' },
          ],
        },
      },
    },
  );
  assert.equal(nonRequiredUsage.success, true);

  const requiredAfterPreferred = agent.validateFrameAssetUsage(
    '<!doctype html><html><body><main>基础版价格</main></body></html>',
    {
      node: {
        ...graph.nodes[0],
        asset_refs: [
          { asset_id: 'preferred_01', usage: 'subject' },
          { asset_id: 'formal_generated_required', usage: 'subject' },
        ],
      },
      creativeContext: {
        asset_context: {
          assets: [
            { id: 'preferred_01', requirement: 'preferred', path: 'assets/preferred.png' },
            { id: 'formal_generated_required', origin: 'ai_generated', requirement: 'required', path: 'assets/formal-required.png' },
          ],
        },
      },
    },
  );
  assert.equal(requiredAfterPreferred.success, false);
  assert.equal(requiredAfterPreferred.details.asset_id, 'formal_generated_required');
  assert.match(requiredAfterPreferred.message, /推荐生成图片/);
  const requiredAfterPreferredPrompt = agent.frameAssetReferenceSummary({
    asset_refs: [
      { asset_id: 'preferred_01', usage: 'subject' },
      { asset_id: 'formal_generated_required', usage: 'subject' },
    ],
  }, {
    asset_context: {
      assets: [
        { id: 'preferred_01', requirement: 'preferred', path: 'assets/preferred.png' },
        { id: 'formal_generated_required', origin: 'ai_generated', requirement: 'required', path: 'assets/formal-required.png' },
      ],
    },
  });
  assert.match(requiredAfterPreferredPrompt, /formal_generated_required/);
  assert.match(requiredAfterPreferredPrompt, /推荐生成图片/);

  const twoRequiredAssets = {
    asset_context: {
      assets: [
        { id: 'required_a', requirement: 'required', path: 'assets/required-a.png', frame_src: '../assets/required-a.png' },
        { id: 'required_b', requirement: 'required', path: 'assets/required-b.png', frame_src: '../assets/required-b.png' },
      ],
    },
  };
  const twoRequiredNode = {
    ...graph.nodes[0],
    asset_refs: [
      { asset_id: 'required_a', usage: 'subject' },
      { asset_id: 'required_b', usage: 'showcase' },
    ],
  };
  const oneOfTwoRequired = agent.validateFrameAssetUsage(
    '<!doctype html><html><body><img src="../assets/required-a.png"></body></html>',
    { node: twoRequiredNode, creativeContext: twoRequiredAssets },
  );
  assert.equal(oneOfTwoRequired.success, false);
  assert.equal(oneOfTwoRequired.details.asset_id, 'required_b');
  const allRequired = agent.validateFrameAssetUsage(
    '<!doctype html><html><body><img src="../assets/required-a.png"><img src="../assets/required-b.png"></body></html>',
    { node: twoRequiredNode, creativeContext: twoRequiredAssets },
  );
  assert.equal(allRequired.success, true);

  const formalConflictRequired = agent.validateFrameAssetUsage(
    '<!doctype html><html><body><main>基础版价格</main></body></html>',
    {
      node: { ...graph.nodes[0], asset_refs: [{ asset_id: 'formal_conflict_required', usage: 'evidence' }] },
      creativeContext: {
        asset_context: {
          assets: [{
            id: 'formal_conflict_required',
            origin: 'source_extract',
            source: 'generated',
            requirement: 'required',
            path: 'assets/conflict-required.png',
          }],
        },
      },
    },
  );
  assert.match(formalConflictRequired.message, /推荐来源图片/);

  const formalGeneratedPrompt = agent.frameAssetReferenceSummary({
    asset_refs: [{ asset_id: 'formal_generated_prompt', usage: 'subject' }],
  }, {
    asset_context: {
      assets: [{ id: 'formal_generated_prompt', origin: 'ai_generated', path: 'assets/formal-prompt.png' }],
    },
  });
  assert.match(formalGeneratedPrompt, /推荐生成图片/);
  assert.match(formalGeneratedPrompt, /不是来源证据/);

  const blockedAssetUsage = agent.validateFrameAssetUsage(
    '<!doctype html><html><body><img src="../assets/avoid-image-02.png"></body></html>',
    { node: graph.nodes[0], creativeContext: assetContextForValidation },
  );
  assert.equal(blockedAssetUsage.success, false);
  assert.equal(blockedAssetUsage.code, 'frame_html_blocked_source_asset_used');

  for (const [label, html, offendingReference] of [
    ['img', '<img src="../assets/unregistered.png">', '../assets/unregistered.png'],
    ['unquoted img', '<img src=../assets/unregistered-unquoted.png>', '../assets/unregistered-unquoted.png'],
    ['css background', '<style>.hero{background-image:url("../assets/unregistered-bg.png")}</style><main class="hero"></main>', '../assets/unregistered-bg.png'],
    ['external image', '<img src="https://evil.example/unregistered.png">', 'https://evil.example/unregistered.png'],
    ['data image', '<img src="data:image/png;base64,AAAA">', 'data:image/png;base64,AAAA'],
    ['blob image', '<img src="blob:https://example.com/not-registered">', 'blob:https://example.com/not-registered'],
  ]) {
    const unregistered = agent.validateFrameAssetUsage(
      `<!doctype html><html><body>${html}</body></html>`,
      { node: graph.nodes[0], creativeContext: assetContextForValidation },
    );
    assert.equal(unregistered.success, false, `${label} 必须被反向登记门拒绝`);
    assert.equal(unregistered.code, 'frame_html_unregistered_visual_asset');
    assert.equal(unregistered.details.offending_reference, offendingReference);
    assert.match(unregistered.message, /未登记/);
  }

  const normalizedRegisteredUsage = agent.validateFrameAssetUsage(
    '<!doctype html><html><body><img src="./../assets/source-image-01.png?cache=1#hero"></body></html>',
    { node: assetNode, creativeContext: assetContextForValidation },
  );
  assert.equal(normalizedRegisteredUsage.success, true, '已登记素材的等价相对路径必须通过');

  const nonVisualLinks = agent.validateFrameAssetUsage([
    '<!doctype html><html><head><style>.shape{clip-path:url(#clip)}</style></head><body>',
    '<a href="../assets/not-a-visual-navigation.html">导航</a>',
    '<p>{background:url(../assets/code-example.png)}</p>',
    '<svg><defs><clipPath id="clip"><circle r="10"></circle></clipPath></defs></svg>',
    '</body></html>',
  ].join(''), { node: graph.nodes[0], creativeContext: assetContextForValidation });
  assert.equal(nonVisualLinks.success, true, '锚点 href 与内联 CSS fragment 不得误判为视觉素材');

  const nonVisualResources = agent.validateFrameAssetUsage([
    '<!doctype html><html><head><style>',
    '@font-face{font-family:x;src:url(../assets/local.woff2)}',
    '.example{content:"<img src=../assets/not-real-style-markup.png>"}',
    '</style></head><body>',
    '<iframe src="../assets/frame.html"></iframe>',
    '<object data="../assets/document.svg"></object>',
    '<embed src="../assets/embed.svg">',
    '<video src="../assets/movie.mp4"></video>',
    '<source src="../assets/not-in-picture.png">',
    '</body></html>',
  ].join(''), { node: graph.nodes[0], creativeContext: assetContextForValidation });
  assert.equal(nonVisualResources.success, true, '字体与非图片上下文不得进入视觉素材登记门');

  for (const [label, html] of [
    ['srcset data URL', '<img srcset="data:image/png;base64,AAAA 1x, ../assets/unregistered-srcset.png 2x">'],
    ['picture source', '<picture><source srcset="../assets/unregistered-picture.png 1x"></picture>'],
    ['video poster', '<video poster="../assets/unregistered-poster.png"></video>'],
    ['image input', '<input type=image src = ../assets/unregistered-input.png>'],
    ['svg image', '<svg><image xlink:href = ../assets/unregistered-svg.png></image></svg>'],
    ['css visual property', '<style>.x{mask-image:url(../assets/unregistered-mask.png)}</style>'],
  ]) {
    const result = agent.validateFrameAssetUsage(
      `<!doctype html><html><body>${html}</body></html>`,
      { node: graph.nodes[0], creativeContext: assetContextForValidation },
    );
    assert.equal(result.success, false, `${label} 必须被视觉素材登记门拒绝`);
    assert.equal(result.code, 'frame_html_unregistered_visual_asset');
  }
  const srcsetReferences = inspection.extractVisualAssetReferences(
    '<img srcset="data:image/png;base64,AAAA 1x, ../assets/unregistered-srcset.png 2x">',
  ).map(item => item.reference);
  assert.deepEqual(srcsetReferences, [
    'data:image/png;base64,AAAA',
    '../assets/unregistered-srcset.png',
  ], 'srcset 中 data URL 的逗号不得吞掉后续候选图片');
  const cssReferences = inspection.extractVisualAssetReferences([
    '<style>.x{',
    'background:url(../assets/a.png);background-image:url(../assets/b.png);',
    'border-image:url(../assets/c.png);mask:url(../assets/d.png);mask-image:url(../assets/e.png);',
    'list-style-image:url(../assets/f.png);content:url(../assets/g.png);cursor:url(../assets/h.png),auto',
    '}</style>',
  ].join('')).map(item => item.reference);
  assert.deepEqual(cssReferences, 'abcdefgh'.split('').map(name => `../assets/${name}.png`));

  assert.deepEqual(
    inspection.extractVisualAssetReferences('<img alt=">" src="../assets/evil-after-angle.png">').map(item => item.reference),
    ['../assets/evil-after-angle.png'],
    '引号内的 > 不得提前结束标签扫描',
  );
  const entityRegistered = agent.validateFrameAssetUsage('<img src="../assets/a&#46;png">', {
    node: graph.nodes[0],
    creativeContext: { asset_context: { assets: [{ id: 'a', frame_src: '../assets/a.png' }] } },
  });
  assert.equal(entityRegistered.success, true, 'HTML attribute entity 解码后应与登记路径等价');
  assert.deepEqual(
    inspection.extractVisualAssetReferences('<img srcset="data:image/png;base64,AAAA, ../assets/evil-after-data.png 2x">')
      .map(item => item.reference),
    ['data:image/png;base64,AAAA', '../assets/evil-after-data.png'],
  );
  const advancedCssReferences = inspection.extractVisualAssetReferences([
    '<style>',
    '@font-face{src:url(../assets/font-must-stay-ignored.woff2)}',
    ':root{--hero:url(../assets/css-variable.png)}',
    '.a{background/**/:url(../assets/comment-property.png)}',
    '.b{background-image:image-set("../assets/image-set-quoted.png" 1x, ../assets/image-set-bare.png 2x)}',
    '</style>',
    '<link rel="stylesheet" href="../assets/untrusted.css">',
  ].join('')).map(item => item.reference);
  assert.deepEqual(advancedCssReferences.sort(), [
    '../assets/css-variable.png',
    '../assets/comment-property.png',
    '../assets/image-set-quoted.png',
    '../assets/image-set-bare.png',
    '../assets/untrusted.css',
  ].sort());
  const registeredStylesheet = agent.validateFrameAssetUsage(
    '<link rel="alternate stylesheet" href="../assets/untrusted.css">',
    { node: graph.nodes[0], creativeContext: { asset_context: { assets: [{ id: 'css', frame_src: '../assets/untrusted.css' }] } } },
  );
  assert.equal(registeredStylesheet.success, false, 'stylesheet 即使路径已登记也必须 fail-closed');

  let requiredAssetCallCount = 0;
  const validAssetHtml = src => [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta name="viewport" content="width=1920,height=1080,initial-scale=1.0">',
    '<style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden}main{animation:enter .3s both}@keyframes enter{from{opacity:0}to{opacity:1}}</style></head>',
    '<body data-hv-canvas data-width="1920" data-height="1080">',
    '<main>',
    '<h1 data-text-key="headline">基础版</h1>',
    '<p data-text-key="subtitle">价格对比</p>',
    `<section data-text-key="body">价格 12 元${src ? `<img src="${src}" style="object-fit:contain">` : ''}</section>`,
    '</main></body></html>',
  ].join('');
  const requiredAssetResult = await agent.generateFrameHtml({
    model: {
      callTextModel: async ({ messages }) => {
        requiredAssetCallCount += 1;
        if (requiredAssetCallCount === 1) {
          return { success: true, text: `\`\`\`html\n${validAssetHtml('')}\n\`\`\`` };
        }
        assert.match(messages[0].content, /必须引用上面的 src/);
        assert.match(messages[0].content, /\.\.\/assets\/source-image-01\.png/);
        return { success: true, text: `\`\`\`html\n${validAssetHtml('../assets/source-image-01.png')}\n\`\`\`` };
      },
    },
    graph,
    node: assetNode,
    index: 0,
    total: 2,
    creativeContext: assetContextForValidation,
    target: { resolution: { width: 1920, height: 1080 } },
  });
  assert.equal(requiredAssetResult.success, true);
  assert.equal(requiredAssetCallCount, 2);

  console.log('html-video frame html agent tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
