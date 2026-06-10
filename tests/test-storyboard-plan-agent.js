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
