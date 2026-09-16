// Adapted from srt-whiteboard-animation/scripts/doubao_adapter.py.
// Seed Audio prompt-only request and same-response native subtitle contract.
// MuseDock owns configuration, attempts, publication and approvals.
const crypto = require('crypto');
const { recordedFetch, recordModelCall } = require('../diagnostics/apiCallRecorder');

const DOUBAO_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/create';
const DOUBAO_MODEL = 'seed-audio-1.0';
const DEFAULT_VOICE_DIRECTION = '一位声音温暖、清晰自然的成年旁白，用交流的口吻讲述，重音克制，情绪随内容自然变化。';

function normalizeDoubaoSettings(value = {}) {
  const integer = (key, min, max) => {
    const number = Number(value?.[key] ?? 0);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : 0;
  };
  return {
    voiceDirection: typeof value?.voiceDirection === 'string' && value.voiceDirection.trim()
      ? value.voiceDirection.trim().slice(0, 600) : DEFAULT_VOICE_DIRECTION,
    speechRate: integer('speechRate', -50, 100),
    loudnessRate: integer('loudnessRate', -50, 100),
    pitchRate: integer('pitchRate', -12, 12),
  };
}

function createTextPrompt({ text, scenes = [], language = 'zh-CN', settings = {} }) {
  const direction = normalizeDoubaoSettings(settings).voiceDirection;
  if (/[「」]/u.test(direction)) throw new Error('音色描述不能包含正文边界符号「或」。');
  const languageDirection = {
    'zh-CN': '只用自然普通话朗读。', 'en-US': 'Read only in natural American English.',
    'en-GB': 'Read only in natural British English.',
  }[language];
  if (!languageDirection) throw new Error('旁白语言不受支持。');
  const passages = scenes.length ? scenes.map(scene => {
    // Text is assembled from the approved source, never copied by a model.
    const end = Math.max(scene.startMs + 1, scene.endMs - (scene === scenes.at(-1) ? 0 : 700));
    return `在 ${(scene.startMs / 1000).toFixed(2)} 至 ${(end / 1000).toFixed(2)} 秒内朗读本段，下一段不得提前进入。「${scene.text}」`;
  }).join('\n\n') : `「${text}」`;
  const prompt = `${direction}\n${languageDirection}只用一个人声，逐字朗读「」内正文，不朗读导演说明，不增删、改写、复述或补充正文。禁止背景音乐、环境音、拟音、第二人声、克隆音色与 SSML。\n\n${passages}`;
  if (Array.from(prompt).length > 3000) throw new Error('豆包完整 text_prompt 超过 3000 字符，请缩短正文或音色描述后重新确认方案。');
  return prompt;
}

function nativeSubtitleEvidence(payload, textPrompt) {
  const fail = reason => { const error = new Error(reason); error.evidenceCode = reason; throw error; };
  const duration = (value, code) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 120) fail(code);
    return Math.round(value * 1000);
  };
  const durationMs = duration(payload.duration, 'invalid_duration');
  const originalDurationMs = duration(payload.original_duration, 'invalid_original_duration');
  const subtitle = payload.subtitle;
  if (!subtitle || typeof subtitle !== 'object') fail('missing_subtitle');
  if (typeof subtitle.text !== 'string' || !subtitle.text.trim()) fail('invalid_subtitle_text');
  if (!Array.isArray(subtitle.sentences) || !subtitle.sentences.length) fail('empty_sentences');
  let previousSentence = -1;
  let previousWord = -1;
  const timestamp = (value, code) => { if (!Number.isInteger(value) || value < 0) fail(code); return value; };
  const compact = value => value.replace(/\s+/gu, '');
  const sentences = subtitle.sentences.map(sentence => {
    if (!sentence || typeof sentence !== 'object') fail('invalid_sentence');
    const start = timestamp(sentence.start_time, 'invalid_sentence_timing');
    const end = timestamp(sentence.end_time, 'invalid_sentence_timing');
    if (end <= start || end > durationMs + 100 || start < previousSentence) fail('invalid_sentence_timing');
    if (typeof sentence.text !== 'string' || !sentence.text.trim()) fail('invalid_sentence');
    if (!Array.isArray(sentence.words) || !sentence.words.length) fail('empty_words');
    previousSentence = start;
    const words = sentence.words.map(word => {
      if (!word || typeof word !== 'object' || typeof word.text !== 'string' || !word.text.trim()) fail('invalid_word');
      const wordStart = timestamp(word.start_time, 'invalid_word_timing');
      const wordEnd = timestamp(word.end_time, 'invalid_word_timing');
      if (wordEnd < wordStart || wordEnd > durationMs + 100 || wordStart < previousWord
        || (wordEnd === wordStart && /[\p{L}\p{N}]/u.test(word.text))) fail('invalid_word_timing');
      previousWord = wordStart;
      return { start_time: wordStart, end_time: wordEnd, text: word.text };
    });
    if (compact(words.map(word => word.text).join('')) !== compact(sentence.text)) fail('sentence_words_text_mismatch');
    return { start_time: start, end_time: end, text: sentence.text, words };
  });
  if (compact(sentences.map(sentence => sentence.text).join('')) !== compact(subtitle.text)) fail('subtitle_sentences_text_mismatch');
  return {
    schemaVersion: 1, kind: 'providerNativeWordSubtitles', provider: 'doubao', model: DOUBAO_MODEL,
    textPromptSha256: crypto.createHash('sha256').update(textPrompt).digest('hex'),
    durationMs, originalDurationMs, subtitle: { text: subtitle.text, sentences },
  };
}

async function callDoubaoTts(options) {
  const { runtime } = options;
  const model = { provider: 'doubao', model_id: DOUBAO_MODEL };
  const failure = (code, message, extra = {}) => ({ success: false, code,
    status: code === 'UNKNOWN_EXTERNAL_OUTCOME' ? 'unknown_external_outcome' : 'failed', message, model, ...extra });
  const allowedBases = ['https://openspeech.bytedance.com', 'https://openspeech.bytedance.com/api/v3', DOUBAO_ENDPOINT];
  if (runtime.modelId !== DOUBAO_MODEL || !allowedBases.includes(runtime.baseUrl)) {
    return failure('TTS_CONFIG_INVALID', '豆包语音请使用 seed-audio-1.0 与官方 Base URL https://openspeech.bytedance.com。');
  }
  if (!runtime.apiKey) return failure('TTS_NOT_CONFIGURED', '豆包语音未配置 API Key，请在设置中填写新版语音控制台的 API Key。');
  if (options.durationSeconds != null && (!Number.isFinite(options.durationSeconds) || options.durationSeconds > 120 || options.durationSeconds <= 0)) {
    return failure('TTS_INPUT_INVALID', '豆包整轨旁白支持 120 秒以内的方案，请调整内容与目标时长后重新确认。');
  }
  let textPrompt;
  try { textPrompt = createTextPrompt({ text: options.text, scenes: options.scenes, language: options.language, settings: runtime.doubao }); }
  catch (error) { return failure('TTS_INPUT_INVALID', error.message); }
  const settings = normalizeDoubaoSettings(runtime.doubao);
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), Math.min(300000, Math.max(5000, options.requestTimeoutMs || 180000)));
  let response;
  let payload;
  try {
    response = await recordedFetch(options.fetchImpl || fetch, { category: 'tts' })(DOUBAO_ENDPOINT, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': runtime.apiKey, 'X-Api-Request-Id': crypto.randomUUID() },
      body: JSON.stringify({ model: DOUBAO_MODEL, text_prompt: textPrompt, audio_config: {
        format: 'wav', sample_rate: 24000, speech_rate: settings.speechRate,
        loudness_rate: settings.loudnessRate, pitch_rate: settings.pitchRate, enable_subtitle: true,
      } }),
    });
    if (!response.ok) {
      const status = response.status;
      if ([400, 401, 403, 404, 422, 429].includes(status)) return failure(`TTS_HTTP_${status}`, {
        401: '豆包语音凭据无效，请检查 API Key。', 403: '豆包语音访问被拒绝，请检查服务权限。',
        429: '豆包语音已限流，请稍后手动重试。',
      }[status] || `豆包语音拒绝请求（HTTP ${status}），请检查模型和输入配置。`, { http_status: status });
      return failure('UNKNOWN_EXTERNAL_OUTCOME', '豆包请求未取得完整结果，无法确认是否已经计费；请核实后再授权新请求。');
    }
    payload = await response.json();
  } catch {
    return failure('UNKNOWN_EXTERNAL_OUTCOME', '豆包语音连接中断或超时，结果无法确认。普通重试已暂停，请核实后再授权新请求。');
  } finally { clearTimeout(timer); }
  if (!payload || typeof payload !== 'object') return failure('UNKNOWN_EXTERNAL_OUTCOME', '豆包响应格式无效，未取得可核实的生成结果。');
  if (Object.hasOwn(payload, 'code') && payload.code !== 0 && !payload.audio) {
    return failure('TTS_REQUEST_REJECTED', '豆包语音返回业务错误，请检查服务配额和输入配置后重试。');
  }
  const base64 = typeof payload.audio === 'string' ? payload.audio : '';
  const audioBuffer = Buffer.from(base64, 'base64');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || audioBuffer.length < 44
    || audioBuffer.toString('ascii', 0, 4) !== 'RIFF' || audioBuffer.toString('ascii', 8, 12) !== 'WAVE') {
    return failure('UNKNOWN_EXTERNAL_OUTCOME', '豆包未返回有效 WAV 音频，生成结果无法确认。');
  }
  try {
    const nativeSubtitles = nativeSubtitleEvidence(payload, textPrompt);
    return { success: true, status: 'done', message: '豆包完整旁白与原生字幕已生成。',
      audioBuffer, format: 'wav', voice: 'text-prompt-authored', model, nativeSubtitles };
  } catch (error) {
    return failure('UNKNOWN_EXTERNAL_OUTCOME', '豆包已返回音频，但同请求字幕或时长证据无效。音频已保留，不能自动重新生成。',
      { audioBuffer, evidenceCode: error.evidenceCode || 'native_evidence_invalid' });
  }
}

module.exports = { DOUBAO_ENDPOINT, DOUBAO_MODEL, DEFAULT_VOICE_DIRECTION, normalizeDoubaoSettings, createTextPrompt, nativeSubtitleEvidence,
  callDoubaoTts: options => recordModelCall(() => callDoubaoTts(options), { category: 'tts' }) };
