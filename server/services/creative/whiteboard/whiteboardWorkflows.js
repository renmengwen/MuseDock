const crypto = require('crypto');
const {
  DEFAULT_ROOT, getWorkflowPath, readWorkflow, persistWorkflowUnlocked,
  withWorkflowFileQueue, createStages, makeId, getNow, workflowFileExists,
} = require('../workflowStore');
const { WHITEBOARD_MODE, createModeSnapshot } = require('../creationModes');
const {
  CONTRACT_VERSION, SKILL_SOURCE_REVISION, candidateContractFor, WhiteboardError,
  normalizeInput, normalizeProductionPlan, canonicalJson, sha256, materializeCandidate,
} = require('./contracts');
const artifactStore = require('./artifactStore');
const { generateDraft } = require('./structuredDraft');
const production = require('./productionWorkflows');
const mediaStore = require('./mediaStore');
const agentRouter = require('./agentRouter');
const { scenePrompt } = require('./lineartPrompts');

function assertContract(record) {
  if (record.creationModeId !== WHITEBOARD_MODE) throw new WhiteboardError('MODE_ACTION_UNSUPPORTED', '该操作仅适用于线稿白板动画。', 409);
  if (record.creationModeContractVersion !== 1 || record.skillContractVersion !== CONTRACT_VERSION
    || record.skillSourceRevision !== SKILL_SOURCE_REVISION
    || canonicalJson(record.stageSchemaSnapshot) !== canonicalJson(createModeSnapshot(WHITEBOARD_MODE).stageSchemaSnapshot)) {
    throw new WhiteboardError('CONTRACT_UNSUPPORTED', '此任务使用的白板合同版本暂不兼容，请保留原任务并创建新任务。', 409);
  }
  production.assertMediaContract(record.whiteboard?.media);
}

function addMessage(record, role, text, now, attemptId = '') {
  record.whiteboard.messages.push({ id: crypto.randomUUID(), role, text, createdAt: now, attemptId });
}

function setStage(record, id, status, message, now) {
  record.stages = record.stages.map(stage => stage.id === id
    ? { ...stage, status, message, updated_at: now, ...(status === 'done' ? { completed_at: now } : {}) }
    : stage);
}

function prepareAttempt(record, { input, productionPlan, revisionMessage = '', kind = 'model' }, now) {
  const attempt = {
    id: crypto.randomUUID(), number: record.whiteboard.attempts.length + 1,
    role: input.inputMode === 'srt' ? 'storyboardPlanning' : 'contentDrafting',
    kind, status: 'prepared', createdAt: now, input, productionPlan, revisionMessage,
    parentIdentity: record.whiteboard.current?.identity || '',
    inputIdentity: sha256({ contractVersion: CONTRACT_VERSION, input, productionPlan, narrationService: record.whiteboard.narrationService }),
  };
  record.whiteboard.attempts.push(attempt);
  record.whiteboard.activeAttemptId = attempt.id;
  record.whiteboard.pendingInitialApproval = true;
  if (record.whiteboard.current) record.whiteboard.current.stale = true;
  record.whiteboard.approvals.forEach(approval => { approval.stale = true; });
  record.whiteboard.initialApproval = null;
  if (record.whiteboard.media) {
    record.whiteboard.media.stale = true;
    record.whiteboard.media.approvals.forEach(approval => { approval.stale = true; });
  }
  record.whiteboard.interactions?.filter(item => item.status === 'pending').forEach(item => { item.status = 'superseded'; });
  record.result = null;
  record.success = true;
  record.status = 'queued';
  record.current_stage = 'content_plan';
  record.current_progress = 10;
  record.message = kind === 'settings' ? '正在更新制作方案...' : '正在准备白板内容与制作方案...';
  record.current_stage_message = record.message;
  record.last_event_seq = 0;
  record.error = null;
  record.updated_at = now;
  setStage(record, 'content_plan', 'queued', record.message, now);
  setStage(record, 'initial_approval', 'pending', '等待当前内容与制作方案生成。', now);
  return attempt;
}

async function mutate(workflowId, options, handler) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  return withWorkflowFileQueue(getWorkflowPath(workflowId, rootDir), async () => {
    const record = await readWorkflow(workflowId, rootDir);
    assertContract(record);
    const result = await handler(record, getNow(options.services));
    await persistWorkflowUnlocked(record, rootDir);
    return { record, result };
  });
}

function actionsFor(record, artifactValid = true) {
  if (!artifactValid) return [];
  const mediaActions = production.actionsFor(record);
  if (['queued', 'running'].includes(record.status)) return mediaActions || [];
  if (record.whiteboard.media && !record.whiteboard.media.stale && mediaActions) return [
    ...mediaActions,
    ...(!record.whiteboard.media.executionId && ['waiting_approval', 'failed', 'done'].includes(record.status)
      ? [{ id: 'update_plan', label: '调整制作设置' }, { id: 'revise', label: '修改内容与分镜' }] : []),
  ];
  if (record.status === 'unknown_external_outcome') return [{ id: 'authorize_new_attempt', label: '确认后重新请求', requiresConfirmation: true }];
  if (record.status === 'failed') return [{ id: 'retry', label: '重新生成方案' }];
  const actions = [{ id: 'revise', label: '生成修改版' }, { id: 'update_plan', label: '调整制作设置' }];
  if (record.status === 'waiting_approval' && record.whiteboard.current && !record.whiteboard.current.stale) {
    actions.unshift({ id: 'approve_initial', label: '确认内容与制作方案', requiresConfirmation: true });
  }
  return ['waiting_approval', 'phase0_complete'].includes(record.status) ? [...(mediaActions || []), ...actions] : [];
}

async function getView(record, options = {}) {
  const view = structuredClone(record);
  let valid = true;
  try {
    assertContract(record);
    if (record.whiteboard.current) view.whiteboard.current.artifact = await artifactStore.readArtifact(record, record.whiteboard.current, options.rootDir);
  } catch (error) {
    valid = false;
    view.whiteboard.artifactError = error instanceof WhiteboardError ? error.message : '读取白板方案失败，请检查本地文件。';
  }
  view.whiteboard.allowedActions = actionsFor(record, valid);
  view.whiteboard.media = mediaStore.publicMedia(record);
  if (valid && view.whiteboard.media && !view.whiteboard.media.stale && view.whiteboard.current?.artifact) {
    view.whiteboard.media.lineartPromptDetails = Object.fromEntries(view.whiteboard.current.artifact.scenes
      .map(scene => [scene.id, scenePrompt(record.whiteboard.media, scene)]));
  }
  if (record.whiteboard.media && !record.whiteboard.media.stale) view.stages.push(...structuredClone(record.whiteboard.media.stages));
  // 候选执行输入保存在磁盘审计中；页面历史只需要版本、状态和绑定，不回灌全部正文。
  view.whiteboard.attempts = record.whiteboard.attempts.map(({ input, productionPlan, revisionMessage, ...attempt }) => attempt);
  return view;
}

async function createWhiteboardWorkflow(payload, options = {}) {
  const sharedDefaults = await options.services?.appSettings?.getProductionDefaults?.(options) || {};
  const input = normalizeInput({
    ...Object.fromEntries(['aspectRatio', 'narrationLanguage', ...(payload.input?.inputMode === 'srt' ? [] : ['targetDurationSeconds'])]
      .filter(key => sharedDefaults[key] !== undefined).map(key => [key, sharedDefaults[key]])),
    ...payload.input,
  });
  const productionPlan = normalizeProductionPlan({
    ...Object.fromEntries(['narrationMode', 'bgmMode', 'burnSubtitles', 'subtitleColor', 'subtitleFontSize']
      .filter(key => sharedDefaults[key] !== undefined).map(key => [key, sharedDefaults[key]])),
    ...payload.productionPlan,
  });
  if ((payload.assetIds?.length || payload.asset_ids?.length) || payload.skipValidation === true) throw new WhiteboardError('INVALID_INPUT', '白板阶段 0 不接受上传素材或跳过校验，请使用白板输入表单。');
  const now = getNow(options.services);
  const workflowId = String(options.services?.idFactory?.() || makeId(now));
  const snapshot = createModeSnapshot(WHITEBOARD_MODE);
  const { service: narrationService } = await production.voiceSnapshot(options.services);
  const record = {
    ...snapshot, skillContractVersion: CONTRACT_VERSION, skillSourceRevision: SKILL_SOURCE_REVISION,
    workflow_id: workflowId, aweme_id: '', title: input.inputMode === 'topic' ? input.content.slice(0, 80) : '白板创作',
    input, stages: createStages(snapshot.stageSchemaSnapshot), created_at: now, updated_at: now,
    active_task_id: '', active_operation_id: '', task_status: '', result: null,
    whiteboard: { schemaVersion: 1, narrationService, current: null, activeAttemptId: '', pendingInitialApproval: true, initialApproval: null, attempts: [], approvals: [], messages: [], interactions: [], actionReceipts: [] },
  };
  setStage(record, 'intake', 'done', '创作输入已校验，模式与合同已冻结。', now);
  const attempt = prepareAttempt(record, { input, productionPlan }, now);
  addMessage(record, 'user', input.content, now, attempt.id);
  const rootDir = options.rootDir || DEFAULT_ROOT;
  await withWorkflowFileQueue(getWorkflowPath(workflowId, rootDir), async () => {
    if (await workflowFileExists(workflowId, rootDir)) throw new WhiteboardError('WORKFLOW_EXISTS', '任务标识重复，请重新创建。', 409);
    await persistWorkflowUnlocked(record, rootDir);
  });
  return { success: true, ...await getView(record, options) };
}

function assertExpectedVersion(record, payload) {
  const latest = record.whiteboard.attempts.at(-1);
  if (payload.expectedAttemptId !== latest?.id || payload.expectedIdentity !== (record.whiteboard.current?.identity || '')) {
    throw new WhiteboardError('STALE_IDENTITY', '方案版本已变化，请刷新并检查当前版本后再操作。', 409);
  }
}

function assertActiveAttempt(record, attempt) {
  const active = record.whiteboard.attempts.find(item => item.id === attempt.id);
  if (record.whiteboard.activeAttemptId !== attempt.id || record.status !== 'running'
    || (record.whiteboard.current?.identity || '') !== attempt.parentIdentity
    || active?.inputIdentity !== attempt.inputIdentity) {
    throw new WhiteboardError('STALE_IDENTITY', '当前方案或输入已变化，不能发布旧候选。', 409);
  }
  return active;
}

async function actOnWhiteboardWorkflow(workflowId, payload = {}, options = {}) {
  if (payload.action === 'ask_status') {
    const record = await readWorkflow(workflowId, options.rootDir);
    assertContract(record);
    return { success: true, workflow_id: workflowId, workflow: await getView(record, options), startTask: false };
  }
  const { record, result } = await mutate(workflowId, options, async (record, now) => {
    const requestHash = sha256(payload);
    if (payload.requestId) {
      if (typeof payload.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(payload.requestId)) throw new WhiteboardError('INVALID_INPUT', '操作请求标识无效。');
      const previous = record.whiteboard.actionReceipts?.find(item => item.requestId === payload.requestId);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new WhiteboardError('REQUEST_CONFLICT', '同一请求标识不能用于不同操作。', 409);
        return false;
      }
    }
    assertExpectedVersion(record, payload);
    if (payload.action !== 'save_lineart_prompt' && payload.interactionId && !record.whiteboard.media?.interactionId) {
      const interaction = record.whiteboard.interactions?.find(item => item.id === payload.interactionId);
      if (!interaction || interaction.status !== 'pending' || interaction.expectedIdentity !== record.whiteboard.current?.identity) throw new WhiteboardError('STALE_IDENTITY', '这张卡片已被新版本替代，请使用当前卡片。', 409);
    }
    if (payload.action === 'message') {
      const text = String(payload.message || '').trim();
      if (!text || text.length > 6000) throw new WhiteboardError('INVALID_INPUT', '请输入有效消息，最多 6000 个字符。');
      if (/^(确认|通过)(当前|本版|这版)?(方案|内容与制作方案|旁白|线稿|标注|当前产物|成片|视频)[。！!\s]*$/u.test(text)) {
        payload = { ...payload, action: record.whiteboard.media?.gate ? 'approve_media' : 'approve_initial', confirmed: true };
      } else if (/为什么|为何|怎么安排|如何安排|当前状态|进度|[？?]$/u.test(text)) {
        const artifact = await artifactStore.readArtifact(record, record.whiteboard.current, options.rootDir);
        addMessage(record, 'user', text, now);
        addMessage(record, 'assistant', `${artifact.summary}\n当前共 ${artifact.scenes.length} 幕，按内容顺序安排为：${artifact.scenes.map((scene, index) => `${index + 1}. ${scene.title}`).join('；')}。${record.message}。本次讨论保留当前版本和待确认状态。`, now);
        if (payload.requestId) (record.whiteboard.actionReceipts ||= []).push({ requestId: payload.requestId, requestHash, action: 'message', acceptedAt: now });
        return false;
      } else payload = { ...payload, action: record.whiteboard.media?.gate && payload.sceneId ? 'revise_media' : 'revise' };
    }
    if (!actionsFor(record).some(action => action.id === payload.action)) throw new WhiteboardError('ACTION_NOT_ALLOWED', '当前阶段不允许此操作，请等待执行结束或刷新任务。', 409);
    if (record.whiteboard.media && !record.whiteboard.media.stale && ['update_plan', 'revise'].includes(payload.action)
      && (payload.expectedMediaIdentity !== mediaStore.mediaIdentity(record.whiteboard.media)
        || (record.whiteboard.media.interactionId && payload.interactionId !== record.whiteboard.media.interactionId))) {
      throw new WhiteboardError('STALE_IDENTITY', '媒体版本或卡片已变化，请刷新后再调整方案。', 409);
    }
    const remember = () => {
      if (payload.requestId) (record.whiteboard.actionReceipts ||= []).push({ requestId: payload.requestId, requestHash, action: payload.action, acceptedAt: now });
    };
    if (['start_production', 'save_lineart_prompt', 'approve_media', 'revise_media', 'retry_media', 'recover_annotation_preview', 'accept_low_coverage', 'authorize_media_retry', 'regenerate_narration'].includes(payload.action)) {
      const start = await production.act(record, payload, options, now); remember(); return start;
    }
    const current = record.whiteboard.current;
    if (payload.action === 'approve_initial') {
      if (payload.confirmed !== true || current?.stale) throw new WhiteboardError('APPROVAL_REQUIRED', '请检查当前内容与制作方案，并明确确认。', 409);
      const artifact = await artifactStore.readArtifact(record, current, options.rootDir);
      const approval = {
        gate: 'initial_content_plan_approval', identity: current.identity, attemptId: current.attemptId,
        artifactSha256: current.artifactSha256, productionPlanSha256: sha256(artifact.productionPlan),
        actor: 'user', approvedAt: now, stale: false,
      };
      record.whiteboard.initialApproval = approval;
      record.whiteboard.approvals.push(approval);
      record.whiteboard.pendingInitialApproval = false;
      record.status = 'phase0_complete';
      record.success = true;
      record.current_progress = 100;
      record.message = artifact.productionPlan.narrationMode === 'disabled'
        ? '内容与制作方案已确认，可以开始准备字幕与时间轴、生成线稿和最终视频。'
        : '内容与制作方案已确认，可以开始生成完整旁白、线稿和最终视频。';
      record.current_stage_message = record.message;
      record.updated_at = now;
      setStage(record, 'initial_approval', 'done', record.message, now);
      addMessage(record, 'user', '确认当前内容、分镜与制作方案。', now, current.attemptId);
      addMessage(record, 'assistant', record.message, now, current.attemptId);
      record.whiteboard.interactions?.filter(item => item.status === 'pending').forEach(item => Object.assign(item, { status: 'answered', answeredAt: now, response: '已确认本版内容与制作方案' }));
      remember();
      return false;
    }
    if (payload.action === 'authorize_new_attempt' && payload.confirmed !== true) throw new WhiteboardError('EXTERNAL_AUTH_REQUIRED', '需要明确同意新的外部请求及可能的重复费用。', 409);
    const latest = record.whiteboard.attempts.at(-1);
    const revisionMessage = payload.action === 'revise' ? String(payload.message || '').trim() : latest.revisionMessage;
    if (payload.action === 'revise' && (!revisionMessage || revisionMessage.length > 6000)) throw new WhiteboardError('INVALID_INPUT', '请输入修改意见，长度不能超过 6000 个字符。');
    const input = payload.input ? normalizeInput({ ...latest.input, ...payload.input }) : latest.input;
    if ((input.aspectRatio || '16:9') !== (latest.input.aspectRatio || '16:9')) {
      throw new WhiteboardError('ASPECT_RATIO_LOCKED', '画幅已随当前任务冻结，需要其他画幅时请开启新创作。', 409);
    }
    const productionPlan = payload.action === 'update_plan'
      ? normalizeProductionPlan({ ...latest.productionPlan, ...(payload.productionPlan || {}) }) : latest.productionPlan;
    if (payload.action === 'update_plan') await artifactStore.readArtifact(record, current, options.rootDir);
    if (payload.action === 'update_plan') record.whiteboard.narrationService = (await production.voiceSnapshot(options.services)).service;
    const kind = payload.action === 'update_plan' ? 'settings' : (payload.action === 'retry' || payload.action === 'authorize_new_attempt' ? latest.kind : 'model');
    const attempt = prepareAttempt(record, { input, productionPlan, revisionMessage, kind }, now);
    addMessage(record, 'user', payload.action === 'revise' ? revisionMessage : ({
      update_plan: '调整制作设置，并生成新的待确认版本。', retry: '重新生成内容与制作方案。',
      authorize_new_attempt: '我已确认可能产生重复费用，同意发起一次新的模型请求。',
    })[payload.action], now, attempt.id);
    remember();
    return true;
  });
  return { success: true, workflow_id: workflowId, workflow: await getView(record, options), startTask: result };
}

// ── 自然语言对话入口 ──
// 意图理解在文件锁之外执行，只有结果应用进入 mutate，避免模型请求阻塞其他操作。
async function buildDialogContext(record, options) {
  const media = record.whiteboard.media && !record.whiteboard.media.stale ? record.whiteboard.media : null;
  let artifact = null;
  try {
    artifact = record.whiteboard.current ? await artifactStore.readArtifact(record, record.whiteboard.current, options.rootDir) : null;
  } catch { artifact = null; }
  const busy = ['queued', 'running'].includes(record.status);
  const allowed = busy ? [] : actionsFor(record, true);
  return {
    phase: media ? 'production' : 'plan',
    status: record.status,
    stageLabel: media ? mediaStore.stageLabel(media, media.stage) : '',
    gateTitle: mediaStore.gateTitle(media),
    progressMessage: record.message || '',
    lastError: record.error?.message || '',
    scenes: (artifact?.scenes || []).map((scene, index) => ({
      index: index + 1, id: scene.id, title: scene.title,
      hasLineart: Boolean(media?.lineart?.[scene.id]),
      hasAnnotation: Boolean(media?.annotations?.[scene.id]),
      hasVideo: Boolean(media?.scenes?.[scene.id]),
    })),
    canReviseScenes: allowed.some(item => item.id === 'revise_media'),
    canRevisePlan: allowed.some(item => item.id === 'revise'),
  };
}

async function chatOnWhiteboardWorkflow(workflowId, payload = {}, options = {}) {
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
  const record = await readWorkflow(workflowId, options.rootDir || DEFAULT_ROOT);
  assertContract(record);
  const text = String(payload.message || '').trim();
  if (!text || text.length > 6000) throw new WhiteboardError('INVALID_INPUT', '请输入有效消息，最多 6000 个字符。');

  // 精确确认语与按钮语义等价，无需模型判断，直接走既有消息分支。
  if (/^(确认|通过)(当前|本版|这版)?(方案|内容与制作方案|旁白|线稿|标注|当前产物|成片|视频)[。！!\s]*$/u.test(text)) {
    return actOnWhiteboardWorkflow(workflowId, { ...payload, action: 'message', message: text }, options);
  }

  let context = null;
  let intent = null;
  try {
    context = await buildDialogContext(record, options);
    intent = await agentRouter.classifyIntent({
      message: text, context, services: options.services,
      onRequest: () => onEvent({ type: 'chat_phase', phase: 'intent' }),
    });
  } catch { intent = null; }
  onEvent({ type: 'chat_intent', action: intent?.action || 'legacy', sceneIds: intent?.sceneIds || [] });

  if (intent?.action === 'answer') {
    let answerText = '';
    try {
      answerText = await agentRouter.streamAnswer({
        message: text, context, services: options.services,
        onDelta: delta => onEvent({ type: 'chat_message_delta', delta }),
        onRequest: () => onEvent({ type: 'chat_phase', phase: 'answer' }),
      });
    } catch (error) {
      answerText = `抱歉，这次没能生成回答：${error.message || '未知错误'}。你可以稍后重试，或使用界面按钮继续操作。`;
    }
    const { record: persisted } = await mutate(workflowId, options, (current, now) => {
      addMessage(current, 'user', text, now);
      addMessage(current, 'assistant', answerText, now);
      current.updated_at = now;
    });
    onEvent({ type: 'chat_done', handled: 'answer' });
    return { success: true, workflow_id: workflowId, workflow: await getView(persisted, options), startTask: false };
  }

  if (intent?.action === 'revise_scenes' || intent?.action === 'revise_plan') {
    const result = await actOnWhiteboardWorkflow(workflowId, {
      ...payload,
      action: intent.action === 'revise_scenes' ? 'revise_media' : 'revise',
      message: intent.instruction,
      sceneId: intent.sceneIds?.[0] || payload.sceneId,
      sceneIds: intent.sceneIds,
    }, options);
    onEvent({ type: 'chat_done', handled: intent.action, startTask: result.startTask });
    return result;
  }

  // 意图理解不可用（模型未配置或请求失败）：降级到既有正则路由，保证功能可用。
  return actOnWhiteboardWorkflow(workflowId, { ...payload, action: 'message', message: text }, options);
}

async function runWhiteboardWorkflow(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const initial = await readWorkflow(workflowId, rootDir);
  if (initial.whiteboard.media && !initial.whiteboard.media.stale) return production.run(workflowId, options, { mutate, getView });
  let attempt;
  let claimed = false;
  try {
    const started = await mutate(workflowId, options, (record, now) => {
      attempt = record.whiteboard.attempts.find(item => item.id === record.whiteboard.activeAttemptId);
      if (!attempt || record.status !== 'queued' || attempt.status !== 'prepared') throw new WhiteboardError('ACTION_NOT_ALLOWED', '当前任务没有等待执行的白板版本。', 409);
      record.status = 'running';
      attempt.status = 'preparing';
      record.updated_at = now;
      setStage(record, 'content_plan', 'running', record.message, now);
    });
    claimed = true;
    const frozen = started.record;
    const candidateContract = candidateContractFor(attempt.input);
    const task = {
      schemaVersion: 1, role: attempt.role, contractVersion: CONTRACT_VERSION,
      inputIdentity: attempt.inputIdentity, input: attempt.input, productionPlan: attempt.productionPlan,
      revisionMessage: attempt.revisionMessage, parentIdentity: attempt.parentIdentity,
      narrationService: frozen.whiteboard.narrationService,
      formalWritesAllowed: false, approvalWritesAllowed: false, allowedTools: [],
      allowedOutputs: ['candidate.json'], candidateSkeleton: candidateContract.skeleton, candidateSchema: candidateContract.schema,
    };
    const { result: taskSha256 } = await mutate(workflowId, options, async record => {
      const active = assertActiveAttempt(record, attempt);
      const hash = await artifactStore.writeImmutable(workflowId, attempt.id, 'task.json', task, rootDir);
      active.taskSha256 = hash;
      return hash;
    });
    const previousArtifact = frozen.whiteboard.current ? await artifactStore.readArtifact(frozen, frozen.whiteboard.current, rootDir) : null;
    await options.taskContext?.emit?.({ type: 'stage_started', stage: 'content_plan', progress: 20, message: '正在整理白板内容、分镜和制作方案...' });
    const candidate = attempt.kind === 'settings' ? {
      schemaVersion: 1, title: previousArtifact.title, summary: previousArtifact.summary,
      cues: previousArtifact.cues.map(({ id, text }) => ({ id, text })),
      scenes: previousArtifact.scenes.map(({ id, title, cueIds, imagePrompt, imageTexts }) => ({ id, title, cueIds, imagePrompt,
        ...(imageTexts ? { imageTexts } : {}) })),
    } : await generateDraft(task, {
      services: options.services, previousArtifact,
      apiContext: { workflowId, attemptId: attempt.id, attemptNumber: attempt.number },
      onRequest: async repair => {
        await mutate(workflowId, options, (record, now) => {
          const active = assertActiveAttempt(record, attempt);
          active.status = 'requesting';
          active.repairCount = repair;
          active.taskSha256 = taskSha256;
          record.updated_at = now;
        });
        await options.taskContext?.emit?.({ type: 'stage_progress', stage: 'content_plan', progress: repair ? 55 : 30, message: repair ? '正在补正候选方案的结构...' : '正在请求分析模型整理内容与分镜...' });
      },
      onCandidate: ({ repair, candidate, errors }) => mutate(workflowId, options, record => {
        assertActiveAttempt(record, attempt);
        return artifactStore.writeImmutable(workflowId, attempt.id, `candidate-response-${repair}.json`, { candidate, validationErrors: errors }, rootDir);
      }),
    });
    const artifact = materializeCandidate(candidate, attempt.input, attempt.productionPlan, frozen.whiteboard.narrationService);
    const published = await mutate(workflowId, options, async (record, now) => {
      const active = assertActiveAttempt(record, attempt);
      // 与删除共用文件队列；先核验当前版本，再落盘及发布，防止任务删除后重新创建产物。
      const binding = await artifactStore.publishArtifact({ record, attempt, candidate, artifact, taskSha256, rootDir });
      active.status = 'validated';
      active.binding = binding;
      active.completedAt = now;
      record.whiteboard.attempts.filter(item => item.id !== attempt.id && item.binding).forEach(item => { item.stale = true; });
      record.whiteboard.current = binding;
      record.whiteboard.activeAttemptId = '';
      record.status = 'waiting_approval';
      record.success = true;
      record.title = artifact.title;
      record.current_stage = 'initial_approval';
      record.current_progress = 75;
      record.message = '内容、分镜和制作方案已准备好，请检查当前版本后确认。';
      record.current_stage_message = record.message;
      record.updated_at = now;
      setStage(record, 'content_plan', 'done', '当前方案已通过结构与输入校验。', now);
      setStage(record, 'initial_approval', 'waiting_approval', '等待你确认当前内容与制作方案。', now);
      addMessage(record, 'assistant', `第 ${active.number} 版内容与制作方案已整理完成。${artifact.summary}\n请检查方案中的正文、分镜与制作设置；你可以提出修改意见，或确认当前方案。`, now, attempt.id);
      const interaction = { id: crypto.randomUUID(), kind: 'plan_review', stage: 'initial_approval', status: 'pending',
        title: `请确认第 ${active.number} 版内容与制作方案`, expectedAttemptId: attempt.id, expectedIdentity: binding.identity,
        createdAt: now, summary: artifact.summary };
      (record.whiteboard.interactions ||= []).push(interaction);
      record.whiteboard.messages.at(-1).interactionId = interaction.id;
    });
    return { success: true, ...await getView(published.record, options) };
  } catch (error) {
    if (error?.code === 'ENOENT' || (claimed && !await workflowFileExists(workflowId, rootDir))) return { success: false, workflow_id: workflowId, status: 'deleted', message: '创作任务已停止并删除。' };
    const code = error instanceof WhiteboardError ? error.code : 'WHITEBOARD_FAILED';
    const message = error instanceof WhiteboardError ? error.message : '白板方案处理失败，请检查本地存储空间和文件权限后重试。';
    if (attempt && claimed) {
      try {
        await mutate(workflowId, options, (record, now) => {
          if (record.whiteboard.activeAttemptId !== attempt.id) return;
          failAttempt(record, code, message, now);
        });
      } catch { /* 删除或合同不兼容时，不能重新创建或覆盖任务。 */ }
    }
    return { success: false, workflow_id: workflowId, status: code === 'UNKNOWN_EXTERNAL_OUTCOME' ? 'unknown_external_outcome' : 'failed', code, message };
  }
}

function failAttempt(record, code, message, now) {
  const attempt = record.whiteboard.attempts.find(item => item.id === record.whiteboard.activeAttemptId);
  const status = code === 'UNKNOWN_EXTERNAL_OUTCOME' ? 'unknown_external_outcome' : 'failed';
  if (attempt) Object.assign(attempt, { status, errorCode: code, message, completedAt: now });
  record.whiteboard.activeAttemptId = '';
  record.status = status;
  record.success = false;
  record.message = message;
  record.current_stage_message = message;
  record.error = { code, message };
  record.updated_at = now;
  setStage(record, 'content_plan', 'failed', message, now);
  addMessage(record, 'assistant', message, now, attempt?.id);
}

function recoverInterruptedRecord(record, now) {
  if (!['queued', 'running'].includes(record.status)) return record;
  if (record.whiteboard.media && !record.whiteboard.media.stale) { production.recover(record, now); return record; }
  const attempt = record.whiteboard.attempts.find(item => item.id === record.whiteboard.activeAttemptId);
  const unknown = attempt?.status === 'requesting';
  failAttempt(record, unknown ? 'UNKNOWN_EXTERNAL_OUTCOME' : 'INTERRUPTED', unknown
    ? '服务已重启，上次分析模型请求的结果无法确认。普通重试已暂停，请核实后明确同意新的请求。'
    : '服务已重启，方案任务被中断。可以手动重新生成方案。', now);
  record.active_task_id = '';
  record.active_operation_id = '';
  record.task_status = 'failed';
  return record;
}

module.exports = { assertContract, getView, createWhiteboardWorkflow, actOnWhiteboardWorkflow, chatOnWhiteboardWorkflow, runWhiteboardWorkflow, recoverInterruptedRecord };
