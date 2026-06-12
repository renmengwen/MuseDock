const assert = require('assert');

const agent = require('../server/services/hyperframesFreeformAgent');

function assertProjectParseFails(response, messagePattern = /解析|不支持/) {
  const result = agent.parseFreeformProjectResponse(JSON.stringify(response));
  assert.equal(result.success, false);
  assert.match(result.message, messagePattern);
}

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
  assert.match(messages[1].content, /data-duration/);
  assert.match(messages[1].content, /Microsoft YaHei/);
  assert.match(messages[1].content, /inter/);
  assert.match(messages[1].content, /首屏不得一次性展示所有信息/);
  assert.match(messages[1].content, /关键短语、能力标签、步骤标签、卖点词或主题关键词/);
  assert.match(messages[1].content, /不要使用固定模板词/);
  assert.match(messages[1].content, /window\.__timelines\["main"\]/);
  assert.match(messages[1].content, /tl\.from|tl\.to|tl\.fromTo/);
  assert.match(messages[1].content, /每个主要场景至少/);

  const parsed = agent.parseFreeformProjectResponse(JSON.stringify({
    files: {
      'index.html': '<html></html>',
      'design.md': '# Design',
      'hyperframes.json': '{}',
      'package.json': '{"private":true}',
      'meta.json': '{}',
    },
    summary: '工程已生成',
  }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.files['index.html'], '<html></html>');
  assert.deepEqual(Object.keys(parsed.files).sort(), [
    'design.md',
    'hyperframes.json',
    'index.html',
    'meta.json',
    'package.json',
  ]);

  const markdownParsed = agent.parseFreeformProjectResponse('```json\n{"files":{"index.html":"<html></html>"}}\n```');
  assert.equal(markdownParsed.success, true);

  const spacedFenceParsed = agent.parseFreeformProjectResponse('``` json\n{"files":{"index.html":"<html></html>"}}\n```');
  assert.equal(spacedFenceParsed.success, true);

  const failed = agent.parseFreeformProjectResponse('not json');
  assert.equal(failed.success, false);
  assert.match(failed.message, /解析/);

  assertProjectParseFails({ files: null });
  assertProjectParseFails({ files: [] });
  assertProjectParseFails({ files: { 'index.html': {} } });
  assertProjectParseFails({ files: { 'index.html': 123 } });
  assertProjectParseFails({ files: { 'index.html': '' } });
  assertProjectParseFails({ files: { 'index.html': '   ' } });
  assertProjectParseFails({ files: { 'index.html': '<html></html>', 'evil.txt': 'x' } });
  assertProjectParseFails({ files: { 'index.html': '<html></html>', '../evil.txt': 'x' } });
  assertProjectParseFails({ files: { 'index.html': '<html></html>', 'output.mp4': 'x' } });
  assertProjectParseFails({ files: { 'index.html': '<html></html>', 'contact_sheet.jpg': 'x' } });

  const longMessages = agent.buildFreeformProjectMessages({
    run: { huge: 'a'.repeat(30000) },
    brief: { title: '超长简报', design_md: 'b'.repeat(30000) },
  });
  const truncatedBlocks = longMessages[1].content.match(/\{\n  "truncated": true,[\s\S]*?\n\}/g) || [];
  assert.ok(truncatedBlocks.length >= 2);
  for (const block of truncatedBlocks) {
    const value = JSON.parse(block);
    assert.equal(value.truncated, true);
    assert.equal(typeof value.preview, 'string');
    assert.ok(value.preview.length < 12000);
  }
}

run().then(() => {
  console.log('hyperframes freeform agent tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
