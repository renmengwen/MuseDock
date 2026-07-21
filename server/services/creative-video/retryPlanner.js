const { parseContentGraphResponse } = require('./html-video/contentGraphAgent');
const { analyzeTimelineMismatch } = require('./html-video/timelineRepair');

const MODE = 'repair_and_resume';
const ENVIRONMENT_CODES = new Set(['ffmpeg_not_configured', 'playwright_not_configured']);
const RETRY_META_FAILURE_CODES = new Set(['resume_action_not_configured', 'retry_executor_failed', 'project_dir_missing']);
const NON_FAILURE_DIAGNOSTIC_CODES = new Set(['frame_rendered']);
const PLAYBACK_HTML_FAILURE_CODES = new Set([
  'render-playback-start-failed',
  'render-playback-runtime-failed',
  'render_playback_start_failed',
  'render_playback_runtime_failed',
]);
// 阻断性视觉 QA code 共享常量（与 htmlVideoWorkflow / resumeExecutor 字面一致）
const BLOCKING_VISUAL_QA_CODES = new Set(require('./visualQaCodes').BLOCKING_VISUAL_QA_CODES);

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function safeString(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = safeString(value);
    if (text) return text;
  }
  return '';
}

function collectDiagnostics(input = {}) {
  const workflow = objectOrEmpty(input.workflow);
  const lastFailure = objectOrEmpty(input.last_failure || workflow.last_failure);
  return [
    ...arrayOrEmpty(input.diagnostics),
    ...arrayOrEmpty(lastFailure.diagnostics),
    ...arrayOrEmpty(workflow.diagnostics),
  ].filter(item => item && typeof item === 'object');
}

function chooseDiagnostic(diagnostics) {
  const coded = diagnostics.filter(item => safeString(item.code) && !NON_FAILURE_DIAGNOSTIC_CODES.has(safeString(item.code)));
  return coded.find(item => item.severity === 'error')
    || coded.find(item => item.severity !== 'warning' && (item.retryable === true || safeString(item.repair_action)))
    || coded.find(item => item.severity !== 'warning')
    || coded.find(item => safeString(item.code))
    || diagnostics.find(item => safeString(item.stage) || safeString(item.message) || safeString(item.user_message))
    || null;
}

function inferCodeFromText(stage, message) {
  const text = `${safeString(stage)} ${safeString(message)}`.toLowerCase();
  const hasCompose = /compose|合成/.test(text);
  const hasDurationMismatch = /duration|时长/.test(text) && /mismatch|不匹配|不一致|不符/.test(text);
  if (/ffmpeg/.test(text)) return 'ffmpeg_not_configured';
  if (/playwright|chromium/.test(text)) return 'playwright_not_configured';
  if (/content[_ -]?graph|nodes|json/.test(text)) return 'content_graph_invalid';
  if (/frame[_ -]?html|html/.test(text) && /missing text|缺少文本|返回为空|空内容/.test(text)) return 'provider_missing_text';
  if (/html/.test(text) && /document|提取|完整/.test(text)) return 'html_document_extract_failed';
  if (/html/.test(text) && /validation|校验|画幅|尺寸/.test(text)) return 'html_validation_failed';
  if (/frame[_ -]?html/.test(text)) return 'frame_html_invalid';
  if (/render|timeout|超时/.test(text)) return /timeout|超时/.test(text) ? 'render_failed_timeout' : 'render_failed';
  if (hasCompose && hasDurationMismatch) return 'duration_mismatch';
  if (/duration|时长|timeline|时间轴/.test(text)) return 'timeline_duration_unreasonable';
  if (hasCompose) return 'compose_failed';
  return '';
}

function firstFailedFrame(stage = {}) {
  const frames = objectOrEmpty(stage.frames);
  for (const [frameId, frame] of Object.entries(frames)) {
    if (frame?.status === 'failed') {
      return { frame_id: frameId, code: safeString(frame.diagnostic_code) };
    }
  }
  return { frame_id: '', code: '' };
}

function classifyFromCheckpoint(project = {}) {
  const stages = objectOrEmpty(project.generation_checkpoint?.stages);
  if (stages.validate_project?.status === 'failed') {
    return {
      code: firstNonEmpty(stages.validate_project.diagnostic_code, 'project_invalid'),
      sub_stage: 'validate_project',
      source: 'checkpoint',
    };
  }
  if (stages.content_graph?.status === 'failed') {
    return {
      code: firstNonEmpty(stages.content_graph.diagnostic_code, 'content_graph_invalid'),
      sub_stage: 'content_graph',
      source: 'checkpoint',
    };
  }
  if (stages.frame_html) {
    const failed = firstFailedFrame(stages.frame_html);
    if (failed.frame_id) {
      return {
        code: firstNonEmpty(failed.code, 'frame_html_invalid'),
        sub_stage: 'frame_html',
        frame_id: failed.frame_id,
        source: 'checkpoint',
      };
    }
  }
  if (stages.render) {
    const failed = firstFailedFrame(stages.render);
    if (failed.frame_id) {
      return {
        code: firstNonEmpty(failed.code, 'render_failed'),
        sub_stage: 'render',
        frame_id: failed.frame_id,
        source: 'checkpoint',
      };
    }
  }
  for (const stageId of ['compose', 'duration_verify', 'visual_inspect']) {
    if (stages[stageId]?.status === 'failed') {
      return {
        code: firstNonEmpty(stages[stageId].diagnostic_code, `${stageId}_failed`),
        sub_stage: stageId,
        source: 'checkpoint',
      };
    }
  }
  return null;
}

function latestRetryAttempt(workflow = {}) {
  const attempts = arrayOrEmpty(workflow.retry?.attempts);
  return attempts.length ? attempts[attempts.length - 1] : null;
}

function retryMetaFailureReplacement(workflow = {}, lastFailure = {}) {
  if (!RETRY_META_FAILURE_CODES.has(safeString(lastFailure.code))) return lastFailure;
  const previous = latestRetryAttempt(workflow)?.previous_failure;
  return previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
}

function classifyCreativeWorkflowFailure(input = {}) {
  const workflow = objectOrEmpty(input.workflow);
  const project = objectOrEmpty(input.project);
  const lastFailure = retryMetaFailureReplacement(
    workflow,
    objectOrEmpty(input.last_failure || workflow.last_failure),
  );
  const diagnostics = collectDiagnostics({ ...input, last_failure: lastFailure });
  const checkpoint = classifyFromCheckpoint(project);
  if (checkpoint?.sub_stage === 'validate_project' && checkpoint.code === 'project_read_failed') {
    return { ...checkpoint, diagnostics };
  }
  const diagnostic = chooseDiagnostic(diagnostics);

  if (diagnostic && safeString(diagnostic.code)) {
    return {
      code: safeString(diagnostic.code),
      sub_stage: firstNonEmpty(diagnostic.sub_stage, lastFailure.sub_stage),
      frame_id: firstNonEmpty(diagnostic.frame_id, lastFailure.frame_id),
      message: firstNonEmpty(diagnostic.user_message, diagnostic.message, lastFailure.message),
      diagnostic,
      diagnostics,
      source: 'diagnostic_code',
    };
  }

  if (diagnostic) {
    const inferred = inferCodeFromText(diagnostic.stage, firstNonEmpty(diagnostic.message, diagnostic.user_message));
    if (inferred) {
      return {
        code: inferred,
        sub_stage: firstNonEmpty(diagnostic.sub_stage, lastFailure.sub_stage),
        frame_id: firstNonEmpty(diagnostic.frame_id, lastFailure.frame_id),
        message: firstNonEmpty(diagnostic.user_message, diagnostic.message, lastFailure.message),
        diagnostic,
        diagnostics,
        source: 'diagnostic_message',
      };
    }
  }

  const rawWorkflowError = objectOrEmpty(workflow.error);
  const workflowError = RETRY_META_FAILURE_CODES.has(safeString(rawWorkflowError.code)) ? {} : rawWorkflowError;
  const workflowErrorCode = safeString(workflowError.code);
  if (workflowErrorCode && workflowErrorCode !== 'unknown_project_failure') {
    return {
      code: workflowErrorCode,
      sub_stage: safeString(workflowError.sub_stage),
      frame_id: safeString(workflowError.frame_id),
      message: safeString(workflowError.message),
      diagnostics,
      source: 'workflow_error_code',
    };
  }

  const messageCode = inferCodeFromText(workflowError.stage, workflowError.message);
  if (messageCode) {
    return {
      code: messageCode,
      sub_stage: safeString(workflowError.sub_stage),
      frame_id: safeString(workflowError.frame_id),
      message: safeString(workflowError.message),
      diagnostics,
      source: 'workflow_error_message',
    };
  }

  const lastFailureMessageCode = safeString(lastFailure.message)
    ? inferCodeFromText(lastFailure.stage || lastFailure.sub_stage, lastFailure.message)
    : '';
  if (lastFailureMessageCode) {
    return {
      code: lastFailureMessageCode,
      sub_stage: safeString(lastFailure.sub_stage),
      frame_id: safeString(lastFailure.frame_id),
      message: safeString(lastFailure.message),
      diagnostics,
      source: 'last_failure_message',
    };
  }

  if (checkpoint) {
    return { ...checkpoint, diagnostics };
  }

  if (safeString(lastFailure.code)) {
    return {
      code: safeString(lastFailure.code),
      sub_stage: safeString(lastFailure.sub_stage),
      frame_id: safeString(lastFailure.frame_id),
      message: safeString(lastFailure.message),
      diagnostics,
      source: 'last_failure_code',
    };
  }

  return {
    code: 'unknown_project_failure',
    sub_stage: safeString(lastFailure.sub_stage || workflowError.sub_stage),
    frame_id: safeString(lastFailure.frame_id || workflowError.frame_id),
    message: firstNonEmpty(lastFailure.message, workflowError.message, '工程阶段失败原因不足，无法自动恢复。'),
    diagnostics,
    source: 'unknown',
  };
}

function sceneSpecFromWorkflow(workflow = {}, project = {}) {
  return objectOrEmpty(project.scene_spec).scenes
    ? project.scene_spec
    : workflow?.result?.hyperframes_freeform?.project?.scene_spec
      || workflow?.result?.hyperframes_freeform?.scene_spec
      || null;
}

function retryContentGraphAlreadyFailed(workflow = {}) {
  return arrayOrEmpty(workflow.retry?.attempts)
    .some(attempt => attempt?.repair_action === 'retry_content_graph' && attempt?.status === 'failed');
}

function contentGraphRawResponse(diagnostics = []) {
  for (const diagnostic of diagnostics) {
    const details = objectOrEmpty(diagnostic.details);
    const text = firstNonEmpty(details.raw_response, details.response_text, details.text, details.content, diagnostic.raw_response);
    if (text) return text;
  }
  return '';
}

function failedRenderFrameIds(project = {}, preferredFrameId = '') {
  if (preferredFrameId) return [preferredFrameId];
  const frames = objectOrEmpty(project.generation_checkpoint?.stages?.render?.frames);
  return Object.entries(frames)
    .filter(([, frame]) => frame?.status === 'failed')
    .map(([frameId]) => frameId);
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = safeString(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function unresolvedLayoutQaFrameIds(project = {}, classification = {}) {
  const code = 'frame_layout_qa_unresolved';
  const diagnostics = [classification.diagnostic, ...arrayOrEmpty(classification.diagnostics)]
    .filter(item => safeString(item?.code) === code);
  const checkpointFrames = objectOrEmpty(project.generation_checkpoint?.stages?.frame_html?.frames);
  return uniqueStrings([
    classification.frame_id,
    ...diagnostics.flatMap(item => {
      const details = objectOrEmpty(item.details);
      return [item.frame_id, details.frame_id, ...arrayOrEmpty(details.issues).map(issue => issue?.frame_id)];
    }),
    ...Object.entries(checkpointFrames)
      .filter(([, frame]) => frame?.status === 'failed' && safeString(frame.diagnostic_code) === code)
      .map(([frameId]) => frameId),
  ]);
}

function collectDiagnosticVisualIssues(classification = {}) {
  const diagnostics = [
    classification.diagnostic,
    ...arrayOrEmpty(classification.diagnostics),
  ].filter(item => item && typeof item === 'object');
  return diagnostics.flatMap(item => [
    ...arrayOrEmpty(item.issues),
    ...arrayOrEmpty(objectOrEmpty(item.details).issues),
  ]).filter(issue => issue && typeof issue === 'object');
}

function blockingVisualQaIssues(classification = {}) {
  return collectDiagnosticVisualIssues(classification)
    .filter(issue => BLOCKING_VISUAL_QA_CODES.has(safeString(issue.code)));
}

function frameTimeline(project = {}) {
  let cursor = 0;
  return arrayOrEmpty(project.frames).map((frame, index) => {
    const duration = Number(frame.duration_sec ?? frame.durationSec ?? frame.duration);
    const start = cursor;
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    cursor += safeDuration;
    return {
      id: firstNonEmpty(frame.id, frame.frame_id, frame.scene_id, `frame_${index + 1}`),
      scene_id: safeString(frame.scene_id),
      start,
      end: cursor,
      index,
    };
  }).filter(frame => frame.id);
}

function frameAtTime(frames, time, { preferNextAtBoundary = false } = {}) {
  const number = Number(time);
  if (!Number.isFinite(number) || !frames.length) return null;
  const epsilon = 0.05;
  if (preferNextAtBoundary) {
    const next = frames.find(frame => Math.abs(frame.start - number) <= epsilon || frame.start > number);
    if (next) return next;
  }
  return frames.find(frame => number >= frame.start - epsilon && number < frame.end - epsilon)
    || frames.find(frame => number >= frame.start - epsilon && number <= frame.end + epsilon)
    || null;
}

/**
 * 从 required_visual_asset_missing 诊断的 missing_required_asset_ids（gen_<sceneId>）
 * 反解出场景 id，映射到该场景全部帧，用于按帧重试。
 */
function missingAssetFrameIds(project = {}, classification = {}) {
  const diagnostics = [
    classification.diagnostic,
    ...arrayOrEmpty(classification.diagnostics),
  ].filter(item => item && typeof item === 'object');
  const sceneIds = new Set(diagnostics
    .flatMap(item => arrayOrEmpty(objectOrEmpty(item.details).missing_required_asset_ids))
    .map(id => safeString(id).replace(/^gen_/, ''))
    .filter(Boolean));
  if (!sceneIds.size) return [];
  return uniqueStrings(arrayOrEmpty(project.frames)
    .filter(frame => sceneIds.has(safeString(frame?.scene_id)))
    .map(frame => safeString(frame?.id)));
}

function unregisteredAssetFrameIds(classification = {}) {
  const diagnostics = [classification.diagnostic, ...arrayOrEmpty(classification.diagnostics)]
    .filter(item => item && typeof item === 'object');
  return uniqueStrings(diagnostics.flatMap(item => arrayOrEmpty(
    objectOrEmpty(item.details).unregistered_image_references,
  )).map(item => item?.frame_id));
}

function visualQaIssueFrameIds(project = {}, classification = {}) {  const frames = frameTimeline(project);
  const issues = blockingVisualQaIssues(classification);
  const ids = [];
  for (const issue of issues) {
    const code = safeString(issue.code);
    if (code === 'blank_opening_frame') {
      const first = frames[0];
      if (first) ids.push(first.id);
      continue;
    }
    if (code === 'blank_segment_boundary') {
      const boundary = Number(issue.boundary_sec ?? issue.boundarySec);
      const frame = frameAtTime(frames, boundary, { preferNextAtBoundary: true });
      if (frame) ids.push(frame.id);
      continue;
    }
    for (const time of arrayOrEmpty(issue.times)) {
      const frame = frameAtTime(frames, time);
      if (frame) ids.push(frame.id);
    }
  }
  return uniqueStrings(ids);
}

function basePlan(classification, patch = {}) {
  return {
    version: 1,
    can_retry: false,
    fallback_allowed: true,
    mode: MODE,
    code: classification.code,
    retry_from: classification.sub_stage || '',
    repair_action: '',
    reuse: [],
    discard: [],
    user_message: classification.message || '无法判断失败原因，暂不自动重试。',
    executor_options: {},
    ...patch,
  };
}

function retryPlan(classification, repairAction, retryFrom, patch = {}) {
  return basePlan(classification, {
    can_retry: true,
    retry_from: retryFrom || classification.sub_stage || '',
    repair_action: repairAction,
    user_message: patch.user_message || '将复用已完成内容，并从失败步骤继续修复。',
    ...patch,
  });
}

function createCreativeWorkflowRetryPlan(input = {}) {
  const workflow = objectOrEmpty(input.workflow);
  const hasProject = input.project && typeof input.project === 'object' && !Array.isArray(input.project);
  const project = objectOrEmpty(input.project);
  const classification = classifyCreativeWorkflowFailure(input);
  const code = classification.code;
  const subStage = classification.sub_stage;

  if (ENVIRONMENT_CODES.has(code)) {
    return basePlan(classification, {
      can_retry: false,
      fallback_allowed: false,
      user_message: code === 'ffmpeg_not_configured'
        ? '无法自动重试：ffmpeg 不可用，请先到设置中心修复系统环境。'
        : '无法自动重试：Playwright Chromium 不可用，请先到设置中心修复系统环境。',
    });
  }

  if (code === 'unknown_project_failure' && classification.source !== 'checkpoint') {
    return basePlan(classification, {
      can_retry: false,
      fallback_allowed: false,
      code: 'unknown_project_failure',
      user_message: '无法定位可恢复步骤，暂不支持自动重试。',
    });
  }

  if (code === 'content_graph_invalid' || subStage === 'content_graph') {
    const rawResponse = contentGraphRawResponse(classification.diagnostics);
    const sceneSpec = sceneSpecFromWorkflow(workflow, project);
    if (rawResponse && parseContentGraphResponse(rawResponse, sceneSpec || {}).success) {
      return basePlan(classification, {
        code: 'content_graph_ok',
        user_message: 'content graph JSON 可被宽容解析，无需生成恢复计划。',
      });
    }
    if (retryContentGraphAlreadyFailed(workflow) && sceneSpec) {
      return retryPlan(classification, 'fallback_scene_spec_graph', 'content_graph', {
        reuse: ['source', 'research', 'brief', 'audio'],
        discard: ['content_graph', 'frame_html', 'render_outputs'],
        user_message: 'content graph 重试仍失败，将使用脚本结构恢复内容图后继续生成。',
      });
    }
    return retryPlan(classification, 'retry_content_graph', 'content_graph', {
      reuse: ['source', 'research', 'brief', 'audio'],
      discard: ['content_graph', 'frame_html', 'render_outputs'],
      user_message: '将重新生成 content graph，并复用前置产物继续后续步骤。',
    });
  }

  if (PLAYBACK_HTML_FAILURE_CODES.has(code)) {
    const frameIds = uniqueStrings([classification.frame_id]);
    return retryPlan(classification, 'retry_frame_html', 'frame_html', {
      reuse: ['source', 'research', 'brief', 'audio', 'content_graph'],
      discard: frameIds.length
        ? [...frameIds.map(frameId => `frames:${frameId}`), 'render_outputs']
        : ['frame_html', 'render_outputs'],
      executor_options: {
        regenerate_frame_html: true,
        ...(frameIds.length ? { frame_ids: frameIds } : {}),
      },
      user_message: '播放脚本运行失败，将重新生成对应镜头 HTML 并重新导出。',
    });
  }

  if (code === 'frame_html_shot_contract_invalid') {
    const frameIds = uniqueStrings([classification.frame_id]);
    return retryPlan(classification, 'retry_frame_html', 'frame_html', {
      reuse: ['source', 'research', 'brief', 'audio', 'content_graph'],
      discard: frameIds.length
        ? [...frameIds.map(frameId => `frames:${frameId}`), 'render_outputs']
        : ['frame_html', 'render_outputs'],
      executor_options: {
        regenerate_frame_html: true,
        ...(frameIds.length ? { frame_ids: frameIds } : {}),
      },
      user_message: '镜头运行时合同失败，将重新生成对应镜头 HTML 并重新导出。',
    });
  }

  if (
    code === 'provider_missing_text'
    || code === 'frame_html_invalid'
    || code === 'html_document_extract_failed'
    || code === 'html_validation_failed'
    || code === 'frame_html_content_mismatch'
    || code === 'layout_qa_failed'
  ) {
    return retryPlan(classification, 'retry_frame_html', 'frame_html', {
      reuse: ['source', 'research', 'brief', 'audio', 'content_graph'],
      discard: classification.frame_id ? [`frames:${classification.frame_id}`, 'render_outputs'] : ['frame_html', 'render_outputs'],
      executor_options: classification.frame_id ? { frame_id: classification.frame_id } : {},
      user_message: '将复用已完成内容，只重新生成失败帧并重新导出。',
    });
  }

  if (code === 'frame_layout_qa_unresolved') {
    const frameIds = unresolvedLayoutQaFrameIds(project, classification);
    return retryPlan(classification, 'retry_frame_html', 'frame_html', {
      reuse: ['source', 'research', 'brief', 'audio', 'content_graph'],
      discard: frameIds.length
        ? [...frameIds.map(frameId => `frames:${frameId}`), 'render_outputs']
        : ['frame_html', 'render_outputs'],
      executor_options: {
        regenerate_frame_html: true,
        ...(frameIds.length ? { frame_ids: frameIds } : {}),
      },
      user_message: '摄影机预览 QA 仍未通过，将只重新生成相关场景并重新导出。',
    });
  }

  if (code === 'timeline_duration_unreasonable') {
    if (!hasProject) {
      return basePlan(classification, {
        can_retry: false,
        fallback_allowed: false,
        user_message: classification.message || '口播或时间轴超过目标时长，但尚未生成 html-video 工程，无法自动恢复。请缩短旁白或调高目标时长后重新创建任务。',
      });
    }
    const analysis = analyzeTimelineMismatch({ project });
    const repairAction = analysis.repair_action || 'repair_timeline';
    return retryPlan(classification, repairAction, 'timeline_check', {
      reuse: repairAction === 'repair_script_and_timeline'
        ? ['source', 'research']
        : ['source', 'research', 'brief', 'audio', 'content_graph', 'frame_html'],
      discard: repairAction === 'repair_script_and_timeline'
        ? ['brief', 'audio', 'render_outputs', 'exports']
        : ['timeline', 'render_outputs', 'exports'],
      executor_options: { analysis },
      user_message: repairAction === 'repair_script_and_timeline'
        ? '旁白时长超过目标，将压缩旁白并重新生成音频与时间轴。'
        : '时间轴超过目标但音频未超时，将修复时间轴后重新渲染。',
    });
  }

  if (code === 'runtime_visual_asset_policy_violation') {
    const frameIds = uniqueStrings([classification.frame_id]);
    return retryPlan(classification, 'retry_frame_html', 'frame_html', {
      reuse: ['source', 'research', 'brief', 'audio', 'content_graph'],
      discard: frameIds.length
        ? [...frameIds.map(frameId => `frames:${frameId}`), 'render_outputs', 'exports']
        : ['frame_html', 'render_outputs', 'exports'],
      executor_options: {
        regenerate_frame_html: true,
        ...(frameIds.length ? { frame_ids: frameIds } : {}),
      },
      user_message: '镜头 HTML 引用了未登记图片或不允许的资源，将重新生成对应镜头并重新导出。',
    });
  }

  if (code === 'runtime_asset_policy_revalidation_required') {
    const frameIds = uniqueStrings([
      ...arrayOrEmpty(classification.diagnostic?.details?.frame_ids),
      ...arrayOrEmpty(classification.diagnostics?.find(item => item?.code === code)?.details?.frame_ids),
    ]);
    return retryPlan(classification, 'rerender_frames', 'render', {
      reuse: ['source', 'research', 'brief', 'audio', 'content_graph', 'frame_html'],
      discard: frameIds.map(frameId => `render:${frameId}`),
      executor_options: { frame_ids: frameIds },
      user_message: '运行时素材安全证明缺失或已过期，将重新渲染相关镜头后再合成。',
    });
  }

  if (code.startsWith('render_failed') || subStage === 'render') {
    const frameIds = failedRenderFrameIds(project, classification.frame_id);
    return retryPlan(classification, 'rerender_frames', 'render', {
      reuse: ['source', 'research', 'brief', 'audio', 'content_graph', 'frame_html'],
      discard: frameIds.map(frameId => `render:${frameId}`),
      executor_options: { frame_ids: frameIds },
      user_message: '将只重渲染失败镜头，并重新合成成片。',
    });
  }

  if (code === 'required_visual_asset_missing') {
    const frameIds = missingAssetFrameIds(project, classification);
    return retryPlan(classification, 'retry_frame_html', 'frame_html', {
      reuse: ['source', 'research', 'brief', 'audio', 'content_graph'],
      discard: frameIds.length
        ? [...frameIds.map(frameId => `frames:${frameId}`), 'render_outputs', 'exports', 'visual_inspect']
        : ['frame_html', 'render_outputs', 'exports', 'visual_inspect'],
      executor_options: {
        regenerate_frame_html: true,
        ...(frameIds.length ? { frame_ids: frameIds } : {}),
      },
      user_message: frameIds.length
        ? `必用视觉素材未进入画面，将重新生成 ${frameIds.length} 个相关镜头并重新渲染、合成。`
        : '必用视觉素材未进入画面，将重新生成镜头 HTML 并重新渲染、合成。',
    });
  }

  if (code === 'unregistered_visual_asset_reference') {
    const frameIds = unregisteredAssetFrameIds(classification);
    return retryPlan(classification, 'retry_frame_html', 'frame_html', {
      reuse: ['source', 'research', 'brief', 'audio', 'content_graph'],
      discard: frameIds.length
        ? [...frameIds.map(frameId => `frames:${frameId}`), 'render_outputs', 'exports', 'visual_inspect']
        : ['frame_html', 'render_outputs', 'exports', 'visual_inspect'],
      executor_options: {
        regenerate_frame_html: true,
        ...(frameIds.length ? { frame_ids: frameIds } : {}),
      },
      user_message: frameIds.length
        ? `最终 HTML 引用了未登记视觉素材，将重新生成 ${frameIds.length} 个相关镜头并重新导出。`
        : '最终 HTML 引用了未登记视觉素材，将重新生成镜头并重新导出。',
    });
  }

  if (code === 'visual_qa_warning') {    const frameIds = visualQaIssueFrameIds(project, classification);
    return retryPlan(classification, 'retry_frame_html', 'frame_html', {
      reuse: ['source', 'research', 'brief', 'audio', 'content_graph'],
      discard: frameIds.length
        ? [...frameIds.map(frameId => `frames:${frameId}`), 'render_outputs', 'exports', 'visual_inspect']
        : ['frame_html', 'render_outputs', 'exports', 'visual_inspect'],
      executor_options: {
        regenerate_frame_html: true,
        ...(frameIds.length ? { frame_ids: frameIds } : {}),
      },
      user_message: frameIds.length
        ? `视觉巡检发现开头或镜头边界白屏，将重新生成 ${frameIds.length} 个疑似问题镜头并重新渲染、合成、巡检。`
        : '视觉巡检发现开头或镜头边界白屏，将重新生成镜头 HTML 并重新渲染、合成、巡检。',
    });
  }

  if (code === 'duration_mismatch' || code === 'compose_failed' || code === 'render_output_missing_audio' || subStage === 'compose' || subStage === 'duration_verify') {
    return retryPlan(classification, 'recompose', 'compose', {
      reuse: ['source', 'research', 'brief', 'audio', 'content_graph', 'frame_html', 'render_outputs'],
      discard: ['exports'],
      user_message: '将复用已渲染镜头，只重新合成成片。',
    });
  }

  if (subStage === 'visual_inspect' || code === 'visual_inspect_failed') {
    return retryPlan(classification, 'rerun_visual_inspect', 'visual_inspect', {
      reuse: ['source', 'research', 'brief', 'audio', 'content_graph', 'frame_html', 'render_outputs', 'exports'],
      discard: ['visual_inspect'],
      user_message: '将复用成片文件，只重新执行视觉巡检。',
    });
  }

  if (subStage === 'validate_project' && (classification.source === 'checkpoint' || code === 'project_read_failed')) {
    return retryPlan(classification, 'restart_project', 'validate_project', {
      reuse: ['source', 'research', 'brief', 'audio'],
      discard: ['project'],
      user_message: '工程校验失败，将从工程阶段重新开始。',
    });
  }

  return basePlan(classification, {
    can_retry: false,
    fallback_allowed: false,
    code: 'unknown_project_failure',
    user_message: '无法定位可恢复步骤，暂不支持自动重试。',
  });
}

/**
 * scene_html 模式下把 beat 级 frame_ids 归并为 scene 级渲染条目键（scene:<scene_id>），
 * 与 renderCheckpointKey/frameHtmlPhase 的 scene node 键位对齐；
 * beat_mp4（缺省）原样返回，行为不变（硬约束 A/D）。
 */
function resolveRetryFrameIds(frameIds = [], { continuityMode = 'beat_mp4', beatToScene = {} } = {}) {
  if (continuityMode !== 'scene_html') return [...frameIds];
  const resolved = new Set();
  for (const id of frameIds) {
    if (String(id).startsWith('scene:')) {
      resolved.add(id);
      continue;
    }
    const sceneId = beatToScene[id];
    resolved.add(sceneId ? `scene:${sceneId}` : id);
  }
  return [...resolved];
}

const QA_REPAIRABLE_BY_FRAME = new Set([
  'asset_first_asset_missing',
  'asset_first_low_information',
  'asset_first_overlay_caption_overlap',
  'asset_first_boundary_refresh',
]);

// 模块 7：asset_first QA warning 的定向修复映射（只建立能力，不自动接入重试计划——
// 升阻断需在真实任务验证 retry_frame_html 有效后另行提交，见计划开放决策 2）。
// takeover 类路由问题不映射：同路由下重生成 HTML 得到同样决策，retry_frame_html 会无限循环。
// review P2-6：asset_missing 的 details.scene_id 才是真实语义（expected_in_frames 写的是 scene_id），
// 经 caller 提供的 sceneToFrameIds（scene_id => 该 scene 全部 beat 的 frame_ids，与 boundaryToFrameIds
// 同模式）解析；查不到返回 null，不再把 scene_id 直接当 frame_id 用（真实 checkpoint 键不会命中）。
function repairActionForQaIssue(issue = {}, { boundaryToFrameIds = {}, sceneToFrameIds = {} } = {}) {
  if (!QA_REPAIRABLE_BY_FRAME.has(issue.code)) return null;
  let frameIds = [];
  if (issue.code === 'asset_first_boundary_refresh') {
    const key = `${issue.details?.scene_id}@${issue.details?.boundary_sec}`;
    frameIds = boundaryToFrameIds[key] || [];
  } else if (issue.code === 'asset_first_asset_missing') {
    const sceneId = issue.details?.scene_id;
    frameIds = (sceneId && sceneToFrameIds[sceneId]) || [];
  } else if (issue.details?.beat_id) {
    frameIds = [issue.details.beat_id];
  }
  if (!frameIds.length) return null;
  return { type: 'retry_frame_html', frame_ids: frameIds, reason: issue.message || issue.code };
}

module.exports = {
  classifyCreativeWorkflowFailure,
  createCreativeWorkflowRetryPlan,
  resolveRetryFrameIds,
  repairActionForQaIssue,
};
