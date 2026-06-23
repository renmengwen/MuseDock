const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const composer = require('../server/services/creative-video/html-video/ffmpegComposer');

(async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-ffmpeg-'));
  const commands = [];
  const runCommand = async (command, args) => {
    if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
      return { ok: false, code: 1, stdout: '', stderr: '' };
    }
    commands.push({ command, args });
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const demuxerOutput = path.join(workDir, 'exports/output.mp4');
  const demuxer = await composer.concatFramesWithFfmpeg([
    { path: path.join(workDir, 'frames/01.mp4'), engine: 'hyperframes-playwright', encoding: 'h264-yuv420p-crf20' },
    { path: path.join(workDir, 'frames/02.mp4'), engine: 'hyperframes-playwright', encoding: 'h264-yuv420p-crf20' },
  ], demuxerOutput, workDir, { runCommand });

  assert.equal(demuxer.success, true);
  assert.equal(demuxer.strategy, 'concat-demuxer');
  assert.deepEqual(commands[0].args, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', path.join(workDir, 'frames/concat.txt'),
    '-c', 'copy',
    demuxerOutput,
  ]);
  const concatList = await fs.readFile(path.join(workDir, 'frames/concat.txt'), 'utf8');
  assert.ok(concatList.includes("file '"));
  assert.ok(concatList.includes('/frames/01.mp4') || concatList.includes('frames/01.mp4'));

  const filterOutput = path.join(workDir, 'exports/filter-output.mp4');
  const filter = await composer.concatFramesWithFfmpeg([
    { path: path.join(workDir, 'frames/01.mp4'), engine: 'hyperframes-playwright', encoding: 'h264-yuv420p-crf20' },
    { path: path.join(workDir, 'frames/02.mp4'), engine: 'other-engine', encoding: 'vp9' },
  ], filterOutput, workDir, { runCommand, fps: 30 });

  assert.equal(filter.success, true);
  assert.equal(filter.strategy, 'concat-filter');
  assert.deepEqual(commands[1].args, [
    '-y',
    '-i', path.join(workDir, 'frames/01.mp4'),
    '-i', path.join(workDir, 'frames/02.mp4'),
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-movflags', '+faststart',
    filterOutput,
  ]);

  const muxOutput = path.join(workDir, 'exports/muxed.mp4');
  const mux = await composer.muxAudioWithFfmpeg({
    videoPath: filterOutput,
    outputPath: muxOutput,
    musicPath: path.join(workDir, 'music.mp3'),
    narrationPath: path.join(workDir, 'narration.wav'),
    musicVolumeDb: -18,
    narrationVolumeDb: 0,
    fadeInSec: 0.2,
    fadeOutSec: 1.5,
    videoDurationSec: 6,
    runCommand,
  });

  assert.equal(mux.success, true);
  assert.deepEqual(commands[2].args.slice(0, 7), [
    '-y',
    '-i', filterOutput,
    '-i', path.join(workDir, 'narration.wav'),
    '-i', path.join(workDir, 'music.mp3'),
  ]);
  assert.ok(commands[2].args.includes('-filter_complex'));
  const filterComplex = commands[2].args[commands[2].args.indexOf('-filter_complex') + 1];
  assert.ok(filterComplex.includes('volume=0dB'));
  assert.ok(filterComplex.includes('volume=-18dB'));
  assert.ok(filterComplex.includes('afade=t=in:st=0:d=0.2'));
  assert.ok(filterComplex.includes('afade=t=out:st=4.5:d=1.5'));
  assert.ok(filterComplex.includes('amix=inputs=2:duration=longest:dropout_transition=0[mixed]'));
  assert.ok(filterComplex.includes('[mixed]apad=whole_dur=6[aout]'));
  assert.deepEqual(commands[2].args.slice(-9), [
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    muxOutput,
  ].slice(-9));
  assert.ok(commands[2].args.includes('-shortest'));

  const noAudio = await composer.muxAudioWithFfmpeg({
    videoPath: filterOutput,
    outputPath: path.join(workDir, 'exports/no-audio.mp4'),
    runCommand,
  });
  assert.equal(noAudio.success, true);
  assert.equal(noAudio.skipped, true);

  const probe = await composer.verifyDurationWithFfprobe({
    videoPath: filterOutput,
    expectedDurationSec: 6,
    toleranceSec: 0.5,
    ffprobePath: 'ffprobe-test',
    runCommand: async (command, args) => {
      assert.equal(command, 'ffprobe-test');
      assert.deepEqual(args, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filterOutput,
      ]);
      return { ok: true, stdout: '6.2\n', stderr: '' };
    },
  });
  assert.equal(probe.success, true);
  assert.equal(probe.duration_sec, 6.2);

  const durationMismatch = await composer.verifyDurationWithFfprobe({
    videoPath: filterOutput,
    expectedDurationSec: 6,
    toleranceSec: 0.25,
    ffprobePath: 'ffprobe-test',
    runCommand: async () => ({ ok: true, stdout: '7.1\n', stderr: '' }),
  });
  assert.equal(durationMismatch.success, false);
  assert.equal(durationMismatch.code, 'duration_mismatch');
  assert.match(durationMismatch.message, /时长偏差/);

  const ffmpegDir = path.join(workDir, 'bin');
  const foundFfmpeg = path.join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const expectedFfprobe = path.join(ffmpegDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  await fs.mkdir(ffmpegDir, { recursive: true });
  await fs.writeFile(expectedFfprobe, 'ffprobe');
  const resolvedProbe = await composer.verifyDurationWithFfprobe({
    videoPath: filterOutput,
    expectedDurationSec: 6,
    toleranceSec: 0.5,
    runCommand: async (command, args) => {
      if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
        assert.deepEqual(args, ['ffmpeg']);
        return { ok: true, stdout: `${foundFfmpeg}\n`, stderr: '' };
      }
      assert.equal(command, expectedFfprobe);
      return { ok: true, stdout: '6.0\n', stderr: '' };
    },
  });
  assert.equal(resolvedProbe.success, true);
  assert.equal(resolvedProbe.duration_sec, 6);

  const narrationTrack = await composer.concatAudioWithFfmpeg([
    { path: path.join(workDir, 'tts/scene_01.mp3') },
    { path: path.join(workDir, 'tts/scene_02.mp3') },
  ], path.join(workDir, 'exports/narration.mp3'), workDir, { runCommand });
  assert.equal(narrationTrack.success, true);
  assert.deepEqual(commands[3].args, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', path.join(workDir, 'audio/concat.txt'),
    '-c', 'copy',
    path.join(workDir, 'exports/narration.mp3'),
  ]);

  console.log('html-video ffmpeg composer tests passed');
})();
