const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projectStore = require('./projectStore');
const { SFX_VOLUME_MIN_DB, SFX_VOLUME_MAX_DB } = require('./projectSchema');
const sfxLibrary = require('./sfxLibrary');

const MIN_CONFIDENCE = 0.55;
const MIN_SCENE_GAP_SEC = 0.6;
const MIN_HIGH_GAP_SEC = 3;
const MAX_PER_SCENE = 2;
const MAX_TOTAL_EVENTS = 18;
// ponytail: 旁白密度按 字数/秒 粗估，>=5 视为密集场景并下调 3dB；不够准时再换 TTS 实测时长
const NARRATION_DENSE_CPS = 5;
const NARRATION_DENSE_DUCK_DB = 3;
const INTENSITIES = new Set(['low', 'medium', 'high']);
// 旁白避让默认参数：起始避让窗、旁白活跃期 duck 量、每 scene 强音效上限
const SFX_AVOID_START_SEC = 0.35;
const SFX_VOICE_DUCK_DB = 8;
const SFX_MAX_HIGH_PER_SCENE = 2;

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getSceneId(value) {
  return String(value && (value.scene_id || value.id || value.sceneId) || '').trim();
}

// 已知缺陷（规划期口径，本轮不改动以免影响规划行为）：
// 1) 不读 speech_duration_sec / actual_duration_sec / target_duration_sec；
// 2) 同 scene 多个 beat frame 只保留第一帧时长，不求和。
// mux 侧的全片时间已由 recomputeEventGlobalTimes 基于最终 project.frames 重算，不再依赖这里。
function getSceneDurations(project = {}, sceneSpec = {}) {
  const durations = new Map();
  for (const scene of Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : []) {
    const id = getSceneId(scene);
    const duration = numberOrNull(scene.duration_sec ?? scene.durationSec ?? scene.duration);
    if (id && duration != null && duration > 0) durations.set(id, duration);
  }
  for (const frame of Array.isArray(project.frames) ? project.frames : []) {
    const id = getSceneId(frame);
    const duration = numberOrNull(frame.duration_sec ?? frame.durationSec ?? frame.duration);
    if (id && duration != null && duration > 0 && !durations.has(id)) durations.set(id, duration);
  }
  return durations;
}

function getSceneStarts(project = {}, sceneSpec = {}) {
  let cursor = 0;
  const starts = new Map();
  const durations = getSceneDurations(project, sceneSpec);
  const scenes = (Array.isArray(sceneSpec.scenes) && sceneSpec.scenes.length ? sceneSpec.scenes : project.frames) || [];
  for (const scene of scenes) {
    const id = getSceneId(scene);
    if (!id || starts.has(id)) continue;
    starts.set(id, cursor);
    cursor += durations.get(id) || 0;
  }
  return starts;
}

function getSceneLimit(project = {}, sceneSpec = {}) {
  const sceneCount = Array.isArray(sceneSpec.scenes) && sceneSpec.scenes.length
    ? sceneSpec.scenes.length
    : (Array.isArray(project.frames) ? project.frames.length : 0);
  return Math.min(MAX_TOTAL_EVENTS, Math.max(0, sceneCount * MAX_PER_SCENE));
}

function getPlanningRules(project = {}, sceneSpec = {}) {
  return {
    max_events_per_scene: MAX_PER_SCENE,
    max_total_events: getSceneLimit(project, sceneSpec),
    min_strong_gap_sec: MIN_HIGH_GAP_SEC,
  };
}

function getSceneNarrationCps(project = {}, sceneSpec = {}, durations) {
  const cps = new Map();
  const sources = [
    ...(Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : []),
    ...(Array.isArray(project.frames) ? project.frames : []),
  ];
  for (const scene of sources) {
    const id = getSceneId(scene);
    if (!id || cps.has(id)) continue;
    const text = String(scene.narration_text || scene.narrationText || '').trim();
    const duration = durations.get(id);
    if (text && duration) cps.set(id, text.length / duration);
  }
  return cps;
}

function textForItem(item = {}) {
  return `${item.id || ''} ${item.title || ''} ${Array.isArray(item.tags) ? item.tags.join(' ') : ''}`.toLowerCase();
}

function fallbackLabel(item = {}) {
  const text = textForItem(item);
  if (text.includes('whoosh') || text.includes('swoosh')) return '嗖入场';
  if (text.includes('pop')) return '弹出提示';
  if (text.includes('click')) return '点击反馈';
  if (text.includes('typing')) return '打字声';
  if (text.includes('paper')) return '纸张声';
  if (text.includes('impact')) return '重击强调';
  if (text.includes('ding')) return '提示音';
  return '短音效';
}

function hasChinese(value) {
  return /[㐀-鿿]/.test(String(value || ''));
}

function normalizeSfxEvents({ aiEvents = [], project = {}, sceneSpec = {}, library = {} } = {}) {
  const items = new Map((Array.isArray(library.items) ? library.items : []).map(item => [item && item.id, item]).filter(([id]) => id));
  const durations = getSceneDurations(project, sceneSpec);
  const starts = getSceneStarts(project, sceneSpec);
  const narrationCps = getSceneNarrationCps(project, sceneSpec, durations);
  const perScene = new Map();
  const highTimes = [];
  const events = [];
  const maxEvents = getSceneLimit(project, sceneSpec);

  for (const input of Array.isArray(aiEvents) ? aiEvents : []) {
    if (events.length >= maxEvents) break;
    const sfxId = String(input && input.sfx_id || '').trim();
    const item = items.get(sfxId);
    const confidence = numberOrNull(input && input.confidence);
    if (!item || confidence == null || confidence < MIN_CONFIDENCE) continue;

    const sceneId = getSceneId(input);
    const timeSec = numberOrNull(input && (input.time_sec ?? input.timeSec));
    const duration = durations.get(sceneId);
    // 场景不存在或无有效时长的事件按 spec §5.4 丢弃，不允许锚在全局 0 点
    if (!sceneId || timeSec == null || timeSec < 0 || duration == null || timeSec >= duration) continue;

    const sceneEvents = perScene.get(sceneId) || [];
    if (sceneEvents.length >= MAX_PER_SCENE) continue;
    if (sceneEvents.some(event => Math.abs(event.time_sec - timeSec) < MIN_SCENE_GAP_SEC)) continue;

    const intensity = INTENSITIES.has(input.intensity) ? input.intensity : 'medium';
    const globalTimeSec = (starts.get(sceneId) || 0) + timeSec;
    if (intensity === 'high' && highTimes.some(value => Math.abs(value - globalTimeSec) < MIN_HIGH_GAP_SEC)) continue;

    const volume = numberOrNull(input.volume_db);
    const defaultVolume = numberOrNull(item.default_volume_db);
    const denseDuckDb = (narrationCps.get(sceneId) || 0) >= NARRATION_DENSE_CPS ? NARRATION_DENSE_DUCK_DB : 0;
    const event = {
      id: `sfx_${String(events.length + 1).padStart(3, '0')}`,
      scene_id: sceneId,
      frame_id: String(input.frame_id || input.frameId || sceneId),
      time_sec: timeSec,
      global_time_sec: globalTimeSec,
      sfx_id: sfxId,
      label_zh: hasChinese(input.label_zh) ? String(input.label_zh).trim() : fallbackLabel(item),
      reason: String(input.reason || ''),
      intensity,
      volume_db: clamp((volume != null ? volume : (defaultVolume != null ? defaultVolume : -18)) - denseDuckDb, SFX_VOLUME_MIN_DB, SFX_VOLUME_MAX_DB),
      enabled: input.enabled === false ? false : true,
      created_by: String(input.created_by || input.createdBy || 'ai'),
      confidence: confidence == null ? null : confidence,
    };
    events.push(event);
    sceneEvents.push(event);
    perScene.set(sceneId, sceneEvents);
    if (intensity === 'high') highTimes.push(globalTimeSec);
  }

  return { events };
}

function disableSfxEvent({ project, eventId } = {}) {
  const events = Array.isArray(project?.audio?.sfx?.events) ? project.audio.sfx.events : [];
  const id = String(eventId || '').trim();
  const event = events.find(item => item && item.id === id);
  if (!event) {
    return { success: false, code: 'SFX_EVENT_NOT_FOUND', message: '未找到要删除的音效。', project };
  }
  event.enabled = false;
  return { success: true, message: '已停用音效。', project };
}

function markSfxSkipped(project, message = '自动音效编排失败，已跳过音效增强。') {
  project.audio = objectOrEmpty(project.audio);
  const prior = objectOrEmpty(project.audio.sfx);
  project.audio.sfx = {
    ...prior,
    enabled: false,
    status: 'skipped',
    message,
    events: Array.isArray(prior.events) ? prior.events : [],
  };
  return project.audio.sfx;
}

function sfxEventsPayload(events, { libraryVersion = 1 } = {}) {
  return {
    version: 1,
    library_version: Number(libraryVersion) || 1,
    generated_at: new Date().toISOString(),
    events: Array.isArray(events) ? events : [],
  };
}

async function writeSfxEventsFileAsync(projectDir, events, options = {}) {
  const outputPath = projectStore.resolveProjectPath(projectDir, path.join('audio', 'sfx-events.json'));
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, `${JSON.stringify(sfxEventsPayload(events, options), null, 2)}\n`, 'utf8');
  return 'audio/sfx-events.json';
}

// project.audio.sfx.events 是权威，audio/sfx-events.json 是镜像（spec §4.3）；所有改动方统一走这里保持同步
async function persistProjectSfxMirror(projectDir, project) {
  const sfx = objectOrEmpty(project?.audio?.sfx);
  return writeSfxEventsFileAsync(projectDir, Array.isArray(sfx.events) ? sfx.events : [], {
    libraryVersion: sfx.library_version,
  });
}

function buildSfxPlanningScenes({ project = {}, sceneSpec = {} } = {}) {
  const specScenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const frames = Array.isArray(project.frames) ? project.frames : [];
  const frameByScene = new Map(frames
    .map(frame => [getSceneId(frame), frame])
    .filter(([id]) => id));
  const durations = getSceneDurations(project, sceneSpec);
  const starts = getSceneStarts(project, sceneSpec);
  return (specScenes.length ? specScenes : frames).map((scene, index) => {
    const sceneId = getSceneId(scene) || `scene_${String(index + 1).padStart(2, '0')}`;
    const frame = frameByScene.get(sceneId) || {};
    return {
      scene_id: sceneId,
      frame_id: String(frame.id || frame.frame_id || sceneId),
      order: index + 1,
      start_sec: starts.get(sceneId) || 0,
      duration_sec: durations.get(sceneId) || 0,
      narration_text: String(scene.narration_text || scene.narrationText || frame.narration_text || ''),
      captions: Array.isArray(scene.captions) ? scene.captions : (Array.isArray(frame.captions) ? frame.captions : []),
      visual_text: objectOrEmpty(scene.visual_text || scene.visualText || frame.metadata?.visual_text),
      motion_hints: Array.isArray(scene.motion_hints) ? scene.motion_hints : (Array.isArray(frame.metadata?.motion_hints) ? frame.metadata.motion_hints : []),
      visual_type_hint: String(scene.visual_type_hint || scene.visualTypeHint || frame.metadata?.visual_type_hint || scene.kind || ''),
    };
  });
}

async function applyPlannedSfxEvents({ projectDir, project, sceneSpec, library, aiEvents } = {}) {
  const normalized = normalizeSfxEvents({ aiEvents, project, sceneSpec, library });
  const assetDir = projectStore.resolveProjectPath(projectDir, path.join('audio', 'sfx'));
  await fsp.mkdir(assetDir, { recursive: true });

  const uniqueSfxIds = [...new Set(normalized.events.map(event => event.sfx_id))];
  const copiedPathBySfxId = new Map();
  const dropped = [];
  await Promise.all(uniqueSfxIds.map(async sfxId => {
    try {
      const asset = sfxLibrary.resolveSfxAsset(sfxId, { library });
      const ext = path.extname(asset.path) || '.wav';
      const relativePath = path.join('audio', 'sfx', `${sfxId}${ext}`).replace(/\\/g, '/');
      await fsp.copyFile(asset.path, projectStore.resolveProjectPath(projectDir, relativePath));
      copiedPathBySfxId.set(sfxId, relativePath);
    } catch (error) {
      dropped.push({ sfx_id: sfxId, reason: error.message || String(error) });
    }
  }));

  const events = normalized.events
    .filter(event => copiedPathBySfxId.has(event.sfx_id))
    .map(event => ({ ...event, asset_path: copiedPathBySfxId.get(event.sfx_id) }));

  project.audio = objectOrEmpty(project.audio);
  project.audio.sfx = {
    enabled: events.length > 0,
    source: 'ai',
    library_path: sfxLibrary.DEFAULT_LIBRARY_RELATIVE_PATH.replace(/\\/g, '/'),
    library_version: Number(library && library.version) || 1,
    events_path: 'audio/sfx-events.json',
    asset_dir: 'audio/sfx',
    status: events.length > 0 ? 'ready' : 'skipped',
    message: events.length > 0
      ? (dropped.length ? `自动音效编排完成，${dropped.length} 个素材不可用已丢弃。` : '自动音效编排完成。')
      : '没有可用的自动音效事件。',
    events,
  };
  project.audio.sfx.events_path = await persistProjectSfxMirror(projectDir, project);
  return { success: true, events, dropped, project };
}

// P1-4：SFX 的 global_time_sec 是规划期按 scene 起点算的；之后 fitFrameDurationsToCaptions
// 可能延长前序帧并重排 timeline，导致旧值与最终成片时间轴脱节。mux 前基于最终 project.frames
// 用 scene_id + time_sec 重算事件绝对时间：同 scene 多帧求和（scene 起点 = 该 scene 第一帧
// 前所有帧时长累计），帧时长回退链与 buildVoiceWindowsFromProject 同口径。
// 纯函数：返回局部副本，不回写原始事件；查不到 scene 或 time_sec 无效的事件保留原值（容错不丢）。
// 假设同 scene 的帧在 timeline 上连续排列（beat 帧不与其他 scene 交错），scene 起点取第一帧起点。
function recomputeEventGlobalTimes(events = [], project = {}) {
  const sceneStarts = new Map();
  let cursor = 0;
  for (const frame of Array.isArray(project?.frames) ? project.frames : []) {
    // 帧侧沿用 getSceneId（scene_id 缺失时回退 frame.id）：normalizeFrame 保证 scene_id=id 兜底，
    // 未归一化的旧 project 只有 id。事件侧只认 scene_id/sceneId——事件 id（sfx_xxx）不是 scene 键，
    // 回退会误配；两侧口径不对称是有意为之。
    const sceneId = getSceneId(frame);
    if (sceneId && !sceneStarts.has(sceneId)) sceneStarts.set(sceneId, cursor);
    cursor += Number(frame?.duration_sec ?? frame?.durationSec ?? frame?.duration) || 0;
  }
  return (Array.isArray(events) ? events : []).map(event => {
    const sceneId = String(event?.scene_id || event?.sceneId || '').trim();
    const start = sceneStarts.get(sceneId);
    const timeSec = Number(event?.time_sec ?? event?.timeSec);
    if (start == null || !Number.isFinite(timeSec) || timeSec < 0) return event;
    return { ...event, global_time_sec: roundMs(start + timeSec) };
  });
}

function resolveProjectSfxEventsForMux({ project = {}, projectDir, library, voiceWindows = [] } = {}) {
  const sfx = objectOrEmpty(project.audio?.sfx);
  const planned = sfx.enabled === false ? [] : (Array.isArray(sfx.events) ? sfx.events : []);
  // 无条件重算全片时间：fit 之后旧 global_time_sec 本来就不可信；无 frames 匹配时重算是恒等变换。
  // 只改局部副本，不触碰 project.audio.sfx.events 原始计划。
  const events = recomputeEventGlobalTimes(planned, project);
  // P2-7：先执行基础校验（白名单/置信度/文件存在/时间有效）得到候选，再对候选做旁白避让，
  // 避免必然被丢的无效 high 事件先占用限额、挤掉后续有效事件。
  const candidates = []; // { event, path }
  const dropped = [];
  let libraryIds = new Set();
  let libraryError = null;
  if (events.length) {
    try {
      const source = library || sfxLibrary.loadSfxLibrary();
      libraryIds = new Set((Array.isArray(source.items) ? source.items : [])
        .map(item => String(item?.id || '').trim())
        .filter(Boolean));
    } catch (error) {
      libraryError = error;
    }
  }
  for (const event of events) {
    // 用户停用的事件静默跳过：不进 dropped/avoidance_dropped、不占 high 限额
    if (event?.enabled === false) continue;
    const sfxId = String(event.sfx_id || event.sfxId || '').trim();
    if (libraryError) {
      dropped.push({ id: String(event.id || ''), sfx_id: sfxId, reason: `素材库不可用：${libraryError.message || String(libraryError)}` });
      continue;
    }
    if (!sfxId || !libraryIds.has(sfxId)) {
      dropped.push({ id: String(event.id || ''), sfx_id: sfxId, reason: '音效 ID 不在本地白名单中。' });
      continue;
    }
    const confidence = Number(event.confidence);
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) {
      dropped.push({ id: String(event.id || ''), sfx_id: sfxId, reason: '音效置信度过低。' });
      continue;
    }
    const relativePath = String(event.asset_path || event.assetPath || `audio/sfx/${sfxId}.wav`);
    try {
      const filePath = projectStore.resolveProjectPath(projectDir, relativePath);
      if (!fs.existsSync(filePath)) {
        dropped.push({ id: String(event.id || ''), sfx_id: sfxId, reason: `素材文件缺失：${relativePath}` });
        continue;
      }
      const globalTime = Number(event.global_time_sec ?? event.globalTimeSec);
      if (!Number.isFinite(globalTime) || globalTime < 0) {
        dropped.push({ id: String(event.id || ''), sfx_id: sfxId, reason: '全片时间点无效。' });
        continue;
      }
      candidates.push({ event, path: filePath });
    } catch (error) {
      dropped.push({ id: String(event.id || ''), sfx_id: sfxId, reason: error.message || String(error) });
    }
  }
  // 旁白避让在通过校验的候选事件上执行（ducking 用重算后的时间）。素材路径提前附在事件副本的
  // __sfx_path 临时字段上：applyVoiceAvoidance 的 {...event} spread 会自然带过去，
  // 构造 mux 条目时取用并剥离，避免按引用/id 回查在 id 重复或为空时串路径。
  const avoidanceDropped = [];
  let keptEvents = candidates.map(candidate => ({ ...candidate.event, __sfx_path: candidate.path }));
  if (Array.isArray(voiceWindows) && voiceWindows.length && keptEvents.length) {
    const avoidance = applyVoiceAvoidance(keptEvents, voiceWindows, {});
    keptEvents = avoidance.kept;
    avoidanceDropped.push(...avoidance.dropped);
  }
  const resolved = keptEvents.map(event => ({
    id: String(event.id || ''),
    path: event.__sfx_path,
    global_time_sec: Number(event.global_time_sec ?? event.globalTimeSec),
    volume_db: clamp(Number.isFinite(Number(event.volume_db)) ? Number(event.volume_db) : -18, SFX_VOLUME_MIN_DB, SFX_VOLUME_MAX_DB),
  }));
  // dropped 仅含既有校验类丢弃（白名单/置信度/文件缺失），避让丢弃走独立 avoidance_dropped，
  // 便于调用方分别给出「素材不可用」与「避让旁白移除」两类不同文案的诊断
  return { events: resolved, dropped, avoidance_dropped: avoidanceDropped };
}

// 从 project.frames[].captions 推导全片旁白窗口：caption 时间为帧内相对，需加帧起点累计偏移
// 累计偏移会引入浮点误差（如 6.38+5.9=12.280000000000001），窗口边界统一取整到毫秒
function roundMs(value) {
  return Math.round(value * 1000) / 1000;
}

function buildVoiceWindowsFromProject(project = {}) {
  const windows = [];
  let cursor = 0;
  for (const frame of Array.isArray(project?.frames) ? project.frames : []) {
    const duration = Number(frame?.duration_sec ?? frame?.durationSec ?? frame?.duration) || 0;
    let frameWindowCount = 0;
    for (const caption of Array.isArray(frame?.captions) ? frame.captions : []) {
      const start = Number(caption?.start);
      const end = Number(caption?.end);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        windows.push({ start: roundMs(cursor + start), end: roundMs(cursor + end) });
        frameWindowCount += 1;
      }
    }
    // P1-5：generateCaptions=false 会清空 frame.captions，但旁白音频仍在成片里。
    // 帧无 captions 窗口但 narration_text 非空时，用整帧近似窗口兜底避让；
    // 有 captions 时维持精确窗口，避免过度避让。
    if (!frameWindowCount && String(frame?.narration_text || frame?.narrationText || '').trim() && duration > 0) {
      windows.push({ start: roundMs(cursor), end: roundMs(cursor + duration) });
    }
    cursor += duration;
  }
  return windows;
}

// 旁白避让纯函数：起始 ±avoidStartSec 内移除、旁白活跃期 duck、每 scene 强音效限额。
// voiceWindows 为空时完全直通（兼容旧调用形态）。
function applyVoiceAvoidance(events = [], voiceWindows = [], {
  avoidStartSec = SFX_AVOID_START_SEC,
  duckDb = SFX_VOICE_DUCK_DB,
  maxHighPerScene = SFX_MAX_HIGH_PER_SCENE,
} = {}) {
  const windows = (Array.isArray(voiceWindows) ? voiceWindows : [])
    .filter(w => Number.isFinite(w?.start) && Number.isFinite(w?.end) && w.end > w.start);
  if (!windows.length) {
    return { kept: Array.isArray(events) ? [...events] : [], dropped: [] };
  }
  const eventTime = event => Number(event?.global_time_sec ?? event?.globalTimeSec) || 0;
  // 按全片时间稳定升序处理：high 限额确定性保留时间最早的 N 个（kept/dropped 输出随之为时间序）
  const ordered = (Array.isArray(events) ? [...events] : []).sort((a, b) => eventTime(a) - eventTime(b));
  const kept = [];
  const dropped = [];
  const highCount = new Map();
  // dropped 保持最小契约（对齐 resolveProjectSfxEventsForMux）：不展开原事件，
  // 避免覆盖事件自带的 AI reason、避免 enabled 等字段被下游误持久化后事件复活
  const dropEvent = (event, reason) => {
    dropped.push({ id: event.id, scene_id: event.scene_id, sfx_id: event.sfx_id, reason });
  };
  for (const event of ordered) {
    const at = eventTime(event);
    if (windows.some(w => Math.abs(at - w.start) <= avoidStartSec)) {
      dropEvent(event, `与旁白起始点间隔不大于 ${avoidStartSec}s，移除避免压过人声`);
      continue;
    }
    if (event.intensity === 'high') {
      const count = (highCount.get(event.scene_id) || 0) + 1;
      highCount.set(event.scene_id, count);
      if (count > maxHighPerScene) {
        dropEvent(event, `scene ${event.scene_id} 强音效（intensity=high）超过上限 ${maxHighPerScene}`);
        continue;
      }
    }
    const voiceActive = windows.some(w => at >= w.start && at <= w.end);
    const baseVolume = Number.isFinite(Number(event.volume_db)) ? Number(event.volume_db) : -18;
    kept.push({
      ...event,
      volume_db: voiceActive
        ? clamp(baseVolume - duckDb, SFX_VOLUME_MIN_DB, SFX_VOLUME_MAX_DB)
        : baseVolume,
    });
  }
  return { kept, dropped };
}

module.exports = {
  normalizeSfxEvents,
  disableSfxEvent,
  markSfxSkipped,
  writeSfxEventsFileAsync,
  persistProjectSfxMirror,
  applyPlannedSfxEvents,
  buildSfxPlanningScenes,
  getPlanningRules,
  resolveProjectSfxEventsForMux,
  recomputeEventGlobalTimes,
  buildVoiceWindowsFromProject,
  applyVoiceAvoidance,
};
