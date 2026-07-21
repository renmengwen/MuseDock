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

function previewHtml() {
  const captions = [{ id: 'cap_1', start: 1, end: 3, text: '聚焦目标' }];
  const shot = {
    id: 'shot_1', asset_id: 'asset_1', role: 'showcase', requirement: 'required',
    caption_ids: ['cap_1'], minimum_visible_duration_sec: 1,
    active_window: { time_base: 'scene_local', start_sec: 0, end_sec: 4 },
    camera: { focus_cues: [{
      id: 'cue_1', caption_ids: ['cap_1'], region_id: 'target', effect: 'camera_zoom',
    }] },
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
        id: 'target', trust_level: 'A',
        region: { x: 0.68, y: 0.08, width: 0.15, height: 0.18 },
        focus_point: { x: 0.755, y: 0.17 },
      }],
    }] } },
  });
  assert.equal(result.success, true, result.message);
  return applyCaptionLayer(result.html, captions).replaceAll('../assets/a.svg', imageUrl);
}

(async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'camera-preview-qa-'));
  const htmlPath = path.join(tempDir, 'preview.html');
  await fs.writeFile(htmlPath, previewHtml(), 'utf8');

  const report = await inspectFrameHtmlLayout({
    htmlPath,
    frame: { id: 'scene_qa', duration_sec: 4 },
    resolution,
    sampleTimesSec: [0.5, 1.4, 2, 2.8, 3.7],
  });
  assert.equal(report.metrics.skipped, false, '必须使用真实 Chrome 执行 Scene Preview QA');
  assert.equal(report.success, true, JSON.stringify(report.issues));
  assert.equal(report.metrics.camera_samples.length, 5, '所有采样必须复用同一页面的确定性时间线');
  assert.deepEqual(report.metrics.camera_samples.map(sample => sample.sample_time_sec), [0.5, 1.4, 2, 2.8, 3.7]);
  assert.ok(report.metrics.camera_samples[1].shots[0].scale > 1, 'caption start 后应采到摄影机推近');
  assert.equal(report.metrics.camera_samples[2].shots[0].caption_boxes.length, 1, '同一采样应采到激活字幕');

  const issueReport = await inspectFrameHtmlLayout({
    htmlPath: path.join(__dirname, 'fixtures', 'html-video-layout-qa', 'camera-issues.html'),
    frame: { id: 'scene_bad', duration_sec: 2 },
    resolution,
    sampleTimesSec: [1],
  });
  assert.equal(issueReport.success, false);
  const codes = new Set(issueReport.issues.map(issue => issue.code));
  assert.ok(codes.has('camera_target_out_of_safe_area'));
  assert.ok(codes.has('camera_caption_target_overlap'));
  assert.ok(codes.has('camera_wrong_focus'), 'wrong_focus 只能由 fixture 人工 expected region 触发');

  async function inspectInline(name, body, sampleTimesSec = [0.1]) {
    const inlinePath = path.join(tempDir, name);
    await fs.writeFile(inlinePath, `<!doctype html><html><head><style>html,body{margin:0;width:640px;height:360px;overflow:hidden}[data-hv-image-sequence],[data-hv-shot]{position:absolute;inset:0;margin:0}img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:0 0}</style></head><body>${body}</body></html>`, 'utf8');
    return inspectFrameHtmlLayout({
      htmlPath: inlinePath,
      frame: { id: name, duration_sec: 2 },
      resolution,
      sampleTimesSec,
    });
  }

  const blank = await inspectInline('blank.html', '<section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay"></section>');
  assert.ok(blank.issues.some(issue => issue.code === 'camera_scene_blank'));

  const notReady = await inspectInline('not-ready.html', '<section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay"><figure data-hv-shot="true" data-shot-active="true" data-shot-id="missing"><img data-shot-layer="background" src="missing.png"><img data-shot-layer="foreground" src="missing.png"></figure></section>');
  assert.ok(notReady.issues.some(issue => issue.code === 'camera_image_not_ready'));
  assert.ok(notReady.issues.some(issue => issue.code === 'camera_blank_edge'));

  const rogue = await inspectInline('rogue.html', `<section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay"><figure data-hv-shot="true" data-shot-active="true" data-shot-id="rogue"><img data-shot-layer="background" src="${imageUrl}"><img data-shot-layer="foreground" style="transform:scale(4)" src="${imageUrl}"></figure></section>`);
  assert.ok(rogue.issues.some(issue => issue.code === 'camera_zoom_out_of_range'));
  assert.ok(rogue.issues.some(issue => issue.code === 'camera_untrusted_motion'));

  const jitter = await inspectInline('jitter.html', `<section data-hv-image-sequence="true" data-sequence-mode="fullscreen_relay"><figure data-hv-shot="true" data-shot-active="true" data-shot-id="jitter" data-camera-cues='[{"start_sec":0,"end_sec":2,"max_zoom":1.5}]'><img data-shot-layer="background" src="${imageUrl}"><img data-shot-layer="foreground" src="${imageUrl}"></figure></section><script>window.__mpSetTimelineTime=function(t){document.querySelector('[data-shot-layer="foreground"]').style.transform='translateX('+([0,10,-10,10][Math.round(t*10)-1]||0)+'px)'}</script>`, [0.1, 0.2, 0.3, 0.4]);
  assert.ok(jitter.issues.some(issue => issue.code === 'camera_jitter'));

  console.log('html-video camera preview chromium tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
