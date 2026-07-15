const { CreativeWorkflowStageError } = require('../creative-video/errors');
const htmlVideoProjectApi = require('../creative-video/htmlVideoProjectApi');
const { createDiagnostic, normalizeDiagnostics } = htmlVideoProjectApi;
const { safeString, STAGE_LABELS } = require('./workflowStore');

function ensureSuccess(result, fallbackMessage, context = {}) {
  if (!result || result.success === false) {
    const diagnostics = normalizeDiagnostics(selectFailureDiagnostics(result));
    const failureDiagnostic = selectFailureDiagnostic(diagnostics);
    throw new CreativeWorkflowStageError(safeString(result && result.message) || fallbackMessage, {
      stage: context.stage || '',
      sub_stage: failureDiagnostic.sub_stage || context.sub_stage || '',
      code: failureDiagnostic.code || context.code || '',
      frame_id: failureDiagnostic.frame_id || '',
      project_dir: result?.project_dir || result?.html_video_project_path || context.project_dir || '',
      diagnostics,
      retryable: result?.retryable === true || failureDiagnostic.retryable === true,
      fallback_allowed: result?.fallback_allowed !== false && failureDiagnostic.fallback_allowed !== false,
    });
  }
  return result;
}

function selectFailureDiagnostics(result = {}) {
  const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
  if (diagnostics.length > 0) return diagnostics;
  const htmlVideoDiagnostics = Array.isArray(result?.html_video_diagnostics) ? result.html_video_diagnostics : [];
  return htmlVideoDiagnostics.length > 0 ? htmlVideoDiagnostics : [];
}

function selectFailureDiagnostic(diagnostics = []) {
  const items = Array.isArray(diagnostics) ? diagnostics : [];
  if (!items.length) return {};
  const nonWarnings = items.filter(item => item?.severity !== 'warning');
  if (nonWarnings.length) {
    return nonWarnings.find(item => item?.retryable === true || safeString(item?.repair_action))
      || nonWarnings[nonWarnings.length - 1]
      || {};
  }
  return items[0] || {};
}

function createLastFailureFromError(error, stageId, updatedAt) {
  const diagnostics = normalizeDiagnostics(error?.diagnostics || []);
  const failureDiagnostic = selectFailureDiagnostic(diagnostics);
  return {
    stage: safeString(error?.stage) || stageId,
    sub_stage: safeString(error?.sub_stage) || safeString(failureDiagnostic.sub_stage),
    code: safeString(error?.code) || safeString(failureDiagnostic.code),
    frame_id: safeString(error?.frame_id) || safeString(failureDiagnostic.frame_id),
    project_dir: safeString(error?.project_dir),
    message: safeString(error?.message) || `${STAGE_LABELS[stageId]}失败。`,
    diagnostics,
    updated_at: updatedAt,
  };
}

function normalizeProjectStageSummary(summary = {}) {
  const input = summary && typeof summary === 'object' ? summary : {};
  const next = {
    id: safeString(input.id),
    status: safeString(input.status),
    message: safeString(input.message),
    artifacts: Array.isArray(input.artifacts)
      ? input.artifacts
      : input.artifacts && typeof input.artifacts === 'object'
      ? input.artifacts
      : {},
    diagnostics: normalizeDiagnostics(input.diagnostics || []),
  };
  return next.id ? next : null;
}

function upsertProjectStageSummary(record, summary) {
  const next = normalizeProjectStageSummary(summary);
  if (!next) return record;
  const existing = Array.isArray(record.project_substages) ? record.project_substages : [];
  const index = existing.findIndex(item => item?.id === next.id);
  record.project_substages = index >= 0
    ? existing.map((item, itemIndex) => (itemIndex === index ? next : item))
    : [...existing, next];
  return record;
}

function checkpointStageSummaries(generationCheckpoint = {}) {
  const stages = generationCheckpoint?.stages;
  if (Array.isArray(stages)) return stages;
  if (!stages || typeof stages !== 'object') return [];
  return Object.entries(stages).map(([id, stage]) => checkpointStageSummary(id, stage));
}

function checkpointDiagnostic(code, sub_stage, frame_id = '') {
  return safeString(code) ? createDiagnostic({ code, sub_stage, frame_id }) : null;
}

function compactFrameStageSummary(id, stage = {}, sub_stage, pathKey, kind) {
  const frames = stage?.frames && typeof stage.frames === 'object' ? stage.frames : {};
  const artifacts = [];
  const diagnostics = [];
  let hasDone = false;
  let hasFailed = false;
  for (const [frameId, frame] of Object.entries(frames)) {
    if (frame?.status === 'done') {
      hasDone = true;
      if (safeString(frame[pathKey])) {
        artifacts.push({
          kind,
          frame_id: frameId,
          path: safeString(frame[pathKey]),
          ...(safeString(frame.output_hash) ? { hash: safeString(frame.output_hash) } : {}),
        });
      }
    } else if (frame?.status === 'failed') {
      hasFailed = true;
      const diagnostic = checkpointDiagnostic(frame.diagnostic_code, sub_stage, frameId);
      if (diagnostic) diagnostics.push(diagnostic);
    }
  }
  return {
    id,
    status: hasFailed ? 'failed' : hasDone ? 'done' : safeString(stage?.status),
    artifacts,
    diagnostics,
  };
}

function checkpointStageSummary(id, stage = {}) {
  if (id === 'content_graph') {
    return {
      id,
      status: safeString(stage?.status),
      artifacts: safeString(stage?.path) ? {
        kind: 'content_graph',
        path: safeString(stage.path),
        ...(safeString(stage.output_hash) ? { hash: safeString(stage.output_hash) } : {}),
      } : {},
      diagnostics: [checkpointDiagnostic(stage?.diagnostic_code, 'content_graph')].filter(Boolean),
    };
  }
  if (id === 'frame_html') {
    return compactFrameStageSummary(id, stage, 'frame_html', 'html_path', 'frame_html');
  }
  if (id === 'render') {
    return compactFrameStageSummary(id, stage, 'render', 'mp4_path', 'render_frame');
  }
  if (id === 'compose') {
    return {
      id,
      status: safeString(stage?.status),
      artifacts: [
        safeString(stage?.output_path) ? { kind: 'compose_output', path: safeString(stage.output_path) } : null,
        safeString(stage?.output_audio_path) ? { kind: 'compose_audio_output', path: safeString(stage.output_audio_path) } : null,
      ].filter(Boolean),
      diagnostics: [checkpointDiagnostic(stage?.diagnostic_code, 'compose')].filter(Boolean),
    };
  }
  if (id === 'duration_verify') {
    return {
      id,
      status: safeString(stage?.status),
      artifacts: {
        kind: 'duration_verify',
        expected_duration_sec: stage?.expected_duration_sec ?? null,
        actual_duration_sec: stage?.actual_duration_sec ?? null,
      },
      diagnostics: stage?.status === 'failed'
        ? [checkpointDiagnostic(stage?.diagnostic_code || 'duration_mismatch', 'duration_verify')].filter(Boolean)
        : [],
    };
  }
  if (id === 'visual_inspect') {
    return {
      id,
      status: safeString(stage?.status),
      artifacts: safeString(stage?.report_path) ? { kind: 'visual_report', path: safeString(stage.report_path) } : {},
      diagnostics: [checkpointDiagnostic(stage?.diagnostic_code, 'visual_inspect')].filter(Boolean),
    };
  }
  return {
    id,
    status: stage?.status || '',
    message: stage?.message || '',
    artifacts: stage?.artifacts && typeof stage.artifacts === 'object' ? stage.artifacts : {},
    diagnostics: stage?.diagnostics || [],
  };
}

function syncProjectStageSummariesFromCheckpoint(record, generationCheckpoint) {
  for (const summary of checkpointStageSummaries(generationCheckpoint)) {
    upsertProjectStageSummary(record, summary);
  }
  return record;
}

async function emitTaskContextEvent(taskContext, event) {
  if (!taskContext || typeof taskContext.emit !== 'function') {
    return;
  }
  try {
    await taskContext.emit(event);
  } catch {
    // 后台任务事件是辅助状态通道，不能改变主 workflow 阶段成败。
  }
}

module.exports = {
  ensureSuccess,
  selectFailureDiagnostics,
  selectFailureDiagnostic,
  createLastFailureFromError,
  normalizeProjectStageSummary,
  upsertProjectStageSummary,
  checkpointStageSummaries,
  checkpointDiagnostic,
  compactFrameStageSummary,
  checkpointStageSummary,
  syncProjectStageSummariesFromCheckpoint,
  emitTaskContextEvent,
};
