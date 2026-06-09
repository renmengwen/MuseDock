function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPreparedScene(scene = {}) {
  return scene?.prepared_visual_scene && typeof scene.prepared_visual_scene === 'object'
    ? scene.prepared_visual_scene
    : {};
}

function getObjects(scene = {}) {
  const dsl = getPreparedScene(scene);
  return Array.isArray(dsl.objects) ? dsl.objects : [];
}

function objectId(object = {}, index = 0) {
  return escapeHtml(object.id || `${object.type || 'object'}-${index + 1}`);
}

function objectText(object = {}) {
  return escapeHtml(object.text || object.label || object.title || object.code || '');
}

function renderObjectList(objects = [], className = 'visual-pill') {
  return objects.map((object, index) => (
    `<div class="${escapeHtml(className)}" data-visual-object="${objectId(object, index)}">${objectText(object)}</div>`
  )).join('');
}

function renderWorkflowScene(scene) {
  const objects = getObjects(scene);
  const nodes = objects.filter(object => ['node', 'step', 'keyword', 'metric'].includes(object.type));
  const connectors = objects.filter(object => object.type === 'connector');
  const renderNodes = nodes.length ? nodes : [
    { id: 'node-1', type: 'node', text: scene.headline || '关键步骤' },
  ];

  return [
    '<div class="scene-content scene-content--workflow" data-visual-type="workflow">',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    '  <div class="visual-flow">',
    renderNodes.map((node, index) => (
      `<div class="visual-node" data-visual-object="${objectId(node, index)}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${objectText(node)}</strong></div>`
    )).join(''),
    connectors.map((connector, index) => (
      `<div class="visual-connector" data-visual-object="${objectId(connector, index)}" data-from="${escapeHtml(connector.from || '')}" data-to="${escapeHtml(connector.to || '')}"></div>`
    )).join(''),
    '  </div>',
    '</div>',
  ].join('\n');
}

function renderCodePanelScene(scene) {
  const objects = getObjects(scene);
  const code = objects.find(object => object.type === 'code') || {};
  const terminal = objects.find(object => object.type === 'terminal') || { id: 'terminal-1', text: '运行中...' };
  const codeText = code.code || code.text || 'const idea = await ai.build();';

  return [
    '<div class="scene-content scene-content--code-panel" data-visual-type="code_panel">',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    '  <div class="visual-code-window" data-visual-object="code-window">',
    '    <div class="visual-window-dots"><i></i><i></i><i></i></div>',
    `    <pre class="visual-code-line" data-visual-object="${objectId(code, 0)}">${escapeHtml(codeText)}</pre>`,
    `    <div class="visual-terminal" data-visual-object="${objectId(terminal, 1)}">${objectText(terminal)}</div>`,
    '  </div>',
    '</div>',
  ].join('\n');
}

function renderUiMockupScene(scene) {
  const objects = getObjects(scene);
  const panelItems = objects.filter(object => ['panel', 'field', 'button', 'metric', 'keyword'].includes(object.type));
  const buttons = objects.filter(object => object.type === 'button');
  const primaryButton = buttons[0] || { id: 'button-1', text: '生成' };

  return [
    '<div class="scene-content scene-content--ui-mockup" data-visual-type="ui_mockup">',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    '  <div class="visual-ui-panel" data-visual-object="ui-panel">',
    renderObjectList(panelItems.filter(object => object.type !== 'button'), 'visual-ui-item'),
    `    <div class="visual-ui-button" data-visual-object="${objectId(primaryButton, 0)}">${objectText(primaryButton)}</div>`,
    '  </div>',
    '</div>',
  ].join('\n');
}

function renderSplitCompareScene(scene) {
  const columns = getObjects(scene).filter(object => object.type === 'column').slice(0, 2);
  const left = columns[0] || { id: 'compare-old', text: '旧流程' };
  const right = columns[1] || { id: 'compare-new', text: '新流程' };

  return [
    '<div class="scene-content scene-content--split-compare" data-visual-type="split_compare">',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    '  <div class="visual-compare-grid">',
    `    <div class="visual-compare-column visual-compare-column--old" data-visual-object="${objectId(left, 0)}"><span>过去</span><strong>${objectText(left)}</strong></div>`,
    '    <div class="visual-compare-vs">VS</div>',
    `    <div class="visual-compare-column visual-compare-column--new" data-visual-object="${objectId(right, 1)}"><span>现在</span><strong>${objectText(right)}</strong></div>`,
    '  </div>',
    '</div>',
  ].join('\n');
}

function renderConceptMapScene(scene) {
  const objects = getObjects(scene);
  const center = objects.find(object => object.type === 'center') || { id: 'concept-center', text: '核心' };
  const branches = objects.filter(object => object.type !== 'center');

  return [
    '<div class="scene-content scene-content--concept-map" data-visual-type="concept_map">',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    `  <div class="visual-concept-center" data-visual-object="${objectId(center, 0)}">${objectText(center)}</div>`,
    `  <div class="visual-concept-branches">${renderObjectList(branches, 'visual-branch')}</div>`,
    '</div>',
  ].join('\n');
}

function renderTimelineScene(scene) {
  const milestones = getObjects(scene).filter(object => ['milestone', 'node', 'keyword', 'step'].includes(object.type));
  const renderMilestones = milestones.length ? milestones : [
    { id: 'milestone-1', text: scene.headline || '关键节点' },
  ];

  return [
    '<div class="scene-content scene-content--timeline" data-visual-type="timeline">',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    `  <div class="visual-timeline">${renderMilestones.map((item, index) => `<div class="visual-milestone" data-visual-object="${objectId(item, index)}"><span>${index + 1}</span><strong>${objectText(item)}</strong></div>`).join('')}</div>`,
    '</div>',
  ].join('\n');
}

function renderQuoteBurstScene({ scene = {}, wordHtml = '' } = {}) {
  return [
    '<div class="scene-content scene-content--quote-burst" data-visual-type="quote_burst">',
    '  <div class="quote-mark">&ldquo;</div>',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    `  <div class="emphasis timed-cards">${wordHtml || ''}</div>`,
    '</div>',
  ].join('\n');
}

function renderSceneContent({ scene = {}, index = 0, captionText = '', wordHtml = '' } = {}) {
  const prepared = getPreparedScene(scene);
  const type = prepared.visualType || scene.visual_type || 'quote_burst';
  if (type === 'workflow') return renderWorkflowScene(scene, index);
  if (type === 'code_panel') return renderCodePanelScene(scene, index);
  if (type === 'ui_mockup') return renderUiMockupScene(scene, index);
  if (type === 'split_compare') return renderSplitCompareScene(scene, index);
  if (type === 'concept_map') return renderConceptMapScene(scene, index);
  if (type === 'timeline') return renderTimelineScene(scene, index);
  return renderQuoteBurstScene({ scene, wordHtml, captionText });
}

module.exports = {
  escapeHtml,
  renderSceneContent,
  renderWorkflowScene,
  renderCodePanelScene,
  renderUiMockupScene,
  renderSplitCompareScene,
  renderConceptMapScene,
  renderTimelineScene,
  renderQuoteBurstScene,
};
