const assert = require('assert/strict');

const { materializeSceneImageSequenceDom } = require('../server/services/creative-video/html-video/sceneImageSequenceDom');

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#123"/><circle cx="1200" cy="220" r="100" fill="#fff"/></svg>').toString('base64');
const imageUrl = `data:image/svg+xml;base64,${svg}`;
const shell = '<!doctype html><html><head><style>html,body{margin:0;width:640px;height:360px;overflow:hidden}</style></head><body data-hv-canvas><script>window.__mpAdapterControlled=true</script></body></html>';
const asset = {
  id: 'a',
  media_type: 'image',
  status: 'ready',
  path: 'assets/a.svg',
  frame_src: '../assets/a.svg',
  focus_regions: [{
    id: 'target',
    label: '目标',
    trust_level: 'A',
    region: { x: 0.68, y: 0.12, width: 0.15, height: 0.18 },
    focus_point: { x: 0.755, y: 0.21 },
  }],
};

function node(withCue) {
  const shot = {
    id: 'shot_1',
    asset_id: 'a',
    role: 'showcase',
    requirement: 'required',
    caption_ids: ['cap_1'],
    minimum_visible_duration_sec: 1,
    active_window: { time_base: 'scene_local', start_sec: 0, end_sec: 4 },
  };
  if (withCue) {
    shot.camera = {
      initial_view: 'overview',
      focus_cues: [{
        id: 'cue_1',
        caption_ids: ['cap_1'],
        region_id: 'target',
        effect: 'camera_zoom',
      }],
    };
  }
  const visualBase = { type: 'image_sequence', sequence_mode: 'fullscreen_relay', shots: [shot] };
  return {
    id: 'scene:scene_01',
    duration_sec: 4,
    metadata: {
      captions: [{ id: 'cap_1', start: 1, end: 3, text: '聚焦目标' }],
      visual_beats: [{ id: 'beat_1', visual_base: visualBase }],
    },
  };
}

function html(withCue) {
  const result = materializeSceneImageSequenceDom({
    html: shell,
    node: node(withCue),
    creativeContext: { asset_context: { assets: [asset] } },
  });
  assert.equal(result.success, true, result.message);
  return result.html.replaceAll('../assets/a.svg', imageUrl);
}

async function transformAt(page, timeSec) {
  return page.evaluate((time) => {
    window.__mpSetTimelineTime(time);
    return document.querySelector('img[data-shot-layer="foreground"]').style.transform;
  }, timeSec);
}

(async () => {
  const browser = await require('playwright-core').chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.setContent(html(true));
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalWidth === 1600);

    const overview = await transformAt(page, 0.5);
    const moving = await transformAt(page, 1.4);
    const heldA = await transformAt(page, 2);
    const heldB = await transformAt(page, 2.8);
    const returned = await transformAt(page, 3.7);
    assert.equal(overview, '', 'cue 前必须保持全景基线');
    assert.notEqual(moving, '', 'cue 过渡窗口内 foreground transform 必须变化');
    assert.notEqual(heldA, '', 'cue 保持期必须维持聚焦 transform');
    assert.equal(heldB, heldA, 'cue 保持期 transform 必须稳定');
    assert.equal(returned, '', '末尾时间足够时 cue 外必须回到全景基线');

    await page.setContent(html(false));
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalWidth === 1600);
    assert.equal(await transformAt(page, 2), '', '无 camera_zoom cue 的 Shot 不得改变 foreground transform');
    assert.ok(!html(false).includes('computeCameraTransform'), '无 cue 输出不得注入摄影机运行时');
  } finally {
    await browser.close();
  }
  console.log('html-video camera runtime chromium tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
