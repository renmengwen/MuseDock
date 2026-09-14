const assert = require('node:assert/strict');
const { execute } = require('../server/services/creative/whiteboard/mediaTools');
const { normalizeRenderProgress, encoderThreadsFor, sceneFrameCount } = require('../server/services/creative/whiteboard/renderProgress');

(async () => {
  assert.equal(encoderThreadsFor('libavcodec     58. 42.102 / 58. 42.102', 'win32'), 1);
  assert.equal(encoderThreadsFor('libavcodec     62. 28.101 / 62. 28.101', 'win32'), 2);
  assert.equal(encoderThreadsFor('unrecognized version', 'win32'), 1);
  assert.equal(encoderThreadsFor('libavcodec     58. 42.102', 'linux'), 2);
  assert.equal(sceneFrameCount({ startMs: 7860, endMs: 18520 }), 640);
  const first = { type: 'render_progress', phase: 'drawing', writtenFrames: 3, totalFrames: 12, elapsedMs: 100, ignored: 'private-fixture' };
  const last = { ...first, phase: 'encoding', writtenFrames: 12, elapsedMs: 200 };
  assert.equal(normalizeRenderProgress({ ...first, writtenFrames: 13 }), null);
  assert.equal(normalizeRenderProgress({ ...first, totalFrames: 0 }), null);
  assert.equal(normalizeRenderProgress({ ...first, phase: 'untrusted' }), null);
  const payload = JSON.stringify(first);
  const script = `process.stdout.write(${JSON.stringify(payload.slice(0, 17))}); setTimeout(() => {
    process.stdout.write(${JSON.stringify(payload.slice(17) + '\nnot-json\n' + JSON.stringify({ ...first, writtenFrames: -1 }) + '\n' + JSON.stringify(last) + '\n' + JSON.stringify({ success: true, message: '已完成' }) + '\n')});
  }, 20);`;
  const events = [];
  const result = await execute(process.execPath, ['-e', script], { onProgress: async event => {
    await new Promise(resolve => setTimeout(resolve, 5)); events.push(event);
  } });
  assert.deepEqual(events.map(event => event.writtenFrames), [3, 12]);
  assert.equal(JSON.stringify(events).includes('private-fixture'), false);
  assert.equal(JSON.parse(result.stdout.trim().split('\n').at(-1)).message, '已完成');
  await assert.rejects(execute(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 }), error => error.code === 'MEDIA_TIMEOUT');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  try {
    await assert.rejects(execute(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal }), error => error.code === 'MEDIA_CANCELLED');
  } finally { clearTimeout(timer); }
  console.log('PASS 渲染执行：旧 Windows 编码器兼容、分块进度解析与过滤、等待进度落盘、超时/取消区分');
})().catch(error => { console.error(error); process.exitCode = 1; });
