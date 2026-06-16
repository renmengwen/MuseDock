const { normalizeProject, clone } = require('./projectSchema');
const { addRevision } = require('./projectStore');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function fail(message, code = 'EDIT_FAILED') {
  return { success: false, code, message, user_message: message };
}

function containsRawHtml(value) {
  if (typeof value === 'string') {
    return /<\s*\/?\s*(html|body|head|script|style|iframe|object|embed|link|meta)\b|<!doctype\b/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsRawHtml);
  if (value && typeof value === 'object') return Object.values(value).some(containsRawHtml);
  return false;
}

function unsafePath(value) {
  const text = String(value || '').replace(/\\/g, '/');
  if (!text) return false;
  return text.startsWith('/') || /^[a-zA-Z]:\//.test(text) || text.split('/').includes('..');
}

function assertPatchSafe(value, keyPath = '') {
  if (containsRawHtml(value)) {
    return fail('编辑内容不允许包含 HTML、script 或页面源码。', 'HTML_NOT_ALLOWED');
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const nextPath = keyPath ? `${keyPath}.${key}` : key;
      if (/(^|_)(path|url|href|src)$/i.test(key) && unsafePath(child)) {
        return fail(`路径字段 ${nextPath} 不合法，不能使用绝对路径或 ..。`, 'PATH_NOT_ALLOWED');
      }
      const childResult = assertPatchSafe(child, nextPath);
      if (childResult) return childResult;
    }
  }
  return null;
}

function findFrame(project, frameId) {
  return project.frames.find(frame => frame.id === frameId || frame.scene_id === frameId);
}

function mergePatch(target, patch) {
  return {
    ...objectOrEmpty(target),
    ...objectOrEmpty(patch),
  };
}

function markRevision(project, patch, flags) {
  const revision = addRevision(project, {
    summary: patch.summary || 'html-video 编辑已保存。',
    author: patch.author || null,
    change: {
      type: patch.type,
      frame_id: patch.frame_id,
      caption_id: patch.caption_id,
    },
  });
  revision.requires_tts = flags.requires_tts === true;
  revision.requires_render = flags.requires_render === true;
  return revision;
}

function patchCaption(project, patch) {
  const captionId = String(patch.caption_id || patch.id || '').trim();
  if (!captionId) return fail('缺少字幕 ID。', 'CAPTION_ID_REQUIRED');
  if (!Array.isArray(project.captions)) project.captions = [];
  const index = project.captions.findIndex(caption => caption && caption.id === captionId);
  if (index < 0) return fail(`未找到字幕 ${captionId}。`, 'CAPTION_NOT_FOUND');
  project.captions[index] = mergePatch(project.captions[index], patch.patch || { text: patch.text });
  return null;
}

function applyDuration(project, patch) {
  const frame = findFrame(project, patch.frame_id);
  if (!frame) return fail(`未找到帧 ${patch.frame_id || ''}。`, 'FRAME_NOT_FOUND');
  const duration = Number(patch.duration_sec ?? patch.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    return fail('时长必须是大于 0 的数字。', 'DURATION_INVALID');
  }
  frame.duration_sec = duration;
  for (const track of project.timeline.tracks || []) {
    for (const item of track.items || []) {
      if (item.id === frame.id || item.frame_id === frame.id || item.ref === frame.id) {
        item.duration_sec = duration;
        if (item.duration != null) item.duration = duration;
      }
    }
  }
  return null;
}

function applyEditPatch(project, patch = {}) {
  const edit = objectOrEmpty(patch);
  const safeError = assertPatchSafe(edit);
  if (safeError) return safeError;

  const cloned = clone(project || {});
  const nextProject = {
    ...normalizeProject(cloned),
    captions: Array.isArray(cloned.captions)
      ? cloned.captions.map(caption => ({ ...objectOrEmpty(caption) }))
      : [],
  };
  const flags = { requires_tts: false, requires_render: true };
  let error = null;

  if (edit.type === 'template_inputs_patch') {
    nextProject.template_inputs = mergePatch(nextProject.template_inputs, edit.patch);
  } else if (edit.type === 'frame_inputs_patch') {
    const frame = findFrame(nextProject, edit.frame_id);
    if (!frame) error = fail(`未找到帧 ${edit.frame_id || ''}。`, 'FRAME_NOT_FOUND');
    else frame.inputs = mergePatch(frame.inputs, edit.patch);
  } else if (edit.type === 'narration_patch') {
    nextProject.audio = objectOrEmpty(nextProject.audio);
    nextProject.audio.narration_text = String(edit.text ?? edit.narration_text ?? '');
    flags.requires_tts = true;
  } else if (edit.type === 'caption_patch') {
    error = patchCaption(nextProject, edit);
  } else if (edit.type === 'duration_patch') {
    error = applyDuration(nextProject, edit);
  } else if (edit.type === 'replace_frame_template') {
    const frame = findFrame(nextProject, edit.frame_id);
    if (!frame) error = fail(`未找到帧 ${edit.frame_id || ''}。`, 'FRAME_NOT_FOUND');
    else {
      frame.template_id = String(edit.template_id || '').trim();
      if (!frame.template_id) error = fail('缺少新模板 ID。', 'TEMPLATE_ID_REQUIRED');
      frame.inputs = objectOrEmpty(edit.inputs);
      frame.html_path = null;
    }
  } else {
    error = fail(`暂不支持的 html-video 编辑类型：${edit.type || '未指定'}。`, 'EDIT_TYPE_UNSUPPORTED');
  }

  if (error) return error;
  const revision = markRevision(nextProject, edit, flags);
  return {
    success: true,
    message: 'html-video 编辑已保存。',
    project: nextProject,
    revision,
    requires_tts: flags.requires_tts,
    requires_render: flags.requires_render,
  };
}

module.exports = {
  applyEditPatch,
};
