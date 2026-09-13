const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const workflows = require('../server/services/creative/creativeWorkflows');
const workflowStore = require('../server/services/creative/workflowStore');
const store = require('../server/services/creative/whiteboard/mediaStore');
const tools = require('../server/services/creative/whiteboard/mediaTools');
const production = require('../server/services/creative/whiteboard/productionWorkflows');
const { srtText } = require('../server/services/creative/whiteboard/narrationTiming');
const { WhiteboardError } = require('../server/services/creative/whiteboard/contracts');
const { createAnnotationPool, annotationPool } = require('../server/services/creative/whiteboard/annotationPool');
const { createSceneRenderPool } = require('../server/services/creative/whiteboard/sceneRenderPool');

// Media bytes are fixtures; all model and network dependencies are replaced.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF3sAAAAASUVORK5CYII=', 'base64');
const annotationCandidate = { schemaVersion: 2,
  visualGrouping: { mode: 'single_continuous', reason: '测试图只有一个连续主体，使用一个完整区域检查保存与恢复机制。' },
  elements: [{ label: '测试主体', region: { x: 0, y: 0, width: 300, height: 300 },
    direction: 'left-to-right', weight: 1, protectedRegions: [] }] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function deadline(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('并发测试等待超时')), 15000); })]); }
  finally { clearTimeout(timer); }
}

async function fixture(count = 3) {
  const parent = path.resolve(__dirname, '../.codex-runtime');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'whiteboard-annotation-test-'));
  const rootDir = path.join(root, 'workflows');
  const cues = Array.from({ length: count }, (_, index) => ({ id: `cue_${index + 1}`, text: `展示第${index + 1}个图形。`, startMs: index * 3000, endMs: (index + 1) * 3000 }));
  const candidate = { schemaVersion: 1, title: '落墨并发与人工接受测试', summary: '按顺序展示多个独立图形，检查落墨编排与失败恢复。',
    cues: cues.map(({ id, text }) => ({ id, text })),
    scenes: cues.map((cue, index) => ({ id: `scene_${index + 1}`, title: `图形 ${index + 1}`, cueIds: [cue.id], imagePrompt: '暖米黄纸张上的单个完整图形，清晰轮廓，充分留白。' })) };
  const faults = new Map();
  const calls = new Map();
  const events = [];
  const ctx = { root, rootDir, faults, calls, events, beforeVision: () => pause(15) };
  const config = { enabled: true, provider: 'fixture', apiKey: 'fixture-only', baseUrl: 'https://example.invalid',
    modelId: 'fixture-text', supportsMultimodal: true };
  const options = { rootDir, taskContext: { emit: async event => events.push(event) }, services: {
    aiModelConfig: { getRuntimeConfig: async type => type === 'tts' ? { enabled: false } : config },
    fetchImpl: async () => { throw new Error('测试禁止真实网络请求'); },
    aiImageModel: { generateImages: async () => ({ success: true, images: [{ b64_json: png.toString('base64') }] }) },
    aiTextModel: { callTextModel: async request => {
      if (typeof request.messages[1].content === 'string') return { success: true, text: JSON.stringify(candidate) };
      const prompt = request.messages[1].content[0].text;
      const sceneId = JSON.parse(prompt.split('本幕与真实字幕时间：')[1].split('\n')[0]).scene.id;
      calls.set(sceneId, (calls.get(sceneId) || 0) + 1);
      await ctx.beforeVision(sceneId);
      if (faults.get(sceneId) === 'unknown') throw new Error('fixture connection lost');
      return { success: true, text: JSON.stringify(annotationCandidate) };
    } },
    whiteboardMediaTools: { ...tools,
      preflight: async () => ({ font: 'fixture-font', recipe: { width: 1920, height: 1080, fixture: true } }),
      python: async (command, input) => {
        assert.ok(['normalize-image', 'annotation-preview'].includes(command));
        if (command === 'normalize-image') { await fs.writeFile(input.output, png, { flag: 'wx' }); return { width: 1920, height: 1080 }; }
        const mode = faults.get(input.annotation.sceneId);
        if (mode === 'local_failure') throw new WhiteboardError('MEDIA_FAILED', '测试注入：预览生成失败。');
        await fs.writeFile(input.output, png, { flag: 'wx' });
        if (mode !== 'missing_preview') await fs.writeFile(input.resultOutput, png, { flag: 'wx' });
        if (['low', 'missing_preview'].includes(mode)) {
          const error = new WhiteboardError('ANNOTATION_COVERAGE_LOW', '测试注入：标注覆盖不足。');
          error.coverageRatio = 0.65;
          error.coverage = { coverageRatio: 0.65, regions: 1, coveredInkPixels: 65, totalInkPixels: 100 };
          throw error;
        }
        return { coverageRatio: 1, regions: 1, coveredInkPixels: 100, totalInkPixels: 100 };
      },
      renderScene: async () => { throw new Error('此测试不能越过人工 Gate 渲染视频'); },
    },
  } };
  const created = await workflows.createCreativeWorkflow({ creationModeId: 'whiteboard-stream-v1',
    input: { inputMode: 'srt', content: srtText(cues) }, productionPlan: { narrationMode: 'disabled', handDisplayMode: 'hide', agentApprovalEnabled: false } }, options);
  assert.equal(created.success, true, created.message);
  const id = created.workflow_id;
  const read = () => workflowStore.readWorkflow(id, rootDir);
  const payload = (record, action, extra = {}) => ({ action, requestId: crypto.randomUUID(),
    expectedAttemptId: record.whiteboard.attempts.at(-1).id, expectedIdentity: record.whiteboard.current?.identity || '',
    expectedMediaIdentity: record.whiteboard.media && store.mediaIdentity(record.whiteboard.media),
    interactionId: record.whiteboard.media?.interactionId || record.whiteboard.interactions?.findLast(item => item.status === 'pending')?.id,
    ...extra });
  const action = async (name, extra) => workflows.actOnWhiteboardWorkflow(id, payload(await read(), name, extra), options);
  const run = () => workflows.runCreativeWorkflow(id, options);
  assert.equal((await run()).status, 'waiting_approval');
  assert.equal((await action('approve_initial', { confirmed: true })).success, true);
  const started = await action('start_production');
  assert.equal(started.success, true, started.message);
  for (const stage of ['full_narration', 'lineart_generation']) {
    const result = await run();
    assert.equal(result.status, 'waiting_approval', result.message);
    assert.equal((await read()).whiteboard.media.stage, stage);
    assert.equal((await action('approve_media', { confirmed: true })).success, true);
  }
  return Object.assign(ctx, { id, read, action, payload, run, options });
}

(async () => {
  assert.equal(createAnnotationPool().concurrency, 10);
  assert.equal(createAnnotationPool(100).concurrency, 10);
  assert.equal(createAnnotationPool(2).concurrency, 2);
  assert.equal(createSceneRenderPool().concurrency, 3);
  assert.equal(createSceneRenderPool(100).concurrency, 8);

  const ctx = await fixture();
  ctx.faults.set('scene_2', 'low');
  assert.equal((await ctx.run()).code, 'ANNOTATION_COVERAGE_LOW');
  let record = await ctx.read();
  let media = record.whiteboard.media;
  assert.equal(record.status, 'failed');
  assert.equal(media.lowCoverage.length, 1);
  assert.equal(media.current.annotation_drafting, undefined);
  assert.equal(media.annotationProgress.completed, 2);
  assert.equal(media.annotationProgress.failed, 1);
  assert.equal(media.annotationProgress.active, 0);
  assert.equal(media.annotationProgress.concurrency, 10);
  const first = media.lowCoverage[0];
  assert.equal(first.sceneId, 'scene_2');
  await store.validateBinding(record, first, ctx.rootDir);
  for (const file of [first.annotation, first.preview, first.resultPreview]) {
    assert.equal((await workflows.getWhiteboardMediaFile(ctx.id, file.id, ctx.options)).success, true);
  }
  const view = await workflows.getCreativeWorkflow(ctx.id, ctx.options);
  assert.ok(view.data.whiteboard.allowedActions.some(action => action.id === 'accept_low_coverage'));
  assert.ok(view.data.whiteboard.media.artifacts.some(file => file.id === first.resultPreview.id && file.url));
  await fs.writeFile(path.join(ctx.root, 'review-fixture.json'), JSON.stringify({ rootDir: ctx.rootDir, view: view.data }));
  assert.equal((await ctx.action('accept_low_coverage', { confirmed: false })).code, 'APPROVAL_REQUIRED');
  assert.equal((await ctx.read()).whiteboard.media.annotations.scene_2, undefined);

  const stalePayload = ctx.payload(record, 'accept_low_coverage', { confirmed: true });
  const successful = media.annotations.scene_1.identity;
  assert.equal((await ctx.action('retry_media')).success, true);
  assert.equal((await ctx.read()).whiteboard.media.lowCoverage.length, 0);
  assert.equal((await ctx.run()).code, 'ANNOTATION_COVERAGE_LOW');
  record = await ctx.read(); media = record.whiteboard.media;
  assert.equal(media.lowCoverage.length, 1, '旧失败预览不能累积为可接受的重复记录');
  assert.notEqual(media.lowCoverage[0].attemptId, first.attemptId);
  assert.equal(media.annotations.scene_1.identity, successful);
  assert.equal(ctx.calls.get('scene_1'), 1);
  assert.equal(ctx.calls.get('scene_2'), 2);
  assert.equal(ctx.calls.get('scene_3'), 1);
  assert.equal((await workflows.actOnWhiteboardWorkflow(ctx.id, stalePayload, ctx.options)).code, 'STALE_IDENTITY');

  const pending = media.lowCoverage[0];
  const previewPath = (await store.mediaFile(record, pending.resultPreview, ctx.rootDir)).path;
  const bytes = await fs.readFile(previewPath);
  await fs.writeFile(previewPath, Buffer.concat([bytes, Buffer.from('changed')]));
  assert.equal((await ctx.action('accept_low_coverage', { confirmed: true })).code, 'ARTIFACT_INVALID');
  await fs.writeFile(previewPath, bytes);
  const beforeChangedInput = await ctx.read();
  const changedInput = structuredClone(beforeChangedInput);
  changedInput.whiteboard.media.overrides['annotation_drafting:scene_2'] = '改为另一种落墨顺序';
  await workflowStore.persistWorkflow(changedInput, ctx.rootDir);
  assert.equal((await ctx.action('accept_low_coverage', { confirmed: true })).code, 'STALE_IDENTITY');
  await workflowStore.persistWorkflow(beforeChangedInput, ctx.rootDir);

  const beforeAcceptance = [...ctx.calls.entries()];
  assert.equal((await ctx.action('accept_low_coverage', { confirmed: true })).success, true);
  record = await ctx.read(); media = record.whiteboard.media;
  assert.equal(media.lowCoverage.length, 0);
  assert.equal(media.annotations.scene_2.coverage.coverageRatio, 0.65);
  assert.equal(media.annotations.scene_2.coverageAcceptance.actor, 'user');
  assert.equal(media.annotations.scene_2.coverageAcceptance.reviewIdentity, pending.identity);
  assert.equal(media.annotations.scene_2.coverageAcceptance.missingContentPolicy, 'keep_hidden');
  assert.equal(media.attempts.find(item => item.id === pending.attemptId).status, 'accepted');
  assert.equal((await ctx.run()).status, 'waiting_approval');
  assert.deepEqual([...ctx.calls.entries()], beforeAcceptance, '接受后必须直接复用已有标注，不重新请求模型');
  record = await ctx.read();
  assert.deepEqual(record.whiteboard.media.current.annotation_drafting.scenes.map(scene => scene.sceneId), ['scene_1', 'scene_2', 'scene_3']);
  assert.equal(record.whiteboard.media.annotationProgress.reused, 3);
  assert.equal(record.whiteboard.media.current.scene_render, undefined);
  console.log('PASS 失败预览可访问、明确确认、成功幕复用、旧版本/篡改拒绝、人工接受记录与 Gate');

  const mixed = await fixture();
  mixed.faults.set('scene_1', 'low'); mixed.faults.set('scene_2', 'unknown');
  assert.equal((await mixed.run()).code, 'UNKNOWN_EXTERNAL_OUTCOME');
  record = await mixed.read(); media = record.whiteboard.media;
  assert.equal(record.status, 'unknown_external_outcome');
  assert.equal(media.attempts.findLast(item => item.sceneId === 'scene_2').status, 'unknown_external_outcome');
  assert.deepEqual(production.actionsFor(record).map(action => action.id), ['authorize_media_retry']);
  assert.equal((await mixed.action('retry_media')).success, false);
  assert.equal((await mixed.action('accept_low_coverage', { confirmed: true })).success, false);
  assert.equal((await mixed.action('authorize_media_retry', { confirmed: true })).success, true);
  mixed.faults.delete('scene_2');
  assert.equal((await mixed.run()).code, 'ANNOTATION_COVERAGE_LOW');
  assert.equal(mixed.calls.get('scene_1'), 1, '授权未知请求重试不应重新生成已经返回的低覆盖候选');
  assert.equal(mixed.calls.get('scene_2'), 2);
  assert.equal(mixed.calls.get('scene_3'), 1);
  assert.equal((await mixed.action('retry_media')).success, true);
  mixed.faults.delete('scene_1');
  assert.equal((await mixed.run()).status, 'waiting_approval');
  assert.equal((await mixed.read()).whiteboard.media.lowCoverage.length, 0);
  console.log('PASS 并发混合失败优先保留外部未知状态，授权后仅重试未完成幕，成功后清除旧预览');

  const missing = await fixture(1);
  missing.faults.set('scene_1', 'missing_preview');
  assert.equal((await missing.run()).code, 'ANNOTATION_DRAFT_FAILED');
  record = await missing.read();
  assert.equal(record.whiteboard.media.lowCoverage.length, 0);
  assert.ok(!production.actionsFor(record).some(action => action.id === 'accept_low_coverage'));

  const recovered = structuredClone(await mixed.read());
  recovered.status = 'running';
  const recovering = recovered.whiteboard.media;
  recovering.executionId = 'crash';
  recovering.activeAttemptId = 'already-complete';
  recovering.annotationProgress.active = 2;
  recovering.attempts.push({ id: 'unfinished-request', executionId: 'crash', stage: 'annotation_drafting', sceneId: 'scene_1', status: 'requesting' },
    { id: 'already-complete', executionId: 'crash', stage: 'annotation_drafting', sceneId: 'scene_2', status: 'validated' });
  production.recover(recovered, new Date().toISOString());
  assert.equal(recovered.status, 'unknown_external_outcome', '恢复必须检查全部在途幕，不能只看最后一个 attempt');
  assert.equal(recovering.annotationProgress.active, 0);
  assert.equal(recovering.attempts.at(-1).status, 'validated');
  // A failed worker may already have persisted its unknown outcome while peers
  // are still saving their complete responses. A restart must not make it retryable.
  const settledUnknown = structuredClone(await mixed.read());
  settledUnknown.status = 'running';
  settledUnknown.whiteboard.media.executionId = 'interrupted-after-worker-failure';
  settledUnknown.whiteboard.media.activeAttemptId = '';
  settledUnknown.whiteboard.media.attempts.push({ id: 'known-unknown', stage: 'annotation_drafting',
    sceneId: 'scene_2', executionId: 'interrupted-after-worker-failure', status: 'unknown_external_outcome' });
  production.recover(settledUnknown, new Date().toISOString());
  assert.equal(settledUnknown.status, 'unknown_external_outcome');
  assert.deepEqual(production.actionsFor(settledUnknown).map(action => action.id), ['authorize_media_retry']);
  console.log('PASS 缺图时禁止接受，并发请求重启恢复不遗漏较早的在途幕');

  const a = await fixture(6); const b = await fixture(6);
  const release = deferred(); const saturated = deferred();
  let active = 0; let peak = 0; let started = 0;
  const concurrent = async () => {
    active += 1; started += 1; peak = Math.max(peak, active);
    if (started === 10) saturated.resolve();
    try { await release.promise; } finally { active -= 1; }
  };
  a.beforeVision = concurrent; b.beforeVision = concurrent;
  const parallel = Promise.all([a.run(), b.run()]);
  try {
    await deadline(saturated.promise);
    assert.equal(annotationPool.active, 10);
    assert.equal(started, 10, '第 11 幕必须排队');
  } finally { release.resolve(); }
  const results = await deadline(parallel);
  assert.ok(results.every(result => result.status === 'waiting_approval'), JSON.stringify(results.map(result => ({ code: result.code, status: result.status }))));
  assert.equal(peak, 10); assert.equal(started, 12);
  assert.equal(annotationPool.active, 0); assert.equal(annotationPool.queued, 0);
  for (const current of [a, b]) {
    const final = await current.read();
    const progress = final.whiteboard.media.annotationProgress;
    assert.equal(progress.completed, 6); assert.equal(progress.failed, 0); assert.equal(progress.queued, 0);
    assert.deepEqual(final.whiteboard.media.current.annotation_drafting.scenes.map(scene => scene.sceneId),
      Array.from({ length: 6 }, (_, index) => `scene_${index + 1}`));
    assert.ok(current.events.some(event => event.stage === 'annotation_drafting' && /并发上限 10/.test(event.message)));
  }
  const pool = createAnnotationPool(2);
  const controller = new AbortController();
  const running = deferred(); const unblock = deferred();
  let invoked = 0;
  const cancelled = pool.mapSettled([1, 2, 3, 4], async () => { if (++invoked === 2) running.resolve(); await unblock.promise; }, { signal: controller.signal });
  await deadline(running.promise);
  controller.abort(); unblock.resolve();
  const cancelledResults = await cancelled;
  assert.equal(invoked, 2);
  assert.equal(cancelledResults.filter(result => result.status === 'rejected' && result.reason.code === 'MEDIA_CANCELLED').length, 2);
  assert.equal(pool.active, 0); assert.equal(pool.queued, 0);
  console.log('PASS 两个制作任务共享最多 10 幕并发、排队/顺序/进度与取消，单幕渲染原有限制保留');

  await assert.rejects(tools.execute(process.execPath, ['-e',
    "console.log(JSON.stringify({message:'覆盖率不足',errorCode:'ANNOTATION_COVERAGE_LOW',coverageRatio:0.65,coverage:{coverageRatio:0.65,regions:1,coveredInkPixels:65,totalInkPixels:100}}));process.exit(1)"]),
  error => error.code === 'ANNOTATION_COVERAGE_LOW' && error.coverage.coveredInkPixels === 65 && error.coverageRatio === 0.65);
  console.log(`落墨回归通过；真实 provider 调用 0。界面测试数据：${path.join(ctx.root, 'review-fixture.json')}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
