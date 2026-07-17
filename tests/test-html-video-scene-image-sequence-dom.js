const assert = require('assert');
const {
  materializeSceneImageSequenceDom,
  validateSceneImageSequenceDom,
} = require('../server/services/creative-video/html-video/sceneImageSequenceDom');
const { createCreativeWorkflowRetryPlan } = require('../server/services/creative-video/retryPlanner');

const assets = ['a', 'b', 'c', 'd'].map(id => ({
  id,
  media_type: 'image',
  status: 'ready',
  path: `assets/${id}.png`,
  frame_src: `../assets/${id}.png`,
}));

function shot(id, assetId, start, end, extra = {}) {
  return {
    id,
    asset_id: assetId,
    role: extra.role || 'showcase',
    requirement: extra.requirement || 'optional',
    fit: extra.fit || 'cover',
    caption_ids: extra.caption_ids || [`caption_${id}`],
    minimum_visible_duration_sec: extra.minimum || 1,
    active_window: { time_base: 'scene_local', start_sec: start, end_sec: end },
    src: '../assets/tampered.png',
  };
}

function node(mode, shots) {
  const visualBase = { type: 'image_sequence', sequence_mode: mode, shots };
  return {
    id: 'scene:scene_01',
    duration_sec: 4,
    metadata: {
      visual_beats: [
        { id: 'scene_01_b1', visual_base: visualBase },
        { id: 'scene_01_b2', visual_base: JSON.parse(JSON.stringify(visualBase)) },
      ],
    },
  };
}

const shell = '<!doctype html><html><head></head><body data-hv-canvas><main>美术壳</main></body></html>';

for (const duplicateMarkup of [
  '<img src="../assets/a.png">',
  '<img src="../assets/a&period;png">',
  '<style>.duplicate{background-image:url(../assets/a.png)}</style>',
  '<style>.duplicate{background-image:url(../assets/a\\2e png)}</style>',
  '<svg><image href="../assets/a.png"></image></svg>',
]) {
  const duplicate = materializeSceneImageSequenceDom({
    html: shell.replace('<main>美术壳</main>', `<main>美术壳${duplicateMarkup}</main>`),
    node: node('fullscreen_relay', [shot('s1', 'a', 0, 4)]),
    creativeContext: { asset_context: { assets } },
  });
  assert.equal(duplicate.success, false, `美术壳重复 Shot 图片必须阻断：${duplicateMarkup}`);
  assert.equal(duplicate.code, 'frame_html_shot_contract_invalid');
}

{
  const literalsOnly = materializeSceneImageSequenceDom({
    html: shell.replace('<main>美术壳</main>', '<main>美术壳<!-- <img src="../assets/a.png"> --><script>const fake="../assets/a.png";</script></main>'),
    node: node('fullscreen_relay', [shot('s1', 'a', 0, 4)]),
    creativeContext: { asset_context: { assets } },
  });
  assert.equal(literalsOnly.success, true, '注释和 script 字符串不得产生假阳性');
  const injectedDuplicate = literalsOnly.html.replace('</main>', '<img src="../assets/a.png"></main>');
  assert.equal(materializeSceneImageSequenceDom({
    html: injectedDuplicate,
    node: node('fullscreen_relay', [shot('s1', 'a', 0, 4)]),
    creativeContext: { asset_context: { assets } },
  }).success, false, '阶段二次物化也必须检查 managed block 外的重复引用');
}

{
  const reservedGlobal = materializeSceneImageSequenceDom({
    html: shell.replace('</main>', '<script>window.__hvPlaybackClock={};</script></main>'),
    node: node('fullscreen_relay', [shot('s1', 'a', 0, 4)]),
    creativeContext: { asset_context: { assets } },
  });
  assert.equal(reservedGlobal.success, false, '模型壳不得占用系统保留的 __hvPlaybackClock');
}

for (const [mode, shots] of [
  ['fullscreen_relay', [shot('s1', 'a', 0, 2.2), shot('s2', 'b', 1.8, 4)]],
  ['overview_detail', [shot('s1', 'a', 0, 4, { role: 'overview' }), shot('s2', 'b', 1.5, 3.5, { role: 'detail' })]],
  ['semantic_compare', [shot('s1', 'a', 0, 4), shot('s2', 'b', 0, 4)]],
  ['rhythm_montage', [shot('s1', 'a', 0, 1.4), shot('s2', 'b', 1.1, 2.5), shot('s3', 'c', 2.2, 3.4), shot('s4', 'd', 3, 4)]],
]) {
  const args = { html: shell, node: node(mode, shots), creativeContext: { asset_context: { assets } } };
  const result = materializeSceneImageSequenceDom(args);
  assert.equal(result.success, true, `${mode}: ${result.message || ''}`);
  assert.equal((result.html.match(/<section[^>]+data-hv-image-sequence=/g) || []).length, 1);
  assert.equal((result.html.match(/<figure[^>]+data-hv-shot=/g) || []).length, shots.length);
  assert.match(result.html, new RegExp(`data-sequence-mode="${mode}"`));
  assert.doesNotMatch(result.html, /tampered/);
  for (const item of shots) {
    assert.match(result.html, new RegExp(`data-shot-id="${item.id}"`));
    assert.match(result.html, new RegExp(`data-asset-id="${item.asset_id}"`));
    assert.match(result.html, new RegExp(`data-caption-ids="caption_${item.id}"`));
    assert.match(result.html, new RegExp(`src="\.\.\/assets\/${item.asset_id}\.png"`));
  }
  assert.match(result.html, /data-shot-layer="background"[^>]+src="\.\.\/assets\/a\.png"/);
  assert.match(result.html, /data-shot-layer="foreground"[^>]+src="\.\.\/assets\/a\.png"/);
  assert.match(result.html, /object-fit:cover/);
  assert.match(result.html, /object-fit:contain/);
  assert.equal(validateSceneImageSequenceDom(result.html, args).success, true);
  assert.equal(materializeSceneImageSequenceDom({ ...args, html: result.html }).html, result.html, '注入必须幂等');
}

{
  const escaped = materializeSceneImageSequenceDom({
    html: shell,
    node: node('fullscreen_relay', [shot('镜头"&一', 'a', 0, 4, { caption_ids: ['字幕"&一'] })]),
    creativeContext: { asset_context: { assets } },
  });
  assert.equal(escaped.success, true);
  assert.match(escaped.html, /data-shot-id="镜头&amp;quot;&amp;一"|data-shot-id="镜头&quot;&amp;一"/);
  assert.doesNotMatch(escaped.html, /data-shot-id="镜头"&一"/);
}

{
  const plan = createCreativeWorkflowRetryPlan({
    workflow: {
      status: 'failed',
      last_failure: {
        code: 'frame_html_shot_contract_invalid',
        sub_stage: 'frame_html',
        frame_id: 'scene:scene_01',
      },
    },
    project: {},
  });
  assert.equal(plan.can_retry, true);
  assert.equal(plan.repair_action, 'retry_frame_html');
  assert.deepEqual(plan.executor_options, { frame_id: 'scene:scene_01' });
}

for (const bad of [
  node('fullscreen_relay', [shot('dup', 'a', 0, 2), shot('dup', 'b', 1.8, 4)]),
  node('fullscreen_relay', [shot('s1', 'missing', 0, 4)]),
  node('fullscreen_relay', [shot('s1', 'a', 2, 1)]),
  node('semantic_compare', [shot('s1', 'a', 0, 4)]),
  node('semantic_compare', [shot('s1', 'a', 0, 4), shot('s2', 'b', 1, 4)]),
  node('overview_detail', [shot('s1', 'a', 0, 3, { role: 'overview' }), shot('s2', 'b', 2, 4, { role: 'detail' })]),
  { ...node('fullscreen_relay', [shot('s1', 'a', 10, 12)]), duration_sec: 4 },
  { ...node('fullscreen_relay', [shot('s1', 'a', 0, 1), shot('s2', 'b', 2, 4)]), duration_sec: 4 },
  { ...node('fullscreen_relay', [shot('s1', 'a', 0, 3), shot('s2', 'b', 2, 4)]), duration_sec: 5 },
  { ...node('fullscreen_relay', [shot('s1', 'a', 2, 4), shot('s2', 'b', 0, 2)]), duration_sec: 4 },
  { ...node('semantic_compare', [shot('s1', 'a', 0.5, 4), shot('s2', 'b', 0.5, 4)]), duration_sec: 4 },
  { ...node('overview_detail', [shot('s1', 'a', 0, 3, { role: 'overview' }), shot('s2', 'b', 1, 3, { role: 'detail' })]), duration_sec: 4 },
  { ...node('fullscreen_relay', [shot('s1', 'a', 0, 4)]), duration_sec: 5, metadata: { ...node('fullscreen_relay', [shot('s1', 'a', 0, 4)]).metadata, beat_windows: [{ id: 'b1', start_sec: 0, end_sec: 4 }] } },
]) {
  const result = materializeSceneImageSequenceDom({ html: shell, node: bad, creativeContext: { asset_context: { assets } } });
  assert.equal(result.success, false);
  assert.equal(result.code, 'frame_html_shot_contract_invalid');
  assert.equal(result.retryable, true);
  assert.equal(result.repair_action, 'retry_frame_html');
}

for (const badAssets of [
  [...assets, { ...assets[0] }],
  assets.map(asset => asset.id === 'a' ? { ...asset, path: '../outside.png', frame_src: '../../outside.png' } : asset),
  assets.map(asset => asset.id === 'a' ? { ...asset, path: 'assets/a.png', frame_src: 'C:/outside.png' } : asset),
  assets.map(asset => asset.id === 'a' ? { ...asset, path: 'assets/a.png', frame_src: 'https://evil.example/a.png' } : asset),
  assets.map(asset => asset.id === 'a' ? { ...asset, path: 'assets/a.png', frame_src: 'assets/a.png' } : asset),
  assets.map(asset => asset.id === 'a' ? { ...asset, status: 'pending' } : asset),
  assets.map(asset => asset.id === 'a' ? { ...asset, status: 'rejected' } : asset),
]) {
  const result = materializeSceneImageSequenceDom({
    html: shell,
    node: node('fullscreen_relay', [shot('s1', 'a', 0, 4)]),
    creativeContext: { asset_context: { assets: badAssets } },
  });
  assert.equal(result.success, false, '重复 registry ID 或逃逸 src 必须阻断');
}

{
  const legacyAssets = assets.map(asset => asset.id === 'a' ? (({ status, ...legacy }) => legacy)(asset) : asset);
  assert.equal(materializeSceneImageSequenceDom({
    html: shell,
    node: node('fullscreen_relay', [shot('s1', 'a', 0, 4)]),
    creativeContext: { asset_context: { assets: legacyAssets } },
  }).success, true, 'legacy 素材缺 status 的兼容分支必须显式保留');
}

{
  const inconsistent = node('fullscreen_relay', [shot('s1', 'a', 0, 4)]);
  inconsistent.metadata.visual_beats[1].visual_base.shots[0].asset_id = 'b';
  const result = materializeSceneImageSequenceDom({ html: shell, node: inconsistent, creativeContext: { asset_context: { assets } } });
  assert.equal(result.success, false, '同 Scene 多 Beat 的 canonical sequence 不一致必须 fail-closed');
}

{
  const incomplete = node('fullscreen_relay', [shot('s1', 'a', 0, 4)]);
  incomplete.metadata.visual_beats[1].visual_base = { type: 'diagram' };
  assert.equal(materializeSceneImageSequenceDom({ html: shell, node: incomplete, creativeContext: { asset_context: { assets } } }).success, false);
}

{
  const args = { html: shell, node: node('fullscreen_relay', [shot('s1', 'a', 0, 4)]), creativeContext: { asset_context: { assets } } };
  const result = materializeSceneImageSequenceDom(args);
  const tampered = result.html.replace('data-asset-id="a"', 'data-asset-id="b"');
  assert.equal(validateSceneImageSequenceDom(tampered, args).success, false);
  assert.equal(validateSceneImageSequenceDom(result.html.replace('data-shot-role="showcase"', 'data-shot-role="detail"'), args).success, false);
}

console.log('html-video scene image sequence DOM tests passed');
