const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const { readWorkflow, workflowFileExists } = require('../workflowStore');
const artifactStore = require('./artifactStore');
const { WhiteboardError, sha256, canonicalJson, canvasFor } = require('./contracts');
const store = require('./mediaStore');
const mediaTools = require('./mediaTools');
const { narrationStage, lineartStage, annotationStage, sceneStage, finalStage, reviewGate } = require('./productionStages');
const aiTtsModel = require('../../ai/aiTtsModel');

function assertMediaContract(media) {
  if (!media || media.stale) return;
  if (media.contractVersion !== store.MEDIA_CONTRACT || canonicalJson(media.stageSchemaSnapshot) !== canonicalJson(store.STAGES)) {
    throw new WhiteboardError('CONTRACT_UNSUPPORTED', '此媒体任务的合同版本不兼容，请保留原文件并创建新的制作任务。', 409);
  }
}

async function voiceSnapshot(services = {}) {
  const config = await services.aiModelConfig?.getRuntimeConfig?.('tts');
  const runtime = await aiTtsModel.resolveTtsRuntime({ ttsConfig: config || {}, env: {} });
  const configured = Boolean(config?.enabled && runtime.configured && runtime.baseUrl && runtime.modelId);
  return {
    runtime, legacyContractHash: configured ? sha256({ provider: config.provider || '', protocol: config.protocol || '', modelId: config.modelId, voiceId: config.voiceId || '' }) : '',
    service: { contractVersion: 2, configured, provider: runtime.provider,
      displayName: configured ? (config.providerName || (runtime.provider === 'doubao' ? '豆包 Seed Audio' : '当前旁白服务')) : '未配置',
      contractHash: configured ? sha256({ provider: runtime.provider, model: runtime.modelId,
        endpoint: runtime.baseUrl, voice: runtime.provider === 'doubao' ? runtime.doubao : runtime.voiceId }) : '' },
  };
}

function actionsFor(record) {
  const media = record.whiteboard.media;
  if (['queued', 'running'].includes(record.status) || media?.executionId) return [];
  if (!media || media.stale) return record.status === 'phase0_complete' ? [{ id: 'start_production', label: '开始制作视频' }] : null;
  if (record.status === 'unknown_external_outcome') return [{ id: 'authorize_media_retry', label: '核实后授权新请求', requiresConfirmation: true }];
  if (record.status === 'failed') return [
    { id: 'retry_media', label: '继续未完成的制作' },
    ...(record.error?.code === 'ANNOTATION_COVERAGE_LOW' && media.lowCoverage?.length
      ? [{ id: 'accept_low_coverage', label: '查看预览后接受当前落墨', requiresConfirmation: true }] : []),
    ...(media.stage === 'full_narration' && /^(NARRATION_|AUDIO_)/.test(record.error?.code || '')
      ? [{ id: 'regenerate_narration', label: '重新生成完整旁白', requiresConfirmation: true }] : [])];
  if (record.status === 'waiting_approval' && media.gate) return [
    { id: 'approve_media', label: media.gate === 'final_approval' ? '确认最终成片' : '确认当前产物并继续', requiresConfirmation: true },
    ...(['lineart_approval', 'annotation_approval', 'scene_bundle_approval'].includes(media.gate)
      ? [{ id: 'revise_media', label: media.gate === 'scene_bundle_approval' ? '重新渲染指定幕' : '修改指定幕' }] : []),
  ];
  return [];
}

function setState(record, status, message, now) {
  record.status = status;
  record.success = !['failed', 'unknown_external_outcome'].includes(status);
  record.message = message;
  record.current_stage_message = message;
  record.updated_at = now;
  record.current_stage = record.whiteboard.media.stage;
  record.current_progress = Math.min(99, 20 + store.STAGES.findIndex(stage => stage.id === record.current_stage) * 16);
  record.error = record.success ? null : record.error;
  const stage = record.whiteboard.media.stages.find(item => item.id === record.current_stage);
  if (stage) Object.assign(stage, { status, message, updated_at: now });
}

function message(record, role, text, now, interactionId = '') {
  record.whiteboard.messages.push({ id: crypto.randomUUID(), role, text, createdAt: now, interactionId });
}

function expireInteraction(record, status, now, response = '') {
  const interaction = record.whiteboard.interactions?.find(item => item.id === record.whiteboard.media?.interactionId);
  if (interaction?.status === 'pending') Object.assign(interaction, { status, answeredAt: now, response });
}

async function requirePlan(record, options) {
  if (record.whiteboard.pendingInitialApproval || record.whiteboard.current?.stale || !record.whiteboard.initialApproval
    || record.whiteboard.initialApproval.stale || record.whiteboard.initialApproval.identity !== record.whiteboard.current?.identity) {
    throw new WhiteboardError('APPROVAL_REQUIRED', '请先确认当前内容与制作方案。', 409);
  }
  const artifact = await artifactStore.readArtifact(record, record.whiteboard.current, options.rootDir);
  if (record.whiteboard.media && !record.whiteboard.media.stale && record.whiteboard.media.planIdentity !== record.whiteboard.current.identity) {
    throw new WhiteboardError('STALE_IDENTITY', '媒体所绑定的内容方案已变化。', 409);
  }
  return artifact;
}

async function validateCurrent(record, stage, options) {
  const binding = record.whiteboard.media.current[stage];
  await store.validateBinding(record, binding, options.rootDir);
  return binding;
}

function approve(record, actor, basis, now) {
  const media = record.whiteboard.media;
  const binding = media.current[media.stage];
  media.approvals.push({ gate: media.gate, identity: binding.identity, actor, basis, approvedAt: now, stale: false });
  expireInteraction(record, 'answered', now, actor === 'user' ? '已确认当前产物' : '已按授权完成技术与视觉检查');
  const stage = media.stages.find(item => item.id === media.stage);
  Object.assign(stage, { status: 'done', completed_at: now });
  const index = store.STAGES.findIndex(item => item.id === media.stage);
  media.gate = '';
  media.interactionId = '';
  if (index === store.STAGES.length - 1) {
    record.status = 'done'; record.success = true; record.current_progress = 100;
    record.message = '线稿白板视频已生成，所有制作阶段已完成。'; record.current_stage_message = record.message;
    record.updated_at = now;
    message(record, 'assistant', record.message, now);
    return false;
  }
  media.stage = store.STAGES[index + 1].id;
  setState(record, 'queued', `正在准备${store.STAGES[index + 1].label}...`, now);
  return true;
}

async function act(record, payload, options, now) {
  const action = payload.action;
  if (!actionsFor(record)?.some(item => item.id === action)) throw new WhiteboardError('ACTION_NOT_ALLOWED', '当前阶段不允许该媒体操作，请刷新当前任务。', 409);
  const artifact = await requirePlan(record, options);
  if (action === 'start_production') {
    const tools = options.services?.whiteboardMediaTools || mediaTools;
    const runtime = await tools.preflight({ ...options.mediaOptions, aspectRatio: artifact.aspectRatio || '16:9' });
    const { service, runtime: voice, legacyContractHash } = await voiceSnapshot(options.services);
    if (artifact.productionPlan.narrationMode !== 'disabled') {
      if (!service.configured || !['doubao', 'minimax'].includes(voice.provider)) throw new WhiteboardError('TTS_NOT_CONFIGURED', '完整白板旁白需要豆包 Seed Audio 或 MiniMax 原生字幕。请在设置中配置 TTS，再调整制作设置并重新确认方案。');
      if (artifact.narrationService.contractVersion === 2 && service.contractHash !== artifact.narrationService.contractHash) throw new WhiteboardError('VOICE_CONFIG_CHANGED', '旁白设置已变化，请更新制作设置并重新确认当前方案。', 409);
      if (artifact.narrationService.contractVersion !== 2 && artifact.narrationService.contractHash !== legacyContractHash) throw new WhiteboardError('VOICE_CONFIG_CHANGED', '旧方案的旁白设置已变化，请更新制作设置并重新确认。', 409);
      if (voice.provider === 'doubao' && artifact.durationMs > 120000) throw new WhiteboardError('TTS_INPUT_INVALID', '豆包整轨旁白最多支持 120 秒，请调整方案时长。');
    } else if (artifact.timingKind !== 'source_srt') throw new WhiteboardError('SILENT_SRT_REQUIRED', '静音白板需要输入带真实时间的 SRT 字幕。');
    const config = await options.services.aiModelConfig.getRuntimeConfig('text');
    const image = await options.services.aiModelConfig.getRuntimeConfig('image');
    if (!config?.enabled || !config.apiKey || !config.baseUrl || !config.modelId || config.supportsMultimodal !== true) throw new WhiteboardError('VISION_NOT_CONFIGURED', '请在设置中配置支持多模态输入的分析模型，用于区域编排和视觉检查。');
    if (!image?.enabled || !image.apiKey || !image.baseUrl || !image.modelId) throw new WhiteboardError('IMAGE_NOT_CONFIGURED', '请先在设置中配置图片生成模型。');
    if (record.whiteboard.media) (record.whiteboard.mediaHistory ||= []).push(record.whiteboard.media);
    record.whiteboard.media = store.makeMedia(record.whiteboard.current.identity, runtime.recipe);
    record.whiteboard.media.voiceService = service;
    setState(record, 'queued', '正在准备完整旁白与真实时间线...', now);
    message(record, 'user', '按当前已确认方案开始制作视频。', now);
    return true;
  }
  const media = record.whiteboard.media;
  if (payload.expectedMediaIdentity !== store.mediaIdentity(media)
    || (media.interactionId && payload.interactionId !== media.interactionId)) throw new WhiteboardError('STALE_IDENTITY', '媒体版本或待确认卡片已变化，请刷新后检查当前产物。', 409);
  if (action === 'approve_media') {
    if (payload.confirmed !== true) throw new WhiteboardError('APPROVAL_REQUIRED', '请实际检查当前产物后明确确认。', 409);
    await validateCurrent(record, media.stage, options);
    message(record, 'user', payload.message || '确认当前媒体产物，继续制作。', now, media.interactionId);
    return approve(record, 'user', 'user_review_current_artifact', now);
  }
  if (action === 'authorize_media_retry' && payload.confirmed !== true) throw new WhiteboardError('EXTERNAL_AUTH_REQUIRED', '需要明确同意新请求及可能的重复费用。', 409);
  if (action === 'accept_low_coverage') {
    if (payload.confirmed !== true) throw new WhiteboardError('APPROVAL_REQUIRED', '请实际查看低覆盖率预览图后明确确认接受。', 409);
    const entries = media.lowCoverage || [];
    if (!entries.length) throw new WhiteboardError('ACTION_NOT_ALLOWED', '没有可接受的低覆盖率落墨记录，请重新编排对应幕。', 409);
    if (new Set(entries.map(entry => entry.sceneId)).size !== entries.length) throw new WhiteboardError('ARTIFACT_INVALID', '低覆盖率记录包含重复分镜，请重新编排对应幕。', 409);
    const narration = await validateCurrent(record, 'full_narration', options);
    const timing = await store.readData(record, narration.timeline, options.rootDir);
    const accepted = [];
    for (const entry of entries) {
      const attempt = media.attempts.findLast(row => row.stage === 'annotation_drafting' && row.sceneId === entry.sceneId);
      const scene = timing.scenes.find(item => item.id === entry.sceneId);
      if (!entry.annotation || !entry.preview || !entry.resultPreview || entry.kind !== 'annotation_coverage_review'
        || !Number.isFinite(entry.coverage?.coverageRatio) || entry.coverage.coverageRatio < 0 || entry.coverage.coverageRatio >= 0.97
        || !attempt?.received?.annotation || !attempt.received.preview || !attempt.received.resultPreview) {
        throw new WhiteboardError('ARTIFACT_INVALID', `${entry.title || entry.sceneId} 的低覆盖率预览或标注文件缺失，请重新编排该幕。`, 409);
      }
      await store.validateBinding(record, entry, options.rootDir);
      const lineart = await store.validateBinding(record, media.lineart[entry.sceneId], options.rootDir);
      const annotation = await store.readData(record, entry.annotation, options.rootDir);
      if (!scene || attempt.id !== entry.attemptId || attempt.status !== 'failed' || attempt.errorCode !== 'ANNOTATION_COVERAGE_LOW'
        || attempt.inputIdentity !== entry.inputIdentity || media.annotations[entry.sceneId]
        || ['annotation', 'preview', 'resultPreview'].some(key => entry[key].id !== attempt.received[key].id)
        || entry.lineartIdentity !== lineart.identity || entry.narrationIdentity !== narration.identity
        || entry.revision !== (media.overrides[`annotation_drafting:${entry.sceneId}`] || '')
        || annotation.sceneId !== scene.id || annotation.imageSha256 !== lineart.image.sha256
        || annotation.timingIdentity !== narration.identity || annotation.sceneDurationMs !== scene.endMs - scene.startMs
        || canonicalJson(annotation.canvas) !== canonicalJson(canvasFor(artifact.aspectRatio))) {
        throw new WhiteboardError('STALE_IDENTITY', '低覆盖率预览所对应的线稿、时间线或落墨版本已变化，请重新检查当前产物。', 409);
      }
      const approval = { sceneId: entry.sceneId, attemptId: entry.attemptId, reviewIdentity: entry.identity,
        actor: 'user', basis: 'user_review_low_coverage', acceptedAt: now,
        coverageRatio: entry.coverage.coverageRatio, missingContentPolicy: 'keep_hidden' };
      accepted.push({ attempt, approval, binding: store.bind({ kind: 'annotation', sceneId: entry.sceneId,
        inputIdentity: entry.inputIdentity, planningContract: entry.planningContract, visualGrouping: entry.visualGrouping,
        annotation: entry.annotation, preview: entry.preview, resultPreview: entry.resultPreview,
        coverage: entry.coverage, coverageAcceptance: approval }) });
    }
    // 先验证全部预览，再一起登记用户决定，避免部分接受。
    for (const { attempt, approval, binding } of accepted) {
      media.annotations[binding.sceneId] = binding;
      (media.coverageAcceptances ||= []).push({ ...approval, annotationIdentity: binding.identity });
      Object.assign(attempt, { status: 'accepted', acceptedAt: now });
    }
    media.lowCoverage = [];
  }
  if (action === 'retry_media' && media.stage === 'annotation_drafting') media.lowCoverage = [];
  if (action === 'regenerate_narration') {
    if (payload.confirmed !== true) throw new WhiteboardError('EXTERNAL_AUTH_REQUIRED', '重新生成完整旁白会发起新的语音请求，请明确确认。', 409);
    media.narrationTake = (media.narrationTake || 0) + 1;
  }
  if (action === 'revise_media') {
    // 支持一次修订多幕：自然语言意图路由会从"1、2、6、7重新生成"这类消息中抽取幕列表。
    const requested = Array.isArray(payload.sceneIds) && payload.sceneIds.length ? payload.sceneIds : [payload.sceneId];
    const sceneIds = [...new Set(requested.filter(Boolean))];
    if (!sceneIds.length || sceneIds.some(id => !artifact.scenes.some(scene => scene.id === id))) {
      throw new WhiteboardError('INVALID_INPUT', '请选择需要修改的分镜。');
    }
    const revision = String(payload.message || '').trim();
    if (media.stage !== 'scene_render' && (!revision || revision.length > 3000)) throw new WhiteboardError('INVALID_INPUT', '请输入本幕修改意见，最多 3000 个字符。');
    const index = store.STAGES.findIndex(stage => stage.id === media.stage);
    for (const sceneId of sceneIds) {
      media.overrides[`${media.stage}:${sceneId}`] = revision;
      if (index <= 1) delete media.lineart[sceneId];
      if (index <= 2) delete media.annotations[sceneId];
      if (index <= 2) media.lowCoverage = (media.lowCoverage || []).filter(entry => entry.sceneId !== sceneId);
      delete media.scenes[sceneId];
    }
    for (const stage of store.STAGES.slice(index)) {
      delete media.current[stage.id];
      Object.assign(media.stages.find(item => item.id === stage.id), { status: 'pending', message: '' });
      media.approvals.filter(item => item.gate === store.GATES[stage.id]).forEach(item => { item.stale = true; });
    }
    record.result = null;
    media.revision += 1;
  }
  expireInteraction(record, action === 'revise_media' ? 'superseded' : 'answered', now, payload.message || '继续本阶段');
  media.gate = ''; media.interactionId = ''; media.activeAttemptId = '';
  setState(record, 'queued', '正在继续当前媒体阶段，已完成且有效的产物将复用...', now);
  record.last_event_seq = 0;
  message(record, 'user', action === 'authorize_media_retry' ? '已核实外部结果，同意可能的重复费用并授权新的请求。'
    : action === 'accept_low_coverage' ? '已查看低覆盖率落墨预览，接受当前已标注内容并继续；遗漏内容保持空白。'
    : payload.message || '继续未完成的制作。', now);
  return true;
}

function unfinishedAttempts(media) {
  return media.attempts.filter(item => !['validated', 'accepted', 'failed', 'unknown_external_outcome'].includes(item.status)
    && (item.id === media.activeAttemptId || (['scene_render', 'annotation_drafting'].includes(media.stage) && item.stage === media.stage
      && (!item.executionId || item.executionId === media.executionId))));
}

function fail(record, error, now) {
  const media = record.whiteboard.media;
  const unknown = error.code === 'UNKNOWN_EXTERNAL_OUTCOME';
  for (const attempt of unfinishedAttempts(media)) Object.assign(attempt, { status: unknown ? 'unknown_external_outcome' : 'failed', errorCode: error.code, completedAt: now });
  if (media.sceneRenderProgress) media.sceneRenderProgress.active = 0;
  if (media.annotationProgress) media.annotationProgress.active = 0;
  media.activeAttemptId = '';
  media.executionId = '';
  record.error = { code: error.code || 'MEDIA_FAILED', message: error.message };
  setState(record, unknown ? 'unknown_external_outcome' : 'failed', error.message, now);
  message(record, 'assistant', error.message, now);
}

function recover(record, now) {
  const media = record.whiteboard.media;
  const unknown = unfinishedAttempts(media).some(item => item.status === 'requesting')
    || media.attempts.some(item => item.status === 'unknown_external_outcome'
      && (item.id === media.activeAttemptId || (media.executionId && item.executionId === media.executionId)));
  fail(record, new WhiteboardError(unknown ? 'UNKNOWN_EXTERNAL_OUTCOME' : 'MEDIA_INTERRUPTED', unknown
    ? '服务重启时存在尚未取得完整证据的外部请求，请核实后授权新请求。'
    : '媒体制作被中断，可以继续未完成阶段；有效的音频和图片会复用。'), now);
  record.active_task_id = ''; record.active_operation_id = ''; record.task_status = 'failed';
}

async function run(workflowId, options, hooks) {
  const { mutate, getView } = hooks;
  const rootDir = options.rootDir;
  const services = options.services || {};
  const tools = services.whiteboardMediaTools || mediaTools;
  const executionId = crypto.randomUUID();
  let claimed = false;
  const controller = new AbortController();
  const processOptions = { ...options.mediaOptions, signal: controller.signal };
  let watchdog;
  let heartbeat;
  const change = handler => mutate(workflowId, options, async (record, now) => {
    if (record.whiteboard.media?.executionId !== executionId || record.whiteboard.current?.stale) throw new WhiteboardError('STALE_IDENTITY', '当前制作已停止或内容版本已变化。', 409);
    return handler(record, now);
  });
  const read = () => readWorkflow(workflowId, rootDir);
  try {
    await mutate(workflowId, options, (record, now) => {
      if (record.status !== 'queued' || !record.whiteboard.media || record.whiteboard.media.stale || record.whiteboard.media.executionId) throw new WhiteboardError('ACTION_NOT_ALLOWED', '当前没有等待执行的媒体任务。', 409);
      record.whiteboard.media.executionId = executionId;
      setState(record, 'running', record.message, now);
    });
    claimed = true;
    watchdog = setInterval(async () => { if (!await workflowFileExists(workflowId, rootDir)) controller.abort(); }, 2000);
    heartbeat = setInterval(async () => {
      try {
        const state = await read();
        if (state.whiteboard.media?.executionId !== executionId) return;
        await options.taskContext?.emit?.({ type: 'stage_progress', stage: state.whiteboard.media.stage,
          progress: state.current_progress, message: state.message });
      } catch { /* The next guarded write handles deletion. */ }
    }, 15000);
    const initialArtifact = await requirePlan(await read(), options);
    const runtime = await tools.preflight({ ...processOptions, aspectRatio: initialArtifact.aspectRatio || '16:9' });
    const config = await services.aiModelConfig.getRuntimeConfig('text');
    const voice = await voiceSnapshot(services);

    const attempt = async (stage, sceneId = '', external = false, inputIdentity = '') => {
      const item = { id: crypto.randomUUID(), stage, sceneId, external, inputIdentity, executionId, status: 'prepared' };
      await change(async (record, now) => {
        item.createdAt = now;
        record.whiteboard.media.attempts.push(item);
        record.whiteboard.media.activeAttemptId = item.id;
        await fsp.mkdir(store.workDirectory(workflowId, item.id, rootDir), { recursive: true });
      });
      return item;
    };
    const requesting = id => change((record, now) => {
      record.whiteboard.media.attempts.find(item => item.id === id).status = 'requesting'; record.updated_at = now;
    });
    const publish = async (item, files, decorate) => change(async (record, now) => {
      const published = {};
      for (const [key, file] of Object.entries(files)) published[key] = await store.publishFile(record, item, file.path, { ...file, rootDir });
      const current = record.whiteboard.media.attempts.find(row => row.id === item.id);
      current.status = 'candidate_ready';
      current.received = { ...current.received, ...published };
      await decorate?.(record, published, now);
      return published;
    });
    const jsonFile = async (item, name, value) => {
      const file = path.join(store.workDirectory(workflowId, item.id, rootDir), name);
      await fsp.writeFile(file, canonicalJson(value), { flag: 'wx' }); return file;
    };
    const filePath = async (record, file) => (await store.mediaFile(record, file, rootDir)).path;
    const emitProgress = async event => {
      try { await options.taskContext?.emit?.(event); } catch { /* Persisted progress remains available after SSE reconnect. */ }
    };
    const ctx = { workflowId, rootDir, services, tools, runtime, config, voice, processOptions,
      read, change, attempt, requesting, publish, jsonFile, filePath, emitProgress };

    while (true) {
      const record = await read();
      const artifact = await requirePlan(record, options);
      const media = record.whiteboard.media;
      if (sha256(media.recipe) !== sha256(runtime.recipe)) throw new WhiteboardError('RENDER_CONFIG_CHANGED', '渲染器或字体已变化，请重新确认制作设置后生成新版本。', 409);
      await change((current, now) => setState(current, 'running', `正在${store.STAGES.find(item => item.id === media.stage).label}...`, now));
      await options.taskContext?.emit?.({ type: 'stage_started', stage: media.stage, progress: record.current_progress, message: `正在${store.STAGES.find(item => item.id === media.stage).label}...` });
      await executeStage(ctx, artifact, media.stage);
      await change((current, now) => {
        const currentMedia = current.whiteboard.media;
        currentMedia.gate = store.GATES[currentMedia.stage];
        const interaction = { id: crypto.randomUUID(), kind: 'media_review', stage: currentMedia.gate,
          title: store.TITLES[currentMedia.gate], status: 'pending', createdAt: now,
          expectedAttemptId: current.whiteboard.attempts.at(-1).id, expectedIdentity: current.whiteboard.current.identity,
          artifactIdentity: currentMedia.current[currentMedia.stage].identity };
        (current.whiteboard.interactions ||= []).push(interaction);
        currentMedia.interactionId = interaction.id;
        setState(current, artifact.productionPlan.agentApprovalEnabled ? 'running' : 'waiting_approval',
          artifact.productionPlan.agentApprovalEnabled ? `正在检查：${interaction.title.replace(/^请/, '')}...` : interaction.title, now);
        message(current, 'assistant', interaction.title, now, interaction.id);
      });
      if (artifact.productionPlan.agentApprovalEnabled !== true) break;
      const reviewed = await reviewGate(ctx, artifact);
      if (!reviewed) {
        await change((current, now) => setState(current, 'waiting_approval', current.message, now));
        break;
      }
      const next = await change(async (current, now) => {
        await validateCurrent(current, current.whiteboard.media.stage, options);
        return approve(current, 'automation', ['full_narration', 'final_delivery'].includes(current.whiteboard.media.stage)
          ? 'technical_after_initial_approval' : 'current_images_and_sampled_frames_review', now);
      });
      if (!next.result) break;
    }
    const finished = await change(record => { record.whiteboard.media.executionId = ''; record.whiteboard.media.activeAttemptId = ''; });
    return { success: true, ...await getView(finished.record, options) };
  } catch (error) {
    if (error.code === 'ENOENT' || !await workflowFileExists(workflowId, rootDir)) return { success: false, workflow_id: workflowId, status: 'deleted', message: '制作任务已停止并删除。' };
    const safe = error instanceof WhiteboardError ? error : new WhiteboardError('MEDIA_FAILED', '媒体处理失败，请检查本地运行环境与当前产物后重试。');
    if (claimed) { try { await change((record, now) => fail(record, safe, now)); } catch { /* Never recreate a deleted task. */ } }
    return { success: false, workflow_id: workflowId, code: safe.code, status: safe.code === 'UNKNOWN_EXTERNAL_OUTCOME' ? 'unknown_external_outcome' : 'failed', message: safe.message };
  } finally { controller.abort(); clearInterval(watchdog); clearInterval(heartbeat); }
}

// Stage implementations below only create candidates. Every formal publication runs through change().
async function executeStage(ctx, artifact, stage) {
  const record = await ctx.read();
  if (record.whiteboard.media.current[stage]) {
    await store.validateBinding(record, record.whiteboard.media.current[stage], ctx.rootDir); return;
  }
  if (stage === 'full_narration') return narrationStage(ctx, artifact);
  const narration = await store.validateBinding(record, record.whiteboard.media.current.full_narration, ctx.rootDir);
  const timing = await store.readData(record, narration.timeline, ctx.rootDir);
  if (stage === 'lineart_generation') return lineartStage(ctx, artifact, timing);
  if (stage === 'annotation_drafting') return annotationStage(ctx, artifact, timing);
  if (stage === 'scene_render') return sceneStage(ctx, artifact, timing);
  return finalStage(ctx, artifact, timing);
}

module.exports = { voiceSnapshot, actionsFor, act, run, recover, setState, assertMediaContract };
