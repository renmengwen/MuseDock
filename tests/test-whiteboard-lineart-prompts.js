const assert = require('node:assert/strict');
const workflows = require('../server/services/creative/creativeWorkflows');
const artifactStore = require('../server/services/creative/whiteboard/artifactStore');
const production = require('../server/services/creative/whiteboard/productionWorkflows');
const { configureWhiteboardConcurrency } = require('../server/services/creative/whiteboard/concurrency');
const { fixture, deferred, deadline } = require('./test-whiteboard-annotation-workflow');

const editedPrompt = sceneId => `暖米黄纸面上用清晰轮廓描绘一棵树和一本打开的书，四周充分留白。测试编号 ${sceneId}`;
async function view(ctx) {
  const result = await workflows.getCreativeWorkflow(ctx.id, ctx.options);
  assert.equal(result.success, true, result.message);
  return result.data;
}
async function save(ctx, sceneId, imagePrompt = editedPrompt(sceneId), extra = {}) {
  const prompt = (await view(ctx)).whiteboard.media.lineartPromptDetails[sceneId];
  return ctx.action('save_lineart_prompt', { sceneId, imagePrompt, revision: prompt.revision,
    expectedPromptIdentity: prompt.identity, ...extra });
}

async function testQueuedAndRejected() {
  const ctx = await fixture(2, { startStage: 'lineart_generation' });
  const initial = await view(ctx);
  const original = initial.whiteboard.current.artifact.scenes[0].imagePrompt;
  const originalIdentity = initial.whiteboard.current.identity;
  assert.ok(initial.whiteboard.allowedActions.some(action => action.id === 'save_lineart_prompt'));
  assert.equal(initial.whiteboard.media.lineart.scene_1, undefined);
  assert.equal(initial.whiteboard.media.lineartPromptDetails.scene_1.imagePrompt, original);
  for (const imagePrompt of ['', '短', '沿用上一幕，增加更多留白', '字'.repeat(6001), null]) {
    assert.equal((await save(ctx, 'scene_1', imagePrompt)).code, 'INVALID_INPUT');
  }
  const before = initial.whiteboard.media.lineartPromptDetails.scene_1;
  const payload = ctx.payload(await ctx.read(), 'save_lineart_prompt', { sceneId: 'scene_1',
    imagePrompt: editedPrompt('scene_1'), revision: '', expectedPromptIdentity: before.identity });
  const saved = await workflows.actOnWhiteboardWorkflow(ctx.id, payload, ctx.options);
  assert.equal(saved.success, true, saved.message);
  assert.equal(saved.startTask, false, '保存不能启动后台任务或图片请求');
  assert.equal(saved.workflow.status, 'queued', '原本已排队的制作保持原执行计划');
  assert.equal(ctx.imageRequests.length, 0);
  assert.equal((await ctx.read()).whiteboard.media.lineartPrompts.scene_1, editedPrompt('scene_1'));
  const afterRevision = saved.workflow.whiteboard.media.revision;
  assert.equal((await workflows.actOnWhiteboardWorkflow(ctx.id, payload, ctx.options)).success, true, '相同请求幂等');
  assert.equal((await ctx.read()).whiteboard.media.revision, afterRevision);
  assert.equal((await save(ctx, 'scene_1', '过期编辑不能覆盖新内容。测试编号 scene_1', { expectedPromptIdentity: before.identity })).code, 'STALE_IDENTITY');
  assert.equal((await save(ctx, 'scene_1', editedPrompt('scene_1'))).success, true, '不变内容可安全重复保存');
  assert.equal((await ctx.read()).whiteboard.media.revision, afterRevision);
  const record = await ctx.read();
  const artifact = await artifactStore.readArtifact(record, record.whiteboard.current, ctx.rootDir);
  assert.equal(artifact.scenes[0].imagePrompt, original, '原批准方案保持不可变');
  assert.equal(record.whiteboard.initialApproval.identity, originalIdentity);

  ctx.imageFaults.set('scene_1', 'rejected');
  assert.equal((await ctx.run()).code, 'LINEART_GENERATION_FAILED');
  assert.ok(ctx.imageRequests[0].prompt.includes(editedPrompt('scene_1')));
  assert.ok(!ctx.imageRequests[0].prompt.includes(original));
  const keptImage = (await ctx.read()).whiteboard.media.lineart.scene_2.identity;
  const retryPrompt = `一只小鸟停在树枝上，背景留白、线条简洁。测试编号 scene_1`;
  const rejectedSaved = await save(ctx, 'scene_1', retryPrompt);
  assert.equal(rejectedSaved.success, true, rejectedSaved.message);
  assert.equal(rejectedSaved.startTask, false);
  assert.equal(rejectedSaved.workflow.status, 'waiting_approval');
  assert.equal(ctx.imageRequests.length, 2);
  ctx.imageFaults.clear();
  assert.equal((await ctx.action('retry_media')).success, true);
  assert.equal((await ctx.run()).status, 'waiting_approval');
  assert.equal(ctx.imageCalls.get('scene_1'), 2);
  assert.equal(ctx.imageCalls.get('scene_2'), 1);
  assert.ok(ctx.imageRequests.at(-1).prompt.includes(retryPrompt));
  assert.equal((await ctx.read()).whiteboard.media.lineart.scene_2.identity, keptImage);

  assert.equal((await ctx.action('revise_media', { sceneId: 'scene_1', message: '应删除的旧附加修改要求' })).success, true);
  assert.equal((await view(ctx)).whiteboard.media.lineartPromptDetails.scene_1.revision, '应删除的旧附加修改要求');
  assert.equal((await save(ctx, 'scene_1', retryPrompt, { revision: '' })).success, true);
  assert.equal((await ctx.run()).status, 'waiting_approval');
  assert.ok(!ctx.imageRequests.at(-1).prompt.includes('应删除的旧附加修改要求'));
  console.log('PASS 无图时读取、校验、幂等保存、版本冲突、失败后使用新提示词重试及清空旧修订');
}

async function testDownstreamInvalidation() {
  const ctx = await fixture(2);
  assert.equal((await ctx.run()).status, 'waiting_approval');
  assert.equal((await ctx.action('approve_media', { confirmed: true })).success, true);
  ctx.allowRender = true;
  assert.equal((await ctx.run()).status, 'waiting_approval');
  const before = (await ctx.read()).whiteboard.media;
  const saved = await save(ctx, 'scene_1');
  assert.equal(saved.success, true, saved.message);
  const after = (await ctx.read()).whiteboard.media;
  assert.equal(after.stage, 'lineart_generation');
  assert.equal(after.gate, '');
  assert.equal(after.current.full_narration.identity, before.current.full_narration.identity);
  for (const key of ['lineart', 'annotations', 'scenes']) {
    assert.equal(after[key].scene_1, undefined);
    assert.equal(after[key].scene_2.identity, before[key].scene_2.identity);
  }
  for (const key of ['lineart_generation', 'annotation_drafting', 'scene_render', 'final_delivery']) assert.equal(after.current[key], undefined);
  assert.ok(after.approvals.filter(approval => ['lineart_approval', 'annotation_approval'].includes(approval.gate)).every(approval => approval.stale));
  assert.equal(after.approvals.find(approval => approval.gate === 'full_narration').stale, false);
  assert.equal((await ctx.action('retry_media')).success, true);
  assert.equal((await ctx.run()).status, 'waiting_approval');
  assert.equal((await ctx.action('approve_media', { confirmed: true })).success, true);
  assert.equal((await ctx.run()).status, 'waiting_approval');
  assert.equal((await ctx.action('approve_media', { confirmed: true })).success, true);
  assert.equal((await ctx.run()).status, 'waiting_approval');
  assert.equal(ctx.imageCalls.get('scene_2'), 1);
  assert.equal(ctx.calls.get('scene_2'), 1);
  assert.equal(ctx.renderCalls.get('scene_2'), 1);
  assert.equal(ctx.imageCalls.get('scene_1'), 2);
  assert.equal(ctx.calls.get('scene_1'), 2);
  assert.equal(ctx.renderCalls.get('scene_1'), 2);
  console.log('PASS 只重做编辑幕及其下游，其他幕、旁白与对应文件持续复用');
}

async function testInFlight({ unknown = false, downstream = false } = {}) {
  const ctx = await fixture(2, { startStage: downstream ? 'annotation_drafting' : 'lineart_generation' });
  const frozen = (await view(ctx)).whiteboard.media.lineartPromptDetails.scene_1;
  const arrived = deferred(); const release = deferred();
  let count = 0;
  ctx[downstream ? 'beforeVision' : 'beforeImage'] = async () => {
    if (++count === 2) arrived.resolve();
    await release.promise;
  };
  if (unknown) ctx.imageFaults.set('scene_1', 'unknown');
  const running = ctx.run();
  try {
    await deadline(arrived.promise);
    const result = await save(ctx, 'scene_1', editedPrompt('scene_1'), { expectedPromptIdentity: frozen.identity });
    assert.equal(result.success, true, result.message);
    assert.equal(result.startTask, false);
    assert.equal(result.workflow.status, 'running');
    assert.equal(result.workflow.whiteboard.media.lineartPromptDetails.scene_1.pending, true);
    const record = await ctx.read();
    assert.equal(record.whiteboard.media.lineartPrompts?.scene_1, undefined, '在途请求仍使用冻结输入');
    assert.equal(record.whiteboard.media.pendingLineartPrompts.scene_1.imagePrompt, editedPrompt('scene_1'), '排队编辑已经持久化');
    assert.equal(ctx.imageCalls.get('scene_1'), 1);
    if (!unknown && !downstream) {
      const recovered = structuredClone(record);
      production.recover(recovered, new Date().toISOString());
      assert.equal(recovered.status, 'unknown_external_outcome', '重启不能把在途请求当作普通失败');
      assert.equal(recovered.whiteboard.media.lineartPrompts.scene_1, editedPrompt('scene_1'), '重启保留已保存的编辑');
      assert.equal(recovered.whiteboard.media.pendingLineartPrompts.scene_1, undefined);
      assert.ok(!production.actionsFor(recovered).some(action => action.id === 'retry_media'));
    }
  } finally { release.resolve(); }
  const finished = await deadline(running);
  const after = await ctx.read();
  assert.equal(after.whiteboard.media.lineart.scene_1, undefined, '旧请求不能成为修改后的当前图');
  assert.ok(after.whiteboard.media.lineart.scene_2);
  assert.equal(after.whiteboard.media.current.lineart_generation, undefined);
  assert.equal(after.whiteboard.media.executionId, '');
  assert.equal(ctx.imageCalls.get('scene_1'), 1, '保存及本轮结束不会自动追加生图');
  assert.equal((await view(ctx)).whiteboard.media.lineartPromptDetails.scene_1.pending, false);
  if (unknown) {
    assert.equal(finished.code, 'UNKNOWN_EXTERNAL_OUTCOME');
    assert.equal(after.status, 'unknown_external_outcome');
    assert.equal((await ctx.action('retry_media')).code, 'ACTION_NOT_ALLOWED');
    assert.equal((await save(ctx, 'scene_1', `${editedPrompt('scene_1')}保留更多留白。`)).success, true);
    assert.equal((await ctx.read()).status, 'unknown_external_outcome', '保存不能隐式授权未知结果重试');
    assert.equal((await ctx.action('authorize_media_retry')).code, 'EXTERNAL_AUTH_REQUIRED');
    ctx.imageFaults.clear();
    assert.equal((await ctx.action('authorize_media_retry', { confirmed: true })).success, true);
  } else {
    assert.equal(finished.status, 'waiting_approval');
    const completed = after.whiteboard.media.attempts.find(attempt => attempt.stage === (downstream ? 'annotation_drafting' : 'lineart_generation') && attempt.sceneId === 'scene_1');
    assert.equal(completed.status, 'validated', '旧请求结果保留供审计');
    assert.ok(completed.received[downstream ? 'annotation' : 'rawImage']);
    assert.equal((await ctx.action('retry_media')).success, true);
  }
  assert.equal((await ctx.run()).status, 'waiting_approval');
  assert.ok(ctx.imageRequests.at(-1).prompt.includes(editedPrompt('scene_1')));
  assert.equal(ctx.imageCalls.get('scene_1'), 2);
  assert.equal(ctx.imageCalls.get('scene_2'), 1);
  console.log(`PASS ${unknown ? '未知外部结果' : downstream ? '落墨在途' : '生图在途'}期间保存：保留原请求，应用编辑后等待明确继续`);
}

async function main() {
  configureWhiteboardConcurrency({ imageConcurrency: 3, annotationConcurrency: 3, renderConcurrency: 3 });
  await testQueuedAndRejected();
  await testDownstreamInvalidation();
  await testInFlight();
  await testInFlight({ unknown: true });
  await testInFlight({ downstream: true });
  console.log('线稿提示词定向回归通过；真实模型请求 0。');
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
