const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mediaPipeline = require('./mediaPipeline');
const defaultAiTextModel = require('./aiTextModel');
const douyinStore = require('./douyinStore');

const TEMPLATE_VIRAL_REWRITE = 'viral_rewrite';
const MAX_TRANSCRIPT_CHARS = 8000;
const MAX_COMMENTS_CHARS = 4000;

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

function makeStep(id, label, status, message = '') {
  return { id, label, status, message };
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
    : [];
}

function normalizeResult(value = {}) {
  const result = value && typeof value === 'object' ? value : {};
  return {
    summary: typeof result.summary === 'string' ? result.summary : '',
    viral_points: normalizeStringArray(result.viral_points),
    audience: typeof result.audience === 'string' ? result.audience : '',
    comment_insights: normalizeStringArray(result.comment_insights),
    topics: normalizeStringArray(result.topics),
    rewrite_script: typeof result.rewrite_script === 'string' ? result.rewrite_script : '',
    titles: normalizeStringArray(result.titles),
  };
}

function parseModelText(text) {
  try {
    return {
      parsed: true,
      result: normalizeResult(JSON.parse(text)),
      raw_text: '',
    };
  } catch {
    return {
      parsed: false,
      result: normalizeResult({}),
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

function buildPrompt({ analysisInput = {}, transcript = {}, commentsText = '', commentCount = 0 } = {}) {
  const video = analysisInput.video || {};
  const statistics = video.statistics || {};
  const transcriptText = typeof transcript.text === 'string' ? transcript.text : '';
  const transcriptTruncated = transcriptText.length > MAX_TRANSCRIPT_CHARS;
  const promptTranscript = transcriptTruncated
    ? transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)
    : transcriptText;
  const transcriptNote = transcriptTruncated
    ? `转写文本已截断，仅保留前 ${MAX_TRANSCRIPT_CHARS} 字。`
    : '转写文本未截断。';
  const commentsNote = commentCount > 0
    ? `本地评论缓存共 ${commentCount} 条，以下是抽样评论：\n${commentsText}`
    : '暂无本地评论缓存。评论洞察需要基于视频内容谨慎推断，并在结果中说明依据不足。';

  return [
    {
      role: 'system',
      content: [
        '你是 MuseDock 的受控内容创作 Agent。',
        '请只输出 JSON，不要输出 Markdown、解释或代码块。',
        'JSON 字段必须包含 summary, viral_points, audience, comment_insights, topics, rewrite_script, titles。',
        'viral_points, comment_insights, topics, titles 必须是字符串数组。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '任务：爆款拆解 + 改写脚本。',
        `视频标题：${video.title || ''}`,
        `作者：${video.author?.nickname || ''}`,
        `链接：${video.aweme_url || ''}`,
        `统计：点赞 ${statistics.digg_count || statistics.liked_count || 0}，评论 ${statistics.comment_count || 0}，分享 ${statistics.share_count || 0}`,
        '',
        '转写文本：',
        transcriptNote,
        promptTranscript,
        '',
        '评论信息：',
        commentsNote,
      ].join('\n'),
    },
  ];
}

function createInputSummary({ analysisInput, transcript, comments }) {
  return {
    title: analysisInput?.video?.title || '',
    author: analysisInput?.video?.author?.nickname || '',
    has_transcript: !!(transcript && transcript.text),
    transcript_chars: transcript?.text ? transcript.text.length : 0,
    transcript_truncated: !!(transcript?.text && transcript.text.length > MAX_TRANSCRIPT_CHARS),
    comment_count: Array.isArray(comments) ? comments.length : 0,
  };
}

async function persistRun(awemeId, run, rootDir) {
  const filePath = getRunPath(awemeId, run.run_id, rootDir);
  const data = { ...run, path: filePath };
  await writeJson(filePath, data);
  return data;
}

async function createFailureRun(awemeId, template, message, options = {}) {
  const run = {
    success: false,
    run_id: createRunId(template),
    template,
    aweme_id: String(awemeId),
    status: 'failed',
    model: options.model || {},
    steps: options.steps || [],
    input_summary: options.input_summary || {},
    result: normalizeResult({}),
    raw_text: '',
    message,
    created_at: new Date().toISOString(),
  };

  if (options.persist === false) {
    return run;
  }

  return persistRun(awemeId, run, options.rootDir);
}

async function createDouyinAgentRun(awemeId, options = {}) {
  const template = options.template || TEMPLATE_VIRAL_REWRITE;
  const rootDir = options.rootDir;
  const steps = [];

  if (!isSafeId(awemeId)) {
    return createInvalidAwemeResult(awemeId);
  }

  if (template !== TEMPLATE_VIRAL_REWRITE) {
    return createFailureRun(awemeId, template, '暂不支持该 Agent 模板。', {
      rootDir,
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
    return createFailureRun(awemeId, template, '未找到转写文本，请先完成该视频的音频转写。', {
      rootDir,
      steps,
      input_summary: createInputSummary({ analysisInput, transcript, comments: [] }),
    });
  }

  const getLocalComments = options.getLocalComments || douyinStore.getLocalDouyinComments;
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

  const commentsText = summarizeComments(comments);
  const inputSummary = createInputSummary({ analysisInput, transcript, comments });
  const messages = buildPrompt({
    analysisInput,
    transcript,
    commentsText,
    commentCount: comments.length,
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
    });
  }

  const parsed = parseModelText(modelResult.text);
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

module.exports = {
  TEMPLATE_VIRAL_REWRITE,
  createDouyinAgentRun,
  listDouyinAgentRuns,
  getDouyinAgentRun,
  summarizeComments,
  buildPrompt,
};
