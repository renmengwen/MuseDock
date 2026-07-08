export const RETRY_ACTION_TEXT = {
  retry_frame_html: '只重试失败帧，复用已生成内容',
  retry_content_graph: '重新生成内容图并继续后续步骤',
  fallback_scene_spec_graph: '使用脚本结构恢复内容图并继续生成',
  repair_timeline: '修复时间轴后重新渲染',
  repair_script_and_timeline: '压缩旁白并重新生成音频与时间轴',
  rerender_frames: '只重渲染失败镜头',
  recompose: '重新合成成片',
  rerun_visual_inspect: '重新执行视觉巡检',
  restart_project: '从工程阶段重新开始',
};

export const RETRY_STAGE_TEXT = {
  source: '素材解析',
  research: '资料检索',
  agent_run: '脚本生成',
  brief: '视频脚本',
  audio: '旁白音频',
  content_graph: '内容图',
  frame_html: '镜头 HTML',
  scene_spec: '分镜脚本',
  timeline: '时间轴',
  render: '镜头渲染',
  render_outputs: '渲染输出',
  compose: '成片合成',
  exports: '成片文件',
  duration_verify: '时长校验',
  visual_inspect: '视觉巡检',
  html_video_project: '视频工程',
  project: '视频工程',
};

export const RETRY_CODE_TEXT = {
  provider_missing_text: '模型返回内容为空',
  content_graph_invalid: '内容图格式异常',
  frame_html_invalid: '镜头 HTML 生成异常',
  html_document_extract_failed: '镜头 HTML 文档提取失败',
  html_validation_failed: '镜头 HTML 校验失败',
  timeline_duration_unreasonable: '时间轴时长异常',
  render_failed: '镜头渲染失败',
  compose_failed: '成片合成失败',
  duration_mismatch: '成片时长不匹配',
  visual_inspect_failed: '视觉巡检失败',
};

export function formatRetryItem(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (RETRY_STAGE_TEXT[text]) return RETRY_STAGE_TEXT[text];
  if (text.startsWith('frames:')) return `镜头 ${text.slice('frames:'.length)}`;
  if (text.startsWith('render:')) return `渲染镜头 ${text.slice('render:'.length)}`;
  if (text.startsWith('frame_html:')) return `镜头 HTML ${text.slice('frame_html:'.length)}`;
  return text;
}

export function formatRetryList(items) {
  const values = Array.isArray(items) ? items.map(formatRetryItem).filter(Boolean) : [];
  return values.length ? values.join('、') : '无';
}
