// 显式本地模型验收，不进入常规测试；无需云端 API。
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { callTtsModel } = require('../server/services/ai/aiTtsModel');
const { srtText } = require('../server/services/creative/shared/captionLayout');

async function run() {
  if (!process.argv.includes('--live')) { console.log('跳过真实 IndexTTS 验收；显式传入 --live 执行。'); return; }
  const result = await callTtsModel({ text: '今天阳光很好，我们一起出发。', language: 'zh-CN', env: {},
    onProgress: ({ message }) => console.log(message) });
  assert.equal(result.success, true, result.message);
  const evidence = result.alignedSubtitles;
  assert.equal(evidence.ttsNativeSubtitles, false);
  assert.equal(evidence.timingSource, 'firered_aed_ctc_forced_alignment');
  assert.ok(evidence.sentences.length > 0 && evidence.words.length > 0);
  const directory = path.join(require('../server/dataRoot'), 'data/verification/indextts');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'sample.wav'), result.audioBuffer);
  await fs.writeFile(path.join(directory, 'timestamps.json'), JSON.stringify(evidence, null, 2));
  await fs.writeFile(path.join(directory, 'sample.srt'), srtText(evidence.sentences));
  console.log(JSON.stringify({ success: true, durationMs: evidence.durationMs, words: evidence.words.length,
    sentences: evidence.sentences.length, lowConfidenceWordCount: evidence.lowConfidenceWordCount, directory }));
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
