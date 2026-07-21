const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { buildSceneTimelineScript } = require('../server/services/creative-video/html-video/frameHtmlPhaseSupport');
const {
  defaultSampleTimes,
  inspectFrameHtmlLayout,
} = require('../server/services/creative-video/html-video/layoutQaService');

const fixtureDir = path.join(__dirname, 'fixtures', 'html-video-layout-qa');
const resolution = { width: 1920, height: 1080 };
const sampleTimesSec = [0.1];

async function inspectFixture(fileName, frame, extraOptions = {}) {
  return inspectFrameHtmlLayout({
    htmlPath: path.join(fixtureDir, fileName),
    frame,
    resolution,
    sampleTimesSec,
    ...extraOptions,
  });
}

(async () => {
  assert.deepEqual(defaultSampleTimes(), [0.1]);
  assert.deepEqual(defaultSampleTimes(0), [0.1]);
  assert.deepEqual(defaultSampleTimes(1), [0.5]);
  assert.deepEqual(defaultSampleTimes(1.2), [0.78, 0.9]);
  assert.deepEqual(defaultSampleTimes(10), [1.2, 1.8, 6.5, 9.7]);
  assert.deepEqual(defaultSampleTimes(1.25), [0.8, 0.95]);

  const overlay = await inspectFixture('overlay-valuation.html', { id: 'scene_06', duration_sec: 1 });
  assert.equal(overlay.metrics.skipped, false);
  assert.equal(overlay.success, false);
  assert.ok(overlay.issues.every(issue => issue.frame_id === 'scene_06'));
  assert.ok(
    overlay.issues.some(issue => issue.code === 'decorative_overlay_text' || issue.code === 'text_overlap'),
    'overlay-valuation.html 应报告 decorative_overlay_text 或 text_overlap',
  );

  const overlayFixed = await inspectFixture('overlay-valuation-fixed.html', { id: 'scene_06', duration_sec: 1 });
  assert.equal(overlayFixed.success, true);

  const overlayTwoSamples = await inspectFixture(
    'overlay-valuation.html',
    { id: 'scene_06', duration_sec: 1 },
    { sampleTimesSec: [0.1, 0.4] },
  );
  assert.equal(overlayTwoSamples.metrics.samples.length, 2);
  assert.equal(
    overlayTwoSamples.issues.length,
    overlay.issues.length,
    '同一问题在多个采样点应只报告一次',
  );

  const sampleBoundary = await inspectFixture(
    'overlay-valuation-fixed.html',
    { id: 'scene_sample_boundary', duration_sec: 1 },
    { sampleTimesSec: [0.1, 0.149, 0.15, 0.199, 0.2] },
  );
  assert.deepEqual(
    sampleBoundary.metrics.samples.map(sample => sample.sample_time_sec),
    [0.1, 0.15, 0.2],
    '相邻采样小于 0.05 秒应去重，恰好相隔 0.05 秒应保留',
  );

  const decorativeOverlap = await inspectFixture('decorative-overlap.html', { id: 'scene_11', duration_sec: 1 });
  assert.equal(decorativeOverlap.success, true, '装饰大数字垫底标题不应触发阻断式修复');
  assert.ok(
    decorativeOverlap.issues.some(issue => issue.code === 'decorative_overlay_text' && issue.severity === 'warning'),
    'decorative-overlap.html 应报告 warning 级 decorative_overlay_text',
  );

  const overlayFixedDefaultSamples = await inspectFixture(
    'overlay-valuation-fixed.html',
    { scene_id: 'scene_06', duration_sec: 1 },
    { sampleTimesSec: undefined },
  );
  assert.equal(overlayFixedDefaultSamples.success, true);
  assert.deepEqual(
    overlayFixedDefaultSamples.metrics.samples.map(sample => sample.sample_time_sec),
    [0.5],
  );

  const overflow = await inspectFixture('overflow-card-title.html', { id: 'scene_04', duration_sec: 1 });
  assert.equal(overflow.success, false);
  assert.ok(
    overflow.issues.some(issue => issue.code === 'text_out_of_container'),
    'overflow-card-title.html 应报告 text_out_of_container',
  );

  const overflowFixed = await inspectFixture('overflow-card-title-fixed.html', { id: 'scene_04', duration_sec: 1 });
  assert.equal(overflowFixed.success, true);

  const playAllOverlap = await inspectFixture('playall-overlap.html', { id: 'scene_07', duration_sec: 1 });
  assert.equal(playAllOverlap.success, false);
  assert.ok(
    playAllOverlap.issues.some(issue => issue.code === 'decorative_overlay_text' || issue.code === 'text_overlap'),
    'playall-overlap.html 应在 __hvPlayAll() 后报告文本重叠',
  );

  const timelineDir = await fs.mkdtemp(path.join(os.tmpdir(), 'layout-qa-continuous-clock-'));
  try {
    const timelinePath = path.join(timelineDir, 'scene.html');
    await fs.writeFile(timelinePath, `<!doctype html><html><head><style>
      html,body{width:1920px;height:1080px;margin:0;overflow:hidden}
      [data-mp-beat-scope]{position:absolute;left:100px;top:100px;opacity:0;transition:opacity .35s linear}
      body[data-mp-beat="beat_1"] [data-mp-beat-scope="beat_1"],
      body[data-mp-beat="beat_2"] [data-mp-beat-scope="beat_2"]{opacity:1}
    </style></head><body>
      <div data-mp-beat-scope="beat_1"><p data-text-key="subtitle">第一拍文本</p></div>
      <div data-mp-beat-scope="beat_2"><p data-text-key="subtitle">第二拍文本</p></div>
      ${buildSceneTimelineScript([
        { id: 'beat_1', start_sec: 0, end_sec: 0.5 },
        { id: 'beat_2', start_sec: 0.5, end_sec: 1.5 },
      ])}
    </body></html>`, 'utf8');
    const stableSecondBeat = await inspectFrameHtmlLayout({
      htmlPath: timelinePath,
      frame: { id: 'scene_continuous_clock', duration_sec: 1.5 },
      resolution,
      sampleTimesSec: [1],
    });
    assert.equal(stableSecondBeat.metrics.skipped, false);
    assert.equal(stableSecondBeat.success, true, '连续播放到第二 Beat 稳定点时只能看到活动文本');
  } finally {
    await fs.rm(timelineDir, { recursive: true, force: true });
  }

  const richTextNested = await inspectFixture('rich-text-nested.html', { id: 'scene_08', duration_sec: 1 });
  assert.equal(richTextNested.success, true);

  const textContainerSibling = await inspectFixture('text-container-sibling.html', { id: 'scene_12', duration_sec: 1 });
  assert.equal(textContainerSibling.success, true, '文本容器的空白区域不应与兄弟文本产生遮挡误报');

  const inactiveBeat = await inspectFixture(
    'inactive-beat-scope.html',
    { id: 'scene_13', duration_sec: 1 },
    { sampleTimesSec: [0.1] },
  );
  assert.equal(inactiveBeat.success, false, '浏览器最终可见的越界文本仍应被布局 QA 阻断');
  assert.ok(inactiveBeat.metrics.candidate_count > 0, '活动 Beat 文本仍应进入布局候选');
  assert.equal(
    inactiveBeat.issues.some(issue => issue.details?.text === '无 Scope 的透明祖先文本'),
    false,
    '无 Scope 的 opacity=0 祖先应让 opacity=1 后代退出候选',
  );
  assert.ok(
    inactiveBeat.issues.some(issue => issue.code === 'text_out_of_viewport' && issue.details?.text === '后代显式恢复可见'),
    '祖先 visibility:hidden 时，显式 visibility:visible 的后代仍应进入候选',
  );
  assert.ok(
    inactiveBeat.issues.some(issue => issue.code === 'text_out_of_viewport' && issue.details?.text === '动画覆盖隐藏态'),
    '动画使非活动 Beat Scope 实际可见时仍应进入候选',
  );

  const activatedBeat = await inspectFixture(
    'inactive-beat-scope.html',
    { id: 'scene_13', duration_sec: 1 },
    { sampleTimesSec: [0.8] },
  );
  assert.equal(activatedBeat.success, false, 'Beat 激活后，其越界文本仍应被布局 QA 阻断');
  assert.ok(
    activatedBeat.issues.some(issue => issue.code === 'text_out_of_viewport' && issue.details?.text === '第二拍越界文本'),
    '切换后的活动 Beat 文本必须重新进入候选',
  );

  const divRoleOverflow = await inspectFixture('div-role-overflow.html', { id: 'scene_09', duration_sec: 1 });
  assert.equal(divRoleOverflow.success, false);
  assert.ok(
    divRoleOverflow.issues.some(issue => issue.code === 'text_out_of_container'),
    'div-role-overflow.html 应报告 text_out_of_container',
  );

  const decorativeOverflow = await inspectFixture('decorative-overflow.html', { id: 'scene_10', duration_sec: 1 });
  assert.equal(decorativeOverflow.success, true);
  assert.ok(
    decorativeOverflow.issues.every(issue => issue.severity === 'warning'),
    '装饰编号或允许溢出的品牌字不应触发阻断式修复',
  );
  assert.equal(
    decorativeOverflow.issues.some(issue => issue.details?.text === '忽略的背景字'),
    false,
    'data-layout-ignore 元素应跳过布局检查',
  );

  const importFailure = await inspectFrameHtmlLayout({
    htmlPath: path.join(fixtureDir, 'overlay-valuation-fixed.html'),
    frame: { id: 'scene_import_failure', duration_sec: 1 },
    resolution,
    sampleTimesSec,
    importPlaywright: async () => {
      throw new Error('模拟 Playwright import 失败');
    },
  });
  assert.equal(importFailure.success, true);
  assert.equal(importFailure.metrics.skipped, true);
  assert.ok(importFailure.issues.some(issue => issue.code === 'LAYOUT_QA_ENVIRONMENT_NOT_CONFIGURED'));

  const launchFailure = await inspectFrameHtmlLayout({
    htmlPath: path.join(fixtureDir, 'overlay-valuation-fixed.html'),
    frame: { id: 'scene_launch_failure', duration_sec: 1 },
    resolution,
    sampleTimesSec,
    playwright: {
      chromium: {
        launch: async () => {
          throw new Error('模拟 Chromium 启动失败');
        },
      },
    },
  });
  assert.equal(launchFailure.success, true);
  assert.equal(launchFailure.metrics.skipped, true);
  assert.ok(launchFailure.issues.some(issue => issue.code === 'LAYOUT_QA_ENVIRONMENT_NOT_CONFIGURED'));

  console.log('html-video layout QA service tests passed');
})();
