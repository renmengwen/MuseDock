class CreativeWorkflowStageError extends Error {
  constructor(message, {
    stage = '',
    sub_stage = '',
    code = '',
    frame_id = '',
    project_dir = '',
    diagnostics = [],
    retryable = false,
    fallback_allowed = true,
  } = {}) {
    super(String(message || '创作阶段失败。'));
    this.name = 'CreativeWorkflowStageError';
    this.stage = String(stage || '');
    this.sub_stage = String(sub_stage || '');
    this.code = String(code || '');
    this.frame_id = String(frame_id || '');
    this.project_dir = String(project_dir || '');
    this.diagnostics = Array.isArray(diagnostics) ? diagnostics : [];
    this.retryable = retryable === true;
    this.fallback_allowed = fallback_allowed !== false;
  }
}

module.exports = {
  CreativeWorkflowStageError,
};
