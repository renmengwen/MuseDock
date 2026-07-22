const assert = require('assert');
const {
  materializeSceneImageSequenceDom,
  validateSceneImageSequenceDom,
} = require('../server/services/creative-video/html-video/sceneImageSequenceDom');
const { createCreativeWorkflowRetryPlan } = require('../server/services/creative-video/retryPlanner');
const { htmlEscape } = require('../server/services/creative-video/html-video/captionLayer');
const { buildFallbackFrameHtml } = require('../server/services/creative-video/html-video/frameFallbackBuilder');

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
    ...(extra.camera ? { camera: extra.camera } : {}),
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

{
  const managedNode = node('fullscreen_relay', [shot('s1', 'a', 0, 4)]);
  const fallback = buildFallbackFrameHtml({ node: managedNode, overlayOnly: true });
  const result = materializeSceneImageSequenceDom({
    html: fallback,
    node: managedNode,
    creativeContext: { asset_context: { assets } },
  });
  assert.equal(result.success, true, result.message);
  assert.match(result.html, /data-hv-image-sequence="true"/);
  assert.match(result.html, /<section class="panel">/);
  assert.match(result.html, /html,body\{[^}]*background:transparent/);
  assert.match(result.html, /\.stage\{[^}]*background:transparent/);
  assert.doesNotMatch(result.html, /linear-gradient\(135deg,#101418/);

  const opaque = buildFallbackFrameHtml({ node: managedNode });
  assert.match(opaque, /linear-gradient\(135deg,#101418 0%,#1d2730 58%,#28323b 100%\)/);
}

for (const duplicateMarkup of [
  '<img src="../assets/a.png">',
  '<img src="../assets/a&period;png">',
  '<style>.duplicate{background-image:url(../assets/a.png)}</style>',
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

for (const legalNonVisualUrl of [
  '<svg><filter id="soft"><feGaussianBlur stdDeviation="2"></feGaussianBlur></filter></svg><style>main{filter:url(#soft)}</style>',
  '<style>/* .fake{background:url(../assets/a.png)} */ main{color:#fff}</style>',
  '<style>@font-face{font-family:Demo;src:url(../assets/demo.woff2) format("woff2")}main{font-family:Demo}</style>',
]) {
  const legal = materializeSceneImageSequenceDom({
    html: shell.replace('<main>美术壳</main>', `<main>美术壳${legalNonVisualUrl}</main>`),
    node: node('fullscreen_relay', [shot('s1', 'a', 0, 4)]),
    creativeContext: { asset_context: { assets } },
  });
  assert.equal(legal.success, true, `非视觉 URL 不得被 Shot 静态门误杀：${legalNonVisualUrl}`);
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
  assert.match(result.html, /body>\[data-hv-canvas\],body>#root,\[data-hv-canvas\]>\[data-role="main-visual"\]\)\{background-color:transparent!important\}/, '明确的全画布模型壳及其主视觉平面纯背景色必须透明');
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
  assert.deepEqual(plan.executor_options, {
    regenerate_frame_html: true,
    frame_ids: ['scene:scene_01'],
  });
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

// ===== D-07 / D-08：scene 内摄影机聚焦构建期契约 =====

// canonical focus_regions 夹具：A/B 自动聚焦，C 仅 soft 宽松聚焦，D/非法/缺 region 过滤。
const focusRegions = [
  { id: 'r_a', label: 'Star', region: { x: 0.55, y: 0.1, width: 0.3, height: 0.25 }, focus_point: { x: 0.7, y: 0.225 }, trust_level: 'A' },
  { id: 'r_b', label: 'Price', region: { x: 0.1, y: 0.55, width: 0.25, height: 0.3 }, focus_point: { x: 0.225, y: 0.7 }, trust_level: 'B' },
  { id: 'r_center', label: 'Center', region: { x: 0.3, y: 0.3, width: 0.2, height: 0.2 }, trust_level: 'A' },
  { id: 'r_c', label: 'Chart', region: { x: 0.65, y: 0.65, width: 0.3, height: 0.3 }, focus_point: { x: 0.66, y: 0.67 }, trust_level: 'C' },
  { id: 'r_d', label: 'Logo', region: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, focus_point: { x: 0.5, y: 0.5 }, trust_level: 'D' },
  { id: 'r_bad', label: 'Broken', region: { x: 0.9, y: 0.9, width: 0.3, height: 0.3 }, focus_point: { x: 0.95, y: 0.95 }, trust_level: 'A' },
];
const cameraAssets = assets.map(asset => asset.id === 'a' ? { ...asset, focus_regions: focusRegions } : asset);

function focusCue(id, regionId, captionIds, effect = 'camera_zoom') {
  return {
    id,
    caption_ids: captionIds,
    keyword: '关键词',
    region_id: regionId,
    effect,
    ...(effect === 'camera_zoom' ? { zoom: 'auto' } : {}),
    return_policy: 'hold_or_next',
  };
}

{
  const cameraNode = node('fullscreen_relay', [shot('s1', 'a', 0, 4, {
    caption_ids: ['cap_01', 'cap_02'],
    camera: {
      initial_view: 'overview',
      focus_cues: [
        focusCue('cue_a', 'r_a', ['cap_01']),
        focusCue('cue_h', 'r_a', ['cap_01'], 'highlight_only'),
        focusCue('cue_c', 'r_c', ['cap_01']),
        { ...focusCue('cue_c_soft', 'r_c', ['cap_01']), zoom: 'soft' },
        { ...focusCue('cue_c_missing_zoom', 'r_c', ['cap_01']), zoom: undefined },
        focusCue('cue_d', 'r_d', ['cap_01']),
        focusCue('cue_missing', 'r_none', ['cap_01']),
        focusCue('cue_bad', 'r_bad', ['cap_01']),
        focusCue('cue_no_caption', 'r_a', []),
        focusCue('cue_center', 'r_center', ['cap_02']),
        focusCue('cue_b', 'r_b', ['cap_01', 'cap_02']),
      ],
    },
  })]);
  cameraNode.metadata.captions = [
    { id: 'cap_01', start: 0.5, end: 2, text: '第一段' },
    { id: 'cap_02', start: 2, end: 3.5, text: '第二段' },
  ];
  const args = { html: shell, node: cameraNode, creativeContext: { asset_context: { assets: cameraAssets } } };
  const result = materializeSceneImageSequenceDom(args);
  assert.equal(result.success, true, `含 cue 场景物化失败：${result.message || ''}`);
  const expectedCues = [
    { id: 'cue_a', start_sec: 0.5, end_sec: 2, region: { x: 0.55, y: 0.1, width: 0.3, height: 0.25 }, focus_point: { x: 0.7, y: 0.225 }, max_zoom: 3 },
    { id: 'cue_c_soft', start_sec: 0.5, end_sec: 2, region: { x: 0.65, y: 0.65, width: 0.3, height: 0.3 }, focus_point: { x: 0.8, y: 0.8 }, max_zoom: 1.5, min_zoom: 1.15 },
    { id: 'cue_center', start_sec: 2, end_sec: 3.5, region: { x: 0.3, y: 0.3, width: 0.2, height: 0.2 }, focus_point: { x: 0.4, y: 0.4 }, max_zoom: 3 },
    { id: 'cue_b', start_sec: 0.5, end_sec: 3.5, region: { x: 0.1, y: 0.55, width: 0.25, height: 0.3 }, focus_point: { x: 0.225, y: 0.7 }, max_zoom: 2.4 },
  ];
  assert.ok(
    result.html.includes(`data-camera-cues="${htmlEscape(JSON.stringify(expectedCues))}"`),
    'A/B 级 camera_zoom cue 必须按原顺序预解析进 DOM data 属性（时间窗/region 几何/focus_point/max_zoom）',
  );
  for (const excluded of ['cue_h', 'cue_c', 'cue_c_missing_zoom', 'cue_d', 'cue_missing', 'cue_bad', 'cue_no_caption']) {
    assert.ok(!result.html.includes(`&quot;id&quot;:&quot;${excluded}&quot;`), `highlight_only/C 非 soft/D/解析失败的 cue 不得进入摄影机数据：${excluded}`);
  }
  const soft = result.contract.shots[0].camera_cues.find(cue => cue.id === 'cue_c_soft');
  const automatic = result.contract.shots[0].camera_cues.find(cue => cue.id === 'cue_a');
  assert.equal(soft.min_zoom, 1.15, 'C soft cue 必须携带最小有效推近倍率');
  assert.equal('min_zoom' in automatic, false, 'A/B 自动聚焦不得新增最小倍率字段');
  assert.deepEqual(soft.region, focusRegions[3].region, 'C 级构建期必须保留原 region，按真实画布动态决定宽松扩张');
  assert.deepEqual(soft.focus_point, { x: 0.8, y: 0.8 }, 'C 级必须忽略偏心模型点并使用原 region 中心');
  assert.match(result.html, /computeCameraTransform/, '含 cue 场景必须注入 cameraMath 摄影机运行时');
  assert.equal(validateSceneImageSequenceDom(result.html, args).success, true);
  assert.equal(materializeSceneImageSequenceDom({ ...args, html: result.html }).html, result.html, '摄影机注入必须幂等');

  const tamperedZoom = result.html.replace('&quot;max_zoom&quot;:3}', '&quot;max_zoom&quot;:30}');
  assert.notEqual(tamperedZoom, result.html, '篡改夹具必须命中 max_zoom 序列化');
  assert.equal(validateSceneImageSequenceDom(tamperedZoom, args).success, false, '篡改摄影机数据必须被校验拒绝');

  const deletedRuntime = result.html.replace('var computeCameraTransform = module.exports && module.exports.computeCameraTransform;', '');
  assert.notEqual(deletedRuntime, result.html, '删除摄影机运行时夹具必须命中');
  assert.equal(validateSceneImageSequenceDom(deletedRuntime, args).success, false, '删除摄影机运行时必须被校验拒绝');

  const bypassedRuntime = result.html.replace(
    'var computeCameraTransform = module.exports && module.exports.computeCameraTransform;',
    'return;\n  var computeCameraTransform = module.exports && module.exports.computeCameraTransform;',
  );
  assert.notEqual(bypassedRuntime, result.html, '提前退出摄影机运行时夹具必须命中');
  assert.equal(validateSceneImageSequenceDom(bypassedRuntime, args).success, false, '提前退出摄影机运行时必须被校验拒绝');
}

{
  // 全部 cue 被过滤（highlight_only/C auto/D/缺 region）的场景必须与无 camera 场景零差异。
  const filteredNode = node('fullscreen_relay', [shot('s1', 'a', 0, 4, {
    camera: {
      initial_view: 'overview',
      focus_cues: [
        focusCue('cue_h', 'r_a', ['caption_s1'], 'highlight_only'),
        focusCue('cue_c', 'r_c', ['caption_s1']),
        focusCue('cue_d', 'r_d', ['caption_s1']),
        focusCue('cue_missing', 'r_none', ['caption_s1']),
      ],
    },
  })]);
  const plainNode = node('fullscreen_relay', [shot('s1', 'a', 0, 4)]);
  const filtered = materializeSceneImageSequenceDom({ html: shell, node: filteredNode, creativeContext: { asset_context: { assets: cameraAssets } } });
  const plain = materializeSceneImageSequenceDom({ html: shell, node: plainNode, creativeContext: { asset_context: { assets: cameraAssets } } });
  const legacy = materializeSceneImageSequenceDom({ html: shell, node: plainNode, creativeContext: { asset_context: { assets } } });
  assert.equal(filtered.success, true);
  assert.equal(filtered.html, plain.html, '全部 cue 被过滤的场景必须与无 camera 场景字节级一致');
  assert.equal(plain.html, legacy.html, '素材有无 focus_regions 不得影响无 cue 输出');
  assert.ok(!plain.html.includes('data-camera-cues'), '无 cue 场景不得出现摄影机数据属性');
  assert.ok(!plain.html.includes('computeCameraTransform'), '无 cue 场景不得注入摄影机运行时');

  const spoofArgs = { html: shell, node: plainNode, creativeContext: { asset_context: { assets: cameraAssets } } };
  const spoofed = plain.html.replace('data-shot-id="s1"', 'data-shot-id="s1" data-camera-cues="[]"');
  assert.notEqual(spoofed, plain.html);
  assert.equal(validateSceneImageSequenceDom(spoofed, spoofArgs).success, false, '无 cue Shot 不得携带计划外摄影机数据');
}

{
  // 混合场景：含 cue Shot 带数据，无 cue Shot 的 figure 保持既有字节。
  const mixed = node('fullscreen_relay', [
    shot('s1', 'a', 0, 2.2, {
      caption_ids: ['cap_01'],
      camera: { initial_view: 'overview', focus_cues: [focusCue('cue_a', 'r_a', ['cap_01'])] },
    }),
    shot('s2', 'b', 1.8, 4),
  ]);
  mixed.metadata.captions = [{ id: 'cap_01', start: 0, end: 2, text: '第一段' }];
  const args = { html: shell, node: mixed, creativeContext: { asset_context: { assets: cameraAssets } } };
  const result = materializeSceneImageSequenceDom(args);
  assert.equal(result.success, true, result.message);
  const s2At = result.html.indexOf('data-shot-id="s2"');
  const s2Figure = result.html.slice(s2At, result.html.indexOf('</figure>', s2At));
  assert.ok(result.html.includes('data-camera-cues="'), '含 cue Shot 必须携带摄影机数据');
  assert.ok(!s2Figure.includes('data-camera-cues'), '无 cue Shot 的 figure 不得新增摄影机属性');
  assert.equal(validateSceneImageSequenceDom(result.html, args).success, true);
}

{
  // cue/caption id 含引号与 & 时序列化必须安全转义并可幂等重物化。
  const quoted = node('fullscreen_relay', [shot('s1', 'a', 0, 4, {
    caption_ids: ['字幕"&一'],
    camera: { initial_view: 'overview', focus_cues: [focusCue('cue"&x', 'r_a', ['字幕"&一'])] },
  })]);
  quoted.metadata.captions = [{ id: '字幕"&一', start: 0.5, end: 2, text: '字幕' }];
  const args = { html: shell, node: quoted, creativeContext: { asset_context: { assets: cameraAssets } } };
  const result = materializeSceneImageSequenceDom(args);
  assert.equal(result.success, true, result.message);
  assert.equal(validateSceneImageSequenceDom(result.html, args).success, true);
  assert.equal(materializeSceneImageSequenceDom({ ...args, html: result.html }).html, result.html);
}

async function verifyShotExitTransition() {
  const result = materializeSceneImageSequenceDom({
    html: shell,
    node: node('fullscreen_relay', [shot('s1', 'a', 0, 2.2), shot('s2', 'b', 1.8, 4)]),
    creativeContext: { asset_context: { assets } },
  });
  assert.equal(result.success, true);
  const browser = await require('playwright-core').chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const overlayFallback = materializeSceneImageSequenceDom({
      html: buildFallbackFrameHtml({ node: node('fullscreen_relay', [shot('s1', 'a', 0, 4)]), overlayOnly: true }),
      node: node('fullscreen_relay', [shot('s1', 'a', 0, 4)]),
      creativeContext: { asset_context: { assets } },
    });
    assert.equal(overlayFallback.success, true, overlayFallback.message);
    await page.setContent(overlayFallback.html);
    const stacking = await page.evaluate(() => ({
      htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      stageBackgroundImage: getComputedStyle(document.querySelector('.stage')).backgroundImage,
      stageBackgroundColor: getComputedStyle(document.querySelector('.stage')).backgroundColor,
      sequenceZ: getComputedStyle(document.querySelector('[data-hv-image-sequence]')).zIndex,
      panelExists: Boolean(document.querySelector('.panel')),
    }));
    assert.equal(stacking.htmlBackground, 'rgba(0, 0, 0, 0)', '受管图片 fallback 的 html 必须透明');
    assert.equal(stacking.bodyBackground, 'rgba(0, 0, 0, 0)', '受管图片 fallback 的 body 必须透明');
    assert.equal(stacking.stageBackgroundImage, 'none', '受管图片 fallback 的全屏 stage 不得保留渐变');
    assert.equal(stacking.stageBackgroundColor, 'rgba(0, 0, 0, 0)', '受管图片 fallback 的 stage 必须透明');
    assert.equal(stacking.sequenceZ, '0', '受管图片层必须保留在底层');
    assert.equal(stacking.panelExists, true, '透明 fallback 必须保留文字 panel');

    await page.setContent(result.html);
    await page.waitForTimeout(400);
    const exiting = await page.evaluate(() => {
      window.__mpSetTimelineTime(2.2);
      const element = document.querySelector('[data-shot-id="s1"]');
      const style = getComputedStyle(element);
      return {
        active: element.dataset.shotActive,
        opacity: Number(style.opacity),
        visibility: style.visibility,
        pointerEvents: style.pointerEvents,
      };
    });
    assert.equal(exiting.active, undefined, 'Shot 到达 end_sec 必须退出 active_window');
    assert.ok(exiting.opacity > 0.5, 'Shot 退出淡化开始时仍应可见');
    assert.equal(exiting.visibility, 'visible', 'visibility 不得抢先截断 0.35s 退出淡化');
    assert.equal(exiting.pointerEvents, 'none', '退出 Shot 不得响应交互');
    await page.waitForTimeout(400);
    const exited = await page.locator('[data-shot-id="s1"]').evaluate((element) => {
      const style = getComputedStyle(element);
      return { opacity: Number(style.opacity), visibility: style.visibility, pointerEvents: style.pointerEvents };
    });
    assert.equal(exited.opacity, 0, '退出淡化完成后 Shot 应完全透明');
    assert.equal(exited.visibility, 'hidden', '退出淡化完成后 Shot 应隐藏');
    assert.equal(exited.pointerEvents, 'none', '隐藏 Shot 不得响应交互');
  } finally {
    await browser.close();
  }
}

verifyShotExitTransition()
  .then(() => console.log('html-video scene image sequence DOM tests passed'))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
