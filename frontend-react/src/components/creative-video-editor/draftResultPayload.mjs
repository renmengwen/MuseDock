// 从「保存帧源码草稿」API 返回里解析出刚生成的草稿 id。
// 兼容 html_video_project / project / data.project / data 四种返回形态，
// 再回退到顶层 draft_id / draft.id。找不到返回空串。
export function resolveSavedDraftId(result, frameId) {
  if (!result) return '';
  const project = result.html_video_project || result.project || result.data?.project || result.data;
  const frames = Array.isArray(project?.frames) ? project.frames : [];
  const target = String(frameId || '');
  const frame = frames.find(item => String(item?.id || item?.scene_id || '') === target);
  return frame?.active_draft_id || result.draft_id || result.draft?.id || '';
}
