const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const workflows = require('../server/services/creative/creativeWorkflows');
const workflowStore = require('../server/services/creative/workflowStore');
const store = require('../server/services/creative/whiteboard/mediaStore');
const tools = require('../server/services/creative/whiteboard/mediaTools');
const production = require('../server/services/creative/whiteboard/productionWorkflows');
const models = require('../server/services/creative/whiteboard/mediaModels');
const { srtText } = require('../server/services/creative/whiteboard/narrationTiming');
const { WhiteboardError } = require('../server/services/creative/whiteboard/contracts');
const { createAnnotationPool, annotationPool } = require('../server/services/creative/whiteboard/annotationPool');
const { createSceneRenderPool, sceneRenderPool } = require('../server/services/creative/whiteboard/sceneRenderPool');
const { imagePool } = require('../server/services/creative/whiteboard/imagePool');
const { configureWhiteboardConcurrency } = require('../server/services/creative/whiteboard/concurrency');

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

async function fixture(count = 3, { startStage = 'annotation_drafting' } = {}) {
  const parent = path.resolve(__dirname, '../.codex-runtime');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'whiteboard-annotation-test-'));
  const rootDir = path.join(root, 'workflows');
  const cues = Array.from({ length: count }, (_, index) => ({ id: `cue_${index + 1}`, text: `展示第${index + 1}个图形。`, startMs: index * 3000, endMs: (index + 1) * 3000 }));
  const candidate = { schemaVersion: 1, title: '落墨并发与人工接受测试', summary: '按顺序展示多个独立图形，检查落墨编排与失败恢复。',
    cues: cues.map(({ id, text }) => ({ id, text })),
    scenes: cues.map((cue, index) => ({ id: `scene_${index + 1}`, title: `图形 ${index + 1}`, cueIds: [cue.id], imagePrompt: `暖米黄纸张上的单个完整图形，清晰轮廓，充分留白。测试编号 scene_${index + 1}` })) };
  const faults = new Map();
  const calls = new Map();
  const events = [];
  const ctx = { root, rootDir, faults, calls, events, visionRequests: [], beforeVision: () => pause(15),
    beforeImage: () => pause(15), beforeRender: () => pause(15),
    imageFaults: new Map(), imageCalls: new Map(), renderCalls: new Map(), allowRender: false };
  const config = { enabled: true, provider: 'fixture', apiKey: 'fixture-only', baseUrl: 'https://example.invalid',
    modelId: 'fixture-text', supportsMultimodal: true };
  const options = { rootDir, taskContext: { emit: async event => events.push(event) }, services: {
    aiModelConfig: { getRuntimeConfig: async type => type === 'tts' ? { enabled: false } : config },
    fetchImpl: async () => { throw new Error('测试禁止真实网络请求'); },
    aiImageModel: { generateImages: async request => {
      const sceneId = request.prompt.match(/测试编号 (scene_\d+)/)[1];
      ctx.imageCalls.set(sceneId, (ctx.imageCalls.get(sceneId) || 0) + 1);
      await ctx.beforeImage(sceneId);
      if (ctx.imageFaults.get(sceneId) === 'unknown') throw new Error('fixture image connection lost');
      if (ctx.imageFaults.get(sceneId) === 'rejected') throw new WhiteboardError('IMAGE_REQUEST_REJECTED', '测试注入：图片服务限流（HTTP 429）。');
      return { success: true, images: [{ b64_json: Buffer.concat([png, Buffer.from(sceneId)]).toString('base64') }] };
    } },
    aiTextModel: { callTextModel: async request => {
      if (typeof request.messages[1].content === 'string') return { success: true, text: JSON.stringify(candidate) };
      const prompt = request.messages[1].content[0].text;
      const sceneId = JSON.parse(prompt.split('本幕与真实字幕时间：')[1].split('\n')[0]).scene.id;
      calls.set(sceneId, (calls.get(sceneId) || 0) + 1);
      ctx.visionRequests.push({ sceneId, messages: structuredClone(request.messages) });
      await ctx.beforeVision(sceneId);
      const mode = faults.get(sceneId);
      const feedback = request.messages.at(-1).content;
      const correction = Array.isArray(feedback) && feedback.some(part => part.text?.includes('当前候选的墨迹覆盖率'));
      if (mode === 'unknown' || (correction && mode === 'repair_unknown')) throw new Error('fixture connection lost');
      if ((mode === 'schema_then_low' && calls.get(sceneId) === 1) || (mode === 'repair_invalid' && correction)) {
        return { success: true, text: JSON.stringify({ schemaVersion: 1 }) };
      }
      const next = structuredClone(annotationCandidate);
      if (correction && mode === 'repair_success') next.elements[0].region.width = 600;
      return { success: true, text: JSON.stringify(next) };
    } },
    whiteboardMediaTools: { ...tools,
      preflight: async () => ({ font: 'fixture-font', recipe: { width: 1920, height: 1080, fixture: true } }),
      python: async (command, input) => {
        assert.ok(['normalize-image', 'annotation-preview'].includes(command));
        if (command === 'normalize-image') {
          const raw = await fs.readFile(input.input);
          const sceneId = raw.toString('utf8').match(/scene_\d+$/)[0];
          if (ctx.imageFaults.get(sceneId) === 'normalize_failure') throw new WhiteboardError('MEDIA_FAILED', '测试注入：图片处理失败。');
          await fs.writeFile(input.output, png, { flag: 'wx' }); return { width: 1920, height: 1080 };
        }
        const mode = faults.get(input.annotation.sceneId);
        if (mode === 'local_failure') throw new WhiteboardError('MEDIA_FAILED', '测试注入：预览生成失败。');
        await fs.writeFile(input.output, png, { flag: 'wx' });
        if (mode !== 'missing_preview') await fs.writeFile(input.resultOutput, png, { flag: 'wx' });
        if (['low', 'missing_preview', 'repair_invalid', 'repair_unknown', 'schema_then_low'].includes(mode)
          || (mode === 'repair_success' && input.annotation.elements[0].region.width === 300)) {
          const error = new WhiteboardError('ANNOTATION_COVERAGE_LOW', '测试注入：标注覆盖不足。');
          error.coverageRatio = 0.65;
          error.coverage = { coverageRatio: 0.65, regions: 1, coveredInkPixels: 65, totalInkPixels: 100 };
          throw error;
        }
        return { coverageRatio: 1, regions: 1, coveredInkPixels: 100, totalInkPixels: 100 };
      },
      renderScene: async ({ scene, output }) => {
        assert.equal(ctx.allowRender, true, '此测试不能越过人工 Gate 渲染视频');
        ctx.renderCalls.set(scene.id, (ctx.renderCalls.get(scene.id) || 0) + 1);
        await ctx.beforeRender(scene.id);
        await fs.writeFile(output, `fixture video ${scene.id}`, { flag: 'wx' });
        return { ...tools.RENDER_PROFILE, frameCount: (scene.endMs - scene.startMs) * 60 / 1000,
          durationMs: scene.endMs - scene.startMs, audio: false, decoded: true };
      },
      extractFrame: async (_video, output) => fs.writeFile(output, png, { flag: 'wx' }),
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
  for (const stage of startStage === 'lineart_generation' ? ['full_narration'] : ['full_narration', 'lineart_generation']) {
    const result = await run();
    assert.equal(result.status, 'waiting_approval', result.message);
    assert.equal((await read()).whiteboard.media.stage, stage);
    assert.equal((await action('approve_media', { confirmed: true })).success, true);
  }
  return Object.assign(ctx, { id, read, action, payload, run, options });
}

async function assertTenConcurrent(ctx, hook, pool, stage, progressKey) {
  const release = deferred(); const saturated = deferred();
  let started = 0; let active = 0; let peak = 0;
  ctx[hook] = async () => {
    active += 1; started += 1; peak = Math.max(peak, active);
    if (started === 10) saturated.resolve();
    try { await release.promise; } finally { active -= 1; }
  };
  const result = ctx.run();
  try {
    await deadline(saturated.promise);
    assert.equal(pool.active, 10);
    assert.equal(started, 10, `${stage} 的第 11 幕必须排队`);
  } finally { release.resolve(); }
  const finished = await deadline(result);
  assert.equal(finished.status, 'waiting_approval', finished.message);
  assert.equal(peak, 10); assert.equal(started, 12);
  const record = await ctx.read();
  assert.equal(record.whiteboard.media.stage, stage);
  assert.equal(record.whiteboard.media[progressKey].completed, 12);
  assert.equal(record.whiteboard.media[progressKey].concurrency, 10);
  assert.deepEqual(record.whiteboard.media.current[stage].scenes.map(scene => scene.sceneId),
    Array.from({ length: 12 }, (_, index) => `scene_${index + 1}`));
}

(async () => {
  assert.equal(createAnnotationPool().concurrency, 10);
  assert.equal(createAnnotationPool(100).concurrency, 10);
  assert.equal(createAnnotationPool(2).concurrency, 2);
  assert.equal(createSceneRenderPool().concurrency, 3);
  assert.equal(createSceneRenderPool(100).concurrency, 10);
  configureWhiteboardConcurrency({ imageConcurrency: 3, annotationConcurrency: 10, renderConcurrency: 3 });

  const ctx = await fixture();
  ctx.faults.set('scene_2', 'low');
  assert.equal((await ctx.run()).code, 'ANNOTATION_COVERAGE_LOW');
  let record = await ctx.read();
  let media = record.whiteboard.media;
  assert.equal(record.status, 'waiting_approval');
  assert.equal(media.gate, 'annotation_coverage_review');
  assert.equal(record.error, null);
  assert.equal(record.whiteboard.interactions.at(-1).kind, 'annotation_coverage_review');
  assert.ok(!production.actionsFor(record).some(action => action.id === 'approve_media'), '低覆盖率不能通过普通产物确认跳过检查');
  assert.equal(media.lowCoverage.length, 1);
  assert.equal(media.current.annotation_drafting, undefined);
  assert.equal(media.annotationProgress.completed, 2);
  assert.equal(media.annotationProgress.failed, 1);
  assert.equal(media.annotationProgress.active, 0);
  assert.equal(media.annotationProgress.concurrency, 10);
  const first = media.lowCoverage[0];
  assert.equal(first.sceneId, 'scene_2');
  assert.equal(ctx.calls.get('scene_2'), 2, '持续覆盖不足时只能修正一次');
  assert.ok(first.coverageRepair?.sourceIdentity, '低覆盖率修正必须绑定原预览');
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

  const interruptedReview = structuredClone(record);
  interruptedReview.status = 'running';
  interruptedReview.whiteboard.media.executionId = 'review-published-before-restart';
  production.recover(interruptedReview, new Date().toISOString());
  assert.equal(interruptedReview.status, 'waiting_approval');
  assert.equal(interruptedReview.task_status, 'waiting_approval');
  assert.equal(interruptedReview.whiteboard.media.lowCoverage[0].identity, first.identity);
  assert.ok(production.actionsFor(interruptedReview).some(action => action.id === 'accept_low_coverage'));
  const oldError = structuredClone(record);
  oldError.status = 'failed';
  oldError.error = { code: 'MEDIA_INTERRUPTED', message: '旧版本中断记录' };
  assert.ok(production.actionsFor(oldError).some(action => action.id === 'accept_low_coverage'), '已保存的有效预览不能因顶层错误码改变而失去入口');

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
  assert.equal(ctx.calls.get('scene_2'), 4);
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

  const legacy = await fixture();
  legacy.faults.set('scene_2', 'low');
  await legacy.run();
  const legacyRecord = await legacy.read();
  const legacyMedia = legacyRecord.whiteboard.media;
  const legacyEntry = legacyMedia.lowCoverage[0];
  const legacyAttempt = legacyMedia.attempts.find(item => item.id === legacyEntry.attemptId);
  const orphaned = new Set([legacyEntry.annotation.id, legacyEntry.preview.id, legacyEntry.resultPreview.id]);
  legacyMedia.artifacts = legacyMedia.artifacts.filter(file => !orphaned.has(file.id));
  legacyAttempt.received = { candidate: legacyAttempt.received.candidate };
  legacyAttempt.errorCode = 'MEDIA_FAILED';
  const legacyTiming = await store.readData(legacyRecord, legacyMedia.current.full_narration.timeline, legacy.rootDir);
  const legacyScene = legacyTiming.scenes.find(scene => scene.id === 'scene_2');
  legacyAttempt.inputIdentity = models.annotationInput({ scene: legacyScene,
    cues: legacyTiming.cues.filter(cue => legacyScene.cueIds.includes(cue.id)),
    imageSha256: legacyMedia.lineart.scene_2.image.sha256, timingIdentity: legacyMedia.current.full_narration.identity,
  }, models.LEGACY_ANNOTATION_PLANNING_CONTRACT).inputIdentity;
  delete legacyAttempt.repairOfAttemptId; delete legacyAttempt.repairSourceIdentity;
  delete legacyMedia.lowCoverage;
  legacyMedia.gate = ''; legacyMedia.interactionId = '';
  legacyRecord.status = 'failed'; legacyRecord.success = false;
  legacyRecord.error = { code: 'MEDIA_FAILED', message: '标注未完整覆盖线稿（覆盖率 65.0%）。预览图已生成。' };
  legacyRecord.whiteboard.interactions = legacyRecord.whiteboard.interactions.filter(item => item.kind !== 'annotation_coverage_review');
  await workflowStore.persistWorkflow(legacyRecord, legacy.rootDir);
  assert.ok(production.actionsFor(legacyRecord).some(action => action.id === 'recover_annotation_preview'));
  assert.ok(!production.actionsFor(legacyRecord).some(action => action.id === 'accept_low_coverage'));

  const staleRecovery = structuredClone(legacyRecord);
  staleRecovery.whiteboard.media.overrides['annotation_drafting:scene_2'] = '新的分区要求';
  await workflowStore.persistWorkflow(staleRecovery, legacy.rootDir);
  assert.equal((await legacy.action('recover_annotation_preview', { sceneId: 'scene_2' })).code, 'STALE_IDENTITY');
  await workflowStore.persistWorkflow(legacyRecord, legacy.rootDir);
  const candidatePath = (await store.mediaFile(legacyRecord, legacyAttempt.received.candidate, legacy.rootDir)).path;
  const candidateBytes = await fs.readFile(candidatePath);
  await fs.writeFile(candidatePath, Buffer.concat([candidateBytes, Buffer.from('changed')]));
  assert.equal((await legacy.action('recover_annotation_preview', { sceneId: 'scene_2' })).code, 'ARTIFACT_INVALID');
  await fs.writeFile(candidatePath, candidateBytes);
  const callsBeforeRecovery = [...legacy.calls.entries()];
  const recoveredPreview = await legacy.action('recover_annotation_preview', { sceneId: 'scene_2' });
  assert.equal(recoveredPreview.success, true, recoveredPreview.message);
  assert.equal(recoveredPreview.startTask, false, '恢复预览不得启动模型请求或后续制作');
  const restoredRecord = await legacy.read();
  const restored = restoredRecord.whiteboard.media;
  assert.equal(restoredRecord.status, 'waiting_approval');
  assert.equal(restored.gate, 'annotation_coverage_review');
  assert.equal(restored.lowCoverage.length, 1);
  assert.equal(restored.lowCoverage[0].sceneId, 'scene_2');
  assert.equal(restored.lowCoverage[0].planningContract, models.LEGACY_ANNOTATION_PLANNING_CONTRACT, '旧候选恢复不能静默改用新提示词身份');
  assert.equal(restored.annotations.scene_2, undefined, '恢复预览不能代替用户接受');
  assert.equal(restored.annotations.scene_1.identity, legacyMedia.annotations.scene_1.identity);
  assert.equal(restored.annotations.scene_3.identity, legacyMedia.annotations.scene_3.identity);
  assert.equal(restored.attempts.at(-1).external, false);
  assert.equal(restored.attempts.at(-1).recoveredFromAttemptId, legacyAttempt.id);
  assert.equal(restored.attempts.find(item => item.id === legacyAttempt.id).errorCode, 'MEDIA_FAILED', '原失败证据保持不变');
  for (const file of [restored.lowCoverage[0].annotation, restored.lowCoverage[0].preview, restored.lowCoverage[0].resultPreview]) {
    assert.equal((await workflows.getWhiteboardMediaFile(legacy.id, file.id, legacy.options)).success, true);
  }
  assert.deepEqual([...legacy.calls.entries()], callsBeforeRecovery);
  assert.equal((await legacy.action('accept_low_coverage', { confirmed: true })).success, true);
  assert.equal((await legacy.run()).status, 'waiting_approval');
  assert.deepEqual([...legacy.calls.entries()], callsBeforeRecovery, '恢复的候选在明确接受后仍应直接复用');
  console.log('PASS 旧失败记录本地恢复双预览、保留成功幕与失败证据、过期/篡改拒绝、零新增模型请求');

  const mixed = await fixture();
  mixed.faults.set('scene_1', 'low'); mixed.faults.set('scene_2', 'unknown');
  assert.equal((await mixed.run()).code, 'UNKNOWN_EXTERNAL_OUTCOME');
  record = await mixed.read(); media = record.whiteboard.media;
  // 模拟升级前已保存的 v2 待审预览，与另一幕未知请求并存。
  const mixedTiming = await store.readData(record, media.current.full_narration.timeline, mixed.rootDir);
  const oldScene = mixedTiming.scenes.find(scene => scene.id === 'scene_1');
  const oldInput = models.annotationInput({ scene: oldScene,
    cues: mixedTiming.cues.filter(cue => oldScene.cueIds.includes(cue.id)),
    imageSha256: media.lineart.scene_1.image.sha256, timingIdentity: media.current.full_narration.identity,
  }, models.LEGACY_ANNOTATION_PLANNING_CONTRACT);
  const { identity: _oldIdentity, coverageRepair: _oldRepair, ...oldEntry } = media.lowCoverage[0];
  media.lowCoverage[0] = store.bind({ ...oldEntry, inputIdentity: oldInput.inputIdentity, planningContract: oldInput.planningContract });
  const oldAttempt = media.attempts.find(attempt => attempt.id === oldEntry.attemptId);
  oldAttempt.inputIdentity = oldInput.inputIdentity;
  delete oldAttempt.repairOfAttemptId; delete oldAttempt.repairSourceIdentity;
  const retainedIdentity = media.lowCoverage[0].identity;
  await workflowStore.persistWorkflow(record, mixed.rootDir);
  assert.equal(record.status, 'unknown_external_outcome');
  assert.equal(media.attempts.findLast(item => item.sceneId === 'scene_2').status, 'unknown_external_outcome');
  assert.deepEqual(production.actionsFor(record).map(action => action.id), ['authorize_media_retry']);
  assert.equal((await mixed.action('retry_media')).success, false);
  assert.equal((await mixed.action('accept_low_coverage', { confirmed: true })).success, false);
  assert.equal((await mixed.action('authorize_media_retry', { confirmed: true })).success, true);
  mixed.faults.delete('scene_2');
  assert.equal((await mixed.run()).code, 'ANNOTATION_COVERAGE_LOW');
  assert.equal(mixed.calls.get('scene_1'), 2, '授权未知请求重试不应重新生成已经返回的低覆盖候选');
  assert.equal((await mixed.read()).whiteboard.media.lowCoverage[0].identity, retainedIdentity, '升级后继续制作应保留 v2 预览及身份');
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

  const repaired = await fixture(2);
  repaired.faults.set('scene_1', 'repair_success');
  assert.equal((await repaired.run()).status, 'waiting_approval');
  const repairedRecord = await repaired.read();
  assert.equal(repairedRecord.whiteboard.media.lowCoverage.length, 0);
  assert.equal(repairedRecord.whiteboard.media.annotations.scene_1.coverage.coverageRatio, 1);
  assert.equal(repaired.calls.get('scene_1'), 2);
  assert.equal(repaired.calls.get('scene_2'), 1, '成功幕不能被另一幕的修正重复请求');
  assert.equal(repairedRecord.whiteboard.media.gate, 'annotation_approval');
  assert.equal(repairedRecord.whiteboard.media.current.scene_render, undefined);
  const repairRequests = repaired.visionRequests.filter(request => request.sceneId === 'scene_1');
  const correction = repairRequests[1].messages.at(-1).content;
  assert.match(correction.find(part => part.type === 'text').text, /65\.0%[\s\S]*35\.0%[\s\S]*待修正候选/);
  assert.equal(correction.filter(part => part.type === 'image_url').length, 1, '修正必须附上真实遗漏预览');
  assert.equal(repairRequests[1].messages[1].content.filter(part => part.type === 'image_url').length, 1, '原始线稿必须继续可见');
  assert.ok(repaired.events.some(event => /根据遗漏预览修正/.test(event.message)));

  const budget = await fixture(1);
  budget.faults.set('scene_1', 'schema_then_low');
  assert.equal((await budget.run()).status, 'waiting_approval');
  assert.equal(budget.calls.get('scene_1'), 2, '格式补正后不得额外启动第三次覆盖率修正');
  assert.equal((await budget.read()).whiteboard.media.lowCoverage.length, 1);

  const failedRepair = await fixture(1);
  failedRepair.faults.set('scene_1', 'repair_invalid');
  assert.equal((await failedRepair.run()).status, 'waiting_approval');
  const beforeRepairAcceptance = await failedRepair.read();
  const keptPreview = beforeRepairAcceptance.whiteboard.media.lowCoverage[0];
  const failedAttempt = beforeRepairAcceptance.whiteboard.media.attempts.at(-1);
  assert.equal(failedRepair.calls.get('scene_1'), 2);
  assert.equal(failedAttempt.errorCode, 'CANDIDATE_INVALID');
  assert.equal(failedAttempt.repairOfAttemptId, keptPreview.attemptId);
  const wrongSource = structuredClone(beforeRepairAcceptance);
  wrongSource.whiteboard.media.attempts.at(-1).repairSourceIdentity = 'not-the-reviewed-preview';
  await workflowStore.persistWorkflow(wrongSource, failedRepair.rootDir);
  assert.equal((await failedRepair.action('accept_low_coverage', { confirmed: true })).success, false);
  // 模拟在修正请求准备好、尚未发送时重启：原预览仍然可以明确接受。
  beforeRepairAcceptance.status = 'running';
  beforeRepairAcceptance.whiteboard.media.executionId = failedAttempt.executionId;
  beforeRepairAcceptance.whiteboard.media.activeAttemptId = failedAttempt.id;
  beforeRepairAcceptance.whiteboard.media.attempts.at(-1).status = 'prepared';
  production.recover(beforeRepairAcceptance, new Date().toISOString());
  await workflowStore.persistWorkflow(beforeRepairAcceptance, failedRepair.rootDir);
  assert.equal((await failedRepair.action('accept_low_coverage', { confirmed: true })).success, true, '明确失败的修正不能使已保存预览不可接受');
  assert.equal((await failedRepair.run()).status, 'waiting_approval');
  assert.equal(failedRepair.calls.get('scene_1'), 2);

  const unknownRepair = await fixture(2);
  unknownRepair.faults.set('scene_1', 'repair_unknown');
  unknownRepair.faults.set('scene_2', 'low');
  assert.equal((await unknownRepair.run()).status, 'unknown_external_outcome');
  assert.equal((await unknownRepair.read()).whiteboard.media.lowCoverage.length, 2, '未知修正结果必须保留已取得的预览证据');
  assert.equal((await unknownRepair.action('retry_media')).success, false);
  assert.equal((await unknownRepair.action('accept_low_coverage', { confirmed: true })).success, false);
  assert.equal((await unknownRepair.action('authorize_media_retry', { confirmed: true })).success, true);
  assert.deepEqual((await unknownRepair.read()).whiteboard.media.lowCoverage.map(entry => entry.sceneId), ['scene_2']);
  unknownRepair.faults.delete('scene_1');
  assert.equal((await unknownRepair.run()).status, 'waiting_approval');
  assert.equal(unknownRepair.calls.get('scene_1'), 3, '明确授权后只重试未知的幕');
  assert.equal(unknownRepair.calls.get('scene_2'), 2, '其他已保存预览不得重复请求');
  console.log('PASS 遗漏图反馈修正、总请求预算、明确失败回用原预览、准备中重启和未知结果授权');

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
  console.log('PASS 两个制作任务共享最多 10 幕并发、排队/顺序/进度与取消');

  const images = await fixture(3, { startStage: 'lineart_generation' });
  images.imageFaults.set('scene_1', 'normalize_failure');
  images.imageFaults.set('scene_2', 'rejected');
  const imageFailure = await images.run();
  assert.equal(imageFailure.code, 'LINEART_GENERATION_FAILED');
  assert.match(imageFailure.message, /图片处理失败/);
  assert.match(imageFailure.message, /HTTP 429/);
  let imageRecord = await images.read();
  assert.equal(imageRecord.whiteboard.media.lineartProgress.completed, 1);
  assert.equal(imageRecord.whiteboard.media.lineartProgress.failed, 2);
  const successfulImage = imageRecord.whiteboard.media.lineart.scene_3.identity;
  images.imageFaults.clear();
  assert.equal((await images.action('retry_media')).success, true);
  assert.equal((await images.run()).status, 'waiting_approval');
  imageRecord = await images.read();
  assert.equal(imageRecord.whiteboard.media.lineart.scene_3.identity, successfulImage);
  assert.equal(imageRecord.whiteboard.media.lineartProgress.reused, 2);
  assert.equal(images.imageCalls.get('scene_1'), 1, '已收到原图但本地处理失败时不得重新生图');
  assert.equal(images.imageCalls.get('scene_2'), 2, '明确拒绝的幕只在手动继续后重新请求');
  assert.equal(images.imageCalls.get('scene_3'), 1, '已完成线稿应直接复用');

  const unknownImages = await fixture(3, { startStage: 'lineart_generation' });
  unknownImages.imageFaults.set('scene_1', 'unknown');
  assert.equal((await unknownImages.run()).code, 'UNKNOWN_EXTERNAL_OUTCOME');
  assert.equal((await unknownImages.action('retry_media')).success, false);
  const recovery = structuredClone(await unknownImages.read());
  recovery.status = 'running';
  recovery.whiteboard.media.executionId = 'image-crash';
  recovery.whiteboard.media.activeAttemptId = 'completed-image';
  recovery.whiteboard.media.attempts.push({ id: 'requesting-image', stage: 'lineart_generation', executionId: 'image-crash', status: 'requesting' },
    { id: 'completed-image', stage: 'lineart_generation', executionId: 'image-crash', status: 'validated' });
  production.recover(recovery, new Date().toISOString());
  assert.equal(recovery.status, 'unknown_external_outcome');
  assert.equal(recovery.whiteboard.media.lineartProgress.active, 0);
  unknownImages.imageFaults.clear();
  assert.equal((await unknownImages.action('authorize_media_retry', { confirmed: true })).success, true);
  assert.equal((await unknownImages.run()).status, 'waiting_approval');
  assert.equal(unknownImages.imageCalls.get('scene_1'), 2);
  assert.equal(unknownImages.imageCalls.get('scene_2'), 1);
  assert.equal(unknownImages.imageCalls.get('scene_3'), 1);
  console.log('PASS 并发生图保留成功幕与原图、限流重试、未知结果授权和重启恢复');

  configureWhiteboardConcurrency({ imageConcurrency: 10, annotationConcurrency: 10, renderConcurrency: 10 });
  const allStages = await fixture(12, { startStage: 'lineart_generation' });
  await assertTenConcurrent(allStages, 'beforeImage', imagePool, 'lineart_generation', 'lineartProgress');
  assert.equal((await allStages.action('approve_media', { confirmed: true })).success, true);
  await assertTenConcurrent(allStages, 'beforeVision', annotationPool, 'annotation_drafting', 'annotationProgress');
  assert.equal((await allStages.action('approve_media', { confirmed: true })).success, true);
  allStages.allowRender = true;
  await assertTenConcurrent(allStages, 'beforeRender', sceneRenderPool, 'scene_render', 'sceneRenderProgress');
  console.log('PASS 同一个十二幕任务：生图、落墨和单幕渲染分别达到 10 并发，始终按分镜顺序发布');

  const deletedImages = await fixture(3, { startStage: 'lineart_generation' });
  const imagesStarted = deferred(); const releaseImages = deferred();
  let imageRequests = 0;
  deletedImages.beforeImage = async () => { if (++imageRequests === 3) imagesStarted.resolve(); await releaseImages.promise; };
  const deletingRun = deletedImages.run();
  try {
    await deadline(imagesStarted.promise);
    assert.equal((await workflows.deleteCreativeWorkflow(deletedImages.id, deletedImages.options)).success, true);
  } finally { releaseImages.resolve(); }
  assert.equal((await deadline(deletingRun)).status, 'deleted');
  await assert.rejects(fs.stat(path.join(deletedImages.rootDir, 'whiteboard-artifacts', deletedImages.id)), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(deletedImages.rootDir, '.whiteboard-work', deletedImages.id)), { code: 'ENOENT' });
  console.log('PASS 删除并发生图任务后，晚到图片不会复活任务或产物目录');

  await assert.rejects(tools.execute(process.execPath, ['-e',
    "console.log(JSON.stringify({message:'覆盖率不足',errorCode:'ANNOTATION_COVERAGE_LOW',coverageRatio:0.65,coverage:{coverageRatio:0.65,regions:1,coveredInkPixels:65,totalInkPixels:100}}));process.exit(1)"]),
  error => error.code === 'ANNOTATION_COVERAGE_LOW' && error.coverage.coveredInkPixels === 65 && error.coverageRatio === 0.65);
  console.log(`落墨回归通过；真实 provider 调用 0。界面测试数据：${path.join(ctx.root, 'review-fixture.json')}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
