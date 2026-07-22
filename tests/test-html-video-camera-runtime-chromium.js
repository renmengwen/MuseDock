const assert = require('assert/strict');

const { materializeSceneImageSequenceDom } = require('../server/services/creative-video/html-video/sceneImageSequenceDom');
const { applyCaptionLayer, applyFocusKeywords, focusKeywordsByCaptionId } = require('../server/services/creative-video/html-video/captionLayer');

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#123"/><circle cx="1200" cy="220" r="100" fill="#fff"/></svg>').toString('base64');
const imageUrl = `data:image/svg+xml;base64,${svg}`;
const portraitSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#123"/></svg>').toString('base64');
const portraitImageUrl = `data:image/svg+xml;base64,${portraitSvg}`;
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
      id: 'target_2',
      label: '次要目标',
      trust_level: 'A',
      region: { x: 0.08, y: 0.12, width: 0.15, height: 0.18 },
      focus_point: { x: 0.155, y: 0.21 },
    },
    {
      id: 'target_c',
      label: '目标',
      trust_level: 'C',
      region: { x: 0.68, y: 0.12, width: 0.15, height: 0.18 },
      focus_point: { x: 0.69, y: 0.13 },
    },
    {
      id: 'target_c_wide',
      label: '目标',
      trust_level: 'C',
      region: { x: 0.2, y: 0.1, width: 0.6, height: 0.2 },
      focus_point: { x: 0.21, y: 0.11 },
    },
    {
      id: 'target_c_full',
      label: '目标',
      trust_level: 'C',
      region: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
      focus_point: { x: 0.5, y: 0.5 },
    },
    {
      id: 'target_c_tall',
      label: '纵向目标',
      trust_level: 'C',
      region: { x: 0.4, y: 0.21, width: 0.2, height: 0.58 },
      focus_point: { x: 0.5, y: 0.5 },
    },
    {
      id: 'target_bottom',
      label: '目标',
      trust_level: 'A',
      region: { x: 0.68, y: 0.65, width: 0.15, height: 0.12 },
      focus_point: { x: 0.755, y: 0.71 },
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

function node(withCue, { regionId = 'target', zoom, twoCues = false } = {}) {
  const captions = twoCues
    ? [{ id: 'cap_1', start: 1, end: 1.5, text: '聚焦目标' }, { id: 'cap_2', start: 3, end: 3.8, text: '转向次要目标' }]
    : [{ id: 'cap_1', start: 1, end: 3, text: '聚焦目标' }];
  const shot = {
    id: 'shot_1',
    asset_id: 'a',
    role: 'showcase',
    requirement: 'required',
    caption_ids: captions.map(caption => caption.id),
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
      }, ...(twoCues ? [{
        id: 'cue_2',
        caption_ids: ['cap_2'],
        keyword: '次要目标',
        keywords_by_caption_id: { cap_2: '次要目标' },
        region_id: 'target_2',
        effect: 'camera_zoom',
      }] : [])],
    };
  }
  const visualBase = { type: 'image_sequence', sequence_mode: 'fullscreen_relay', shots: [shot] };
  return {
    id: 'scene:scene_01',
    duration_sec: 4,
    metadata: {
      captions,
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

async function cameraStateAt(page, timeSec) {
  return page.evaluate((time) => {
    window.__mpSetTimelineTime(time);
    const figure = document.querySelector('[data-hv-shot]');
    const image = figure.querySelector('img[data-shot-layer="foreground"]');
    const cue = [...figure.__hvResolvedCameraCues].reverse().find(candidate => time >= candidate.start_sec);
    const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
    return { cueId: cue?.id || null, tx: matrix.m41, ty: matrix.m42, scale: Math.hypot(matrix.m11, matrix.m12) };
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

    await page.setContent(html(true, { twoCues: true }));
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalWidth === 1600);
    for (let round = 1; round <= 10; round += 1) {
      const beforeSecond = await cameraStateAt(page, 2.95);
      const afterSecond = await cameraStateAt(page, 3.05);
      assert.equal(beforeSecond.cueId, 'cue_1');
      assert.equal(afterSecond.cueId, 'cue_2');
      const handoffDelta = Math.hypot(
        afterSecond.tx - beforeSecond.tx,
        afterSecond.ty - beforeSecond.ty,
        (afterSecond.scale - beforeSecond.scale) * 100,
      );
      assert.ok(handoffDelta > 0 && handoffDelta < 40, `第 ${round} 轮精确 seek 的双 cue 交接必须连续变化且无瞬跳，实际 delta=${handoffDelta}`);
    }

    await page.setContent(html(true, { regionId: 'target_bottom' }));
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalWidth === 1600);
    await page.evaluate(() => window.__mpSetTimelineTime(2));
    const transformOrigin = await page.locator('img[data-shot-layer="foreground"]').evaluate(image => (
      getComputedStyle(image).transformOrigin
    ));
    assert.equal(transformOrigin, '0px 0px', 'DOMMatrix 映射要求 foreground transform-origin 精确位于左上角');
    const safeRegion = await page.evaluate(() => {
      const figure = document.querySelector('[data-hv-shot][data-camera-cues]');
      const image = figure.querySelector('img[data-shot-layer="foreground"]');
      const cue = JSON.parse(figure.dataset.cameraCues)[0];
      const baseScale = Math.min(image.clientWidth / image.naturalWidth, image.clientHeight / image.naturalHeight);
      const baseLeft = (image.clientWidth - image.naturalWidth * baseScale) / 2;
      const baseTop = (image.clientHeight - image.naturalHeight * baseScale) / 2;
      const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
      const map = (x, y) => matrix.transformPoint(new DOMPoint(
        baseLeft + x * image.naturalWidth * baseScale,
        baseTop + y * image.naturalHeight * baseScale,
      ));
      const topLeft = map(cue.region.x, cue.region.y);
      const bottomRight = map(cue.region.x + cue.region.width, cue.region.y + cue.region.height);
      return {
        transform: image.style.transform,
        safeBottom: image.clientHeight - 140,
        baseBottom: baseTop + (cue.region.y + cue.region.height) * image.naturalHeight * baseScale,
        mapped: { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y },
        canvas: { width: image.clientWidth, height: image.clientHeight },
      };
    });
    assert.notEqual(safeRegion.transform, '', '靠近字幕区的目标必须应用真实 foreground transform');
    assert.ok(safeRegion.baseBottom > safeRegion.safeBottom, '夹具目标在全景中必须进入字幕区，确保安全区断言有效');
    assert.ok(safeRegion.mapped.left >= 0 && safeRegion.mapped.top >= 0, `目标左上角必须在画布安全区内：${JSON.stringify(safeRegion)}`);
    assert.ok(safeRegion.mapped.right <= safeRegion.canvas.width, `目标右边界必须在画布安全区内：${JSON.stringify(safeRegion)}`);
    assert.ok(safeRegion.mapped.bottom <= safeRegion.safeBottom, `完整目标必须停留在 height-140 字幕安全区上方：${JSON.stringify(safeRegion)}`);

    await page.setContent(html(true, { regionId: 'target_c', zoom: 'soft' }));
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalWidth === 1600);
    const soft = await transformAt(page, 2);
    assert.notEqual(soft, '', 'C 级 soft cue 必须应用宽松聚焦 transform');
    const softScale = Number(soft.match(/scale\(([^)]+)\)/)?.[1]);
    assert.ok(softScale >= 1.15 && softScale <= 1.5, `C 级 scale 必须在 [1.15, 1.5]，实际 ${softScale}`);
    const softCaption = await page.evaluate(() => ({
      active: document.querySelector('[data-caption-id="cap_1"]')?.dataset.hvActive === 'true',
      keyword: document.querySelector('[data-caption-id="cap_1"] .hv-caption-kw')?.textContent || '',
    }));
    assert.deepEqual(softCaption, { active: true, keyword: '目标' }, 'C 级聚焦必须与字幕关键词同步');

    await page.setContent(html(true, { regionId: 'target_c_wide', zoom: 'soft' }));
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalWidth === 1600);
    const cappedSoft = await transformAt(page, 2);
    const cappedSoftScale = Number(cappedSoft.match(/scale\(([^)]+)\)/)?.[1]);
    assert.ok(cappedSoftScale >= 1.15, `原本可达 1.15 倍的 C 区域扩张后仍必须执行聚焦，实际 ${cappedSoft}`);
    const cappedCue = await page.locator('[data-hv-shot]').evaluate(figure => ({
      planned: JSON.parse(figure.dataset.cameraCues)[0],
      resolved: figure.__hvResolvedCameraCues[0],
    }));
    assert.equal(cappedCue.planned.region.width, 0.6, 'C 区域构建期必须保留原始宽度');
    assert.equal(Number(cappedCue.resolved.effective_region.width.toFixed(6)), Number((0.72 / 1.15).toFixed(6)), 'C 区域横轴运行时扩张必须封顶在 fillFactor/minZoom');

    await page.setViewportSize({ width: 1080, height: 1920 });
    const portraitHtml = html(true, { regionId: 'target_c_tall', zoom: 'soft' })
      .replace('width:640px;height:360px', 'width:1080px;height:1920px')
      .replaceAll(imageUrl, portraitImageUrl);
    await page.setContent(portraitHtml);
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalHeight === 1920);
    await page.evaluate(() => window.__mpSetTimelineTime(2));
    const portrait = await page.locator('[data-hv-shot]').evaluate((figure) => {
      const image = figure.querySelector('img[data-shot-layer="foreground"]');
      const cue = figure.__hvResolvedCameraCues[0];
      const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
      const baseScale = Math.min(image.clientWidth / image.naturalWidth, image.clientHeight / image.naturalHeight);
      const baseLeft = (image.clientWidth - image.naturalWidth * baseScale) / 2;
      const baseTop = (image.clientHeight - image.naturalHeight * baseScale) / 2;
      const map = (x, y) => matrix.transformPoint(new DOMPoint(
        baseLeft + x * image.naturalWidth * baseScale,
        baseTop + y * image.naturalHeight * baseScale,
      ));
      const region = cue.effective_region;
      const topLeft = map(region.x, region.y);
      const bottomRight = map(region.x + region.width, region.y + region.height);
      return {
        scale: Math.hypot(matrix.m11, matrix.m12),
        region,
        mapped: { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y },
        safe: { left: 0, top: 0, right: image.clientWidth, bottom: image.clientHeight - 140 },
      };
    });
    const portraitCapY = (1920 - 140) * 0.72 / (1920 * 1.15);
    assert.ok(portrait.scale >= 1.15, `9:16 C 区域必须达到 1.15 倍，实际 ${portrait.scale}`);
    assert.ok(Math.abs(portrait.region.height - portraitCapY) < 1e-6, `纵轴 effective region 必须按字幕安全区动态封顶，实际 ${portrait.region.height}`);
    assert.ok(portrait.region.height >= 0.58, '动态封顶不得缩小原始 C 区域');
    assert.ok(portrait.mapped.left >= portrait.safe.left && portrait.mapped.top >= portrait.safe.top, `effective region 左上角必须在安全区：${JSON.stringify(portrait)}`);
    assert.ok(portrait.mapped.right <= portrait.safe.right && portrait.mapped.bottom <= portrait.safe.bottom, `effective region 右下角必须在安全区：${JSON.stringify(portrait)}`);

    await page.setViewportSize({ width: 640, height: 360 });

    await page.setContent(html(true, { regionId: 'target_c_full', zoom: 'soft' }));
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalWidth === 1600);
    assert.equal(await transformAt(page, 2), '', '原本超过扩张 cap 的全幅 C 区域不得缩小后制造聚焦');
    assert.equal(
      await page.locator('[data-caption-id="cap_1"]').getAttribute('data-hv-active'),
      'true',
      'C 级摄影机 no-op 时字幕关键词仍应按同一 cue 激活',
    );

    const dHtml = html(true, { regionId: 'target_d', zoom: 'soft' });
    await page.setContent(dHtml);
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalWidth === 1600);
    assert.equal(await transformAt(page, 2), '', 'D 级即使伪造 soft cue 也不得移动');
    assert.ok(!dHtml.includes('computeCameraTransform'), 'D 级 cue 被过滤后不得注入摄影机运行时');

    await page.setContent(html(false));
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalWidth === 1600);
    assert.equal(await transformAt(page, 2), '', '无 camera_zoom cue 的 Shot 不得改变 foreground transform');
    assert.ok(!html(false).includes('computeCameraTransform'), '无 cue 输出不得注入摄影机运行时');

    const obscuringShell = shell.replace(
      '<body data-hv-canvas>',
      '<body data-hv-canvas><div aria-hidden="true" class="任意视觉底壳"></div><style>.任意视觉底壳{position:absolute;inset:0;background-color:#f00!important;background-image:linear-gradient(90deg,transparent 0 80%,rgba(0,255,0,.7))}</style>',
    );
    const revealed = materializeSceneImageSequenceDom({
      html: obscuringShell,
      node: node(false),
      creativeContext: { asset_context: { assets: [asset] } },
    });
    assert.equal(revealed.success, true, revealed.message);
    await page.setContent(revealed.html.replaceAll('../assets/a.svg', imageUrl));
    await page.waitForFunction(() => document.querySelector('img[data-shot-layer="foreground"]')?.naturalWidth === 1600);
    const shellStyle = await page.locator('.任意视觉底壳').evaluate(element => ({
      color: getComputedStyle(element).backgroundColor,
      image: getComputedStyle(element).backgroundImage,
    }));
    assert.equal(shellStyle.color, 'rgba(0, 0, 0, 0)', '任意类名的全画布 aria-hidden 实色壳必须只清除背景色');
    assert.match(shellStyle.image, /linear-gradient/, '局部渐变 overlay 必须保留');
  } finally {
    await browser.close();
  }
  console.log('html-video camera runtime chromium tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
