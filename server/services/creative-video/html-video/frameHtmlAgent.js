const { createDiagnostic } = require('./diagnostics');
const {
  normalizeHtmlCanvasContract,
  validateHtmlCanvasContract,
} = require('./frameCanvasContract');
const {
  buildFrameHtmlPrompt,
  buildShortFrameHtmlPrompt,
  buildAssetFirstFramePrompt,
  buildRetryPrompt,
  frameAssetReferenceSummary,
  resolveResolution,
} = require('./framePromptBuilder');
const {
  objectOrEmpty,
  extractHtmlDocument,
  validateFrameAssetUsage,
  validateHtmlContentQuality,
} = require('./frameHtmlInspection');

function validateHtmlTargetResolution(html, target = {}) {
  return validateHtmlCanvasContract(html, target);
}

function targetResolutionValidationFailure(result = {}) {
  return {
    success: false,
    code: 'html_validation_failed',
    message: result.message || 'AI 返回的 HTML 画幅尺寸不符合目标尺寸。',
    details: {
      validation_code: 'frame_html_invalid',
      ...objectOrEmpty(result),
    },
  };
}

function validateGeneratedHtml(html, args = {}) {
  const resolution = validateHtmlTargetResolution(html, args.target || {});
  if (!resolution.success) {
    return {
      success: false,
      code: 'html_validation_failed',
      message: resolution.message || 'AI 返回的 HTML 画幅尺寸不符合目标尺寸。',
      details: {
        validation_code: 'frame_html_invalid',
        ...resolution,
      },
    };
  }
  const quality = validateHtmlContentQuality(html, args);
  if (!quality.success) {
    return {
      ...quality,
      code: 'html_validation_failed',
      details: {
        validation_code: quality.code || 'frame_html_invalid',
        ...(quality.details || {}),
      },
    };
  }
  const assetUsage = validateFrameAssetUsage(html, args);
  if (!assetUsage.success) {
    return {
      ...assetUsage,
      code: 'html_validation_failed',
      details: {
        validation_code: assetUsage.code || 'frame_html_asset_usage_invalid',
        ...(assetUsage.details || {}),
      },
    };
  }
  return quality;
}

async function callModel(model, prompt, options = {}) {
  if (!model || typeof model.callTextModel !== 'function') {
    return { success: false, message: '未配置 HTML 生成模型。' };
  }
  const response = await model.callTextModel({
    ...objectOrEmpty(options),
    messages: [{ role: 'user', content: prompt }],
  });
  if (!response || response.success === false) {
    const message = response?.message || 'AI 调用失败。';
    return {
      success: false,
      message,
      ...(isProviderMissingTextMessage(message) ? { code: 'provider_missing_text' } : {}),
    };
  }
  const text = response.text || response.content || '';
  if (!String(text || '').trim()) {
    return { success: false, message: '模型返回结果缺少文本内容。', code: 'provider_missing_text' };
  }
  return { success: true, text };
}

function isProviderMissingTextMessage(message = '') {
  return /返回结果缺少文本内容|流式返回结果缺少文本内容|缺少文本/.test(String(message || ''));
}

function frameDiagnostic(code, message, args = {}, details = {}) {
  return createDiagnostic({
    code,
    stage: 'ai-frame-html',
    sub_stage: 'frame_html',
    frame_id: args.node?.id || '',
    retryable: true,
    repair_action: 'retry_frame_html',
    user_message: message,
    details,
  });
}

function frameFailure(code, message, args = {}, details = {}) {
  const result = {
    success: false,
    code,
    message,
    diagnostics: [frameDiagnostic(code, message, args, details)],
  };
  if (details.failed_html) result.failed_html = details.failed_html;
  return result;
}

function htmlRetryFailureMessage(retry = {}) {
  const retryProviderMissing = retry.code === 'provider_missing_text' || isProviderMissingTextMessage(retry.message || '');
  if (retryProviderMissing) return '首版 HTML 文档提取失败；修复重试时模型返回空内容。';
  return retry.message
    ? `首版 HTML 文档提取失败；修复重试失败：${retry.message}`
    : '首版 HTML 文档提取失败；修复重试仍未返回完整 HTML。';
}

function withRepairAudit(options = {}, repairAttempt = 1) {
  const audit = objectOrEmpty(options.audit);
  if (!audit.agent && !audit.stage) return options;
  return {
    ...options,
    audit: {
      ...audit,
      repair_attempt: repairAttempt,
    },
  };
}

function validationFailureMessage(validationMessage, retry = {}) {
  const retryProviderMissing = retry.code === 'provider_missing_text' || isProviderMissingTextMessage(retry.message || '');
  const retryMessage = retry.message || '';
  return [
    `首版 HTML 未通过校验：${validationMessage || 'HTML 内容校验失败。'}`,
    retryProviderMissing
      ? '修复重试时模型返回空内容。'
      : (retryMessage ? `修复重试仍未返回可用 HTML：${retryMessage}` : ''),
  ].filter(Boolean).join('；');
}

function validationFailureDetails(validation = {}, retry = {}, failedHtml = '', extra = {}) {
  const retryProviderMissing = retry.code === 'provider_missing_text' || isProviderMissingTextMessage(retry.message || '');
  return {
    ...(validation.details || {}),
    validation_code: validation.details?.validation_code || validation.code || 'html_validation_failed',
    validation_message: validation.message || '',
    retry_message: retry.message || '',
    ...(retryProviderMissing ? { retry_provider_missing_text: true } : {}),
    ...extra,
    ...(failedHtml ? { failed_html: failedHtml } : {}),
  };
}

async function generateFrameHtml({
  model,
  frameId,
  attempt = 1,
  modelOptions = {},
  shortPrompt = false,
  ...args
} = {}) {
  const callOptions = attempt >= 2 ? { ...modelOptions, stream: false } : modelOptions;
  const promptArgs = {
    ...args,
    frameId,
    node: {
      ...objectOrEmpty(args.node),
      ...(frameId ? { id: args.node?.id || frameId } : {}),
    },
  };
  const firstPrompt = shortPrompt ? buildShortFrameHtmlPrompt(promptArgs) : buildFrameHtmlPrompt(promptArgs);
  const first = await callModel(model, firstPrompt, callOptions);
  if (!first.success) {
    return frameFailure(first.code || 'frame_html_invalid', first.message || '单帧 HTML 生成失败。', promptArgs);
  }
  const allowInternalRetry = attempt < 2 && shortPrompt !== true;
  const firstExtracted = extractHtmlDocument(first.text);
  if (firstExtracted.success) {
    const targetValidation = validateHtmlTargetResolution(firstExtracted.html, promptArgs.target || {});
    const normalizedHtml = normalizeHtmlCanvasContract(firstExtracted.html, promptArgs.target || {});
    const validation = targetValidation.success
      ? validateGeneratedHtml(normalizedHtml, promptArgs)
      : targetResolutionValidationFailure(targetValidation);
    if (validation.success) return { ...firstExtracted, html: normalizedHtml, diagnostics: validation.diagnostics || [] };
    if (!allowInternalRetry) {
      return frameFailure(validation.code || 'frame_html_invalid', validation.message || '单帧 HTML 内容校验失败。', promptArgs, {
        ...(validation.details || {}),
        failed_html: normalizedHtml,
      });
    }
    const retry = await callModel(model, buildRetryPrompt({
      ...promptArgs,
      validationMessage: validation.message,
    }), withRepairAudit(callOptions, 1));
    if (!retry.success) {
      return frameFailure('html_validation_failed', validationFailureMessage(validation.message, retry), promptArgs, validationFailureDetails(validation, retry, normalizedHtml, {
        diagnostics: [validation.message, retry.message].filter(Boolean),
      }));
    }
    const retryExtracted = extractHtmlDocument(retry.text);
    if (!retryExtracted.success) {
      return frameFailure('html_validation_failed', validationFailureMessage(validation.message, retryExtracted), promptArgs, validationFailureDetails(validation, retryExtracted, normalizedHtml, {
        diagnostics: [validation.message, retryExtracted.message].filter(Boolean),
      }));
    }
    const retryTargetValidation = validateHtmlTargetResolution(retryExtracted.html, promptArgs.target || {});
    const retryHtml = normalizeHtmlCanvasContract(retryExtracted.html, promptArgs.target || {});
    const retryValidation = retryTargetValidation.success
      ? validateGeneratedHtml(retryHtml, promptArgs)
      : targetResolutionValidationFailure(retryTargetValidation);
    if (retryValidation.success) return { ...retryExtracted, html: retryHtml, diagnostics: retryValidation.diagnostics || [] };
    return frameFailure(retryValidation.code || 'html_validation_failed', retryValidation.message || '单帧 HTML 内容校验失败。', promptArgs, {
      diagnostics: [validation.message, retryValidation.message].filter(Boolean),
      ...(retryValidation.details || {}),
      failed_html: retryHtml,
    });
  }

  if (!allowInternalRetry) {
    return frameFailure(firstExtracted.code || 'html_document_extract_failed', firstExtracted.message || 'AI 未返回完整 HTML document。', promptArgs);
  }
  const retry = await callModel(model, buildRetryPrompt(promptArgs), withRepairAudit(callOptions, 1));
  if (!retry.success) {
    return frameFailure('html_document_extract_failed', htmlRetryFailureMessage(retry), promptArgs, {
      diagnostics: [firstExtracted.message, retry.message].filter(Boolean),
      ...(retry.code === 'provider_missing_text' || isProviderMissingTextMessage(retry.message) ? { retry_provider_missing_text: true } : {}),
    });
  }
  const retryExtracted = extractHtmlDocument(retry.text);
  if (retryExtracted.success) {
    const retryTargetValidation = validateHtmlTargetResolution(retryExtracted.html, promptArgs.target || {});
    const retryHtml = normalizeHtmlCanvasContract(retryExtracted.html, promptArgs.target || {});
    const retryValidation = retryTargetValidation.success
      ? validateGeneratedHtml(retryHtml, promptArgs)
      : targetResolutionValidationFailure(retryTargetValidation);
    if (retryValidation.success) return { ...retryExtracted, html: retryHtml, diagnostics: retryValidation.diagnostics || [] };
    return frameFailure(retryValidation.code || 'html_validation_failed', retryValidation.message || '单帧 HTML 内容校验失败。', promptArgs, {
      diagnostics: [firstExtracted.message, retryValidation.message].filter(Boolean),
      ...(retryValidation.details || {}),
      failed_html: retryHtml,
    });
  }
  return frameFailure(retryExtracted.code || 'html_document_extract_failed', retryExtracted.message || 'AI 未返回完整 HTML document。', promptArgs, {
    diagnostics: [firstExtracted.message, retryExtracted.message].filter(Boolean),
    ...(retryExtracted.code === 'provider_missing_text' ? { retry_provider_missing_text: true } : {}),
  });
}

module.exports = {
  buildFrameHtmlPrompt,
  buildShortFrameHtmlPrompt,
  buildAssetFirstFramePrompt,
  extractHtmlDocument,
  generateFrameHtml,
  callModel,
  buildRetryPrompt,
  frameAssetReferenceSummary,
  resolveResolution,
  validateFrameAssetUsage,
  validateHtmlTargetResolution,
  validateHtmlContentQuality,
};
