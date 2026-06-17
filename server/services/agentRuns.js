const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mediaPipeline = require('./mediaPipeline');
const defaultAiTextModel = require('./aiTextModel');
const defaultAiTtsModel = require('./aiTtsModel');
const agentTemplates = require('./agentTemplates');
const agentTemplateOverrides = require('./agentTemplateOverrides');
const ttsTimeline = require('./ttsTimeline');
const phraseTimeline = require('./phraseTimeline');
const defaultStoryboardAgent = require('./storyboardAgent');
const defaultStoryboardPlanAgent = require('./storyboardPlanAgent');
const defaultSceneTts = require('./sceneTts');
const storyboardTiming = require('./storyboardTiming');
const workflowDecision = require('./agentWorkflowDecision');
const storyboardSchema = require('./storyboardSchema');
const narrationBudget = require('./storyboardNarrationBudget');
const defaultHyperframesProject = require('./hyperframesProject');
const defaultHyperframesRenderer = require('./hyperframesRenderer');
const defaultHyperframesSkillContext = require('./hyperframesSkillContext');
const defaultHyperframesFreeformAgent = require('./hyperframesFreeformAgent');
const defaultHyperframesFreeformProject = require('./hyperframesFreeformProject');
const defaultHyperframesFreeformQuality = require('./hyperframesFreeformQuality');
const defaultHyperframesSceneSpecComposer = require('./hyperframesSceneSpecComposer');
const defaultCreativeVideoWorkflowFacade = require('./creative-video/workflowFacade');

const TEMPLATE_VIRAL_REWRITE = 'viral_rewrite';
const MAX_COMMENTS_CHARS = agentTemplates.MAX_COMMENTS_CHARS;
const TTS_TARGET_DURATION_TOLERANCE = 1.25;
const CHINESE_TTS_CHARS_PER_SECOND = 5.4;
const runUpdateQueues = new Map();
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

function getHyperframesProjectDir(awemeId, runId, rootDir) {
  return path.join(getAgentRunsDir(awemeId, rootDir), `${runId}-hyperframes`);
}

function getHyperframesFileUrl(awemeId, runId, fileName) {
  return `/api/agents/douyin/${encodeURIComponent(String(awemeId))}/runs/${encodeURIComponent(String(runId))}/hyperframes/files/${encodeURIComponent(fileName)}`;
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
  const limit = Math.max(1, Number(maxChars || 0));
  const compact = String(text || '').replace(/\s+/g, '').trim();
  if (compact.length <= limit) return compact;
  const sentences = compact.split(/(?<=[。！？!?])/).filter(Boolean);
  let output = '';
  for (const sentence of sentences) {
    if ((output + sentence).length > limit) break;
    output += sentence;
  }
  return (output || compact).slice(0, limit);
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
  const douyinStore = require('./douyinStore');
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
    steps.push(makeStep('generate', '请求文本模型', 'failed', modelResult.message || '模型调用失败'));
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
  steps.push(makeStep('generate', '请求文本模型', 'done'));
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

  const now = new Date().toISOString();
  const run = {
    success: true,
    run_id: createRunId('hyperframes_freeform'),
    template: 'hyperframes_freeform',
    aweme_id: String(awemeId),
    status: 'ready',
    steps,
    input_summary: createInputSummary({ analysisInput, transcript, comments: [] }),
    result: {
      summary: '',
      rewrite_script: transcript?.text || '',
      video_brief: {
        title: analysisInput?.video?.title || '',
        target_duration_sec: 60,
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

async function updateRunHyperframesFreeformIfOperationCurrentAnd(awemeId, runId, section, operationId, predicate, updater, options = {}) {
  return withRunUpdateQueue(awemeId, runId, options, async () => {
    const detail = await getDouyinAgentRun(awemeId, runId, options);
    if (!detail.success) return detail;

    const current = normalizeHyperframesFreeformState(detail.data.hyperframes_freeform);
    if (current?.[section]?.operation_id !== operationId || !predicate(current, detail.data)) {
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

async function removePathBestEffort(targetPath) {
  if (!targetPath) return;
  try {
    await fsp.rm(targetPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup should not mask the main generation result.
  }
}

function getAgentRunsRootDir(awemeId, rootDir) {
  return path.resolve(getAgentRunsDir(awemeId, rootDir));
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function validateFreeformTempProjectDir({ tempDir, finalDir, awemeId, rootDir, tempRunId, operationId }) {
  const tempPath = path.resolve(String(tempDir || ''));
  const finalPath = path.resolve(String(finalDir || ''));
  if (!tempPath || tempPath === finalPath) {
    throw new Error('HyperFrames 临时工程目录不安全：不能使用正式工程目录。');
  }

  const agentRunsRoot = getAgentRunsRootDir(awemeId, rootDir);
  if (!isPathInside(agentRunsRoot, tempPath)) {
    throw new Error('HyperFrames 临时工程目录不安全：目录不在当前运行目录内。');
  }

  const baseName = path.basename(tempPath);
  if (!baseName.includes(String(tempRunId || '')) || !baseName.includes(String(operationId || ''))) {
    throw new Error('HyperFrames 临时工程目录不安全：目录不属于当前生成任务。');
  }

  return tempPath;
}

async function cleanupFreeformTempProjectDir(context) {
  let tempPath;
  try {
    tempPath = validateFreeformTempProjectDir(context);
  } catch {
    return false;
  }
  await removePathBestEffort(tempPath);
  return true;
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function publishFreeformProjectDirectory({ tempDir, finalDir, operationId, awemeId, rootDir, tempRunId }) {
  const safeTempDir = validateFreeformTempProjectDir({ tempDir, finalDir, awemeId, rootDir, tempRunId, operationId });
  const backupDir = `${finalDir}.backup-${operationId || crypto.randomBytes(3).toString('hex')}`;
  let hasBackup = false;
  await fsp.mkdir(path.dirname(finalDir), { recursive: true });

  try {
    await fsp.rm(backupDir, { recursive: true, force: true });
    if (await pathExists(finalDir)) {
      await fsp.rename(finalDir, backupDir);
      hasBackup = true;
    }
    await fsp.rename(safeTempDir, finalDir);
    if (hasBackup) await removePathBestEffort(backupDir);
  } catch (error) {
    if (!error || error.code !== 'EXDEV') {
      try {
        if (!(await pathExists(finalDir)) && hasBackup && await pathExists(backupDir)) {
          await fsp.rename(backupDir, finalDir);
          hasBackup = false;
        }
      } catch {
        // Restore is best-effort; the thrown publish error below remains the actionable failure.
      }
      throw new Error(`HyperFrames 工程发布失败：${error?.message || '无法替换正式工程目录'}`);
    }

    try {
      await fsp.cp(safeTempDir, finalDir, { recursive: true });
      await cleanupFreeformTempProjectDir({ tempDir: safeTempDir, finalDir, awemeId, rootDir, tempRunId, operationId });
      if (hasBackup) await removePathBestEffort(backupDir);
    } catch (copyError) {
      try {
        await removePathBestEffort(finalDir);
        if (hasBackup && await pathExists(backupDir)) {
          await fsp.rename(backupDir, finalDir);
          hasBackup = false;
        }
      } catch {
        // Restore is best-effort; report the original copy failure clearly.
      }
      throw new Error(`HyperFrames 工程发布失败：${copyError.message || '无法复制正式工程目录'}`);
    }
  }
}

function mapFreeformProjectFilesToDir(files = [], projectDir) {
  return Array.isArray(files)
    ? files.map(file => ({
      ...file,
      path: file?.name ? path.join(projectDir, file.name) : file?.path,
    }))
    : [];
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

function createFreeformFailureResponse(awemeId, runId, state, message) {
  return {
    success: false,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message,
    hyperframes_freeform: state,
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

async function markFreeformProjectFailed(awemeId, runId, message, options = {}, operationId = '') {
  const update = operationId
    ? updater => updateRunHyperframesFreeformIfOperationCurrent(awemeId, runId, 'project', operationId, updater, options)
    : updater => updateRunHyperframesFreeform(awemeId, runId, updater, options);
  const updated = await update(current => ({
    status: 'failed',
    project: {
      ...current.project,
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

function normalizeFreeformNarrationScenes(brief = {}) {
  const storyboard = brief?.storyboard;
  const rawScenes = Array.isArray(storyboard?.scenes)
    ? storyboard.scenes
    : (Array.isArray(storyboard) ? storyboard : []);
  const scenes = rawScenes
    .map((scene, index) => ({
      ...scene,
      index: Number(scene?.index || index + 1),
      narration_text: String(
        scene?.narration_text
        || scene?.narration
        || scene?.voiceover
        || scene?.script
        || '',
      ).trim(),
    }))
    .filter(scene => scene.narration_text);

  if (scenes.length) return scenes;
  const narration = String(brief?.narration || '').trim();
  return narration ? [{ index: 1, narration_text: narration }] : [];
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

  const scenes = normalizeFreeformNarrationScenes(currentState.brief.data);
  if (!scenes.length) {
    return failHyperframesFreeformSection(awemeId, runId, 'audio', '导演策划中没有可用于配音的旁白。', options);
  }

  const operationId = createFreeformOperationId('audio');
  await updateRunHyperframesFreeform(awemeId, runId, current => ({
    status: 'generating',
    audio: {
      ...current.audio,
      operation_id: operationId,
      status: 'generating',
      voice: options.voice || current.audio.voice || '',
      style_prompt: options.stylePrompt || options.style_prompt || current.audio.style_prompt || '',
      message: '正在生成高级成片音频...',
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
      target_duration_sec: currentState.brief.data?.target_duration_sec || currentState.brief.data?.targetDurationSec || 0,
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
  await updateRunHyperframesFreeform(awemeId, runId, current => ({
    status: 'generating',
    project: {
      ...current.project,
      status: 'generating',
      operation_id: operationId,
      message: '正在生成 HyperFrames 工程...',
    },
  }), options);

  if (options.useLegacyFreeformProject !== true && options.useHtmlVideoLiteWorkflow === true) {
    const facade = options.creativeVideoWorkflowFacade || defaultCreativeVideoWorkflowFacade;
    let result;
    try {
      result = await facade.generateCreativeVideoProject({
        workflowId: String(awemeId),
        runId: String(runId),
        creativeContext: {
          run: detail.data,
          brief: currentState.brief.data || {},
          audio: currentState.audio || {},
          input: options.creativeContextInput || {},
        },
        target: options.projectOptions || {},
        rootDir: options.rootDir,
        services: options.creativeVideoServices || {},
        skipValidation: options.skipValidation === true,
      });
    } catch (error) {
      result = {
        success: false,
        message: `html-video lite 成片失败：${error.message || '未知错误'}`,
      };
    }
    if (!result.success) {
      return markFreeformProjectFailed(awemeId, runId, result.message || 'html-video lite 成片失败。', options, operationId);
    }
    const htmlVideoProjectPath = result.html_video_project_path || result.project_dir || '';
    const updated = await updateRunHyperframesFreeformIfOperationCurrent(awemeId, runId, 'project', operationId, current => ({
      status: 'ready',
      project_dir: htmlVideoProjectPath,
      project: {
        ...current.project,
        status: 'ready',
        operation_id: operationId,
        message: result.message || 'html-video lite 工程已生成。',
        project_dir: htmlVideoProjectPath,
        html_video_project_path: htmlVideoProjectPath,
        files: mapFreeformProjectFilesToDir((result.files || []).map(name => ({ name })), htmlVideoProjectPath),
        scene_spec: result.scene_spec,
        frame_specs: result.frame_specs,
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
        output_url: defaultHyperframesFreeformProject.buildFreeformFileUrl(awemeId, runId, 'output.mp4'),
        render_versions: [{
          id: `${runId}-html-video-lite`,
          status: 'rendered',
          output_path: result.output_path,
          message: '渲染完成。',
          created_at: new Date().toISOString(),
        }],
        message: '渲染完成。',
      },
      visual_inspect: {
        ...current.visual_inspect,
        status: 'passed',
        report: result.visual_report,
        issues: result.visual_report?.issues || [],
        message: '视觉质检通过。',
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
    return markFreeformProjectFailed(awemeId, runId, message, options, operationId);
  }

  const freeformAgent = options.hyperframesFreeformAgent || defaultHyperframesFreeformAgent;
  let messages;
  let useSceneSpec = options.useSceneSpec !== false;
  try {
    if (useSceneSpec) {
      messages = freeformAgent.buildSceneSpecMessages({
        run: detail.data,
        brief: currentState.brief.data || {},
        skillContext: context.prompt_context,
        options: options.projectOptions || {},
      });
    } else {
      messages = freeformAgent.buildFreeformProjectMessages({
        run: detail.data,
        brief: currentState.brief.data || {},
        skillContext: context.prompt_context,
        options: options.projectOptions || {},
      });
    }
  } catch (error) {
    return markFreeformProjectFailed(
      awemeId,
      runId,
      `HyperFrames 工程生成失败：${error.message || '构建提示失败'}`,
      options,
      operationId,
    );
  }
  const modelService = options.aiTextModel || defaultAiTextModel;
  let modelResult;
  try {
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
    modelResult = {
      success: false,
      message: error.message || '模型调用失败',
    };
  }

  if (!modelResult.success) {
    const message = modelResult.message || 'HyperFrames 工程生成失败。';
    return markFreeformProjectFailed(awemeId, runId, message, options, operationId);
  }

  let parsed;
  let sceneSpec = null;
  try {
    if (useSceneSpec) {
      parsed = freeformAgent.parseSceneSpecResponse(modelResult.text || modelResult.raw_output || '');
      if (parsed.success) {
        sceneSpec = parsed.scene_spec;
        const composer = options.hyperframesSceneSpecComposer || defaultHyperframesSceneSpecComposer;
        const composed = composer.composeHyperframesProjectFiles(sceneSpec);
        if (!composed.success) {
          return markFreeformProjectFailed(
            awemeId,
            runId,
            `场景规格工程生成失败：${composed.message || '规格验证失败'}`,
            options,
            operationId,
          );
        }
        parsed = { success: true, summary: '工程已从场景规格生成', files: composed.files };
      }
    } else {
      parsed = freeformAgent.parseFreeformProjectResponse(modelResult.text || modelResult.raw_output || '');
    }
  } catch (error) {
    return markFreeformProjectFailed(
      awemeId,
      runId,
      `HyperFrames 工程解析失败：${error.message || '解析失败'}`,
      options,
      operationId,
    );
  }
  if (!parsed.success) {
    const message = parsed.message || '解析 HyperFrames 工程失败。';
    return markFreeformProjectFailed(awemeId, runId, message, options, operationId);
  }

  const projectService = options.hyperframesFreeformProject || defaultHyperframesFreeformProject;
  const tempRunId = `${runId}-${operationId}`;
  const projectAudio = currentState.audio?.status === 'ready' && currentState.audio?.path
    ? currentState.audio
    : null;
  let created;
  try {
    created = await projectService.createFreeformProject({
      awemeId,
      runId: tempRunId,
      rootDir: options.rootDir,
      files: parsed.files,
      audio: projectAudio,
    });
  } catch (error) {
    created = {
      success: false,
      message: `HyperFrames 工程写入失败：${error.message || '未知错误'}`,
    };
  }
  if (!created.success) {
    const message = created.message || 'HyperFrames 工程写入失败。';
    return markFreeformProjectFailed(awemeId, runId, message, options, operationId);
  }

  const tempProjectDir = created.project_dir || created.projectDir;
  try {
    validateFreeformTempProjectDir({
      tempDir: tempProjectDir,
      finalDir: defaultHyperframesFreeformProject.getFreeformProjectDir(awemeId, runId, options.rootDir),
      awemeId,
      rootDir: options.rootDir,
      tempRunId,
      operationId,
    });
  } catch (error) {
    return markFreeformProjectFailed(
      awemeId,
      runId,
      error.message || 'HyperFrames 临时工程目录不安全。',
      options,
      operationId,
    );
  }

  let snapshotMessage = '';
  if (context.source_dir && typeof skillContext.copySkillSnapshot === 'function') {
    let snapshot;
    try {
      snapshot = await skillContext.copySkillSnapshot({
        sourceDir: context.source_dir,
        projectDir: tempProjectDir,
      });
    } catch (error) {
      snapshot = {
        success: false,
        message: `HyperFrames skill 快照保存失败：${error.message || '未知错误'}`,
      };
    }
    if (snapshot && !snapshot.success) {
      snapshotMessage = snapshot.message || 'HyperFrames skill 快照保存失败。';
    }
  }

  const projectDir = defaultHyperframesFreeformProject.getFreeformProjectDir(awemeId, runId, options.rootDir);
  const indexPath = path.join(projectDir, 'index.html');
  const message = snapshotMessage || parsed.summary || created.message || 'HyperFrames 工程已生成。';
  const files = mapFreeformProjectFilesToDir(created.files || [], projectDir);
  let updated;
  try {
    updated = await withRunUpdateQueue(awemeId, runId, options, async () => {
      const latest = await getDouyinAgentRun(awemeId, runId, options);
      if (!latest.success) return latest;
      const current = normalizeHyperframesFreeformState(latest.data.hyperframes_freeform);
      if (current.project.operation_id !== operationId) {
        return {
          success: false,
          stale: true,
          aweme_id: String(awemeId),
          run_id: String(runId),
          message: '已有更新的生成任务完成，已忽略旧结果。',
          run: latest.data,
          hyperframes_freeform: current,
        };
      }

      await publishFreeformProjectDirectory({
        tempDir: tempProjectDir,
        finalDir: projectDir,
        operationId,
        awemeId,
        rootDir: options.rootDir,
        tempRunId,
      });
      const nextState = normalizeHyperframesFreeformState(mergeHyperframesFreeformPatch(current, {
        status: 'ready',
        project_dir: projectDir,
        project: {
          ...current.project,
          status: 'ready',
          operation_id: operationId,
          index_path: indexPath,
          files,
          message,
          scene_spec: sceneSpec || current.project.scene_spec || null,
        },
      }));
      const updatedRun = {
        ...latest.data,
        hyperframes_freeform: nextState,
        updated_at: new Date().toISOString(),
      };
      await writeJson(getRunPath(awemeId, runId, options.rootDir), updatedRun);
      return {
        success: true,
        aweme_id: String(awemeId),
        run_id: String(runId),
        data: updatedRun,
      };
    });
  } catch (error) {
    await cleanupFreeformTempProjectDir({
      tempDir: tempProjectDir,
      finalDir: projectDir,
      awemeId,
      rootDir: options.rootDir,
      tempRunId,
      operationId,
    });
    return markFreeformProjectFailed(
      awemeId,
      runId,
      `HyperFrames 工程发布失败：${error.message || '未知错误'}`,
      options,
      operationId,
    );
  }

  if (!updated.success) {
    if (updated.stale) {
      await cleanupFreeformTempProjectDir({
        tempDir: tempProjectDir,
        finalDir: projectDir,
        awemeId,
        rootDir: options.rootDir,
        tempRunId,
        operationId,
      });
    }
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: updated.message || '已有更新的生成任务完成，已忽略旧结果。',
      hyperframes_freeform: updated.hyperframes_freeform,
    };
  }

  return {
    success: true,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message,
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
  if (section === 'visual_inspect') return status === 'passed';
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

function areSameResolvedPath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(String(right || ''));
}

async function checkDouyinRunHyperframesFreeformProject(awemeId, runId, options = {}) {
  const detail = await getDouyinAgentRun(awemeId, runId, options);
  if (!detail.success) return detail;

  const currentState = normalizeHyperframesFreeformState(detail.data.hyperframes_freeform);
  if (!currentState.project_dir) {
    return failHyperframesFreeformSection(awemeId, runId, 'checks', '请先生成 HyperFrames 自由工程。', options);
  }

  const operationId = createFreeformOperationId('checks');
  await updateRunHyperframesFreeform(awemeId, runId, current => ({
    checks: {
      ...current.checks,
      operation_id: operationId,
      status: 'checking',
      message: '正在校验动画工程...',
    },
  }), options);

  const quality = options.hyperframesFreeformQuality || defaultHyperframesFreeformQuality;
  let result;
  try {
    result = await quality.checkFreeformProject({ projectDir: currentState.project_dir });
  } catch (error) {
    result = {
      success: false,
      message: `动画工程校验失败：${error.message || '未知错误'}`,
    };
  }

  const success = !!result?.success;
  const message = result?.message || (success ? '动画工程校验通过。' : '动画工程校验失败。');
  const updated = await updateRunHyperframesFreeformIfOperationCurrent(awemeId, runId, 'checks', operationId, current => ({
    checks: {
      ...current.checks,
      status: success ? 'passed' : 'failed',
      lint: result?.lint || '',
      validate: result?.validate || '',
      inspect: result?.inspect || '',
      report: result?.report || null,
      message,
    },
  }), options);

  return createHyperframesFreeformOperationResponse(awemeId, runId, 'checks', updated, success, message);
}

async function renderDouyinRunHyperframesFreeformVideo(awemeId, runId, options = {}) {
  const detail = await getDouyinAgentRun(awemeId, runId, options);
  if (!detail.success) return detail;

  const currentState = normalizeHyperframesFreeformState(detail.data.hyperframes_freeform);
  if (!currentState.project_dir) {
    return failHyperframesFreeformSection(awemeId, runId, 'render', '请先生成 HyperFrames 自由工程。', options);
  }

  const renderOptions = options.renderOptions || {};
  const operationId = createFreeformOperationId('render');
  await updateRunHyperframesFreeform(awemeId, runId, current => ({
    render: {
      ...current.render,
      operation_id: operationId,
      status: 'rendering',
      render_options: renderOptions,
      message: '正在渲染视频...',
    },
  }), options);

  const renderer = options.hyperframesRenderer || defaultHyperframesRenderer;
  let result;
  try {
    result = await renderer.renderHyperframesProject({
      projectDir: currentState.project_dir,
      renderOptions,
    });
  } catch (error) {
    result = {
      success: false,
      message: `视频渲染失败：${error.message || '未知错误'}`,
    };
  }

  const success = !!result?.success;
  const message = result?.message || (success ? '视频渲染完成。' : '视频渲染失败。');
  const updated = await updateRunHyperframesFreeformIfOperationCurrent(awemeId, runId, 'render', operationId, current => ({
    render: {
      ...current.render,
      status: success ? 'rendered' : 'failed',
      output_path: success ? result.output_path : current.render.output_path || '',
      output_url: success ? defaultHyperframesFreeformProject.buildFreeformFileUrl(awemeId, runId, 'output.mp4') : current.render.output_url || '',
      render_options: renderOptions,
      message,
    },
  }), options);

  return createHyperframesFreeformOperationResponse(awemeId, runId, 'render', updated, success, message);
}

async function inspectDouyinRunHyperframesFreeformVideo(awemeId, runId, options = {}) {
  const detail = await getDouyinAgentRun(awemeId, runId, options);
  if (!detail.success) return detail;

  const currentState = normalizeHyperframesFreeformState(detail.data.hyperframes_freeform);
  if (!currentState.project_dir) {
    return failHyperframesFreeformSection(awemeId, runId, 'visual_inspect', '请先生成 HyperFrames 自由工程。', options);
  }

  const outputPath = currentState.render?.output_path || path.join(currentState.project_dir, 'output.mp4');
  if (!(await pathExists(outputPath))) {
    return failHyperframesFreeformSection(awemeId, runId, 'visual_inspect', '请先渲染 HyperFrames 自由视频。', options, {
      output_path: outputPath,
    });
  }

  const operationId = createFreeformOperationId('inspect');
  await updateRunHyperframesFreeform(awemeId, runId, current => ({
    visual_inspect: {
      ...current.visual_inspect,
      operation_id: operationId,
      status: 'inspecting',
      output_path: outputPath,
      message: '正在抽帧质检...',
    },
  }), options);

  const quality = options.hyperframesFreeformQuality || defaultHyperframesFreeformQuality;
  let result;
  try {
    result = await quality.inspectRenderedVideo({
      projectDir: currentState.project_dir,
      outputPath,
    });
  } catch (error) {
    result = {
      success: false,
      message: `视频抽帧质检失败：${error.message || '未知错误'}`,
    };
  }

  const success = !!result?.success;
  const report = result?.report || null;
  const issues = Array.isArray(report?.issues)
    ? report.issues
    : Array.isArray(result?.issues)
      ? result.issues
      : [];
  let normalizedSuccess = success;
  const candidateContactSheetPath = result?.contact_sheet_path || '';
  let message = result?.message || (success ? '视频抽帧质检通过。' : '视频抽帧质检失败。');
  const rootContactSheetPath = path.join(currentState.project_dir, 'contact_sheet.jpg');
  if (success) {
    const hasCandidateContactSheet = candidateContactSheetPath
      ? await pathExists(candidateContactSheetPath)
      : await pathExists(rootContactSheetPath);
    if (!hasCandidateContactSheet) {
      normalizedSuccess = false;
      message = '联系表文件不存在，无法生成预览。';
    }
  }
  const updated = await updateRunHyperframesFreeformIfOperationCurrentAnd(
    awemeId,
    runId,
    'visual_inspect',
    operationId,
    current => areSameResolvedPath(current.render?.output_path || path.join(current.project_dir, 'output.mp4'), outputPath),
    async current => {
      let finalSuccess = normalizedSuccess;
      let finalMessage = message;
      if (finalSuccess) {
        try {
          await fsp.mkdir(path.dirname(rootContactSheetPath), { recursive: true });
          if (candidateContactSheetPath && !areSameResolvedPath(candidateContactSheetPath, rootContactSheetPath)) {
            await fsp.copyFile(candidateContactSheetPath, rootContactSheetPath);
          }
          if (!(await pathExists(rootContactSheetPath))) {
            finalSuccess = false;
            finalMessage = '联系表文件不存在，无法生成预览。';
          }
        } catch (error) {
          finalSuccess = false;
          finalMessage = `联系表预览文件准备失败：${error.message || '未知错误'}`;
        }
      }
      return {
        visual_inspect: {
          ...current.visual_inspect,
          status: finalSuccess ? 'passed' : 'failed',
          output_path: outputPath,
          contact_sheet_path: finalSuccess ? rootContactSheetPath : '',
          contact_sheet_url: finalSuccess ? defaultHyperframesFreeformProject.buildFreeformFileUrl(awemeId, runId, 'contact_sheet.jpg') : '',
          report,
          issues,
          message: finalMessage,
        },
      };
    },
    options,
  );

  return createHyperframesFreeformOperationResponse(awemeId, runId, 'visual_inspect', updated, normalizedSuccess, message);
}

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
  if (!name || path.basename(name) !== name || !name.startsWith(`${runId}-tts.`)) {
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

async function createDouyinRunHyperframesProject(awemeId, runId, options = {}) {
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
  if (!Array.isArray(run?.storyboard?.scenes) || run.storyboard.scenes.length === 0) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '请先生成 AI 分镜。',
    };
  }
  if (run.video?.status === 'rendering') {
    const video = {
      ...run.video,
      message: run.video.message || '视频正在渲染中，请等待当前任务完成后再重新生成视频工程。',
    };
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: video.message,
      video,
    };
  }

  const projectService = options.hyperframesProject || defaultHyperframesProject;
  const projectDir = getHyperframesProjectDir(awemeId, runId, options.rootDir);
  const renderOptions = defaultHyperframesProject.normalizeRenderOptions(options.renderOptions || run.video?.render_options || {});
  const result = await projectService.createOriginalCaptionProject({ run, projectDir, renderOptions });

  if (!result.success) {
    const video = {
      status: 'failed',
      template: 'ai_storyboard_cards',
      message: result.message || '视频工程生成失败。',
      updated_at: new Date().toISOString(),
    };
    const nextRun = { ...run, video, updated_at: new Date().toISOString() };
    nextRun.workflow = workflowDecision.decideNextAction(nextRun);
    await writeJson(runPath, nextRun);
    return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video, workflow: nextRun.workflow };
  }

  const video = {
    status: 'project_ready',
    template: result.template,
    project_dir: result.project_dir,
    index_path: result.index_path,
    storyboard_path: result.storyboard_path,
    captions_path: result.captions_path,
    project_json_path: result.project_json_path,
    duration: result.duration,
    render_options: result.render_options || renderOptions,
    video_quality_report: result.video_quality_report || result.project?.video_quality_report || null,
    message: result.message || '视频工程已生成。',
    updated_at: new Date().toISOString(),
  };
  const nextRun = { ...run, video, updated_at: new Date().toISOString() };
  nextRun.workflow = workflowDecision.decideNextAction(nextRun);
  await writeJson(runPath, nextRun);
  return { success: true, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video, workflow: nextRun.workflow };
}

async function updateDouyinRunStoryboard(awemeId, runId, storyboard, options = {}) {
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

  const captions = Array.isArray(run?.tts?.captions) ? run.tts.captions : [];
  if (!captions.length) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '请先完成 TTS 合成并生成字幕时间轴。',
    };
  }

  const validation = storyboardSchema.validateStoryboardEditableInput({ storyboard, captions });
  if (!validation.success) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '分镜校验失败，请修正后再保存。',
      storyboard_schema_validation: validation,
    };
  }

  const normalized = storyboardSchema.normalizeStoryboard({ storyboard, captions });
  const updatedRun = {
    ...run,
    storyboard: normalized,
    storyboard_schema_validation: { success: true, errors: [] },
    video: null,
    updated_at: new Date().toISOString(),
  };
  updatedRun.workflow = workflowDecision.decideNextAction(updatedRun);
  await writeJson(runPath, updatedRun);

  return {
    success: true,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message: '分镜已保存，请重新生成视频工程。',
    storyboard: normalized,
    storyboard_schema_validation: updatedRun.storyboard_schema_validation,
    workflow: updatedRun.workflow,
  };
}

async function renderDouyinRunHyperframesVideo(awemeId, runId, options = {}) {
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
  if (run.video?.status === 'rendering') {
    const video = {
      ...run.video,
      message: run.video.message || '视频正在渲染中，请等待当前任务完成。',
    };
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: video.message,
      video,
    };
  }

  const projectDir = run.video?.project_dir || getHyperframesProjectDir(awemeId, runId, options.rootDir);
  const renderer = options.hyperframesRenderer || defaultHyperframesRenderer;
  const renderOptions = defaultHyperframesProject.normalizeRenderOptions(run.video?.render_options || {});
  const runQualityReport = run.video?.video_quality_report || null;
  const projectJsonPath = run.video?.project_json_path || path.join(projectDir, 'project.json');
  const projectJson = await readJsonIfExists(projectJsonPath);
  const diskQualityReport = projectJson?.video_quality_report || null;
  const qualityReport = [runQualityReport, diskQualityReport].find(report => report?.pass === false)
    || runQualityReport
    || diskQualityReport
    || null;
  if (qualityReport && qualityReport.pass === false) {
    const firstError = Array.isArray(qualityReport.issues)
      ? qualityReport.issues.find(issue => issue?.severity === 'error') || qualityReport.issues[0]
      : null;
    const video = {
      ...(run.video || {}),
      status: 'failed',
      render_options: renderOptions,
      video_quality_report: qualityReport,
      message: firstError?.message
        ? `视频质量未通过：${firstError.message}`
        : '视频质量未通过，请先重新生成分镜或调整视频工程。',
      updated_at: new Date().toISOString(),
    };
    const nextRun = { ...run, video, updated_at: new Date().toISOString() };
    nextRun.workflow = workflowDecision.decideNextAction(nextRun);
    await writeJson(runPath, nextRun);
    return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video, workflow: nextRun.workflow };
  }
  const renderingVideo = {
    ...(run.video || {}),
    status: 'rendering',
    template: run.video?.template || 'ai_storyboard_cards',
    project_dir: projectDir,
    render_options: renderOptions,
    message: '视频正在渲染中，请勿刷新后重复生成视频工程。',
    updated_at: new Date().toISOString(),
  };
  const renderingRun = { ...run, video: renderingVideo, updated_at: new Date().toISOString() };
  renderingRun.workflow = workflowDecision.decideNextAction(renderingRun);
  await writeJson(runPath, renderingRun);

  const result = await renderer.renderHyperframesProject({ projectDir, renderOptions });

  if (!result.success) {
    const video = {
      ...renderingVideo,
      status: 'failed',
      render_options: renderOptions,
      message: result.message || '视频渲染失败。',
      updated_at: new Date().toISOString(),
    };
    const nextRun = { ...run, video, updated_at: new Date().toISOString() };
    nextRun.workflow = workflowDecision.decideNextAction(nextRun);
    await writeJson(runPath, nextRun);
    return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video, workflow: nextRun.workflow };
  }

  const video = {
    ...renderingVideo,
    status: 'rendered',
    template: run.video?.template || 'ai_storyboard_cards',
    project_dir: projectDir,
    output_path: result.output_path,
    output_url: getHyperframesFileUrl(awemeId, runId, 'output.mp4'),
    render_options: renderOptions,
    message: result.message || '视频渲染完成。',
    updated_at: new Date().toISOString(),
  };
  const nextRun = { ...run, video, updated_at: new Date().toISOString() };
  nextRun.workflow = workflowDecision.decideNextAction(nextRun);
  await writeJson(runPath, nextRun);
  return { success: true, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video, workflow: nextRun.workflow };
}

function resolveDouyinRunHyperframesFile(awemeId, runId, fileName, options = {}) {
  if (!isSafeId(awemeId) || !isSafeRunId(runId)) {
    throw new Error('Invalid HyperFrames file request');
  }

  const name = String(fileName || '');
  if (!name || path.basename(name) !== name || name !== 'output.mp4') {
    throw new Error('Invalid HyperFrames file request');
  }

  const projectDir = path.resolve(getHyperframesProjectDir(awemeId, runId, options.rootDir));
  const targetPath = path.resolve(projectDir, name);
  const relative = path.relative(projectDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('HyperFrames file is outside project directory');
  }

  return targetPath;
}

function resolveDouyinRunHyperframesFreeformFile(awemeId, runId, fileName, options = {}) {
  if (!isSafeId(awemeId) || !isSafeRunId(runId)) {
    throw new Error('非法的 HyperFrames 自由工程文件请求。');
  }

  const projectDir = defaultHyperframesFreeformProject.getFreeformProjectDir(awemeId, runId, options.rootDir);
  return defaultHyperframesFreeformProject.resolveFreeformFile(projectDir, fileName);
}

async function saveDouyinRunHyperframesFreeformFile(awemeId, runId, fileName, content, options = {}) {
  if (!isSafeId(awemeId) || !isSafeRunId(runId)) {
    throw new Error('非法的 HyperFrames 自由工程文件请求。');
  }

  const projectDir = defaultHyperframesFreeformProject.getFreeformProjectDir(awemeId, runId, options.rootDir);
  const nextContent = content && typeof content === 'object' && Object.prototype.hasOwnProperty.call(content, 'content')
    ? content.content
    : content;
  const result = await defaultHyperframesFreeformProject.writeFreeformFile({
    projectDir,
    fileName,
    content: nextContent,
  });

  return {
    ...result,
    aweme_id: String(awemeId),
    run_id: String(runId),
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
  checkDouyinRunHyperframesFreeformProject,
  renderDouyinRunHyperframesFreeformVideo,
  inspectDouyinRunHyperframesFreeformVideo,
  synthesizeDouyinRunTts,
  synthesizeDouyinRunSceneTts,
  compressDouyinRunSceneNarration,
  resolveDouyinRunTtsFile,
  createDouyinRunStoryboard,
  createDouyinRunVisualStoryboard,
  updateDouyinRunStoryboard,
  createDouyinRunHyperframesProject,
  renderDouyinRunHyperframesVideo,
  resolveDouyinRunHyperframesFile,
  resolveDouyinRunHyperframesFreeformFile,
  saveDouyinRunHyperframesFreeformFile,
  decideNextAction: workflowDecision.decideNextAction,
  listAgentTemplates: agentTemplates.listAgentTemplates,
  summarizeComments,
  buildPrompt: agentTemplates.getAgentTemplate(TEMPLATE_VIRAL_REWRITE).buildPrompt,
};
