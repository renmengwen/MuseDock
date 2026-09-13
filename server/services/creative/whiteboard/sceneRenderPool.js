const { WhiteboardError } = require('./contracts');

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 8;

function normalizeConcurrency(value, defaultConcurrency = DEFAULT_CONCURRENCY, maxConcurrency = MAX_CONCURRENCY) {
  const number = Number(value);
  return value == null || value === '' || !Number.isInteger(number)
    ? defaultConcurrency : Math.max(1, Math.min(maxConcurrency, number));
}

function createSceneRenderPool(value, { defaultConcurrency = DEFAULT_CONCURRENCY,
  maxConcurrency = MAX_CONCURRENCY, cancelMessage = '单幕渲染已取消。' } = {}) {
  const concurrency = normalizeConcurrency(value, defaultConcurrency, maxConcurrency);
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
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
  }

  return Object.freeze({ concurrency, run, mapSettled, get active() { return active; }, get queued() { return queue.length; } });
}

// One pool per service process; starting another workflow does not multiply the render limit.
const sceneRenderPool = createSceneRenderPool(process.env.MUSEDOCK_WHITEBOARD_RENDER_CONCURRENCY);

module.exports = { DEFAULT_CONCURRENCY, MAX_CONCURRENCY, normalizeConcurrency, createSceneRenderPool, sceneRenderPool };
