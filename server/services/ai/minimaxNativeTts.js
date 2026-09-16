// Adapted from the skill's minimax_adapter.py and native word subtitle reader.
// This full-track path never falls back to ASR or to sentence-by-sentence synthesis.
const { recordedFetch, recordModelCall } = require('../diagnostics/apiCallRecorder');
function miniMaxWords(value, depth = 0) {
  if (depth > 8) return [];
  if (Array.isArray(value)) {
    if (value.length && value.every(item => item && typeof (item.word ?? item.text ?? item.content) === 'string'
      && (item.time_begin != null || item.start_time != null || item.startTime != null || item.begin_time != null))) {
      return value.map(item => ({ text: item.word ?? item.text ?? item.content,
        start_time: Math.round(item.start_time != null || item.startTime != null ? (item.start_time ?? item.startTime) * 1000 : item.time_begin ?? item.begin_time),
        end_time: Math.round(item.end_time != null || item.endTime != null ? (item.end_time ?? item.endTime) * 1000 : item.time_end),
      }));
    }
    return value.flatMap(item => miniMaxWords(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    for (const key of ['timestamped_words', 'words', 'subtitles', 'subtitle', 'sentences', 'content', 'data', 'result']) {
      const result = miniMaxWords(value[key], depth + 1);
      if (result.length) return result;
    }
  }
  return [];
}

async function callMiniMaxNativeTts({ runtime, text, fetchImpl = fetch, signal, requestTimeoutMs = 180000 }) {
  const model = { provider: 'minimax', model_id: runtime.modelId };
  const failure = (code, message, extra = {}) => ({ success: false, code, message, model,
    status: code === 'UNKNOWN_EXTERNAL_OUTCOME' ? 'unknown_external_outcome' : 'failed', ...extra });
  const activeSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]) : AbortSignal.timeout(requestTimeoutMs);
  let audioBuffer;
  try {
    const response = await recordedFetch(fetchImpl, { category: 'tts' })(`${runtime.baseUrl.replace(/\/$/, '')}/t2a_v2`, {
      method: 'POST', signal: activeSignal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runtime.apiKey}` },
      body: JSON.stringify({ model: runtime.modelId, text, stream: false, output_format: 'hex',
        voice_setting: { voice_id: runtime.voiceId, speed: 1, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
        subtitle_enable: true, subtitle_type: 'word' }),
    });
    if (!response.ok && [400, 401, 403, 404, 422, 429].includes(response.status)) {
      return failure(`TTS_HTTP_${response.status}`, `MiniMax 语音请求被拒绝（HTTP ${response.status}），请检查凭据、权限或限流后重试。`);
    }
    if (!response.ok) return failure('UNKNOWN_EXTERNAL_OUTCOME', 'MiniMax 请求结果无法确认，请核实后再授权新的整轨请求。');
    const payload = await response.json();
    if (Number(payload?.base_resp?.status_code || 0) !== 0 && !payload?.data?.audio) return failure('TTS_REQUEST_REJECTED', 'MiniMax 语音返回业务错误，请检查语音配置和配额后重试。');
    const hex = payload?.data?.audio;
    if (typeof hex !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(hex)) throw new Error();
    audioBuffer = Buffer.from(hex, 'hex');
    const url = new URL(payload?.data?.subtitle_file || payload?.subtitle_file);
    if (url.protocol !== 'https:') throw new Error();
    const subtitles = await recordedFetch(fetchImpl, { category: 'tts' })(url.href, { signal: activeSignal, headers: { Accept: 'application/json' } });
    if (!subtitles.ok) throw new Error();
    const words = miniMaxWords(await subtitles.json());
    if (!words.length) throw new Error();
    return { success: true, status: 'done', message: '完整旁白及原生字级字幕已生成。', model,
      audioBuffer, format: 'mp3', nativeSubtitles: { schemaVersion: 1, kind: 'providerNativeWordSubtitles',
        provider: 'minimax', model: runtime.modelId, words } };
  } catch {
    return failure('UNKNOWN_EXTERNAL_OUTCOME', audioBuffer
      ? 'MiniMax 已返回音频，但同请求原生字幕不完整。音频已保留，不能自动重发。'
      : 'MiniMax 语音连接中断或返回结果无效，请核实后再授权新的整轨请求。', audioBuffer ? { audioBuffer } : {});
  }
}

module.exports = { callMiniMaxNativeTts: options => recordModelCall(() => callMiniMaxNativeTts(options), { category: 'tts' }), miniMaxWords };
