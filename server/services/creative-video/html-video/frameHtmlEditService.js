const fs = require('fs/promises');
const path = require('path');

const { addRevision } = require('./projectStore');
const { findFrameByAnyId, canonicalFrameId } = require('./frameIdentity');
const {
  createDraftEntry,
  findDraft,
  markDraftAccepted,
  markDraftDiscarded,
} = require('./htmlVideoDraftService');

function fail(code, message, extra = {}) {
  return {
    success: false,
    code,
    message,
    user_message: message,
    ...extra,
  };
}

function resolveProjectPath(projectDir, relativePath) {
  if (!String(projectDir || '').trim()) {
    throw new Error('缺少工程目录。');
  }
  const text = String(relativePath || '').trim();
  const root = path.resolve(projectDir);
  if (!text || path.isAbsolute(text)) {
    throw new Error('路径不能逃逸工程目录。');
  }

  const target = path.resolve(root, text);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('路径不能逃逸工程目录。');
  }
  return target;
}

function validateCompleteHtml(html) {
  const source = String(html || '');
  if (!source.trim()) {
    return fail('FRAME_HTML_INVALID', '源码为空，无法保存。');
  }

  const hasDocumentStart = /<!doctype\s+html\b/i.test(source) || /<html\b[^>]*>/i.test(source);
  const hasDocumentEnd = /<\/html\s*>/i.test(source);
  if (!hasDocumentStart || !hasDocumentEnd) {
    return fail('FRAME_HTML_INVALID', '源码不是完整 HTML 文档。');
  }

  if (/<script\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i.test(source)) {
    return fail('FRAME_HTML_EXTERNAL_SCRIPT_BLOCKED', '源码包含外部脚本，已拒绝保存。');
  }

  if (/<\s*(iframe|object|embed)\b/i.test(source)) {
    return fail('FRAME_HTML_UNSAFE_EMBED_BLOCKED', '源码包含暂不允许的嵌入内容。');
  }

  return null;
}

async function frameHtmlPath(projectDir, project, frameId) {
  const frame = findFrameByAnyId(project, frameId);
  if (!frame) {
    return { error: fail('FRAME_NOT_FOUND', `未找到帧 ${frameId || ''}。`) };
  }

  if (frame.source_mode !== 'raw_html' || !frame.html_path) {
    return { error: fail('FRAME_HTML_NOT_AVAILABLE', '当前帧没有可编辑的 HTML 源码。') };
  }

  let htmlPath;
  try {
    htmlPath = resolveProjectPath(projectDir, frame.html_path);
  } catch (error) {
    return { error: fail('FRAME_HTML_PATH_INVALID', error.message) };
  }

  try {
    await fs.access(htmlPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { error: fail('FRAME_HTML_NOT_AVAILABLE', '当前帧没有可编辑的 HTML 源码。') };
    }
    throw error;
  }

  return { frame, htmlPath };
}

async function readFrameHtml({ projectDir, project, frameId } = {}) {
  const resolved = await frameHtmlPath(projectDir, project, frameId);
  if (resolved.error) return resolved.error;

  const html = await fs.readFile(resolved.htmlPath, 'utf8');
  return {
    success: true,
    frame_id: frameId,
    resolved_frame_id: canonicalFrameId(resolved.frame),
    source_mode: resolved.frame.source_mode,
    html_path: resolved.frame.html_path,
    html,
  };
}

async function saveFrameHtmlDraft({
  projectDir,
  project,
  frameId,
  html,
  mode,
  kind = 'manual_source',
  summary = '',
  instruction = '',
} = {}) {
  if (mode === 'replace') {
    return fail('FRAME_REPLACE_FORBIDDEN', '当前不支持直接替换帧源码，请先保存为草稿。');
  }

  const validationError = validateCompleteHtml(html);
  if (validationError) return validationError;

  const resolved = await frameHtmlPath(projectDir, project, frameId);
  if (resolved.error) return resolved.error;

  const frame = resolved.frame;
  const hadDrafts = Array.isArray(frame.drafts);
  const originalDraftsLength = hadDrafts ? frame.drafts.length : 0;
  const hadActiveDraft = Object.prototype.hasOwnProperty.call(frame, 'active_draft_id');
  const originalActiveDraftId = frame.active_draft_id;
  const draft = createDraftEntry({ project, frameId, kind, summary, instruction });
  let draftPath;
  try {
    draftPath = resolveProjectPath(projectDir, draft.html_path);
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(draftPath, String(html), 'utf8');
  } catch (error) {
    if (hadDrafts) {
      frame.drafts.length = originalDraftsLength;
    } else {
      delete frame.drafts;
    }
    if (hadActiveDraft) {
      frame.active_draft_id = originalActiveDraftId;
    } else {
      delete frame.active_draft_id;
    }
    return fail('FRAME_HTML_WRITE_FAILED', '帧源码草稿写入失败，请稍后重试。');
  }

  addRevision(project, {
    summary: summary || '帧源码草稿已保存。',
    change: {
      type: 'frame_html_draft',
      frame_id: canonicalFrameId(resolved.frame),
      draft_id: draft.id,
    },
  });

  return {
    success: true,
    message: '帧源码草稿已保存，可渲染单帧预览。',
    user_message: '帧源码草稿已保存，可渲染单帧预览。',
    frame_id: String(frameId || ''),
    resolved_frame_id: canonicalFrameId(resolved.frame),
    draft,
    requires_render: true,
  };
}

async function acceptFrameDraft({ projectDir, project, frameId, draftId } = {}) {
  const resolved = await frameHtmlPath(projectDir, project, frameId);
  if (resolved.error) return resolved.error;

  const draft = findDraft(project, frameId, draftId);
  if (!draft) {
    return fail('DRAFT_NOT_FOUND', `未找到草稿 ${draftId || ''}。`);
  }
  if (draft.status !== 'ready') {
    return fail('DRAFT_NOT_READY', '草稿不是可操作状态。');
  }

  let draftPath;
  let officialPath;
  try {
    draftPath = resolveProjectPath(projectDir, draft.html_path);
    officialPath = resolveProjectPath(projectDir, resolved.frame.html_path);
  } catch (error) {
    return fail('FRAME_HTML_PATH_INVALID', error.message);
  }

  const html = await fs.readFile(draftPath, 'utf8');
  const validationError = validateCompleteHtml(html);
  if (validationError) return validationError;

  await fs.writeFile(officialPath, html, 'utf8');
  markDraftAccepted(project, frameId, draftId);
  addRevision(project, {
    summary: '帧源码草稿已接受。',
    change: {
      type: 'frame_html_draft_accept',
      frame_id: canonicalFrameId(resolved.frame),
      draft_id: draft.id,
    },
  });

  return {
    success: true,
    message: '草稿已接受，需要重新导出成片。',
    user_message: '草稿已接受，需要重新导出成片。',
    frame_id: String(frameId || ''),
    resolved_frame_id: canonicalFrameId(resolved.frame),
    accepted_draft_id: draft.id,
    requires_render: true,
  };
}

function discardFrameDraft({ project, frameId, draftId } = {}) {
  const frame = findFrameByAnyId(project, frameId);
  if (!frame) {
    return fail('FRAME_NOT_FOUND', `未找到帧 ${frameId || ''}。`);
  }

  const draft = findDraft(project, frameId, draftId);
  if (!draft) {
    return fail('DRAFT_NOT_FOUND', `未找到草稿 ${draftId || ''}。`);
  }
  if (draft.status !== 'ready') {
    return fail('DRAFT_NOT_READY', '草稿不是可操作状态。');
  }

  markDraftDiscarded(project, frameId, draftId);
  addRevision(project, {
    summary: '帧源码草稿已放弃。',
    change: {
      type: 'frame_html_draft_discard',
      frame_id: canonicalFrameId(frame),
      draft_id: draft.id,
    },
  });

  return {
    success: true,
    message: '草稿已放弃。',
    user_message: '草稿已放弃。',
    frame_id: String(frameId || ''),
    resolved_frame_id: canonicalFrameId(frame),
    discarded_draft_id: draft.id,
  };
}

module.exports = {
  readFrameHtml,
  saveFrameHtmlDraft,
  acceptFrameDraft,
  discardFrameDraft,
  validateCompleteHtml,
  resolveProjectPath,
};
