const assert = require('assert');

const renderers = require('./server/services/hyperframesSceneRenderers');

function makeScene(visualType, objects = [], extra = {}) {
  return {
    headline: '安全标题 <script>alert(1)</script>',
    visual_type: visualType,
    prepared_visual_scene: {
      visualType,
      composition: 'center_focus',
      objects,
      motion: [],
      focus: {},
    },
    ...extra,
  };
}

function run() {
  assert.equal(renderers.escapeHtml('<b>"&\'</b>'), '&lt;b&gt;&quot;&amp;&#39;&lt;/b&gt;');

  const workflowHtml = renderers.renderSceneContent({
    scene: makeScene('workflow', [
      { id: 'node-1', type: 'node', text: '需求 <img src=x onerror=1>' },
      { id: 'node-2', type: 'node', text: '页面生成' },
      { id: 'line-1', type: 'connector', from: 'node-1', to: 'node-2' },
    ]),
    index: 0,
    captionText: '',
    wordHtml: '',
  });
  assert.match(workflowHtml, /scene-content--workflow/);
  assert.match(workflowHtml, /visual-flow/);
  assert.match(workflowHtml, /visual-node/);
  assert.match(workflowHtml, /visual-connector/);
  assert.match(workflowHtml, /data-visual-object="node-1"/);
  assert.match(workflowHtml, /需求 &lt;img src=x onerror=1&gt;/);
  assert.doesNotMatch(workflowHtml, /<script>/);

  const codePanelHtml = renderers.renderSceneContent({
    scene: makeScene('code_panel', [
      { id: 'code-1', type: 'code', code: 'const html = "<div>bad</div>";' },
      { id: 'term-1', type: 'terminal', text: '运行完成 <ok>' },
    ]),
    index: 1,
    captionText: '',
    wordHtml: '',
  });
  assert.match(codePanelHtml, /scene-content--code-panel/);
  assert.match(codePanelHtml, /visual-code-window/);
  assert.match(codePanelHtml, /visual-code-line/);
  assert.match(codePanelHtml, /visual-terminal/);
  assert.match(codePanelHtml, /&lt;div&gt;bad&lt;\/div&gt;/);
  assert.match(codePanelHtml, /运行完成 &lt;ok&gt;/);

  const uiMockupHtml = renderers.renderSceneContent({
    scene: makeScene('ui_mockup', [
      { id: 'panel-1', type: 'panel', text: '配置面板' },
      { id: 'button-1', type: 'button', text: '生成 <视频>' },
    ]),
    index: 2,
    captionText: '',
    wordHtml: '',
  });
  assert.match(uiMockupHtml, /scene-content--ui-mockup/);
  assert.match(uiMockupHtml, /visual-ui-panel/);
  assert.match(uiMockupHtml, /visual-ui-button/);
  assert.match(uiMockupHtml, /data-visual-object="button-1"/);
  assert.match(uiMockupHtml, /生成 &lt;视频&gt;/);

  const splitCompareHtml = renderers.renderSceneContent({
    scene: makeScene('split_compare', [
      { id: 'old', type: 'column', text: '旧流程 <慢>' },
      { id: 'new', type: 'column', text: '新流程 <快>' },
    ]),
    index: 3,
    captionText: '',
    wordHtml: '',
  });
  assert.match(splitCompareHtml, /scene-content--split-compare/);
  assert.match(splitCompareHtml, /visual-compare-grid/);
  assert.match(splitCompareHtml, /visual-compare-column/);
  assert.match(splitCompareHtml, /旧流程 &lt;慢&gt;/);
  assert.match(splitCompareHtml, /新流程 &lt;快&gt;/);

  const quoteBurstHtml = renderers.renderSceneContent({
    scene: makeScene('quote_burst'),
    index: 4,
    captionText: '',
    wordHtml: '<span data-card-index="0">safe word html</span>',
  });
  assert.match(quoteBurstHtml, /scene-content--quote-burst/);
  assert.match(quoteBurstHtml, /quote-mark/);
  assert.match(quoteBurstHtml, /safe word html/);

  const unknownHtml = renderers.renderSceneContent({
    scene: makeScene('unknown_type', [], { visual_type: 'unknown_type' }),
    index: 5,
    captionText: '',
    wordHtml: '<span>fallback</span>',
  });
  assert.match(unknownHtml, /scene-content--quote-burst/);

  assert.match(renderers.renderConceptMapScene(makeScene('concept_map')), /scene-content--concept-map/);
  assert.match(renderers.renderTimelineScene(makeScene('timeline')), /scene-content--timeline/);
}

try {
  run();
  console.log('hyperframes scene renderers tests passed');
} catch (error) {
  console.error(error);
  process.exit(1);
}
