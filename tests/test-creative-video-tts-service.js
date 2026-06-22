const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const tts = require('../server/services/creative-video/ttsService');
const {
  audioMatchesSceneSpec,
  computeSceneSpecSpeechHash,
} = require('../server/services/creative-video/sceneSpecHash');

(async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'creative-video-tts-'));
  const calls = [];
  const sceneSpec = {
    scenes: [
      { id: 'scene_01', narration_text: '第一段旁白' },
      { id: 'scene_02', narration_text: '第二段旁白' },
    ],
  };
  const result = await tts.synthesizeSceneNarration({
    projectDir,
    sceneSpec,
    services: {
      ttsModel: {
        callTtsModel: async ({ text }) => {
          calls.push(text);
          return { success: true, audioBuffer: Buffer.from(`audio:${text}`), format: 'mp3', voice: 'test_voice', model: {} };
        },
      },
      readAudioDuration: async () => 1.5,
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.audio_manifest.scenes.length, 2);
  assert.equal(result.audio_manifest.source, 'scene_spec');
  assert.equal(result.audio_manifest.scene_spec_hash, computeSceneSpecSpeechHash(sceneSpec));
  assert.equal(result.audio_manifest.scene_count, sceneSpec.scenes.length);
  assert.deepEqual(result.audio_manifest.scene_ids, sceneSpec.scenes.map(scene => scene.id));
  assert.equal(result.audio_manifest.status, 'ready');
  assert.equal(calls.length, 2);
  assert.ok(result.audio_manifest.scenes[0].path.endsWith('scene_01.mp3'));
  assert.equal(result.audio_manifest.scenes[0].relative_path, 'tts/scene_01.mp3');
  assert.equal(await fs.readFile(result.audio_manifest.scenes[0].path, 'utf8'), 'audio:第一段旁白');
  assert.ok(await fs.readFile(path.join(projectDir, 'tts', 'audio_manifest.json'), 'utf8'));

  const local = await tts.synthesizeSceneNarration({
    projectDir,
    sceneSpec: {
      scenes: [
        { id: 'scene_01', narration_text: '第一段旁白' },
        { id: 'scene_02', narration_text: '第二段旁白' },
      ],
    },
    sceneId: 'scene_02',
    services: {
      ttsModel: {
        callTtsModel: async ({ text }) => ({ success: true, audioBuffer: Buffer.from(`local:${text}`), format: 'mp3' }),
      },
      readAudioDuration: async () => 2,
    },
  });
  assert.equal(local.success, true);
  assert.equal(local.audio_manifest.scenes.length, 1);
  assert.equal(local.audio_manifest.scenes[0].scene_id, 'scene_02');

  await fs.writeFile(path.join(projectDir, 'tts', 'scene_01.mp3'), 'old audio');
  const failed = await tts.synthesizeSceneNarration({
    projectDir,
    sceneSpec: {
      scenes: [
        { id: 'scene_01', narration_text: '第一段旁白' },
        { id: 'scene_02', narration_text: '第二段旁白' },
      ],
    },
    services: {
      ttsModel: {
        callTtsModel: async ({ text }) => (
          text.includes('第二段') ? { success: false, message: '失败' } : { success: true, audioBuffer: Buffer.from('new audio'), format: 'mp3' }
        ),
      },
      readAudioDuration: async () => 1,
    },
  });
  assert.equal(failed.success, false);
  assert.equal(failed.audio_manifest.status, 'failed');
  assert.equal(await fs.readFile(path.join(projectDir, 'tts', 'scene_01.mp3'), 'utf8'), 'old audio');

  const emptyProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tts-empty-'));
  const emptySpec = {
    scenes: [
      { id: 'scene_01', order: 1, narration_text: '', captions: [{ text: '只显示字幕' }] },
      { id: 'scene_02', order: 2, narration_text: '   ', captions: [] },
    ],
  };
  const emptyNarration = await tts.synthesizeSceneNarration({
    projectDir: emptyProjectDir,
    sceneSpec: emptySpec,
    services: {
      ttsModel: {
        callTtsModel: async () => { throw new Error('空旁白不应调用 TTS'); },
      },
    },
  });
  assert.equal(emptyNarration.success, true);
  assert.equal(emptyNarration.audio_manifest.source, 'scene_spec');
  assert.equal(emptyNarration.audio_manifest.scene_spec_hash, computeSceneSpecSpeechHash(emptySpec));
  assert.equal(emptyNarration.audio_manifest.scene_count, 2);
  assert.deepEqual(emptyNarration.audio_manifest.scene_ids, ['scene_01', 'scene_02']);
  assert.equal(emptyNarration.audio_manifest.status, 'ready');
  assert.deepEqual(emptyNarration.audio_manifest.scenes, []);
  assert.ok(emptyNarration.message.includes('没有可生成'));

  const missingIdProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tts-missing-id-'));
  const missingIdSpec = {
    scenes: [
      { order: 1, narration_text: '', captions: [{ text: '第一幕' }] },
      { order: 2, narration_text: '   ', captions: [{ text: '第二幕' }] },
    ],
  };
  const missingIdEmptyNarration = await tts.synthesizeSceneNarration({
    projectDir: missingIdProjectDir,
    sceneSpec: missingIdSpec,
    services: {
      ttsModel: {
        callTtsModel: async () => { throw new Error('空旁白不应调用 TTS'); },
      },
    },
  });
  assert.equal(missingIdEmptyNarration.success, true);
  assert.deepEqual(missingIdEmptyNarration.audio_manifest.scene_ids, ['scene_01', 'scene_02']);
  assert.equal(missingIdEmptyNarration.audio_manifest.status, 'ready');
  assert.equal(audioMatchesSceneSpec({
    ...missingIdEmptyNarration.audio_manifest,
    narration_path: 'tts/current.wav',
  }, missingIdSpec), true);

  const mappedFormat = await tts.synthesizeSceneNarration({
    projectDir,
    sceneSpec: { scenes: [{ id: 'scene_audio_mpeg', narration_text: '格式测试' }] },
    services: {
      ttsModel: {
        callTtsModel: async () => ({ success: true, audioBuffer: Buffer.from('mpeg'), format: 'audio/mpeg' }),
      },
      readAudioDuration: async () => 1,
    },
  });
  assert.equal(mappedFormat.audio_manifest.scenes[0].format, 'mp3');
  assert.ok(mappedFormat.audio_manifest.scenes[0].path.endsWith('scene_audio_mpeg.mp3'));

  const collision = await tts.synthesizeSceneNarration({
    projectDir,
    sceneSpec: {
      scenes: [
        { id: 'scene/01', narration_text: '碰撞一' },
        { id: 'scene\\01', narration_text: '碰撞二' },
      ],
    },
    services: {
      ttsModel: {
        callTtsModel: async ({ text }) => ({ success: true, audioBuffer: Buffer.from(text), format: 'mp3' }),
      },
      readAudioDuration: async () => 1,
    },
  });
  assert.equal(new Set(collision.audio_manifest.scenes.map(scene => scene.path)).size, 2);

  console.log('creative video tts service tests passed');
})();
