const { WhiteboardError } = require('./contracts');
const { renderConcurrency } = require('../../../resources/whiteboard/concurrency-settings.json');

const DEFAULT_CONCURRENCY = renderConcurrency.default;
const MAX_CONCURRENCY = renderConcurrency.max;

function normalizeConcurrency(value, defaultConcurrency = DEFAULT_CONCURRENCY, maxConcurrency = MAX_CONCURRENCY) {
  const number = Number(value);
  return value == null || value === '' || !Number.isInteger(number)
    ? defaultConcurrency : Math.max(1, Math.min(maxConcurrency, number));
}

function createSceneRenderPool(value, { defaultConcurrency = DEFAULT_CONCURRENCY,
  maxConcurrency = MAX_CONCURRENCY, cancelMessage = '单幕渲染已取消。' } = {}) {
  let concurrency = normalizeConcurrency(value, defaultConcurrency, maxConcurrency);
  const cancelled = () => new WhiteboardError('MEDIA_CANCELLED', cancelMessage);
  const queue = [];
  let active = 0;

  function drain() {
    while (active < concurrency && queue.length) {
      const entry = queue.shift();
      entry.signal?.removeEventListener('abort', entry.abort);
      if (entry.signal?.aborted) { entry.reject(cancelled()); continue; }
      active += 1;
      const finish = (callback, result) => {
        active -= 1;
        drain();
        callback(result);
      };
      Promise.resolve().then(() => {
        if (entry.signal?.aborted) throw cancelled();
        return entry.job();
      }).then(result => finish(entry.resolve, result), error => finish(entry.reject, error));
    }
  }

  function run(job, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(cancelled());
    return new Promise((resolve, reject) => {
      const entry = { job, signal, resolve, reject };
      entry.abort = () => {
        const index = queue.indexOf(entry);
        if (index < 0) return;
        queue.splice(index, 1);
        signal.removeEventListener('abort', entry.abort);
        reject(cancelled());
      };
      signal?.addEventListener('abort', entry.abort, { once: true });
      queue.push(entry);
      drain();
    });
  }

  function setConcurrency(value) {
    concurrency = normalizeConcurrency(value, defaultConcurrency, maxConcurrency);
    // 降低上限不会中断已启动的工作；排队项等到有空位才启动。
    drain();
    return concurrency;
  }

  async function mapSettled(items, job, options = {}) {
    const results = new Array(items.length);
    let next = 0;
    // Submit only one job per local worker, so different workflows share the FIFO fairly.
    async function worker() {
      while (next < items.length) {
        const index = next++;
        try { results[index] = { status: 'fulfilled', value: await run(() => job(items[index], index), options) }; }
        catch (reason) { results[index] = { status: 'rejected', reason }; }
      }
    }
    // 只预排一个有界窗口；设置调高后，已有阶段也能立即补足新的空位。
    await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length) }, worker));
    return results;
  }

  return Object.freeze({ get concurrency() { return concurrency; }, setConcurrency, run, mapSettled,
    get active() { return active; }, get queued() { return queue.length; } });
}

// One pool per service process; starting another workflow does not multiply the render limit.
const sceneRenderPool = createSceneRenderPool(process.env.MUSEDOCK_WHITEBOARD_RENDER_CONCURRENCY);

module.exports = { DEFAULT_CONCURRENCY, MAX_CONCURRENCY, normalizeConcurrency, createSceneRenderPool, sceneRenderPool };
