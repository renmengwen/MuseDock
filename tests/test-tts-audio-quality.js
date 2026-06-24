const assert = require('assert');
const quality = require('../server/services/ttsAudioQuality');

(async () => {
  const calls = [];
  const result = await quality.inspectAndCleanAudio({
    inputPath: 'scene-004.wav',
    outputPath: 'scene-004.clean.wav',
    plannedDurationSec: 9,
    runCommand: async (cmd, args) => {
      calls.push({ cmd, args });
      if (args.includes('-show_entries')) return { ok: true, stdout: '231.040000\n' };
      if (args.includes('silencedetect=noise=-45dB:d=1')) {
        return {
          ok: true,
          stderr: [
            'silence_start: 13.495917',
            'silence_end: 230.609 | silence_duration: 217.113083',
          ].join('\n'),
        };
      }
      return { ok: true, stdout: '', stderr: '' };
    },
    getFfprobeCommand: async () => 'ffprobe',
    getFfmpegCommand: async () => 'ffmpeg',
  });

  assert.equal(result.success, true);
  assert.equal(result.trimmed, true);
  assert.equal(result.raw_duration_sec, 231.04);
  assert.equal(result.speech_duration_sec, 13.996);
  assert.equal(result.tail_silence_sec, 217.113);
  assert.ok(calls.some(call => call.args.includes('-t')));

  const nearLimitSpeech = await quality.inspectAndCleanAudio({
    inputPath: 'near-limit.wav',
    plannedDurationSec: 8,
    runCommand: async (cmd, args) => {
      if (args.includes('-show_entries')) return { ok: true, stdout: '21.600000\n' };
      if (args.includes('silencedetect=noise=-45dB:d=1')) return { ok: true, stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    },
    getFfprobeCommand: async () => 'ffprobe',
    getFfmpegCommand: async () => 'ffmpeg',
  });

  assert.equal(nearLimitSpeech.success, true);
  assert.equal(nearLimitSpeech.speech_duration_sec, 21.6);

  const overLimitSpeech = await quality.inspectAndCleanAudio({
    inputPath: 'over-limit.wav',
    plannedDurationSec: 8,
    runCommand: async (cmd, args) => {
      if (args.includes('-show_entries')) return { ok: true, stdout: '24\n' };
      if (args.includes('silencedetect=noise=-45dB:d=1')) return { ok: true, stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    },
    getFfprobeCommand: async () => 'ffprobe',
    getFfmpegCommand: async () => 'ffmpeg',
  });

  assert.equal(overLimitSpeech.success, false);
  assert.equal(overLimitSpeech.code, 'tts_duration_unreasonable');

  const abnormal = await quality.inspectAndCleanAudio({
    inputPath: 'bad.wav',
    plannedDurationSec: 9,
    runCommand: async (cmd, args) => {
      if (args.includes('-show_entries')) return { ok: true, stdout: '80\n' };
      if (args.includes('silencedetect=noise=-45dB:d=1')) return { ok: true, stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    },
    getFfprobeCommand: async () => 'ffprobe',
    getFfmpegCommand: async () => 'ffmpeg',
  });

  assert.equal(abnormal.success, false);
  assert.equal(abnormal.code, 'tts_duration_unreasonable');

  const missingOutput = await quality.inspectAndCleanAudio({
    inputPath: 'scene-005.wav',
    plannedDurationSec: 9,
    runCommand: async (cmd, args) => {
      if (args.includes('-show_entries')) return { ok: true, stdout: '40\n' };
      if (args.includes('silencedetect=noise=-45dB:d=1')) {
        return {
          ok: true,
          stderr: [
            'silence_start: 10',
            'silence_end: 39.8 | silence_duration: 29.8',
          ].join('\n'),
        };
      }
      return { ok: true, stdout: '', stderr: '' };
    },
    getFfprobeCommand: async () => 'ffprobe',
    getFfmpegCommand: async () => 'ffmpeg',
  });

  assert.equal(missingOutput.success, false);
  assert.equal(missingOutput.code, 'tts_trim_output_missing');
  assert.equal(missingOutput.raw_duration_sec, 40);
  assert.equal(missingOutput.speech_duration_sec, 10.5);
  assert.equal(missingOutput.tail_silence_sec, 29.8);

  const detectFailed = await quality.inspectAndCleanAudio({
    inputPath: 'detect-failed.wav',
    plannedDurationSec: 9,
    runCommand: async (cmd, args) => {
      if (args.includes('-show_entries')) return { ok: true, stdout: '12\n' };
      if (args.includes('silencedetect=noise=-45dB:d=1')) return { ok: false, stderr: 'ffmpeg failed' };
      return { ok: true, stdout: '', stderr: '' };
    },
    getFfprobeCommand: async () => 'ffprobe',
    getFfmpegCommand: async () => 'ffmpeg',
  });

  assert.equal(detectFailed.success, false);
  assert.equal(detectFailed.code, 'tts_silence_detect_failed');
  assert.equal(detectFailed.raw_duration_sec, 12);

  console.log('tts audio quality tests passed');
})();
