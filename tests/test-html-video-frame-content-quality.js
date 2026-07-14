const assert = require('assert/strict');

const frameHtmlAgent = require('../server/services/creative-video/html-video/frameHtmlAgent');

function validHtml(headline, body = '正文') {
  return `<!doctype html><html><head><style>@keyframes in{to{opacity:1}} h1{animation:in 1s}</style></head><body><main style="width:1920px;height:1080px"><h1 data-text-key="headline">${headline}</h1><p data-text-key="subtitle">短字幕</p><section data-text-key="body">${body}</section></main></body></html>`;
}

(async () => {
  const sceneSpec = {
    title: 'Hairline Shadow',
    scenes: [{
      id: 'scene_01',
      narration_text: '写 Card、Popover 或 Modal 时，边缘发灰通常来自 border 和 shadow 的语义冲突。',
      captions: [{ text: '写 Card、Popover 或 Modal 时，边缘发灰通常来自 border 和 shadow 的语义冲突。' }],
      visual_text: { headline: '问题开场：为什么边缘发灰', keywords: [], cards: [] },
    }],
  };
  const baseArgs = {
    frameId: 'scene_01',
    node: {
      id: 'scene_01',
      label: '问题开场：为什么边缘发灰',
      text: '问题开场：为什么边缘发灰',
      metadata: { scene_id: 'scene_01' },
    },
    graph: { synopsis: '解释 Hairline Shadow', nodes: [] },
    index: 0,
    total: 1,
    sceneSpec,
    target: { resolution: { width: 1920, height: 1080 } },
  };

  let softMismatchCalls = 0;
  const softMismatch = await frameHtmlAgent.generateFrameHtml({
    ...baseArgs,
    model: {
      callTextModel: async () => {
        softMismatchCalls += 1;
        return {
          success: true,
          text: validHtml('完全不同的标题', '完全不同的正文'),
        };
      },
    },
  });

  assert.equal(softMismatch.success, true);
  assert.equal(softMismatchCalls, 1);
  assert.equal(softMismatch.diagnostics.some(item => item.code === 'frame_html_content_mismatch'), true);
  assert.equal(softMismatch.diagnostics.find(item => item.code === 'frame_html_content_mismatch').severity, 'warning');

  // 画面照抄旁白（无 headline）不再被 narration overlap 兜底放行，必须报 content mismatch
  let narrationCopyCalls = 0;
  const narrationCopy = await frameHtmlAgent.generateFrameHtml({
    ...baseArgs,
    model: {
      callTextModel: async () => {
        narrationCopyCalls += 1;
        return {
          success: true,
          text: validHtml('完全不同的标题', '写 Card、Popover 或 Modal 时，边缘发灰通常来自 border 和 shadow 的语义冲突。'),
        };
      },
    },
  });
  assert.equal(narrationCopy.success, true);
  assert.equal(narrationCopyCalls, 1);
  assert.equal(narrationCopy.diagnostics.some(item => item.code === 'frame_html_content_mismatch'), true);

  console.log('html-video frame content quality tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
