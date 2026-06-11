const assert = require('assert/strict');

const budget = require('../server/services/storyboardNarrationBudget');

function run() {
  assert.equal(budget.countNarrationChars('  先 学 AI。 '), 5);
  assert.equal(budget.estimateNarrationDuration('123456789', 4.5), 2);

  const report = budget.buildNarrationBudget({
    target_duration_sec: 10,
    scenes: [
      {
        index: 1,
        target_duration_sec: 2,
        narration_text: '123456789012345',
      },
      {
        index: 2,
        target_duration_sec: 8,
        narration_text: '123456789',
      },
    ],
  });

  assert.equal(report.status, 'too_long');
  assert.equal(report.target_duration_sec, 10);
  assert.equal(report.chars_per_second, 4.5);
  assert.equal(report.total_narration_chars, 24);
  assert.equal(report.estimated_total_duration_sec, 5.3);
  assert.equal(report.scenes[0].status, 'too_long');
  assert.equal(report.scenes[0].max_recommended_chars, 9);
  assert.equal(report.scenes[0].estimated_duration_sec, 3.3);
  assert.equal(report.scenes[1].status, 'ok');

  const totalTooLong = budget.buildNarrationBudget({
    target_duration_sec: 4,
    scenes: [
      { index: 1, target_duration_sec: 4, narration_text: '123456789012' },
      { index: 2, target_duration_sec: 4, narration_text: '123456789012' },
    ],
  });
  assert.equal(totalTooLong.status, 'too_long');
  assert.equal(totalTooLong.over_budget_sec, 1.3);
}

run();
console.log('storyboard narration budget tests passed');
