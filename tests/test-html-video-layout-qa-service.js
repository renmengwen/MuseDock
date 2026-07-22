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
  assert.equal(decorativeOverlap.success, true, '显式忽略的装饰大数字不应触发布局修复');
  assert.equal(decorativeOverlap.issues.some(issue => /overlap/.test(issue.code)), false);

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

  const decoratedInline = await inspectFixture('decorated-inline-text.html', { id: 'scene_05', duration_sec: 1 });
  assert.equal(
    decoratedInline.issues.some(issue => issue.code === 'text_out_of_container'),
    false,
    '父标题内联文字的 padding/background 装饰盒不得冒充文本内容盒越界',
  );

  const scaledInline = await inspectFixture('scaled-decorated-inline-text.html', { id: 'scene_scaled_text', duration_sec: 1 });
  assert.ok(
    scaledInline.issues.some(issue => issue.code === 'text_out_of_container'),
    '缩放后的装饰文字必须回退元素盒并保守阻断越界',
  );

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

    const crossfadingBeats = await inspectFrameHtmlLayout({
      htmlPath: timelinePath,
      frame: { id: 'scene_crossfading_beats', duration_sec: 1.5 },
      resolution,
      sampleTimesSec: [0.6],
    });
    const crossfadeOverlap = crossfadingBeats.issues.find(issue => (
      new Set([issue.details?.first?.beat_scope, issue.details?.second?.beat_scope]).has('beat_1')
      && new Set([issue.details?.first?.beat_scope, issue.details?.second?.beat_scope]).has('beat_2')
    ));
    assert.equal(crossfadingBeats.success, true, 'Beat 边界后 0.1 秒的合法 opacity transition 不应阻断');
    assert.equal(crossfadeOverlap?.severity, 'warning', '合法 Crossfade 重叠应保留为 warning');
    assert.ok(
      [crossfadeOverlap.details.first.scope_effective_opacity, crossfadeOverlap.details.second.scope_effective_opacity]
        .some(opacity => opacity > 0.001 && opacity < 0.999),
      'Crossfade warning 必须由 Beat Scope 及其外层祖先的累计部分透明度支持',
    );
    assert.ok(
      [crossfadeOverlap.details.first.opacity_transition_running, crossfadeOverlap.details.second.opacity_transition_running]
        .some(Boolean),
      'Crossfade warning 必须存在 Scope 本体正在运行的原生 opacity CSSTransition',
    );

    const falseCrossfadePath = path.join(timelineDir, 'false-crossfade.html');
    await fs.writeFile(falseCrossfadePath, `<!doctype html><html><head><style>
      html,body{width:1920px;height:1080px;margin:0}.scope{position:absolute;width:300px}
      .inner-a,.inner-b{top:100px}.inner-a p{opacity:.8}
      .permanent-a,.permanent-b{top:300px}.permanent-b{opacity:.5}
      .half-a,.half-b{top:500px;opacity:.5}
      .mixed-a,.mixed-b{top:700px}.mixed-a{opacity:.5}.mixed-b{opacity:1;transition:opacity .35s linear 1s}
      body.ready .mixed-b{opacity:.8}
    </style></head><body>
      <div class="scope inner-a" data-mp-beat-scope="inner_a"><p>内部透明 A</p></div>
      <div class="scope inner-b" data-mp-beat-scope="inner_b"><p>内部透明 B</p></div>
      <div class="scope permanent-a" data-mp-beat-scope="permanent_a"><p>永久全显</p></div>
      <div class="scope permanent-b" data-mp-beat-scope="permanent_b"><p>永久半透明</p></div>
      <div class="scope half-a" data-mp-beat-scope="half_a"><p>半透明 A</p></div>
      <div class="scope half-b" data-mp-beat-scope="half_b"><p>半透明 B</p></div>
      <div class="scope mixed-a" data-mp-beat-scope="mixed_a"><p>永久半透明 A</p></div>
      <div class="scope mixed-b" data-mp-beat-scope="mixed_b"><p>延迟过渡全显 B</p></div>
      <script>requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.className='ready'))</script>
    </body></html>`, 'utf8');
    const falseCrossfades = await inspectFrameHtmlLayout({
      htmlPath: falseCrossfadePath,
      frame: { id: 'scene_false_crossfades', duration_sec: 1 },
      resolution,
      sampleTimesSec: [0.1],
    });
    for (const [firstText, secondText] of [
      ['内部透明 A', '内部透明 B'],
      ['永久全显', '永久半透明'],
      ['半透明 A', '半透明 B'],
    ]) {
      const overlap = falseCrossfades.issues.find(issue => (
        [issue.details?.first?.text, issue.details?.second?.text].includes(firstText)
        && [issue.details?.first?.text, issue.details?.second?.text].includes(secondText)
      ));
      assert.equal(overlap?.severity, 'error', `${firstText}/${secondText} 没有运行中的 Scope opacity transition，必须阻断`);
      assert.equal(overlap.details.first.opacity_transition_running, false);
      assert.equal(overlap.details.second.opacity_transition_running, false);
    }
    const innerOpacityOverlap = falseCrossfades.issues.find(issue => issue.details?.first?.text === '内部透明 A');
    assert.deepEqual(
      [innerOpacityOverlap.details.first.scope_effective_opacity, innerOpacityOverlap.details.second.scope_effective_opacity],
      [1, 1],
      '内部文字 opacity:.8 不得伪装成 Beat Scope 交叉淡化',
    );
    const mixedEvidenceOverlap = falseCrossfades.issues.find(issue => (
      [issue.details?.first?.text, issue.details?.second?.text].includes('永久半透明 A')
      && [issue.details?.first?.text, issue.details?.second?.text].includes('延迟过渡全显 B')
    ));
    assert.equal(mixedEvidenceOverlap?.severity, 'error', '部分透明与运行 Transition 来自不同 Scope 时不得拼接证据放行');
    assert.deepEqual(
      [mixedEvidenceOverlap.details.first.scope_effective_opacity, mixedEvidenceOverlap.details.second.scope_effective_opacity],
      [0.5, 1],
    );
    assert.deepEqual(
      [mixedEvidenceOverlap.details.first.opacity_transition_running, mixedEvidenceOverlap.details.second.opacity_transition_running],
      [false, true],
    );

    const partialBeatBasePath = path.join(timelineDir, 'partial-beat-base.html');
    await fs.writeFile(partialBeatBasePath, `<!doctype html><html><head><style>
      html,body{width:1920px;height:1080px;margin:0}.same{position:absolute;left:100px;top:100px;width:300px}
      [data-mp-beat-scope]{opacity:.5}
    </style></head><body>
      <p class="same">稳定 Base 文本</p>
      <div class="same" data-mp-beat-scope="beat_partial"><p>部分透明 Beat 文本</p></div>
    </body></html>`, 'utf8');
    const partialBeatBase = await inspectFrameHtmlLayout({
      htmlPath: partialBeatBasePath,
      frame: { id: 'scene_partial_beat_base', duration_sec: 1 },
      resolution,
      sampleTimesSec: [0.1],
    });
    const partialBeatBaseOverlap = partialBeatBase.issues.find(issue => (
      [issue.details?.first?.text, issue.details?.second?.text].includes('稳定 Base 文本')
      && [issue.details?.first?.text, issue.details?.second?.text].includes('部分透明 Beat 文本')
    ));
    assert.equal(partialBeatBaseOverlap?.severity, 'error', '部分透明 Beat 压住 Base 仍必须阻断');

    const constantClockPath = path.join(timelineDir, 'constant-clock.html');
    await fs.writeFile(constantClockPath, `<!doctype html><html><body><p data-text-key="body">恒定非零时钟</p><script>
      window.__hvPlaybackClock={
        __hvOwner:'musedock-playback-clock-v1',subscribe:function(){},play:function(){},pause:function(){},
        timeSec:function(){return .4},paused:function(){return false},setTime:function(){}
      };
      </script></body></html>`, 'utf8');
    const constantClock = await inspectFrameHtmlLayout({
      htmlPath: constantClockPath,
      frame: { id: 'scene_constant_clock', duration_sec: 1 },
      resolution,
      sampleTimesSec: [0.5],
    });
    assert.equal(constantClock.metrics.skipped, false);
    assert.equal(constantClock.success, false);
    assert.ok(constantClock.issues.some(issue => issue.code === 'LAYOUT_QA_PLAYBACK_CLOCK_UNRESPONSIVE'));

    const nanClockPath = path.join(timelineDir, 'nan-clock.html');
    await fs.writeFile(nanClockPath, `<!doctype html><html><body><p data-text-key="body">NaN 时钟</p><script>
      window.__hvPlaybackClock={
        __hvOwner:'musedock-playback-clock-v1',subscribe:function(){},play:function(){},pause:function(){},
        timeSec:function(){return NaN},paused:function(){return false},setTime:function(){}
      };
      </script></body></html>`, 'utf8');
    const nanStartedAt = Date.now();
    const nanClock = await inspectFrameHtmlLayout({
      htmlPath: nanClockPath,
      frame: { id: 'scene_nan_clock', duration_sec: 10 },
      resolution,
      sampleTimesSec: [9],
    });
    assert.ok(Date.now() - nanStartedAt < 5000, 'NaN 时钟必须在归零检查快速失败');
    assert.equal(nanClock.success, false);
    assert.equal(nanClock.metrics.skipped, false);
    assert.deepEqual(nanClock.metrics.samples, []);
    assert.ok(nanClock.issues.some(issue => issue.code === 'LAYOUT_QA_PLAYBACK_CLOCK_UNRESPONSIVE'));

    const infinityAfterPlayPath = path.join(timelineDir, 'infinity-after-play.html');
    await fs.writeFile(infinityAfterPlayPath, `<!doctype html><html><body><p data-text-key="body">播放后无穷时钟</p><script>
      (function(){var time=0,playing=false;window.__hvPlaybackClock={
        __hvOwner:'musedock-playback-clock-v1',subscribe:function(){},play:function(){playing=true},pause:function(){playing=false},
        timeSec:function(){return playing?Infinity:time},paused:function(){return !playing},setTime:function(value){time=Number(value)}
      };})();
      </script></body></html>`, 'utf8');
    const infinityAfterPlay = await inspectFrameHtmlLayout({
      htmlPath: infinityAfterPlayPath,
      frame: { id: 'scene_infinity_after_play', duration_sec: 10 },
      resolution,
      sampleTimesSec: [9],
    });
    assert.equal(infinityAfterPlay.success, false);
    assert.equal(infinityAfterPlay.metrics.skipped, false);
    assert.deepEqual(infinityAfterPlay.metrics.samples, []);
    assert.ok(infinityAfterPlay.issues.some(issue => issue.code === 'LAYOUT_QA_PLAYBACK_CLOCK_UNRESPONSIVE'));

    const finiteJumpPath = path.join(timelineDir, 'finite-jump.html');
    await fs.writeFile(finiteJumpPath, `<!doctype html><html><body><p data-text-key="body">有限大跳时钟</p><script>
      (function(){var time=0,playing=false;window.__hvPlaybackClock={
        __hvOwner:'musedock-playback-clock-v1',subscribe:function(){},play:function(){playing=true},pause:function(){playing=false},
        timeSec:function(){return playing?100:time},paused:function(){return !playing},setTime:function(value){time=Number(value)}
      };})();
      </script></body></html>`, 'utf8');
    const finiteJump = await inspectFrameHtmlLayout({
      htmlPath: finiteJumpPath,
      frame: { id: 'scene_finite_jump', duration_sec: 1 },
      resolution,
      sampleTimesSec: [0.5],
    });
    assert.equal(finiteJump.success, false);
    assert.equal(finiteJump.metrics.skipped, false);
    assert.deepEqual(finiteJump.metrics.samples, []);
    assert.ok(finiteJump.issues.some(issue => issue.code === 'LAYOUT_QA_PLAYBACK_CLOCK_UNRESPONSIVE'));

    const stalledClockPath = path.join(timelineDir, 'stalled-clock.html');
    await fs.writeFile(stalledClockPath, `<!doctype html><html><body>
      <p data-text-key="body">停滞时钟</p><script>
      window.__hvPlaybackClock={
        __hvOwner:'musedock-playback-clock-v1',subscribe:function(){},play:function(){},pause:function(){},
        timeSec:function(){return 0},paused:function(){return false},setTime:function(){}
      };
      </script></body></html>`, 'utf8');
    const stalledStartedAt = Date.now();
    const stalledClock = await inspectFrameHtmlLayout({
      htmlPath: stalledClockPath,
      frame: { id: 'scene_stalled_clock', duration_sec: 1 },
      resolution,
      sampleTimesSec: [0.5],
    });
    assert.ok(Date.now() - stalledStartedAt < 5000, '停滞时钟必须快速失败，不能等待默认 30 秒超时');
    assert.equal(stalledClock.metrics.skipped, false);
    assert.equal(stalledClock.success, false);
    assert.ok(stalledClock.issues.some(issue => issue.code === 'LAYOUT_QA_PLAYBACK_CLOCK_UNRESPONSIVE'));

    const midStallClockPath = path.join(timelineDir, 'mid-stall-clock.html');
    await fs.writeFile(midStallClockPath, `<!doctype html><html><head><style>
      html,body{width:1920px;height:1080px;margin:0}.overlap{position:absolute;left:100px;top:100px;width:300px}
      </style></head><body><p class="overlap">首样本重叠一</p><p class="overlap">首样本重叠二</p><script>
      (function(){var time=0,origin=0,running=false,stalled=false;window.__hvPlaybackClock={
        __hvOwner:'musedock-playback-clock-v1',subscribe:function(){},
        play:function(){if(!running){running=true;origin=performance.now()-time*1000}},
        pause:function(){this.timeSec();running=false},paused:function(){return !running},
        timeSec:function(){if(running&&!stalled){time=Math.min(.08,(performance.now()-origin)/1000);if(time>=.08)stalled=true}return time},
        setTime:function(value){if(stalled)return;time=Number(value);origin=performance.now()-time*1000}
      };})();
      </script></body></html>`, 'utf8');
    const midStallStartedAt = Date.now();
    const midStallClock = await inspectFrameHtmlLayout({
      htmlPath: midStallClockPath,
      frame: { id: 'scene_mid_stall_clock', duration_sec: 1 },
      resolution,
      sampleTimesSec: [0.05, 0.2],
    });
    assert.ok(Date.now() - midStallStartedAt < 5000, '中途停滞必须按当前采样剩余时间快速失败');
    assert.equal(midStallClock.metrics.skipped, false);
    assert.equal(midStallClock.success, false);
    assert.deepEqual(midStallClock.metrics.samples.map(sample => sample.sample_time_sec), [0.05]);
    assert.ok(midStallClock.issues.some(issue => issue.code === 'text_overlap'), '时钟中途失败不得丢弃首样本真实重叠');
    assert.ok(midStallClock.issues.some(issue => (
      issue.code === 'LAYOUT_QA_PLAYBACK_CLOCK_UNRESPONSIVE' && issue.sample_time_sec === 0.2
    )));

    const nanDuringSeekPath = path.join(timelineDir, 'nan-during-seek.html');
    await fs.writeFile(nanDuringSeekPath, `<!doctype html><html><body><p data-text-key="body">Seek 中途 NaN</p><script>
      (function(){var time=0,seeks=0;window.__hvPlaybackClock={
        __hvOwner:'musedock-playback-clock-v1',subscribe:function(){},play:function(){},pause:function(){},
        timeSec:function(){return time},paused:function(){return true},setTime:function(value){
          if(Number(value)===0){time=0;return}seeks+=1;time=seeks===1?Number(value):NaN;
        }
      };})();
      </script></body></html>`, 'utf8');
    const nanDuringSeek = await inspectFrameHtmlLayout({
      htmlPath: nanDuringSeekPath,
      frame: { id: 'scene_nan_during_seek', duration_sec: 1 },
      resolution,
      sampleTimesSec: [0.1, 0.2],
    });
    assert.equal(nanDuringSeek.success, false);
    assert.equal(nanDuringSeek.metrics.skipped, false);
    assert.deepEqual(nanDuringSeek.metrics.samples.map(sample => sample.sample_time_sec), [0.1]);
    assert.ok(nanDuringSeek.issues.some(issue => (
      issue.code === 'LAYOUT_QA_PLAYBACK_CLOCK_UNRESPONSIVE' && issue.sample_time_sec === 0.2
    )));

    const seekableClockPath = path.join(timelineDir, 'seekable-clock.html');
    await fs.writeFile(seekableClockPath, `<!doctype html><html><head><style>
      html,body{width:1920px;height:1080px;margin:0;overflow:hidden}
      body[data-seek="target"] p{position:absolute;left:2000px;top:100px}
    </style></head><body><p data-text-key="body">Seek 到目标时间</p><script>
      (function(){var time=0;window.__hvPlaybackClock={
        __hvOwner:'musedock-playback-clock-v1',subscribe:function(){},play:function(){},pause:function(){},
        timeSec:function(){return time},paused:function(){return true},setTime:function(value){
          time=Number(value);document.body.dataset.seek=time>=1?'target':'start';
        }
      };})();
      </script></body></html>`, 'utf8');
    const seekableClock = await inspectFrameHtmlLayout({
      htmlPath: seekableClockPath,
      frame: { id: 'scene_seekable_clock', duration_sec: 1 },
      resolution,
      sampleTimesSec: [1],
    });
    assert.equal(seekableClock.metrics.skipped, false);
    assert.ok(
      seekableClock.issues.some(issue => issue.code === 'text_out_of_viewport' && issue.details?.text === 'Seek 到目标时间'),
      '不能连续推进但可 Seek 的时钟必须回退并采到目标时间',
    );
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
  assert.equal(
    inactiveBeat.issues.some(issue => issue.details?.text === '第二拍越界文本'),
    false,
    '普通非活动 Beat 仍应由真实 opacity 排除',
  );
  const leakedBeatOverlap = inactiveBeat.issues.find(issue => (
    new Set([issue.details?.first?.beat_scope, issue.details?.second?.beat_scope]).has('leak_a')
    && new Set([issue.details?.first?.beat_scope, issue.details?.second?.beat_scope]).has('leak_b')
  ));
  assert.equal(leakedBeatOverlap?.severity, 'error', '不同 Beat 同时泄漏重叠必须阻断');
  assert.deepEqual(
    [leakedBeatOverlap.details.first.scope_effective_opacity, leakedBeatOverlap.details.second.scope_effective_opacity],
    [1, 1],
    'animation-fill 泄漏在稳定 opacity=1 时仍必须阻断',
  );
  assert.equal(leakedBeatOverlap.details.first.opacity_transition_running, false);
  assert.equal(leakedBeatOverlap.details.second.opacity_transition_running, false);
  const beatBaseOverlap = inactiveBeat.issues.find(issue => (
    [issue.details?.first?.text, issue.details?.second?.text].includes('稳定 Base 文字')
    && [issue.details?.first?.text, issue.details?.second?.text].includes('压住 Base 的 Beat')
  ));
  assert.equal(beatBaseOverlap?.severity, 'error', 'Beat overlay 压住稳定 Base 文字必须阻断');
  assert.deepEqual(
    new Set([beatBaseOverlap.details.first.beat_scope, beatBaseOverlap.details.second.beat_scope]),
    new Set([null, 'leak_base']),
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
  assert.ok(
    decorativeOverflow.issues.some(issue => issue.details?.text === '视觉可见装饰'),
    'aria-hidden 不能让视觉可见文本跳过布局 QA',
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
