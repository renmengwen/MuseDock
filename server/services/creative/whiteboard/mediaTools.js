const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { resolveFfmpegPath, resolveFfprobePath } = require('../../tts/ttsTimeline');
const { WhiteboardError, sha256, canvasFor, renderingFor } = require('./contracts');
const { normalizeRenderProgress, encoderThreadsFor } = require('./renderProgress');

const RESOURCE_ROOT = path.join(__dirname, '../../../resources/whiteboard');
const RENDER_PROFILE = Object.freeze({ width: 1920, height: 1080, fps: 60, codec: 'h264', pixelFormat: 'yuv420p', preset: 'fast', crf: 18 });
const BGM_RECIPE = Object.freeze({
  contractVersion: 'musedock-whiteboard-bgm-v1', trackId: 'first-light-particles',
  title: 'First Light Particles', author: 'Yoiyami', license: 'CC0-1.0',
  assetSha256: 'be5bd64f2d5f2f73a63bdec3afa4e1123b275ca9c1b77e2bb830c065d92b9724',
  musicVolumeDb: -18, narrationVolumeDb: -1.5, fadeInSeconds: 1.2, fadeOutSeconds: 1.8,
});

function execute(command, args, { input, cwd, signal, onProgress, timeoutMs = 300000 } = {}) {
  if (signal?.aborted) return Promise.reject(new WhiteboardError('MEDIA_CANCELLED', '本地媒体处理已取消。'));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' } });
    let stdout = '';
    let stderr = '';
    let done = false;
    let timedOut = false;
    let pendingLine = '';
    let progressQueue = Promise.resolve();
    const decoder = new StringDecoder('utf8');
    const stop = () => {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGTERM');
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    const finish = async error => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      await progressQueue;
      if (error) reject(error); else resolve({ stdout, stderr });
    };
    child.stdout.on('data', chunk => {
      const text = decoder.write(chunk);
      stdout = (stdout + text).slice(-2_000_000);
      if (!onProgress) return;
      pendingLine += text;
      let boundary;
      while ((boundary = pendingLine.indexOf('\n')) >= 0) {
        const line = pendingLine.slice(0, boundary);
        pendingLine = pendingLine.slice(boundary + 1);
        if (line.length > 8192) continue;
        try {
          const progress = normalizeRenderProgress(JSON.parse(line));
          if (progress) progressQueue = progressQueue.then(() => onProgress(progress)).catch(() => {});
        } catch { /* Only structured, allowlisted progress reaches workflow state. */ }
      }
      if (pendingLine.length > 8192) pendingLine = '';
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-8000); });
    child.on('error', () => finish(new WhiteboardError('MEDIA_RUNTIME_MISSING', '本地媒体运行环境不可用，请执行 npm run setup:whiteboard 并检查 ffmpeg、ffprobe。')));
    child.on('close', code => {
      stdout = (stdout + decoder.end()).slice(-2_000_000);
      if (signal?.aborted) return finish(new WhiteboardError('MEDIA_CANCELLED', '本地媒体处理已取消，已完成的产物会保留。'));
      if (timedOut) return finish(new WhiteboardError('MEDIA_TIMEOUT', `本地媒体处理超过 ${Math.ceil(timeoutMs / 1000)} 秒，已停止本次处理；已完成的产物会保留。`));
      if (code === 0) return finish();
      let message = '本地媒体处理失败，请检查当前产物、磁盘空间和媒体运行环境。';
      let errorCode = '';
      let coverageRatio;
      let coverage;
      try {
        const result = JSON.parse(stdout.trim().split('\n').at(-1));
        if (result.message) message = result.message;
        if (typeof result.errorCode === 'string') errorCode = result.errorCode;
        if (Number.isFinite(result.coverageRatio)) coverageRatio = result.coverageRatio;
        if (result.coverage && typeof result.coverage === 'object') {
          coverage = Object.fromEntries(['coverageRatio', 'regions', 'coveredInkPixels', 'totalInkPixels']
            .filter(key => Number.isFinite(result.coverage[key])).map(key => [key, result.coverage[key]]));
        }
      } catch { /* No raw process output in task records. */ }
      const error = new WhiteboardError(signal?.aborted ? 'MEDIA_CANCELLED' : errorCode || 'MEDIA_FAILED', message);
      if (Number.isFinite(coverageRatio)) error.coverageRatio = coverageRatio;
      if (coverage) error.coverage = coverage;
      finish(error);
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

async function prepareBackgroundMusic() {
  const file = path.join(RESOURCE_ROOT, 'assets/bgm/first-light-particles.mp3');
  try {
    if (await hashFile(file) !== BGM_RECIPE.assetSha256) throw new Error();
  } catch {
    throw new WhiteboardError('BGM_ASSET_INVALID', '内置背景音乐缺失或已变化，请恢复应用配套的 BGM 素材后重试。');
  }
  return { path: file, recipe: { ...BGM_RECIPE } };
}

function pythonPath(options = {}) {
  return options.pythonPath || process.env.MUSEDOCK_WHITEBOARD_PYTHON || path.join(require('../../../dataRoot'),
    'data/runtime/whiteboard', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

async function python(command, input, options = {}) {
  const rendering = input.rendering || input.annotation?.rendering;
  const entry = rendering ? 'python/handwritten_media.py' : command === 'render' ? 'python/render_worker.py' : 'python/media.py';
  const output = await execute(pythonPath(options), [path.join(RESOURCE_ROOT, entry)], {
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
    execute(ffmpeg, ['-version'], options),
  ]);
  if (results[3].status === 'rejected') throw new WhiteboardError('MEDIA_FONT_MISSING', '字幕字体不可用，请配置 MUSEDOCK_WHITEBOARD_FONT 为可用的中文字体文件。');
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  if (!/\bass\s/.test(results[1].value.stdout)) throw new WhiteboardError('MEDIA_RUNTIME_MISSING', '当前 ffmpeg 缺少 ASS 字幕滤镜，请安装带 libass 的 ffmpeg。');
  const bgm = options.bgmMode === 'enabled' ? await prepareBackgroundMusic() : null;
  if (bgm && ['amix', 'atrim', 'afade', 'volume', 'aresample', 'aformat', 'asetpts'].some(filter => !new RegExp(`\\b${filter}\\s`).test(results[1].value.stdout))) {
    throw new WhiteboardError('MEDIA_RUNTIME_MISSING', '当前 ffmpeg 缺少背景音乐混音滤镜，请安装完整版 ffmpeg 后重试。');
  }
  const [fontSha256, handSha256, sourceSha256, adapterSha256] = await Promise.all([
    hashFile(font), hashFile(path.join(RESOURCE_ROOT, 'assets/drawing-hand.png')),
    hashFile(path.join(RESOURCE_ROOT, 'sources.json')), hashFile(path.join(RESOURCE_ROOT, 'python/media.py')),
  ]);
  const coreSha256 = await Promise.all(['stream_primitives.py', 'region_renderer.py', 'ffmpeg_frame_sink.py'].map(file => hashFile(path.join(RESOURCE_ROOT, 'python', file))));
  const rendering = renderingFor(options.visualStyle);
  const styleRecipe = rendering ? { rendering, styleAdapterSha256: await hashFile(path.join(RESOURCE_ROOT, 'python/handwritten_media.py')) } : {};
  const sources = JSON.parse(await fsp.readFile(path.join(RESOURCE_ROOT, 'sources.json'), 'utf8'));
  if (sources.files.find(file => file.file === 'assets/drawing-hand.png')?.sha256 !== handSha256) throw new WhiteboardError('DRAWING_HAND_INVALID', '固定画笔素材缺失或已变化，请恢复配套素材后重试。');
  return { ffmpeg, ffprobe, font, bgm, encoderThreads: encoderThreadsFor(results[4].value.stdout),
    recipe: { ...RENDER_PROFILE, ...canvasFor(options.aspectRatio), fontSha256, handSha256, sourceSha256, adapterSha256, coreSha256, ...styleRecipe } };
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
  const started = Date.now();
  const canvas = runtime.recipe || RENDER_PROFILE;
  if (annotation.canvas.width !== canvas.width || annotation.canvas.height !== canvas.height) throw new WhiteboardError('CANVAS_MISMATCH', '落墨标注画幅与当前制作方案不一致，请重新生成对应标注。');
  if (sha256(annotation.rendering || null) !== sha256(runtime.recipe?.rendering || null)) throw new WhiteboardError('RENDER_CONFIG_CHANGED', '落墨标注的模板参数与当前冻结方案不一致，请重新编排。');
  const startFrame = Math.ceil(scene.startMs * 60 / 1000);
  const frameCount = Math.ceil(scene.endMs * 60 / 1000) - startFrame;
  const rendered = await python('render', { image, annotation, output, durationMs: scene.endMs - scene.startMs,
    startMs: scene.startMs, startFrame, frameCount, showHand, ffmpeg: runtime.ffmpeg, encoderThreads: runtime.encoderThreads || 2 }, options);
  await options.onProgress?.({ type: 'render_progress', phase: 'validating', writtenFrames: frameCount, totalFrames: frameCount, elapsedMs: Date.now() - started });
  const validation = await validateVideo(output, { frameCount, canvas }, runtime, options);
  return { ...validation, encoderThreads: rendered.encoderThreads, renderElapsedMs: rendered.renderElapsedMs };
}

async function finalVideo({ sceneFiles, audioFile, cues, durationMs, directory, burnSubtitles, bgm = null }, runtime, options = {}) {
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
    if (video.width !== canvas.width || video.height !== canvas.height) throw new WhiteboardError('CANVAS_MISMATCH', '单幕视频画幅不一致，不能混合不同比例合成。');
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
      '-c:v', 'libx264', '-preset', 'fast', '-threads', String(runtime.encoderThreads || 2), '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'captioned.mp4'], cwdOptions);
    videoName = 'captioned.mp4';
    await validateVideo(path.join(directory, videoName), { frameCount, canvas }, runtime, options);
  }
  if (bgm) {
    const musicFile = path.join(directory, 'bgm.mp3');
    await fsp.copyFile(bgm.path, musicFile, fs.constants.COPYFILE_EXCL);
    if (await hashFile(musicFile) !== bgm.recipe.assetSha256) throw new WhiteboardError('BGM_ASSET_INVALID', '背景音乐与当前制作版本不一致，请重新确认制作设置。');
    const seconds = durationMs / 1000;
    const fadeIn = Math.min(bgm.recipe.fadeInSeconds, seconds / 2);
    const fadeOut = Math.min(bgm.recipe.fadeOutSeconds, seconds / 2);
    const musicIndex = audioFile ? 2 : 1;
    const filters = [`[${musicIndex}:a:0]aresample=24000,aformat=channel_layouts=mono,atrim=duration=${seconds},asetpts=PTS-STARTPTS,volume=${bgm.recipe.musicVolumeDb}dB,afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${seconds - fadeOut}:d=${fadeOut}[music]`];
    if (audioFile) {
      filters.push(`[1:a:0]aresample=24000,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS,volume=${bgm.recipe.narrationVolumeDb}dB[voice]`);
      // Keep both inputs alive until narration ends. Older bundled FFmpeg always
      // normalizes amix by two; compensate without its newer normalize option.
      // The -1.5 dB voice / -18 dB music gains leave headroom for their sum.
      filters.push('[voice][music]amix=inputs=2:duration=first:dropout_transition=0,volume=2[mixed]');
    }
    await execute(runtime.ffmpeg, ['-v', 'error', '-n', '-i', videoName, ...(audioFile ? ['-i', audioFile] : []),
      '-stream_loop', '-1', '-i', musicFile, '-filter_complex', filters.join(';'),
      '-map', '0:v:0', '-map', audioFile ? '[mixed]' : '[music]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
      '-ar', '24000', '-ac', '1', '-movflags', '+faststart', 'final.mp4'], cwdOptions);
  } else if (audioFile) await execute(runtime.ffmpeg, ['-v', 'error', '-n', '-i', videoName, '-i', audioFile,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '24000', '-ac', '1', '-movflags', '+faststart', 'final.mp4'], cwdOptions);
  else await fsp.copyFile(path.join(directory, videoName), path.join(directory, 'final.mp4'), fs.constants.COPYFILE_EXCL);
  return validateVideo(path.join(directory, 'final.mp4'), { frameCount, audio: Boolean(audioFile || bgm), durationMs, canvas }, runtime, options);
}

async function extractFrame(video, output, ms, runtime, options = {}) {
  await execute(runtime.ffmpeg, ['-v', 'error', '-n', '-ss', String(Math.max(0, ms) / 1000), '-i', video, '-frames:v', '1', output], options);
}

module.exports = { RESOURCE_ROOT, RENDER_PROFILE, execute, hashFile, pythonPath, python, preflight, probe,
  normalizeAudio, validateVideo, renderScene, finalVideo, extractFrame, prepareBackgroundMusic };
