const assert = require('assert');
const timeline = require('../server/services/tts/ttsTimeline');

function run() {
  assert.deepStrictEqual(
    timeline.splitScriptIntoSentences('第一句。第二句！第三句？第四句\n第五句'),
    ['第一句。', '第二句！', '第三句？', '第四句', '第五句'],
  );

  assert.deepStrictEqual(
    timeline.splitScriptIntoSentences('  开头没有标点 \n\n  还有一句。'),
    ['开头没有标点', '还有一句。'],
  );

  assert.deepStrictEqual(
    timeline.splitScriptIntoSentences('开头：\n如果你最近总听到 Vibe Coding。\n\n第一部分：这个词从哪来？\n正文：以前写代码，你要先懂语法、懂框架。'),
    ['如果你最近总听到 Vibe Coding。', '以前写代码，你要先懂语法、懂框架。'],
  );

  const captions = timeline.buildCaptionsFromSegments([
    { index: 1, text: '第一句。', duration: 1.25, path: 'segment-001.wav' },
    { index: 2, text: '第二句！', duration: 2.5, path: 'segment-002.wav' },
  ]);

  assert.deepStrictEqual(captions, [
    { index: 1, start: 0, end: 1.25, duration: 1.25, text: '第一句。' },
    { index: 2, start: 1.25, end: 3.75, duration: 2.5, text: '第二句！' },
  ]);

  assert.deepStrictEqual(timeline.buildCaptionsFromSegments([]), []);
}

try {
  run();
  console.log('tts timeline tests passed');
} catch (error) {
  console.error(error);
  process.exit(1);
}
