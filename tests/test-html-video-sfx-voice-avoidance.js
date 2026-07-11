const assert = require('assert');
const {
  buildVoiceWindowsFromProject,
  applyVoiceAvoidance,
} = require('../server/services/creative-video/html-video/sfxEventService');

// (1) 从 project.frames[].captions 推导全片 voice windows（帧内相对时间 + 帧起点累计偏移）
{
  const project = {
    frames: [
      { id: 'scene_01_b1', duration_sec: 6.38, captions: [{ start: 0.2, end: 3.1, text: 'a' }] },
      { id: 'scene_01_b2', duration_sec: 6.37, captions: [{ start: 0.0, end: 5.9, text: 'b' }] },
      { id: 'scene_02_b1', duration_sec: 5.67, captions: [] },
    ],
  };
  const windows = buildVoiceWindowsFromProject(project);
  assert.deepStrictEqual(windows, [
    { start: 0.2, end: 3.1 },
    { start: 6.38, end: 12.28 },
  ]);
}

// (2) 避让/ducking/限额
const voiceWindows = [
  { start: 45.47, end: 51.2 },
  { start: 51.44, end: 57.1 },
];
const events = [
  { id: 'sfx_001', scene_id: 'scene_04', time_sec: 0.03, global_time_sec: 45.5, intensity: 'high',   volume_db: -14, enabled: true }, // voice_start±0.35s => 移除
  { id: 'sfx_002', scene_id: 'scene_04', time_sec: 2.53, global_time_sec: 48.0, intensity: 'medium', volume_db: -18, enabled: true }, // 旁白活跃 => volume_db 再 -8
  { id: 'sfx_003', scene_id: 'scene_04', time_sec: 7.03, global_time_sec: 52.5, intensity: 'high',   volume_db: -14, enabled: true },
  { id: 'sfx_004', scene_id: 'scene_04', time_sec: 8.53, global_time_sec: 54.0, intensity: 'high',   volume_db: -14, enabled: true },
  { id: 'sfx_005', scene_id: 'scene_04', time_sec: 10.0, global_time_sec: 55.5, intensity: 'high',   volume_db: -14, enabled: true }, // 每 scene high 超过 2 => 丢弃
  { id: 'sfx_006', scene_id: 'scene_05', time_sec: 1.00, global_time_sec: 60.0, intensity: 'low',    volume_db: -20, enabled: true }, // 无旁白 => 原样
];

const result = applyVoiceAvoidance(events, voiceWindows, {
  avoidStartSec: 0.35, duckDb: 8, maxHighPerScene: 2,
});

const keptIds = result.kept.map(e => e.id);
assert.ok(!keptIds.includes('sfx_001'), '旁白起始 ±0.35s 内的 SFX 必须移除');
assert.ok(!keptIds.includes('sfx_005'), '每 scene intensity=high 上限 2');
assert.strictEqual(result.kept.find(e => e.id === 'sfx_002').volume_db, -26, '旁白活跃期 volume_db 再降 8dB');
assert.strictEqual(result.kept.find(e => e.id === 'sfx_003').volume_db, -22, '52.5s 落在窗口 [51.44,57.1] 内，duck 后 -14-8=-22');
assert.strictEqual(result.kept.find(e => e.id === 'sfx_004').volume_db, -22);
assert.strictEqual(result.kept.find(e => e.id === 'sfx_006').volume_db, -20, '无旁白事件音量不变');
assert.deepStrictEqual(result.dropped.map(d => d.id).sort(), ['sfx_001', 'sfx_005']);
assert.ok(result.dropped.every(d => typeof d.reason === 'string' && d.reason.length > 0));

// (3) 硬约束 A 回归：voiceWindows 为空（旧调用形态）时事件原样返回、volume_db 不动
{
  const passthrough = applyVoiceAvoidance(events, [], {});
  assert.strictEqual(passthrough.kept.length, events.length);
  assert.deepStrictEqual(passthrough.kept.map(e => e.volume_db), events.map(e => e.volume_db));
  assert.strictEqual(passthrough.dropped.length, 0);
}
console.log('sfx voice avoidance tests passed');
