function buildPlaybackClockSource() {
  return `(function () {
  function owned(clock) {
    return clock && clock.__hvOwner === 'musedock-playback-clock-v1'
      && ['subscribe','play','pause','timeSec','paused','setTime'].every(function (name) { return typeof clock[name] === 'function'; });
  }
  if (owned(window.__hvPlaybackClock)) return;
  var subscribers = [];
  var elapsed = 0;
  var origin = null;
  var frame = 0;
  var running = false;
  function notify() {
    subscribers.slice().forEach(function (render) {
      try { render(elapsed); } catch (_) {}
    });
  }
  function tick(now) {
    if (!running) return;
    if (origin === null) origin = now - elapsed * 1000;
    elapsed = Math.max(0, (now - origin) / 1000);
    notify();
    frame = requestAnimationFrame(tick);
  }
  var clock = {
    __hvOwner: 'musedock-playback-clock-v1',
    subscribe: function (render) {
      if (typeof render !== 'function') return function () {};
      subscribers.push(render);
      render(elapsed);
      return function () {
        var index = subscribers.indexOf(render);
        if (index >= 0) subscribers.splice(index, 1);
      };
    },
    play: function () {
      if (running) return;
      running = true;
      origin = null;
      frame = requestAnimationFrame(tick);
    },
    pause: function () {
      if (!running) return;
      if (origin !== null) elapsed = Math.max(0, (performance.now() - origin) / 1000);
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      notify();
    },
    timeSec: function () {
      return running && origin !== null ? Math.max(0, (performance.now() - origin) / 1000) : elapsed;
    },
    paused: function () { return !running; },
    setTime: function (value) {
      var next = Number(value);
      if (!Number.isFinite(next) || next < 0) return;
      elapsed = next;
      if (running) origin = null;
      notify();
    }
  };
  try { window.__hvPlaybackClock = clock; } catch (_) {}
  if (window.__hvPlaybackClock !== clock) throw new Error('html-video 共享播放时钟被不可信全局占用。');
  if (!window.__mpAdapterControlled) setTimeout(function () { clock.play(); }, 250);
})();`;
}

function buildPlaybackClockScript() {
  return `<script data-hv-playback-clock="true">${buildPlaybackClockSource()}<\/script>`;
}

module.exports = { buildPlaybackClockSource, buildPlaybackClockScript };
