const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mediaPipeline = require('../mediaPipeline');
const defaultAiTextModel = require('../ai/aiTextModel');
const defaultAiTtsModel = require('../ai/aiTtsModel');
const agentTemplates = require('./agentTemplates');
const agentTemplateOverrides = require('./agentTemplateOverrides');
const ttsTimeline = require('../tts/ttsTimeline');
const phraseTimeline = require('../tts/phraseTimeline');
const defaultStoryboardAgent = require('../storyboard/storyboardAgent');
const defaultStoryboardPlanAgent = require('../storyboard/storyboardPlanAgent');
const defaultSceneTts = require('../tts/sceneTts');
const storyboardTiming = require('../storyboard/storyboardTiming');
const workflowDecision = require('./agentWorkflowDecision');
const storyboardSchema = require('../storyboard/storyboardSchema');
const narrationBudget = require('../storyboard/storyboardNarrationBudget');
const narrationQuality = require('../creative-video/narrationQuality');
const defaultHyperframesSkillContext = require('../hyperframes/hyperframesSkillContext');
const defaultHyperframesFreeformAgent = require('../hyperframes/hyperframesFreeformAgent');
const requiredNarration = require('../hyperframes/requiredNarrationLiterals');
const defaultCreativeVideoWorkflowFacade = require('../creative-video/workflowFacade');
const { createAgentRunsFreeformWorkflow } = require('./agentRunsFreeformWorkflow');
const { normalizeFreeformNarrationScenes, resolveFreeformTargetDurationSec, replaceFreeformBriefScenes, fitFreeformNarrationToBudget, compressFreeformNarrationWithModel, repairFreeformNarrationWithModel, mapFreeformProjectFilesToDir } = require('./agentRunsFreeformHelpers');

const TEMPLATE_VIRAL_REWRITE = 'viral_rewrite';
const MAX_COMMENTS_CHARS = agentTemplates.MAX_COMMENTS_CHARS;
const TTS_TARGET_DURATION_TOLERANCE = 1.25;
const CHINESE_TTS_CHARS_PER_SECOND = 5.4;
const noopLogger = {
  info() {},
  warn() {},
  error() {},
};

function getLogger(options = {}) {
  return options.logger || noopLogger;
}

function logEvent(logger, level, event) {
  const target = logger && typeof logger[level] === 'function' ? logger[level] : null;
  if (!target) return;
  try {
    target.call(logger, event);
  } catch {
    // Logging must never interrupt the media workflow.
  }
}

function createRunId(template = TEMPLATE_VIRAL_REWRITE) {
  const stamp = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace('.', '-')
    .replace('T', '-');
  const random = crypto.randomBytes(3).toString('hex');
  return `${stamp}-${random}-${template}`;
}

function isSafeId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text !== path.basename(text)) return false;
  if (text.includes('..') || text.includes('/') || text.includes('\\')) return false;
  return /^[A-Za-z0-9_.-]+$/.test(text);
}

function isSafeRunId(runId) {
  const value = typeof runId === 'string' ? runId.trim() : '';
  if (!value || value !== path.basename(value)) return false;
  if (value.includes('..') || value.includes('/') || value.includes('\\')) return false;
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

function buildHtmlVideoExportFileUrl(workflowId, exportId) {
  return `/api/creative-workflows/${encodeURIComponent(String(workflowId))}/html-video-project/exports/${encodeURIComponent(String(exportId))}/file`;
}

function createInvalidAwemeResult(awemeId) {
  return {
    success: false,
    status: 'failed',
    aweme_id: String(awemeId || ''),
    message: '非法或无效的视频素材 ID',
  };
}

function getAgentRunsDir(awemeId, rootDir) {
  return path.join(mediaPipeline.getMediaDir(awemeId, rootDir), 'agent_runs');
}

function getRunPath(awemeId, runId, rootDir) {
  return path.join(getAgentRunsDir(awemeId, rootDir), `${runId}.json`);
}

function getTtsFileName(runId, format = 'wav') {
  const safeFormat = String(format || 'wav').replace(/[^A-Za-z0-9]/g, '') || 'wav';
  return `${runId}-tts.${safeFormat}`;
}

function getTtsPath(awemeId, runId, format, rootDir) {
  return path.join(getAgentRunsDir(awemeId, rootDir), getTtsFileName(runId, format));
}

function getTtsSegmentsDir(awemeId, runId, rootDir) {
  return path.join(getAgentRunsDir(awemeId, rootDir), `${runId}-tts-segments`);
}

function getTtsSegmentFileName(index, format = 'wav') {
  const safeFormat = String(format || 'wav').replace(/[^A-Za-z0-9]/g, '') || 'wav';
  return `segment-${String(index).padStart(3, '0')}.${safeFormat}`;
}

function getTtsUrl(awemeId, runId, fileName) {
  return `/api/agents/douyin/${encodeURIComponent(String(awemeId))}/runs/${encodeURIComponent(String(runId))}/tts/${encodeURIComponent(fileName)}`;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

async function writeJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function writeBinary(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, data);
}

function makeStep(id, label, status, message = '') {
  return { id, label, status, message };
}

function countSpeakableCharacters(text) {
  return [...String(text || '').replace(/\s+/g, '')]
    .filter(char => !/[，。！？、；：,.!?;:"'“”‘’（）()《》【】[\]{}-]/.test(char))
    .length;
}

function estimateChineseTtsDurationSec(text) {
  return Math.round((countSpeakableCharacters(text) / CHINESE_TTS_CHARS_PER_SECOND) * 10) / 10;
}

function getTargetDurationSec(run, fallback = 60) {
  const target = Number(run?.result?.video_brief?.target_duration_sec || fallback);
  return Number.isFinite(target) && target > 0 ? target : fallback;
}

function createTooLongTtsResult(run, estimatedDuration, targetDuration) {
  const limit = Math.round(targetDuration * TTS_TARGET_DURATION_TOLERANCE * 10) / 10;
  return {
    status: 'failed',
    voice: '',
    style_prompt: '',
    message: `口播脚本预计 ${estimatedDuration} 秒，超过目标时长 ${targetDuration} 秒的允许上限 ${limit} 秒。请先压缩脚本或重新生成更短口播后再合成 TTS。`,
    estimated_duration: estimatedDuration,
    target_duration_sec: targetDuration,
    max_allowed_duration_sec: limit,
    model: {},
    updated_at: new Date().toISOString(),
  };
}

function parseModelText(text, templateDefinition) {
  try {
    const rawValue = JSON.parse(text);
    const schemaValidation = validateTaskAgentResult(rawValue, templateDefinition);
    return {
      parsed: true,
      parse: { success: true, error: '' },
      schema_validation: schemaValidation,
      result: templateDefinition.normalizeResult(rawValue),
      raw_text: '',
      raw_output: typeof text === 'string' ? text : '',
    };
  } catch (error) {
    return {
      parsed: false,
      parse: { success: false, error: `模型返回不是有效 JSON：${error.message}` },
      schema_validation: { success: false, errors: ['模型返回不是有效 JSON，无法完成结构化校验。'] },
      result: templateDefinition.normalizeResult({}),
      raw_text: typeof text === 'string' ? text : '',
      raw_output: typeof text === 'string' ? text : '',
    };
  }
}

function validateTaskAgentResult(value, templateDefinition) {
  const result = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const errors = [];

  if (!result) {
    return { success: false, errors: ['模型返回 JSON 必须是对象。'] };
  }

  const stringFieldsByTemplate = {
    viral_rewrite: ['summary', 'audience', 'rewrite_script'],
    comment_insights: ['summary', 'sentiment'],
  };
  const arrayFieldsByTemplate = {
    viral_rewrite: ['viral_points', 'comment_insights', 'topics', 'titles'],
    comment_insights: ['pain_points', 'questions', 'content_opportunities', 'reply_suggestions'],
  };
  const stringFields = stringFieldsByTemplate[templateDefinition.id] || [];
  const arrayFields = arrayFieldsByTemplate[templateDefinition.id] || [];

  for (const field of stringFields) {
    if (typeof result[field] !== 'string' || !result[field].trim()) {
      errors.push(`${field} 必须是非空字符串。`);
    }
  }
  for (const field of arrayFields) {
    if (!Array.isArray(result[field]) || result[field].some(item => typeof item !== 'string')) {
      errors.push(`${field} 必须是字符串数组。`);
    }
  }

  if (templateDefinition.id === TEMPLATE_VIRAL_REWRITE) {
    if (!result.video_brief || typeof result.video_brief !== 'object' || Array.isArray(result.video_brief)) {
      errors.push('video_brief 必须是对象。');
    } else if (!Array.isArray(result.video_brief.beats)) {
      errors.push('video_brief.beats 必须是数组。');
    }
  }

  return { success: errors.length === 0, errors };
}

function summarizeComments(comments = []) {
  if (!Array.isArray(comments) || comments.length === 0) return '';
  const lines = [];
  for (const comment of comments.slice(0, 30)) {
    const content = typeof comment.content === 'string' ? comment.content.trim() : '';
    const likeCount = Number(comment.like_count || 0);
    if (content) {
      lines.push(`- ${content}${likeCount > 0 ? `（${likeCount}赞）` : ''}`);
    }
    const replies = Array.isArray(comment.replies) ? comment.replies : [];
    for (const reply of replies.slice(0, 3)) {
      const replyContent = typeof reply.content === 'string' ? reply.content.trim() : '';
      if (replyContent) {
        lines.push(`  - 回复：${replyContent}`);
      }
    }
  }
  const text = lines.join('\n');
  return text.length > MAX_COMMENTS_CHARS
    ? `${text.slice(0, MAX_COMMENTS_CHARS)}\n（评论摘要已截断，仅保留前 ${MAX_COMMENTS_CHARS} 字）`
    : text;
}

function trimNarrationToBudget(text, maxChars) {
  return narrationQuality.trimNarrationToCompleteBoundary(text, maxChars);
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function createInputSummary({ analysisInput, transcript, comments }) {
  return {
    title: analysisInput?.video?.title || '',
    author: analysisInput?.video?.author?.nickname || '',
    has_transcript: !!(transcript && transcript.text),
    transcript_chars: transcript?.text ? transcript.text.length : 0,
    transcript_truncated: !!(transcript?.text && transcript.text.length > agentTemplates.MAX_TRANSCRIPT_CHARS),
    comment_count: Array.isArray(comments) ? comments.length : 0,
  };
}

function createTaskTemplateValues({ analysisInput, transcript, commentsText, comments, promptOptions }) {
  const video = analysisInput.video || {};
  const statistics = video.statistics || {};
  const transcriptText = typeof transcript?.text === 'string' ? transcript.text : '';
  const transcriptTruncated = transcriptText.length > agentTemplates.MAX_TRANSCRIPT_CHARS;
  const promptTranscript = transcriptTruncated
    ? transcriptText.slice(0, agentTemplates.MAX_TRANSCRIPT_CHARS)
    : transcriptText;

  return {
    videoTitle: video.title || '',
    authorName: video.author?.nickname || '',
    awemeUrl: video.aweme_url || '',
    likeCount: statistics.digg_count || statistics.liked_count || 0,
    commentCount: statistics.comment_count || 0,
    shareCount: statistics.share_count || 0,
    localCommentCount: Array.isArray(comments) ? comments.length : 0,
    transcriptNote: transcriptTruncated
      ? `转写文本已截断，仅保留前 ${agentTemplates.MAX_TRANSCRIPT_CHARS} 字。`
      : '转写文本未截断。',
    transcriptText: promptTranscript,
    commentsNote: Array.isArray(comments) && comments.length > 0
      ? `本地评论缓存共 ${comments.length} 条，以下是抽样评论：`
      : '暂无本地评论缓存。',
    commentsText,
    promptOptionsText: agentTemplates.formatPromptOptionsForPrompt(promptOptions),
  };
}

async function persistRun(awemeId, run, rootDir) {
  const filePath = getRunPath(awemeId, run.run_id, rootDir);
  const data = { ...run, path: filePath };
  await writeJson(filePath, data);
  return data;
}

async function refreshStoryboardValidationIfNeeded(run, filePath = '') {
  const scenes = Array.isArray(run?.storyboard?.scenes) ? run.storyboard.scenes : [];
  if (!scenes.length || run?.storyboard_schema_validation?.success !== false) return run;

  const captions = Array.isArray(run?.tts?.captions) ? run.tts.captions : [];
  if (!captions.length) return run;

  const validation = storyboardSchema.validateStoryboardEditableInput({ storyboard: run.storyboard, captions });
  if (!validation.success) return run;

  const updatedRun = {
    ...run,
    storyboard: storyboardSchema.normalizeStoryboard({
      storyboard: run.storyboard,
      captions,
      phraseCaptions: Array.isArray(run?.tts?.phrase_captions) ? run.tts.phrase_captions : [],
    }),
    storyboard_schema_validation: { success: true, errors: [] },
    updated_at: new Date().toISOString(),
  };
  updatedRun.workflow = workflowDecision.decideNextAction(updatedRun);
  if (filePath) await writeJson(filePath, updatedRun);
  return updatedRun;
}

function getTemplateOrFallback(template) {
  return agentTemplates.getAgentTemplate(template) || agentTemplates.getAgentTemplate(TEMPLATE_VIRAL_REWRITE);
}

async function createFailureRun(awemeId, template, message, options = {}) {
  const templateDefinition = getTemplateOrFallback(template);
  const promptOptions = agentTemplates.normalizePromptOptions(options.promptOptions || {});
  const run = {
    success: false,
    run_id: createRunId(template),
    template,
    aweme_id: String(awemeId),
    status: 'failed',
    model: options.model || {},
    steps: options.steps || [],
    input_summary: options.input_summary || {},
    prompt_options: promptOptions,
    result: templateDefinition.normalizeResult({}),
    agent_config_snapshot: options.agent_config_snapshot,
    messages: options.messages || [],
    raw_output: options.raw_output || '',
    parse: options.parse || { success: false, error: '' },
    schema_validation: options.schema_validation || { success: false, errors: [] },
    raw_text: '',
    message,
    created_at: new Date().toISOString(),
  };

  if (options.persist === false) {
    return run;
  }

  return persistRun(awemeId, run, options.rootDir);
}

async function defaultGetLocalComments(awemeId, options) {
  const douyinStore = require('../douyinStore');
  return douyinStore.getLocalDouyinComments(awemeId, options);
}

async function createDouyinAgentRun(awemeId, options = {}) {
  const template = options.template || TEMPLATE_VIRAL_REWRITE;
  const templateDefinition = agentTemplates.getAgentTemplate(template);
  const rootDir = options.rootDir;
  const promptOptions = agentTemplates.normalizePromptOptions(options.promptOptions || {});
  const steps = [];

  if (!isSafeId(awemeId)) {
    return createInvalidAwemeResult(awemeId);
  }

  if (!templateDefinition) {
    return createFailureRun(awemeId, template, '暂不支持该 Agent 模板。', {
      rootDir,
      promptOptions,
      persist: false,
    });
  }

  const paths = mediaPipeline.getMediaPaths(awemeId, rootDir);
  const status = await mediaPipeline.getStatus(awemeId, { rootDir });
  steps.push(makeStep('media', '检查视频素材', status.exists ? 'done' : 'failed'));

  if (!status.exists) {
    return createFailureRun(awemeId, template, '未找到该视频素材，请先准备该视频的本地素材。', {
      rootDir,
      steps,
      promptOptions,
      persist: false,
    });
  }

  const analysisInput = await readJsonIfExists(paths.analysisInput);
  steps.push(makeStep(
    'analysis_input',
    '读取素材上下文',
    analysisInput ? 'done' : 'failed',
    analysisInput ? '' : '未找到 analysis_input.json',
  ));

  if (!analysisInput) {
    return createFailureRun(awemeId, template, '未找到素材上下文，请先重新准备 AI 素材。', {
      rootDir,
      steps,
      promptOptions,
    });
  }

  const transcript = await readJsonIfExists(paths.transcript);
  steps.push(makeStep(
    'transcript',
    '读取转写文本',
    transcript?.text ? 'done' : (templateDefinition.requireTranscript ? 'failed' : 'skipped'),
    transcript?.text ? '' : (templateDefinition.requireTranscript ? '未找到转写文本' : '该模板不强制要求转写文本'),
  ));

  if (templateDefinition.requireTranscript && !transcript?.text) {
    return createFailureRun(awemeId, template, '未找到转写文本，请先完成该视频的音频转写。', {
      rootDir,
      steps,
      input_summary: createInputSummary({ analysisInput, transcript, comments: [] }),
      promptOptions,
    });
  }

  const getLocalComments = options.getLocalComments || defaultGetLocalComments;
  let commentsResult;
  try {
    commentsResult = await getLocalComments(awemeId, { max: 50, maxReplies: 5 });
  } catch (error) {
    commentsResult = { success: false, count: 0, data: [], message: error.message };
  }
  const comments = Array.isArray(commentsResult?.data) ? commentsResult.data : [];
  const commentsMessage = comments.length > 0
    ? `已读取本地评论缓存 ${comments.length} 条`
    : '暂无本地评论缓存';
  steps.push(makeStep('comments', '读取本地评论缓存', 'done', commentsMessage));

  const inputSummary = createInputSummary({ analysisInput, transcript, comments });
  if (templateDefinition.requireComments && comments.length === 0) {
    return createFailureRun(awemeId, template, '未找到本地评论缓存，请先在抓取记录中加载并缓存评论。', {
      rootDir,
      steps,
      input_summary: inputSummary,
      promptOptions,
    });
  }

  const commentsText = summarizeComments(comments);
  const agentConfig = await agentTemplateOverrides.resolveTaskAgentConfig(template, {
    rootDir,
    agentConfigOverride: options.agentConfigOverride,
  });
  if (!agentConfig || agentConfig.success === false) {
    steps.push(makeStep('config', '校验 Agent 配置', 'failed', agentConfig?.message || 'Agent 配置校验失败'));
    return createFailureRun(awemeId, template, agentConfig?.message || 'Agent 配置校验失败。', {
      rootDir,
      steps,
      input_summary: inputSummary,
      promptOptions,
    });
  }
  const templateValues = createTaskTemplateValues({
    analysisInput,
    transcript,
    commentsText,
    comments,
    promptOptions,
  });
  const messages = agentTemplateOverrides.buildMessagesFromTemplate(agentConfig, templateValues);
  const agentConfigSnapshot = {
    templateId: template,
    source: agentConfig.source,
    systemPrompt: agentConfig.systemPrompt,
    userPromptTemplate: agentConfig.userPromptTemplate,
    resultSchema: agentConfig.resultSchema || {},
    modelOptions: agentConfig.modelOptions,
  };

  const modelService = options.aiTextModel || defaultAiTextModel;
  let modelResult;
  try {
    modelResult = await modelService.callTextModel({
      messages,
      temperature: agentConfig.modelOptions.temperature,
      configPath: options.configPath,
      textConfig: options.textConfig,
      fetchImpl: options.fetchImpl,
      maxRetries: agentConfig.modelOptions.maxRetries,
      stream: agentConfig.modelOptions.stream,
    });
  } catch (error) {
    modelResult = {
      success: false,
      message: error.message || '模型调用失败',
    };
  }

  if (!modelResult.success) {
    steps.push(makeStep('generate', '请求分析模型', 'failed', modelResult.message || '模型调用失败'));
    return createFailureRun(awemeId, template, modelResult.message || '模型调用失败', {
      rootDir,
      steps,
      input_summary: inputSummary,
      model: modelResult.model || {},
      promptOptions,
      agent_config_snapshot: agentConfigSnapshot,
      messages,
    });
  }

  const parsed = parseModelText(modelResult.text, templateDefinition);
  steps.push(makeStep('generate', '请求分析模型', 'done'));
  steps.push(makeStep(
    'parse',
    '解析结构化结果',
    parsed.parsed ? 'done' : 'failed',
    parsed.parsed ? '' : '模型返回未能解析为结构化结果',
  ));

  const run = {
    success: true,
    run_id: createRunId(template),
    template,
    aweme_id: String(awemeId),
    status: 'done',
    model: modelResult.model || {},
    steps,
    input_summary: inputSummary,
    prompt_options: promptOptions,
    agent_config_snapshot: agentConfigSnapshot,
    messages,
    raw_output: parsed.raw_output,
    parse: parsed.parse,
    schema_validation: parsed.schema_validation,
    result: parsed.result,
    raw_text: parsed.raw_text,
    message: parsed.parsed ? 'Agent 运行完成' : '模型返回未能解析为结构化结果，已保留原始文本。',
    created_at: new Date().toISOString(),
  };

  return persistRun(awemeId, run, rootDir);
}

async function createDouyinHyperframesFreeformRun(awemeId, options = {}) {
  const rootDir = options.rootDir;
  const steps = [];
  const targetDurationSec = Number(options.targetDurationSec ?? options.target_duration_sec);

  if (!isSafeId(awemeId)) {
    return createInvalidAwemeResult(awemeId);
  }

  const paths = mediaPipeline.getMediaPaths(awemeId, rootDir);
  const status = await mediaPipeline.getStatus(awemeId, { rootDir });
  steps.push(makeStep('media', '检查视频素材', status.exists ? 'done' : 'failed'));
  if (!status.exists) {
    return createFailureRun(awemeId, 'hyperframes_freeform', '未找到该视频素材，请先准备该视频的本地素材。', {
      rootDir,
      steps,
      persist: false,
    });
  }

  const analysisInput = await readJsonIfExists(paths.analysisInput);
  steps.push(makeStep(
    'analysis_input',
    '读取素材上下文',
    analysisInput ? 'done' : 'failed',
    analysisInput ? '' : '未找到 analysis_input.json',
  ));
  if (!analysisInput) {
    return createFailureRun(awemeId, 'hyperframes_freeform', '未找到素材上下文，请先重新准备 AI 素材。', {
      rootDir,
      steps,
    });
  }

  const transcript = await readJsonIfExists(paths.transcript);
  steps.push(makeStep(
    'transcript',
    '读取转写文本',
    transcript?.text ? 'done' : 'skipped',
    transcript?.text ? '' : '未找到转写文本，导演策划会仅基于素材上下文生成。',
  ));

  const getLocalComments = options.getLocalComments || defaultGetLocalComments;
  let commentsResult;
  try {
    commentsResult = await getLocalComments(awemeId, { max: 50, maxReplies: 5 });
  } catch (error) {
    commentsResult = { success: false, count: 0, data: [], message: error.message };
  }
  const comments = Array.isArray(commentsResult?.data) ? commentsResult.data : [];
  const commentsText = summarizeComments(comments);
  steps.push(makeStep(
    'comments',
    '读取本地评论缓存',
    'done',
    comments.length > 0 ? `已读取本地评论缓存 ${comments.length} 条` : '暂无本地评论缓存',
  ));

  const now = new Date().toISOString();
  const run = {
    success: true,
    run_id: createRunId('hyperframes_freeform'),
    template: 'hyperframes_freeform',
    aweme_id: String(awemeId),
    status: 'ready',
    steps,
    input_summary: createInputSummary({ analysisInput, transcript, comments }),
    result: {
      summary: '',
      rewrite_script: transcript?.text || '',
      comments_text: commentsText,
      video_brief: {
        title: analysisInput?.video?.title || '',
        target_duration_sec: Number.isFinite(targetDurationSec) && targetDurationSec > 0 ? targetDurationSec : 60,
        beats: [],
      },
    },
    hyperframes_freeform: createDefaultHyperframesFreeformState(),
    message: '已新建高级成片记录，可以开始生成导演策划。',
    created_at: now,
    updated_at: now,
  };

  const persisted = await persistRun(awemeId, run, rootDir);
  return {
    ...persisted,
    success: true,
    aweme_id: String(awemeId),
    run_id: persisted.run_id,
    run: persisted,
    message: persisted.message,
  };
}

async function listDouyinAgentRuns(awemeId, options = {}) {
  if (!isSafeId(awemeId)) {
    return {
      ...createInvalidAwemeResult(awemeId),
      count: 0,
      data: [],
    };
  }

  const dir = getAgentRunsDir(awemeId, options.rootDir);
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return {
      success: true,
      aweme_id: String(awemeId),
      count: 0,
      data: [],
    };
  }

  const data = [];
  for (const name of names.filter(item => item.endsWith('.json')).sort().reverse()) {
    const itemPath = path.join(dir, name);
    const item = await readJsonIfExists(itemPath);
    if (item) data.push(await refreshStoryboardValidationIfNeeded(item, itemPath));
  }

  return {
    success: true,
    aweme_id: String(awemeId),
    count: data.length,
    data,
  };
}

async function getDouyinAgentRun(awemeId, runId, options = {}) {
  if (!isSafeId(awemeId)) {
    return createInvalidAwemeResult(awemeId);
  }

  if (!isSafeRunId(runId)) {
    return {
      success: false,
      message: '未找到或非法的 Agent 运行记录',
    };
  }

  const filePath = getRunPath(awemeId, runId, options.rootDir);
  const data = await refreshStoryboardValidationIfNeeded(await readJsonIfExists(filePath), filePath);
  if (!data) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: runId,
      message: '未找到该 Agent 运行记录',
    };
  }

  return {
    success: true,
    aweme_id: String(awemeId),
    run_id: runId,
    data,
  };
}

const freeformWorkflow = createAgentRunsFreeformWorkflow({
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
});

const {
  createDefaultHyperframesFreeformState,
  normalizeHyperframesFreeformState,
  getDouyinRunHyperframesFreeformState,
  updateRunHyperframesFreeform,
  generateDouyinRunHyperframesFreeformBrief,
  synthesizeDouyinRunHyperframesFreeformAudio,
  generateDouyinRunHyperframesFreeformProject,
} = freeformWorkflow;

async function createDouyinStoryboardPlanRun(awemeId, options = {}) {
  const rootDir = options.rootDir;
  const promptOptions = options.promptOptions || {};
  const steps = [];

  if (!isSafeId(awemeId)) {
    return createInvalidAwemeResult(awemeId);
  }

  const paths = mediaPipeline.getMediaPaths(awemeId, rootDir);
  const status = await mediaPipeline.getStatus(awemeId, { rootDir });
  steps.push(makeStep('media', '检查视频素材', status.exists ? 'done' : 'failed'));

  if (!status.exists) {
    return createFailureRun(awemeId, 'storyboard_plan', '未找到该视频素材，请先准备该视频的本地素材。', {
      rootDir,
      steps,
      promptOptions,
      persist: false,
    });
  }

  const analysisInput = await readJsonIfExists(paths.analysisInput);
  steps.push(makeStep(
    'analysis_input',
    '读取素材上下文',
    analysisInput ? 'done' : 'failed',
    analysisInput ? '' : '未找到 analysis_input.json',
  ));
  if (!analysisInput) {
    return createFailureRun(awemeId, 'storyboard_plan', '未找到素材上下文，请先重新准备 AI 素材。', {
      rootDir,
      steps,
      promptOptions,
    });
  }

  const transcript = await readJsonIfExists(paths.transcript);
  steps.push(makeStep(
    'transcript',
    '读取转写文本',
    transcript?.text ? 'done' : 'failed',
    transcript?.text ? '' : '未找到转写文本',
  ));
  if (!transcript?.text) {
    return createFailureRun(awemeId, 'storyboard_plan', '未找到转写文本，请先完成该视频的音频转写。', {
      rootDir,
      steps,
      input_summary: createInputSummary({ analysisInput, transcript, comments: [] }),
      promptOptions,
    });
  }

  const getLocalComments = options.getLocalComments || defaultGetLocalComments;
  let commentsResult;
  try {
    commentsResult = await getLocalComments(awemeId, { max: 50, maxReplies: 5 });
  } catch (error) {
    commentsResult = { success: false, count: 0, data: [], message: error.message };
  }
  const comments = Array.isArray(commentsResult?.data) ? commentsResult.data : [];
  steps.push(makeStep(
    'comments',
    '读取本地评论缓存',
    'done',
    comments.length > 0 ? `已读取本地评论缓存 ${comments.length} 条` : '暂无本地评论缓存',
  ));

  const inputSummary = createInputSummary({ analysisInput, transcript, comments });
  const commentsText = summarizeComments(comments);
  const storyboardPlanAgent = options.storyboardPlanAgent || defaultStoryboardPlanAgent;
  let result;
  try {
    result = await storyboardPlanAgent.createStoryboardPlan({
      transcriptText: transcript.text,
      commentsText,
      promptOptions,
      aiTextModel: options.aiTextModel,
      configPath: options.configPath,
      textConfig: options.textConfig,
      fetchImpl: options.fetchImpl,
    });
  } catch (error) {
    result = {
      success: false,
      message: error.message || '导演分镜规划生成失败。',
      storyboard_plan: { status: 'failed', scenes: [], message: error.message || '导演分镜规划生成失败。' },
      model: {},
      messages: [],
      raw_output: '',
      parse: { success: false, error: error.message || '导演分镜规划生成失败。' },
      raw: {},
    };
  }

  steps.push(makeStep(
    'storyboard_plan',
    '生成导演分镜规划',
    result.success ? 'done' : 'failed',
    result.message || '',
  ));
  const storyboardPlan = result.storyboard_plan || { status: 'failed', scenes: [] };
  const run = {
    success: !!result.success,
    run_id: createRunId('storyboard_plan'),
    template: 'storyboard_plan',
    aweme_id: String(awemeId),
    status: result.success ? 'done' : 'failed',
    model: result.model || {},
    steps,
    input_summary: inputSummary,
    prompt_options: promptOptions,
    storyboard_plan: {
      ...storyboardPlan,
      narration_budget: storyboardPlan.narration_budget || narrationBudget.buildNarrationBudget(storyboardPlan),
    },
    storyboard_plan_raw: result.raw || {},
    storyboard_plan_model: result.model || {},
    messages: result.messages || [],
    raw_output: result.raw_output || '',
    parse: result.parse || { success: !!result.success, error: '' },
    message: result.message || (result.success ? '导演分镜规划已生成。' : '导演分镜规划生成失败。'),
    created_at: new Date().toISOString(),
  };
  run.workflow = workflowDecision.decideNextAction(run);
  return persistRun(awemeId, run, rootDir);
}

async function synthesizeDouyinRunSceneTts(awemeId, runId, options = {}) {
  if (!isSafeId(awemeId)) return createInvalidAwemeResult(awemeId);
  if (!isSafeRunId(runId)) {
    return {
      success: false,
      aweme_id: String(awemeId || ''),
      run_id: String(runId || ''),
      message: '未找到或非法的 Agent 运行记录',
    };
  }

  const runPath = getRunPath(awemeId, runId, options.rootDir);
  const run = await readJsonIfExists(runPath);
  if (!run) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '未找到该 Agent 运行记录',
    };
  }

  const scenes = Array.isArray(run?.storyboard_plan?.scenes) ? run.storyboard_plan.scenes : [];
  if (!scenes.length) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '当前运行记录没有可用于分段配音的导演分镜规划。',
    };
  }

  const sceneTtsService = options.sceneTtsService || defaultSceneTts;
  const result = await sceneTtsService.synthesizeSceneTts({
    scenes,
    outputDir: getAgentRunsDir(awemeId, options.rootDir),
    runId,
    voice: options.voice,
    stylePrompt: options.stylePrompt,
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
  const sceneTtsValue = {
    ...(result.scene_tts || {}),
    status: result.success ? (result.scene_tts?.status || 'done') : (result.scene_tts?.status || 'failed'),
    message: result.message || result.scene_tts?.message || (result.success ? '分段配音已生成。' : '分段配音生成失败。'),
    updated_at: new Date().toISOString(),
  };
  if (result.success) {
    sceneTtsValue.timed_storyboard_plan = storyboardTiming.buildTimedStoryboardPlan({
      storyboardPlan: run.storyboard_plan,
      sceneTts: sceneTtsValue,
    });
  }

  const timedPlan = sceneTtsValue.timed_storyboard_plan || {};
  const fileName = sceneTtsValue.file_name || (sceneTtsValue.path ? path.basename(sceneTtsValue.path) : getTtsFileName(runId, sceneTtsValue.format || options.format || 'wav'));
  const tts = {
    status: result.success ? 'done' : 'failed',
    voice: sceneTtsValue.voice || options.voice || '',
    style_prompt: sceneTtsValue.style_prompt || options.stylePrompt || '',
    format: sceneTtsValue.format || options.format || 'wav',
    path: sceneTtsValue.path || '',
    file_name: fileName,
    url: fileName ? getTtsUrl(awemeId, runId, fileName) : '',
    duration: Number(sceneTtsValue.duration ?? timedPlan.duration ?? 0),
    captions: Array.isArray(timedPlan.captions) ? timedPlan.captions : [],
    phrase_captions: Array.isArray(timedPlan.phrase_captions) ? timedPlan.phrase_captions : [],
    segments: Array.isArray(sceneTtsValue.scenes) ? sceneTtsValue.scenes : [],
    model: sceneTtsValue.model || result.model || {},
    message: sceneTtsValue.message,
    updated_at: sceneTtsValue.updated_at,
  };
  const updatedRun = {
    ...run,
    scene_tts: sceneTtsValue,
    tts,
    video: null,
    updated_at: new Date().toISOString(),
  };
  updatedRun.workflow = workflowDecision.decideNextAction(updatedRun);
  await writeJson(runPath, updatedRun);

  return {
    success: !!result.success,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message: sceneTtsValue.message,
    scene_tts: sceneTtsValue,
    tts,
    workflow: updatedRun.workflow,
  };
}

async function compressDouyinRunSceneNarration(awemeId, runId, options = {}) {
  if (!isSafeId(awemeId)) return createInvalidAwemeResult(awemeId);
  if (!isSafeRunId(runId)) {
    return {
      success: false,
      aweme_id: String(awemeId || ''),
      run_id: String(runId || ''),
      message: '未找到或非法的 Agent 运行记录',
    };
  }

  const runPath = getRunPath(awemeId, runId, options.rootDir);
  const run = await readJsonIfExists(runPath);
  if (!run) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '未找到该 Agent 运行记录',
    };
  }

  const storyboardPlan = run.storyboard_plan || {};
  const currentBudget = storyboardPlan.narration_budget || narrationBudget.buildNarrationBudget(storyboardPlan);
  const sceneBudgets = new Map((currentBudget.scenes || []).map(item => [Number(item.index), item]));
  const scenes = (Array.isArray(storyboardPlan.scenes) ? storyboardPlan.scenes : []).map((scene, index) => {
    const sceneIndex = Number(scene.index || index + 1);
    const sceneBudget = sceneBudgets.get(sceneIndex) || {};
    const fallbackMaxChars = Math.floor(Number(scene.target_duration_sec || 1) * narrationBudget.DEFAULT_CHARS_PER_SECOND);
    return {
      ...scene,
      narration_text: trimNarrationToBudget(scene.narration_text, sceneBudget.max_recommended_chars || fallbackMaxChars),
    };
  });
  const requiredLiteralValidation = requiredNarration.validateRequiredNarrationLiterals(
    scenes,
    storyboardPlan.required_narration_literals,
  );
  if (!requiredLiteralValidation.ok) {
    return {
      success: false,
      code: requiredLiteralValidation.code,
      message: `${requiredLiteralValidation.message} 已拒绝可能破坏原句的确定性截断，请使用模型重新压缩。`,
      missing: requiredLiteralValidation.missing,
    };
  }
  const updatedPlanBase = {
    ...storyboardPlan,
    scenes,
    updated_at: new Date().toISOString(),
  };
  const updatedPlan = {
    ...updatedPlanBase,
    narration_budget: narrationBudget.buildNarrationBudget(updatedPlanBase),
  };
  const updatedRun = {
    ...run,
    storyboard_plan: updatedPlan,
    scene_tts: null,
    tts: null,
    storyboard: null,
    video: null,
    updated_at: new Date().toISOString(),
  };
  updatedRun.workflow = workflowDecision.decideNextAction(updatedRun);
  await writeJson(runPath, updatedRun);

  return {
    success: true,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message: '超时口播已自动压缩，请继续生成分段配音。',
    storyboard_plan: updatedPlan,
    workflow: updatedRun.workflow,
  };
}

async function createDouyinRunVisualStoryboard(awemeId, runId, options = {}) {
  if (!isSafeId(awemeId)) return createInvalidAwemeResult(awemeId);
  if (!isSafeRunId(runId)) {
    return {
      success: false,
      aweme_id: String(awemeId || ''),
      run_id: String(runId || ''),
      message: '未找到或非法的 Agent 运行记录',
    };
  }

  const runPath = getRunPath(awemeId, runId, options.rootDir);
  const run = await readJsonIfExists(runPath);
  if (!run) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '未找到该 Agent 运行记录',
    };
  }

  const timedPlan = run?.scene_tts?.timed_storyboard_plan || {};
  const captions = Array.isArray(timedPlan.captions) ? timedPlan.captions : [];
  const phraseCaptions = Array.isArray(timedPlan.phrase_captions) ? timedPlan.phrase_captions : [];
  if (!captions.length) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '请先完成分段配音并生成分镜时间轴。',
    };
  }

  const rewriteScript = (Array.isArray(run?.storyboard_plan?.scenes) ? run.storyboard_plan.scenes : [])
    .map(scene => String(scene?.narration_text || '').trim())
    .filter(Boolean)
    .join('\n');
  if (!rewriteScript) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '当前导演分镜规划没有可用于视觉分镜的旁白文本。',
    };
  }

  const storyboardOptions = defaultStoryboardAgent.normalizeStoryboardOptions(options.storyboardOptions || run.storyboard_options || {});
  const storyboardConfig = await agentTemplateOverrides.resolveStoryboardAgentConfig({
    rootDir: options.rootDir,
    storyboardConfigOverride: options.storyboardConfigOverride,
  });
  if (!storyboardConfig || storyboardConfig.success === false) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: storyboardConfig?.message || '视觉分镜 Agent 配置校验失败。',
    };
  }

  const agent = options.storyboardAgent || defaultStoryboardAgent;
  const result = await agent.createStoryboard({
    rewriteScript,
    captions,
    phraseCaptions,
    videoBrief: { target_duration_sec: run.storyboard_plan?.target_duration_sec || 60 },
    storyboardOptions,
    editableConfig: storyboardConfig,
    frameProfileId: options.frameProfileId,
    qualityFeedback: options.qualityFeedback || null,
    aiTextModel: options.aiTextModel,
    configPath: options.configPath,
    textConfig: options.textConfig,
    fetchImpl: options.fetchImpl,
  });

  const updatedRun = {
    ...run,
    storyboard_options: storyboardOptions,
    storyboard_raw: result.raw || {},
    storyboard: result.storyboard,
    storyboard_model: result.model || {},
    storyboard_raw_parse_failed: !!result.raw_parse_failed,
    storyboard_config_snapshot: result.config_snapshot,
    storyboard_messages: result.messages || [],
    storyboard_raw_output: result.raw_output || '',
    storyboard_parse: result.parse || { success: !!result.success, error: '' },
    storyboard_schema_validation: result.schema_validation || { success: !!result.success, errors: [] },
    video: null,
    updated_at: new Date().toISOString(),
  };
  updatedRun.workflow = workflowDecision.decideNextAction(updatedRun);
  await writeJson(runPath, updatedRun);

  return {
    success: !!result.success,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message: result.message || (result.success ? '视觉分镜已生成。' : '视觉分镜生成失败。'),
    storyboard: updatedRun.storyboard,
    storyboard_schema_validation: updatedRun.storyboard_schema_validation,
    workflow: updatedRun.workflow,
  };
}

async function synthesizeDouyinRunTtsLegacy(awemeId, runId, options = {}) {
  if (!isSafeId(awemeId)) {
    return createInvalidAwemeResult(awemeId);
  }

  if (!isSafeRunId(runId)) {
    return {
      success: false,
      aweme_id: String(awemeId || ''),
      run_id: String(runId || ''),
      message: '未找到或非法的 Agent 运行记录',
    };
  }

  const runPath = getRunPath(awemeId, runId, options.rootDir);
  const run = await readJsonIfExists(runPath);
  if (!run) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '未找到该 Agent 运行记录',
    };
  }

  const rewriteScript = typeof run?.result?.rewrite_script === 'string' ? run.result.rewrite_script.trim() : '';
  if (!rewriteScript) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '当前运行结果没有可用于 TTS 合成的改写脚本。',
    };
  }

  const targetDuration = getTargetDurationSec(run);
  const estimatedDuration = estimateChineseTtsDurationSec(rewriteScript);
  if (estimatedDuration > targetDuration * TTS_TARGET_DURATION_TOLERANCE) {
    const failedTts = createTooLongTtsResult(run, estimatedDuration, targetDuration);
    const updatedRun = { ...run, tts: failedTts, updated_at: new Date().toISOString() };
    await writeJson(runPath, updatedRun);
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: failedTts.message,
      tts: failedTts,
    };
  }

  const ttsModel = options.ttsModel || defaultAiTtsModel;
  const modelResult = await ttsModel.callTtsModel({
    text: rewriteScript,
    voice: options.voice,
    stylePrompt: options.stylePrompt,
    format: options.format,
    configPath: options.configPath,
    ttsConfig: options.ttsConfig,
    fetchImpl: options.fetchImpl,
  });

  if (!modelResult.success) {
    const failedTts = {
      status: modelResult.status || 'failed',
      voice: options.voice || '',
      style_prompt: options.stylePrompt || '',
      message: modelResult.message || 'TTS 合成失败',
      model: modelResult.model || {},
      updated_at: new Date().toISOString(),
    };
    const updatedRun = { ...run, tts: failedTts, updated_at: new Date().toISOString() };
    await writeJson(runPath, updatedRun);
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: failedTts.message,
      tts: failedTts,
    };
  }

  const format = modelResult.format || options.format || 'wav';
  const fileName = getTtsFileName(runId, format);
  const filePath = getTtsPath(awemeId, runId, format, options.rootDir);
  await writeBinary(filePath, modelResult.audioBuffer);

  const tts = {
    status: 'done',
    voice: modelResult.voice || options.voice || '',
    style_prompt: options.stylePrompt || '',
    format,
    path: filePath,
    url: getTtsUrl(awemeId, runId, fileName),
    model: modelResult.model || {},
    message: modelResult.message || 'TTS 语音合成完成。',
    updated_at: new Date().toISOString(),
  };
  const updatedRun = { ...run, tts, updated_at: new Date().toISOString() };
  await writeJson(runPath, updatedRun);

  return {
    success: true,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message: tts.message,
    tts,
  };
}

function resolveDouyinRunTtsFile(awemeId, runId, fileName, options = {}) {
  if (!isSafeId(awemeId) || !isSafeRunId(runId)) {
    throw new Error('Invalid Agent TTS file request');
  }

  const name = String(fileName || '');
  const isolatedPrefix = `${runId}-audio-`;
  let publishedAudio = {};
  if (name.startsWith(isolatedPrefix) && /-[12]-tts\.[A-Za-z0-9]+$/.test(name)) {
    try {
      const run = JSON.parse(fs.readFileSync(getRunPath(awemeId, runId, options.rootDir), 'utf8'));
      publishedAudio = run?.hyperframes_freeform?.audio || {};
    } catch {
      publishedAudio = {};
    }
  }
  const isLegacyName = name.startsWith(`${runId}-tts.`);
  const publishedOperationId = String(publishedAudio.operation_id || '');
  const publishedIsolatedPrefixes = [1, 2].map(attempt => (
    `${defaultSceneTts.normalizeSceneTtsRunId(`${runId}-audio-${publishedOperationId}-${attempt}`)}-tts.`
  ));
  const isPublishedIsolatedName = publishedAudio.status === 'ready'
    && name === String(publishedAudio.file_name || '')
    && publishedOperationId
    && publishedIsolatedPrefixes.some(prefix => name.startsWith(prefix));
  if (!name || path.basename(name) !== name || (!isLegacyName && !isPublishedIsolatedName)) {
    throw new Error('Invalid Agent TTS file request');
  }

  const runsDir = path.resolve(getAgentRunsDir(awemeId, options.rootDir));
  const targetPath = path.resolve(runsDir, name);
  const relative = path.relative(runsDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Agent TTS file is outside run directory');
  }

  return targetPath;
}

async function createDouyinRunStoryboard(awemeId, runId, options = {}) {
  if (!isSafeId(awemeId)) return createInvalidAwemeResult(awemeId);
  if (!isSafeRunId(runId)) {
    return {
      success: false,
      aweme_id: String(awemeId || ''),
      run_id: String(runId || ''),
      message: '未找到或非法的 Agent 运行记录',
    };
  }

  const runPath = getRunPath(awemeId, runId, options.rootDir);
  const run = await readJsonIfExists(runPath);
  if (!run) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '未找到该 Agent 运行记录',
    };
  }

  const rewriteScript = typeof run?.result?.rewrite_script === 'string' ? run.result.rewrite_script.trim() : '';
  const captions = Array.isArray(run?.tts?.captions) ? run.tts.captions : [];
  const phraseCaptions = Array.isArray(run?.tts?.phrase_captions) && run.tts.phrase_captions.length
    ? run.tts.phrase_captions
    : phraseTimeline.buildPhraseBlocksFromCaptions(captions);
  if (!rewriteScript) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '当前运行结果没有可用于 AI 分镜的改写脚本。',
    };
  }
  if (!captions.length) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '请先完成 TTS 合成并生成字幕时间轴。',
    };
  }

  const agent = options.storyboardAgent || defaultStoryboardAgent;
  const videoBrief = run?.result?.video_brief || {};
  const storyboardOptions = defaultStoryboardAgent.normalizeStoryboardOptions(options.storyboardOptions || run.storyboard_options || {});
  const storyboardConfig = await agentTemplateOverrides.resolveStoryboardAgentConfig({
    rootDir: options.rootDir,
    storyboardConfigOverride: options.storyboardConfigOverride,
  });
  if (!storyboardConfig || storyboardConfig.success === false) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: storyboardConfig?.message || '分镜 Agent 配置校验失败。',
    };
  }
  const result = await agent.createStoryboard({
    rewriteScript,
    captions,
    phraseCaptions,
    videoBrief,
    storyboardOptions,
    editableConfig: storyboardConfig,
    frameProfileId: options.frameProfileId,
    qualityFeedback: options.qualityFeedback || null,
    aiTextModel: options.aiTextModel,
    configPath: options.configPath,
    textConfig: options.textConfig,
    fetchImpl: options.fetchImpl,
  });

  const updatedRun = {
    ...run,
    storyboard_options: storyboardOptions,
    tts: {
      ...(run.tts || {}),
      phrase_captions: phraseCaptions,
    },
    storyboard_raw: result.raw || {},
    storyboard: result.storyboard,
    storyboard_model: result.model || {},
    storyboard_raw_parse_failed: !!result.raw_parse_failed,
    storyboard_config_snapshot: result.config_snapshot,
    storyboard_messages: result.messages || [],
    storyboard_raw_output: result.raw_output || '',
    storyboard_parse: result.parse || { success: true, error: '' },
    storyboard_schema_validation: result.schema_validation || { success: true, errors: [] },
    video: null,
    updated_at: new Date().toISOString(),
  };
  updatedRun.workflow = workflowDecision.decideNextAction(updatedRun);
  await writeJson(runPath, updatedRun);

  return {
    success: !!result.success,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message: result.message || (result.success ? 'AI 分镜已生成。' : 'AI 分镜生成失败。'),
    storyboard_options: updatedRun.storyboard_options,
    storyboard_raw: updatedRun.storyboard_raw,
    storyboard: updatedRun.storyboard,
    storyboard_model: updatedRun.storyboard_model,
    storyboard_config_snapshot: updatedRun.storyboard_config_snapshot,
    storyboard_messages: updatedRun.storyboard_messages,
    storyboard_raw_output: updatedRun.storyboard_raw_output,
    storyboard_parse: updatedRun.storyboard_parse,
    storyboard_schema_validation: updatedRun.storyboard_schema_validation,
    video: updatedRun.video,
  };
}

async function synthesizeDouyinRunTts(awemeId, runId, options = {}) {
  if (!isSafeId(awemeId)) {
    return createInvalidAwemeResult(awemeId);
  }

  if (!isSafeRunId(runId)) {
    return {
      success: false,
      aweme_id: String(awemeId || ''),
      run_id: String(runId || ''),
      message: '未找到或非法的 Agent 运行记录',
    };
  }

  const runPath = getRunPath(awemeId, runId, options.rootDir);
  const run = await readJsonIfExists(runPath);
  if (!run) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '未找到该 Agent 运行记录',
    };
  }

  const rewriteScript = typeof run?.result?.rewrite_script === 'string' ? run.result.rewrite_script.trim() : '';
  if (!rewriteScript) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '当前运行结果没有可用于 TTS 合成的改写脚本。',
    };
  }

  const sentences = ttsTimeline.splitScriptIntoSentences(rewriteScript);
  if (!sentences.length) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '当前运行结果没有可用于 TTS 合成的有效句子。',
    };
  }

  const targetDuration = getTargetDurationSec(run);
  const estimatedDuration = estimateChineseTtsDurationSec(sentences.join(''));
  if (estimatedDuration > targetDuration * TTS_TARGET_DURATION_TOLERANCE) {
    const failedTts = createTooLongTtsResult(run, estimatedDuration, targetDuration);
    const updatedRun = { ...run, tts: failedTts, updated_at: new Date().toISOString() };
    await writeJson(runPath, updatedRun);
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: failedTts.message,
      tts: failedTts,
    };
  }

  const ttsModel = options.ttsModel || defaultAiTtsModel;
  const readAudioDuration = options.readAudioDuration || (async filePath => {
    const result = await ttsTimeline.readAudioDuration(filePath, options);
    if (!result.success) throw new Error(result.message);
    return result.duration;
  });
  const concatenateAudio = options.concatenateAudio || ttsTimeline.concatenateAudioFiles;
  const requestedFormat = options.format || 'wav';
  const segmentsDir = getTtsSegmentsDir(awemeId, runId, options.rootDir);
  await fsp.rm(segmentsDir, { recursive: true, force: true });
  await fsp.mkdir(segmentsDir, { recursive: true });

  const segments = [];
  let model = {};
  let format = requestedFormat;
  let resolvedVoice = options.voice || '';

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    const modelResult = await ttsModel.callTtsModel({
      text: sentence,
      voice: options.voice,
      stylePrompt: options.stylePrompt,
      format: requestedFormat,
      configPath: options.configPath,
      ttsConfig: options.ttsConfig,
      fetchImpl: options.fetchImpl,
      waitImpl: options.waitImpl,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      ttsConcurrency: options.ttsConcurrency,
      ttsQueueIntervalMs: options.ttsQueueIntervalMs,
    });

    if (!modelResult.success) {
      const failedTts = {
        status: modelResult.status || 'failed',
        voice: options.voice || '',
        style_prompt: options.stylePrompt || '',
        message: modelResult.message || `第 ${index + 1} 句 TTS 合成失败`,
        model: modelResult.model || {},
        updated_at: new Date().toISOString(),
      };
      const updatedRun = { ...run, tts: failedTts, updated_at: new Date().toISOString() };
      await writeJson(runPath, updatedRun);
      return {
        success: false,
        aweme_id: String(awemeId),
        run_id: String(runId),
        message: failedTts.message,
        tts: failedTts,
      };
    }

    format = modelResult.format || format;
    resolvedVoice = modelResult.voice || resolvedVoice;
    model = modelResult.model || model;
    const segmentFileName = getTtsSegmentFileName(index + 1, format);
    const segmentPath = path.join(segmentsDir, segmentFileName);
    await writeBinary(segmentPath, modelResult.audioBuffer);
    const duration = await readAudioDuration(segmentPath);
    segments.push({
      index: index + 1,
      text: sentence,
      duration,
      path: segmentPath,
    });
  }

  const fileName = getTtsFileName(runId, format);
  const filePath = getTtsPath(awemeId, runId, format, options.rootDir);
  const concatResult = await concatenateAudio({
    inputPaths: segments.map(segment => segment.path),
    targetPath: filePath,
    options,
  });

  if (concatResult && concatResult.success === false) {
    const failedTts = {
      status: 'failed',
      voice: resolvedVoice,
      style_prompt: options.stylePrompt || '',
      message: concatResult.message || '拼接 TTS 分段音频失败',
      model,
      segments,
      updated_at: new Date().toISOString(),
    };
    const updatedRun = { ...run, tts: failedTts, updated_at: new Date().toISOString() };
    await writeJson(runPath, updatedRun);
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: failedTts.message,
      tts: failedTts,
    };
  }

  const captions = ttsTimeline.buildCaptionsFromSegments(segments);
  const phraseCaptions = phraseTimeline.buildPhraseBlocksFromCaptions(captions);
  const totalDuration = captions.length ? captions[captions.length - 1].end : 0;
  const tts = {
    status: 'done',
    voice: resolvedVoice,
    style_prompt: options.stylePrompt || '',
    format,
    path: filePath,
    url: getTtsUrl(awemeId, runId, fileName),
    duration: totalDuration,
    segments,
    captions,
    phrase_captions: phraseCaptions,
    model,
    message: 'TTS 语音合成完成。',
    updated_at: new Date().toISOString(),
  };
  const updatedRun = { ...run, tts, updated_at: new Date().toISOString() };
  await writeJson(runPath, updatedRun);

  return {
    success: true,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message: tts.message,
    tts,
  };
}

module.exports = {
  TEMPLATE_VIRAL_REWRITE,
  createDouyinAgentRun,
  createDouyinHyperframesFreeformRun,
  createDouyinStoryboardPlanRun,
  listDouyinAgentRuns,
  getDouyinAgentRun,
  createDefaultHyperframesFreeformState,
  normalizeHyperframesFreeformState,
  getDouyinRunHyperframesFreeformState,
  updateRunHyperframesFreeform,
  generateDouyinRunHyperframesFreeformBrief,
  synthesizeDouyinRunHyperframesFreeformAudio,
  generateDouyinRunHyperframesFreeformProject,
  synthesizeDouyinRunTts,
  synthesizeDouyinRunSceneTts,
  compressDouyinRunSceneNarration,
  resolveDouyinRunTtsFile,
  createDouyinRunStoryboard,
  createDouyinRunVisualStoryboard,
  decideNextAction: workflowDecision.decideNextAction,
  listAgentTemplates: agentTemplates.listAgentTemplates,
  summarizeComments,
  buildPrompt: agentTemplates.getAgentTemplate(TEMPLATE_VIRAL_REWRITE).buildPrompt,
};
