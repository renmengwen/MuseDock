const assert = require('assert');

const {
  computeAutoScore,
  computeVisionScore,
  computeOverall,
  parseJsonLoose,
  summarizeRun,
  renderRunReport,
  renderHistory,
} = require('../scripts/quality-eval/index');

// computeAutoScore：时长在容差内且无质检问题 → 满分
const perfect = computeAutoScore({ durationSec: 62, targetSec: 60, inspectIssues: [] });
assert.equal(perfect.score, 100);
assert.equal(perfect.deductions.length, 0);

// 时长偏离 10%~25% 扣 8 分，>25% 扣 20 分
assert.equal(computeAutoScore({ durationSec: 72, targetSec: 60 }).score, 92);
assert.equal(computeAutoScore({ durationSec: 90, targetSec: 60 }).score, 80);

// 每个视觉质检问题扣 12 分，且有下限 0
const withIssues = computeAutoScore({
  durationSec: 60,
  targetSec: 60,
  inspectIssues: [{ code: 'low_motion', message: '' }, { code: 'too_many_blank_frames', message: '' }],
});
assert.equal(withIssues.score, 76);
assert.deepStrictEqual(withIssues.deductions.map(d => d.code), ['low_motion', 'too_many_blank_frames']);
const floored = computeAutoScore({
  durationSec: 200,
  targetSec: 60,
  inspectIssues: Array.from({ length: 10 }, () => ({ code: 'x' })),
});
assert.equal(floored.score, 0);

// 读不到时长扣 10 分
assert.equal(computeAutoScore({ durationSec: null, targetSec: 60 }).score, 90);

// computeVisionScore：五个维度 0-10，总分 ×2；缺维度或越界返回 null
assert.equal(computeVisionScore({ readability: 8, layout: 7, richness: 6, coherence: 9, aesthetics: 7 }), 74);
assert.equal(computeVisionScore({ readability: 8, layout: 7 }), null);
assert.equal(computeVisionScore({ readability: 11, layout: 7, richness: 6, coherence: 9, aesthetics: 7 }), null);

// computeOverall：失败任务恒为 0；有视觉分按 0.6/0.4 加权；没有则用 auto
assert.equal(computeOverall({ status: 'failed', autoScore: 100, visionScore: 100 }), 0);
assert.equal(computeOverall({ status: 'done', autoScore: 80, visionScore: 70 }), 76);
assert.equal(computeOverall({ status: 'done', autoScore: 80, visionScore: null }), 80);

// parseJsonLoose：容忍模型输出里带说明文字或代码围栏
assert.deepStrictEqual(parseJsonLoose('{"a":1}'), { a: 1 });
assert.deepStrictEqual(parseJsonLoose('结果如下：\n```json\n{"a":1}\n```'), { a: 1 });
assert.equal(parseJsonLoose('完全不是 JSON'), null);

// summarizeRun：成片率只按已完结（done/failed/timeout）计算
const run = {
  label: 'unit',
  git_rev: 'abc1234',
  started_at: '2026-07-07T10:00:00.000Z',
  topics: [
    { id: 'a', label: 'A', status: 'done', auto_score: 90, vision_score: 80, overall: 86, target_sec: 60, duration_sec: 61, wall_sec: 600, workflow_id: '1' },
    { id: 'b', label: 'B', status: 'failed', overall: 0, failure_stage: 'project', failure_message: '生成 HTML 失败', workflow_id: '2' },
    { id: 'c', label: 'C', status: 'pending' },
  ],
};
const summary = summarizeRun(run);
assert.equal(summary.topic_count, 3);
assert.equal(summary.finished_count, 2);
assert.equal(summary.done_count, 1);
assert.equal(summary.success_rate, 50);
assert.equal(summary.avg_overall, 86);
assert.equal(summary.avg_auto, 90);
assert.equal(summary.avg_vision, 80);

// renderRunReport：包含表格行、失败明细
const report = renderRunReport(run);
assert.ok(report.includes('# 质量评测报告：unit'));
assert.ok(report.includes('| a（A） | done | 61s / 60s |'));
assert.ok(report.includes('成片率：50%'));
assert.ok(report.includes('**b**（failed）：[project] 生成 HTML 失败'));

// renderHistory：按时间排序输出曲线表
const history = renderHistory([
  { ...run, label: 'newer', started_at: '2026-07-08T10:00:00.000Z' },
  run,
]);
const unitIndex = history.indexOf('| unit |');
const newerIndex = history.indexOf('| newer |');
assert.ok(unitIndex > -1 && newerIndex > -1 && unitIndex < newerIndex);

console.log('test-quality-eval-scoring: all assertions passed');
