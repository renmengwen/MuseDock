#!/usr/bin/env node
// 质量评测闭环：固定选题集 -> 批量跑一键创作 -> 自动指标 + 视觉模型打分 -> 单次报告 + 跨 run 曲线。
// 用法：
//   node scripts/quality-eval/index.js                       # 全量跑（需先启动后端 npm run dev / npm start）
//   node scripts/quality-eval/index.js --label baseline      # 指定 run 标签；同标签重跑会跳过已完成选题（断点续跑）
//   node scripts/quality-eval/index.js --filter howto-sleep  # 只跑部分选题（逗号分隔，匹配 id 前缀）
//   node scripts/quality-eval/index.js --rescore baseline    # 不重新生成，只对已有 run 重新打分 + 出报告
//   node scripts/quality-eval/index.js --report-only         # 只重建所有报告
// 结果写入 data/quality-eval/<label>/（run.json + report.md），曲线在 data/quality-eval/history.md。

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execSync } = require('child_process');

const dataRoot = require('../../server/dataRoot');
const { callTextModel } = require('../../server/services/ai/aiTextModel');
const visualQaService = require('../../server/services/creative-video/visualQaService');

const WORKFLOW_RECORD_ROOT = path.join(dataRoot, 'data/creative-workflows');
const EVAL_ROOT = path.join(dataRoot, 'data/quality-eval');
const DEFAULT_BASE_URL = process.env.MUSEDOCK_EVAL_BASE_URL || 'http://127.0.0.1:3000';
const POLL_INTERVAL_MS = 15000;
const WORKFLOW_TIMEOUT_MS = 45 * 60 * 1000;

const VISION_DIMENSIONS = ['readability', 'layout', 'richness', 'coherence', 'aesthetics'];
const VISION_DIMENSION_LABELS = {
  readability: '文字可读性',
  layout: '布局完整性',
  richness: '画面丰富度',
  coherence: '信息传达',
  aesthetics: '整体美感',
};

// ---------- 纯打分逻辑（tests/test-quality-eval-scoring.js 有断言） ----------

function computeAutoScore({ durationSec, targetSec, inspectIssues = [] } = {}) {
  let score = 100;
  const deductions = [];
  const duration = Number(durationSec);
  const target = Number(targetSec);
  if (Number.isFinite(duration) && duration > 0 && Number.isFinite(target) && target > 0) {
    const deviation = Math.abs(duration - target) / target;
    if (deviation > 0.25) {
      deductions.push({ code: 'duration_deviation_high', penalty: 20, detail: `时长偏离目标 ${(deviation * 100).toFixed(0)}%` });
    } else if (deviation > 0.1) {
      deductions.push({ code: 'duration_deviation', penalty: 8, detail: `时长偏离目标 ${(deviation * 100).toFixed(0)}%` });
    }
  } else {
    deductions.push({ code: 'duration_unknown', penalty: 10, detail: '无法读取实际时长' });
  }
  for (const issue of inspectIssues) {
    deductions.push({ code: issue.code || 'inspect_issue', penalty: 12, detail: issue.message || '' });
  }
  score -= deductions.reduce((sum, d) => sum + d.penalty, 0);
  return { score: Math.max(0, score), deductions };
}

function computeVisionScore(scores = {}) {
  let total = 0;
  for (const key of VISION_DIMENSIONS) {
    const value = Number(scores[key]);
    if (!Number.isFinite(value) || value < 0 || value > 10) return null;
    total += value;
  }
  return Math.round(total * 2);
}

function computeOverall({ status, autoScore, visionScore } = {}) {
  if (status !== 'done') return 0;
  const auto = Number.isFinite(Number(autoScore)) ? Number(autoScore) : 0;
  if (visionScore == null || !Number.isFinite(Number(visionScore))) return Math.round(auto);
  return Math.round(0.6 * auto + 0.4 * Number(visionScore));
}

function parseJsonLoose(text = '') {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch { /* 继续尝试提取 JSON 片段 */ }
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function summarizeRun(run) {
  const topics = Array.isArray(run.topics) ? run.topics : [];
  const finished = topics.filter(t => ['done', 'failed', 'timeout'].includes(t.status));
  const done = topics.filter(t => t.status === 'done');
  const isScore = value => value != null && Number.isFinite(Number(value));
  const scored = done.filter(t => isScore(t.overall));
  const visionScored = done.filter(t => isScore(t.vision_score));
  const avg = (list, pick) => (list.length
    ? Math.round(list.reduce((sum, t) => sum + Number(pick(t)), 0) / list.length)
    : null);
  return {
    topic_count: topics.length,
    finished_count: finished.length,
    done_count: done.length,
    success_rate: finished.length ? Math.round((done.length / finished.length) * 100) : null,
    avg_overall: avg(scored, t => t.overall),
    avg_auto: avg(scored, t => t.auto_score),
    avg_vision: avg(visionScored, t => t.vision_score),
  };
}

function formatDuration(sec) {
  const value = Number(sec);
  if (!Number.isFinite(value) || value <= 0) return '-';
  return value >= 90 ? `${Math.round(value / 60)}min` : `${Math.round(value)}s`;
}

function renderRunReport(run) {
  const summary = summarizeRun(run);
  const lines = [];
  lines.push(`# 质量评测报告：${run.label}`);
  lines.push('');
  lines.push(`- 时间：${run.started_at || '-'} · git：\`${run.git_rev || '-'}\``);
  lines.push(`- 选题：${summary.topic_count} · 完成：${summary.finished_count} · 成片率：${summary.success_rate == null ? '-' : `${summary.success_rate}%`}`);
  lines.push(`- 平均分：overall ${summary.avg_overall ?? '-'} · auto ${summary.avg_auto ?? '-'} · vision ${summary.avg_vision ?? '-'}`);
  lines.push('');
  lines.push('| 选题 | 状态 | 时长(实/目标) | 耗时 | auto | vision | overall | workflow |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const topic of run.topics || []) {
    const durationCell = topic.duration_sec
      ? `${Math.round(topic.duration_sec)}s / ${topic.target_sec || '-'}s`
      : `- / ${topic.target_sec || '-'}s`;
    lines.push([
      `${topic.id}（${topic.label || ''}）`,
      topic.status || 'pending',
      durationCell,
      formatDuration(topic.wall_sec),
      topic.auto_score ?? '-',
      topic.vision_score ?? (topic.vision_error ? '不可用' : '-'),
      topic.overall ?? '-',
      topic.workflow_id || '-',
    ].map(cell => String(cell)).join(' | ').replace(/^/, '| ').concat(' |'));
  }
  lines.push('');

  const issueCounts = new Map();
  for (const topic of run.topics || []) {
    for (const d of topic.auto_deductions || []) {
      issueCounts.set(d.code, (issueCounts.get(d.code) || 0) + 1);
    }
    for (const issue of topic.vision_issues || []) {
      issueCounts.set(`vision: ${issue}`, (issueCounts.get(`vision: ${issue}`) || 0) + 1);
    }
  }
  if (issueCounts.size) {
    lines.push('## 问题频次');
    lines.push('');
    for (const [code, count] of [...issueCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${code} ×${count}`);
    }
    lines.push('');
  }

  const failures = (run.topics || []).filter(t => ['failed', 'timeout'].includes(t.status));
  if (failures.length) {
    lines.push('## 失败明细');
    lines.push('');
    for (const topic of failures) {
      lines.push(`- **${topic.id}**（${topic.status}）：[${topic.failure_stage || '未知阶段'}] ${topic.failure_message || '无错误信息'}`);
    }
    lines.push('');
  }

  const visionSummaries = (run.topics || []).filter(t => t.vision_summary);
  if (visionSummaries.length) {
    lines.push('## 视觉模型点评');
    lines.push('');
    for (const topic of visionSummaries) {
      lines.push(`- **${topic.id}**：${topic.vision_summary}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderHistory(runs) {
  const lines = [];
  lines.push('# 质量评测曲线');
  lines.push('');
  lines.push('每行一个 run，按时间排序。改完 prompt 规则跑一轮，看这张表的分数走向。');
  lines.push('');
  lines.push('| run | 时间 | git | 选题 | 成片率 | overall | auto | vision |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  const sorted = [...runs].sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')));
  for (const run of sorted) {
    const summary = summarizeRun(run);
    lines.push(`| ${run.label} | ${String(run.started_at || '-').slice(0, 16)} | \`${run.git_rev || '-'}\` | ${summary.done_count}/${summary.topic_count} | ${summary.success_rate == null ? '-' : `${summary.success_rate}%`} | ${summary.avg_overall ?? '-'} | ${summary.avg_auto ?? '-'} | ${summary.avg_vision ?? '-'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------- 视觉模型打分 ----------

function buildVisionPrompt(topicInput) {
  return [
    '你是短视频成片质检员。下面这张拼图是一条短视频按时间顺序等间隔抽帧的画面（从左到右、从上到下），视频由 HTML 动效帧渲染而成。',
    `视频选题：${topicInput}`,
    '请只依据画面本身，按 0-10 整数打分：',
    '- readability 文字可读性（字号、对比度、是否被裁切或溢出画面）',
    '- layout 布局完整性（元素溢出、遮挡、留白失衡、明显破版）',
    '- richness 画面丰富度（版式是否多样，是否像单调的 PPT 卡片轮播）',
    '- coherence 信息传达（画面内容是否围绕选题、结构是否清晰）',
    '- aesthetics 整体美感（配色、层次、专业感）',
    '严格输出 JSON，不要输出其它内容：',
    '{"scores":{"readability":0,"layout":0,"richness":0,"coherence":0,"aesthetics":0},"issues":["具体问题，没有则为空数组"],"summary":"一句话总评"}',
  ].join('\n');
}

async function scoreWithVisionModel({ contactSheetPath, topicInput, visionModelId }) {
  if (!contactSheetPath || !fs.existsSync(contactSheetPath)) {
    return { error: '缺少抽帧拼图，无法视觉打分' };
  }
  const imageBase64 = (await fsp.readFile(contactSheetPath)).toString('base64');
  let textConfig;
  if (visionModelId) {
    const aiModelConfig = require('../../server/services/ai/aiModelConfig');
    const config = await aiModelConfig.getRuntimeConfig('text', {});
    textConfig = { ...config, modelId: visionModelId };
  }
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: buildVisionPrompt(topicInput) },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
    ],
  }];
  let result = await callTextModel({ messages, temperature: 0, response_format: { type: 'json_object' }, textConfig });
  if (!result.success) {
    // 部分 provider 不支持 response_format，去掉重试一次
    result = await callTextModel({ messages, temperature: 0, textConfig });
  }
  if (!result.success) {
    return { error: result.message || '视觉模型调用失败' };
  }
  const parsed = parseJsonLoose(result.text);
  const score = parsed ? computeVisionScore(parsed.scores) : null;
  if (score == null) {
    return { error: `视觉模型返回无法解析：${String(result.text || '').slice(0, 120)}` };
  }
  return {
    score,
    scores: parsed.scores,
    issues: Array.isArray(parsed.issues)
      ? parsed.issues.map(item => String(item).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10)
      : [],
    summary: String(parsed.summary || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  };
}

// ---------- 工作流驱动 ----------

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}

async function assertServerAlive(baseUrl) {
  try {
    const { ok } = await requestJson(`${baseUrl}/api/creative-workflows`);
    if (ok) return;
  } catch { /* fallthrough */ }
  throw new Error(`后端不可用：${baseUrl}。请先启动 npm run dev 或 npm start，或用 --base-url 指定地址。`);
}

async function createWorkflow(baseUrl, topic, defaults) {
  const override = { ...defaults, ...(topic.override || {}) };
  const { ok, status, json } = await requestJson(`${baseUrl}/api/creative-workflows`, {
    method: 'POST',
    body: JSON.stringify({
      input: topic.input,
      assetIds: [],
      renderOptions: {},
      workflowOptions: {},
      creativeDefaultsOverride: override,
    }),
  });
  if (!ok || !json.workflow_id) {
    throw new Error(`创建任务失败（HTTP ${status}）：${json.message || '未知错误'}`);
  }
  return json.workflow_id;
}

async function pollWorkflow(baseUrl, workflowId, { onStage } = {}) {
  const startedAt = Date.now();
  let lastStageMessage = '';
  while (Date.now() - startedAt < WORKFLOW_TIMEOUT_MS) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    let json;
    try {
      ({ json } = await requestJson(`${baseUrl}/api/creative-workflows/${workflowId}`));
    } catch {
      continue; // 网络抖动继续轮询
    }
    const stageMessage = `${json.current_stage || ''} ${json.current_stage_message || json.message || ''}`.trim();
    if (stageMessage && stageMessage !== lastStageMessage) {
      lastStageMessage = stageMessage;
      if (onStage) onStage(stageMessage);
    }
    if (json.status === 'done' || json.status === 'failed') return json.status;
  }
  return 'timeout';
}

// ---------- 从本地产物提取指标并打分 ----------

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function extractWorkflowFacts(workflowId) {
  const record = readJsonIfExists(path.join(WORKFLOW_RECORD_ROOT, `${workflowId}.json`));
  if (!record) return { error: '找不到创作任务记录' };
  const hf = record?.result?.hyperframes_freeform || {};
  const projectDir = hf.project_dir || hf.project?.project_dir || record?.last_failure?.project_dir || '';
  const project = projectDir ? readJsonIfExists(path.join(projectDir, 'project.json')) : null;
  let outputPath = hf.render?.output_path || '';
  if ((!outputPath || !fs.existsSync(outputPath)) && project && Array.isArray(project.exports) && project.exports.length) {
    const lastExport = project.exports[project.exports.length - 1];
    outputPath = lastExport.absolute_path || (lastExport.path ? path.join(projectDir, lastExport.path) : '');
  }
  const failure = record.last_failure || record.error || {};
  return {
    status: record.status,
    targetSec: Number(record?.target?.duration_sec) || null,
    aspectRatio: record?.target?.aspect_ratio || '',
    durationSec: Number(project?.output?.duration) || null,
    frameCount: Array.isArray(project?.frames) ? project.frames.length : null,
    projectDir,
    outputPath,
    failureStage: failure.stage || record.current_stage || '',
    failureMessage: failure.message || record.message || '',
    wallSec: record.created_at && record.updated_at
      ? Math.max(0, (new Date(record.updated_at) - new Date(record.created_at)) / 1000)
      : null,
  };
}

async function scoreTopicEntry(entry, { skipVision, visionModelId, log }) {
  const facts = extractWorkflowFacts(entry.workflow_id);
  if (facts.error) {
    entry.failure_message = facts.error;
    entry.overall = 0;
    return entry;
  }
  entry.status = facts.status === 'done' ? 'done' : (entry.status === 'timeout' ? 'timeout' : facts.status);
  entry.target_sec = facts.targetSec;
  entry.duration_sec = facts.durationSec;
  entry.frame_count = facts.frameCount;
  entry.wall_sec = facts.wallSec;
  entry.failure_stage = facts.failureStage;
  entry.failure_message = entry.status === 'done' ? '' : facts.failureMessage;

  if (entry.status !== 'done') {
    entry.overall = 0;
    return entry;
  }

  let inspectIssues = [];
  let contactSheetPath = '';
  if (facts.projectDir && facts.outputPath && fs.existsSync(facts.outputPath)) {
    const inspect = await visualQaService.inspectRenderedVideo({
      projectDir: facts.projectDir,
      outputPath: facts.outputPath,
      expectedAspectRatio: facts.aspectRatio,
    });
    inspectIssues = inspect.issues || [];
    contactSheetPath = inspect.contact_sheet_path || '';
    entry.inspect_metrics = inspect.metrics || {};
  } else {
    inspectIssues = [{ code: 'output_missing', message: '任务标记完成但找不到成片文件' }];
  }

  const auto = computeAutoScore({
    durationSec: facts.durationSec,
    targetSec: facts.targetSec,
    inspectIssues,
  });
  entry.auto_score = auto.score;
  entry.auto_deductions = auto.deductions;

  entry.vision_score = null;
  entry.vision_error = '';
  if (!skipVision) {
    const vision = await scoreWithVisionModel({
      contactSheetPath,
      topicInput: entry.input,
      visionModelId,
    });
    if (vision.error) {
      entry.vision_error = vision.error;
      log(`  [${entry.id}] 视觉打分不可用：${vision.error}`);
    } else {
      entry.vision_score = vision.score;
      entry.vision_scores = vision.scores;
      entry.vision_issues = vision.issues;
      entry.vision_summary = vision.summary;
    }
  }

  entry.overall = computeOverall({
    status: entry.status,
    autoScore: entry.auto_score,
    visionScore: entry.vision_score,
  });
  return entry;
}

// ---------- run 管理 ----------

function loadTopics(topicsPath, filter) {
  const spec = JSON.parse(fs.readFileSync(topicsPath, 'utf-8'));
  let topics = spec.topics || [];
  if (filter) {
    const prefixes = filter.split(',').map(s => s.trim()).filter(Boolean);
    topics = topics.filter(t => prefixes.some(p => t.id.startsWith(p)));
    if (!topics.length) throw new Error(`--filter "${filter}" 没有匹配到任何选题`);
  }
  return { defaults: spec.defaults || {}, topics };
}

function runFilePath(label) {
  return path.join(EVAL_ROOT, label, 'run.json');
}

async function saveRun(run) {
  const dir = path.join(EVAL_ROOT, run.label);
  await fsp.mkdir(dir, { recursive: true });
  run.updated_at = new Date().toISOString();
  await fsp.writeFile(runFilePath(run.label), JSON.stringify(run, null, 2), 'utf-8');
}

async function writeReports(run) {
  await fsp.writeFile(path.join(EVAL_ROOT, run.label, 'report.md'), renderRunReport(run), 'utf-8');
  const runs = [];
  for (const name of fs.existsSync(EVAL_ROOT) ? await fsp.readdir(EVAL_ROOT) : []) {
    const loaded = readJsonIfExists(runFilePath(name));
    if (loaded && loaded.label) runs.push(loaded);
  }
  await fsp.writeFile(path.join(EVAL_ROOT, 'history.md'), renderHistory(runs), 'utf-8');
}

function gitRev() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '../..') }).toString().trim();
  } catch {
    return '';
  }
}

function initOrLoadRun(label, topics) {
  const existing = readJsonIfExists(runFilePath(label));
  if (existing) {
    // 断点续跑：合并新增选题，保留已有进度
    const known = new Set((existing.topics || []).map(t => t.id));
    for (const topic of topics) {
      if (!known.has(topic.id)) {
        existing.topics.push({ id: topic.id, label: topic.label, input: topic.input, override: topic.override, status: 'pending' });
      }
    }
    return existing;
  }
  return {
    label,
    git_rev: gitRev(),
    started_at: new Date().toISOString(),
    topics: topics.map(t => ({ id: t.id, label: t.label, input: t.input, override: t.override, status: 'pending' })),
  };
}

async function runPool(items, concurrency, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

// ---------- CLI ----------

function parseArgs(argv) {
  const args = {
    label: new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2'),
    topics: path.join(__dirname, 'topics.json'),
    baseUrl: DEFAULT_BASE_URL,
    concurrency: 2,
    filter: '',
    rescore: '',
    reportOnly: false,
    skipVision: false,
    visionModel: '',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--label') args.label = next();
    else if (arg === '--topics') args.topics = next();
    else if (arg === '--base-url') args.baseUrl = next();
    else if (arg === '--concurrency' || arg === '-c') args.concurrency = Number(next()) || 1;
    else if (arg === '--filter') args.filter = next();
    else if (arg === '--rescore') args.rescore = next();
    else if (arg === '--report-only') args.reportOnly = true;
    else if (arg === '--skip-vision') args.skipVision = true;
    else if (arg === '--vision-model') args.visionModel = next();
    else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(__filename, 'utf-8').split('\n').slice(1, 9).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const log = message => console.log(message);

  if (args.reportOnly) {
    const names = fs.existsSync(EVAL_ROOT) ? await fsp.readdir(EVAL_ROOT) : [];
    let last = null;
    for (const name of names) {
      const run = readJsonIfExists(runFilePath(name));
      if (run) { await writeReports(run); last = run; }
    }
    if (!last) throw new Error('data/quality-eval/ 下没有任何 run。');
    log(`已重建报告，曲线见 ${path.join(EVAL_ROOT, 'history.md')}`);
    return;
  }

  if (args.rescore) {
    const run = readJsonIfExists(runFilePath(args.rescore));
    if (!run) throw new Error(`找不到 run：${args.rescore}`);
    for (const entry of run.topics) {
      if (!entry.workflow_id) continue;
      log(`重新打分 [${entry.id}] workflow=${entry.workflow_id}`);
      await scoreTopicEntry(entry, { skipVision: args.skipVision, visionModelId: args.visionModel, log });
      await saveRun(run);
    }
    await writeReports(run);
    log(`完成。报告：${path.join(EVAL_ROOT, run.label, 'report.md')}`);
    printSummary(run, log);
    return;
  }

  const { defaults, topics } = loadTopics(args.topics, args.filter);
  await assertServerAlive(args.baseUrl);
  const run = initOrLoadRun(args.label, topics);
  run.base_url = args.baseUrl;
  await saveRun(run);

  const pending = run.topics.filter(t => !(t.status === 'done' && t.overall != null) && !['failed', 'timeout'].includes(t.status));
  log(`run=${run.label} git=${run.git_rev} 选题 ${run.topics.length} 个，其中 ${pending.length} 个待跑，并发 ${args.concurrency}。`);

  await runPool(pending, args.concurrency, async entry => {
    try {
      if (!entry.workflow_id) {
        entry.status = 'creating';
        entry.workflow_id = await createWorkflow(args.baseUrl, entry, defaults);
        entry.created_at = new Date().toISOString();
        log(`[${entry.id}] 已创建 workflow=${entry.workflow_id}`);
        await saveRun(run);
      } else {
        log(`[${entry.id}] 续跑已有 workflow=${entry.workflow_id}`);
      }
      entry.status = 'running';
      await saveRun(run);
      const finalStatus = await pollWorkflow(args.baseUrl, entry.workflow_id, {
        onStage: message => log(`[${entry.id}] ${message}`),
      });
      entry.status = finalStatus;
      entry.finished_at = new Date().toISOString();
      await saveRun(run);
      log(`[${entry.id}] 生成结束：${finalStatus}，开始打分`);
      await scoreTopicEntry(entry, { skipVision: args.skipVision, visionModelId: args.visionModel, log });
      log(`[${entry.id}] overall=${entry.overall} auto=${entry.auto_score ?? '-'} vision=${entry.vision_score ?? '-'}`);
    } catch (error) {
      if (entry.status !== 'timeout') entry.status = 'failed';
      entry.failure_message = error.message;
      entry.overall = 0;
      log(`[${entry.id}] 失败：${error.message}`);
    }
    await saveRun(run);
  });

  await writeReports(run);
  log('');
  log(`报告：${path.join(EVAL_ROOT, run.label, 'report.md')}`);
  log(`曲线：${path.join(EVAL_ROOT, 'history.md')}`);
  printSummary(run, log);
}

function printSummary(run, log) {
  const summary = summarizeRun(run);
  log(`成片率 ${summary.success_rate == null ? '-' : `${summary.success_rate}%`} · overall ${summary.avg_overall ?? '-'} · auto ${summary.avg_auto ?? '-'} · vision ${summary.avg_vision ?? '-'}`);
}

module.exports = {
  computeAutoScore,
  computeVisionScore,
  computeOverall,
  parseJsonLoose,
  summarizeRun,
  renderRunReport,
  renderHistory,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
