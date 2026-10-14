// Real local FFmpeg evidence for layer order, exact removal and audio; no providers.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const tools = require('../server/services/creative/whiteboard/mediaTools');

(async () => {
  const parent = path.join(__dirname, '../.codex-runtime');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'whiteboard-opening-overlay-'));
  const width = 1440, height = 1080;
  const runtime = { ...await tools.preflight({ aspectRatio: '4:3' }) };
  async function video(name, seconds, color, progress = false) {
    const file = path.join(root, `${name}.mp4`);
    await tools.execute(runtime.ffmpeg, ['-v', 'error', '-n', '-f', 'lavfi', '-i', `color=c=${color}:s=${width}x${height}:r=60`,
      ...(progress ? ['-vf', "drawbox=x=0:y=0:w=iw:h=ih:c=lime:t=fill:enable='gte(t,1)'"] : []),
      '-frames:v', String(seconds * 60), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
    return file;
  }
  const body = await video('body', 6, 'blue', true);
  const opening = await video('opening', 3, 'red');
  const short = await video('short', 0.8, 'blue');
  const voice = path.join(root, 'voice.wav');
  await tools.execute(runtime.ffmpeg, ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000',
    '-t', '6', '-ac', '1', '-c:a', 'pcm_s16le', voice]);
  const voiceHash = await tools.hashFile(voice);
  const bgm = await tools.prepareBackgroundMusic();
  async function render(name, { audioFile = null, music = null, captions = false, seconds = 6, sceneFile = body } = {}) {
    const directory = path.join(root, name);
    await fs.mkdir(directory);
    const validation = await tools.finalVideo({ sceneFiles: [sceneFile], openingOverlay: { file: opening, durationMs: Math.min(3000, seconds * 1000) },
      audioFile, audioOffsetMs: 0, bgm: music, durationMs: seconds * 1000, directory, burnSubtitles: captions,
      subtitleStyle: { color: '#FFFFFF', fontSize: 24 }, cues: [{ id: 'cue_1', text: '正文', startMs: 0, endMs: 2000 }] }, runtime);
    assert.equal(validation.frameCount, seconds * 60);
    assert.equal(validation.audio, Boolean(audioFile || music));
    return path.join(directory, 'final.mp4');
  }
  let serial = 0;
  async function frame(file, index, pixelOnly = true) {
    const target = path.join(root, `frame-${++serial}.rgb`);
    await tools.execute(runtime.ffmpeg, ['-v', 'error', '-n', '-i', file,
      '-vf', `select=eq(n\\,${index})${pixelOnly ? ',crop=2:2:0:0,scale=1:1' : ''}`,
      '-vsync', '0', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', target]);
    const bytes = await fs.readFile(target);
    assert.equal(bytes.length, pixelOnly ? 3 : width * height * 3);
    return bytes;
  }
  async function tone(file) {
    const target = path.join(root, `audio-${++serial}.f32`);
    await tools.execute(runtime.ffmpeg, ['-v', 'error', '-n', '-i', file, '-ss', '0.2', '-t', '0.8', '-vn',
      '-ar', '24000', '-ac', '1', '-c:a', 'pcm_f32le', '-f', 'f32le', target]);
    const bytes = await fs.readFile(target);
    let real = 0, imaginary = 0;
    const count = bytes.length / 4;
    for (let i = 0; i < count; i += 1) {
      const value = bytes.readFloatLE(i * 4), angle = 2 * Math.PI * 440 * i / 24000;
      real += value * Math.cos(angle); imaginary += value * Math.sin(angle);
    }
    return 2 * Math.hypot(real, imaginary) / count;
  }
  const plain = await render('voice', { audioFile: voice, captions: true });
  for (const index of [0, 179]) {
    const [r, g, b] = await frame(plain, index);
    assert.ok(r > 220 && g < 30 && b < 30, `第 ${index} 帧应由红色开头遮盖：${r},${g},${b}`);
  }
  for (const index of [180, 359]) {
    const [r, g, b] = await frame(plain, index);
    assert.ok(g > 220 && r < 30 && b < 30, `第 ${index} 帧应露出已推进的绿色正文：${r},${g},${b}`);
  }
  const captionFrame = await frame(plain, 30, false);
  let whitePixels = 0;
  for (let i = captionFrame.length / 2; i < captionFrame.length; i += 3) {
    if (captionFrame[i] > 200 && captionFrame[i + 1] > 200 && captionFrame[i + 2] > 200) whitePixels += 1;
  }
  assert.ok(whitePixels > 15, '正文字幕必须出现在不透明开头上方');
  assert.ok(await tone(plain) > 0.1, '叠加开头期间应已播放正文旁白');
  const mixed = await render('voice-bgm', { audioFile: voice, music: bgm });
  assert.ok(await tone(mixed) > 0.07, '有 BGM 时正文旁白也应从开始播放');
  await render('music-only', { music: bgm });
  await render('silent');
  const shortFinal = await render('short-final', { seconds: 0.8, sceneFile: short });
  const [r, g, b] = await frame(shortFinal, 47);
  assert.ok(r > 220 && g < 30 && b < 30, '短正文应在开头覆盖期间正常结束');
  assert.equal(await tools.hashFile(voice), voiceHash);
  console.log(`PASS 180 帧覆盖精确结束、正文进度、字幕上层、旁白从零开始、有无 BGM/旁白、短正文、完整解码。产物目录：${root}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
