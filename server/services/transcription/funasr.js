const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { resolveFfmpegPath, readAudioDuration } = require('../tts/ttsTimeline');

const execute = promisify(execFile);
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
const SEGMENT_SECONDS = 180;

class TranscriptionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function transcriptionEndpoint(baseUrl) {
  let url;
  try { url = new URL(String(baseUrl || '').trim()); } catch {}
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TranscriptionError('ASR_CONFIG_INVALID', 'FunASR 服务地址无效，请在设置中填写 HTTP 服务的 Base URL。');
  }
  const base = url.href.replace(/\/+$/, '');
  return base.endsWith('/audio/transcriptions') ? base : `${base}/audio/transcriptions`;
}

function sanitizeResponse(value, secret = '') {
  if (typeof value === 'string') return secret ? value.split(secret).join('[已隐藏]') : value;
  if (Array.isArray(value)) return value.map(item => sanitizeResponse(item, secret));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(authorization|api[_-]?key|cookies?|access_token|request_id|log_id)$/i.test(key))
    .map(([key, item]) => [key, sanitizeResponse(item, secret)]));
}

function normalizeSentences(payload, durationMs, offsetMs = 0) {
  const native = Array.isArray(payload?.sentence_info);
  const source = native ? payload.sentence_info : payload?.segments;
  if (!Array.isArray(source) || !source.length || /fallback|proportional|estimated/i.test(payload?.timing_source || '')) {
    throw new TranscriptionError('ASR_TIMESTAMPS_MISSING', 'FunASR 没有返回有效的句级时间戳。请启用 sentence_timestamp=True，或使用项目附带的 FunASR 服务脚本。');
  }
  let previousEnd = 0;
  return source.map((item, index) => {
    const start = item?.start;
    const end = item?.end;
    const startMs = Math.round(start * (native ? 1 : 1000));
    const endMs = Math.round(end * (native ? 1 : 1000));
    const text = typeof item?.text === 'string' ? item.text.trim().replace(/\s*\n\s*/g, ' ') : '';
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(startMs) || !Number.isFinite(endMs)
      || startMs < 0 || endMs <= startMs || startMs < previousEnd || endMs > durationMs + 1000 || !text) {
      throw new TranscriptionError('ASR_TIMESTAMPS_INVALID', `FunASR 第 ${index + 1} 条字幕的文字或时间戳无效，请检查服务的句级时间戳输出。`);
    }
    previousEnd = endMs;
    return { index: index + 1, startMs: startMs + offsetMs, endMs: endMs + offsetMs, text };
  });
}

async function runFfmpeg(args, options) {
  const binary = await resolveFfmpegPath(options);
  try {
    await (options.execute || execute)(binary, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
      windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new TranscriptionError('AUDIO_PREPARE_FAILED', '音频预处理失败，请检查 ffmpeg 是否可用、输入音频是否完整。');
  }
}

async function prepareRequests(audioPath, durationMs, options) {
  const directory = options.workDir || path.join(path.dirname(audioPath), 'funasr');
  await fsp.mkdir(directory, { recursive: true });
  const maxBytes = options.maxRequestBytes || MAX_REQUEST_BYTES;
  // 16 kHz / 单声道 / PCM16。优先整段请求，较长音频才按实际声学切片偏移合并。
  const wholeAudioFits = (durationMs / 1000) * 32000 + 4096 < maxBytes;
  const segmentMs = wholeAudioFits ? durationMs : Math.min(SEGMENT_SECONDS * 1000, Math.floor((maxBytes - 4096) / 32));
  if (segmentMs <= 0) throw new TranscriptionError('ASR_REQUEST_LIMIT', 'FunASR 请求大小上限过小。');
  const requests = [];
  for (let offsetMs = 0; offsetMs < durationMs; offsetMs += segmentMs) {
    const lengthMs = Math.min(segmentMs, durationMs - offsetMs);
    const target = path.join(directory, `audio-${String(requests.length + 1).padStart(4, '0')}.wav`);
    await runFfmpeg(['-y', '-i', audioPath, '-ss', String(offsetMs / 1000), '-t', String(lengthMs / 1000),
      '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', target], options);
    const stat = await fsp.stat(target);
    if (stat.size <= 44 || stat.size + 4096 > maxBytes) {
      throw new TranscriptionError('ASR_REQUEST_LIMIT', '预处理后的音频为空或超过 FunASR 请求上限，请检查音频或缩短视频。');
    }
    requests.push({ path: target, offsetMs, durationMs: lengthMs });
  }
  return requests;
}

function httpError(status) {
  if (status === 401) return new TranscriptionError('ASR_UNAUTHORIZED', 'FunASR 鉴权失败，请检查该供应商的 API Key。', 401);
  if (status === 403) return new TranscriptionError('ASR_FORBIDDEN', 'FunASR 拒绝访问，请检查服务权限。', 403);
  if (status === 429) return new TranscriptionError('ASR_RATE_LIMITED', 'FunASR 请求过于频繁，请稍后再试。', 429);
  if (status === 413) return new TranscriptionError('ASR_REQUEST_LIMIT', 'FunASR 服务的上传上限不足，请提高上限或缩短视频。');
  return new TranscriptionError('ASR_RESPONSE_FAILED', `FunASR 转写失败（HTTP ${status}），请检查服务日志与模型配置。`, 502);
}

async function transcribeFunasrAudio(audioPath, config, options = {}) {
  const endpoint = transcriptionEndpoint(config.baseUrl);
  const probe = options.durationMs ? { success: true, duration: options.durationMs / 1000 }
    : await (options.readAudioDuration || readAudioDuration)(audioPath, options);
  if (!probe.success || !Number.isFinite(probe.duration) || probe.duration <= 0) {
    throw new TranscriptionError('AUDIO_DURATION_INVALID', '无法读取音频时长，请检查 ffprobe 配置和媒体文件。');
  }
  const durationMs = Math.round(probe.duration * 1000);
  const report = options.onProgress || (() => {});
  await report({ progress: 5, message: '正在准备 FunASR 音频...' });
  const requests = await prepareRequests(audioPath, durationMs, options);
  const sentences = [];
  const responses = [];
  for (let index = 0; index < requests.length; index += 1) {
    const segment = requests[index];
    await report({ progress: 10 + Math.floor((index / requests.length) * 85), message: `正在转写音频（${index + 1}/${requests.length}）...` });
    const body = new FormData();
    body.set('file', new Blob([await fsp.readFile(segment.path)], { type: 'audio/wav' }), path.basename(segment.path));
    body.set('model', config.modelId || 'paraformer');
    body.set('response_format', 'verbose_json');
    body.append('timestamp_granularities[]', 'segment');
    if (config.language && config.language !== 'auto') body.set('language', config.language);
    let response;
    let payload;
    try {
      response = await (options.fetchImpl || globalThis.fetch)(endpoint, {
        method: 'POST', body, redirect: 'error',
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
        signal: AbortSignal.timeout(options.requestTimeoutMs || 300000),
      });
      if (!response.ok) throw httpError(response.status);
      payload = await response.json();
    } catch (error) {
      if (error instanceof TranscriptionError) throw error;
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new TranscriptionError('ASR_TIMEOUT', 'FunASR 请求超时，请检查服务状态；已保存的媒体和转写片段仍保留。', 504);
      }
      throw new TranscriptionError('ASR_UNAVAILABLE', '无法连接 FunASR 或响应不是有效 JSON，请检查服务地址和运行状态后重新开始转写。', 503);
    }
    const evidence = { index: index + 1, offsetMs: segment.offsetMs, durationMs: segment.durationMs,
      response: sanitizeResponse(payload, config.apiKey) };
    // 每段响应先落盘；后续段失败也不会丢失已收到的证据。
    await fsp.writeFile(path.join(path.dirname(segment.path), `response-${index + 1}.json`), JSON.stringify(evidence, null, 2), 'utf8');
    responses.push(evidence);
    const cues = normalizeSentences(payload, segment.durationMs, segment.offsetMs);
    if (sentences.length && cues[0].startMs < sentences[sentences.length - 1].endMs) {
      throw new TranscriptionError('ASR_TIMESTAMPS_INVALID', 'FunASR 返回的相邻音频片段字幕重叠，已保留原始响应，请检查服务时间戳。');
    }
    for (const cue of cues) sentences.push({ ...cue, index: sentences.length + 1 });
  }
  return {
    success: true, status: 'done', provider: 'funasr', model: config.modelId || 'paraformer',
    text: responses.map(item => item.response.text || '').filter(Boolean).join('\n') || sentences.map(cue => cue.text).join('\n'),
    sentences, durationMs, requestCount: requests.length, missingRanges: [],
    timingSource: responses.every(item => item.response.timing_source === 'funasr_sentence_info' || Array.isArray(item.response.sentence_info))
      ? 'funasr_sentence_info' : 'provider_segments',
    rawResponses: responses,
  };
}

module.exports = { TranscriptionError, transcriptionEndpoint, normalizeSentences, sanitizeResponse, transcribeFunasrAudio };
