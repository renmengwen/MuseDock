const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { applyCaptionLayer } = require('../server/services/creative-video/html-video/captionLayer');
const { inspectFrameHtmlLayout } = require('../server/services/creative-video/html-video/layoutQaService');
const { materializeSceneImageSequenceDom } = require('../server/services/creative-video/html-video/sceneImageSequenceDom');

const resolution = { width: 640, height: 360 };
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#123"/><circle cx="1200" cy="180" r="80" fill="#fff"/></svg>').toString('base64');
const imageUrl = `data:image/svg+xml;base64,${svg}`;

function previewHtml(
  twoCues = false,
  targetRegion = { x: 0.68, y: 0.08, width: 0.15, height: 0.18 },
  { trustLevel = 'A', zoom } = {},
) {
  const captions = twoCues
    ? [{ id: 'cap_1', start: 1, end: 1.5, text: '聚焦目标', focus_keyword: '聚焦目标' }, { id: 'cap_2', start: 3, end: 3.8, text: '转向次要目标' }]
    : [{ id: 'cap_1', start: 1, end: 3, text: '聚焦目标', focus_keyword: '聚焦目标' }];
  const shot = {
    id: 'shot_1', asset_id: 'asset_1', role: 'showcase', requirement: 'required',
    caption_ids: captions.map(caption => caption.id), minimum_visible_duration_sec: 1,
    active_window: { time_base: 'scene_local', start_sec: 0, end_sec: 4 },
    camera: { focus_cues: [{
      id: 'cue_1', caption_ids: ['cap_1'], region_id: 'target', effect: 'camera_zoom',
      ...(zoom ? { zoom } : {}),
    }, ...(twoCues ? [{
      id: 'cue_2', caption_ids: ['cap_2'], region_id: 'target_2', effect: 'camera_zoom',
    }] : [])] },
  };
  const visualBase = { type: 'image_sequence', sequence_mode: 'fullscreen_relay', shots: [shot] };
  const node = {
    id: 'scene:scene_qa', duration_sec: 4,
    metadata: { captions, visual_beats: [{ id: 'beat_1', visual_base: visualBase }] },
  };
  const result = materializeSceneImageSequenceDom({
    html: '<!doctype html><html><head><style>html,body{margin:0;width:640px;height:360px;overflow:hidden}</style></head><body data-hv-canvas></body></html>',
    node,
    creativeContext: { asset_context: { assets: [{
      id: 'asset_1', media_type: 'image', status: 'ready', path: 'assets/a.svg', frame_src: '../assets/a.svg',
      focus_regions: [{
        id: 'target', trust_level: trustLevel,
        region: targetRegion,
        focus_point: { x: targetRegion.x + targetRegion.width / 2, y: targetRegion.y + targetRegion.height / 2 },
      }, {
        id: 'target_2', trust_level: 'A',
        region: { x: 0.08, y: 0.12, width: 0.15, height: 0.18 },
        focus_point: { x: 0.155, y: 0.21 },
      }],
    }] } },
  });
  assert.equal(result.success, true, result.message);
  return applyCaptionLayer(result.html, captions)
    .replaceAll('../assets/a.svg', imageUrl)
    .replace('</body>', '<script>window.__hvPlaybackClock.play()</script></body>');
}

(async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'camera-preview-qa-'));
  const htmlPath = path.join(tempDir, 'preview.html');
  await fs.writeFile(htmlPath, previewHtml(), 'utf8');

  const report = await inspectFrameHtmlLayout({
    htmlPath,
    frame: { id: 'scene_qa', duration_sec: 4 },
    resolution,
    sampleTimesSec: [0.05, 0.5, 1.4, 2, 2.8, 3.7],
  });
  assert.equal(report.metrics.skipped, false, '必须使用真实 Chrome 执行 Scene Preview QA');
  assert.equal(report.success, true, JSON.stringify(report.issues));
  assert.equal(report.metrics.camera_samples.length, 6, '所有采样必须复用同一页面的确定性时间线');
  assert.deepEqual(report.metrics.camera_samples.map(sample => sample.sample_time_sec), [0.05, 0.5, 1.4, 2, 2.8, 3.7]);
  assert.ok(report.metrics.camera_samples.every(sample => sample.adapter_controlled && !sample.clock_paused));
  assert.ok(report.metrics.camera_samples.every(sample => (
    sample.clock_time_sec >= sample.sample_time_sec
    && sample.clock_time_sec - sample.sample_time_sec < 0.2
  )), '浏览器共享时钟应连续运行到请求采样点附近');
  assert.ok(report.metrics.camera_samples[0].clock_time_sec - 0.05 < 0.08, '0.05s 早期采样不得被固定探针推迟超过 0.08s');
  assert.ok(report.metrics.camera_samples[2].shots[0].scale > 1, 'caption start 后应采到摄影机推近');
  assert.equal(report.metrics.camera_samples[3].shots[0].caption_boxes.length, 1, '同一采样应采到激活字幕');

  const twoCuePath = path.join(tempDir, 'two-cues.html');
  await fs.writeFile(twoCuePath, previewHtml(true), 'utf8');
  const heldBetweenCues = await inspectFrameHtmlLayout({
    htmlPath: twoCuePath,
    frame: { id: 'scene_two_cues', duration_sec: 4 },
    resolution,
    sampleTimesSec: [2.5],
  });
  assert.ok(heldBetweenCues.metrics.camera_samples[0].shots[0].scale > 1, '中间 cue 应保持上一焦点到下一 cue 开始');
  assert.equal(heldBetweenCues.issues.some(issue => issue.code === 'camera_untrusted_motion'), false);
  const twoCueDefaults = await inspectFrameHtmlLayout({
    htmlPath: twoCuePath,
    frame: { id: 'scene_two_cues_default', duration_sec: 4 },
    resolution,
  });
  const twoCueTimes = twoCueDefaults.metrics.camera_samples.map(sample => sample.sample_time_sec);
  assert.ok([1.05, 1.15, 1.25, 1.35].every(time => twoCueTimes.includes(time)));
  assert.ok([3.05, 3.15, 3.25, 3.35].every(time => twoCueTimes.includes(time)));
  assert.ok([0.95, 1.45, 2.95, 3.45].every(time => twoCueTimes.includes(time)), '每个 cue 必须包含切换前与 transition-complete 稳定采样');
  assert.ok(twoCueTimes.includes(1.8) && twoCueTimes.includes(3.7), '多 cue 密采样仍须保留既有全场景采样');
  const beforeSecond = twoCueDefaults.metrics.camera_samples.find(sample => sample.sample_time_sec === 2.95).shots[0];
  const afterSecond = twoCueDefaults.metrics.camera_samples.find(sample => sample.sample_time_sec === 3.05).shots[0];
  assert.equal(beforeSecond.cue.id, 'cue_1');
  assert.equal(afterSecond.cue.id, 'cue_2');
  const handoffDelta = Math.hypot(afterSecond.tx - beforeSecond.tx, afterSecond.ty - beforeSecond.ty, (afterSecond.scale - beforeSecond.scale) * 100);
  assert.ok(handoffDelta > 0 && handoffDelta < 40, `双 cue 交接应连续变化且无瞬跳，实际 delta=${handoffDelta}`);

  const returnPath = path.join(tempDir, 'return-overview.html');
  await fs.writeFile(returnPath, previewHtml(false, { x: 0.68, y: 0.75, width: 0.15, height: 0.15 }), 'utf8');
  const returning = await inspectFrameHtmlLayout({
    htmlPath: returnPath,
    frame: { id: 'scene_return', duration_sec: 4 },
    resolution,
  });
  const returnSamples = returning.metrics.camera_samples.filter(sample => [3.15, 3.45].includes(sample.sample_time_sec));
  assert.deepEqual(returnSamples.map(sample => sample.sample_time_sec), [3.15, 3.45], '默认计划必须包含最后 cue 的两个回全景采样点');
  assert.ok(returnSamples.every(sample => sample.shots[0].returning_to_overview));
  assert.notEqual(returnSamples[0].shots[0].scale, returnSamples[1].shots[0].scale, '回全景过程必须可观测到连续变化');
  assert.equal(returning.issues.some(issue => issue.code === 'camera_target_out_of_safe_area'), false, '合法回全景阶段不得继续套用聚焦目标安全区');

  const rejectedSoftPath = path.join(tempDir, 'rejected-soft-overview.html');
  const rejectedSoftHtml = previewHtml(false, {
    x: 0.1, y: 0.1, width: 0.8, height: 0.8,
  }, { trustLevel: 'C', zoom: 'soft' });
  assert.match(rejectedSoftHtml, /<span class="hv-caption-kw">聚焦目标<\/span>/, 'Camera no-op 不得移除字幕关键词高亮');
  await fs.writeFile(rejectedSoftPath, rejectedSoftHtml, 'utf8');
  const rejectedSoft = await inspectFrameHtmlLayout({
    htmlPath: rejectedSoftPath,
    frame: { id: 'scene_rejected_soft', duration_sec: 4 },
    resolution,
    sampleTimesSec: [2],
  });
  const rejectedShot = rejectedSoft.metrics.camera_samples[0].shots[0];
  assert.equal(rejectedSoft.success, true, JSON.stringify(rejectedSoft.issues));
  assert.equal(rejectedShot.cue, null, 'Runtime 拒绝的 C soft cue 必须按全景采样');
  assert.equal(rejectedShot.has_transform, false, 'Runtime 拒绝的 C soft cue 不得产生 transform');
  assert.equal(rejectedShot.target_box, null, 'Runtime 拒绝的 cue 不得继续生成静态目标框');
  assert.equal(rejectedShot.caption_boxes.length, 1, '摄影机降级不得影响同时间窗字幕激活');
  assert.equal(
    rejectedSoft.issues.some(issue => ['camera_target_out_of_safe_area', 'camera_caption_target_overlap', 'camera_wrong_focus'].includes(issue.code)),
    false,
    '已降级全景不得产生焦点安全区、字幕遮挡或错误聚焦问题',
  );

  const legalSoftPath = path.join(tempDir, 'legal-soft-focus.html');
  await fs.writeFile(legalSoftPath, previewHtml(false, {
    x: 0.68, y: 0.08, width: 0.15, height: 0.18,
  }, { trustLevel: 'C', zoom: 'soft' }), 'utf8');
  const legalSoft = await inspectFrameHtmlLayout({
    htmlPath: legalSoftPath,
    frame: { id: 'scene_legal_soft', duration_sec: 4 },
    resolution,
    sampleTimesSec: [2],
  });
  const legalShot = legalSoft.metrics.camera_samples[0].shots[0];
  assert.equal(legalSoft.success, true, JSON.stringify(legalSoft.issues));
  assert.equal(legalShot.cue.id, 'cue_1', '合法 C soft cue 必须保留运行时焦点身份');
  assert.ok(legalShot.scale >= 1.15 && legalShot.scale <= 1.5, `合法 C soft scale 越界：${legalShot.scale}`);
  assert.equal(legalShot.caption_boxes.length, 1, '合法 C soft 聚焦时字幕必须同步激活');

  const identityNoOpPath = path.join(tempDir, 'materialized-identity-noop.html');
  await fs.writeFile(identityNoOpPath, previewHtml(false, {
    x: 0.1, y: 1 / 18, width: 0.8, height: 0.5,
  }), 'utf8');
  const identityNoOp = await inspectFrameHtmlLayout({
    htmlPath: identityNoOpPath,
    frame: { id: 'scene_identity_noop', duration_sec: 4 },
    resolution,
    sampleTimesSec: [2],
  });
  const identityNoOpShot = identityNoOp.metrics.camera_samples[0].shots[0];
  assert.equal(identityNoOp.success, true, JSON.stringify(identityNoOp.issues));
  assert.equal(identityNoOpShot.camera_runtime_resolved, true, '真实 Runtime 必须完成 identity cue 解析');
  assert.equal(identityNoOpShot.cue, null, '最终 target 为 identity 的 cue 必须解析为空接受集');
  assert.equal(identityNoOpShot.has_transform, false, 'identity cue 必须保持安全全景');

  const zoomOnePanPath = path.join(tempDir, 'materialized-zoom-one-pan.html');
  await fs.writeFile(zoomOnePanPath, previewHtml(false, {
    x: 0.1, y: 0, width: 0.8, height: 0.5,
  }), 'utf8');
  const zoomOnePan = await inspectFrameHtmlLayout({
    htmlPath: zoomOnePanPath,
    frame: { id: 'scene_zoom_one_pan', duration_sec: 4 },
    resolution,
    sampleTimesSec: [2],
  });
  const zoomOnePanShot = zoomOnePan.metrics.camera_samples[0].shots[0];
  assert.equal(zoomOnePan.success, true, JSON.stringify(zoomOnePan.issues));
  assert.equal(zoomOnePanShot.cue.id, 'cue_1', 'zoom=1 但存在真实 pan 的 cue 必须保留');
  assert.ok(Math.abs(zoomOnePanShot.scale - 1) < 1e-4 && Math.abs(zoomOnePanShot.ty) >= 0.01);
  assert.equal(zoomOnePanShot.has_transform, true, 'zoom=1 的真实 pan 必须被 QA 识别为 transform');

  const issueReport = await inspectFrameHtmlLayout({
    htmlPath: path.join(__dirname, 'fixtures', 'html-video-layout-qa', 'camera-issues.html'),
    frame: { id: 'scene_bad', duration_sec: 2 },
    resolution,
    sampleTimesSec: [1],
    allowStaticCameraCues: true,
  });
  assert.equal(issueReport.success, false);
  const codes = new Set(issueReport.issues.map(issue => issue.code));
  assert.ok(codes.has('camera_target_out_of_safe_area'));
  assert.ok(codes.has('camera_caption_target_overlap'));
  assert.ok(codes.has('camera_wrong_focus'), 'wrong_focus 只能由 fixture 人工 expected region 触发');
  assert.equal(codes.has('camera_runtime_unresolved'), false, '显式静态 QA fixture 不得伪报生产 Runtime 缺失');

  async function inspectInline(name, body, sampleTimesSec = [0.1], layoutOptions = {}) {
    const inlinePath = path.join(tempDir, name);
    await fs.writeFile(inlinePath, `<!doctype html><html><head><style>html,body{margin:0;width:640px;height:360px;overflow:hidden}[data-hv-image-sequence],[data-hv-shot]{position:absolute;inset:0;margin:0}img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:0 0}</style></head><body>${body}</body></html>`, 'utf8');
    return inspectFrameHtmlLayout({
      htmlPath: inlinePath,
      frame: { id: name, duration_sec: 2 },
      resolution,
      ...layoutOptions,
      ...(sampleTimesSec ? { sampleTimesSec } : {}),
    });
  }

  const requiredFigure = requirement => `<section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay" style="--fixture:yes;transform:translateZ(0)"><figure data-hv-shot="true" data-shot-active="true" data-shot-id="visibility-${requirement}" data-shot-requirement="${requirement}"><img data-shot-layer="background" src="${imageUrl}"><img data-shot-layer="foreground" src="${imageUrl}"></figure></section>`;
  const visibleRequired = await inspectInline('required-visible.html', requiredFigure('required'));
  const visibleMetric = visibleRequired.metrics.image_sequence_visibility_samples[0];
  assert.equal(visibleRequired.success, true, JSON.stringify(visibleRequired.issues));
  assert.ok(visibleMetric.changed_pixel_ratio >= 0.05, `required 素材必须贡献大面积真实像素：${JSON.stringify(visibleMetric)}`);
  assert.equal(visibleMetric.style_restored, true, '截图探针必须精确恢复 Image Sequence inline style');

  const occludedRequired = await inspectInline(
    'required-occluded.html',
    `${requiredFigure('required')}<div aria-hidden="true" style="position:absolute;inset:0;z-index:9;background:#f4f1e8"></div>`,
  );
  assert.equal(occludedRequired.success, false, 'required 素材被全画布不透明壳遮住时必须阻断');
  assert.ok(occludedRequired.issues.some(issue => issue.code === 'required_asset_occluded'));
  assert.ok(occludedRequired.metrics.image_sequence_visibility_samples[0].changed_pixel_ratio < 0.05);

  const localOverlay = await inspectInline(
    'required-local-overlay.html',
    `${requiredFigure('required')}<div aria-hidden="true" style="position:absolute;right:0;top:0;width:20%;height:100%;z-index:9;background:linear-gradient(#fff,#ddd)"></div>`,
  );
  assert.equal(localOverlay.success, true, JSON.stringify(localOverlay.issues));
  assert.equal(localOverlay.issues.some(issue => issue.code === 'required_asset_occluded'), false, '局部 overlay 不得误判为素材总遮挡');

  const optionalOccluded = await inspectInline(
    'optional-occluded.html',
    `${requiredFigure('optional')}<div aria-hidden="true" style="position:absolute;inset:0;z-index:9;background:#f4f1e8"></div>`,
  );
  assert.equal(optionalOccluded.issues.some(issue => issue.code === 'required_asset_occluded'), false, 'optional 素材不适用 required 可见性阻断');
  assert.equal(optionalOccluded.metrics.image_sequence_visibility_samples.length, 0);

  const blank = await inspectInline('blank.html', '<section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay"></section>');
  assert.ok(blank.issues.some(issue => issue.code === 'camera_scene_blank'));

  const notReady = await inspectInline('not-ready.html', '<section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay"><figure data-hv-shot="true" data-shot-active="true" data-shot-id="missing"><img data-shot-layer="background" src="missing.png"><img data-shot-layer="foreground" src="missing.png"></figure></section>');
  assert.ok(notReady.issues.some(issue => issue.code === 'camera_image_not_ready'));
  assert.ok(notReady.issues.some(issue => issue.code === 'camera_blank_edge'));

  const rogue = await inspectInline('rogue.html', `<section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay"><figure data-hv-shot="true" data-shot-active="true" data-shot-id="rogue"><img data-shot-layer="background" src="${imageUrl}"><img data-shot-layer="foreground" style="transform:scale(4)" src="${imageUrl}"></figure></section>`);
  assert.ok(rogue.issues.some(issue => issue.code === 'camera_zoom_out_of_range'));
  assert.ok(rogue.issues.some(issue => issue.code === 'camera_untrusted_motion'));

  const plannedCue = JSON.stringify([{
    id: 'cue_planned', start_sec: 0, end_sec: 2, max_zoom: 1.5,
    region: { x: 0.2, y: 0.1, width: 0.2, height: 0.2 },
  }]);
  const missingRuntime = await inspectInline('missing-camera-runtime.html', `<section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay"><figure data-hv-shot="true" data-shot-active="true" data-shot-id="missing-runtime" data-layout-qa-static-camera-cues="true" data-camera-cues='${plannedCue}'><img data-shot-layer="background" src="${imageUrl}"><img data-shot-layer="foreground" src="${imageUrl}"></figure></section>`, [1]);
  assert.equal(missingRuntime.success, false, '存在合法 cue 但 Camera runtime 缺失时必须阻断');
  assert.ok(missingRuntime.issues.some(issue => issue.code === 'camera_runtime_unresolved'), '页面属性不得伪造静态 fixture 豁免');

  const identityRuntime = await inspectInline('identity-camera-runtime.html', `<section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay"><figure data-hv-shot="true" data-shot-active="true" data-shot-id="identity-runtime" data-camera-cues='${plannedCue}'><img data-shot-layer="background" src="${imageUrl}"><img data-shot-layer="foreground" src="${imageUrl}"></figure></section><script>document.querySelector('[data-hv-shot]').__hvResolvedCameraCues=${plannedCue}</script>`, [1]);
  assert.equal(identityRuntime.success, false, 'Runtime 接受 cue 后稳定窗仍为 identity 时必须阻断');
  assert.ok(identityRuntime.issues.some(issue => issue.code === 'camera_transform_missing'));

  for (const [name, transform] of [
    ['tx-threshold', 'translateX(0.01px)'],
    ['scale-threshold', 'scale(1.0001)'],
  ]) {
    const boundary = await inspectInline(`${name}.html`, `<section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay"><figure data-hv-shot="true" data-shot-active="true" data-shot-id="${name}" data-camera-cues='${plannedCue}'><img data-shot-layer="background" src="${imageUrl}"><img data-shot-layer="foreground" style="transform:${transform}" src="${imageUrl}"></figure></section><script>document.querySelector('[data-hv-shot]').__hvResolvedCameraCues=${plannedCue}</script>`, [1]);
    const boundaryShot = boundary.metrics.camera_samples[0].shots[0];
    assert.equal(boundaryShot.has_transform, true, `${name} 必须落在与 Runtime/formatTransform 互补的非 identity 边界`);
    assert.equal(boundary.issues.some(issue => issue.code === 'camera_transform_missing'), false);
  }

  const jitter = await inspectInline('jitter.html', `<section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay"><figure data-hv-shot="true" data-shot-active="true" data-shot-id="jitter" data-camera-cues='[{"start_sec":0,"end_sec":2,"max_zoom":1.5}]'><img data-shot-layer="background" src="${imageUrl}"><img data-shot-layer="foreground" src="${imageUrl}"></figure></section><script>window.__mpSetTimelineTime=function(t){var values=[0,10,-10,10];document.querySelector('[data-shot-layer="foreground"]').style.transform='translateX('+(values[Math.round((t-.05)*10)]||0)+'px)'}</script>`, null, { allowStaticCameraCues: true });
  const jitterTimes = jitter.metrics.camera_samples.map(sample => sample.sample_time_sec);
  assert.deepEqual(jitterTimes.slice(0, 4), [0.05, 0.15, 0.25, 0.35], '默认 Camera 路径必须从 cue 过渡窗派生密集采样');
  assert.ok(jitterTimes.includes(1.2) && jitterTimes.includes(1.8), 'Camera 密采样不得替换既有全场景默认采样');
  assert.ok(jitter.issues.some(issue => issue.code === 'camera_jitter'));

  const sixCues = Array.from({ length: 6 }, (_, index) => ({
    id: `cue_${index + 1}`,
    start_sec: 1 + index * 2,
    end_sec: 2 + index * 2,
    max_zoom: 1.5,
  }));
  const manyCuePath = path.join(tempDir, 'six-cues.html');
  await fs.writeFile(manyCuePath, `<!doctype html><html><head><style>html,body{margin:0;width:640px;height:360px;overflow:hidden}[data-hv-image-sequence],[data-hv-shot]{position:absolute;inset:0;margin:0}img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:0 0}</style></head><body><section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay"><figure data-hv-shot="true" data-shot-active="true" data-shot-id="many" data-window-end-sec="14" data-camera-cues='${JSON.stringify(sixCues)}'><img data-shot-layer="background" src="${imageUrl}"><img data-shot-layer="foreground" src="${imageUrl}"></figure></section><script>window.__mpSetTimelineTime=function(){}</script></body></html>`, 'utf8');
  const manyCueReport = await inspectFrameHtmlLayout({
    htmlPath: manyCuePath,
    frame: { id: 'six_cues', duration_sec: 14 },
    resolution,
    allowStaticCameraCues: true,
  });
  const manyCueTimes = manyCueReport.metrics.camera_samples.map(sample => sample.sample_time_sec);
  assert.ok(manyCueTimes.includes(11.45), '6 个 cue 时不得截断最后 cue 的稳定采样点');
  assert.ok(manyCueTimes.includes(13.7), '6 个 cue 时仍须保留 duration-0.3 全场景尾点');
  assert.ok(manyCueTimes.includes(12.15) && manyCueTimes.includes(12.45), '最后 cue 的默认回全景采样不得被前序 cue 挤掉');

  console.log('html-video camera preview chromium tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
