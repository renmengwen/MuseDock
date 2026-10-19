const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const localAsr = require('../transcription/localAsr');
const { letters, splitCaption } = require('../creative/shared/captionLayout');
const { TIMING_SOURCE } = require('../transcription/firered');
const dataRoot = require('../../dataRoot');
const hash = value => crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const failure = (code, message) => Object.assign(new Error(message), { code });

async function runWorker(request, config, directory, options = {}) {
  const requestPath = path.join(directory, 'request.json');
  await fs.writeFile(requestPath, JSON.stringify(request), { flag: 'wx' });
  const log = await fs.open(path.join(directory, 'synthesis.log'), 'a');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(config.pythonPath, ['-u', path.join(__dirname, '../../resources/indextts/synthesize.py'), requestPath], {
        windowsHide: true, stdio: ['ignore', log.fd, log.fd], env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      let stopped = false;
      const abort = () => { stopped = true; child.kill(); };
      const timer = setTimeout(abort, options.localTtsTimeoutMs || 3600000);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      child.once('error', reject);
      child.once('close', code => {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        if (stopped) reject(failure('INDEXTTS_INTERRUPTED', '本地配音已取消或超时，已有音频与日志保留；不会自动重新合成。'));
        else if (code !== 0) reject(failure('INDEXTTS_FAILED', 'IndexTTS 合成失败，请检查本地运行环境及合成日志。'));
        else resolve();
      });
    });
  } finally { await log.close(); }
}

function validateAlignment(result, text, durationMs, audioSha256) {
  if (result.provider !== 'firered' || result.timingSource !== TIMING_SOURCE || !result.words?.length) {
    throw failure('NARRATION_EVIDENCE_INVALID', 'FireRed 未提供有效的独立识别与 CTC 字词对齐证据，音频已保留。');
  }
  let previous = 0;
  for (const word of result.words) {
    if (!Number.isInteger(word.startMs) || !Number.isInteger(word.endMs) || word.startMs < previous
      || word.endMs <= word.startMs || word.endMs > durationMs || !letters(word.text).length
      || !Number.isFinite(word.confidence) || word.confidence < 0 || word.confidence > 1) {
      throw failure('NARRATION_EVIDENCE_INVALID', '声学时间戳存在倒序、重叠或越界，不能使用估算时间代替。');
    }
    previous = word.endMs;
  }
  if (letters(result.words.map(word => word.text).join('')).join('') !== letters(text).join('')) {
    throw failure('NARRATION_TEXT_MISMATCH', '独立识别与配音正文不一致，可能存在漏读、重复或识别错字。音频和原始识别已保留，请核对后再处理；不会自动改字或重新配音。');
  }
  const characters = result.words.flatMap((word, index) => letters(word.text).map(() => ({ ...word, index })));
  let cursor = 0;
  const sentences = [];
  for (const part of splitCaption(text)) {
    const count = letters(part).length;
    if (!count) continue;
    const first = characters[cursor], last = characters[cursor + count - 1];
    const sentence = { text: part, startMs: first.startMs, endMs: last.endMs,
      sourceWordStartIndex: first.index, sourceWordEndIndex: last.index };
    if (sentences.length && sentence.startMs < sentences.at(-1).endMs) {
      Object.assign(sentences.at(-1), { text: sentences.at(-1).text + part, endMs: last.endMs, sourceWordEndIndex: last.index });
    } else sentences.push(sentence);
    cursor += count;
  }
  return { schemaVersion: 1, kind: 'post_asr_sentence_timestamps', provider: 'firered', model: 'fireredasr2-aed',
    ttsProvider: 'indextts', ttsNativeSubtitles: false, timingSource: TIMING_SOURCE, alignmentFrameMs: 40,
    audioSha256, durationMs, sourceTextSha256: hash(text), words: result.words, sentences,
    lowConfidenceWordCount: result.words.filter(word => word.confidence < .1).length, humanAudioReview: 'pending' };
}

async function alignIndexTtsAudio(audioPath, durationMs, text, alignmentConfig, options = {}) {
  options.signal?.throwIfAborted();
  await (options.ensureLocalAsrService || localAsr.ensureLocalAsrService)(alignmentConfig, { onProgress: options.onProgress });
  options.signal?.throwIfAborted();
  const result = await (options.transcribeLocalAsrAudio || localAsr.transcribeLocalAsrAudio)(audioPath, alignmentConfig,
    { ...options, durationMs, requestTimeoutMs: options.localAsrTimeoutMs || 1200000 });
  await fs.mkdir(options.workDir, { recursive: true });
  await fs.writeFile(path.join(options.workDir, `asr-raw-${crypto.randomUUID()}.json`), JSON.stringify(result, null, 2));
  options.signal?.throwIfAborted();
  const audioSha256 = hash(await fs.readFile(audioPath));
  try { return validateAlignment(result, text, durationMs, audioSha256); }
  catch (error) {
    error.narrationReview = require('./narrationReview').buildNarrationReview(result, text, durationMs, audioSha256);
    throw error;
  }
}

async function callIndexTts(options) {
  const { runtime, text } = options;
  const config = runtime.localIndexTts;
  const model = { provider: 'indextts', model_id: 'IndexTTS-2.5' };
  if (!runtime.configured) return { success: false, status: 'not_configured', code: 'TTS_NOT_CONFIGURED', model,
    message: '请在 IndexTTS 本地配音设置中填写已安装的模型目录和参考音频，并安装 FireRed 转写环境。' };
  const language = options.language === 'en' || /^en-/i.test(options.language || '') ? 'EN' : 'ZH';
  if (options.language && !/^(zh(-CN)?|en(-US|-GB)?)$/i.test(options.language)) return {
    success: false, code: 'TTS_INPUT_INVALID', status: 'failed', model, message: '当前本地配音组合支持中文和英语。' };
  const identity = hash({ version: 1, config, text, language, take: options.localTake || '' });
  const directory = path.join(options.indexTtsCacheDir || path.join(dataRoot, 'data/cache/indextts'), identity);
  await fs.mkdir(directory, { recursive: true });
  let lock, audioBuffer;
  try {
    options.signal?.throwIfAborted();
    try { lock = await fs.open(path.join(directory, 'job.lock'), 'wx'); }
    catch { throw failure('INDEXTTS_BUSY', '同一配音任务正在执行或上次进程异常退出，请核实任务状态后再恢复。'); }
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const output = path.join(directory, 'audio.wav'), receiptPath = path.join(directory, 'receipt.json');
    let receipt;
    try { receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')); } catch {}
    if (!receipt) {
      // 不覆盖中断的尝试。保留已有音频，防止重试时不知情地重新生成。
      const existing = await fs.readdir(directory);
      if (existing.includes('request.json') || existing.includes('audio.wav')) throw failure('INDEXTTS_RECOVERY_REQUIRED', '上次本地配音未完整结束，原始尝试已保留。请检查日志与音频后选择新一轮配音。');
      await options.onProgress?.({ message: '正在使用 IndexTTS 生成本地配音...' });
      await (options.runIndexTtsWorker || runWorker)({ config, text, language, output, receipt: receiptPath, identity }, config, directory, options);
      receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    }
    audioBuffer = await fs.readFile(output);
    if (receipt.audioSha256 !== hash(audioBuffer) || receipt.requestIdentity !== identity || !Number.isInteger(receipt.durationMs) || receipt.durationMs <= 0) {
      audioBuffer = null;
      throw failure('NARRATION_EVIDENCE_INVALID', '缓存音频与原始生成记录不匹配，已停止使用该音频。');
    }
    options.signal?.throwIfAborted();
    const alignmentIdentity = hash(runtime.alignmentConfig);
    const alignmentFile = path.join(directory, `alignment-${alignmentIdentity}.json`);
    let alignedSubtitles;
    try {
      const cached = JSON.parse(await fs.readFile(alignmentFile, 'utf8'));
      if (cached.audioSha256 === receipt.audioSha256) alignedSubtitles = validateAlignment(cached, text, receipt.durationMs, receipt.audioSha256);
    } catch (error) {
      if (error instanceof SyntaxError) {
        // 保留损坏的诊断文件，恢复只重新对齐已有音频。
        await fs.rename(alignmentFile, `${alignmentFile}.invalid-${crypto.randomUUID()}`);
      } else if (error.code !== 'ENOENT') throw error;
    }
    if (!alignedSubtitles) {
      await options.onProgress?.({ message: '正在独立识别配音并对齐真实句级时间戳...' });
      alignedSubtitles = await alignIndexTtsAudio(output, receipt.durationMs, text, runtime.alignmentConfig,
        { ...options, workDir: path.join(directory, 'asr') });
      options.signal?.throwIfAborted();
      const temporary = `${alignmentFile}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(alignedSubtitles, null, 2), { flag: 'wx' });
      await fs.rename(temporary, alignmentFile);
    }
    return { success: true, status: 'succeeded', audioBuffer, format: 'wav', model, voice: 'reference_audio', alignedSubtitles };
  } catch (error) {
    if (options.signal?.aborted) return { success: false, status: 'failed', code: 'INDEXTTS_CANCELLED', model, audioBuffer,
      format: 'wav', message: '本地配音已取消，已完成的音频保留，未完成的时间戳不会交付。' };
    return { success: false, status: 'failed', code: error.code || 'INDEXTTS_FAILED', model, audioBuffer,
      ...(error.narrationReview ? { narrationReview: error.narrationReview } : {}),
      format: 'wav', message: error.code ? error.message : '本地配音或对齐失败，已有音频和诊断记录已保留，请检查运行环境后重试。' };
  } finally {
    if (lock) { await lock.close(); await fs.unlink(path.join(directory, 'job.lock')); }
  }
}
module.exports = { callIndexTts, validateAlignment, runWorker, alignIndexTtsAudio };
