const assert = require('assert/strict');

const storyboardPlanAgent = require('../server/services/storyboardPlanAgent');

(async () => {
  const messages = storyboardPlanAgent.buildStoryboardPlanMessages({
    transcriptText: '先别急着买最贵的模型。',
    commentsText: '想看工作流怎么搭。',
    promptOptions: {
      target_duration_sec: 60,
      style: '实用教程',
    },
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.match(messages[0].content, /导演规划 Agent/);
  assert.match(messages[0].content, /只输出 JSON/);
  assert.match(messages[1].content, /target_duration_sec: 60/);
  assert.match(messages[0].content, /4\.5 字\/秒/);
  assert.match(messages[0].content, /单段口播字数上限/);
  assert.match(messages[1].content, /storyboard_plan/);
  assert.match(messages[1].content, /narration_text/);

  const camelCaseMessages = storyboardPlanAgent.buildStoryboardPlanMessages({
    promptOptions: { targetDurationSec: 75 },
  });
  assert.match(camelCaseMessages[1].content, /target_duration_sec: 75/);

  const normalized = storyboardPlanAgent.normalizeStoryboardPlan({
    target_duration_sec: 60,
    scenes: [
      {
        index: 9,
        target_duration_sec: 4.7,
        narration_text: '先别急着买最贵的模型。',
        headline: '先看工作流',
        visual_intent: '用对比画面说明模型不是全部',
        visual_type_hint: 'split_compare',
      },
    ],
  });

  assert.equal(normalized.status, 'planned');
  assert.equal(normalized.target_duration_sec, 60);
  assert.equal(normalized.scenes[0].index, 1);
  assert.equal(normalized.scenes[0].target_duration_sec, 4.7);
  assert.equal(normalized.scenes[0].narration_text, '先别急着买最贵的模型。');
  assert.equal(normalized.scenes[0].visual_type_hint, 'split_compare');
  assert.equal(normalized.narration_budget.status, 'ok');
  assert.equal(normalized.narration_budget.scenes[0].max_recommended_chars, 21);

  const overBudgetPlan = storyboardPlanAgent.normalizeStoryboardPlan({
    target_duration_sec: 4,
    scenes: [
      {
        target_duration_sec: 2,
        narration_text: '这是一段明显太长太啰嗦太拖沓的口播文案。',
        headline: '太长',
        visual_intent: '测试超限',
        visual_type_hint: 'text_card',
      },
    ],
  });
  assert.equal(overBudgetPlan.narration_budget.status, 'too_long');
  assert.equal(overBudgetPlan.narration_budget.scenes[0].status, 'too_long');

  let capturedPayload = null;
  const planned = await storyboardPlanAgent.createStoryboardPlan({
    transcriptText: '先别急着买最贵的模型。',
    commentsText: '想看工作流怎么搭。',
    promptOptions: { target_duration_sec: 60 },
    aiTextModel: {
      async callTextModel(payload) {
        capturedPayload = payload;
        return {
          success: true,
          text: JSON.stringify({
            target_duration_sec: 60,
            scenes: [
              {
                index: 9,
                target_duration_sec: 4.7,
                narration_text: '先别急着买最贵的模型。',
                headline: '先看工作流',
                visual_intent: '用对比画面说明模型不是全部',
                visual_type_hint: 'split_compare',
              },
            ],
          }),
        };
      },
    },
  });

  assert.equal(capturedPayload.stream, true);
  assert.equal(capturedPayload.maxRetries, 3);
  assert.equal(planned.success, true);
  assert.equal(planned.storyboard_plan.status, 'planned');
  assert.equal(planned.storyboard_plan.scenes.length, 1);
  assert.equal(planned.storyboard_plan.narration_budget.status, 'ok');
  assert.equal(planned.parse.success, true);

  const invalid = await storyboardPlanAgent.createStoryboardPlan({
    transcriptText: '先别急着买最贵的模型。',
    aiTextModel: {
      async callTextModel() {
        return { success: true, text: 'not json' };
      },
    },
  });

  assert.equal(invalid.success, false);
  assert.equal(invalid.parse.success, false);

  console.log('storyboard plan agent tests passed');
})();
