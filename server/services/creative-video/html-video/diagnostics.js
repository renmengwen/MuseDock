function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const DEFAULT_MESSAGES = {
  template_missing: '未找到可用的 html-video 模板。',
  unsupported_engine: '当前模板引擎暂不支持。',
  source_entry_not_html: '首版 html-video 只支持 HTML 模板入口。',
  license_not_allowed: '模板授权不符合本次使用要求。',
  template_inputs_invalid: '模板字段校验失败。',
  timeline_item_kind_unsupported: '首版时间线只支持 frame 类型条目。',
  asset_path_invalid: '素材路径不合法。',
  playwright_not_configured: 'Playwright Chromium 未配置，无法渲染 html-video。',
  ffmpeg_not_configured: 'ffmpeg 未配置，无法合成 html-video。',
  html_override_active: '当前工程启用了 HTML 改写，自动生成与渲染需要谨慎处理。',
  render_failed: 'html-video 渲染失败。',
  compose_failed: 'html-video 合成失败。',
  ai_response_invalid: 'AI 返回内容不符合 html-video JSON 要求。',
  project_invalid: 'html-video 工程校验失败。',
};

function normalizeCode(code) {
  return String(code || 'html_video_error').trim().replace(/-/g, '_');
}

function createDiagnostic(input = {}) {
  const code = normalizeCode(input.code);
  return {
    code,
    stage: String(input.stage || 'html-video'),
    user_message: String(input.user_message || input.message || DEFAULT_MESSAGES[code] || 'html-video 处理失败。'),
    details: objectOrEmpty(input.details),
    fallback_allowed: input.fallback_allowed !== false,
  };
}

function normalizeDiagnostic(input, defaults = {}) {
  if (typeof input === 'string') {
    return createDiagnostic({
      ...defaults,
      user_message: input,
      details: { message: input },
    });
  }
  return createDiagnostic({
    ...defaults,
    ...objectOrEmpty(input),
    details: {
      ...objectOrEmpty(defaults.details),
      ...objectOrEmpty(input && input.details),
      ...Object.fromEntries(Object.entries(objectOrEmpty(input)).filter(([key]) => (
        !['code', 'stage', 'user_message', 'message', 'details', 'fallback_allowed'].includes(key)
      ))),
    },
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
