const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mediaPipeline = require('./mediaPipeline');

const ALLOWED_FILES = new Set([
  'index.html',
  'design.md',
  'hyperframes.json',
  'package.json',
  'meta.json',
  'output.mp4',
  'contact_sheet.jpg',
]);

const TEXT_FILES = new Set([
  'index.html',
  'design.md',
  'hyperframes.json',
  'package.json',
  'meta.json',
]);

const RUN_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const FONT_ALIASES = [
  [/(['"]?)Microsoft YaHei\1/gi, 'inter'],
  [/(['"]?)PingFang SC\1/gi, 'inter'],
  [/(['"]?)SFMono-Regular\1/gi, 'jetbrains-mono'],
  [/\bnoto-sans\b/gi, 'sans-serif'],
  [/\bopen-sans\b/gi, 'sans-serif'],
  [/\bjetbrains-mono\b/gi, 'monospace'],
  [/\bmontserrat\b/gi, 'sans-serif'],
  [/\binter\b/gi, 'sans-serif'],
];

function normalizeRunId(runId) {
  const safeRunId = String(runId || '');
  if (
    !safeRunId
    || safeRunId.includes('..')
    || safeRunId.includes('/')
    || safeRunId.includes('\\')
    || path.basename(safeRunId) !== safeRunId
    || !RUN_ID_PATTERN.test(safeRunId)
  ) {
    throw new Error('非法的运行记录 ID。');
  }
  return safeRunId;
}

function getFreeformProjectDir(awemeId, runId, rootDir) {
  const safeRunId = normalizeRunId(runId);
  const mediaDir = mediaPipeline.getMediaDir(awemeId, rootDir);
  const agentRunsDir = path.resolve(mediaDir, 'agent_runs');
  const projectDir = path.resolve(agentRunsDir, `${safeRunId}-hyperframes-freeform`);
  const relative = path.relative(agentRunsDir, projectDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('非法的运行记录 ID。');
  }
  return projectDir;
}

function resolveFreeformFile(projectDir, fileName) {
  const normalizedName = String(fileName || '').replace(/\\/g, '/');
  const basename = path.posix.basename(normalizedName);
  if (!basename || basename !== normalizedName || normalizedName.includes('..')) {
    throw new Error('非法的工程文件路径。');
  }

  if (!ALLOWED_FILES.has(basename)) {
    throw new Error('不支持访问该工程文件。');
  }

  const rootPath = path.resolve(projectDir);
  const filePath = path.resolve(rootPath, basename);
  const relative = path.relative(rootPath, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('非法的工程文件路径。');
  }

  return filePath;
}

function assertTextFileName(fileName) {
  const normalizedName = String(fileName || '').replace(/\\/g, '/');
  const basename = path.posix.basename(normalizedName);
  if (!TEXT_FILES.has(basename)) {
    throw new Error('不支持以文本方式访问该工程文件。');
  }
}

async function writeFreeformFile({ projectDir, fileName, content = '' }) {
  const filePath = resolveFreeformFile(projectDir, fileName);
  assertTextFileName(fileName);
  await fsp.mkdir(projectDir, { recursive: true });
  await fsp.writeFile(filePath, String(content), 'utf-8');
  return {
    success: true,
    name: path.basename(filePath),
    path: filePath,
    message: '工程文件已保存。',
  };
}

function readJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getProjectDuration(files = {}) {
  const meta = readJsonObject(files['meta.json']);
  const hyperframes = readJsonObject(files['hyperframes.json']);
  const candidates = [
    meta?.duration_sec,
    meta?.duration,
    hyperframes?.duration,
    hyperframes?.duration_sec,
  ];
  const indexHtml = String(files['index.html'] || '');
  const durationMatch = indexHtml.match(/\b(?:DURATION|duration)\s*=\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (durationMatch) candidates.push(durationMatch[1]);

  for (const candidate of candidates) {
    const duration = Number(candidate);
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  return 0;
}

function getProjectDimensions(files = {}) {
  const meta = readJsonObject(files['meta.json']);
  const hyperframes = readJsonObject(files['hyperframes.json']);
  const width = Number(hyperframes?.width || meta?.width || 1080);
  const height = Number(hyperframes?.height || meta?.height || 1920);
  return {
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 1080,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : 1920,
  };
}

function normalizeDurationValue(duration) {
  const rounded = Math.round(Number(duration) * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function ensureRootAttribute(tag, name, value) {
  const pattern = new RegExp(`\\s${name}\\s*=`, 'i');
  if (pattern.test(tag)) return tag;
  return tag.replace(/>$/, ` ${name}="${value}">`);
}

function normalizeRootCompositionAttributes(content, files = {}) {
  const duration = getProjectDuration(files);
  const durationText = duration ? normalizeDurationValue(duration) : '';
  const { width, height } = getProjectDimensions(files);

  return content.replace(/<([a-z][\w:-]*)([^>]*\sdata-composition-id\s*=\s*['"][^'"]+['"][^>]*)>/i, (tag) => {
    let nextTag = tag;
    if (durationText) nextTag = ensureRootAttribute(nextTag, 'data-duration', durationText);
    nextTag = ensureRootAttribute(nextTag, 'data-width', String(width));
    nextTag = ensureRootAttribute(nextTag, 'data-height', String(height));
    nextTag = ensureRootAttribute(nextTag, 'data-start', '0');
    return nextTag;
  });
}

function stripNonDeterministicPlayback(content) {
  return content.replace(/<script\b[^>]*>[\s\S]*?(?:performance\.now\s*\(|requestAnimationFrame\s*\()[\s\S]*?<\/script>/gi, '');
}

function stripTimelineScripts(content) {
  return content
    .replace(/<script\b[^>]*src\s*=\s*["'][^"']*gsap[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?(?:gsap\.timeline\s*\(|gsap\.(?:to|from|fromTo|set)\s*\(|window\.__timelines)[\s\S]*?<\/script>/gi, '');
}

function stripInvalidCompositionVariables(content) {
  return content.replace(/\sdata-composition-variables\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
}

function ensureClipClassOnTimedElements(content) {
  return content.replace(/<([a-z][\w:-]*)([^>]*\sdata-start\s*=\s*['"][^'"]+['"][^>]*\sdata-duration\s*=\s*['"][^'"]+['"][^>]*)>/gi, (tag) => {
    if (/\sdata-composition-id\s*=/.test(tag)) return tag;
    if (/\sclass\s*=/.test(tag)) {
      return tag.replace(/\sclass\s*=\s*(['"])(.*?)\1/i, (classAttr, quote, classValue) => {
        const classes = classValue.split(/\s+/).filter(Boolean);
        if (!classes.includes('clip')) classes.push('clip');
        return ` class=${quote}${classes.join(' ')}${quote}`;
      });
    }
    return tag.replace(/>$/, ' class="clip">');
  });
}

function getTimedClips(content) {
  const clips = [];
  const tagPattern = /<([a-z][\w:-]*)([^>]*\sdata-start\s*=\s*['"]([^'"]+)['"][^>]*\sdata-duration\s*=\s*['"]([^'"]+)['"][^>]*)>/gi;
  let match;
  while ((match = tagPattern.exec(content)) !== null) {
    const tag = match[0];
    if (/\sdata-composition-id\s*=/.test(tag)) continue;
    const idMatch = tag.match(/\sid\s*=\s*['"]([^'"]+)['"]/i);
    if (!idMatch) continue;
    const start = Number(match[3]);
    const duration = Number(match[4]);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) continue;
    clips.push({ id: idMatch[1], start, end: start + duration });
  }
  return clips;
}

function jsString(value) {
  return JSON.stringify(String(value || ''));
}

function ensureTimelineRegistry(content, files = {}) {
  const duration = getProjectDuration(files);
  if (!duration) return content;
  const durationText = normalizeDurationValue(duration);
  const clips = getTimedClips(content);
  const clipLines = [];
  for (const clip of clips) {
    clipLines.push(`  tl.set(${jsString(`#${clip.id}`)}, { autoAlpha: 1 }, ${normalizeDurationValue(clip.start)});`);
    clipLines.push(`  tl.set(${jsString(`#${clip.id}`)}, { autoAlpha: 0 }, ${normalizeDurationValue(clip.end)});`);
  }
  const timelineScript = [
    '<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>',
    '<script>',
    '(function(){',
    '  window.__timelines = window.__timelines || {};',
    '  var tl = gsap.timeline({ paused: true });',
    '  gsap.set(".clip", { autoAlpha: 0 });',
    ...clipLines,
    `  tl.to({}, { duration: ${durationText} }, 0);`,
    '  window.__timelines["main"] = tl;',
    '})();',
    '</script>',
  ].join('\n');

  if (/<\/body>/i.test(content)) {
    return content.replace(/<\/body>/i, `${timelineScript}\n</body>`);
  }
  return `${content}\n${timelineScript}`;
}

function normalizeFreeformIndexHtml(html, files = {}) {
  let content = String(html || '');
  for (const [pattern, replacement] of FONT_ALIASES) {
    content = content.replace(pattern, replacement);
  }
  content = stripInvalidCompositionVariables(content);

  const duration = getProjectDuration({ ...files, 'index.html': content });
  const durationText = normalizeDurationValue(duration);

  if (!/\sdata-composition-id\s*=/.test(content) && duration) {
    if (/<div\b[^>]*\bid\s*=\s*['"]stage['"][^>]*>/i.test(content)) {
      content = content.replace(/(<div\b[^>]*\bid\s*=\s*['"]stage['"])([^>]*>)/i, `$1 data-composition-id="main" data-duration="${durationText}"$2`);
    } else if (/<body\b[^>]*>\s*<div\b/i.test(content)) {
      content = content.replace(/(<body\b[^>]*>\s*<div\b)([^>]*>)/i, `$1 data-composition-id="main" data-duration="${durationText}"$2`);
    }
  }

  content = stripNonDeterministicPlayback(content);
  content = stripTimelineScripts(content);
  content = normalizeRootCompositionAttributes(content, { ...files, 'index.html': content });
  content = ensureClipClassOnTimedElements(content);
  content = ensureTimelineRegistry(content, { ...files, 'index.html': content });
  return content;
}

function normalizeFreeformProjectFiles(files = {}) {
  const normalized = { ...files };
  if (typeof normalized['index.html'] === 'string') {
    normalized['index.html'] = normalizeFreeformIndexHtml(normalized['index.html'], normalized);
  }
  return normalized;
}

async function readFreeformFile({ projectDir, fileName }) {
  const filePath = resolveFreeformFile(projectDir, fileName);
  assertTextFileName(fileName);
  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      name: path.basename(filePath),
      path: filePath,
      message: '未找到该工程文件。',
    };
  }

  return {
    success: true,
    name: path.basename(filePath),
    path: filePath,
    content: await fsp.readFile(filePath, 'utf-8'),
  };
}

async function listFreeformFiles(projectDir) {
  const files = [];
  for (const name of ALLOWED_FILES) {
    const filePath = resolveFreeformFile(projectDir, name);
    try {
      const stats = await fsp.stat(filePath);
      if (!stats.isFile()) continue;
      files.push({
        name,
        path: filePath,
        bytes: stats.size,
        updated_at: stats.mtime.toISOString(),
      });
    } catch {
      // Missing allowed files are omitted from the project listing.
    }
  }
  return files;
}

async function createFreeformProject({ awemeId, runId, rootDir, files = {} }) {
  const projectDir = getFreeformProjectDir(awemeId, runId, rootDir);
  await Promise.all([
    fsp.mkdir(path.join(projectDir, 'assets'), { recursive: true }),
    fsp.mkdir(path.join(projectDir, 'checks'), { recursive: true }),
    fsp.mkdir(path.join(projectDir, 'inspect', 'frames'), { recursive: true }),
    fsp.mkdir(path.join(projectDir, 'renders'), { recursive: true }),
  ]);

  const normalizedFiles = normalizeFreeformProjectFiles(files);
  for (const [fileName, content] of Object.entries(normalizedFiles)) {
    await writeFreeformFile({ projectDir, fileName, content });
  }

  return {
    success: true,
    projectDir,
    files: await listFreeformFiles(projectDir),
    message: 'HyperFrames 自由工程已生成。',
  };
}

function buildFreeformFileUrl(awemeId, runId, fileName) {
  return [
    '/api/agents/douyin',
    encodeURIComponent(String(awemeId)),
    'runs',
    encodeURIComponent(String(runId)),
    'hyperframes-freeform/files',
    encodeURIComponent(String(fileName)),
  ].join('/');
}

module.exports = {
  ALLOWED_FILES,
  TEXT_FILES,
  getFreeformProjectDir,
  resolveFreeformFile,
  writeFreeformFile,
  readFreeformFile,
  listFreeformFiles,
  createFreeformProject,
  buildFreeformFileUrl,
  normalizeFreeformIndexHtml,
  normalizeFreeformProjectFiles,
};
