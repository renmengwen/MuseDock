const assert = require('assert');

const agent = require('../server/services/hyperframesFreeformAgent');

async function run() {
  const messages = agent.buildFreeformProjectMessages({
    run: {
      rewrite_script: '这是一段口播。',
      storyboard_plan: { scenes: [{ headline: '开场', narration_text: '你好。' }] },
    },
    brief: {
      title: '测试短片',
      design_md: '# Design\nUse black and gold.',
    },
    skillContext: 'Use HyperFrames. Run lint validate inspect render.',
    options: { aspectRatio: '16:9', targetDurationSec: 30, stylePrompt: '高级科技纪录片' },
  });

  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /HyperFrames 工程生成 Agent/);
  assert.match(messages[1].content, /高级科技纪录片/);
  assert.match(messages[1].content, /Use HyperFrames/);
  assert.match(messages[1].content, /index.html/);
  assert.match(messages[1].content, /design.md/);

  const parsed = agent.parseFreeformProjectResponse(JSON.stringify({
    files: {
      'index.html': '<html></html>',
      'design.md': '# Design',
      'hyperframes.json': '{}',
      'package.json': '{"private":true}',
    },
    summary: '工程已生成',
  }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.files['index.html'], '<html></html>');

  const markdownParsed = agent.parseFreeformProjectResponse('```json\n{"files":{"index.html":"<html></html>"}}\n```');
  assert.equal(markdownParsed.success, true);

  const failed = agent.parseFreeformProjectResponse('not json');
  assert.equal(failed.success, false);
  assert.match(failed.message, /解析/);
}

run().then(() => {
  console.log('hyperframes freeform agent tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
