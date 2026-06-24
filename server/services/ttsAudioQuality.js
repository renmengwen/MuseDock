function roundTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function maxAllowedDuration(plannedDurationSec) {
  const planned = Number(plannedDurationSec || 0);
  if (!Number.isFinite(planned) || planned <= 0) return 30;
  const softAllowed = Math.max(planned * 2.5, planned + 8, 20);
  const grace = Math.max(3, Math.min(planned * 0.25, 6));
  return softAllowed + grace;
}

function parseSilenceDetect(stderr = '') {
  const text = String(stderr || '');
  const starts = [...text.matchAll(/silence_start:\s*([0-9.]+)/g)].map(match => Number(match[1]));
  const ends = [...text.matchAll(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g)]
    .map(match => ({ end: Number(match[1]), duration: Number(match[2]) }));
  return { starts, ends };
}

async function inspectAndCleanAudio({
  inputPath,
  outputPath,
  plannedDurationSec,
  runCommand,
  getFfprobeCommand,
  getFfmpegCommand,
  tailPaddingSec = 0.5,
  silenceNoise = '-45dB',
  silenceDurationSec = 1,
} = {}) {
  const ffprobe = await getFfprobeCommand();
  const durationResult = await runCommand(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ]);
  if (!durationResult.ok) {
    return { success: false, code: 'tts_duration_probe_failed', message: '读取 TTS 音频时长失败。' };
  }

  const rawDuration = roundTime(Number.parseFloat(String(durationResult.stdout || '').trim()));
  if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
    return { success: false, code: 'tts_duration_invalid', message: 'TTS 音频时长无效。' };
  }

  const ffmpeg = await getFfmpegCommand();
  const silenceResult = await runCommand(ffmpeg, [
    '-hide_banner',
    '-i', inputPath,
    '-af', `silencedetect=noise=${silenceNoise}:d=${silenceDurationSec}`,
    '-f', 'null',
    'NUL',
  ]);
  if (!silenceResult.ok) {
    return {
      success: false,
      code: 'tts_silence_detect_failed',
      message: '检测 TTS 静音片段失败。',
      raw_duration_sec: rawDuration,
    };
  }

  const silence = parseSilenceDetect(silenceResult.stderr || silenceResult.stdout || '');
  const lastStart = silence.starts.length ? silence.starts[silence.starts.length - 1] : null;
  const lastEnd = silence.ends.length ? silence.ends[silence.ends.length - 1] : null;
  const isTailSilence = lastStart != null && (!lastEnd || Math.abs(rawDuration - lastEnd.end) <= 1);
  const tailSilence = isTailSilence
    ? roundTime(lastEnd && Number.isFinite(lastEnd.duration) ? lastEnd.duration : rawDuration - lastStart)
    : 0;
  const allowed = maxAllowedDuration(plannedDurationSec);
  const shouldTrim = isTailSilence && tailSilence >= 2.5 && lastStart > 0.5;
  const speechDuration = shouldTrim ? roundTime(lastStart + tailPaddingSec) : rawDuration;

  if (shouldTrim && !outputPath) {
    return {
      success: false,
      code: 'tts_trim_output_missing',
      message: '检测到 TTS 长尾静音，但未提供裁剪输出路径。',
      raw_duration_sec: rawDuration,
      speech_duration_sec: speechDuration,
      allowed_duration_sec: roundTime(allowed),
      tail_silence_sec: tailSilence,
    };
  }

  if (speechDuration > allowed) {
    return {
      success: false,
      code: 'tts_duration_unreasonable',
      message: `TTS 音频时长异常：计划 ${Number(plannedDurationSec || 0).toFixed(2)} 秒，实际 ${speechDuration.toFixed(2)} 秒。`,
      raw_duration_sec: rawDuration,
      speech_duration_sec: speechDuration,
      allowed_duration_sec: roundTime(allowed),
      tail_silence_sec: tailSilence,
    };
  }

  if (shouldTrim && outputPath) {
    const trimResult = await runCommand(ffmpeg, ['-y', '-i', inputPath, '-t', String(speechDuration), outputPath]);
    if (!trimResult.ok) {
      return { success: false, code: 'tts_trim_failed', message: '裁剪 TTS 长尾静音失败。' };
    }
  }

  return {
    success: true,
    path: shouldTrim && outputPath ? outputPath : inputPath,
    raw_path: inputPath,
    raw_duration_sec: rawDuration,
    speech_duration_sec: speechDuration,
    tail_silence_sec: tailSilence,
    trimmed: shouldTrim,
  };
}

module.exports = {
  inspectAndCleanAudio,
  parseSilenceDetect,
  maxAllowedDuration,
};
