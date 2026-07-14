function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const DIAGNOSTIC_DETAIL_EXTENSION_KEYS = new Set([
  'sub_stage',
  'frame_id',
  'retryable',
  'repair_action',
]);

function stripDiagnosticDetailKeys(details) {
  return Object.fromEntries(Object.entries(objectOrEmpty(details)).filter(([key]) => (
    !DIAGNOSTIC_DETAIL_EXTENSION_KEYS.has(key)
  )));
}

const DEFAULT_MESSAGES = {
  timeline_item_kind_unsupported: '首版时间线只支持 frame 类型条目。',
  asset_path_invalid: '素材路径不合法。',
  playwright_not_configured: 'Playwright Chromium 未配置，无法渲染 html-video。',
  ffmpeg_not_configured: 'ffmpeg 未配置，无法合成 html-video。',
  html_override_active: '当前工程启用了 HTML 改写，自动生成与渲染需要谨慎处理。',
  render_failed: 'html-video 渲染失败。',
  compose_failed: 'html-video 合成失败。',
  frame_html_content_mismatch: '单帧 HTML 主画面内容与当前镜头不匹配。',
  html_document_extract_failed: 'AI 未返回完整 HTML document。',
  html_validation_failed: '单帧 HTML 未通过校验。',
  render_output_missing_audio: '导出成片缺少音频轨。',
  storyboard_narration_incomplete: '导演策划旁白存在半句截断。',
  ai_response_invalid: 'AI 返回内容不符合 html-video JSON 要求。',
  project_invalid: 'html-video 工程校验失败。',
};

function normalizeCode(code) {
  return String(code || 'html_video_error').trim().replace(/-/g, '_');
}

function createDiagnostic(input = {}) {
  const code = normalizeCode(input.code);
  const severity = String(input.severity || '').trim();
  const sub_stage = String(input.sub_stage || '').trim();
  const frame_id = String(input.frame_id || '').trim();
  const repair_action = String(input.repair_action || '').trim();
  return {
    code,
    stage: String(input.stage || 'html-video'),
    ...(sub_stage ? { sub_stage } : {}),
    ...(frame_id ? { frame_id } : {}),
    user_message: String(input.user_message || DEFAULT_MESSAGES[code] || 'html-video 处理失败。'),
    details: stripDiagnosticDetailKeys(input.details),
    fallback_allowed: input.fallback_allowed !== false,
    ...(typeof input.retryable === 'boolean' ? { retryable: input.retryable } : {}),
    ...(repair_action ? { repair_action } : {}),
    ...(severity ? { severity } : {}),
  };
}

function normalizeDiagnostic(input, defaults = {}) {
  if (typeof input === 'string') {
    return createDiagnostic({
      ...defaults,
      user_message: defaults.user_message || `html-video 处理失败：${input}`,
      details: { message: input },
    });
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const code = normalizeCode(input.code || defaults.code || 'html_video_info');
    return createDiagnostic({
      ...defaults,
      ...objectOrEmpty(input),
      code,
      stage: input.stage || defaults.stage || 'unknown',
      user_message: input.user_message || defaults.user_message || DEFAULT_MESSAGES[code] || input.message || 'html-video 处理信息。',
      details: {
        ...objectOrEmpty(defaults.details),
        ...(typeof input.message === 'string' ? { message: input.message } : {}),
        ...objectOrEmpty(input.details),
        ...Object.fromEntries(Object.entries(objectOrEmpty(input)).filter(([key]) => (
          !['code', 'stage', 'sub_stage', 'frame_id', 'retryable', 'repair_action', 'user_message', 'message', 'details', 'fallback_allowed', 'severity'].includes(key)
        ))),
      },
      fallback_allowed: input.fallback_allowed !== false,
    });
  }
  return createDiagnostic({
    ...defaults,
    code: defaults.code || 'html_video_error',
    user_message: defaults.user_message || `html-video 处理失败：${String(input || '未知错误')}`,
    details: { message: String(input || '') },
  });
}

function normalizeDiagnostics(items, defaults = {}) {
  return (Array.isArray(items) ? items : [])
    .map(item => normalizeDiagnostic(item, defaults));
}

function failureFromDiagnostics(message, diagnostics, extra = {}) {
  const normalized = normalizeDiagnostics(diagnostics);
  return {
    success: false,
    message: message || normalized[0]?.user_message || 'html-video 处理失败。',
    user_message: message || normalized[0]?.user_message || 'html-video 处理失败。',
    fallback_allowed: normalized.every(item => item.fallback_allowed !== false),
    html_video_diagnostics: normalized,
    diagnostics: normalized,
    ...extra,
  };
}

module.exports = {
  DEFAULT_MESSAGES,
  createDiagnostic,
  normalizeDiagnostic,
  normalizeDiagnostics,
  failureFromDiagnostics,
};
