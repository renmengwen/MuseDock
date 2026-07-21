function createAgentRunsFreeformWorkflow({
  fsp,
  path,
  crypto,
  mediaPipeline,
  narrationQuality,
  storyboardTiming,
  defaultAiTextModel,
  defaultSceneTts,
  defaultHyperframesSkillContext,
  defaultHyperframesFreeformAgent,
  defaultCreativeVideoWorkflowFacade,
  getLogger,
  logEvent,
  getDouyinAgentRun,
  getRunPath,
  writeJson,
  readJsonIfExists,
  getTtsFileName,
  getTtsUrl,
  getAgentRunsDir,
  normalizeFreeformNarrationScenes,
  resolveFreeformTargetDurationSec,
  replaceFreeformBriefScenes,
  fitFreeformNarrationToBudget,
  compressFreeformNarrationWithModel,
  repairFreeformNarrationWithModel,
  mapFreeformProjectFilesToDir,
  buildHtmlVideoExportFileUrl,
} = {}) {
  const runUpdateQueues = new Map();

  function createDefaultHyperframesFreeformState(overrides = {}) {

    return {

      mode: 'builtin_skill_context',

      agent_runtime: null,

      status: 'idle',

      project_dir: '',

      brief: {

        status: 'idle',

        design_path: '',

        summary: '',

        message: '',

      },

      audio: {

        status: 'idle',

        path: '',

        url: '',

        file_name: '',

        format: '',

        duration: 0,

        captions: [],

        phrase_captions: [],

        voice: '',

        style_prompt: '',

        message: '',

      },

      project: {

        status: 'idle',

        index_path: '',

        files: [],

        message: '',

      },

      checks: {

        status: 'idle',

        lint: 'pending',

        validate: 'pending',

        inspect: 'pending',

        message: '',

      },

      render: {

        status: 'idle',

        output_path: '',

        output_url: '',

        message: '',

      },

      visual_inspect: {

        status: 'idle',

        contact_sheet_path: '',

        contact_sheet_url: '',

        issues: [],

        message: '',

      },

      ...overrides,

    };

  }



  function normalizeHyperframesFreeformState(value = {}) {

    const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

    const defaults = createDefaultHyperframesFreeformState();

    return {

      ...defaults,

      ...current,

      brief: { ...defaults.brief, ...(current.brief || {}) },

      audio: { ...defaults.audio, ...(current.audio || {}) },

      project: { ...defaults.project, ...(current.project || {}) },

      checks: { ...defaults.checks, ...(current.checks || {}) },

      render: { ...defaults.render, ...(current.render || {}) },

      visual_inspect: { ...defaults.visual_inspect, ...(current.visual_inspect || {}) },

    };

  }



  function isPlainObject(value) {

    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  }



  function deepMergePlainObject(base, patch) {

    if (!isPlainObject(base) || !isPlainObject(patch)) return patch;

    const merged = { ...base };

    for (const [key, value] of Object.entries(patch)) {

      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;

      merged[key] = isPlainObject(value) && isPlainObject(base[key])

        ? deepMergePlainObject(base[key], value)

        : value;

    }

    return merged;

  }



  function mergeHyperframesFreeformPatch(current, patch) {

    const safePatch = isPlainObject(patch) ? patch : {};

    return deepMergePlainObject(current, safePatch);

  }



  function createFreeformOperationId(prefix = 'op') {

    const stamp = new Date().toISOString().replace(/[^A-Za-z0-9_.-]/g, '-');

    return `${prefix}-${stamp}-${crypto.randomBytes(3).toString('hex')}`;

  }



  function getRunUpdateQueueKey(awemeId, runId, rootDir) {

    return `${rootDir || ''}:${String(awemeId)}:${String(runId)}`;

  }



  async function withRunUpdateQueue(awemeId, runId, options, task) {

    const key = getRunUpdateQueueKey(awemeId, runId, options.rootDir);

    const previous = runUpdateQueues.get(key) || Promise.resolve();

    let release;

    const current = new Promise(resolve => {

      release = resolve;

    });

    const queued = previous.then(() => current, () => current);

    runUpdateQueues.set(key, queued);

    try {

      await previous.catch(() => {});

      return await task();

    } finally {

      release();

      if (runUpdateQueues.get(key) === queued) {

        runUpdateQueues.delete(key);

      }

    }

  }



  async function getCurrentHyperframesFreeformState(awemeId, runId, options = {}) {

    const detail = await getDouyinAgentRun(awemeId, runId, options);

    if (!detail.success) return detail;

    return {

      success: true,

      data: detail.data,

      hyperframes_freeform: normalizeHyperframesFreeformState(detail.data.hyperframes_freeform),

    };

  }



  async function updateRunHyperframesFreeformIfOperationCurrent(awemeId, runId, section, operationId, updater, options = {}) {

    return withRunUpdateQueue(awemeId, runId, options, async () => {

      const detail = await getDouyinAgentRun(awemeId, runId, options);

      if (!detail.success) return detail;



      const current = normalizeHyperframesFreeformState(detail.data.hyperframes_freeform);

      if (current?.[section]?.operation_id !== operationId) {

        return {

          success: false,

          stale: true,

          aweme_id: String(awemeId),

          run_id: String(runId),

          message: '已有更新的生成任务完成，已忽略旧结果。',

          run: detail.data,

          hyperframes_freeform: current,

        };

      }



      const patch = typeof updater === 'function' ? await updater(current, detail.data) : updater;

      const nextState = normalizeHyperframesFreeformState(mergeHyperframesFreeformPatch(current, patch));

      const updatedRun = {

        ...detail.data,

        hyperframes_freeform: nextState,

        updated_at: new Date().toISOString(),

      };

      const runPath = getRunPath(awemeId, runId, options.rootDir);

      await writeJson(runPath, updatedRun);

      return {

        success: true,

        aweme_id: String(awemeId),

        run_id: String(runId),

        data: updatedRun,

      };

    });

  }



  async function getDouyinRunHyperframesFreeformState(awemeId, runId, options = {}) {

    const detail = await getDouyinAgentRun(awemeId, runId, options);

    if (!detail.success) return detail;

    return {

      success: true,

      aweme_id: awemeId,

      run_id: runId,

      hyperframes_freeform: normalizeHyperframesFreeformState(detail.data.hyperframes_freeform),

    };

  }



  async function updateRunHyperframesFreeform(awemeId, runId, updater, options = {}) {

    return withRunUpdateQueue(awemeId, runId, options, async () => {

      const detail = await getDouyinAgentRun(awemeId, runId, options);

      if (!detail.success) return detail;



      const current = normalizeHyperframesFreeformState(detail.data.hyperframes_freeform);

      const patch = typeof updater === 'function' ? updater(current, detail.data) : updater;

      const nextState = normalizeHyperframesFreeformState(mergeHyperframesFreeformPatch(current, patch));

      const updatedRun = {

        ...detail.data,

        hyperframes_freeform: nextState,

        updated_at: new Date().toISOString(),

      };

      const runPath = getRunPath(awemeId, runId, options.rootDir);

      await writeJson(runPath, updatedRun);

      return {

        success: true,

        aweme_id: String(awemeId),

        run_id: String(runId),

        data: updatedRun,

      };

    });

  }



  function createFreeformFailureResponse(awemeId, runId, state, message, extra = {}) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message,
      hyperframes_freeform: state,
      ...(extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {}),
    };
  }


  async function markFreeformBriefFailed(awemeId, runId, message, options = {}, operationId = '', logMeta = {}) {

    const update = operationId

      ? updater => updateRunHyperframesFreeformIfOperationCurrent(awemeId, runId, 'brief', operationId, updater, options)

      : updater => updateRunHyperframesFreeform(awemeId, runId, updater, options);

    const updated = await update(current => ({

      status: 'failed',

      brief: {

        ...current.brief,

        status: 'failed',

        message,

      },

    }), options);

    logEvent(getLogger(options), 'warn', {

      event: 'hyperframes_freeform_brief',

      stage: 'failed',

      aweme_id: String(awemeId),

      run_id: String(runId),

      operation_id: operationId,

      message: updated.message || message,

      ...logMeta,

    });

    return createFreeformFailureResponse(

      awemeId,

      runId,

      updated.success ? updated.data.hyperframes_freeform : updated.hyperframes_freeform || null,

      updated.message || message,

    );

  }



  async function markFreeformProjectFailed(awemeId, runId, message, options = {}, operationId = '', failureMeta = {}) {
    const meta = failureMeta && typeof failureMeta === 'object' && !Array.isArray(failureMeta) ? failureMeta : {};
    const update = operationId
      ? updater => updateRunHyperframesFreeformIfOperationCurrent(awemeId, runId, 'project', operationId, updater, options)
      : updater => updateRunHyperframesFreeform(awemeId, runId, updater, options);
    const updated = await update(current => ({
      status: 'failed',
      project: {
        ...current.project,
        ...meta,
        status: 'failed',
        message,
      },
    }), options);

    return createFreeformFailureResponse(

      awemeId,

      runId,
      updated.success ? updated.data.hyperframes_freeform : updated.hyperframes_freeform || null,
      updated.message || message,
      meta,
    );
  }













  function getCaptionDuration(captions = []) {
    return captions.reduce((max, caption) => Math.max(max, Number(caption?.end || 0)), 0);

  }



  function createFreeformAudioValue({ sceneTtsValue = {}, timedPlan = {}, awemeId, runId, voice = '', stylePrompt = '', fallbackMessage = '' }) {

    const fileName = sceneTtsValue.file_name || (sceneTtsValue.path ? path.basename(sceneTtsValue.path) : getTtsFileName(runId, sceneTtsValue.format || 'wav'));

    const captions = Array.isArray(timedPlan.captions) ? timedPlan.captions : [];

    const phraseCaptions = Array.isArray(timedPlan.phrase_captions) ? timedPlan.phrase_captions : [];

    const duration = Number(timedPlan.duration || sceneTtsValue.duration || getCaptionDuration(captions) || 0);

    return {

      ...(sceneTtsValue || {}),

      status: 'ready',

      voice: sceneTtsValue.voice || voice || '',

      style_prompt: sceneTtsValue.style_prompt || stylePrompt || '',

      format: sceneTtsValue.format || 'wav',

      path: sceneTtsValue.path || '',

      file_name: fileName,

      url: fileName ? getTtsUrl(awemeId, runId, fileName) : '',

      duration,

      captions,

      phrase_captions: phraseCaptions,

      segments: Array.isArray(sceneTtsValue.scenes) ? sceneTtsValue.scenes : [],

      message: sceneTtsValue.message || fallbackMessage || '高级成片音频已生成。',

      updated_at: sceneTtsValue.updated_at || new Date().toISOString(),

    };

  }



  function getFreeformBriefAudioDirection(brief = {}) {

    const direction = isPlainObject(brief?.audio_direction) ? brief.audio_direction : {};

    const voice = String(

      direction.voice

      || brief?.voice

      || brief?.tts_voice

      || '',

    ).trim();

    const stylePrompt = String(

      direction.style_prompt

      || direction.stylePrompt

      || direction.delivery_prompt

      || direction.prompt

      || brief?.audio_style_prompt

      || brief?.tts_style_prompt

      || '',

    ).trim();

    return { voice, stylePrompt };

  }



  async function synthesizeDouyinRunHyperframesFreeformAudio(awemeId, runId, options = {}) {

    const detail = await getDouyinAgentRun(awemeId, runId, options);

    if (!detail.success) return detail;



    const currentState = normalizeHyperframesFreeformState(detail.data.hyperframes_freeform);

    if (

      currentState.brief.status !== 'ready'

      || !currentState.brief.data

      || typeof currentState.brief.data !== 'object'

      || Array.isArray(currentState.brief.data)

    ) {

      return failHyperframesFreeformSection(awemeId, runId, 'audio', '请先生成导演策划。', options);

    }



    let scenes = normalizeFreeformNarrationScenes(currentState.brief.data);
    if (!scenes.length) {
      return failHyperframesFreeformSection(awemeId, runId, 'audio', '导演策划中没有可用于配音的旁白。', options);
    }
    const targetDurationSec = resolveFreeformTargetDurationSec(currentState.brief.data, detail.data, options);
    let narrationFit = fitFreeformNarrationToBudget(currentState.brief.data, scenes, targetDurationSec);
    scenes = narrationFit.scenes;
    let transcript = null;
    if (narrationFit.needsCompression) {
      transcript = await readJsonIfExists(mediaPipeline.getMediaPaths(awemeId, options.rootDir).transcript);
      const compression = await compressFreeformNarrationWithModel({
        modelService: options.aiTextModel || defaultAiTextModel,
        freeformAgent: options.hyperframesFreeformAgent || defaultHyperframesFreeformAgent,
        scenes,
        budget: narrationFit.budget,
        transcriptText: transcript?.text || '',
        targetDurationSec,
      });
      if (!compression.success) {
        return failHyperframesFreeformSection(
          awemeId,
          runId,
          'audio',
          `口播超过目标时长，自动压缩失败：${compression.message || '未知错误'}`,
          options,
          { narration_budget: compression.budget || narrationFit.budget },
        );
      }
      scenes = compression.scenes;
      narrationFit = {
        scenes,
        brief: replaceFreeformBriefScenes(currentState.brief.data, scenes, compression.budget),
        budget: compression.budget,
        changed: true,
      };
    }
    let narrationValidation = narrationQuality.validateNarrationScenes(scenes);
    if (!narrationValidation.ok) {
      transcript = transcript || await readJsonIfExists(mediaPipeline.getMediaPaths(awemeId, options.rootDir).transcript);
      const repair = await repairFreeformNarrationWithModel({
        modelService: options.aiTextModel || defaultAiTextModel,
        freeformAgent: options.hyperframesFreeformAgent || defaultHyperframesFreeformAgent,
        scenes,
        issues: narrationValidation.issues,
        transcriptText: transcript?.text || '',
        targetDurationSec,
      });
      if (repair.success) {
        scenes = repair.scenes;
        narrationFit = {
          ...narrationFit,
          scenes,
          brief: replaceFreeformBriefScenes(narrationFit.brief, scenes, narrationFit.budget),
          changed: true,
        };
        narrationValidation = narrationQuality.validateNarrationScenes(scenes);
      }
    }
    if (!narrationValidation.ok) {
      return failHyperframesFreeformSection(
        awemeId,
        runId,
        'audio',
        narrationValidation.message,
        options,
        { narration_issues: narrationValidation.issues },
      );
    }

    const operationId = createFreeformOperationId('audio');
    await updateRunHyperframesFreeform(awemeId, runId, current => ({
      status: 'generating',
      brief: {
        ...current.brief,
        data: narrationFit.brief,
      },
      audio: {
        ...current.audio,
        operation_id: operationId,
        status: 'generating',
        voice: options.voice || current.audio.voice || '',
        style_prompt: options.stylePrompt || options.style_prompt || current.audio.style_prompt || '',
        message: narrationFit.changed
          ? '口播超过目标时长，已先压缩旁白并正在生成高级成片音频...'
          : '正在生成高级成片音频...',
      },
    }), options);


    const sceneTtsService = options.sceneTtsService || defaultSceneTts;

    const audioDirection = getFreeformBriefAudioDirection(currentState.brief.data);

    const resolvedVoice = options.voice || audioDirection.voice || undefined;

    const resolvedStylePrompt = options.stylePrompt || options.style_prompt || audioDirection.stylePrompt || undefined;

    let result;

    try {

      result = await sceneTtsService.synthesizeSceneTts({

        scenes,

        outputDir: getAgentRunsDir(awemeId, options.rootDir),

        runId,

        voice: resolvedVoice,

        stylePrompt: resolvedStylePrompt,

        format: options.format || 'wav',
        ttsModel: options.ttsModel,
        readAudioDuration: options.readAudioDuration,
        audioQuality: options.audioQuality,
        runCommand: options.runCommand,
        getFfprobeCommand: options.getFfprobeCommand,
        getFfmpegCommand: options.getFfmpegCommand,
        audioDurationOptions: options.audioDurationOptions,
        concatenateAudioFiles: options.concatenateAudioFiles,
        configPath: options.configPath,
        ttsConfig: options.ttsConfig,
        fetchImpl: options.fetchImpl,

        waitImpl: options.waitImpl,

        maxRetries: options.maxRetries,

        retryDelayMs: options.retryDelayMs,

        ttsConcurrency: options.ttsConcurrency,

        ttsQueueIntervalMs: options.ttsQueueIntervalMs,

      });

    } catch (error) {

      result = {

        success: false,

        message: `高级成片音频生成失败：${error.message || '未知错误'}`,

      };

    }



    if (!result?.success) {

      return failHyperframesFreeformSection(

        awemeId,

        runId,

        'audio',

        result?.message || '高级成片音频生成失败。',

        options,

        { operation_id: operationId },

      );

    }



    const sceneTtsValue = {

      ...(result.scene_tts || {}),

      status: result.scene_tts?.status || 'done',

      message: result.message || result.scene_tts?.message || '高级成片音频已生成。',

      updated_at: result.scene_tts?.updated_at || new Date().toISOString(),

    };

    const timedPlan = storyboardTiming.buildTimedStoryboardPlan({
      storyboardPlan: {
        target_duration_sec: targetDurationSec,
        scenes,
      },
      sceneTts: sceneTtsValue,
    });
    const audio = createFreeformAudioValue({

      sceneTtsValue,

      timedPlan,

      awemeId,

      runId,

      voice: resolvedVoice,

      stylePrompt: resolvedStylePrompt,

      fallbackMessage: result.message,

    });



    const updated = await updateRunHyperframesFreeformIfOperationCurrent(awemeId, runId, 'audio', operationId, current => ({

      status: 'ready',

      audio: {

        ...current.audio,

        ...audio,

        operation_id: operationId,

      },

    }), options);



    return createHyperframesFreeformOperationResponse(awemeId, runId, 'audio', updated, true, audio.message);

  }



  async function generateDouyinRunHyperframesFreeformBrief(awemeId, runId, options = {}) {

    const detail = await getDouyinAgentRun(awemeId, runId, options);

    if (!detail.success) return detail;



    const operationId = createFreeformOperationId('brief');

    const logger = getLogger(options);

    const startedAt = Date.now();

    const baseLog = {

      event: 'hyperframes_freeform_brief',

      aweme_id: String(awemeId),

      run_id: String(runId),

      operation_id: operationId,

    };

    const elapsedMeta = () => ({ elapsed_ms: Date.now() - startedAt });

    logEvent(logger, 'info', { ...baseLog, stage: 'started' });

    await updateRunHyperframesFreeform(awemeId, runId, current => ({

      status: 'generating',

      brief: {

        ...current.brief,

        status: 'generating',

        operation_id: operationId,

        message: '正在生成导演策划...',

      },

    }), options);



    const skillContext = options.skillContext || defaultHyperframesSkillContext;

    let context;

    try {

      context = await skillContext.loadHyperframesSkillContext({

        skillRoot: options.skillRoot,

        maxChars: options.skillContextMaxChars,

        env: options.env,

      });

    } catch (error) {

      context = {

        success: false,

        message: `读取 HyperFrames skill 上下文失败：${error.message || '未知错误'}`,

      };

    }

    if (!context.success) {

      const message = context.message || '读取 HyperFrames skill 上下文失败。';

      logEvent(logger, 'warn', { ...baseLog, stage: 'skill_context_failed', message, ...elapsedMeta() });

      return markFreeformBriefFailed(awemeId, runId, message, options, operationId, elapsedMeta());

    }

    logEvent(logger, 'info', {

      ...baseLog,

      stage: 'skill_context_loaded',

      source_dir: context.source_dir || '',

      prompt_context_chars: String(context.prompt_context || '').length,

      ...elapsedMeta(),

    });



    const freeformAgent = options.hyperframesFreeformAgent || defaultHyperframesFreeformAgent;

    let messages;

    try {

      messages = freeformAgent.buildFreeformBriefMessages({

        run: detail.data,

        skillContext: context.prompt_context,

        options: options.briefOptions || {},

      });

    } catch (error) {

      const message = `导演策划生成失败：${error.message || '构建提示失败'}`;

      logEvent(logger, 'error', { ...baseLog, stage: 'build_messages_failed', message, ...elapsedMeta() });

      return markFreeformBriefFailed(

        awemeId,

        runId,

        message,

        options,

        operationId,

        elapsedMeta(),

      );

    }

    logEvent(logger, 'info', { ...baseLog, stage: 'messages_built', message_count: messages.length, ...elapsedMeta() });

    const modelService = options.aiTextModel || defaultAiTextModel;

    let modelResult;

    try {

      logEvent(logger, 'info', { ...baseLog, stage: 'model_request_started', stream: true, temperature: 0.35, ...elapsedMeta() });

      modelResult = await modelService.callTextModel({

        messages,

        temperature: 0.35,

        stream: true,

        fallbackToNonStreamOnGatewayTimeout: true,

        configPath: options.configPath,

        textConfig: options.textConfig,

        fetchImpl: options.fetchImpl,

        maxRetries: options.maxRetries,

        requestTimeoutMs: 300000,

        streamChunkTimeoutMs: 120000,

        logger,

      });

    } catch (error) {

      logEvent(logger, 'error', { ...baseLog, stage: 'model_request_threw', message: error.message || '模型调用失败', ...elapsedMeta() });

      modelResult = {

        success: false,

        message: error.message || '模型调用失败',

      };

    }



    if (!modelResult.success) {

      const message = modelResult.message || '导演策划生成失败。';

      logEvent(logger, 'warn', {

        ...baseLog,

        stage: 'model_failed',

        message,

        configured: modelResult.configured,

        model: modelResult.model,

        ...elapsedMeta(),

      });

      return markFreeformBriefFailed(awemeId, runId, message, options, operationId, elapsedMeta());

    }

    logEvent(logger, 'info', {

      ...baseLog,

      stage: 'model_succeeded',

      text_chars: String(modelResult.text || modelResult.raw_output || '').length,

      model: modelResult.model,

      ...elapsedMeta(),

    });



    let parsed;

    try {

      parsed = freeformAgent.parseFreeformBriefResponse(modelResult.text || modelResult.raw_output || '');

    } catch (error) {

      const message = `导演策划解析失败：${error.message || '解析失败'}`;

      logEvent(logger, 'error', { ...baseLog, stage: 'parse_threw', message, ...elapsedMeta() });

      return markFreeformBriefFailed(

        awemeId,

        runId,

        message,

        options,

        operationId,

        elapsedMeta(),

      );

    }

    if (!parsed.success) {

      const rawText = String(modelResult.text || modelResult.raw_output || '');

      const message = parsed.message || '解析导演策划失败。';

      logEvent(logger, 'warn', {

        ...baseLog,

        stage: 'parse_failed',

        message,

        raw_text_preview: rawText.slice(0, 500),

        raw_text_length: rawText.length,

        ...elapsedMeta(),

      });

      return markFreeformBriefFailed(awemeId, runId, message, options, operationId, elapsedMeta());

    }

    logEvent(logger, 'info', {

      ...baseLog,

      stage: 'parsed',

      title: parsed.brief.title || '',

      has_design_md: typeof parsed.brief.design_md === 'string' && parsed.brief.design_md.trim().length > 0,

      ...elapsedMeta(),

    });



    const summary = parsed.brief.summary || parsed.brief.title || '导演策划已生成。';

    const updated = await updateRunHyperframesFreeformIfOperationCurrent(awemeId, runId, 'brief', operationId, current => ({

      status: 'ready',

      brief: {

        ...current.brief,

        status: 'ready',

        operation_id: operationId,

        summary,

        data: parsed.brief,

        message: '导演策划已生成。',

      },

    }), options);



    if (!updated.success) {

      logEvent(logger, 'warn', {

        ...baseLog,

        stage: 'stale_result',

        message: updated.message || '已有更新的生成任务完成，已忽略旧结果。',

        ...elapsedMeta(),

      });

      return {

        success: false,

        aweme_id: String(awemeId),

        run_id: String(runId),

        message: updated.message || '已有更新的生成任务完成，已忽略旧结果。',

        hyperframes_freeform: updated.hyperframes_freeform,

      };

    }



    logEvent(logger, 'info', {

      ...baseLog,

      stage: 'completed',

      summary,

      ...elapsedMeta(),

    });



    return {

      success: true,

      aweme_id: String(awemeId),

      run_id: String(runId),

      message: '导演策划已生成。',

      hyperframes_freeform: updated.data.hyperframes_freeform,

    };

  }



  async function generateDouyinRunHyperframesFreeformProject(awemeId, runId, options = {}) {

    const detail = await getDouyinAgentRun(awemeId, runId, options);

    if (!detail.success) return detail;



    const currentState = normalizeHyperframesFreeformState(detail.data.hyperframes_freeform);

    if (

      currentState.brief.status !== 'ready'

      || !currentState.brief.data

      || typeof currentState.brief.data !== 'object'

      || Array.isArray(currentState.brief.data)

    ) {

      return markFreeformProjectFailed(awemeId, runId, '请先生成导演策划。', options);

    }



    const operationId = createFreeformOperationId('project');

    const logger = getLogger(options);

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

    await updateRunHyperframesFreeform(awemeId, runId, current => ({

      status: 'generating',

      project: {

        ...current.project,

        status: 'generating',

        operation_id: operationId,

        message: '正在生成 HyperFrames 工程...',

      },

    }), options);



    if (options.useLegacyFreeformProject === true) {
      return markFreeformProjectFailed(
        awemeId,
        runId,
        '旧 HyperFrames/freeform 工程生成入口已禁用，请使用 html-video production 生成工程。',
        options,
        operationId,
        {
          render_mode: 'html-video',
          fallback_allowed: false,
          retryable: false,
        },
      );
    }

      const facade = options.creativeVideoWorkflowFacade || defaultCreativeVideoWorkflowFacade;

      const workflowId = String(options.workflowId || awemeId);

      let result;

      const optionCreativeContext = options.projectOptions?.creative_context

        && typeof options.projectOptions.creative_context === 'object'

        && !Array.isArray(options.projectOptions.creative_context)

        ? options.projectOptions.creative_context

        : {};

      try {

        result = await facade.generateCreativeVideoProject({

          workflowId,

          runId: String(runId),

          creativeContext: {

            ...optionCreativeContext,

            run: detail.data,

            brief: currentState.brief.data || {},

            audio: currentState.audio || {},

            input: optionCreativeContext.input || options.creativeContextInput || {},

          },

          target: options.projectOptions || {},

          rootDir: options.rootDir,

          services: options.creativeVideoServices || {},

          skipValidation: options.skipValidation === true,

          onProgress: event => {

            if (!onProgress) return undefined;

            return Promise.resolve()

              .then(() => onProgress({ stage: 'project', ...event }))

              .catch(() => undefined);

          },

        });

      } catch (error) {

        result = {

          success: false,

          message: `html-video lite 成片失败：${error.message || '未知错误'}`,

        };

      }
      if (!result.success) {
        return markFreeformProjectFailed(
          awemeId,
          runId,
          result.message || 'html-video lite 成片失败。',
          options,
          operationId,
          {
            render_mode: result.render_mode || '',
            project_dir: result.project_dir || result.html_video_project_path || '',
            html_video_project_path: result.html_video_project_path || result.project_dir || '',
            html_video_diagnostics: result.html_video_diagnostics || result.diagnostics || [],
            diagnostics: result.diagnostics || result.html_video_diagnostics || [],
            fallback_allowed: result.fallback_allowed,
            retryable: result.retryable,
          },
        );
      }
      const renderMode = result.render_mode || '';

      const isHtmlVideoProduction = renderMode === 'html-video';

      const htmlVideoProjectPath = isHtmlVideoProduction

        ? (result.html_video_project_path || result.project_dir || '')

        : '';

      const projectDir = htmlVideoProjectPath || result.project_dir || '';

      const latestExport = Array.isArray(result.project?.exports) ? result.project.exports.at(-1) : null;

      const outputUrl = latestExport?.id

        ? buildHtmlVideoExportFileUrl(workflowId, latestExport.id)

        : '';

      const updated = await updateRunHyperframesFreeformIfOperationCurrent(awemeId, runId, 'project', operationId, current => ({

        status: 'ready',

        project_dir: projectDir,

        project: {

          ...current.project,

          status: 'ready',

          operation_id: operationId,

          message: result.message || 'html-video lite 工程已生成。',

          project_dir: projectDir,

          html_video_project_path: htmlVideoProjectPath,

          render_mode: renderMode,

          html_video_diagnostics: result.html_video_diagnostics || result.diagnostics || [],

          files: mapFreeformProjectFilesToDir((result.files || []).map(name => ({ name })), projectDir),

          scene_spec: result.scene_spec,

          frame_specs: result.frame_specs,

          asset_usage_report: result.project?.asset_usage_report || current.project?.asset_usage_report || null,

        },

        audio: {

          ...current.audio,

          status: 'ready',

          manifest: result.audio_manifest,

        },

        render: {

          ...current.render,

          status: 'rendered',

          output_path: result.output_path,

          output_url: outputUrl,

          render_mode: renderMode,

          render_versions: [{

            id: `${runId}-html-video-lite`,

            status: 'rendered',

            output_path: result.output_path,

            output_url: outputUrl,

            message: '渲染完成。',

            created_at: new Date().toISOString(),

          }],

          message: '渲染完成。',

        },

        visual_inspect: {

          ...current.visual_inspect,

          // P1-6：warnings 非阻断透出——有观察告警时 status/message/warnings 一并投影
          ...buildFreeformVisualInspectProjection(result.visual_report),

        },

      }), options);

      if (!updated.success) {

        return createFreeformFailureResponse(

          awemeId,

          runId,

          updated.hyperframes_freeform || null,

          updated.message || '已有更新的生成任务完成，已忽略旧结果。',

        );

      }

      return {

        success: true,

        aweme_id: String(awemeId),

        run_id: String(runId),

        message: result.message || 'html-video lite 成片完成。',

        hyperframes_freeform: updated.data.hyperframes_freeform,

      };

  }

  async function failHyperframesFreeformSection(awemeId, runId, section, message, options = {}, extraPatch = {}) {
    const updated = await updateRunHyperframesFreeform(awemeId, runId, current => ({
      [section]: {
        ...current[section],
        ...extraPatch,
        status: 'failed',
        message,
      },
    }), options);
    return createFreeformFailureResponse(
      awemeId,
      runId,
      updated.success ? updated.data.hyperframes_freeform : updated.hyperframes_freeform || null,
      updated.message || message,
    );
  }

  function isHyperframesFreeformSectionSuccessful(section, state) {
    const status = state?.[section]?.status || '';
    if (section === 'checks') return status === 'passed';
    if (section === 'render') return status === 'rendered';
    if (section === 'visual_inspect') return status === 'passed' || status === 'passed_with_warnings';
    return status === 'ready' || status === 'done' || status === 'passed';
  }

  function createHyperframesFreeformOperationResponse(awemeId, runId, section, updated, fallbackSuccess, fallbackMessage) {
    const state = updated.success ? updated.data.hyperframes_freeform : updated.hyperframes_freeform || null;
    const sectionState = state?.[section] || {};
    const finalMessage = sectionState.message || (updated.stale ? updated.message : '') || fallbackMessage;
    return {
      success: updated.success || updated.stale
        ? isHyperframesFreeformSectionSuccessful(section, state)
        : fallbackSuccess,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: finalMessage,
      hyperframes_freeform: state,
    };
  }

  return {
    createDefaultHyperframesFreeformState,
    normalizeHyperframesFreeformState,
    getDouyinRunHyperframesFreeformState,
    updateRunHyperframesFreeform,
    generateDouyinRunHyperframesFreeformBrief,
    synthesizeDouyinRunHyperframesFreeformAudio,
    generateDouyinRunHyperframesFreeformProject,
  };
}

// P1-6：视觉质检 warnings（asset_first 观测通道）非阻断透出。
// 摘要逻辑收敛到共享模块 visualQaCodes（details 只保留定位字段控制投影体积），此处再导出保持既有引用方式。
const { summarizeVisualQaWarnings, isBlockingVisualQaCode } = require('../creative-video/visualQaCodes');

module.exports = {
  createAgentRunsFreeformWorkflow,
  summarizeVisualQaWarnings,
  buildFreeformVisualInspectProjection,
};


// P1-6：视觉质检状态投影——warnings 非阻断（成片仍算通过），
// 但 status 用 passed_with_warnings + message 带告警条数，让用户在任务状态里看得到。
// isHyperframesFreeformSectionSuccessful 已同步把 passed_with_warnings 视为成功。
function buildFreeformVisualInspectProjection(visualReport) {
  const warnings = summarizeVisualQaWarnings(visualReport?.warnings);
  const issues = Array.isArray(visualReport?.issues) ? visualReport.issues : [];
  const blockingIssues = issues.filter(issue => isBlockingVisualQaCode(issue?.code));
  const hasReportedIssues = visualReport?.success === false && issues.length > 0;
  return {
    status: blockingIssues.length
      ? 'failed'
      : warnings.length || hasReportedIssues ? 'passed_with_warnings' : 'passed',
    report: visualReport,
    issues,
    warnings,
    message: blockingIssues.length
      ? `视觉质检发现 ${blockingIssues.length} 项阻断问题，成片不可用。`
      : hasReportedIssues
      ? `视觉质检发现 ${issues.length} 项问题，成片仍可使用。`
      : warnings.length
        ? `视觉质检通过（${warnings.length} 条观察告警）。`
        : '视觉质检通过。',
  };
}
