const fsp = require('fs/promises');
const path = require('path');
const { WhiteboardError, sha256, canvasFor } = require('./contracts');
const store = require('./mediaStore');
const models = require('./mediaModels');
const { buildNarrationTiming, buildSilentTiming, srtText } = require('./narrationTiming');
const aiTtsModel = require('../../ai/aiTtsModel');
const { sceneRenderPool } = require('./sceneRenderPool');
const { annotationPool } = require('./annotationPool');

async function fspExists(file) { try { await fsp.access(file); return true; } catch { return false; } }

async function complete(ctx, item, stage, binding) {
  await ctx.change((record, now) => {
    record.whiteboard.media.current[stage] = binding;
    if (item) Object.assign(record.whiteboard.media.attempts.find(row => row.id === item.id), { status: 'validated', completedAt: now });
    record.whiteboard.media.activeAttemptId = '';
  });
}

async function reuseHistory(ctx, collection, key, inputIdentity) {
  const record = await ctx.read();
  const histories = [...(record.whiteboard.mediaHistory || [])].reverse();
  for (const history of histories) {
    if (history.contractVersion !== store.MEDIA_CONTRACT) continue;
    const binding = history[collection]?.[key];
    if (!binding || binding.inputIdentity !== inputIdentity) continue;
    try { await store.validateBinding(record, binding, ctx.rootDir); } catch { continue; }
    const ids = new Set(store.fileIds(binding));
    const sources = [history, ...histories].flatMap(media => media.artifacts).filter(file => ids.has(file.id));
    await ctx.change(current => {
      current.whiteboard.media[collection][key] = structuredClone(binding);
      const existing = new Set(current.whiteboard.media.artifacts.map(file => file.id));
      for (const file of sources) if (!existing.has(file.id)) { current.whiteboard.media.artifacts.push(structuredClone(file)); existing.add(file.id); }
      (current.whiteboard.media.reused ||= []).push({ collection, key, identity: binding.identity });
    });
    return true;
  }
  return false;
}

async function narrationStage(ctx, artifact) {
  let record = await ctx.read();
  const media = record.whiteboard.media;
  const silent = artifact.productionPlan.narrationMode === 'disabled';
  if (!silent && ctx.voice.service.contractHash !== media.voiceService.contractHash) throw new WhiteboardError('VOICE_CONFIG_CHANGED', '旁白服务或声音参数已变化，请重新确认制作设置后生成新版本。', 409);
  const inputIdentity = sha256({ text: artifact.narrationText, language: artifact.narrationLanguage, cues: artifact.cues,
    ...(artifact.aspectRatio === '9:16' ? { captionLayout: '9:16' } : {}),
    scenes: artifact.scenes.map(({ id, cueIds, startMs, endMs }) => ({ id, cueIds, startMs, endMs })),
    voice: media.voiceService.contractHash, silent, take: media.narrationTake || 0 });
  if (await reuseHistory(ctx, 'current', 'full_narration', inputIdentity)) return;
  const reusable = [...media.attempts].reverse().find(item => item.stage === 'full_narration' && item.inputIdentity === inputIdentity && item.received?.raw && item.received?.native);
  const item = await ctx.attempt('full_narration', '', !silent && !reusable, inputIdentity);
  const directory = store.workDirectory(ctx.workflowId, item.id, ctx.rootDir);
  let timing;
  let audio;
  let native;
  let audioInfo;
  if (silent) timing = buildSilentTiming(artifact);
  else {
    let received;
    if (reusable) received = reusable.received;
    else {
      await ctx.requesting(item.id);
      const cueMap = new Map(artifact.cues.map(cue => [cue.id, cue.text]));
      const result = await (ctx.services.aiTtsModel || aiTtsModel).callTtsModel({
        text: artifact.narrationText, language: artifact.narrationLanguage,
        durationSeconds: artifact.durationMs / 1000,
        scenes: artifact.scenes.map(scene => ({ ...scene, text: scene.cueIds.map(id => cueMap.get(id)).join('\n') })),
        ttsConfig: { ...ctx.voice.runtime, enabled: true }, env: {}, nativeWordSubtitles: true,
        maxRetries: 0, requestTimeoutMs: 180000, fetchImpl: ctx.services.fetchImpl, signal: ctx.processOptions.signal,
      });
      if (result.audioBuffer) {
        const raw = path.join(directory, 'provider-audio.bin');
        await fsp.writeFile(raw, result.audioBuffer, { flag: 'wx' });
        const files = { raw: { path: raw, kind: 'provider_audio', name: '同请求原始音频', mime: 'application/octet-stream' } };
        if (result.nativeSubtitles) files.native = { path: await ctx.jsonFile(item, 'provider-subtitles.json', result.nativeSubtitles),
          kind: 'provider_subtitles', name: '同请求原生字级字幕', mime: 'application/json' };
        received = (await ctx.publish(item, files)).result;
      }
      if (!result.success || !received?.raw || !received?.native) throw new WhiteboardError(result.code || 'UNKNOWN_EXTERNAL_OUTCOME', result.message || '语音没有返回完整的同请求音频与原生字幕证据。');
    }
    record = await ctx.read();
    const rawPath = await ctx.filePath(record, received.raw);
    const evidence = await store.readData(record, received.native, ctx.rootDir);
    const output = path.join(directory, 'narration.wav');
    audioInfo = await ctx.tools.normalizeAudio(rawPath, output, ctx.runtime, ctx.processOptions);
    if (evidence.durationMs && Math.abs(evidence.durationMs - audioInfo.durationMs) > 120) throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '语音响应声明的时长与实际音频不一致。音频已保留，请核实。');
    timing = buildNarrationTiming(artifact, evidence, audioInfo.durationMs);
    timing.audioSha256 = await ctx.tools.hashFile(output);
    timing.nativeSubtitlesSha256 = received.native.sha256;
    native = received.native;
    audio = (await ctx.publish(item, { audio: { path: output, kind: 'narration', name: '完整旁白', mime: 'audio/wav' } })).result.audio;
  }
  const timelinePath = await ctx.jsonFile(item, 'timeline.json', timing);
  const srtPath = path.join(directory, 'narration.srt');
  await fsp.writeFile(srtPath, srtText(timing.captions), { flag: 'wx' });
  const files = (await ctx.publish(item, {
    timeline: { path: timelinePath, kind: 'timeline', name: '真实时间线', mime: 'application/json' },
    subtitles: { path: srtPath, kind: 'subtitles', name: '权威字幕', mime: 'application/x-subrip' },
  })).result;
  const binding = store.bind({ kind: 'full_narration', inputIdentity, ...files, audio: audio || null, native: native || null,
    durationMs: timing.durationMs, audioInfo: audioInfo || null, timingKind: timing.timingKind,
    sourceTextSha256: timing.sourceTextSha256, language: artifact.narrationLanguage });
  await complete(ctx, item, 'full_narration', binding);
}

async function lineartStage(ctx, artifact, timing) {
  for (const scene of artifact.scenes) {
    const record = await ctx.read();
    if (record.whiteboard.media.lineart[scene.id]) {
      await store.validateBinding(record, record.whiteboard.media.lineart[scene.id], ctx.rootDir); continue;
    }
    const revision = record.whiteboard.media.overrides[`lineart_generation:${scene.id}`] || '';
    const imageConfig = await ctx.services.aiModelConfig.getRuntimeConfig('image');
    const inputIdentity = sha256({ prompt: models.lineartPrompt(artifact, scene, revision), style: artifact.visualStyle, revision,
      model: imageConfig.modelId, provider: imageConfig.provider, endpoint: imageConfig.baseUrl });
    if (await reuseHistory(ctx, 'lineart', scene.id, inputIdentity)) continue;
    const reusable = [...record.whiteboard.media.attempts].reverse().find(attempt => attempt.stage === 'lineart_generation'
      && attempt.sceneId === scene.id && attempt.inputIdentity === inputIdentity && attempt.received?.rawImage);
    const item = await ctx.attempt('lineart_generation', scene.id, !reusable, inputIdentity);
    const directory = store.workDirectory(ctx.workflowId, item.id, ctx.rootDir);
    let raw;
    if (reusable) raw = await ctx.filePath(record, reusable.received.rawImage);
    else {
      const bytes = await models.generateLineart({ artifact, scene, revision, imageConfig, services: ctx.services, onRequest: () => ctx.requesting(item.id) });
      raw = path.join(directory, 'provider-image.bin');
      await fsp.writeFile(raw, bytes, { flag: 'wx' });
      await ctx.publish(item, { rawImage: { path: raw, kind: 'provider_image', name: `${scene.title}原始图`, sceneId: scene.id, mime: 'application/octet-stream' } });
    }
    const output = path.join(directory, 'lineart.png');
    await ctx.tools.python('normalize-image', { input: raw, output, canvas: canvasFor(artifact.aspectRatio) }, ctx.processOptions);
    await ctx.publish(item, { image: { path: output, kind: 'lineart', name: scene.title, sceneId: scene.id, mime: 'image/png' } }, (current, files, now) => {
      current.whiteboard.media.lineart[scene.id] = store.bind({ kind: 'lineart', sceneId: scene.id, inputIdentity, image: files.image });
      Object.assign(current.whiteboard.media.attempts.find(row => row.id === item.id), { status: 'validated', completedAt: now });
    });
  }
  const record = await ctx.read();
  await complete(ctx, null, 'lineart_generation', store.bind({ kind: 'lineart_bundle',
    scenes: timing.scenes.map(scene => record.whiteboard.media.lineart[scene.id]) }));
}

async function annotateSceneCandidate(ctx, artifact, timing, scene, canvas) {
  let item;
  try {
    const record = await ctx.read();
    if (record.whiteboard.media.annotations[scene.id]) {
      await store.validateBinding(record, record.whiteboard.media.annotations[scene.id], ctx.rootDir);
      return { reused: true };
    }
    const lineart = await store.validateBinding(record, record.whiteboard.media.lineart[scene.id], ctx.rootDir);
    const image = await ctx.filePath(record, lineart.image);
    const revision = record.whiteboard.media.overrides[`annotation_drafting:${scene.id}`] || '';
    const prompt = models.annotationPrompt({ scene, cues: timing.cues.filter(cue => scene.cueIds.includes(cue.id)), revision, canvas });
    const inputIdentity = sha256({ contract: models.ANNOTATION_PLANNING_CONTRACT, prompt,
      image: lineart.image.sha256, timing: record.whiteboard.media.current.full_narration.identity, scene, revision });
    const pending = record.whiteboard.media.lowCoverage?.find(entry => entry.sceneId === scene.id && entry.inputIdentity === inputIdentity);
    if (pending) {
      await store.validateBinding(record, pending, ctx.rootDir);
      throw new WhiteboardError('ANNOTATION_COVERAGE_LOW', '本幕的低覆盖率预览已保留，请查看后决定接受或重新编排。');
    }
    if (await reuseHistory(ctx, 'annotations', scene.id, inputIdentity)) return { reused: true };
    item = await ctx.attempt('annotation_drafting', scene.id, true, inputIdentity);
    const candidate = await models.structuredVision({ textConfig: ctx.config, images: [image], services: ctx.services,
      onRequest: () => ctx.requesting(item.id), validate: candidate => models.validateAnnotation(candidate, canvas), reasoningEffort: 'medium', prompt,
    });
    const annotation = models.materializeAnnotation(candidate, scene, lineart.image.sha256, record.whiteboard.media.current.full_narration.identity, canvas);
    const candidateFile = await ctx.jsonFile(item, 'candidate.json', candidate);
    const annotationFile = await ctx.jsonFile(item, 'annotation.json', annotation);
    await ctx.publish(item, { candidate: { path: candidateFile, kind: 'annotation_candidate', name: '区域候选', sceneId: scene.id, mime: 'application/json' } });
    const preview = path.join(store.workDirectory(ctx.workflowId, item.id, ctx.rootDir), 'annotation-preview.png');
    const resultPreview = path.join(store.workDirectory(ctx.workflowId, item.id, ctx.rootDir), 'annotation-result.png');
    let coverage;
    let coverageError;
    try {
      coverage = await ctx.tools.python('annotation-preview', { image, annotation, font: ctx.runtime.font,
        output: preview, resultOutput: resultPreview }, ctx.processOptions);
    } catch (error) {
      if (error.code !== 'ANNOTATION_COVERAGE_LOW') throw error;
      if (!await fspExists(preview) || !await fspExists(resultPreview) || !Number.isFinite(error.coverageRatio)
        || error.coverageRatio < 0 || error.coverageRatio >= 0.97) {
        throw new WhiteboardError('ANNOTATION_PREVIEW_FAILED', '低覆盖率落墨缺少完整预览或覆盖数据，请继续制作以重新编排本幕。');
      }
      coverage = { ...error.coverage, coverageRatio: error.coverageRatio, regions: annotation.elements.length };
      coverageError = error;
    }
    // 文件和低覆盖率记录必须在同一次受锁保护的发布中保存。
    await ctx.publish(item, {
      annotation: { path: annotationFile, kind: 'annotation', name: `${scene.title}落墨编排`, sceneId: scene.id, mime: 'application/json' },
      preview: { path: preview, kind: 'annotation_preview', name: `${scene.title}区域预览`, sceneId: scene.id, mime: 'image/png' },
      resultPreview: { path: resultPreview, kind: 'annotation_result', name: `${scene.title}当前落墨效果`, sceneId: scene.id, mime: 'image/png' },
    }, (current, files, now) => {
      const media = current.whiteboard.media;
      media.lowCoverage = (media.lowCoverage || []).filter(entry => entry.sceneId !== scene.id);
      const binding = { sceneId: scene.id, inputIdentity, planningContract: models.ANNOTATION_PLANNING_CONTRACT,
        visualGrouping: candidate.visualGrouping, ...files, coverage };
      if (coverageError) {
        media.lowCoverage.push(store.bind({ kind: 'annotation_coverage_review', ...binding,
          title: scene.title, attemptId: item.id, lineartIdentity: lineart.identity,
          narrationIdentity: record.whiteboard.media.current.full_narration.identity, revision }));
      } else media.annotations[scene.id] = store.bind({ kind: 'annotation', ...binding });
      Object.assign(media.attempts.find(row => row.id === item.id), {
        status: coverageError ? 'failed' : 'validated', completedAt: now,
        ...(coverageError ? { errorCode: 'ANNOTATION_COVERAGE_LOW' } : {}),
      });
      if (media.activeAttemptId === item.id) media.activeAttemptId = '';
    });
    if (coverageError) throw coverageError;
    return { reused: false };
  } catch (error) {
    if (item) {
      try {
        await ctx.change((record, now) => {
          const attempt = record.whiteboard.media.attempts.find(row => row.id === item.id);
          if (attempt && attempt.status !== 'validated') Object.assign(attempt, {
            status: error.code === 'UNKNOWN_EXTERNAL_OUTCOME' ? 'unknown_external_outcome' : 'failed',
            errorCode: error.code || 'MEDIA_FAILED', completedAt: now,
          });
          if (record.whiteboard.media.activeAttemptId === item.id) record.whiteboard.media.activeAttemptId = '';
        });
      } catch { /* Deleted or superseded tasks must never be recreated. */ }
    }
    throw error;
  }
}

async function annotationStage(ctx, artifact, timing) {
  if (!timing.scenes.length) throw new WhiteboardError('TIMELINE_INVALID', '没有可编排的分镜。');
  const canvas = canvasFor(artifact.aspectRatio);
  const pool = ctx.annotationPool || annotationPool;
  const signal = ctx.processOptions.signal;
  const state = { total: timing.scenes.length, concurrency: pool.concurrency, completed: 0, failed: 0, reused: 0, active: 0, peakActive: 0 };
  const report = async () => {
    const progress = { ...state, queued: Math.max(0, state.total - state.completed - state.failed - state.active) };
    const message = `正在并发编排落墨：已完成 ${progress.completed}/${progress.total}，处理中 ${progress.active}，等待 ${progress.queued}${progress.failed ? `，失败 ${progress.failed}` : ''}（并发上限 ${progress.concurrency}）。`;
    const updated = await ctx.change((record, now) => {
      record.whiteboard.media.annotationProgress = progress;
      record.message = message;
      record.current_stage_message = message;
      record.updated_at = now;
      const stage = record.whiteboard.media.stages.find(item => item.id === 'annotation_drafting');
      if (stage) Object.assign(stage, { message, updated_at: now });
    });
    await ctx.emitProgress?.({ type: 'stage_progress', stage: 'annotation_drafting', progress: updated?.record?.current_progress || 52, message });
  };
  await report();
  const results = await pool.mapSettled(timing.scenes, async scene => {
    state.active += 1;
    state.peakActive = Math.max(state.peakActive, state.active);
    try {
      await report();
      const result = await annotateSceneCandidate(ctx, artifact, timing, scene, canvas);
      state.completed += 1;
      if (result.reused) state.reused += 1;
      return result;
    } catch (error) { state.failed += 1; throw error; }
    finally { state.active -= 1; await report(); }
  }, { signal });
  const failures = results.map((result, index) => ({ ...result, scene: timing.scenes[index] })).filter(result => result.status === 'rejected');
  state.failed = failures.length;
  await report();
  // UNKNOWN_EXTERNAL_OUTCOME 必须原样上抛：语音与视觉请求是否已计费无法确认时，
  // 任务须进入 unknown_external_outcome 状态等待用户核实，不能被聚合成普通失败。
  const unknown = failures.find(result => result.reason?.code === 'UNKNOWN_EXTERNAL_OUTCOME');
  if (unknown) throw unknown.reason;
  if (signal?.aborted) throw new WhiteboardError('MEDIA_CANCELLED', '落墨编排已取消。');
  const stopped = failures.find(result => ['ENOENT', 'STALE_IDENTITY', 'MEDIA_CANCELLED'].includes(result.reason?.code));
  if (stopped) throw stopped.reason;
  const coverageFailures = failures.filter(result => result.reason?.code === 'ANNOTATION_COVERAGE_LOW');
  if (failures.length) {
    const names = failures.slice(0, 3).map(result => result.scene.title || result.scene.id).join('、');
    if (coverageFailures.length) {
      const coverageNames = coverageFailures.map(result => result.scene.title || result.scene.id).join('、');
      throw new WhiteboardError('ANNOTATION_COVERAGE_LOW', `${coverageNames} 的落墨标注未完整覆盖线稿。`
        + `预览图已在落墨面板生成，请查看后选择接受当前已标注内容或重新编排；遗漏内容不会在末尾突然显示${failures.length > coverageFailures.length ? `。另有 ${failures.length - coverageFailures.length} 幕因其他原因失败` : ''}。`);
    }
    throw new WhiteboardError('ANNOTATION_DRAFT_FAILED', `${failures.length} 幕落墨编排未完成（${names}${failures.length > 3 ? '等' : ''}）。已完成幕已保留，继续制作时会复用有效产物。`);
  }
  const record = await ctx.read();
  await complete(ctx, null, 'annotation_drafting', store.bind({ kind: 'annotation_bundle',
    scenes: timing.scenes.map(scene => record.whiteboard.media.annotations[scene.id]) }));
}

async function renderSceneCandidate(ctx, artifact, scene) {
  let item;
  try {
    const record = await ctx.read();
    if (record.whiteboard.media.scenes[scene.id]) {
      await store.validateBinding(record, record.whiteboard.media.scenes[scene.id], ctx.rootDir);
      return { reused: true };
    }
    const lineart = await store.validateBinding(record, record.whiteboard.media.lineart[scene.id], ctx.rootDir);
    const annotationBinding = await store.validateBinding(record, record.whiteboard.media.annotations[scene.id], ctx.rootDir);
    const annotation = await store.readData(record, annotationBinding.annotation, ctx.rootDir);
    const image = await ctx.filePath(record, lineart.image);
    // 单幕渲染的修订意见不进入模型提示词，但必须参与输入身份：
    // 否则修订后输入身份不变，会被媒体历史复用旧视频，"重新渲染指定幕"形同虚设。
    const inputIdentity = sha256({ lineart: lineart.identity, annotation: annotationBinding.identity, scene,
      showHand: artifact.productionPlan.handDisplayMode === 'show', recipe: record.whiteboard.media.recipe,
      sceneRevision: record.whiteboard.media.overrides[`scene_render:${scene.id}`] || '', revision: record.whiteboard.media.revision });
    if (await reuseHistory(ctx, 'scenes', scene.id, inputIdentity)) return { reused: true };
    item = await ctx.attempt('scene_render', scene.id, false, inputIdentity);
    const directory = store.workDirectory(ctx.workflowId, item.id, ctx.rootDir);
    const output = path.join(directory, 'scene.mp4');
    const validation = await ctx.tools.renderScene({ image, annotation, output, scene, showHand: artifact.productionPlan.handDisplayMode === 'show' }, ctx.runtime, ctx.processOptions);
    const files = { video: { path: output, kind: 'scene_video', name: scene.title, sceneId: scene.id, mime: 'video/mp4' } };
    for (const [index, fraction] of [0.15, 0.55, 0.95].entries()) {
      const preview = path.join(directory, `frame-${index}.png`);
      await ctx.tools.extractFrame(output, preview, (scene.endMs - scene.startMs) * fraction, ctx.runtime, ctx.processOptions);
      files[`frame${index}`] = { path: preview, kind: 'scene_frame', name: `${scene.title}进度帧 ${index + 1}`, sceneId: scene.id, mime: 'image/png' };
    }
    await ctx.publish(item, files, (current, published, now) => {
      current.whiteboard.media.scenes[scene.id] = store.bind({ kind: 'scene_video', sceneId: scene.id, inputIdentity,
        video: published.video, frames: [published.frame0, published.frame1, published.frame2], validation });
      Object.assign(current.whiteboard.media.attempts.find(row => row.id === item.id), { status: 'validated', completedAt: now });
      if (current.whiteboard.media.activeAttemptId === item.id) current.whiteboard.media.activeAttemptId = '';
    });
    return { reused: false };
  } catch (error) {
    if (item) {
      try {
        await ctx.change((record, now) => {
          const attempt = record.whiteboard.media.attempts.find(row => row.id === item.id);
          if (attempt && attempt.status !== 'validated') Object.assign(attempt, { status: 'failed', errorCode: error.code || 'MEDIA_FAILED', completedAt: now });
          if (record.whiteboard.media.activeAttemptId === item.id) record.whiteboard.media.activeAttemptId = '';
        });
      } catch { /* Deleted or superseded tasks must never be recreated. */ }
    }
    throw error;
  }
}

async function sceneStage(ctx, artifact, timing) {
  if (!timing.scenes.length) throw new WhiteboardError('TIMELINE_INVALID', '没有可渲染的分镜。');
  const pool = ctx.sceneRenderPool || sceneRenderPool;
  const signal = ctx.processOptions.signal;
  const state = { total: timing.scenes.length, concurrency: pool.concurrency, completed: 0, failed: 0, reused: 0, active: 0, peakActive: 0 };
  const report = async () => {
    const progress = { ...state, queued: Math.max(0, state.total - state.completed - state.failed - state.active) };
    const message = `正在并发渲染单幕：已完成 ${progress.completed}/${progress.total}，处理中 ${progress.active}，等待 ${progress.queued}${progress.failed ? `，失败 ${progress.failed}` : ''}（并发上限 ${progress.concurrency}）。`;
    const updated = await ctx.change((record, now) => {
      record.whiteboard.media.sceneRenderProgress = progress;
      record.message = message;
      record.current_stage_message = message;
      record.updated_at = now;
      const stage = record.whiteboard.media.stages.find(item => item.id === 'scene_render');
      if (stage) Object.assign(stage, { message, updated_at: now });
    });
    await ctx.emitProgress?.({ type: 'stage_progress', stage: 'scene_render', progress: updated?.record?.current_progress || 68, message });
  };
  await report();
  const results = await pool.mapSettled(timing.scenes, async scene => {
    state.active += 1;
    state.peakActive = Math.max(state.peakActive, state.active);
    try {
      await report();
      const result = await renderSceneCandidate(ctx, artifact, scene);
      state.completed += 1;
      if (result.reused) state.reused += 1;
      return result;
    } catch (error) { state.failed += 1; throw error; }
    finally { state.active -= 1; await report(); }
  }, { signal });
  const failures = results.map((result, index) => ({ ...result, scene: timing.scenes[index] })).filter(result => result.status === 'rejected');
  state.failed = failures.length;
  await report();
  if (signal?.aborted) throw new WhiteboardError('MEDIA_CANCELLED', '单幕渲染已取消。');
  const stopped = failures.find(result => ['ENOENT', 'STALE_IDENTITY', 'MEDIA_CANCELLED'].includes(result.reason?.code));
  if (stopped) throw stopped.reason;
  if (failures.length) {
    const names = failures.slice(0, 3).map(result => result.scene.title || result.scene.id).join('、');
    throw new WhiteboardError('SCENE_RENDER_FAILED', `${failures.length} 幕渲染未完成（${names}${failures.length > 3 ? '等' : ''}）。已完成单幕已保留，继续制作时会复用有效产物。`);
  }
  const record = await ctx.read();
  await complete(ctx, null, 'scene_render', store.bind({ kind: 'scene_bundle', scenes: timing.scenes.map(scene => record.whiteboard.media.scenes[scene.id]) }));
}

async function finalStage(ctx, artifact, timing) {
  const record = await ctx.read();
  const media = record.whiteboard.media;
  for (const stage of store.STAGES.slice(0, -1)) {
    await store.validateBinding(record, media.current[stage.id], ctx.rootDir);
    if (!media.approvals.some(approval => !approval.stale && approval.gate === store.GATES[stage.id]
      && approval.identity === media.current[stage.id].identity)) throw new WhiteboardError('APPROVAL_REQUIRED', '缺少当前上游产物的有效批准，不能合成最终视频。', 409);
  }
  const item = await ctx.attempt('final_delivery', '', false, sha256({ scenes: media.current.scene_render.identity,
    narration: media.current.full_narration.identity, recipe: media.recipe, burnSubtitles: artifact.productionPlan.burnSubtitles }));
  const directory = store.workDirectory(ctx.workflowId, item.id, ctx.rootDir);
  const sceneFiles = [];
  for (const scene of timing.scenes) sceneFiles.push(await ctx.filePath(record, media.scenes[scene.id].video));
  const audioFile = media.current.full_narration.audio ? await ctx.filePath(record, media.current.full_narration.audio) : null;
  const validation = await ctx.tools.finalVideo({ sceneFiles, audioFile, cues: timing.captions,
    durationMs: timing.durationMs, directory, burnSubtitles: artifact.productionPlan.burnSubtitles }, ctx.runtime, ctx.processOptions);
  const poster = path.join(directory, 'poster.png');
  await ctx.tools.extractFrame(path.join(directory, 'final.mp4'), poster, Math.min(timing.durationMs - 100, timing.captions[0].endMs - 50), ctx.runtime, ctx.processOptions);
  const receipt = await ctx.jsonFile(item, 'technical-validation.json', { ...validation, recipe: media.recipe,
    narrationIdentity: media.current.full_narration.identity, sceneBundleIdentity: media.current.scene_render.identity });
  await ctx.publish(item, {
    video: { path: path.join(directory, 'final.mp4'), kind: 'final_video', name: '最终白板视频', mime: 'video/mp4' },
    poster: { path: poster, kind: 'final_poster', name: '成片预览', mime: 'image/png' },
    receipt: { path: receipt, kind: 'technical_validation', name: '技术验证记录', mime: 'application/json' },
  }, (current, published) => {
    current.whiteboard.media.current.final_delivery = store.bind({ kind: 'final_video', inputIdentity: item.inputIdentity,
      ...published, validation, narrationIdentity: media.current.full_narration.identity, sceneBundleIdentity: media.current.scene_render.identity });
    current.result = { render: { output_url: `/api/creative-workflows/${ctx.workflowId}/whiteboard/media/${published.video.id}` } };
  });
  const updated = await ctx.read();
  await complete(ctx, item, 'final_delivery', updated.whiteboard.media.current.final_delivery);
}

async function reviewGate(ctx, artifact) {
  const record = await ctx.read();
  const media = record.whiteboard.media;
  if (['full_narration', 'final_delivery'].includes(media.stage)) return true;
  const binding = await store.validateBinding(record, media.current[media.stage], ctx.rootDir);
  const images = [];
  const sceneContexts = [];
  for (const scene of binding.scenes) {
    const files = media.stage === 'lineart_generation' ? [scene.image] : media.stage === 'annotation_drafting' ? [scene.preview] : scene.frames;
    const plan = artifact.scenes.find(item => item.id === scene.sceneId);
    const context = { sceneId: scene.sceneId, title: plan?.title,
      narration: artifact.cues.filter(cue => plan?.cueIds.includes(cue.id)).map(cue => cue.text).join('\n') };
    if (media.stage === 'annotation_drafting') {
      const annotation = await store.readData(record, scene.annotation, ctx.rootDir);
      context.visualGrouping = scene.visualGrouping || null;
      context.canvas = annotation.canvas;
      context.elements = annotation.elements;
    }
    for (const file of files) {
      images.push(await ctx.filePath(record, file));
      sceneContexts.push(context);
    }
  }
  // Bound the image context per call while keeping every scene/frame in the review.
  for (let offset = 0; offset < images.length; offset += 6) {
    const subset = images.slice(offset, offset + 6);
    const contexts = sceneContexts.slice(offset, offset + 6);
    const annotationSceneIds = media.stage === 'annotation_drafting' ? contexts.map(scene => scene.sceneId) : [];
    const annotationInstructions = annotationSceneIds.length
      ? '逐幕独立检查实际图像，候选 visualGrouping 仅是待核实说明。多个可独立揭示的视觉簇被一个大框合并时，groupsMatchImage=false；切断连续主体、边界横穿有效墨迹或遗漏主体也必须为 false。真正不可分割的构图允许单区域，不能强制拆成 2–3 个。核对 elements 的顺序与该幕旁白事件，错序时 orderMatchesNarration=false。覆盖率高不代表分组正确。sceneReviews 必须逐幕返回 {sceneId,groupsMatchImage,orderMatchesNarration,reason}，reason 需用 8–600 字说明具体视觉依据。'
      : '';
    const item = await ctx.attempt(`review_${media.stage}`, '', true, binding.identity);
    const findings = await models.structuredVision({ textConfig: ctx.config, images: subset, services: ctx.services,
      onRequest: () => ctx.requesting(item.id),
      validate: candidate => models.validateVisualReview(candidate, { imageCount: subset.length, annotationSceneIds }),
      reasoningEffort: annotationSceneIds.length ? 'medium' : 'low',
      prompt: `检查全部 ${subset.length} 张当前白板图像。阶段 ${media.stage}。${media.stage === 'scene_render' ? '这里是各幕按早、中、晚顺序抽取的真实渲染帧，不是完整视频；结合逐帧解码已通过的事实检查可见遮挡、逐步揭示与结尾画面，不声称完整观看或试听。' : '检查内容是否符合方案、字形是否清晰、构图与区域边界是否合理。'}\n${annotationInstructions}\n内容方案：${artifact.summary}\n按图像输入顺序的逐幕上下文：${JSON.stringify(contexts)}\n返回 JSON，包含 passed 布尔值、具体中文 summary、issues 字符串数组、imageCount=${subset.length}${annotationSceneIds.length ? '，以及 sceneReviews 数组' : ''}。按实际观察决定是否通过，存在严重问题时 passed=false 并具体说明，不能给出批准或修改状态。`,
    });
    const issues = annotationSceneIds.length ? models.annotationReviewIssues(findings) : findings.issues;
    const resultFile = await ctx.jsonFile(item, 'findings.json', findings);
    await ctx.publish(item, { findings: { path: resultFile, kind: 'visual_findings', name: '视觉检查记录', mime: 'application/json' } }, (current, files, now) => {
      Object.assign(current.whiteboard.media.attempts.find(row => row.id === item.id), { status: 'validated', completedAt: now });
      current.whiteboard.media.activeAttemptId = '';
      if (!findings.passed || issues.length) {
        current.message = `视觉检查建议你确认或修改：${issues.join('；') || findings.summary}`;
        current.current_stage_message = current.message;
        current.whiteboard.messages.push({ id: require('crypto').randomUUID(), role: 'assistant', text: current.message, createdAt: now });
      }
    });
    if (!findings.passed || issues.length) return false;
  }
  return true;
}

module.exports = { narrationStage, lineartStage, annotationStage, sceneStage, finalStage, reviewGate };
