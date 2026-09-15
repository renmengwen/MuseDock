const assert = require('assert/strict');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const express = require('express');
const { createTranscriptionService } = require('../server/services/transcription/transcriptionTasks');
const { createTranscriptionRouter } = require('../server/routes/transcriptions');
const mediaPipeline = require('../server/services/mediaPipeline');
const { TranscriptionError } = require('../server/services/transcription/funasr');

async function run() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'musedock-transcription-tasks-'));
  let transcriptions = 0;
  let corrections = 0;
  let downloads = 0;
  let correctionFails = false;
  let returnWrongId = false;
  let needsLogin = false;
  const rawSentences = [{ index: 1, startMs: 100, endMs: 800, text: '家向的月光。' }, { index: 2, startMs: 950, endMs: 1500, text: '照着小路。' }];
  const fixture = {
    rootDir: root,
    ensureFunasrService: async () => {},
    resolveAsrRuntime: async () => ({ configured: true, provider: 'funasr', baseUrl: 'http://localhost:8000/v1', modelId: 'paraformer' }),
    getTextConfig: async () => ({ enabled: true, apiKey: 'test-only-key', baseUrl: 'https://example.invalid/v1', modelId: 'fixture-model' }),
    resolveSource: async () => ({ aweme_id: '1234567890' }),
    getVideoDetail: async () => needsLogin ? { success: true, needLogin: true } : ({ success: true,
      data: { aweme_id: returnWrongId ? '9999999999' : '1234567890', title: '家乡', video_download_url: 'https://example.invalid/video' } }),
    mediaPipeline: {
      getMediaPaths: mediaPipeline.getMediaPaths,
      prepareDouyinMedia: async (id, metadata, options) => {
        downloads += 1;
        assert.equal(options.extractFrames, false);
        const paths = mediaPipeline.getMediaPaths(id, options.rootDir);
        await fsp.mkdir(paths.dir, { recursive: true });
        await fsp.writeFile(paths.audio, 'audio-fixture');
        await fsp.writeFile(paths.video, 'video-fixture');
        return { steps: { audio: { status: 'done' } } };
      },
    },
    readAudioDuration: async () => ({ success: true, duration: 1.6 }),
    transcribeAudio: async () => {
      transcriptions += 1;
      return { success: true, text: '家向的月光。照着小路。', sentences: rawSentences,
        durationMs: 1600, requestCount: 1, missingRanges: [], timingSource: 'funasr_sentence_info' };
    },
    callTextModel: async () => {
      corrections += 1;
      if (correctionFails) return { success: false, configured: true, message: 'fixture failure' };
      return { success: true, text: JSON.stringify({ changes: [{ index: 1, type: 'homophone', text: '家乡的月光。', reason: '标题与上下文支持' }] }), model: { id: 'fixture-model' } };
    },
  };
  const service = createTranscriptionService(fixture);
  const app = express();
  app.use(express.json());
  app.use('/api/transcriptions', createTranscriptionRouter({ service, douyin: {
    startQrcodeLogin: async () => ({ alreadyLoggedIn: false, needVerify: true, qrcode: 'must-not-leak' }),
    checkLoginResult: async () => ({ loggedIn: true, url: 'must-not-leak', cookies: ['must-not-leak'] }),
  } }));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const base = `http://127.0.0.1:${server.address().port}/api/transcriptions`;
  const post = (endpoint, body) => fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const emptyHistory = await fetch(base);
    assert.equal(emptyHistory.status, 200);
    assert.equal(emptyHistory.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await emptyHistory.json()).data, { items: [], skippedCount: 0 });
    assert.equal((await fetch(`${base}/capabilities`).then(response => response.json())).data.asrReady, true);
    assert.equal((await post('', { source: '', autoCorrect: false })).status, 400);
    const source = 'https://www.douyin.com/video/1234567890';
    const initial = await service.create({ source, autoCorrect: false });
    const duplicate = await service.create({ source, autoCorrect: false });
    assert.equal(initial.id, duplicate.id);
    assert.equal((await service.list()).items.length, 1, '运行中重复提交只产生一条历史');
    await service.waitForIdle();
    const raw = await service.get(initial.id);
    assert.equal(raw.status, 'succeeded');
    assert.equal(transcriptions, 1);
    assert.equal(corrections, 0, '未选择自动校订时不能调用分析模型');
    assert.ok(raw.source.videoSha256);
    assert.ok(raw.source.audioSha256);
    assert.equal(raw.result.sentenceCount, 2);
    const rawDownload = await fetch(`${base}/${raw.id}/files/rawSrt`);
    assert.equal(rawDownload.status, 200);
    assert.match(rawDownload.headers.get('content-disposition'), /attachment/);
    assert.match(await rawDownload.text(), /00:00:00,100 --> 00:00:00,800/);
    assert.equal((await fetch(`${base}/${raw.id}/files/task`)).status, 404);
    assert.equal((await fetch(`${base}/invalid-id`)).status, 404);

    correctionFails = true;
    const start = await post('', { source, autoCorrect: true });
    assert.equal(start.status, 202);
    const created = (await start.json()).data;
    await service.waitForIdle();
    const partial = await service.get(created.id);
    assert.equal(partial.status, 'partial');
    assert.equal(partial.canRetryCorrection, true);
    assert.equal(partial.result.rawText, raw.result.rawText);
    const asrCount = transcriptions;
    const downloadCount = downloads;
    const rawHash = partial.files.rawSrt.sha256;
    correctionFails = false;
    assert.equal((await post(`/${created.id}/corrections/retry`)).status, 202);
    await service.waitForIdle();
    const done = await service.get(created.id);
    assert.equal(done.status, 'succeeded');
    assert.equal(done.correctionCount, 1);
    assert.equal(done.result.correctedText, '家乡的月光。\n照着小路。');
    assert.equal(done.files.rawSrt.sha256, rawHash);
    assert.equal(transcriptions, asrCount, '重试校订不能重新请求 ASR');
    assert.equal(downloads, downloadCount, '重试校订不能重新下载媒体');
    assert.deepEqual(done.result.correctedSentences.map(cue => [cue.index, cue.startMs, cue.endMs]), rawSentences.map(cue => [cue.index, cue.startMs, cue.endMs]));
    const restarted = createTranscriptionService(fixture);
    const restoredHistory = await restarted.list();
    assert.deepEqual(restoredHistory.items.map(item => item.id), [created.id, raw.id], '冷启动直接发现磁盘中的全部旧任务，按创建时间倒序');
    assert.equal(restoredHistory.items[0].title, '家乡');
    assert.equal(restoredHistory.items[0].hasCorrectedText, true);
    assert.equal(restoredHistory.items[1].hasCorrectedText, false);
    assert.equal(restoredHistory.items[1].durationMs, 1600);
    assert.equal(restoredHistory.items[1].sentenceCount, 2);
    for (const item of restoredHistory.items) {
      for (const key of ['result', 'files', 'input', 'rawText', 'sentences']) assert.ok(!(key in item), `历史列表不应包含 ${key}`);
    }
    assert.equal((await restarted.get(raw.id)).files.rawSrt.sha256, raw.files.rawSrt.sha256, '新转写不能覆盖旧任务产物');
    assert.equal((await restarted.get(raw.id)).result.rawText, raw.result.rawText);
    assert.equal((await restarted.get(created.id)).status, 'succeeded');
    const interruptedId = randomUUID();
    await fsp.mkdir(path.join(root, interruptedId));
    await fsp.writeFile(path.join(root, interruptedId, 'task.json'), JSON.stringify({
      id: interruptedId, status: 'running', stage: 'transcribing', files: {}, autoCorrect: false,
    }), 'utf8');
    const concurrentReads = await Promise.all([restarted.get(interruptedId), restarted.get(interruptedId)]);
    assert.deepEqual(concurrentReads.map(job => job.status), ['interrupted', 'interrupted']);

    // 不完整目录和损坏记录不能阻止读取其他历史，也不应被删除或自动重写。
    const damagedRecords = [undefined, '{invalid-json', 'null', JSON.stringify({ id: randomUUID() })];
    for (const contents of damagedRecords) {
      const folder = path.join(root, randomUUID());
      await fsp.mkdir(folder);
      if (contents !== undefined) await fsp.writeFile(path.join(folder, 'task.json'), contents, 'utf8');
    }
    await fsp.mkdir(path.join(root, 'not-a-task'));
    await fsp.writeFile(path.join(root, randomUUID()), 'not-a-directory', 'utf8');
    const historyResponse = await fetch(base);
    const historyData = (await historyResponse.json()).data;
    assert.equal(historyData.items.length, 3);
    assert.equal(historyData.skippedCount, 4);
    assert.equal(historyData.items.find(item => item.id === interruptedId).status, 'interrupted');
    assert.equal(historyData.items.find(item => item.id === raw.id).hasResult, true);
    const missingRoot = createTranscriptionService({ ...fixture, rootDir: path.join(root, 'not-created') });
    assert.deepEqual(await missingRoot.list(), { items: [], skippedCount: 0 });
    const invalidRoot = path.join(root, 'history-file');
    await fsp.writeFile(invalidRoot, 'fixture', 'utf8');
    await assert.rejects(createTranscriptionService({ ...fixture, rootDir: invalidRoot }).list(), error => error.code === 'HISTORY_UNAVAILABLE');

    const original = await service.file(created.id, 'rawSrt');
    await fsp.appendFile(original.path, 'tampered');
    assert.equal((await fetch(`${base}/${created.id}/files/rawSrt`)).status, 409);
    assert.equal((await post(`/${created.id}/corrections/retry`)).status, 409);

    returnWrongId = true;
    const mismatch = await service.create({ source });
    await service.waitForIdle();
    assert.equal((await service.get(mismatch.id)).error.code, 'SOURCE_MISMATCH');
    assert.equal(transcriptions, asrCount);
    returnWrongId = false;
    needsLogin = true;
    const loginTask = await service.create({ source });
    await service.waitForIdle();
    assert.equal((await service.get(loginTask.id)).error.code, 'DOUYIN_NEEDS_LOGIN');
    const login = await post('/douyin/login').then(response => response.json());
    assert.equal(login.data.needVerify, true);
    assert.ok(!JSON.stringify(login).includes('must-not-leak'));
    const loggedIn = await post('/douyin/login/status').then(response => response.json());
    assert.equal(loggedIn.data.loggedIn, true);
    assert.ok(!JSON.stringify(loggedIn).includes('must-not-leak'));

    const missingConfig = createTranscriptionService({ ...fixture, resolveAsrRuntime: async () => ({ configured: false }) });
    await assert.rejects(missingConfig.create({ source }), error => error.code === 'ASR_NOT_CONFIGURED');
    const missingText = createTranscriptionService({ ...fixture, getTextConfig: async () => null });
    await assert.rejects(missingText.create({ source, autoCorrect: true }), error => error.code === 'TEXT_NOT_CONFIGURED');

    needsLogin = false;
    let releaseStartup;
    let notifyStartup;
    const startupGate = new Promise(resolve => { releaseStartup = resolve; });
    const startupEntered = new Promise(resolve => { notifyStartup = resolve; });
    const startupService = createTranscriptionService({ ...fixture,
      ensureFunasrService: async (_config, { onProgress }) => {
        onProgress({ message: '正在启动 FunASR 并加载模型...' });
        notifyStartup();
        await startupGate;
      },
    });
    const beforeStartupDownloads = downloads;
    const startingJob = await startupService.create({ source });
    await startupEntered;
    const startingState = await startupService.get(startingJob.id);
    assert.equal(startingState.status, 'running');
    assert.equal(startingState.stage, 'starting_asr');
    assert.match(startingState.message, /正在启动 FunASR/);
    assert.equal(downloads, beforeStartupDownloads, '服务就绪前不下载媒体或请求转写');
    assert.equal((await startupService.create({ source })).id, startingJob.id);
    assert.equal((await startupService.list()).items.find(item => item.id === startingJob.id).status, 'running', '列出历史不能把当前运行任务误判为中断');
    releaseStartup();
    await startupService.waitForIdle();
    assert.equal((await startupService.get(startingJob.id)).status, 'succeeded');

    const startupFailedService = createTranscriptionService({ ...fixture,
      ensureFunasrService: async () => { throw new TranscriptionError('ASR_START_TIMEOUT', '等待 FunASR 启动超时。', 504); },
    });
    const beforeFailureDownloads = downloads;
    const startupFailed = await startupFailedService.create({ source });
    await startupFailedService.waitForIdle();
    const startupFailure = await startupFailedService.get(startupFailed.id);
    assert.equal(startupFailure.status, 'failed', '启动失败后必须结束 loading');
    assert.equal(startupFailure.error.code, 'ASR_START_TIMEOUT');
    assert.equal(downloads, beforeFailureDownloads);

    let invalidPlan = true;
    const evidenceService = createTranscriptionService({ ...fixture,
      callTextModel: async () => ({ success: true,
        text: JSON.stringify({ changes: invalidPlan
          ? [{ index: 99, type: 'other', text: '越界文字。', reason: '无效测试。' }]
          : [
            { index: 1, type: 'homophone', text: '家乡的月光。', reason: '标题与上下文支持。' },
            { index: 2, type: 'other', text: rawSentences[1].text, reason: '核对后保留原文。' },
          ] }),
        raw_response: { authorization: 'must-not-persist' },
      }),
    });
    const evidenceJob = await evidenceService.create({ source, autoCorrect: true });
    await evidenceService.waitForIdle();
    const invalidResult = await evidenceService.get(evidenceJob.id);
    assert.equal(invalidResult.status, 'partial');
    assert.equal(invalidResult.error.code, 'CORRECTION_INVALID');
    assert.match(invalidResult.error.message, /字幕编号/);
    assert.equal(invalidResult.files.correctedText, undefined, '无效响应不能发布校订文件');
    const attemptsRoot = path.join(root, evidenceJob.id, 'corrections');
    const attemptsBefore = await fsp.readdir(attemptsRoot);
    assert.equal(attemptsBefore.length, 1);
    const responsePath = path.join(attemptsRoot, attemptsBefore[0], 'response-1.json');
    const responseText = await fsp.readFile(responsePath, 'utf8');
    const savedResponse = JSON.parse(responseText);
    assert.equal(savedResponse.rawJsonSha256, invalidResult.files.rawJson.sha256);
    assert.deepEqual(savedResponse.indices, [1, 2]);
    assert.equal(JSON.parse(savedResponse.text).changes[0].index, 99);
    assert.ok(!responseText.includes('must-not-persist'));
    assert.ok(!responseText.includes('test-only-key'));

    const beforeEvidenceRetry = { downloads, transcriptions };
    invalidPlan = false;
    await evidenceService.retryCorrection(evidenceJob.id);
    await evidenceService.waitForIdle();
    const recovered = await evidenceService.get(evidenceJob.id);
    assert.equal(recovered.status, 'succeeded');
    assert.equal(recovered.correctionCount, 1, '无变化项不应导致任务失败或虚增校订数量');
    assert.equal(recovered.files.rawSrt.sha256, invalidResult.files.rawSrt.sha256);
    assert.equal((await fsp.readdir(attemptsRoot)).length, 2, '每次校订的响应分别留存');
    assert.equal(await fsp.readFile(responsePath, 'utf8'), responseText, '重试不能覆盖之前的响应证据');
    assert.deepEqual({ downloads, transcriptions }, beforeEvidenceRetry);
  } finally {
    await service.waitForIdle();
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(root, { recursive: true, force: true });
  }
}

run().then(() => console.log('转写任务与 API 测试通过：历史发现与排序、旧产物保留、损坏记录隔离、原始产物、校订恢复、来源校验、下载与登录状态。'))
  .catch(error => { console.error(error); process.exitCode = 1; });
