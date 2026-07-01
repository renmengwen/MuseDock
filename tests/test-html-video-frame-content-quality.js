const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const frameHtmlAgent = require('../server/services/creative-video/html-video/frameHtmlAgent');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

function validHtml(headline, body = '正文') {
  return `<!doctype html><html><head><style>@keyframes in{to{opacity:1}} h1{animation:in 1s}</style></head><body><main style="width:1920px;height:1080px"><h1 data-text-key="headline">${headline}</h1><p data-text-key="subtitle">短字幕</p><section data-text-key="body">${body}</section></main></body></html>`;
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-content-quality-'));
  const templateDir = path.join(rootDir, 'template');
  await writeFile(path.join(templateDir, 'source.html'), validHtml('让增长信号', '实时洞察 自动协同'));

  const template = {
    id: 'bold_signal',
    name: 'Bold Signal',
    description: '深色科技模板',
    __dir: templateDir,
    source_entry: 'source.html',
  };
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
    template,
  };

  let calls = 0;
  const repaired = await frameHtmlAgent.generateFrameHtml({
    ...baseArgs,
    model: {
      callTextModel: async () => {
        calls += 1;
        return {
          success: true,
          text: calls === 1
            ? validHtml('让增长信号', '实时洞察 自动协同')
            : validHtml('问题开场：为什么边缘发灰', 'border 和 shadow 的语义冲突'),
        };
      },
    },
  });

  assert.equal(repaired.success, true);
  assert.equal(calls, 2);
  assert.match(repaired.html, /问题开场：为什么边缘发灰/);
  assert.doesNotMatch(repaired.html, /让增长信号/);

  let softMismatchCalls = 0;
  const softMismatch = await frameHtmlAgent.generateFrameHtml({
    ...baseArgs,
    template: null,
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

  const failed = await frameHtmlAgent.generateFrameHtml({
    ...baseArgs,
    model: {
      callTextModel: async () => ({
        success: true,
        text: validHtml('让增长信号', '实时洞察 自动协同'),
      }),
    },
  });

  assert.equal(failed.success, false);
  assert.equal(failed.diagnostics.some(item => item.code === 'html_validation_failed'), true);
  assert.equal(failed.diagnostics[0].details.validation_code, 'frame_html_template_text_leak');
  assert.equal(failed.diagnostics[0].retryable, true);
  assert.equal(failed.diagnostics[0].repair_action, 'retry_frame_html');

  const chromeTemplate = {
    id: 'bold_signal_chrome',
    sourceHtml: [
      '<!doctype html><html><body>',
      '<nav>信号 构建 发布 扩展</nav>',
      '<main><h1>让增长信号</h1><p>实时洞察 自动协同</p></main>',
      '<footer>创意视频 Bold Signal</footer>',
      '</body></html>',
    ].join(''),
  };
  const chromeOnlyLeak = await frameHtmlAgent.generateFrameHtml({
    ...baseArgs,
    template: chromeTemplate,
    model: {
      callTextModel: async () => ({
        success: true,
        text: [
          '<!doctype html><html><head><style>@keyframes in{to{opacity:1}} h1{animation:in 1s}</style></head>',
          '<body>',
          '<nav>信号 构建 发布 扩展</nav>',
          '<main style="width:1920px;height:1080px"><h1 data-text-key="headline">问题开场：为什么边缘发灰</h1><p data-text-key="subtitle">短字幕</p><section data-text-key="body">border 和 shadow 的语义冲突</section></main>',
          '<footer>创意视频 Bold Signal</footer>',
          '</body></html>',
        ].join(''),
      }),
    },
  });
  assert.equal(chromeOnlyLeak.success, true);
  assert.equal(chromeOnlyLeak.diagnostics.some(item => item.code === 'frame_html_template_text_leak'), false);

  console.log('html-video frame content quality tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
