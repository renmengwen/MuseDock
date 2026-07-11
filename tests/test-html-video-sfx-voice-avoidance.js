const assert = require('assert');
const {
  buildVoiceWindowsFromProject,
  applyVoiceAvoidance,
} = require('../server/services/creative-video/html-video/sfxEventService');

// (1) 从 project.frames[].captions 推导全片 voice windows（帧内相对时间 + 帧起点累计偏移）
// scene_02_b1 用 duration 键、scene_02_b2 用 duration_sec 键，锁定 duration_sec ?? durationSec ?? duration 回退链
{
  const project = {
    frames: [
      { id: 'scene_01_b1', duration_sec: 6.38, captions: [{ start: 0.2, end: 3.1, text: 'a' }] },
      { id: 'scene_01_b2', duration_sec: 6.37, captions: [{ start: 0.0, end: 5.9, text: 'b' }] },
      { id: 'scene_02_b1', duration: 5.67, captions: [] },
      { id: 'scene_02_b2', duration_sec: 4, captions: [{ start: 1.0, end: 2.0, text: 'c' }] },
    ],
  };
  const windows = buildVoiceWindowsFromProject(project);
  assert.deepStrictEqual(windows, [
    { start: 0.2, end: 3.1 },
    { start: 6.38, end: 12.28 },
    { start: 19.42, end: 20.42 },
  ]);
}

// (2) 避让/ducking/限额
const voiceWindows = [
  { start: 45.47, end: 51.2 },
  { start: 51.44, end: 57.1 },
];
const events = [
  { id: 'sfx_001', scene_id: 'scene_04', sfx_id: 'ui_pop', reason: 'AI 放置理由', time_sec: 0.03, global_time_sec: 45.5, intensity: 'high',   volume_db: -14, enabled: true }, // voice_start±0.35s => 移除
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

// (2b) dropped 最小契约：只含 id/scene_id/sfx_id/reason 四键，不带出 enabled 等全量字段，
// 且丢弃原因不被事件自带的 AI reason 干扰（也不覆盖原事件对象）
for (const d of result.dropped) {
  assert.deepStrictEqual(Object.keys(d).sort(), ['id', 'reason', 'scene_id', 'sfx_id']);
  assert.ok(!('enabled' in d), 'dropped 条目不得带出 enabled，避免下游误持久化复活事件');
}
assert.notStrictEqual(result.dropped.find(d => d.id === 'sfx_001').reason, 'AI 放置理由', 'dropped.reason 是丢弃原因而非事件自带 reason');
assert.strictEqual(events.find(e => e.id === 'sfx_001').reason, 'AI 放置理由', '原事件的 AI reason 不被修改');

// (2c) high 限额确定性：乱序输入时按 global_time_sec 升序保留时间最早的 N 个
{
  const shuffled = [
    { id: 'h3', scene_id: 'scene_06', global_time_sec: 63, intensity: 'high', volume_db: -14 },
    { id: 'h1', scene_id: 'scene_06', global_time_sec: 61, intensity: 'high', volume_db: -14 },
    { id: 'h2', scene_id: 'scene_06', global_time_sec: 62, intensity: 'high', volume_db: -14 },
  ];
  const r = applyVoiceAvoidance(shuffled, [{ start: 0, end: 1 }], { maxHighPerScene: 2 });
  assert.deepStrictEqual(r.kept.map(e => e.id), ['h1', 'h2'], '限额保留时间最早的 2 个，kept 按时间序输出');
  assert.deepStrictEqual(r.dropped.map(d => d.id), ['h3']);
}

// (2d) 边界：乱序 + 重叠 voiceWindows；事件缺 global_time_sec 时归 0 判定
{
  const messyWindows = [
    { start: 10, end: 15 },
    { start: 5, end: 12 }, // 乱序且与上一窗口重叠
  ];
  const edgeEvents = [
    { id: 'w1', scene_id: 's', global_time_sec: 11, intensity: 'low', volume_db: -18 }, // 落在重叠区 => duck 一次
    { id: 'w2', scene_id: 's', global_time_sec: 5.2, intensity: 'low', volume_db: -18 }, // 距 start=5 仅 0.2s => 移除
    { id: 'w3', scene_id: 's', intensity: 'low', volume_db: -18 }, // 缺 global_time_sec => 归 0：远离所有窗口 => 原样保留
  ];
  const r = applyVoiceAvoidance(edgeEvents, messyWindows, {});
  assert.deepStrictEqual(r.dropped.map(d => d.id), ['w2']);
  assert.strictEqual(r.kept.find(e => e.id === 'w1').volume_db, -26, '重叠窗口只 duck 一次');
  assert.strictEqual(r.kept.find(e => e.id === 'w3').volume_db, -18, '缺 global_time_sec 归 0 判定，0 点无旁白则原样保留');
}

// (3) 硬约束 A 回归：voiceWindows 为空（旧调用形态）时事件原样返回、volume_db 不动
{
  const passthrough = applyVoiceAvoidance(events, [], {});
  assert.strictEqual(passthrough.kept.length, events.length);
  assert.deepStrictEqual(passthrough.kept.map(e => e.volume_db), events.map(e => e.volume_db));
  assert.strictEqual(passthrough.dropped.length, 0);
}
console.log('sfx voice avoidance tests passed');

// (4) resolveProjectSfxEventsForMux 增加可选 voiceWindows：避让发生在白名单/置信度/文件校验之前，
// 产出的 mux 事件 volume_db 已含 ducking；不传 voiceWindows 时输出与现状完全一致（硬约束 A）。
// 避让丢弃走独立 avoidance_dropped（dropped 仅保留既有校验类丢弃）；
// enabled===false 的事件在避让前过滤：不进 avoidance_dropped、不占 high 限额。
const { resolveProjectSfxEventsForMux } = require('../server/services/creative-video/html-video/sfxEventService');
const os = require('os');
const fs = require('fs');
const path = require('path');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-sfx-mux-'));
  fs.mkdirSync(path.join(dir, 'audio', 'sfx'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio', 'sfx', 'whoosh_soft.wav'), 'x'); // 占位文件，只为通过存在性检查
  const project = {
    audio: { sfx: { enabled: true, status: 'ready', events: [
      { id: 'sfx_001', scene_id: 'scene_04', time_sec: 2.5, global_time_sec: 48.0, sfx_id: 'whoosh_soft',
        intensity: 'medium', volume_db: -18, enabled: true, confidence: 0.9 }, // 旁白活跃 => duck -8
      { id: 'sfx_002', scene_id: 'scene_04', time_sec: 0.03, global_time_sec: 45.5, sfx_id: 'whoosh_soft',
        intensity: 'medium', volume_db: -18, enabled: true, confidence: 0.9 }, // 旁白起始 ±0.35s => avoidance_dropped
      { id: 'sfx_003', scene_id: 'scene_04', time_sec: 6.5, global_time_sec: 52.0, sfx_id: 'whoosh_soft',
        intensity: 'high', volume_db: -14, enabled: false, confidence: 0.9 }, // 用户停用 => 静默跳过，不占 high 限额
      { id: 'sfx_004', scene_id: 'scene_04', time_sec: 7.5, global_time_sec: 53.0, sfx_id: 'whoosh_soft',
        intensity: 'high', volume_db: -14, enabled: true, confidence: 0.9 },
      { id: 'sfx_005', scene_id: 'scene_04', time_sec: 8.5, global_time_sec: 54.0, sfx_id: 'whoosh_soft',
        intensity: 'high', volume_db: -14, enabled: true, confidence: 0.9 }, // 若停用事件误占限额，此条会被丢
      { id: 'sfx_006', scene_id: 'scene_04', time_sec: 9.5, global_time_sec: 55.0, sfx_id: 'not_in_library',
        intensity: 'medium', volume_db: -18, enabled: true, confidence: 0.9 }, // 白名单外 => 既有校验 dropped
    ] } },
    frames: [{ id: 'f1', duration_sec: 60, captions: [{ start: 45.47, end: 51.2, text: 'n' }] }],
  };
  const library = { items: [{ id: 'whoosh_soft', default_volume_db: -18 }] };
  const withAvoidance = resolveProjectSfxEventsForMux({
    project, projectDir: dir, library,
    voiceWindows: [{ start: 45.47, end: 51.2 }],
  });
  assert.strictEqual(withAvoidance.events.find(e => e.id === 'sfx_001').volume_db, -26, '旁白活跃期 mux 事件必须已 duck -8dB');
  assert.deepStrictEqual(withAvoidance.events.map(e => e.id), ['sfx_001', 'sfx_004', 'sfx_005'],
    '停用事件不占 high 限额：两条 enabled high 全保留');
  // 避让丢弃走独立 avoidance_dropped：只有命中旁白起点的 enabled 事件，reason 为避让文案
  assert.deepStrictEqual(withAvoidance.avoidance_dropped.map(d => d.id), ['sfx_002']);
  assert.ok(/旁白起始/.test(withAvoidance.avoidance_dropped[0].reason), 'avoidance_dropped.reason 是避让文案');
  assert.deepStrictEqual(Object.keys(withAvoidance.avoidance_dropped[0]).sort(), ['id', 'reason', 'scene_id', 'sfx_id']);
  assert.ok(!withAvoidance.avoidance_dropped.some(d => d.id === 'sfx_003'), '停用事件不得进 avoidance_dropped');
  // dropped 恢复为仅既有校验类丢弃（白名单/置信度/文件缺失），不再混入避让条目
  assert.deepStrictEqual(withAvoidance.dropped.map(d => d.id), ['sfx_006']);
  assert.ok(/白名单/.test(withAvoidance.dropped[0].reason));
  const withoutAvoidance = resolveProjectSfxEventsForMux({ project, projectDir: dir, library });
  assert.strictEqual(withoutAvoidance.events.find(e => e.id === 'sfx_001').volume_db, -18, '不传 voiceWindows 时行为与现状一致');
  assert.deepStrictEqual(withoutAvoidance.events.map(e => e.id), ['sfx_001', 'sfx_002', 'sfx_004', 'sfx_005']);
  assert.deepStrictEqual(withoutAvoidance.dropped.map(d => d.id), ['sfx_006']);
  assert.deepStrictEqual(withoutAvoidance.avoidance_dropped, []);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('sfx mux wiring tests passed');
