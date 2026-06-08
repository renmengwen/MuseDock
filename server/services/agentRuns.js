const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mediaPipeline = require('./mediaPipeline');
const defaultAiTextModel = require('./aiTextModel');
const defaultAiTtsModel = require('./aiTtsModel');
const agentTemplates = require('./agentTemplates');
const ttsTimeline = require('./ttsTimeline');
const defaultStoryboardAgent = require('./storyboardAgent');
const defaultHyperframesProject = require('./hyperframesProject');
const defaultHyperframesRenderer = require('./hyperframesRenderer');

const TEMPLATE_VIRAL_REWRITE = 'viral_rewrite';
const MAX_COMMENTS_CHARS = agentTemplates.MAX_COMMENTS_CHARS;

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

function parseModelText(text, templateDefinition) {
  try {
    return {
      parsed: true,
      result: templateDefinition.normalizeResult(JSON.parse(text)),
      raw_text: '',
    };
  } catch {
    return {
      parsed: false,
      result: templateDefinition.normalizeResult({}),
      raw_text: typeof text === 'string' ? text : '',
    };
  }
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

async function persistRun(awemeId, run, rootDir) {
  const filePath = getRunPath(awemeId, run.run_id, rootDir);
  const data = { ...run, path: filePath };
  await writeJson(filePath, data);
  return data;
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
  const messages = templateDefinition.buildPrompt({
    analysisInput,
    transcript,
    commentsText,
    commentCount: comments.length,
    promptOptions,
  });

  const modelService = options.aiTextModel || defaultAiTextModel;
  let modelResult;
  try {
    modelResult = await modelService.callTextModel({
      messages,
      temperature: 0.4,
      configPath: options.configPath,
      textConfig: options.textConfig,
      fetchImpl: options.fetchImpl,
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
    result: parsed.result,
    raw_text: parsed.raw_text,
    message: parsed.parsed ? 'Agent 运行完成' : '模型返回未能解析为结构化结果，已保留原始文本。',
    created_at: new Date().toISOString(),
  };

  return persistRun(awemeId, run, rootDir);
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
    const item = await readJsonIfExists(path.join(dir, name));
    if (item) data.push(item);
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
  const data = await readJsonIfExists(filePath);
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
  const storyboardOptions = defaultStoryboardAgent.normalizeStoryboardOptions(options.storyboardOptions || run.storyboard_options || {});
  const result = await agent.createStoryboard({
    rewriteScript,
    captions,
    storyboardOptions,
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
    updated_at: new Date().toISOString(),
  };
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

  const projectService = options.hyperframesProject || defaultHyperframesProject;
  const projectDir = getHyperframesProjectDir(awemeId, runId, options.rootDir);
  const result = await projectService.createOriginalCaptionProject({ run, projectDir });

  if (!result.success) {
    const video = {
      status: 'failed',
      template: 'ai_storyboard_cards',
      message: result.message || '视频工程生成失败。',
      updated_at: new Date().toISOString(),
    };
    await writeJson(runPath, { ...run, video, updated_at: new Date().toISOString() });
    return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video };
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
    message: result.message || '视频工程已生成。',
    updated_at: new Date().toISOString(),
  };
  await writeJson(runPath, { ...run, video, updated_at: new Date().toISOString() });
  return { success: true, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video };
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

  const projectDir = run.video?.project_dir || getHyperframesProjectDir(awemeId, runId, options.rootDir);
  const renderer = options.hyperframesRenderer || defaultHyperframesRenderer;
  const result = await renderer.renderHyperframesProject({ projectDir });

  if (!result.success) {
    const video = {
      ...(run.video || {}),
      status: 'failed',
      message: result.message || '视频渲染失败。',
      updated_at: new Date().toISOString(),
    };
    await writeJson(runPath, { ...run, video, updated_at: new Date().toISOString() });
    return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video };
  }

  const video = {
    ...(run.video || {}),
    status: 'rendered',
    template: run.video?.template || 'ai_storyboard_cards',
    project_dir: projectDir,
    output_path: result.output_path,
    output_url: getHyperframesFileUrl(awemeId, runId, 'output.mp4'),
    message: result.message || '视频渲染完成。',
    updated_at: new Date().toISOString(),
  };
  await writeJson(runPath, { ...run, video, updated_at: new Date().toISOString() });
  return { success: true, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video };
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
  listDouyinAgentRuns,
  getDouyinAgentRun,
  synthesizeDouyinRunTts,
  resolveDouyinRunTtsFile,
  createDouyinRunStoryboard,
  createDouyinRunHyperframesProject,
  renderDouyinRunHyperframesVideo,
  resolveDouyinRunHyperframesFile,
  listAgentTemplates: agentTemplates.listAgentTemplates,
  summarizeComments,
  buildPrompt: agentTemplates.getAgentTemplate(TEMPLATE_VIRAL_REWRITE).buildPrompt,
};
