const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const workflows = require('../server/services/creative/creativeWorkflows');
const store = require('../server/services/creative/workflowStore');
const tasks = require('../server/services/creative/creativeWorkflowTasks');
const { createCreativeTaskRegistry } = require('../server/services/creative/creativeTaskRegistry');
const router = require('../server/routes/creativeWorkflows');
const { normalizeInput, parseSrt, validateCandidate, materializeCandidate, sha256 } = require('../server/services/creative/whiteboard/contracts');

const TOPIC = { inputMode: 'topic', content: '为什么我们会拖延', rewritePolicy: 'generate', targetDurationSeconds: 60, narrationLanguage: 'zh-CN', visualStylePreset: 'warm-paper-minimal-v1' };
const SRT = '1\n00:00:01,000 --> 00:00:04,000\n先把任务拆小。\n\n2\n00:00:04,500 --> 00:00:08,000\n从一个具体动作开始。';

function candidateFor(request, title = '从一个小动作开始') {
  const input = JSON.parse(request.messages[1].content).input;
  const cues = input.inputMode === 'srt' ? parseSrt(input.content).map(({ id, text }) => ({ id, text }))
    : [{ id: 'cue_1', text: input.inputMode === 'text' ? input.content : '面对复杂任务时，我们常常先寻找更容易的事情。把任务拆成一个今天就能完成的小动作，开始就会变得具体。' }];
  return {
    schemaVersion: 1, title, summary: '先解释拖延的感受，再用一个具体的小动作说明如何开始。', cues,
    scenes: cues.map((cue, index) => ({ id: `scene_${index + 1}`, title: `开始行动 ${index + 1}`, cueIds: [cue.id], imagePrompt: '暖米黄纸张上，一个人把大纸张拆成三张小纸条，粗黑轮廓和少量平涂，主体分离，四周留白。' })),
  };
}

async function fixture(run) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-whiteboard-test-'));
  let nextId = 0;
  const ctx = { rootDir, modelCalls: [], mediaCalls: 0, response: null };
  const forbidden = async () => { ctx.mediaCalls += 1; throw new Error('禁止在阶段 0 调用媒体生产'); };
  ctx.options = {
    rootDir, mediaRoot: path.join(rootDir, 'media'),
    services: {
      idFactory: () => `20260911090000${String(++nextId).padStart(6, '0')}`,
      aiModelConfig: { getRuntimeConfig: async () => ({ enabled: true, apiKey: 'fixture-placeholder', baseUrl: 'http://fixture.invalid', modelId: 'fixture-text' }) },
      aiTextModel: { callTextModel: async request => {
        ctx.modelCalls.push(request);
        assert.equal(request.maxRetries, 0);
        assert.equal(request.tools, undefined);
        assert.equal(request.fallbackToNonStreamOnGatewayTimeout, false);
        return ctx.response ? ctx.response(request) : { success: true, text: JSON.stringify(candidateFor(request)) };
      } },
      fetchImpl: forbidden,
      agentRuns: new Proxy({}, { get: () => forbidden }),
      ttsService: new Proxy({}, { get: () => forbidden }),
    },
  };
  ctx.create = async (input = TOPIC, productionPlan = {}) => {
    const result = await workflows.createCreativeWorkflow({ creationModeId: 'whiteboard-stream-v1', input, productionPlan }, ctx.options);
    assert.equal(result.success, true, result.message);
    return result.workflow_id;
  };
  ctx.read = async id => (await workflows.getCreativeWorkflow(id, ctx.options)).data;
  ctx.action = async (id, action, extra = {}, version) => {
    const record = version || await ctx.read(id);
    return workflows.actOnWhiteboardWorkflow(id, {
      action, expectedIdentity: record.whiteboard.current?.identity || '',
      expectedAttemptId: record.whiteboard.attempts.at(-1).id, ...extra,
    }, ctx.options);
  };
  ctx.bound = {
    createCreativeWorkflow: payload => workflows.createCreativeWorkflow(payload, ctx.options),
    runCreativeWorkflow: (id, options) => workflows.runCreativeWorkflow(id, { ...options, ...ctx.options }),
    getCreativeWorkflow: (id, options) => workflows.getCreativeWorkflow(id, { ...options, ...ctx.options }),
    patchCreativeWorkflowTaskSummary: (id, patch) => workflows.patchCreativeWorkflowTaskSummary(id, patch, ctx.options),
    listCreativeWorkflowRecords: () => workflows.listCreativeWorkflowRecords(ctx.options),
    actOnWhiteboardWorkflow: (id, payload) => workflows.actOnWhiteboardWorkflow(id, payload, ctx.options),
    getWhiteboardArtifact: (id, attemptId) => workflows.getWhiteboardArtifact(id, attemptId, ctx.options),
    getCreativeWorkflowHtmlVideoProject: id => workflows.getCreativeWorkflowHtmlVideoProject(id, ctx.options),
    exportHtmlVideoProject: (id, payload) => workflows.exportHtmlVideoProject(id, payload, ctx.options),
    refreshCreativeWorkflowRetryPlan: id => workflows.refreshCreativeWorkflowRetryPlan(id, ctx.options),
  };
  try { await run(ctx); assert.equal(ctx.mediaCalls, 0, '阶段 0 不应发起任何媒体或网络兜底调用'); }
  finally {
    assert.equal(path.dirname(rootDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(rootDir).startsWith('musedock-whiteboard-test-'));
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function waitUntil(predicate) {
  for (let index = 0; index < 500; index += 1) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('等待隔离任务超时');
}

const cases = [
  ['输入合同同时拒绝错误路由、时间轴和未知模板', async () => {
    for (const input of [
      { ...TOPIC, rewritePolicy: 'preserve' }, { ...TOPIC, inputMode: 'text' },
      { ...TOPIC, targetDurationSeconds: 14 }, { ...TOPIC, targetDurationSeconds: 601 },
      { ...TOPIC, visualStylePreset: 'auto' }, { ...TOPIC, narrationLanguage: 'ja-JP' },
      { ...TOPIC, aspectRatio: '1:1' },
      { ...TOPIC, approval: true }, { inputMode: 'srt', content: SRT, rewritePolicy: 'preserve' },
      { inputMode: 'srt', content: SRT.replace('00:00:04,500', '00:00:03,000') },
    ]) assert.throws(() => normalizeInput(input));
    assert.equal(normalizeInput({ ...TOPIC }).rewritePolicy, 'generate');
    assert.equal(normalizeInput({ ...TOPIC }).aspectRatio, '16:9');
  }],
  ['竖屏画幅随方案冻结且旧输入默认横屏', () => fixture(async ctx => {
    const id = await ctx.create({ ...TOPIC, aspectRatio: '9:16' });
    await workflows.runCreativeWorkflow(id, ctx.options);
    const view = await ctx.read(id);
    assert.equal(view.input.aspectRatio, '9:16');
    assert.equal(view.whiteboard.current.artifact.aspectRatio, '9:16');
    assert.deepEqual(view.whiteboard.current.artifact.canvas, { width: 1080, height: 1920 });
    assert.match(ctx.modelCalls[0].messages[0].content, /1080×1920/);
    const switched = await ctx.action(id, 'revise', { message: '改为横屏', input: { aspectRatio: '16:9' } });
    assert.equal(switched.code, 'ASPECT_RATIO_LOCKED');
    assert.equal((await ctx.read(id)).whiteboard.current.identity, view.whiteboard.current.identity);
  })],
  ['候选不能自行批准，正文和字幕必须完整覆盖', async () => {
    const input = normalizeInput({ ...TOPIC, inputMode: 'text', rewritePolicy: 'preserve', content: 'Keep every word. 保留每个字。' });
    const candidate = candidateFor({ messages: [{}, { content: JSON.stringify({ input }) }] });
    assert.deepEqual(validateCandidate(candidate, input), []);
    assert.ok(validateCandidate({ ...candidate, approval: true }, input).length);
    assert.ok(validateCandidate({ ...candidate, cues: [{ id: 'cue_1', text: 'Keep everyword. 保留每个字。' }] }, input).length);
    assert.ok(validateCandidate({ ...candidate, scenes: [{ ...candidate.scenes[0], cueIds: ['missing'] }] }, input).length);
  }],
  ['长短字幕混合时估算时间连续且没有零长度 cue', async () => {
    const input = normalizeInput({ ...TOPIC, targetDurationSeconds: 15 });
    const candidate = candidateFor({ messages: [{}, { content: JSON.stringify({ input }) }] });
    candidate.cues = Array.from({ length: 400 }, (_, index) => ({ id: `cue_${index + 1}`, text: index < 16 ? '长'.repeat(3000) : '短' }));
    candidate.scenes = [{ ...candidate.scenes[0], cueIds: candidate.cues.map(cue => cue.id) }];
    const artifact = materializeCandidate(candidate, input, {});
    assert.equal(artifact.cues[0].startMs, 0);
    assert.equal(artifact.cues.at(-1).endMs, 15000);
    artifact.cues.forEach((cue, index) => {
      assert.ok(cue.endMs > cue.startMs);
      assert.equal(cue.startMs, index ? artifact.cues[index - 1].endMs : 0);
    });
  }],
  ['模式冻结，草案校验后停在待确认，批准后停在阶段 0', () => fixture(async ctx => {
    const id = await ctx.create();
    const before = await ctx.read(id);
    assert.equal(before.creationModeId, 'whiteboard-stream-v1');
    assert.deepEqual(before.stages.map(stage => stage.id), ['intake', 'content_plan', 'initial_approval']);
    assert.equal((await ctx.action(id, 'approve_initial', { confirmed: true })).success, false);
    const result = await workflows.runCreativeWorkflow(id, ctx.options);
    assert.equal(result.status, 'waiting_approval', result.message);
    assert.equal(result.whiteboard.initialApproval, null);
    assert.equal(result.whiteboard.current.artifact.timingKind, 'provisional');
    assert.equal((await ctx.action(id, 'approve_initial')).code, 'APPROVAL_REQUIRED');
    const approved = await ctx.action(id, 'approve_initial', { confirmed: true });
    assert.equal(approved.workflow.status, 'phase0_complete');
    assert.equal(approved.workflow.whiteboard.initialApproval.identity, result.whiteboard.current.identity);
    assert.equal(approved.workflow.whiteboard.pendingInitialApproval, false);
    assert.equal(ctx.modelCalls.length, 1);
    assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).success, false);
    assert.equal((await ctx.read(id)).status, 'phase0_complete');
  })],
  ['后台 task 完成不能把待确认或已批准状态改成视频完成', () => fixture(async ctx => {
    const id = await ctx.create();
    const registry = createCreativeTaskRegistry();
    const started = await tasks.startCreativeWorkflowTask(id, { registry, rootDir: ctx.rootDir, services: { creativeWorkflows: ctx.bound } });
    await waitUntil(() => registry.getTask(started.task_id)?.status === 'done');
    assert.equal((await ctx.read(id)).status, 'waiting_approval');
    assert.equal((await ctx.read(id)).current_progress, 75);
    await ctx.action(id, 'approve_initial', { confirmed: true });
    await ctx.bound.patchCreativeWorkflowTaskSummary(id, { task_status: 'done', status: 'done', message: '视频已完成', current_progress: 100 });
    assert.equal((await ctx.read(id)).status, 'phase0_complete');
    assert.match((await ctx.read(id)).message, /内容与制作方案已确认/);
  })],
  ['修改保留旧文件，旧批准失效，过期页面不能批准新版', () => fixture(async ctx => {
    const id = await ctx.create();
    await workflows.runCreativeWorkflow(id, ctx.options);
    const first = await ctx.read(id);
    const oldPath = path.join(ctx.rootDir, 'whiteboard-artifacts', id, first.whiteboard.current.attemptId, 'content-plan.json');
    const oldHash = sha256(await fs.readFile(oldPath, 'utf8'));
    await ctx.action(id, 'approve_initial', { confirmed: true });
    ctx.response = request => ({ success: true, text: JSON.stringify(candidateFor(request, '先迈出具体的一步')) });
    assert.equal((await ctx.action(id, 'revise', { message: '把标题改得更具体一些。' })).startTask, true);
    assert.equal((await ctx.read(id)).whiteboard.initialApproval, null);
    await workflows.runCreativeWorkflow(id, ctx.options);
    const second = await ctx.read(id);
    assert.equal(second.whiteboard.attempts.length, 2);
    assert.notEqual(second.whiteboard.current.identity, first.whiteboard.current.identity);
    assert.equal(second.whiteboard.approvals[0].stale, true);
    assert.equal(sha256(await fs.readFile(oldPath, 'utf8')), oldHash);
    assert.equal((await ctx.action(id, 'approve_initial', { confirmed: true }, first)).code, 'STALE_IDENTITY');
    const historical = await workflows.getWhiteboardArtifact(id, first.whiteboard.current.attemptId, ctx.options);
    assert.equal(historical.current, false);
    assert.equal(historical.artifact.title, first.whiteboard.current.artifact.title);
  })],
  ['制作设置只生成本地新版本，不额外调用模型', () => fixture(async ctx => {
    const id = await ctx.create();
    await workflows.runCreativeWorkflow(id, ctx.options);
    const first = await ctx.read(id);
    await ctx.action(id, 'update_plan', { productionPlan: { handDisplayMode: 'hide', agentApprovalEnabled: true } });
    const next = await workflows.runCreativeWorkflow(id, ctx.options);
    assert.equal(next.status, 'waiting_approval');
    assert.equal(next.whiteboard.current.artifact.productionPlan.handDisplayMode, 'hide');
    assert.equal(next.whiteboard.current.artifact.narrationText, first.whiteboard.current.artifact.narrationText);
    assert.equal(next.whiteboard.initialApproval, null);
    assert.equal(ctx.modelCalls.length, 1);
  })],
  ['BGM 选择随方案保存，切换使旧批准失效且不调用媒体或额外内容模型', () => fixture(async ctx => {
    const id = await ctx.create(TOPIC, { bgmMode: 'enabled' });
    await workflows.runCreativeWorkflow(id, ctx.options);
    const first = await ctx.read(id);
    assert.equal(first.whiteboard.current.artifact.productionPlan.bgmMode, 'enabled');
    await ctx.action(id, 'approve_initial', { confirmed: true });
    await ctx.action(id, 'update_plan', { productionPlan: { bgmMode: 'disabled' } });
    const next = await workflows.runCreativeWorkflow(id, ctx.options);
    assert.equal(next.status, 'waiting_approval');
    assert.equal(next.whiteboard.current.artifact.productionPlan.bgmMode, 'disabled');
    assert.notEqual(next.whiteboard.current.identity, first.whiteboard.current.identity);
    assert.equal(next.whiteboard.initialApproval, null);
    assert.equal(next.whiteboard.approvals[0].stale, true);
    assert.equal(next.whiteboard.current.artifact.narrationText, first.whiteboard.current.artifact.narrationText);
    assert.equal(ctx.modelCalls.length, 1);
    assert.equal((await ctx.action(id, 'approve_initial', { confirmed: true }, first)).code, 'STALE_IDENTITY');
  })],
  ['SRT 使用原始字幕与真实输入时间，不接受模型改写', () => fixture(async ctx => {
    const id = await ctx.create({ inputMode: 'srt', content: SRT, narrationLanguage: 'zh-CN', visualStylePreset: 'warm-pencil-v1' });
    const result = await workflows.runCreativeWorkflow(id, ctx.options);
    assert.equal(result.status, 'waiting_approval', result.message);
    assert.deepEqual(result.whiteboard.current.artifact.cues, parseSrt(SRT));
    assert.equal(result.whiteboard.current.artifact.durationMs, 8000);
    assert.equal(result.whiteboard.attempts[0].role, 'storyboardPlanning');
  })],
  ['完整错误清单只补正一次，仍不合法就失败', () => fixture(async ctx => {
    ctx.response = () => ({ success: true, text: JSON.stringify({ schemaVersion: 2, approval: true }) });
    const id = await ctx.create();
    const result = await workflows.runCreativeWorkflow(id, ctx.options);
    assert.equal(result.success, false);
    assert.equal(result.code, 'CANDIDATE_INVALID');
    assert.equal(ctx.modelCalls.length, 2);
    assert.match(ctx.modelCalls[1].messages.at(-1).content, /cues/);
    assert.match(ctx.modelCalls[1].messages.at(-1).content, /scenes/);
    assert.equal((await ctx.read(id)).whiteboard.current, null);
  })],
  ['文件变化时拒绝批准与历史读取', () => fixture(async ctx => {
    const id = await ctx.create();
    await workflows.runCreativeWorkflow(id, ctx.options);
    const ready = await ctx.read(id);
    const artifactPath = path.join(ctx.rootDir, 'whiteboard-artifacts', id, ready.whiteboard.current.attemptId, 'content-plan.json');
    await fs.appendFile(artifactPath, ' ');
    assert.equal((await ctx.action(id, 'approve_initial', { confirmed: true }, ready)).code, 'ARTIFACT_INVALID');
    const view = await ctx.read(id);
    assert.equal(view.whiteboard.allowedActions.length, 0);
    assert.equal(view.whiteboard.initialApproval, null);
  })],
  ['请求结果不明时普通重试被拦截，明确授权才新建 attempt', () => fixture(async ctx => {
    ctx.response = () => { throw new Error('fixture timeout'); };
    const id = await ctx.create();
    const result = await workflows.runCreativeWorkflow(id, ctx.options);
    assert.equal(result.status, 'unknown_external_outcome');
    assert.equal((await ctx.action(id, 'retry')).code, 'ACTION_NOT_ALLOWED');
    assert.equal((await ctx.action(id, 'authorize_new_attempt')).code, 'EXTERNAL_AUTH_REQUIRED');
    assert.equal(ctx.modelCalls.length, 1);
    ctx.response = null;
    await ctx.action(id, 'authorize_new_attempt', { confirmed: true });
    assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).status, 'waiting_approval');
    assert.equal(ctx.modelCalls.length, 2);
  })],
  ['服务重启保留待确认，处理中请求恢复为未知结果', () => fixture(async ctx => {
    const id = await ctx.create();
    const record = await store.readWorkflow(id, ctx.rootDir);
    record.status = 'running';
    record.task_status = 'running';
    record.active_task_id = 'orphaned-fixture-task';
    record.whiteboard.attempts[0].status = 'requesting';
    await store.persistWorkflow(record, ctx.rootDir);
    await tasks.recoverOrphanedWorkflows({ rootDir: ctx.rootDir, registry: createCreativeTaskRegistry(), creativeWorkflows: ctx.bound });
    assert.equal((await ctx.read(id)).status, 'unknown_external_outcome');
    assert.equal(ctx.modelCalls.length, 0);
    const readyId = await ctx.create();
    await workflows.runCreativeWorkflow(readyId, ctx.options);
    await tasks.recoverOrphanedWorkflows({ rootDir: ctx.rootDir, registry: createCreativeTaskRegistry(), creativeWorkflows: ctx.bound });
    assert.equal((await ctx.read(readyId)).status, 'waiting_approval');
  })],
  ['并发重复执行和操作不会生成两次模型请求', () => fixture(async ctx => {
    let release;
    const blocker = new Promise(resolve => { release = resolve; });
    ctx.response = async request => { await blocker; return { success: true, text: JSON.stringify(candidateFor(request)) }; };
    const id = await ctx.create();
    const first = workflows.runCreativeWorkflow(id, ctx.options);
    await waitUntil(() => ctx.modelCalls.length === 1);
    assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).success, false);
    assert.equal((await ctx.read(id)).status, 'running');
    release();
    assert.equal((await first).status, 'waiting_approval');
    const version = await ctx.read(id);
    const results = await Promise.all([ctx.action(id, 'revise', { message: '更具体。' }, version), ctx.action(id, 'revise', { message: '再具体。' }, version)]);
    assert.equal(results.filter(result => result.success).length, 1);
    assert.equal(ctx.modelCalls.length, 1);
  })],
  ['删除进行中的任务后，晚到的模型响应不能重建任务或产物', () => fixture(async ctx => {
    let release;
    const blocker = new Promise(resolve => { release = resolve; });
    ctx.response = async request => { await blocker; return { success: true, text: JSON.stringify(candidateFor(request)) }; };
    const id = await ctx.create();
    const running = workflows.runCreativeWorkflow(id, ctx.options);
    try {
      await waitUntil(() => ctx.modelCalls.length === 1);
      assert.equal((await workflows.deleteCreativeWorkflow(id, ctx.options)).success, true);
      release();
      assert.equal((await running).status, 'deleted');
      await assert.rejects(fs.stat(store.getWorkflowPath(id, ctx.rootDir)), { code: 'ENOENT' });
      await assert.rejects(fs.stat(path.join(ctx.rootDir, 'whiteboard-artifacts', id)), { code: 'ENOENT' });
    } finally { release(); await running; }
  })],
  ['详情页超时恢复不能用旧快照重建已删除任务', () => fixture(async ctx => {
    const id = await ctx.create();
    const record = await store.readWorkflow(id, ctx.rootDir);
    record.status = 'running';
    record.whiteboard.attempts[0].status = 'requesting';
    record.stages.find(stage => stage.id === 'content_plan').status = 'running';
    record.stages.find(stage => stage.id === 'content_plan').updated_at = '2026-09-11T08:00:00.000Z';
    await store.persistWorkflow(record, ctx.rootDir);
    let releaseQueue;
    let enteredQueue;
    let observedSnapshot;
    const blocker = new Promise(resolve => { releaseQueue = resolve; });
    const entered = new Promise(resolve => { enteredQueue = resolve; });
    const observed = new Promise(resolve => { observedSnapshot = resolve; });
    const queue = store.withWorkflowFileQueue(store.getWorkflowPath(id, ctx.rootDir), async () => { enteredQueue(); await blocker; });
    await entered;
    const deletion = workflows.deleteCreativeWorkflow(id, ctx.options);
    const detail = workflows.getCreativeWorkflow(id, {
      ...ctx.options, staleStageTimeoutMs: 1,
      services: { ...ctx.options.services, now: () => { observedSnapshot(); return '2026-09-11T08:01:00.000Z'; } },
    });
    try {
      await observed;
      releaseQueue();
      assert.equal((await deletion).success, true);
      assert.equal((await detail).success, false);
      await assert.rejects(fs.stat(store.getWorkflowPath(id, ctx.rootDir)), { code: 'ENOENT' });
    } finally { releaseQueue(); await Promise.allSettled([queue, deletion, detail]); }
  })],
  ['旧任务只读兼容，白板即使批准也不能进入媒体或旧恢复入口', () => fixture(async ctx => {
    const legacyId = '202609110000000001';
    const legacyPath = store.getWorkflowPath(legacyId, ctx.rootDir);
    const original = JSON.stringify({ workflow_id: legacyId, status: 'done', stages: store.createStages(), input: { raw_text: '旧任务' } });
    await fs.writeFile(legacyPath, original);
    const legacy = await workflows.getCreativeWorkflow(legacyId, ctx.options);
    assert.equal(legacy.data.creationModeId, 'hyperframes-v1');
    assert.equal(await fs.readFile(legacyPath, 'utf8'), original);
    const id = await ctx.create();
    await workflows.runCreativeWorkflow(id, ctx.options);
    await ctx.action(id, 'approve_initial', { confirmed: true });
    for (const result of await Promise.all([
      workflows.getCreativeWorkflowHtmlVideoProject(id, ctx.options),
      workflows.refreshCreativeWorkflowRetryPlan(id, ctx.options),
      workflows.exportHtmlVideoProject(id, {}, ctx.options),
    ])) assert.equal(result.code, 'MODE_ACTION_UNSUPPORTED');
  })],
  ['真实 HTTP 路由完成创建、待确认、批准与拒绝非法 action', () => fixture(async ctx => {
    const app = express();
    app.use(express.json());
    const registry = createCreativeTaskRegistry();
    app.locals.creativeWorkflows = ctx.bound;
    app.locals.creativeTaskRegistry = registry;
    app.use('/api/creative-workflows', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/creative-workflows`;
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      assert.equal((await (await fetch(`${base}/modes`)).json()).modes.length, 2);
      const response = await post(base, { creationModeId: 'whiteboard-stream-v1', input: TOPIC });
      assert.equal(response.status, 202);
      const created = await response.json();
      await waitUntil(() => registry.getTask(created.task_id)?.status === 'done');
      const dto = await (await fetch(`${base}/${created.workflow_id}`)).json();
      assert.equal(dto.status, 'waiting_approval');
      assert.equal(dto.input, TOPIC.content);
      const version = dto.workflow.whiteboard;
      const versionArgs = { expectedIdentity: version.current.identity, expectedAttemptId: version.attempts.at(-1).id };
      assert.equal((await post(`${base}/${created.workflow_id}/whiteboard/actions`, { action: 'generate_audio', ...versionArgs })).status, 409);
      const approved = await post(`${base}/${created.workflow_id}/whiteboard/actions`, { action: 'approve_initial', confirmed: true, ...versionArgs });
      assert.equal(approved.status, 200);
      assert.equal((await approved.json()).workflow.status, 'phase0_complete');
      assert.equal((await post(`${base}/${created.workflow_id}/html-video-project/export`, {})).status, 409);
    } finally { await new Promise(resolve => server.close(resolve)); }
  })],
];

(async () => {
  for (const [name, run] of cases) { await run(); console.log(`PASS ${name}`); }
  console.log(`白板阶段 0：${cases.length} 项验证通过；使用隔离存储和模型替身。`);
})().catch(error => { console.error(error); process.exitCode = 1; });
