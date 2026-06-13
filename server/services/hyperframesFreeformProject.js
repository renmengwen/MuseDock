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
  'scene_spec.json',
  'output.mp4',
  'contact_sheet.jpg',
]);

const TEXT_FILES = new Set([
  'index.html',
  'design.md',
  'hyperframes.json',
  'package.json',
  'meta.json',
  'scene_spec.json',
]);
const NARRATION_AUDIO_ASSET = 'assets/narration.wav';
const NARRATION_AUDIO_TRACK_INDEX = '99';

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

function getProjectDuration(files = {}, options = {}) {
  const meta = readJsonObject(files['meta.json']);
  const hyperframes = readJsonObject(files['hyperframes.json']);
  const candidates = [
    meta?.duration_sec,
    meta?.duration,
    hyperframes?.duration,
    hyperframes?.duration_sec,
    options.defaultDuration,
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

const ROOT_COMPOSITION_ATTRS = [
  'data-composition-id',
  'data-start',
  'data-duration',
  'data-width',
  'data-height',
  'data-track-index',
];

function getTagAttribute(tag, name) {
  const match = String(tag || '').match(new RegExp(`\\s${name}\\s*=\\s*(['"])(.*?)\\1`, 'i'));
  return match ? match[2] : '';
}

function removeRootCompositionAttributes(tag) {
  let nextTag = tag;
  for (const name of ROOT_COMPOSITION_ATTRS) {
    nextTag = nextTag.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'gi'), '');
  }
  return nextTag;
}

function ensureRootAttributes(tag, files = {}, options = {}, inheritedAttrs = {}) {
  const duration = getProjectDuration(files, options);
  const durationText = duration ? normalizeDurationValue(duration) : inheritedAttrs['data-duration'] || '';
  const { width, height } = getProjectDimensions(files);
  let nextTag = tag
    .replace(/\sdata-track-index\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  nextTag = ensureRootAttribute(nextTag, 'data-composition-id', inheritedAttrs['data-composition-id'] || 'main');
  if (durationText) nextTag = ensureRootAttribute(nextTag, 'data-duration', durationText);
  nextTag = ensureRootAttribute(nextTag, 'data-width', inheritedAttrs['data-width'] || String(width));
  nextTag = ensureRootAttribute(nextTag, 'data-height', inheritedAttrs['data-height'] || String(height));
  nextTag = ensureRootAttribute(nextTag, 'data-start', inheritedAttrs['data-start'] || '0');
  return nextTag;
}

function moveHtmlCompositionAttributesToRoot(content, files = {}, options = {}) {
  const htmlMatch = String(content || '').match(/<html\b[^>]*>/i);
  if (!htmlMatch || !/\sdata-composition-id\s*=/.test(htmlMatch[0])) return content;

  const inheritedAttrs = {};
  for (const name of ROOT_COMPOSITION_ATTRS) {
    const value = getTagAttribute(htmlMatch[0], name);
    if (value) inheritedAttrs[name] = value;
  }

  let nextContent = content.replace(htmlMatch[0], removeRootCompositionAttributes(htmlMatch[0]));
  const targetPatterns = [
    /<([a-z][\w:-]*)([^>]*\bid\s*=\s*['"]stage['"][^>]*)>/i,
    /<([a-z][\w:-]*)([^>]*\bclass\s*=\s*['"][^'"]*\bstage\b[^'"]*['"][^>]*)>/i,
    /(<body\b[^>]*>\s*)<([a-z][\w:-]*)([^>]*)>/i,
  ];

  for (const pattern of targetPatterns) {
    if (!pattern.test(nextContent)) continue;
    return nextContent.replace(pattern, (...args) => {
      if (pattern === targetPatterns[2]) {
        const [, bodyOpen, tagName, attrs] = args;
        if (/^(script|style)$/i.test(tagName)) return args[0];
        return `${bodyOpen}${ensureRootAttributes(`<${tagName}${attrs}>`, files, options, inheritedAttrs)}`;
      }
      return ensureRootAttributes(args[0], files, options, inheritedAttrs);
    });
  }

  return nextContent;
}

function normalizeRootCompositionAttributes(content, files = {}, options = {}) {
  const migrated = moveHtmlCompositionAttributesToRoot(content, files, options);
  return migrated.replace(/<([a-z][\w:-]*)([^>]*\sdata-composition-id\s*=\s*['"][^'"]+['"][^>]*)>/i, (tag) => (
    ensureRootAttributes(tag, files, options)
  ));
}

function stripNonDeterministicPlayback(content) {
  return content.replace(/<script\b[^>]*>[\s\S]*?(?:performance\.now\s*\(|requestAnimationFrame\s*\()[\s\S]*?<\/script>/gi, '');
}

function hasRegisteredMainTimeline(content = '') {
  return /window\.__timelines\s*\[\s*['"]main['"]\s*\]\s*=/.test(String(content || ''));
}

function isRegisteredMainTimelineScript(script = '') {
  return /<script\b[^>]*>[\s\S]*window\.__timelines\s*\[\s*['"]main['"]\s*\]\s*=[\s\S]*?<\/script>/i.test(String(script || ''));
}

function stripTimelineScripts(content) {
  return content
    .replace(/<script\b[^>]*src\s*=\s*["'][^"']*gsap[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?(?:gsap\.timeline\s*\(|gsap\.(?:to|from|fromTo|set)\s*\(|window\.__timelines)[\s\S]*?<\/script>/gi, (script) => (
      isRegisteredMainTimelineScript(script) ? script : ''
    ));
}

function stripInvalidCompositionVariables(content) {
  return content.replace(/\sdata-composition-variables\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
}

function ensureClipClassOnTimedElements(content) {
  return content.replace(/<([a-z][\w:-]*)([^>]*\sdata-start\s*=\s*['"][^'"]+['"][^>]*\sdata-duration\s*=\s*['"][^'"]+['"][^>]*)>/gi, (tag, tagName) => {
    if (/\sdata-composition-id\s*=/.test(tag)) return tag;
    if (/^(audio|video)$/i.test(tagName)) return tag;
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

function normalizeTimedClipBoundaries(content) {
  let result = String(content || '').replace(/<([a-z][\w:-]*)([^>]*\sdata-start\s*=\s*['"][^'"]+['"][^>]*\sdata-duration\s*=\s*['"][^'"]+['"][^>]*)>/gi, (tag) => {
    if (/\sdata-composition-id\s*=/.test(tag)) return tag;
    return tag
      .replace(/\sdata-start\s*=\s*(['"])([^'"]+)\1/i, (attr, quote, value) => {
        const start = Number(value);
        return Number.isFinite(start) ? ` data-start=${quote}${normalizeDurationValue(start)}${quote}` : attr;
      })
      .replace(/\sdata-duration\s*=\s*(['"])([^'"]+)\1/i, (attr, quote, value) => {
        const duration = Number(value);
        return Number.isFinite(duration) ? ` data-duration=${quote}${normalizeDurationValue(duration)}${quote}` : attr;
      });
  });

  // Second pass: fix floating-point overlap between adjacent clips on the same track.
  // Even after rounding individual attributes, the lintern computes start + duration in
  // IEEE 754 which can produce artifacts like 45.28 + 7.84 = 53.120000000000005.
  const clips = [];
  const tagPattern = /<([a-z][\w:-]*)([^>]*\sdata-start\s*=\s*['"]([^'"]+)['"][^>]*\sdata-duration\s*=\s*['"]([^'"]+)['"][^>]*)>/gi;
  let m;
  while ((m = tagPattern.exec(result)) !== null) {
    if (/\sdata-composition-id\s*=/.test(m[0])) continue;
    const idMatch = m[0].match(/\sid\s*=\s*['"]([^'"]+)['"]/i);
    if (!idMatch) continue;
    const trackMatch = m[0].match(/\sdata-track-index\s*=\s*['"]([^'"]+)['"]/i);
    const trackIndex = trackMatch ? trackMatch[1] : '0';
    const start = Number(m[3]);
    const duration = Number(m[4]);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) continue;
    clips.push({ id: idMatch[1], trackIndex, start, duration, end: start + duration });
  }

  // Group by track and sort by start time
  const byTrack = new Map();
  for (const clip of clips) {
    if (!byTrack.has(clip.trackIndex)) byTrack.set(clip.trackIndex, []);
    byTrack.get(clip.trackIndex).push(clip);
  }
  for (const track of byTrack.values()) {
    track.sort((a, b) => a.start - b.start);
  }

  // For adjacent clips, if the raw floating-point end > next start (IEEE 754 artifact),
  // reduce duration by 0.001 to prevent the lintern from flagging a false overlap.
  // Example: 45.28 + 7.84 = 53.120000000000005 > 53.12
  const adjustments = new Map();
  for (const track of byTrack.values()) {
    for (let i = 0; i < track.length - 1; i++) {
      const clip = track[i];
      const next = track[i + 1];
      if (clip.end > next.start) {
        const newDuration = Math.round((next.start - clip.start) * 1000) / 1000 - 0.001;
        if (newDuration > 0) {
          adjustments.set(clip.id, normalizeDurationValue(newDuration));
        }
      }
    }
  }

  if (adjustments.size > 0) {
    result = result.replace(/<([a-z][\w:-]*)([^>]*\sid\s*=\s*['"]([^'"]+)['"][^>]*\sdata-duration\s*=\s*['"]([^'"]+)['"][^>]*)>/gi, (tag, tagName, attrs, id, duration) => {
      if (!adjustments.has(id)) return tag;
      return tag.replace(/\sdata-duration\s*=\s*(['"])([^'"]+)\1/i, ` data-duration=$1${adjustments.get(id)}$1`);
    });
  }

  return result;
}

function allowOverflowOnEmphasisContainers(content) {
  return String(content || '').replace(/<([a-z][\w:-]*)([^>]*\sclass\s*=\s*(['"])(.*?)\3[^>]*)>/gi, (tag, tagName, attrs, quote, classValue) => {
    if (/^(html|body|main|section|audio|video|script|style)$/i.test(tagName)) return tag;
    if (/\sdata-layout-(?:allow-overflow|ignore)\b/i.test(tag)) return tag;
    if (!/\b(?:hero-lock|lock|emphasis|glitch|burst|big-word|impact-word|tick|check)\b/i.test(classValue)) return tag;
    return tag.replace(/>$/, ' data-layout-allow-overflow="true">');
  });
}

function stripVisibilityFromRegisteredScript(script, clipIds) {
  const lines = script.split('\n');
  const result = [];
  for (const line of lines) {
    const setMatch = line.match(/^((?:\s*)(?:var |let |const )?\w+(?:\.\w+)*\.set\s*\(\s*)(['"])(#[^'"]+)\2\s*,\s*\{/);
    if (setMatch) {
      const selector = setMatch[3];
      const id = selector.replace(/^#/, '');
      if (clipIds.has(id)) {
        const prefix = setMatch[1];
        const openBrace = line.indexOf('{', line.indexOf('.set('));
        if (openBrace === -1) { result.push(line); continue; }
        let depth = 0, closeBrace = -1;
        for (let i = openBrace; i < line.length; i++) {
          if (line[i] === '{') depth++;
          else if (line[i] === '}') { depth--; if (depth === 0) { closeBrace = i; break; } }
        }
        if (closeBrace === -1) { result.push(line); continue; }
        const props = line.substring(openBrace + 1, closeBrace);
        const rest = line.substring(closeBrace + 1);
        const stripped = props
          .replace(/(?:^|,)\s*(?:visibility\s*:\s*['"][^'"]*['"]|autoAlpha\s*:\s*[\d.]+|opacity\s*:\s*[\d.]+)\s*/g, '')
          .replace(/^,\s*|\s*,$/g, '')
          .trim();
        if (!stripped) continue;
        const after = rest.replace(/^\s*,\s*[\d.-]+\s*/, '').replace(/\s*,\s*$/g, '').trimEnd();
        result.push(`${prefix}${JSON.stringify(selector)}, {${stripped}}${after}`);
        continue;
      }
    }
    result.push(line);
  }
  return result.join('\n');
}

function stripVisibilityTweensOnClipElements(content) {
  const clipIds = new Set();
  const tagPattern = /<([a-z][\w:-]*)([^>]*\sclass\s*=\s*(['"])(.*?)\3[^>]*\sdata-start\s*=\s*['"][^'"]+['"][^>]*)>/gi;
  let m;
  while ((m = tagPattern.exec(content)) !== null) {
    if (/\sdata-composition-id\s*=/.test(m[0])) continue;
    if (/^(audio|video)$/i.test(m[1])) continue;
    if (/\bclip\b/.test(m[4])) {
      const idMatch = m[0].match(/\sid\s*=\s*['"]([^'"]+)['"]/i);
      if (idMatch) clipIds.add(idMatch[1]);
    }
  }
  if (clipIds.size === 0) return content;

  return content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (script) => {
    if (!/\bset\s*\(|\.set\s*\(/i.test(script)) return script;
    if (!isRegisteredMainTimelineScript(script)) return script;
    return stripVisibilityFromRegisteredScript(script, clipIds);
  });
}

function getTimedClips(content) {
  const clips = [];
  const tagPattern = /<([a-z][\w:-]*)([^>]*\sdata-start\s*=\s*['"]([^'"]+)['"][^>]*\sdata-duration\s*=\s*['"]([^'"]+)['"][^>]*)>/gi;
  let match;
  while ((match = tagPattern.exec(content)) !== null) {
    const tag = match[0];
    if (/\sdata-composition-id\s*=/.test(tag)) continue;
    if (/^(audio|video)$/i.test(match[1])) continue;
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

function ensureGsapDependency(content) {
  const gsapScript = '<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>';
  if (/src\s*=\s*["'][^"']*gsap[^"']*["']/i.test(content)) return content;

  const gsapInlineScript = content.match(/<script\b[^>]*>[\s\S]*?gsap\.[\s\S]*?<\/script>/i);
  if (gsapInlineScript) {
    return content.replace(gsapInlineScript[0], `${gsapScript}\n${gsapInlineScript[0]}`);
  }

  if (/<\/body>/i.test(content)) {
    return content.replace(/<\/body>/i, `${gsapScript}\n</body>`);
  }
  return `${content}\n${gsapScript}`;
}

function ensureTimelineRegistry(content, files = {}, options = {}) {
  const duration = getProjectDuration(files, options);
  if (!duration) return content;
  if (hasRegisteredMainTimeline(content)) {
    return ensureGsapDependency(content);
  }
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

function getFreeformAudioDuration(audio = {}) {
  const explicit = Number(audio?.duration);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const captions = Array.isArray(audio?.captions) ? audio.captions : [];
  return captions.reduce((max, caption) => Math.max(max, Number(caption?.end || 0)), 0);
}

function hasNarrationAudio(content = '') {
  return /<audio\b[^>]*\bid\s*=\s*['"]narration-audio['"][^>]*>/i.test(String(content || ''));
}

function getTagAttribute(tag = '', name = '') {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(['"])(.*?)\\1`, 'i');
  const match = String(tag || '').match(pattern);
  return match ? match[2] : '';
}

function normalizeComparablePath(value = '') {
  return String(value || '').replace(/\\/g, '/');
}

function isNarrationAudioTag(tag = '', audio = {}) {
  const id = getTagAttribute(tag, 'id');
  if (id === 'narration-audio') return true;

  const src = normalizeComparablePath(getTagAttribute(tag, 'src'));
  if (!src) return false;
  if (src === NARRATION_AUDIO_ASSET) return true;

  const audioUrl = normalizeComparablePath(audio?.url);
  if (audioUrl && src === audioUrl) return true;

  const fileName = normalizeComparablePath(audio?.file_name || (audio?.path ? path.basename(audio.path) : ''));
  if (fileName && src.endsWith(`/${fileName}`)) return true;

  return /^\/api\/agents\/[^?#]+\/runs\/[^?#]+\/tts\/[^?#]+/i.test(src);
}

function buildNarrationAudioTag(audio = {}) {
  const duration = getFreeformAudioDuration(audio);
  const durationAttr = duration ? ` data-duration="${normalizeDurationValue(duration)}"` : '';
  const volume = Number(audio?.volume ?? 1);
  const volumeValue = Number.isFinite(volume) && volume >= 0 ? Math.min(volume, 1) : 1;
  return `<audio id="narration-audio" data-start="0"${durationAttr} data-track-index="${NARRATION_AUDIO_TRACK_INDEX}" src="${NARRATION_AUDIO_ASSET}" data-volume="${volumeValue}"></audio>`;
}

function ensureNarrationAudioElement(content = '', audio = {}) {
  if (!audio?.path) return content;
  const audioTag = buildNarrationAudioTag(audio);
  let hasAudioTag = false;
  const normalizedContent = String(content || '').replace(/<audio\b[^>]*>[\s\S]*?<\/audio>|<audio\b[^>]*\/>/gi, (tag) => {
    if (!isNarrationAudioTag(tag, audio)) return tag;
    if (hasAudioTag) return '';
    hasAudioTag = true;
    return audioTag;
  });
  if (hasAudioTag || hasNarrationAudio(normalizedContent)) return normalizedContent;

  const rootPattern = /<([a-z][\w:-]*)([^>]*\sdata-composition-id\s*=\s*['"][^'"]+['"][^>]*)>/i;
  if (rootPattern.test(normalizedContent)) {
    return normalizedContent.replace(rootPattern, (tag) => `${tag}\n  ${audioTag}`);
  }
  if (/<body\b[^>]*>/i.test(normalizedContent)) {
    return normalizedContent.replace(/<body\b[^>]*>/i, (tag) => `${tag}\n  ${audioTag}`);
  }
  return `${audioTag}\n${normalizedContent}`;
}

function normalizeFreeformIndexHtml(html, files = {}, options = {}) {
  let content = String(html || '');
  const audio = options.audio || {};
  const defaultDuration = getFreeformAudioDuration(audio);
  const durationOptions = { defaultDuration };
  for (const [pattern, replacement] of FONT_ALIASES) {
    content = content.replace(pattern, replacement);
  }
  content = stripInvalidCompositionVariables(content);

  const duration = getProjectDuration({ ...files, 'index.html': content }, durationOptions);
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
  content = normalizeRootCompositionAttributes(content, { ...files, 'index.html': content }, durationOptions);
  content = ensureNarrationAudioElement(content, audio);
  content = ensureClipClassOnTimedElements(content);
  content = stripVisibilityTweensOnClipElements(content);
  content = normalizeTimedClipBoundaries(content);
  content = allowOverflowOnEmphasisContainers(content);
  content = ensureTimelineRegistry(content, { ...files, 'index.html': content }, durationOptions);
  return content;
}

function normalizeFreeformProjectFiles(files = {}, options = {}) {
  const normalized = { ...files };
  if (typeof normalized['index.html'] === 'string') {
    normalized['index.html'] = normalizeFreeformIndexHtml(normalized['index.html'], normalized, options);
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

async function createFreeformProject({ awemeId, runId, rootDir, files = {}, audio = null }) {
  const projectDir = getFreeformProjectDir(awemeId, runId, rootDir);
  await Promise.all([
    fsp.mkdir(path.join(projectDir, 'assets'), { recursive: true }),
    fsp.mkdir(path.join(projectDir, 'checks'), { recursive: true }),
    fsp.mkdir(path.join(projectDir, 'inspect', 'frames'), { recursive: true }),
    fsp.mkdir(path.join(projectDir, 'renders'), { recursive: true }),
  ]);

  const normalizedFiles = normalizeFreeformProjectFiles(files, { audio });
  for (const [fileName, content] of Object.entries(normalizedFiles)) {
    await writeFreeformFile({ projectDir, fileName, content });
  }
  if (audio?.path) {
    await fsp.copyFile(audio.path, path.join(projectDir, NARRATION_AUDIO_ASSET));
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
  ensureNarrationAudioElement,
};
