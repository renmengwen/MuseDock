const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sceneTts = require('../server/services/sceneTts');

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-tts-test-'));
  const calls = [];
  const result = await sceneTts.synthesizeSceneTts({
    scenes: [
      { index: 1, narration_text: '（吸气）第一段。' },
      { index: 2, narration_text: '第二段。（稍停顿）' },
    ],
    outputDir: rootDir,
    runId: 'run-1',
    format: 'wav',
    ttsModel: {
      async callTtsModel(payload) {
        calls.push(payload.text);
        return {
          success: true,
          audioBuffer: Buffer.from(`audio:${payload.text}`),
          format: 'wav',
          voice: 'mimo_default',
          model: { provider: 'mock' },
        };
      },
    },
    readAudioDuration: async filePath => {
      const text = fs.readFileSync(filePath, 'utf8');
      return text.includes('第一段') ? 1.1 : 1.9;
    },
    audioQuality: {
      inspectAndCleanAudio: async args => {
        const text = fs.readFileSync(args.inputPath, 'utf8');
        const duration = text.includes('第一段') ? 1.1 : 1.9;
        fs.copyFileSync(args.inputPath, args.outputPath);
        return {
          success: true,
          path: args.outputPath,
          raw_path: args.inputPath,
          raw_duration_sec: duration,
          speech_duration_sec: duration,
          tail_silence_sec: 0,
          trimmed: false,
        };
      },
    },
    concatenateAudioFiles: async ({ inputPaths, targetPath }) => {
      fs.writeFileSync(
        targetPath,
        inputPaths.map(item => fs.readFileSync(item, 'utf8')).join('|'),
      );
      return { success: true };
    },
  });

  assert.equal(result.success, true);
  assert.deepEqual(calls, ['第一段。', '第二段。']);
  assert.equal(result.scene_tts.status, 'done');
  assert.equal(result.scene_tts.scenes.length, 2);
  assert.equal(result.scene_tts.scenes[0].duration, 1.1);
  assert.equal(result.scene_tts.scenes[0].captions[0].text, '第一段。');
  assert.equal(result.scene_tts.scenes[0].narration_text, '第一段。');
  assert.equal(result.scene_tts.scenes[1].narration_text, '第二段。');
  assert.equal(path.basename(result.scene_tts.path), 'run-1-tts.wav');
  assert.ok(fs.existsSync(result.scene_tts.path));

  const voiceCalls = [];
  const fallbackVoiceResult = await sceneTts.synthesizeSceneTts({
    scenes: [
      { index: 1, narration_text: '测试旁白。' },
    ],
    outputDir: rootDir,
    runId: 'run-voice',
    format: 'wav',
    voice: 'mimo_male_techvoice',
    ttsModel: {
      async callTtsModel(payload) {
        voiceCalls.push(payload.voice);
        return {
          success: true,
          audioBuffer: Buffer.from('audio'),
          format: 'wav',
          voice: payload.voice,
          model: { provider: 'mock' },
        };
      },
    },
    readAudioDuration: async () => 1,
    audioQuality: {
      inspectAndCleanAudio: async args => {
        fs.copyFileSync(args.inputPath, args.outputPath);
        return {
          success: true,
          path: args.outputPath,
          raw_path: args.inputPath,
          raw_duration_sec: 1,
          speech_duration_sec: 1,
          tail_silence_sec: 0,
          trimmed: false,
        };
      },
    },
    concatenateAudioFiles: async ({ targetPath }) => {
      fs.writeFileSync(targetPath, 'audio');
      return { success: true };
    },
  });

  assert.equal(fallbackVoiceResult.success, true);
  assert.deepEqual(voiceCalls, ['mimo_default']);
  assert.equal(fallbackVoiceResult.scene_tts.voice, 'mimo_default');

  const qualityCalls = [];
  const qualityResult = await sceneTts.synthesizeSceneTts({
    scenes: [{ index: 1, duration: 9, narration_text: '测试旁白。' }],
    outputDir: rootDir,
    runId: 'run-quality',
    readAudioDuration: async () => 231.04,
    ttsModel: {
      callTtsModel: async () => ({
        success: true,
        audioBuffer: Buffer.from('fake audio'),
        format: 'wav',
        model: { model_id: 'tts-test' },
      }),
    },
    audioQuality: {
      inspectAndCleanAudio: async args => {
        qualityCalls.push(args);
        return {
          success: true,
          path: args.outputPath || args.inputPath,
          raw_path: args.inputPath,
          raw_duration_sec: 231.04,
          speech_duration_sec: 13.996,
          tail_silence_sec: 217.113,
          trimmed: true,
        };
      },
    },
    concatenateAudioFiles: async ({ targetPath }) => {
      fs.writeFileSync(targetPath, 'combined');
      return { success: true };
    },
  });

  assert.equal(qualityResult.success, true);
  assert.equal(qualityResult.scene_tts.scenes[0].duration, 13.996);
  assert.equal(qualityResult.scene_tts.scenes[0].speech_duration_sec, 13.996);
  assert.equal(qualityResult.scene_tts.scenes[0].raw_duration_sec, 231.04);
  assert.equal(qualityResult.scene_tts.scenes[0].trimmed, true);
  assert.equal(qualityCalls.length, 1);
  assert.equal(typeof qualityCalls[0].runCommand, 'function');
  assert.equal(typeof qualityCalls[0].getFfprobeCommand, 'function');
  assert.equal(typeof qualityCalls[0].getFfmpegCommand, 'function');

  const reportedFailureScenes = [
    { index: 1, id: 'scene_01', duration: 7, narration_text: '第一段。' },
    { index: 2, id: 'scene_04', duration: 9, narration_text: '他用 Claude Code 搭建了一套 Python 工具。' },
  ];
  const reportedFailureResult = await sceneTts.synthesizeSceneTts({
    scenes: reportedFailureScenes,
    outputDir: rootDir,
    runId: 'run-reported-failure',
    format: 'wav',
    ttsModel: {
      callTtsModel: async payload => ({
        success: true,
        audioBuffer: Buffer.from(`audio:${payload.text}`),
        format: 'wav',
        model: { model_id: 'tts-test' },
      }),
    },
    audioQuality: {
      inspectAndCleanAudio: async args => {
        const text = fs.readFileSync(args.inputPath, 'utf8');
        const isLongTailScene = text.includes('Claude Code');
        fs.copyFileSync(args.inputPath, args.outputPath);
        return {
          success: true,
          path: args.outputPath,
          raw_path: args.inputPath,
          raw_duration_sec: isLongTailScene ? 231.04 : 7,
          speech_duration_sec: isLongTailScene ? 13.996 : 7,
          tail_silence_sec: isLongTailScene ? 217.544 : 0,
          trimmed: isLongTailScene,
        };
      },
    },
    concatenateAudioFiles: async ({ targetPath }) => {
      fs.writeFileSync(targetPath, 'combined');
      return { success: true };
    },
  });

  assert.equal(reportedFailureResult.success, true);
  const reportedFailureScene04 = reportedFailureResult.scene_tts.scenes.find(scene => scene.id === 'scene_04');
  assert.ok(reportedFailureScene04);
  assert.equal(reportedFailureScene04.raw_duration_sec, 231.04);
  assert.equal(reportedFailureScene04.speech_duration_sec, 13.996);
  assert.equal(reportedFailureScene04.duration, 13.996);
  assert.equal(reportedFailureScene04.trimmed, true);
  assert.ok(reportedFailureScene04.tail_silence_sec > 200);

  const invalidDurationResult = await sceneTts.synthesizeSceneTts({
    scenes: [{ index: 1, duration: 9, narration_text: '测试旁白。' }],
    outputDir: rootDir,
    runId: 'run-invalid-duration',
    ttsModel: {
      callTtsModel: async () => ({
        success: true,
        audioBuffer: Buffer.from('fake audio'),
        format: 'wav',
        model: { model_id: 'tts-test' },
      }),
    },
    audioQuality: {
      inspectAndCleanAudio: async () => ({
        success: true,
        speech_duration_sec: NaN,
      }),
    },
    concatenateAudioFiles: async ({ targetPath }) => {
      fs.writeFileSync(targetPath, 'combined');
      return { success: true };
    },
  });

  assert.equal(invalidDurationResult.success, false);
  assert.equal(invalidDurationResult.code, 'tts_speech_duration_invalid');
  assert.equal(invalidDurationResult.message, '第 1 幕配音时长无效。');
  assert.equal(invalidDurationResult.scene_index, 1);

  fs.rmSync(rootDir, { recursive: true, force: true });
}

run().then(() => {
  console.log('scene tts tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
