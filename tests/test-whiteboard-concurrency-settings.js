const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const appSettings = require('../server/services/appSettings');
const { ensureWhiteboardConcurrency } = require('../server/services/creative/whiteboard/concurrency');
const { imagePool } = require('../server/services/creative/whiteboard/imagePool');
const { annotationPool } = require('../server/services/creative/whiteboard/annotationPool');
const { sceneRenderPool } = require('../server/services/creative/whiteboard/sceneRenderPool');

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function deadline(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('设置并发验证超时')), 10000); })]); }
  finally { clearTimeout(timer); }
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-whiteboard-settings-'));
  const options = { configPath: path.join(root, 'settings.json'), aiConfigPath: path.join(root, 'models.json'), env: {} };
  const originalRead = appSettings.getPublicConfig;
  const originalSave = appSettings.saveConfig;
  let server;
  const release = Array.from({ length: 7 }, deferred);
  try {
    assert.deepEqual(await appSettings.getWhiteboardSettings(options), {
      imageConcurrency: 3, annotationConcurrency: 10, renderConcurrency: 3,
    });
    for (const [input, expected] of [[0, 1], [100, 10], [2.6, 3], ['5', 5], ['', 3], [null, 3], ['invalid', 3]]) {
      assert.equal(appSettings.normalizeWhiteboardSettings({ imageConcurrency: input }).imageConcurrency, expected);
    }
    const initialRead = deferred();
    const loading = ensureWhiteboardConcurrency(() => initialRead.promise);
    const initial = await appSettings.saveConfig({
      creativeDefaults: { aspectRatio: '16:9', frameHtmlConcurrency: 2, maxAiGeneratedImages: 9 },
      system: { skipValidation: true, pexelsApiKey: 'fixture-only' },
      whiteboard: { imageConcurrency: 2, annotationConcurrency: 4, renderConcurrency: 3 },
    }, options);
    initialRead.resolve({ imageConcurrency: 10, annotationConcurrency: 10, renderConcurrency: 10 });
    await loading;
    assert.equal(imagePool.concurrency, 2, '迟到的启动读取不能覆盖刚保存的配置');
    assert.equal(annotationPool.concurrency, 4);
    assert.equal(sceneRenderPool.concurrency, 3);

    appSettings.getPublicConfig = () => originalRead(options);
    appSettings.saveConfig = payload => originalSave(payload, options);
    const router = require('../server/routes/config');
    const app = express(); app.use(express.json()); app.use('/api/config', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/config/app-settings`;
    const save = async whiteboard => {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whiteboard }) });
      assert.equal(response.status, 200);
      return (await response.json()).data;
    };
    const starts = Array.from({ length: 7 }, deferred);
    let started = 0;
    const processing = imagePool.mapSettled(Array.from({ length: 7 }, (_, index) => index), async index => {
      started += 1; starts[index].resolve(); await release[index].promise;
    });
    await deadline(starts[1].promise);
    assert.equal(started, 2);
    assert.equal(imagePool.active, 2);
    let saved = await save({ imageConcurrency: 4 });
    await deadline(starts[3].promise);
    assert.equal(started, 4);
    assert.equal(imagePool.active, 4, '调高设置应立即启用已有队列的新空位');
    assert.deepEqual(saved.creativeDefaults, initial.creativeDefaults, '保存白板设置不能重置 HyperFrames 配置');
    assert.deepEqual(saved.system, initial.system, '保存白板设置不能重置系统配置');
    assert.equal(saved.whiteboard.annotationConcurrency, 4);
    assert.equal(annotationPool.concurrency, 4);
    assert.equal(sceneRenderPool.concurrency, 3);

    await save({ imageConcurrency: 1 });
    assert.equal(imagePool.active, 4, '降低并发不能中断已经发出的工作');
    for (let index = 0; index < 3; index += 1) release[index].resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started, 4, '执行数未降到新上限以下时不能启动下一项');
    assert.equal(imagePool.active, 1);
    release[3].resolve();
    await deadline(starts[4].promise);
    assert.equal(imagePool.active, 1);
    saved = await save({ imageConcurrency: 10 });
    await deadline(starts[6].promise);
    release.forEach(gate => gate.resolve());
    assert.ok((await deadline(processing)).every(result => result.status === 'fulfilled'));
    assert.equal(imagePool.active, 0); assert.equal(imagePool.queued, 0);
    assert.equal(imagePool.concurrency, 10);
    console.log('PASS 真实设置 API 驱动队列：即时升并发、降低后等在途工作完成、三个阶段独立生效');

    await Promise.all([save({ imageConcurrency: 6 }), save({ annotationConcurrency: 7 })]);
    const response = await fetch(url);
    const refreshed = (await response.json()).data;
    assert.deepEqual(refreshed.whiteboard, { imageConcurrency: 6, annotationConcurrency: 7, renderConcurrency: 3 });
    assert.deepEqual(JSON.parse(await fs.readFile(options.configPath, 'utf8')), refreshed);
    const legacyClientSave = await originalSave({ creativeDefaults: { ...initial.creativeDefaults, frameHtmlConcurrency: 5 } }, options);
    assert.deepEqual(legacyClientSave.whiteboard, refreshed.whiteboard, '旧客户端保存 HF 设置时必须保留白板字段');
    assert.deepEqual(legacyClientSave.system, initial.system);
    assert.equal((await save({ renderConcurrency: 99 })).whiteboard.renderConcurrency, 10);
    assert.equal(sceneRenderPool.concurrency, 10);
    console.log('PASS 保存刷新持久化、并发局部更新不丢字段、旧客户端兼容与上限校验');

    const legacyOptions = { ...options, configPath: path.join(root, 'legacy.json'), env: {
      MUSEDOCK_WHITEBOARD_IMAGE_CONCURRENCY: '2', MUSEDOCK_WHITEBOARD_ANNOTATION_CONCURRENCY: '5', MUSEDOCK_WHITEBOARD_RENDER_CONCURRENCY: '4',
    } };
    await fs.writeFile(legacyOptions.configPath, JSON.stringify({ creativeDefaults: { aspectRatio: '1:1' } }), { flag: 'wx' });
    assert.deepEqual((await originalRead(legacyOptions)).whiteboard, { imageConcurrency: 2, annotationConcurrency: 5, renderConcurrency: 4 });
    await originalSave({ whiteboard: { imageConcurrency: 8 } }, legacyOptions);
    const afterEnvironmentChange = await originalRead({ ...legacyOptions, env: { MUSEDOCK_WHITEBOARD_ANNOTATION_CONCURRENCY: '1' } });
    assert.deepEqual(afterEnvironmentChange.whiteboard, { imageConcurrency: 8, annotationConcurrency: 5, renderConcurrency: 4 });
    assert.equal(afterEnvironmentChange.creativeDefaults.aspectRatio, '1:1');
    assert.ok((await fs.readdir(root)).every(name => !name.endsWith('.tmp')));
    console.log('PASS 旧环境变量可读取，界面保存后持久配置优先；全程无真实模型调用');
  } finally {
    release.forEach(gate => gate.resolve());
    if (server) await new Promise(resolve => server.close(resolve));
    appSettings.getPublicConfig = originalRead;
    appSettings.saveConfig = originalSave;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('musedock-whiteboard-settings-'));
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
