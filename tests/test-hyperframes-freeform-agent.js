const assert = require('assert');

const agent = require('../server/services/hyperframes/hyperframesFreeformAgent');

async function run() {
  const briefMessages = agent.buildFreeformBriefMessages({
    run: { result: { rewrite_script: '测试口播' } },
    skillContext: 'Use HyperFrames.',
  });
  assert.match(briefMessages[1].content, /audio_direction/);
  assert.match(briefMessages[1].content, /voice/);
  assert.match(briefMessages[1].content, /style_prompt/);
  assert.match(briefMessages[1].content, /narration 不要输出完整口播/);
  assert.match(briefMessages[1].content, /storyboard\.scenes\[\]\.narration_text 承载实际配音文本/);
  assert.match(briefMessages[1].content, /紧张|深呼吸|语速|停顿|长叹/);
  assert.doesNotMatch(briefMessages[1].content, /narration_text 可以.*括号标签/);
  assert.match(briefMessages[1].content, /narration_text 和 captions\.text 只能包含观众可见、可朗读的正文/);

  const parsed = agent.parseFreeformBriefResponse(JSON.stringify({ title: '测试短片' }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.brief.title, '测试短片');

  const failed = agent.parseFreeformBriefResponse('not json');
  assert.equal(failed.success, false);
  assert.match(failed.message, /解析/);

  const longMessages = agent.buildFreeformBriefMessages({
    run: { huge: 'a'.repeat(30000) },
  });
  const truncatedBlocks = longMessages[1].content.match(/\{\n  "truncated": true,[\s\S]*?\n\}/g) || [];
  assert.ok(truncatedBlocks.length >= 1);
  const value = JSON.parse(truncatedBlocks[0]);
  assert.equal(value.truncated, true);
  assert.equal(typeof value.preview, 'string');
  assert.ok(value.preview.length < 12000);
}

run().then(() => {
  console.log('hyperframes freeform agent tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
