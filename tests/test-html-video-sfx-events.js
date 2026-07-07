const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sfxEvents = require('../server/services/creative-video/html-video/sfxEventService');

async function run() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-video-sfx-events-'));
  fs.mkdirSync(path.join(projectDir, 'audio'), { recursive: true });

  const project = {
    frames: [
      { id: 'scene_01', scene_id: 'scene_01', order: 1, duration_sec: 3 },
      { id: 'scene_02', scene_id: 'scene_02', order: 2, duration_sec: 4 },
    ],
  };
  const sceneSpec = {
    scenes: [
      { id: 'scene_01', duration_sec: 3 },
      { id: 'scene_02', duration_sec: 4 },
    ],
  };
  const library = {
    items: [
      { id: 'mixkit-whoosh-fast-transition', file: 'mixkit/whoosh/mixkit-whoosh-fast-transition.wav', title: 'Whoosh', tags: ['whoosh'], default_volume_db: -16 },
      { id: 'mixkit-impact-blow', file: 'mixkit/impact/mixkit-impact-blow.wav', title: 'Impact', tags: ['impact'], default_volume_db: -12 },
    ],
  };

  const normalized = sfxEvents.normalizeSfxEvents({
    aiEvents: [
      { scene_id: 'scene_01', time_sec: 0.2, sfx_id: 'missing', confidence: 0.9 },
      { scene_id: 'scene_01', time_sec: 0.3, sfx_id: 'mixkit-whoosh-fast-transition', confidence: 0.2 },
      { scene_id: 'scene_01', time_sec: 0.2, sfx_id: 'mixkit-whoosh-fast-transition', label_zh: '', reason: '', intensity: 'loud', volume_db: -99, confidence: 0.8 },
      { scene_id: 'scene_01', time_sec: 0.8, sfx_id: 'mixkit-impact-blow', intensity: 'high', volume_db: -1, confidence: 0.9 },
      { scene_id: 'scene_01', time_sec: 0.5, sfx_id: 'mixkit-impact-blow', intensity: 'high', confidence: 0.9 },
      { scene_id: 'scene_99', time_sec: 0.2, sfx_id: 'mixkit-impact-blow', confidence: 0.9 },
      { scene_id: 'scene_02', time_sec: 1, sfx_id: 'mixkit-whoosh-fast-transition', confidence: 0.9 },
      { scene_id: 'scene_02', time_sec: 1.7, sfx_id: 'mixkit-impact-blow' },
      { scene_id: 'scene_02', time_sec: 4, sfx_id: 'mixkit-impact-blow', confidence: 0.9 },
    ],
    project,
    sceneSpec,
    library,
  });

  assert.equal(normalized.events.length, 3);
  assert.equal(normalized.events[0].id, 'sfx_001');
  assert.equal(normalized.events[0].label_zh, '嗖入场');
  assert.equal(normalized.events[0].volume_db, -28);
  assert.equal(normalized.events[1].volume_db, -10);
  assert.equal(normalized.events[2].global_time_sec, 4);
  // 未知场景（scene_99）被丢弃，不允许锚到全局 0 点
  assert.ok(normalized.events.every(event => event.scene_id !== 'scene_99'));

  // 无场景时总量上限为 0：不接受任何事件
  const empty = sfxEvents.normalizeSfxEvents({
    aiEvents: [{ scene_id: 'scene_01', time_sec: 0.2, sfx_id: 'mixkit-whoosh-fast-transition', confidence: 0.9 }],
    project: {},
    sceneSpec: {},
    library,
  });
  assert.equal(empty.events.length, 0);

  // 旁白密集场景（>=5 字/秒）音量自动下调 3dB
  const dense = sfxEvents.normalizeSfxEvents({
    aiEvents: [{ scene_id: 'scene_01', time_sec: 0.2, sfx_id: 'mixkit-whoosh-fast-transition', confidence: 0.9 }],
    project: {},
    sceneSpec: { scenes: [{ id: 'scene_01', duration_sec: 3, narration_text: '这一句旁白特别长信息密度非常高一直在说话' }] },
    library,
  });
  assert.equal(dense.events[0].volume_db, -19);

  const rules = sfxEvents.getPlanningRules(project, sceneSpec);
  assert.equal(rules.max_events_per_scene, 2);
  assert.equal(rules.max_total_events, 4);
  assert.equal(rules.min_strong_gap_sec, 3);

  const updated = sfxEvents.disableSfxEvent({
    project: { audio: { sfx: { events: normalized.events } } },
    eventId: 'sfx_001',
  });
  assert.equal(updated.success, true);
  assert.equal(updated.project.audio.sfx.events[0].enabled, false);

  const missing = sfxEvents.disableSfxEvent({
    project: updated.project,
    eventId: 'missing',
  });
  assert.equal(missing.success, false);
  assert.equal(missing.code, 'SFX_EVENT_NOT_FOUND');

  updated.project.audio.sfx.library_version = 3;
  await sfxEvents.persistProjectSfxMirror(projectDir, updated.project);
  const mirror = JSON.parse(fs.readFileSync(path.join(projectDir, 'audio', 'sfx-events.json'), 'utf8'));
  assert.equal(mirror.version, 1);
  assert.equal(mirror.library_version, 3);
  assert.ok(mirror.generated_at);
  assert.equal(mirror.events[0].enabled, false);

  // resolveProjectSfxEventsForMux：最终入口仍校验白名单/置信度/音量；文件缺失进 dropped
  fs.mkdirSync(path.join(projectDir, 'audio', 'sfx'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'audio', 'sfx', 'hit.wav'), 'sfx');
  const muxValid = sfxEvents.resolveProjectSfxEventsForMux({
    project: { audio: { sfx: { enabled: true, events: [{ id: 'sfx_ok', sfx_id: 'mixkit-impact-blow', asset_path: 'audio/sfx/hit.wav', global_time_sec: 1, volume_db: 20, confidence: 0.9, enabled: true }] } } },
    projectDir,
  });
  assert.equal(muxValid.events.length, 1);
  assert.equal(muxValid.events[0].volume_db, -10);
  const muxResolved = sfxEvents.resolveProjectSfxEventsForMux({
    project: { audio: { sfx: { enabled: true, events: [{ id: 'sfx_001', sfx_id: 'mixkit-impact-blow', asset_path: 'audio/sfx/none.wav', global_time_sec: 1, volume_db: -16, confidence: 0.9, enabled: true }] } } },
    projectDir,
  });
  assert.equal(muxResolved.events.length, 0);
  assert.equal(muxResolved.dropped.length, 1);
  assert.match(muxResolved.dropped[0].reason, /素材文件缺失/);
  const muxDisabled = sfxEvents.resolveProjectSfxEventsForMux({
    project: { audio: { sfx: { enabled: false, events: [{ id: 'sfx_001', sfx_id: 'mixkit-impact-blow', asset_path: 'audio/sfx/none.wav', global_time_sec: 1, enabled: true }] } } },
    projectDir,
  });
  assert.equal(muxDisabled.events.length, 0);
  assert.equal(muxDisabled.dropped.length, 0);
  const lowConfidenceMux = sfxEvents.resolveProjectSfxEventsForMux({
    project: { audio: { sfx: { enabled: true, events: [{ id: 'sfx_low', sfx_id: 'mixkit-impact-blow', asset_path: 'audio/sfx/hit.wav', global_time_sec: 1, confidence: 0.2 }] } } },
    projectDir,
  });
  assert.equal(lowConfidenceMux.events.length, 0);
  assert.match(lowConfidenceMux.dropped[0].reason, /置信度/);

  const manyScenes = Array.from({ length: 10 }, (_, index) => ({
    id: `scene_${String(index + 1).padStart(2, '0')}`,
    duration_sec: 3,
  }));
  const capped = sfxEvents.normalizeSfxEvents({
    aiEvents: manyScenes.flatMap(scene => [
      { scene_id: scene.id, time_sec: 0, sfx_id: 'mixkit-whoosh-fast-transition', confidence: 0.9 },
      { scene_id: scene.id, time_sec: 1, sfx_id: 'mixkit-impact-blow', confidence: 0.9 },
    ]),
    sceneSpec: { scenes: manyScenes },
    library,
  });
  assert.equal(capped.events.length, 18);

  console.log('html-video sfx events tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
