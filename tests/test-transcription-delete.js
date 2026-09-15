const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const express = require('express');
const { createTranscriptionService } = require('../server/services/transcription/transcriptionTasks');
const { createTranscriptionRouter } = require('../server/routes/transcriptions');
const { TranscriptionError } = require('../server/services/transcription/funasr');

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-transcription-delete-'));
  const rootDir = path.join(sandbox, 'transcriptions');
  const outside = path.join(sandbox, 'outside');
  await fs.mkdir(outside);
  const sentinel = path.join(outside, 'keep.txt');
  await fs.writeFile(sentinel, 'keep-outside');
  const service = createTranscriptionService({ rootDir });
  const app = express();
  app.use(express.json());
  app.use('/api/transcriptions', createTranscriptionRouter({ service }));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const base = `http://127.0.0.1:${server.address().port}/api/transcriptions`;
  const remove = (id, body = { confirmed: true }, headers = {}) => fetch(`${base}/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  async function fixture(overrides = {}) {
    const id = randomUUID();
    const dir = path.join(rootDir, id);
    for (const name of ['transcript.raw.txt', 'transcript.raw.srt', 'transcript.raw.json', 'metadata.json',
      'media/source/video.mp4', 'media/source/audio.mp3', 'asr/chunk.wav', 'asr/response-1.json',
      'corrections/first/transcript.corrected.srt', 'corrections/first/response-1.json',
      'corrections/second/transcript.corrected.txt', 'corrections/second/transcript.corrections.json']) {
      const file = path.join(dir, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `fixture:${name}`);
    }
    const job = { id, status: 'succeeded', stage: 'done', source: { title: '删除测试' }, createdAt: new Date().toISOString(),
      result: { rawText: '测试文字', sentenceCount: 1 }, files: { rawText: { path: '../../outside/keep.txt' } }, ...overrides };
    await fs.writeFile(path.join(dir, 'task.json'), JSON.stringify(job), 'utf8');
    return { id, dir, job };
  }
  try {
    const selected = await fixture();
    const sibling = await fixture();
    assert.equal((await remove(selected.id, {})).status, 400);
    assert.equal((await remove(selected.id, { confirmed: false })).status, 400);
    assert.equal((await remove(selected.id, { confirmed: true }, { Origin: 'https://example.invalid' })).status, 403);
    assert.equal((await remove(selected.id, { confirmed: true, path: outside })).status, 400);
    assert.ok(await fs.stat(selected.dir));
    await service.get(selected.id);
    const response = await remove(selected.id);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { id: selected.id, deleted: true });
    await assert.rejects(fs.access(selected.dir), error => error.code === 'ENOENT');
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep-outside', '不得沿文件清单中的外部路径删除');
    assert.ok(await fs.stat(path.join(sibling.dir, 'media/source/video.mp4')));
    assert.equal((await fetch(`${base}/${selected.id}`)).status, 404);
    assert.equal((await service.list()).items.some(item => item.id === selected.id), false);
    assert.equal((await createTranscriptionService({ rootDir }).list()).items.some(item => item.id === selected.id), false);
    assert.equal((await remove(selected.id)).status, 200, '重复确认已删除任务应安全返回成功');
    for (const id of ['..', '../outside', '..\\outside', outside]) {
      await assert.rejects(service.remove(id), error => error.code === 'TASK_NOT_FOUND');
    }

    const linkId = randomUUID();
    const externalRecord = JSON.stringify({ id: linkId, status: 'running', files: {} });
    await fs.writeFile(path.join(outside, 'task.json'), externalRecord);
    await fs.symlink(outside, path.join(rootDir, linkId), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(service.remove(linkId), error => error.code === 'DELETE_PATH_INVALID');
    assert.equal(await fs.readFile(path.join(outside, 'task.json'), 'utf8'), externalRecord, '拒绝链接目录时不能先执行任务恢复写盘');
    const brokenId = randomUUID();
    await fs.symlink(path.join(sandbox, 'missing-target'), path.join(rootDir, brokenId), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(service.remove(brokenId), error => error.code === 'DELETE_PATH_INVALID');
    const nested = await fixture();
    await fs.symlink(outside, path.join(nested.dir, 'external-link'), process.platform === 'win32' ? 'junction' : 'dir');
    await service.remove(nested.id);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep-outside', '删除任务内链接不能删除外部目标');

    let releaseRun;
    let startedRun;
    const runGate = new Promise(resolve => { releaseRun = resolve; });
    const enteredRun = new Promise(resolve => { startedRun = resolve; });
    const runningService = createTranscriptionService({ rootDir,
      resolveAsrRuntime: async () => ({ configured: true, provider: 'funasr', baseUrl: 'http://localhost:8000/v1' }),
      ensureFunasrService: async () => { startedRun(); await runGate; throw new TranscriptionError('FIXTURE_STOP', '测试停止。'); },
    });
    const runningJob = await runningService.create({ source: 'https://www.douyin.com/video/1234567890' });
    await enteredRun;
    try {
      await assert.rejects(runningService.remove(runningJob.id), error => error.status === 409);
      await runningService.remove(sibling.id);
      assert.ok(await fs.stat(path.join(rootDir, runningJob.id)));
    } finally { releaseRun(); await runningService.waitForIdle(); }
    await runningService.remove(runningJob.id);

    const paused = await fixture({ status: 'partial', stage: 'correcting' });
    let releaseDelete;
    let enteredDelete;
    const deleteGate = new Promise(resolve => { releaseDelete = resolve; });
    const deletingStarted = new Promise(resolve => { enteredDelete = resolve; });
    const deletingService = createTranscriptionService({ rootDir,
      getTextConfig: async () => { throw new Error('删除时不能再读取模型配置'); },
      removeDirectory: async (target, options) => { enteredDelete(); await deleteGate; await fs.rm(target, options); },
    });
    const removing = deletingService.remove(paused.id);
    await deletingStarted;
    try {
      await assert.rejects(deletingService.retryCorrection(paused.id), error => error.code === 'TASK_DELETING');
      await assert.rejects(deletingService.get(paused.id), error => error.code === 'TASK_DELETING');
      await assert.rejects(deletingService.remove(paused.id), error => error.status === 409);
      assert.equal((await deletingService.list()).items.some(item => item.id === paused.id), false);
    } finally { releaseDelete(); await removing; }

    const orphan = await fixture({ status: 'running' });
    const cold = createTranscriptionService({ rootDir });
    const race = await Promise.allSettled([cold.get(orphan.id), cold.remove(orphan.id), cold.list()]);
    assert.equal(race[1].status, 'fulfilled');
    await assert.rejects(fs.access(orphan.dir), error => error.code === 'ENOENT');
    await assert.rejects(cold.get(orphan.id), error => error.code === 'TASK_NOT_FOUND');

    const interruptedDelete = await fixture();
    const failedService = createTranscriptionService({ rootDir, removeDirectory: async target => {
      await fs.unlink(path.join(target, 'task.json'));
      throw new Error('fixture file locked');
    } });
    await assert.rejects(failedService.remove(interruptedDelete.id), error => error.code === 'DELETE_FAILED');
    const retained = JSON.parse(await fs.readFile(path.join(interruptedDelete.dir, 'task.json'), 'utf8'));
    assert.equal(retained.stage, 'deleting');
    assert.equal(retained.error.code, 'DELETE_FAILED');
    await createTranscriptionService({ rootDir }).remove(interruptedDelete.id);
    await assert.rejects(fs.access(interruptedDelete.dir), error => error.code === 'ENOENT');
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep-outside');
  } finally {
    await new Promise(resolve => server.close(resolve));
    const relative = path.relative(os.tmpdir(), path.resolve(sandbox));
    assert.ok(relative.startsWith('musedock-transcription-delete-') && !path.isAbsolute(relative) && !relative.includes(path.sep));
    await fs.rm(sandbox, { recursive: true, force: true });
  }
}

run().then(() => console.log('转写删除测试通过：确认、完整目录清理、路径边界、运行保护、并发读写与失败重试。'))
  .catch(error => { console.error(error); process.exitCode = 1; });
