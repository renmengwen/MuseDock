const assert = require('assert/strict');

const { materializeSceneImageSequenceDom } = require('../server/services/creative-video/html-video/sceneImageSequenceDom');
const { applyCaptionLayer, applyFocusKeywords, focusKeywordsByCaptionId } = require('../server/services/creative-video/html-video/captionLayer');

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#123"/><circle cx="1200" cy="220" r="100" fill="#fff"/></svg>').toString('base64');
const imageUrl = `data:image/svg+xml;base64,${svg}`;
const shell = '<!doctype html><html><head><style>html,body{margin:0;width:640px;height:360px;overflow:hidden}</style></head><body data-hv-canvas><script>window.__mpAdapterControlled=true</script></body></html>';
const asset = {
  id: 'a',
  media_type: 'image',
  status: 'ready',
  path: 'assets/a.svg',
  frame_src: '../assets/a.svg',
  focus_regions: [
    {
      id: 'target',
      label: '目标',
      trust_level: 'A',
      region: { x: 0.68, y: 0.12, width: 0.15, height: 0.18 },
      focus_point: { x: 0.755, y: 0.21 },
    },
    {
      id: 'target_c',
      label: '目标',
      trust_level: 'C',
      region: { x: 0.68, y: 0.12, width: 0.15, height: 0.18 },
      focus_point: { x: 0.69, y: 0.13 },
    },
    {
      id: 'target_d',
      label: '目标',
      trust_level: 'D',
      region: { x: 0.68, y: 0.12, width: 0.15, height: 0.18 },
      focus_point: { x: 0.755, y: 0.21 },
    },
  ],
};

function node(withCue, { regionId = 'target', zoom } = {}) {
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
        keyword: '目标',
        keywords_by_caption_id: { cap_1: '目标' },
        region_id: regionId,
        effect: 'camera_zoom',
        ...(zoom ? { zoom } : {}),
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

function html(withCue, options) {
  const graphNode = node(withCue, options);
  const result = materializeSceneImageSequenceDom({
    html: shell,
    node: graphNode,
    creativeContext: { asset_context: { assets: [asset] } },
  });
  assert.equal(result.success, true, result.message);
  const captions = applyFocusKeywords(graphNode.metadata.captions, focusKeywordsByCaptionId(graphNode));
  return applyCaptionLayer(result.html, captions).replaceAll('../assets/a.svg', imageUrl);
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
    assert.equal(overview, '', 'cue 前必须保持全景基线');
    assert.notEqual(moving, '', 'cue 过渡窗口内 foreground transform 必须变化');
    const synchronized = await page.evaluate(() => {
      const caption = document.querySelector('[data-caption-id="cap_1"]');
      const keyword = caption?.querySelector('.hv-caption-kw');
      return {
        active: caption?.dataset.hvActive === 'true',
        keyword: keyword?.textContent || '',
        color: keyword ? getComputedStyle(keyword).color : '',
      };
    });
    assert.deepEqual(synchronized, { active: true, keyword: '目标', color: 'rgb(255, 213, 74)' }, '同一 focus cue 必须在摄影机过渡时同步激活字幕原文关键词');
    const heldA = await transformAt(page, 2);
    const heldB = await transformAt(page, 2.8);
    const returned = await transformAt(page, 3.7);
    assert.notEqual(heldA, '', 'cue 保持期必须维持聚焦 transform');
    assert.equal(heldB, heldA, 'cue 保持期 transform 必须稳定');
    assert.equal(returned, '', '末尾时间足够时 cue 外必须回到全景基线');

    await page.setContent(html(true, { regionId: 'target_c', zoom: 'soft' }));
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalWidth === 1600);
    const soft = await transformAt(page, 2);
    assert.notEqual(soft, '', 'C 级 soft cue 必须应用宽松聚焦 transform');
    const softScale = Number(soft.match(/scale\(([^)]+)\)/)?.[1]);
    assert.ok(softScale > 1 && softScale <= 1.5, `C 级 scale 必须在 (1, 1.5]，实际 ${softScale}`);
    const softCaption = await page.evaluate(() => ({
      active: document.querySelector('[data-caption-id="cap_1"]')?.dataset.hvActive === 'true',
      keyword: document.querySelector('[data-caption-id="cap_1"] .hv-caption-kw')?.textContent || '',
    }));
    assert.deepEqual(softCaption, { active: true, keyword: '目标' }, 'C 级聚焦必须与字幕关键词同步');

    const dHtml = html(true, { regionId: 'target_d', zoom: 'soft' });
    await page.setContent(dHtml);
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalWidth === 1600);
    assert.equal(await transformAt(page, 2), '', 'D 级即使伪造 soft cue 也不得移动');
    assert.ok(!dHtml.includes('computeCameraTransform'), 'D 级 cue 被过滤后不得注入摄影机运行时');

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
