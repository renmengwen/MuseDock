const assert = require('assert');
const vm = require('vm');
const { buildSceneTimelineScript } = require('../server/services/creative-video/html-video/frameHtmlPhaseSupport');
const { renderCaptionLayer } = require('../server/services/creative-video/html-video/captionLayer');
const { buildShotTimelineSource } = require('../server/services/creative-video/html-video/sceneImageSequenceDom');
const { buildPlaybackClockSource } = require('../server/services/creative-video/html-video/playbackClock');

function datasetElement(dataset = {}) {
  return {
    dataset: { ...dataset },
    setAttribute(name, value) {
      if (name === 'data-mp-beat') this.dataset.mpBeat = String(value);
    },
    removeAttribute(name) {
      const key = name.replace(/^data-/, '').replace(/-([a-z])/g, (_m, char) => char.toUpperCase());
      delete this.dataset[key];
    },
  };
}

const body = datasetElement();
const captions = [datasetElement({ start: '0', end: '2' }), datasetElement({ start: '2', end: '4' })];
const shots = [
  datasetElement({ windowStartSec: '0', windowEndSec: '2.2' }),
  datasetElement({ windowStartSec: '1.8', windowEndSec: '4' }),
];
const raf = [];
const cancelled = new Set();
let now = 0;
let rafId = 0;
const context = {
  window: {},
  document: {
    body,
    querySelectorAll(selector) {
      if (selector === '.hv-caption-item') return captions;
      if (selector === '[data-hv-shot]') return shots;
      return [];
    },
  },
  performance: { now: () => now },
  requestAnimationFrame(fn) { const id = ++rafId; raf.push({ id, fn }); return id; },
  cancelAnimationFrame(id) { cancelled.add(id); },
  setTimeout() { return 1; },
  clearTimeout() {},
};
context.window = context;
context.globalThis = context;
context.__hvPlaybackClock = {};

const sceneScript = buildSceneTimelineScript([
  { id: 'beat_1', start_sec: 0, end_sec: 2 },
  { id: 'beat_2', start_sec: 2, end_sec: 4 },
]);
const captionScript = renderCaptionLayer([
  { id: 'c1', start: 0, end: 2, text: '一' },
  { id: 'c2', start: 2, end: 4, text: '二' },
]).match(/<script data-hv-caption-clock="true">([\s\S]*?)<\/script>/)[1];
vm.runInNewContext(sceneScript.slice('<script>'.length, sceneScript.lastIndexOf('<\/script>')), context);
vm.runInNewContext(buildShotTimelineSource(), context);
vm.runInNewContext(captionScript, { ...context, document: { ...context.document, currentScript: { previousElementSibling: { querySelectorAll: () => captions } } } });

const clock = context.window.__hvPlaybackClock;
assert.ok(clock);
assert.equal(clock.timeSec(), 0);
assert.equal(clock.paused(), true);
assert.equal(body.dataset.mpBeat, 'beat_1');
assert.equal(captions[0].dataset.hvActive, 'true');
assert.equal(shots[0].dataset.shotActive, 'true');

now = 6000;
assert.equal(clock.timeSec(), 0, '预加载等待不能推进共享时钟');
assert.equal(raf.length, 0, '初始 paused 不得建立 rAF');

clock.play();
clock.play();
assert.equal(raf.length, 1, '重复 play 不得叠加 rAF');
raf.shift().fn(6000);
now = 7900;
const first = raf.shift();
first.fn(now);
assert.equal(Math.round(clock.timeSec() * 10) / 10, 1.9);
assert.equal(body.dataset.mpBeat, 'beat_1');
assert.equal(captions[0].dataset.hvActive, 'true');
assert.equal(shots[0].dataset.shotActive, 'true');
assert.equal(shots[1].dataset.shotActive, 'true', 'overlap 时两个 Shot 必须同时 active');

clock.pause();
const pausedAt = clock.timeSec();
now += 500;
assert.equal(clock.timeSec(), pausedAt, 'pause 期间时间不变');
clock.pause();
clock.play();
now += 200;
raf.splice(raf.findIndex(item => !cancelled.has(item.id)), 1)[0].fn(now);
now += 200;
raf.splice(raf.findIndex(item => !cancelled.has(item.id)), 1)[0].fn(now);
assert.ok(clock.timeSec() > pausedAt, 'resume 必须延续而不是重置');

context.window.__mpSetTimelineTime(3.2);
assert.equal(body.dataset.mpBeat, 'beat_2');
assert.equal(captions[1].dataset.hvActive, 'true');
assert.equal(shots[0].dataset.shotActive, undefined);
assert.equal(shots[1].dataset.shotActive, 'true');
context.window.__mpSetTimelineTime(8);
assert.equal(shots[1].dataset.shotActive, 'true', 'Scene 尾部必须保持最后 Shot');

{
  const queued = [];
  let schedulerNow = 0;
  const schedulerContext = {
    window: {},
    performance: { now: () => schedulerNow },
    requestAnimationFrame(callback) { queued.push(callback); return queued.length; },
    cancelAnimationFrame() {},
    setTimeout() {},
    clearTimeout() {},
  };
  schedulerContext.window = schedulerContext;
  vm.runInNewContext(buildPlaybackClockSource(), schedulerContext);
  const schedulerClock = schedulerContext.__hvPlaybackClock;
  schedulerContext.requestAnimationFrame = () => { throw new Error('hostile-raf'); };
  schedulerContext.cancelAnimationFrame = () => { throw new Error('hostile-cancel'); };
  schedulerContext.performance.now = () => { throw new Error('hostile-now'); };
  assert.doesNotThrow(() => schedulerClock.play(), 'Clock 必须使用安装时捕获的 scheduler');
  schedulerNow = 16;
  assert.doesNotThrow(() => queued.shift()(schedulerNow), 'tick 不得重新读取被模型覆写的 scheduler');
  schedulerNow = 32;
  assert.doesNotThrow(() => queued.shift()(schedulerNow));
  assert.ok(schedulerClock.timeSec() > 0, '捕获的原生 scheduler 必须实际推进时间');
  assert.doesNotThrow(() => schedulerClock.pause());
}

console.log('html-video playback clock tests passed');
