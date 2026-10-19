const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { buildNarrationReview } = require('../server/services/ai/narrationReview');
const { wav } = require('./test-illustrated-media');
const { validateAlignment, alignIndexTtsAudio } = require('../server/services/ai/indexTts');
const router = require('../server/routes/creativeWorkflows');

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'narration-review-'));
  const audio = wav(1000), file = path.join(root, 'provider-audio.bin');
  await fs.writeFile(file, audio);
  const asr = { provider: 'firered', timingSource: 'firered_aed_ctc_forced_alignment', text: '你好世间',
    words: Array.from('你好世间', (text, i) => ({ text, startMs: i * 200, endMs: i * 200 + 180, confidence: .9 })) };
  const report = buildNarrationReview(asr, '你好世界。', 1000, 'a'.repeat(64));
  assert.equal(report.status, 'unverified'); assert.equal(report.differences.length, 1);
  assert.equal(report.differences[0].expected, '界'); assert.equal(report.differences[0].recognized, '间');
  assert.equal(report.differences[0].startMs, 600); assert.equal(report.recognizedText, asr.text);
  assert.throws(() => validateAlignment(asr, '你好世界。', 1000, 'a'.repeat(64)), /不一致/);
  await assert.rejects(alignIndexTtsAudio(file, 1000, '你好世界。', {}, { workDir: root,
    ensureLocalAsrService: async () => {}, transcribeLocalAsrAudio: async () => asr }), error => {
    assert.equal(error.code, 'NARRATION_TEXT_MISMATCH'); assert.equal(error.narrationReview.differences.length, 1); return true;
  });
  const same = buildNarrationReview(asr, '你好世间', 1000, 'a'.repeat(64)); assert.equal(same.differences.length, 0);
  const missing = buildNarrationReview(asr, '你好世界间', 1000, 'a'.repeat(64));
  assert.equal(missing.differences[0].expected, '界'); assert.equal(missing.differences[0].recognized, '');
  const source = await fs.readFile('frontend-react/src/components/creative/whiteboard/narrationReviewFiles.js', 'utf8');
  const { retainedNarrationAttempts } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.equal(retainedNarrationAttempts({ attempts: [{ stage: 'full_narration', status: 'failed', received: { raw: { id: 'raw' } } }],
    artifacts: [{ id: 'raw', url: '/audio' }] })[0].raw.url, '/audio');
  assert.equal(retainedNarrationAttempts({ attempts: [{ stage: 'full_narration', status: 'validated', received: { raw: { id: 'raw' } } }],
    artifacts: [{ id: 'raw', url: '/audio' }] }).length, 0);
  const app = express();
  const artifact = { fileName: 'provider-audio.bin', kind: 'provider_audio', mime: 'application/octet-stream' };
  app.locals.creativeWorkflows = { getWhiteboardMediaFile: async () => ({ success: true, file_path: file, artifact }) };
  app.use('/api/creative-workflows', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/creative-workflows/20261019000001/whiteboard/media/raw`;
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-43' } });
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-type'), 'audio/wav');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await response.arrayBuffer()).byteLength, 44);
    const download = await fetch(url + '?download=1');
    assert.match(download.headers.get('content-disposition'), /provider-audio.wav/);
    await download.arrayBuffer();
    assert.equal(artifact.mime, 'application/octet-stream', '响应兼容不能改变历史身份');
    await fs.writeFile(file, 'not an audio container');
    const invalid = await fetch(url); assert.equal(invalid.headers.get('content-type'), 'application/octet-stream'); await invalid.arrayBuffer();
    console.log('PASS 失败旁白对照、原始识别保留、试听入口选择、历史 BIN 音频 MIME、Range、下载扩展名与未知容器');
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
