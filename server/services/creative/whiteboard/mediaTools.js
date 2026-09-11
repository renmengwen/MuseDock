const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { resolveFfmpegPath, resolveFfprobePath } = require('../../tts/ttsTimeline');
const { WhiteboardError, sha256, canvasFor } = require('./contracts');

const RESOURCE_ROOT = path.join(__dirname, '../../../resources/whiteboard');
const RENDER_PROFILE = Object.freeze({ width: 1920, height: 1080, fps: 60, codec: 'h264', pixelFormat: 'yuv420p', preset: 'fast', crf: 18 });

function execute(command, args, { input, cwd, signal, timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' } });
    let stdout = '';
    let stderr = '';
    let done = false;
    const stop = () => {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGTERM');
    };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    const finish = error => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      if (error) reject(error); else resolve({ stdout, stderr });
    };
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString('utf8')).slice(-2_000_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-8000); });
    child.on('error', () => finish(new WhiteboardError('MEDIA_RUNTIME_MISSING', '本地媒体运行环境不可用，请执行 npm run setup:whiteboard 并检查 ffmpeg、ffprobe。')));
    child.on('close', code => {
      if (code === 0) return finish();
      let message = '本地媒体处理失败，请检查当前产物、磁盘空间和媒体运行环境。';
      try { const result = JSON.parse(stdout.trim().split('\n').at(-1)); if (result.message) message = result.message; } catch { /* No raw process output in task records. */ }
      finish(new WhiteboardError(signal?.aborted ? 'MEDIA_CANCELLED' : 'MEDIA_FAILED', message));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input == null ? undefined : JSON.stringify(input));
  });
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function pythonPath(options = {}) {
  return options.pythonPath || process.env.MUSEDOCK_WHITEBOARD_PYTHON || path.join(require('../../../dataRoot'),
    'data/runtime/whiteboard', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

async function python(command, input, options = {}) {
  const output = await execute(pythonPath(options), [path.join(RESOURCE_ROOT, 'python/media.py')], {
    ...options, input: { command, ...input }, timeoutMs: options.timeoutMs || 1800000,
  });
  try {
    const result = JSON.parse(output.stdout.trim().split('\n').at(-1));
    if (!result.success) throw new Error();
    return result;
  } catch { throw new WhiteboardError('MEDIA_FAILED', '白板媒体执行器没有返回有效结果。'); }
}

async function preflight(options = {}) {
  const ffmpeg = await resolveFfmpegPath(options);
  const ffprobe = await resolveFfprobePath(options);
  const font = options.fontPath || process.env.MUSEDOCK_WHITEBOARD_FONT || (process.platform === 'win32'
    ? path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts/msyh.ttc') : '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc');
  const results = await Promise.allSettled([
    python('doctor', {}, options), execute(ffmpeg, ['-hide_banner', '-filters'], options), execute(ffprobe, ['-version'], options), fsp.access(font),
  ]);
  if (results[3].status === 'rejected') throw new WhiteboardError('MEDIA_FONT_MISSING', '字幕字体不可用，请配置 MUSEDOCK_WHITEBOARD_FONT 为可用的中文字体文件。');
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  if (!/\bass\s/.test(results[1].value.stdout)) throw new WhiteboardError('MEDIA_RUNTIME_MISSING', '当前 ffmpeg 缺少 ASS 字幕滤镜，请安装带 libass 的 ffmpeg。');
  const [fontSha256, handSha256, sourceSha256, adapterSha256] = await Promise.all([
    hashFile(font), hashFile(path.join(RESOURCE_ROOT, 'assets/drawing-hand.png')),
    hashFile(path.join(RESOURCE_ROOT, 'sources.json')), hashFile(path.join(RESOURCE_ROOT, 'python/media.py')),
  ]);
  const coreSha256 = await Promise.all(['stream_primitives.py', 'region_renderer.py', 'ffmpeg_frame_sink.py'].map(file => hashFile(path.join(RESOURCE_ROOT, 'python', file))));
  const sources = JSON.parse(await fsp.readFile(path.join(RESOURCE_ROOT, 'sources.json'), 'utf8'));
  if (sources.files.find(file => file.file === 'assets/drawing-hand.png')?.sha256 !== handSha256) throw new WhiteboardError('DRAWING_HAND_INVALID', '固定画笔素材缺失或已变化，请恢复配套素材后重试。');
  return { ffmpeg, ffprobe, font, recipe: { ...RENDER_PROFILE, ...canvasFor(options.aspectRatio), fontSha256, handSha256, sourceSha256, adapterSha256, coreSha256 } };
}

async function probe(file, runtime, options = {}) {
  const result = await execute(runtime.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], options);
  try { return JSON.parse(result.stdout); }
  catch { throw new WhiteboardError('MEDIA_INVALID', 'ffprobe 未返回有效媒体信息。'); }
}

async function normalizeAudio(input, output, runtime, options = {}) {
  await execute(runtime.ffmpeg, ['-v', 'error', '-n', '-i', input, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', output], options);
  const info = await probe(output, runtime, options);
  const audio = info.streams?.find(stream => stream.codec_type === 'audio');
  const durationMs = Math.round(Number(info.format?.duration) * 1000);
  if (info.streams?.length !== 1 || audio?.codec_name !== 'pcm_s16le' || audio?.channels !== 1 || Number(audio?.sample_rate) !== 24000 || !(durationMs > 0)) {
    throw new WhiteboardError('AUDIO_INVALID', '完整旁白没有通过 24 kHz 单声道 WAV 校验。');
  }
  await execute(runtime.ffmpeg, ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'], options);
  return { durationMs, sampleRate: 24000, channels: 1, codec: 'pcm_s16le', decoded: true };
}

async function validateVideo(file, { frameCount, audio = false, durationMs, canvas }, runtime, options = {}) {
  const target = canvas || runtime.recipe || RENDER_PROFILE;
  const info = await probe(file, runtime, options);
  const video = info.streams?.filter(stream => stream.codec_type === 'video') || [];
  const voices = info.streams?.filter(stream => stream.codec_type === 'audio') || [];
  const v = video[0];
  const fps = String(v?.avg_frame_rate).split('/').reduce((a, b) => Number(a) / Number(b));
  if (video.length !== 1 || voices.length !== (audio ? 1 : 0) || info.streams.length !== video.length + voices.length
    || v.codec_name !== 'h264' || v.width !== target.width || v.height !== target.height || v.pix_fmt !== 'yuv420p'
    || fps !== 60 || Number(v.nb_frames) !== frameCount || Math.abs(Number(v.duration) * 1000 - frameCount * 1000 / 60) > 25) {
    throw new WhiteboardError('VIDEO_INVALID', '视频编码、尺寸、帧率、帧数或轨道没有通过校验。');
  }
  if (audio && (voices[0].codec_name !== 'aac' || voices[0].channels !== 1 || Number(voices[0].sample_rate) !== 24000
    || Math.abs(Number(voices[0].duration) * 1000 - durationMs) > 100)) throw new WhiteboardError('VIDEO_INVALID', '最终视频音轨或音画时长没有通过校验。');
  await execute(runtime.ffmpeg, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], options);
  return { ...RENDER_PROFILE, width: target.width, height: target.height, frameCount, durationMs: frameCount * 1000 / 60, audio, decoded: true };
}

async function renderScene({ image, annotation, output, scene, showHand }, runtime, options = {}) {
  const canvas = runtime.recipe || RENDER_PROFILE;
  if (annotation.canvas.width !== canvas.width || annotation.canvas.height !== canvas.height) throw new WhiteboardError('CANVAS_MISMATCH', '落墨标注画幅与当前制作方案不一致，请重新生成对应标注。');
  const startFrame = Math.ceil(scene.startMs * 60 / 1000);
  const frameCount = Math.ceil(scene.endMs * 60 / 1000) - startFrame;
  await python('render', { image, annotation, output, durationMs: scene.endMs - scene.startMs,
    startMs: scene.startMs, startFrame, frameCount, showHand, ffmpeg: runtime.ffmpeg }, options);
  return validateVideo(output, { frameCount, canvas }, runtime, options);
}

async function finalVideo({ sceneFiles, audioFile, cues, durationMs, directory, burnSubtitles }, runtime, options = {}) {
  const frameCount = Math.ceil(durationMs * 60 / 1000);
  const canvas = runtime.recipe ? { width: runtime.recipe.width, height: runtime.recipe.height } : canvasFor();
  // Copy to controlled ASCII names so concat/filter inputs never contain user path syntax.
  const concat = [];
  for (let i = 0; i < sceneFiles.length; i += 1) {
    const name = `scene-${i}.mp4`;
    await fsp.copyFile(sceneFiles[i], path.join(directory, name), fs.constants.COPYFILE_EXCL);
    const info = await probe(sceneFiles[i], runtime, options);
    const video = info.streams?.find(stream => stream.codec_type === 'video');
    const count = Number(video?.nb_frames);
    if (!Number.isInteger(count) || count < 1) throw new WhiteboardError('VIDEO_INVALID', '单幕视频缺少有效帧数，不能合并。');
    if (video.width !== canvas.width || video.height !== canvas.height) throw new WhiteboardError('CANVAS_MISMATCH', '单幕视频画幅不一致，不能混合横屏与竖屏合成。');
    // MP4 container duration is millisecond-rounded. Explicit frame-derived
    // durations prevent concat from inserting a fractional frame at each seam.
    concat.push(`file '${name}'\nduration ${(count / 60).toFixed(12)}`);
  }
  await fsp.writeFile(path.join(directory, 'concat.txt'), concat.join('\n'), { flag: 'wx' });
  const cwdOptions = { ...options, cwd: directory };
  await execute(runtime.ffmpeg, ['-v', 'error', '-n', '-f', 'concat', '-safe', '1', '-i', 'concat.txt', '-map', '0:v:0', '-an', '-c:v', 'copy', '-movflags', '+faststart', 'clean.mp4'], cwdOptions);
  await validateVideo(path.join(directory, 'clean.mp4'), { frameCount, canvas }, runtime, options);
  let videoName = 'clean.mp4';
  if (burnSubtitles) {
    await fsp.mkdir(path.join(directory, 'fonts'));
    await fsp.copyFile(runtime.font, path.join(directory, 'fonts/caption.ttc'), fs.constants.COPYFILE_EXCL);
    await python('subtitles', { font: runtime.font, cues, canvas, output: path.join(directory, 'captions.ass') }, options);
    await execute(runtime.ffmpeg, ['-v', 'error', '-n', '-i', 'clean.mp4', '-map', '0:v:0', '-an', '-vf', 'ass=captions.ass:fontsdir=fonts',
      '-c:v', 'libx264', '-preset', 'fast', '-threads', '2', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'captioned.mp4'], cwdOptions);
    videoName = 'captioned.mp4';
    await validateVideo(path.join(directory, videoName), { frameCount, canvas }, runtime, options);
  }
  if (audioFile) await execute(runtime.ffmpeg, ['-v', 'error', '-n', '-i', videoName, '-i', audioFile,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '24000', '-ac', '1', '-movflags', '+faststart', 'final.mp4'], cwdOptions);
  else await fsp.copyFile(path.join(directory, videoName), path.join(directory, 'final.mp4'), fs.constants.COPYFILE_EXCL);
  return validateVideo(path.join(directory, 'final.mp4'), { frameCount, audio: Boolean(audioFile), durationMs, canvas }, runtime, options);
}

async function extractFrame(video, output, ms, runtime, options = {}) {
  await execute(runtime.ffmpeg, ['-v', 'error', '-n', '-ss', String(Math.max(0, ms) / 1000), '-i', video, '-frames:v', '1', output], options);
}

module.exports = { RESOURCE_ROOT, RENDER_PROFILE, execute, hashFile, pythonPath, python, preflight, probe,
  normalizeAudio, validateVideo, renderScene, finalVideo, extractFrame };
