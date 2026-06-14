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
      { index: 1, narration_text: '第一段。' },
      { index: 2, narration_text: '第二段。' },
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
    concatenateAudioFiles: async ({ targetPath }) => {
      fs.writeFileSync(targetPath, 'audio');
      return { success: true };
    },
  });

  assert.equal(fallbackVoiceResult.success, true);
  assert.deepEqual(voiceCalls, ['mimo_default']);
  assert.equal(fallbackVoiceResult.scene_tts.voice, 'mimo_default');

  fs.rmSync(rootDir, { recursive: true, force: true });
}

run().then(() => {
  console.log('scene tts tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
