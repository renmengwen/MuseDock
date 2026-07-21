// P1-6：视觉质检 warnings 非阻断透出——投影/汇总单元断言
const assert = require('assert/strict');

const {
  summarizeVisualQaWarnings,
  buildFreeformVisualInspectProjection,
} = require('../server/services/agent/agentRunsFreeformWorkflow');
const workflows = require('../server/services/creative/creativeWorkflows');

(() => {
  // 无 warnings：输出与现状一致（回归）
  const clean = buildFreeformVisualInspectProjection({ success: true, issues: [] });
  assert.equal(clean.status, 'passed');
  assert.equal(clean.message, '视觉质检通过。');
  assert.deepEqual(clean.warnings, []);
  assert.deepEqual(clean.issues, []);

  // 真实质检可能以 issues 表达非阻断问题而不产生 warnings；不能投影成纯通过。
  const nonBlockingIssues = [{ code: 'repeated_frames', message: '静态画面重复。', details: { count: 3 } }];
  const withIssues = buildFreeformVisualInspectProjection({
    success: false,
    issues: nonBlockingIssues,
    warnings: [],
  });
  assert.equal(withIssues.status, 'passed_with_warnings');
  assert.equal(withIssues.message, '视觉质检发现 1 项问题，成片仍可使用。');
  assert.deepEqual(withIssues.issues, nonBlockingIssues);
  assert.deepEqual(withIssues.warnings, []);

  // 带 warnings：status 用 passed_with_warnings，message 不是纯"视觉质检通过。"，warnings 投影含 code/message/定位字段
  const report = {
    success: true,
    issues: [],
    warnings: [
      {
        code: 'sample_warning_a',
        severity: 'warning',
        message: '抽样观察到 2 个 beat 画面异常。',
        details: { beats: [{ beat_id: 'b1', extra: 't1' }, { beat_id: 'b2', extra: 't2' }] },
      },
      {
        code: 'asset_first_boundary_refresh',
        message: '同 scene 边界 3.2s 前后画面差异 0.41，疑似整帧重刷。',
        details: { scene_id: 'scene_02', boundary_sec: 3.2, score: 0.41 },
      },
    ],
  };
  const projected = buildFreeformVisualInspectProjection(report);
  assert.equal(projected.status, 'passed_with_warnings');
  assert.equal(projected.message, '视觉质检通过（2 条观察告警）。');
  assert.notEqual(projected.message, '视觉质检通过。');
  assert.equal(projected.warnings.length, 2);
  assert.equal(projected.warnings[0].code, 'sample_warning_a');
  assert.deepEqual(projected.warnings[0].details.beat_ids, ['b1', 'b2']);
  assert.equal(projected.warnings[1].details.scene_id, 'scene_02');
  assert.equal(projected.warnings[1].details.boundary_sec, 3.2);
  // details 只保留定位字段（score 等非定位字段不进投影）
  assert.equal(projected.warnings[1].details.score, undefined);

  // 摘要函数对脏输入健壮
  assert.deepEqual(summarizeVisualQaWarnings(null), []);
  assert.deepEqual(summarizeVisualQaWarnings([null, 'x']), []);
})();

(() => {
  // creativeWorkflows retry 汇总：visual_report / visualInspectResult 两种字段名都能带出 warnings
  const withWarnings = workflows.buildHtmlVideoLiteProjectStageResult({
    project: {},
    projectDir: '/tmp/proj',
    renderResult: { output_path: '/tmp/proj/exports/output.mp4' },
    visualInspectResult: {
      success: true,
      issues: [],
      metrics: {},
      report_path: 'inspect/visual-report.json',
      warnings: [{ code: 'asset_first_caption_invisible', message: '1.5s 字幕应显示但底部字幕区无可读内容。', details: { time: 1.5, variance: 0.001 } }],
    },
  });
  const inspect = withWarnings.hyperframes_freeform.visual_inspect;
  assert.equal(inspect.status, 'done', 'warnings 非阻断，status 不降级');
  assert.equal(inspect.warnings.length, 1);
  assert.equal(inspect.warnings[0].code, 'asset_first_caption_invisible');
  assert.equal(inspect.warnings[0].details.time, 1.5);
  assert.match(inspect.message, /1 条观察告警/);

  // 无 warnings 回归：不引入 warnings 噪声、message 维持现状
  const clean = workflows.buildHtmlVideoLiteProjectStageResult({
    project: {},
    projectDir: '/tmp/proj',
    renderResult: { output_path: '/tmp/proj/exports/output.mp4' },
    visualInspectResult: { success: true, issues: [], metrics: {} },
  });
  const cleanInspect = clean.hyperframes_freeform.visual_inspect;
  assert.equal(cleanInspect.status, 'done');
  assert.deepEqual(cleanInspect.warnings, []);
  assert.equal(cleanInspect.message, 'html-video production 视觉质检完成。');
})();

console.log('agent runs freeform visual inspect projection tests passed');
