// Local audio evidence: real bundled FFmpeg, no model or provider requests.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const tools = require('../server/services/creative/whiteboard/mediaTools');
const { resolveFfmpegPath, resolveFfprobePath } = require('../server/services/tts/ttsTimeline');
const { normalizeProductionPlan } = require('../server/services/creative/whiteboard/contracts');

function rms(samples) {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}

function toneAmplitude(samples, frequency = 440) {
  let real = 0;
  let imaginary = 0;
  samples.forEach((value, index) => {
    const angle = 2 * Math.PI * frequency * index / 24000;
    real += value * Math.cos(angle);
    imaginary += value * Math.sin(angle);
  });
  return 2 * Math.hypot(real, imaginary) / samples.length;
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-whiteboard-bgm-'));
  try {
    assert.equal(normalizeProductionPlan().bgmMode, 'disabled');
    assert.equal(normalizeProductionPlan({ bgmMode: 'enabled' }).bgmMode, 'enabled');
    for (const mode of [true, false, null, 'auto', 'provider_embedded']) {
      assert.throws(() => normalizeProductionPlan({ bgmMode: mode }), error => error.code === 'INVALID_INPUT' && /BGM/.test(error.message));
    }
    const bgm = await tools.prepareBackgroundMusic();
    assert.equal(bgm.recipe.license, 'CC0-1.0');
    const runtime = { ffmpeg: await resolveFfmpegPath(), ffprobe: await resolveFfprobePath(), recipe: { width: 64, height: 64 } };
    const voice = path.join(root, 'voice.wav');
    await tools.execute(runtime.ffmpeg, ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000',
      '-t', '6', '-ac', '1', '-c:a', 'pcm_s16le', voice]);
    const originalVoiceHash = await tools.hashFile(voice);
    async function scene(seconds) {
      const file = path.join(root, `scene-${seconds}.mp4`);
      await tools.execute(runtime.ffmpeg, ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'color=c=beige:s=64x64:r=60',
        '-frames:v', String(seconds * 60), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
      return file;
    }
    const shortScene = await scene(6);
    async function render(name, { audioFile = null, music = null, seconds = 6, sceneFile = shortScene } = {}) {
      const directory = path.join(root, name);
      await fs.mkdir(directory);
      const validation = await tools.finalVideo({ sceneFiles: [sceneFile], audioFile, bgm: music, cues: [],
        durationMs: seconds * 1000, directory, burnSubtitles: false }, runtime);
      assert.equal(validation.frameCount, seconds * 60);
      assert.equal(validation.audio, Boolean(audioFile || music));
      return path.join(directory, 'final.mp4');
    }
    let sampleId = 0;
    async function samples(file, start = 0, duration = 6) {
      const output = path.join(root, `samples-${++sampleId}.f32`);
      await tools.execute(runtime.ffmpeg, ['-v', 'error', '-n', '-i', file, '-ss', String(start), '-t', String(duration),
        '-map', '0:a:0', '-vn', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_f32le', '-f', 'f32le', output]);
      const buffer = await fs.readFile(output);
      return Array.from({ length: buffer.length / 4 }, (_, index) => buffer.readFloatLE(index * 4));
    }
    const plain = await render('voice-only', { audioFile: voice });
    const mixed = await render('voice-and-bgm', { audioFile: voice, music: bgm });
    const musicOnly = await render('bgm-only', { music: bgm });
    const silent = await render('silent');
    assert.equal((await tools.probe(silent, runtime)).streams.some(stream => stream.codec_type === 'audio'), false);
    assert.equal(await tools.hashFile(voice), originalVoiceHash, '混音不得改写完整旁白');
    const plainSamples = await samples(plain, 2, 2);
    const mixedSamples = await samples(mixed, 2, 2);
    const musicSamples = await samples(musicOnly);
    const gain = Math.pow(10, bgm.recipe.narrationVolumeDb / 20);
    const difference = mixedSamples.map((value, index) => value - (plainSamples[index] || 0) * gain);
    const toneRatio = toneAmplitude(mixedSamples) / toneAmplitude(plainSamples);
    assert.ok(toneRatio > 0.7 && toneRatio < 1.1, `混音不应将旁白音量意外减半：${toneRatio}`);
    assert.ok(rms(difference) > 0.0005, '开启 BGM 后必须实际混入可检测的音乐');
    assert.ok(Math.max(...mixedSamples.map(Math.abs)) < 0.99, '混音应保留峰值余量');
    const middleRms = rms(musicSamples.slice(48000, 72000));
    assert.ok(middleRms > 0.0005, '无旁白时也应生成实际音乐音轨');
    assert.ok(rms(musicSamples.slice(0, 1200)) < middleRms * 0.35, 'BGM 起始需要淡入');
    assert.ok(rms(musicSamples.slice(-1200)) < middleRms * 0.35, 'BGM 结尾需要淡出');
    console.log('PASS BGM 开关、旁白混音、无旁白音乐、静音、首尾淡入淡出和旁白原文件保护');

    // The bundled track is about 132 seconds; the tail must contain its next loop.
    const longScene = await scene(136);
    const longMusic = await render('looped-bgm', { music: bgm, seconds: 136, sceneFile: longScene });
    const loopSamples = await samples(longMusic, 132.5, 1);
    assert.ok(loopSamples.length >= 23000 && rms(loopSamples) > 0.0001, '视频长于背景曲时必须循环，不能用静音补尾');
    console.log('PASS 136 秒音乐循环、60 fps 帧数、AAC / 24 kHz / 单声道、音画时长及完整解码');
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('musedock-whiteboard-bgm-'));
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
