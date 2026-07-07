const fs = require('fs/promises');

const { findFrameByAnyId, canonicalFrameId } = require('./frameIdentity');
const {
  resolveProjectPath,
  saveFrameHtmlDraft,
  validateCompleteHtml,
} = require('./frameHtmlEditService');

function fail(code, message, extra = {}) {
  return {
    success: false,
    code,
    message,
    user_message: message,
    ...extra,
  };
}

function extractHtmlDocument(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const startMatch = candidate.match(/(?:<!doctype\s+html\b|<html\b[^>]*>)/i);
  const endMatch = candidate.match(/<\/html\s*>/i);
  if (!startMatch || !endMatch) return '';

  return candidate.slice(startMatch.index, endMatch.index + endMatch[0].length).trim();
}

function summarizeHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function buildFrameIteratePrompt({
  frame = {},
  currentHtml = '',
  instruction = '',
  mode = 'layout_fix',
  preserveText = true,
} = {}) {
  const frameId = canonicalFrameId(frame);
  const textRule = preserveText
    ? '保留原有文字内容，除非用户指令明确要求改写文案。'
    : '可以根据用户指令改写画面文字。';
  return [
    '你是 html-video 当前帧重写助手。',
    `当前帧 ID：${frameId || 'unknown'}`,
    `编辑模式：${mode || 'layout_fix'}`,
    `用户修改要求：${String(instruction || '').trim() || '优化当前帧视觉呈现。'}`,
    textRule,
    '请只输出一个完整 HTML 文档，可以使用 ```html fenced code block，但不要输出解释。',
    '不得引入外部脚本、iframe、object 或 embed。',
    `当前帧可见内容摘要：${summarizeHtml(currentHtml)}`,
    '当前帧 HTML：',
    currentHtml,
  ].join('\n\n');
}

async function iterateFrameHtml({
  projectDir,
  project,
  frameId,
  instruction = '',
  mode = 'layout_fix',
  preserveText = true,
  model,
} = {}) {
  const frame = findFrameByAnyId(project, frameId);
  if (!frame) {
    return fail('FRAME_NOT_FOUND', `未找到帧 ${frameId || ''}。`);
  }
  if (frame.source_mode !== 'raw_html' || !frame.html_path) {
    return fail('FRAME_HTML_NOT_AVAILABLE', '当前帧没有可迭代的 HTML 源码。');
  }
  if (!model || typeof model.callTextModel !== 'function') {
    return fail('AI_MODEL_NOT_CONFIGURED', 'AI 分析模型未配置，无法生成当前帧草稿。');
  }

  let htmlPath;
  try {
    htmlPath = resolveProjectPath(projectDir, frame.html_path);
  } catch (error) {
    return fail('FRAME_HTML_PATH_INVALID', error.message);
  }

  let rawHtml;
  try {
    rawHtml = await fs.readFile(htmlPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fail('FRAME_HTML_NOT_AVAILABLE', '当前帧没有可迭代的 HTML 源码。');
    }
    throw error;
  }

  const sourceValidation = validateCompleteHtml(rawHtml);
  if (sourceValidation) {
    return fail('FRAME_HTML_INVALID', '当前帧 HTML 源码不是完整文档，无法迭代。');
  }

  const prompt = buildFrameIteratePrompt({ frame, currentHtml: rawHtml, instruction, mode, preserveText });
  const response = await model.callTextModel({
    messages: [{ role: 'user', content: prompt }],
  });
  if (!response || response.success === false) {
    return fail(
      response?.code || 'AI_FRAME_ITERATE_FAILED',
      response?.message || 'AI 当前帧重写失败，请稍后重试。',
    );
  }

  const nextHtml = extractHtmlDocument(response.text || response.content || '');
  const validationError = validateCompleteHtml(nextHtml);
  if (validationError) {
    return fail('AI_FRAME_HTML_INVALID', 'AI 返回内容不是完整 HTML 文档，请调整指令后重试。');
  }

  const result = await saveFrameHtmlDraft({
    projectDir,
    project,
    frameId,
    html: nextHtml,
    kind: 'ai_iterate',
    summary: 'AI 当前帧重写草稿。',
    instruction,
  });
  if (!result.success) return result;

  return {
    ...result,
    mode,
    message: '当前帧草稿已生成。',
    user_message: '当前帧草稿已生成。',
  };
}

module.exports = {
  iterateFrameHtml,
  extractHtmlDocument,
  summarizeHtml,
  buildFrameIteratePrompt,
};
