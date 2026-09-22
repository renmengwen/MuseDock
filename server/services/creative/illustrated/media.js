const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { resolveFfmpegPath, resolveFfprobePath } = require('../../tts/ttsTimeline');
const { prepareBackgroundMusic } = require('../whiteboard/mediaTools');
const { hash, ErrorType, FPS, RENDER_VERSION, canvasFor, subtitleStyleFor, motionIdentity } = require('./contracts');
const { digest } = require('./storage');

function execute(command, args, { cwd, timeoutMs = 600000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const stop = () => child.kill();
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', stop);
      if (error) { error.detail = stderr.slice(-6000); reject(error); } else resolve({ stdout, stderr });
    };
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-4000000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.on('error', () => finish(new ErrorType('MEDIA_RUNTIME_MISSING', '找不到 FFmpeg 或 ffprobe，请检查安装及应用运行路径。')));
    child.on('close', code => finish(code === 0 ? null : new ErrorType(signal?.aborted ? 'CANCELLED' : 'MEDIA_FAILED',
      signal?.aborted ? '本地媒体处理已取消，成功片段已保留。' : '媒体处理失败，请检查输入文件、字体和 FFmpeg 环境。')));
  });
}
async function preflight(options = {}) {
  let ffmpeg = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  try { await execute(ffmpeg, ['-version'], { timeoutMs: 10000 }); }
  catch { ffmpeg = await resolveFfmpegPath(options); }
  const ffprobe = await resolveFfprobePath(options);
  const [version, probeVersion, filters] = await Promise.all([
    execute(ffmpeg, ['-version']), execute(ffprobe, ['-version']), execute(ffmpeg, ['-filters']),
  ]);
  if (!/\bzoompan\b/.test(filters.stdout) || !/\bass\b/.test(filters.stdout)) throw new ErrorType('MEDIA_RUNTIME_MISSING', 'FFmpeg 缺少 zoompan 或 libass 字幕支持，请使用完整构建。');
  const candidates = [options.fontPath, process.env.MUSEDOCK_WHITEBOARD_FONT,
    'C:/Windows/Fonts/msyh.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', '/System/Library/Fonts/PingFang.ttc'].filter(Boolean);
  let font = '';
  for (const item of candidates) if (await fs.stat(item).then(stat => stat.isFile()).catch(() => false)) { font = item; break; }
  if (!font) throw new ErrorType('FONT_MISSING', '缺少中文字体，请通过 MUSEDOCK_WHITEBOARD_FONT 指定可用的中文 TTF/TTC 字体。');
  const fontFamily = path.basename(font).toLowerCase().startsWith('msyh') ? 'Microsoft YaHei'
    : path.basename(font).startsWith('PingFang') ? 'PingFang SC' : 'Noto Sans CJK SC';
  return { ffmpeg, ffprobe, font, fontFamily, identity: hash({ renderer: RENDER_VERSION,
    ffmpeg: version.stdout.split('\n')[0], ffprobe: probeVersion.stdout.split('\n')[0], font: await digest(font) }) };
}
async function probe(file, runtime) {
  const result = await execute(runtime.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  try { return JSON.parse(result.stdout); } catch { throw new ErrorType('MEDIA_INVALID', '媒体信息无法读取。'); }
}
async function decode(file, runtime) {
  await execute(runtime.ffmpeg, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
}
async function normalizeAudio(input, output, runtime) {
  await execute(runtime.ffmpeg, ['-v', 'error', '-n', '-i', input, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', output]);
  const info = await probe(output, runtime);
  const audio = info.streams?.find(item => item.codec_type === 'audio');
  const durationMs = Math.round(Number(info.format?.duration) * 1000);
  if (audio?.codec_name !== 'pcm_s16le' || audio?.sample_rate !== '24000' || audio?.channels !== 1 || !(durationMs > 0)) throw new ErrorType('AUDIO_INVALID', '配音没有通过 24 kHz 单声道 WAV 校验。');
  await decode(output, runtime);
  return { durationMs, decoded: true, codec: 'pcm_s16le', sampleRate: 24000, channels: 1 };
}
function imageMime(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new ErrorType('IMAGE_INVALID', '仅支持可解码的 PNG、JPEG 或 WebP 图片。');
}
async function normalizeImage(input, output, runtime) {
  const info = await probe(input, runtime);
  const image = info.streams?.find(item => item.codec_type === 'video');
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 64 || image.height < 64
    || image.width * image.height > 64000000 || Number(image.nb_frames || 1) > 1) throw new ErrorType('IMAGE_INVALID', '图片尺寸无效或过大，请上传至少 64 像素、最多 6400 万像素的单张图片。');
  await execute(runtime.ffmpeg, ['-v', 'error', '-n', '-i', input, '-frames:v', '1', '-vf', 'scale=w=min(4096\\,iw):h=min(4096\\,ih):force_original_aspect_ratio=decrease', '-threads', '1', output]);
  const normalized = (await probe(output, runtime)).streams.find(item => item.codec_type === 'video');
  return { width: normalized.width, height: normalized.height };
}
function cropInfo(image, aspectRatio, motion) {
  const canvas = canvasFor(aspectRatio);
  const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
  const cropX = 1 - canvas.width / (image.width * scale);
  const cropY = 1 - canvas.height / (image.height * scale);
  return { cropX, cropY, extraZoomPercent: motion?.track === 'still' ? 0 : motion?.amount || 0,
    warning: Math.max(cropX, cropY) > 0.15 ? '这张图片与画幅差异较大，请播放片段检查主体与文字是否被裁切。' : '' };
}
function assText(captions, settings, canvas, fontFamily) {
  const style = subtitleStyleFor(settings, settings.aspectRatio);
  const bgr = '&H00' + style.color.slice(5,7) + style.color.slice(3,5) + style.color.slice(1,3);
  const time = ms => {
    const centis = Math.ceil(ms / 10);
    return Math.floor(centis / 360000) + ':' + String(Math.floor(centis / 6000) % 60).padStart(2,'0') + ':'
      + String(Math.floor(centis / 100) % 60).padStart(2,'0') + '.' + String(centis % 100).padStart(2,'0');
  };
  const marginX = Math.round(canvas.width * 0.08), marginY = Math.round(canvas.height * 0.065);
  let previous = 0;
  const events = captions.map(cue => {
    const start = Math.max(previous, cue.startMs);
    if (!(cue.endMs > start)) throw new ErrorType('CAPTION_INVALID', '字幕存在重叠或无效时间点。');
    previous = cue.endMs;
    const text = cue.text.replace(/\\/g, '＼').replace(/{/g, '｛').replace(/}/g, '｝').replace(/[\r\n]+/g, ' ');
    return 'Dialogue: 0,' + time(start) + ',' + time(cue.endMs) + ',Default,,0,0,0,,' + text;
  });
  return ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: ' + canvas.width, 'PlayResY: ' + canvas.height,
    'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,' + fontFamily + ',' + style.fontSize + ',' + bgr + ',&H000000FF,&H00111827,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,' + marginX + ',' + marginX + ',' + marginY + ',1',
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...events, ''].join('\n');
}
function motionFilter(motion, frameCount, canvas) {
  const t = frameCount > 1 ? '(on/' + (frameCount - 1) + ')' : '0';
  const p = motion.easing === 'smooth' ? '(' + t + '*' + t + '*(3-2*' + t + '))' : t;
  const interpolate = (a, b) => '(' + a.toFixed(8) + '+(' + (b-a).toFixed(8) + ')*' + p + ')';
  const zoom = interpolate(motion.start.zoom, motion.end.zoom);
  const x = '(iw-iw/zoom)*' + interpolate(motion.start.x, motion.end.x);
  const y = '(ih-ih/zoom)*' + interpolate(motion.start.y, motion.end.y);
  return 'scale=' + (canvas.width * 2) + ':' + (canvas.height * 2) + ':force_original_aspect_ratio=increase:flags=lanczos,'
    + 'crop=' + (canvas.width * 2) + ':' + (canvas.height * 2) + ','
    + "zoompan=z='" + zoom + "':x='" + x + "':y='" + y + "':d=" + frameCount + ':s=' + canvas.width + 'x' + canvas.height + ':fps=' + FPS;
}
function fragmentIdentity({ scene, image, motion, settings, captions, runtime }) {
  return hash({ renderer: RENDER_VERSION, runtime: runtime.identity, image: image.sha256, motion: motionIdentity(motion),
    frames: scene.frameCount, canvas: canvasFor(settings.aspectRatio), fadeMs: settings.motion.fadeMs,
    captions: settings.burnSubtitles ? captions : [], subtitleStyle: settings.burnSubtitles ? subtitleStyleFor(settings, settings.aspectRatio) : null });
}
async function validateVideo(file, { canvas, frameCount, audio }, runtime) {
  const info = await probe(file, runtime);
  const video = info.streams?.find(item => item.codec_type === 'video');
  const sound = info.streams?.find(item => item.codec_type === 'audio');
  const expectedDurationMs = frameCount * 1000 / FPS;
  if (!video || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || video.width !== canvas.width || video.height !== canvas.height
    || video.r_frame_rate !== FPS + '/1' || Number(video.nb_frames) !== frameCount
    || Math.abs(Number(info.format?.duration) * 1000 - expectedDurationMs) > 100
    || (audio && (sound?.codec_name !== 'aac' || sound?.sample_rate !== '24000' || sound?.channels !== 1))
    || (!audio && sound)) throw new ErrorType('VIDEO_INVALID', '视频时长、帧数、画幅、编码或音轨没有通过验证。');
  await decode(file, runtime);
  return { durationMs: expectedDurationMs, frameCount, width: video.width, height: video.height, fps: FPS,
    codec: video.codec_name, pixelFormat: video.pix_fmt, audio: !!sound, decoded: true };
}
async function renderFragment({ scene, imagePath, motion, settings, captions, directory, runtime }) {
  await fs.mkdir(directory, { recursive: true });
  const name = randomUUID(), output = path.join(directory, name + '.mp4');
  const canvas = canvasFor(settings.aspectRatio);
  const ass = name + '.ass';
  if (settings.burnSubtitles) await fs.writeFile(path.join(directory, ass), assText(captions, settings, canvas, runtime.fontFamily), 'utf8');
  let filter = motionFilter(motion, scene.frameCount, canvas);
  const seconds = scene.frameCount / FPS, fade = Math.min(settings.motion.fadeMs / 1000, seconds / 2);
  if (fade > 0) filter += ',fade=t=in:st=0:d=' + fade + ',fade=t=out:st=' + (seconds-fade) + ':d=' + fade;
  if (settings.burnSubtitles) filter += ',ass=' + ass;
  // JPEG 可携带 full-range 标记；显式转换到视频有限范围，避免输出 yuvj420p。
  filter += ',scale=in_range=auto:out_range=tv,format=yuv420p';
  await execute(runtime.ffmpeg, ['-v', 'error', '-n', '-i', imagePath, '-vf', filter, '-frames:v', String(scene.frameCount),
    '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-threads', '2', '-movflags', '+faststart', output], { cwd: directory });
  return { path: output, validation: await validateVideo(output, { canvas, frameCount: scene.frameCount, audio: false }, runtime) };
}
function concatPath(file) { return "file '" + path.resolve(file).replace(/\\/g, '/').replace(/'/g, "'\\''") + "'"; }
async function concatAudio(files, output, runtime, directory) {
  const list = path.join(directory, randomUUID() + '.audio.txt');
  await fs.writeFile(list, files.map(concatPath).join('\n'), 'utf8');
  await execute(runtime.ffmpeg, ['-v', 'error', '-n', '-f', 'concat', '-safe', '0', '-i', list, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', output]);
  await decode(output, runtime);
  return Math.round(Number((await probe(output, runtime)).format.duration) * 1000);
}
async function compose({ files, narrationPath, settings, frameCount, directory, runtime }) {
  const list = path.join(directory, randomUUID() + '.video.txt'), output = path.join(directory, randomUUID() + '.mp4');
  await fs.writeFile(list, files.map(concatPath).join('\n'), 'utf8');
  const args = ['-v', 'error', '-n', '-f', 'concat', '-safe', '0', '-i', list];
  let index = 1, narrationIndex, bgmIndex, bgm;
  if (narrationPath) { narrationIndex = index++; args.push('-i', narrationPath); }
  if (settings.bgmMode === 'enabled') { bgm = await prepareBackgroundMusic(); bgmIndex = index++; args.push('-stream_loop', '-1', '-i', bgm.path); }
  args.push('-map', '0:v:0', '-c:v', 'copy');
  const duration = frameCount / FPS, filters = [];
  if (narrationIndex != null) filters.push('[' + narrationIndex + ':a]volume=' + (bgm ? bgm.recipe.narrationVolumeDb : 0) + 'dB,apad,atrim=duration=' + duration + '[voice]');
  if (bgmIndex != null) filters.push('[' + bgmIndex + ':a]volume=' + bgm.recipe.musicVolumeDb + 'dB,atrim=duration=' + duration
    + ',afade=t=in:d=' + bgm.recipe.fadeInSeconds + ',afade=t=out:st=' + Math.max(0, duration-bgm.recipe.fadeOutSeconds) + ':d=' + bgm.recipe.fadeOutSeconds + '[music]');
  if (narrationIndex != null && bgmIndex != null) filters.push('[voice][music]amix=inputs=2:duration=first:normalize=0[sound]');
  const label = narrationIndex != null && bgmIndex != null ? '[sound]' : narrationIndex != null ? '[voice]' : '[music]';
  if (filters.length) args.push('-filter_complex', filters.join(';'), '-map', label, '-ac', '1', '-ar', '24000', '-c:a', 'aac', '-b:a', '128k');
  else args.push('-an');
  args.push('-t', String(duration), '-movflags', '+faststart', output);
  await execute(runtime.ffmpeg, args);
  return { path: output, bgm: bgm?.recipe || null, validation: await validateVideo(output, { canvas: canvasFor(settings.aspectRatio), frameCount, audio: filters.length > 0 }, runtime) };
}

module.exports = { execute, preflight, probe, decode, normalizeAudio, imageMime, normalizeImage, cropInfo, assText,
  motionFilter, fragmentIdentity, validateVideo, renderFragment, concatAudio, compose };
