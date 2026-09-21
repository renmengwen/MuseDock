const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const workflows = require('../server/services/creative/creativeWorkflows');
const workflowStore = require('../server/services/creative/workflowStore');
const mediaStore = require('../server/services/creative/whiteboard/mediaStore');
const mediaTools = require('../server/services/creative/whiteboard/mediaTools');
const production = require('../server/services/creative/whiteboard/productionWorkflows');
const models = require('../server/services/creative/whiteboard/mediaModels');
const { sha256, canvasFor, subtitleStyleFor } = require('../server/services/creative/whiteboard/contracts');

const portrait = process.argv.includes('--portrait');
const aspectRatio = portrait ? '9:16' : '16:9';
const canvas = canvasFor(aspectRatio);

const sourceSrt = '1\n00:00:00,000 --> 00:00:03,000\n先画圆形。\n\n2\n00:00:03,000 --> 00:00:06,000\n再画方形。\n';
const candidate = { schemaVersion: 1, title: '线稿媒体集成测试', summary: '先展示圆形，再展示方形。',
  cues: [{ id: 'cue_1', text: '先画圆形。' }, { id: 'cue_2', text: '再画方形。' }],
  scenes: [{ id: 'scene_1', title: '圆形', cueIds: ['cue_1'], imagePrompt: '纸面上一个清晰圆形，少量彩色，留白充分。' },
    { id: 'scene_2', title: '方形', cueIds: ['cue_2'], imagePrompt: '纸面上一个清晰方形，少量彩色，留白充分。' }] };

function nativeResponse(audio) {
  const sentences = ['先画圆形。', '再画方形。'].map((text, index) => ({ text, start_time: index * 3000,
    end_time: index * 3000 + 2200, words: Array.from(text).map((word, n) => ({ text: word,
      start_time: index * 3000 + 100 + Math.min(n, 4) * 420,
      end_time: index * 3000 + 100 + Math.min(n, 4) * 420 + (n === 4 ? 0 : 400),
    })) }));
  return { audio: audio.toString('base64'), duration: 6, original_duration: 6,
    subtitle: { text: sentences.map(item => item.text).join(''), sentences } };
}

async function setup() {
  const parent = path.join(__dirname, '../.codex-runtime');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, portrait ? 'whiteboard-media-test-portrait-' : 'whiteboard-media-test-'));
  const rootDir = path.join(root, 'workflows');
  const runtime = await mediaTools.preflight({ aspectRatio });
  await mediaTools.execute(mediaTools.pythonPath(), ['-c', [
    'import cv2,numpy as np,sys',
    `a=np.full((${canvas.height},${canvas.width},3),(215,235,245),np.uint8)`,
    portrait ? 'cv2.circle(a,(540,450),210,(20,30,45),10)' : 'cv2.circle(a,(640,500),210,(20,30,45),10)',
    portrait ? 'cv2.rectangle(a,(310,1030),(760,1460),(25,70,110),10)' : 'cv2.rectangle(a,(1030,300),(1480,730),(25,70,110),10)',
    'ok,b=cv2.imencode(".png",a)', 'b.tofile(sys.argv[1])',
  ].join(';'), path.join(root, 'fixture.png')]);
  await mediaTools.execute(runtime.ffmpeg, ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000',
    '-t', '6', '-ac', '1', '-c:a', 'pcm_s16le', path.join(root, 'fixture.wav')]);
  const png = await fs.readFile(path.join(root, 'fixture.png'));
  const audio = await fs.readFile(path.join(root, 'fixture.wav'));
  const calls = { tts: 0, image: 0, draft: 0, vision: 0, annotation: 0, realProviderCalls: 0 };
  const configs = {
    tts: { enabled: true, provider: 'doubao', providerName: '豆包测试替身', apiKey: 'fixture-only', baseUrl: 'https://openspeech.bytedance.com', modelId: 'seed-audio-1.0', ttsQueueIntervalMs: 0 },
    text: { enabled: true, provider: 'fixture', apiKey: 'fixture-only', baseUrl: 'https://example.invalid', modelId: 'fixture-text', supportsMultimodal: true },
    image: { enabled: true, provider: 'fixture', apiKey: 'fixture-only', baseUrl: 'https://example.invalid', modelId: 'fixture-image' },
  };
  let ttsOverride;
  const options = { rootDir, services: {
    aiModelConfig: { getRuntimeConfig: async type => configs[type] },
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://openspeech.bytedance.com/api/v3/tts/create');
      calls.tts += 1;
      if (ttsOverride) return ttsOverride(url, init);
      return { ok: true, status: 200, json: async () => nativeResponse(audio) };
    },
    aiImageModel: { generateImages: async request => { calls.image += 1; assert.equal(request.size, portrait ? '1440x2560' : '2560x1440'); return { success: true, images: [{ b64_json: png.toString('base64') }] }; } },
    aiTextModel: { callTextModel: async ({ messages }) => {
      if (typeof messages[1].content === 'string') { calls.draft += 1; return { success: true, text: JSON.stringify(candidate) }; }
      calls.vision += 1;
      const prompt = messages[1].content[0].text;
      const count = messages[1].content.filter(item => item.type === 'image_url').length;
      if (prompt.includes('imageCount')) return { success: true, text: JSON.stringify({ passed: true, summary: '测试替身确认已接收全部图像。', issues: [], imageCount: count,
        ...(prompt.includes('阶段 annotation_drafting') ? { sceneReviews: candidate.scenes.map(scene => ({ sceneId: scene.id,
          groupsMatchImage: true, orderMatchesNarration: true, reason: '圆形与方形之间有明显留白，各区域完整覆盖对应图形且顺序一致。' })) } : {}) }) };
      calls.annotation += 1;
      return { success: true, text: JSON.stringify({ schemaVersion: 2,
        visualGrouping: { mode: 'independent_clusters', reason: '圆形与方形之间有连续纸面留白，没有贯穿连接，可以逐一独立揭示。' },
        elements: [
          { label: '圆形', region: portrait ? { x: 300, y: 210, width: 490, height: 490 } : { x: 400, y: 260, width: 490, height: 490 }, direction: 'left-to-right', weight: 1, protectedRegions: [] },
          { label: '方形', region: portrait ? { x: 280, y: 1000, width: 510, height: 490 } : { x: 1000, y: 270, width: 510, height: 490 }, direction: 'top-to-bottom', weight: 1, protectedRegions: [] },
        ] }) };
    } },
  } };
  const read = id => workflowStore.readWorkflow(id, rootDir);
  async function action(id, name, extra = {}) {
    const record = await read(id);
    return workflows.actOnWhiteboardWorkflow(id, { action: name,
      expectedAttemptId: record.whiteboard.attempts.at(-1).id, expectedIdentity: record.whiteboard.current?.identity || '',
      expectedMediaIdentity: record.whiteboard.media ? mediaStore.mediaIdentity(record.whiteboard.media) : undefined,
      interactionId: record.whiteboard.interactions?.findLast(item => item.status === 'pending')?.id,
      requestId: crypto.randomUUID(), ...extra }, options);
  }
  async function create(auto = false, { input, productionPlan = {} } = {}) {
    const created = await workflows.createCreativeWorkflow({ creationModeId: 'whiteboard-stream-v1',
      input: { inputMode: 'srt', content: sourceSrt, aspectRatio, ...input },
      productionPlan: { agentApprovalEnabled: auto, handDisplayMode: 'hide', ...productionPlan } }, options);
    assert.equal(created.success, true, created.message);
    const drafted = await workflows.runCreativeWorkflow(created.workflow_id, options);
    assert.equal(drafted.status, 'waiting_approval', drafted.message);
    assert.equal((await action(created.workflow_id, 'approve_initial', { confirmed: true })).success, true);
    return created.workflow_id;
  }
  return { root, rootDir, runtime, calls, options, read, action, create, setTts: fn => { ttsOverride = fn; },
    setVoiceConfigured: enabled => { configs.tts.enabled = enabled; } };
}

async function testSilentMedia(ctx) {
  const deliveries = [];
  ctx.setVoiceConfigured(false);
  const act = async (id, name, extra) => {
    const result = await ctx.action(id, name, extra);
    assert.equal(result.success, true, result.message);
    return result;
  };
  async function finish(id) {
    for (let index = 0; index < mediaStore.STAGES.length; index += 1) {
      const result = await workflows.runCreativeWorkflow(id, ctx.options);
      assert.equal(result.success, true, result.message);
      const record = await ctx.read(id);
      if (record.status === 'done') return record;
      assert.equal(record.status, 'waiting_approval');
      if (record.whiteboard.media.stage === 'full_narration') {
        assert.match(record.message, /检查字幕与分镜时长/);
        assert.equal(record.whiteboard.media.stages[0].label, '准备字幕与时间轴');
        assert.equal((await ctx.action(id, 'approve_media', { confirmed: false })).code, 'APPROVAL_REQUIRED');
      }
      await act(id, 'approve_media', { confirmed: true });
    }
    const record = await ctx.read(id);
    assert.equal(record.status, 'done');
    return record;
  }
  for (const mode of ['topic', 'text', 'srt']) {
    const withMusic = mode === 'text';
    const input = mode === 'srt' ? {} : { inputMode: mode, targetDurationSeconds: 15,
      content: mode === 'topic' ? '先画圆形，再画方形' : candidate.cues.map(cue => cue.text).join('\n') };
    const id = await ctx.create(withMusic, { input, productionPlan: { narrationMode: 'disabled', bgmMode: withMusic ? 'enabled' : 'disabled' } });
    await act(id, 'start_production');
    if (mode === 'topic') {
      const interrupted = await ctx.read(id);
      production.recover(interrupted, new Date().toISOString());
      assert.equal(interrupted.status, 'failed');
      assert.equal(interrupted.error.code, 'MEDIA_INTERRUPTED');
      await workflowStore.persistWorkflow(interrupted, ctx.rootDir);
      await act(id, 'retry_media');
    }
    const record = await finish(id);
    const media = record.whiteboard.media;
    const narration = media.current.full_narration;
    const timing = await mediaStore.readData(record, narration.timeline, ctx.rootDir);
    assert.equal(narration.audio, null);
    assert.equal(narration.native, null);
    assert.equal(narration.timingKind, mode === 'srt' ? 'source_srt' : 'planned');
    assert.equal(timing.durationMs, mode === 'srt' ? 6000 : 15000);
    assert.equal(timing.provider, 'disabled');
    assert.equal(ctx.calls.tts, 0, '无旁白的完整制作不能调用 TTS');
    assert.equal(media.artifacts.some(file => ['narration', 'provider_audio', 'provider_subtitles'].includes(file.kind)), false);
    assert.equal(media.attempts.find(attempt => attempt.stage === 'full_narration').external, false);
    assert.equal(media.approvals.length, 5);
    const final = media.current.final_delivery;
    assert.equal(final.validation.frameCount, timing.durationMs * 60 / 1000);
    assert.equal(final.validation.audio, withMusic);
    const video = await workflows.getWhiteboardMediaFile(id, final.video.id, ctx.options);
    assert.equal(video.success, true);
    const info = await mediaTools.probe(video.file_path, ctx.runtime);
    assert.equal(info.streams.some(stream => stream.codec_type === 'audio'), withMusic);
    deliveries.push({ mode, workflowId: id, video: video.file_path, durationMs: timing.durationMs, bgm: withMusic });
    console.log(`PASS ${mode} 无旁白全链路：${timing.durationMs / 1000} 秒，${withMusic ? '仅 BGM 音轨' : '无音轨'}，TTS 请求 0`);

    if (mode === 'topic') {
      const before = { ...ctx.calls };
      ctx.setVoiceConfigured(true);
      await act(id, 'update_plan', { productionPlan: { burnSubtitles: false, agentApprovalEnabled: true } });
      assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).status, 'waiting_approval');
      await act(id, 'approve_initial', { confirmed: true });
      await act(id, 'start_production');
      const reused = await finish(id);
      assert.equal(reused.whiteboard.media.current.full_narration.identity, narration.identity);
      assert.equal(reused.whiteboard.media.reused.length, 7);
      for (const kind of ['tts', 'image', 'draft']) assert.equal(ctx.calls[kind], before[kind]);
      ctx.setVoiceConfigured(false);
      console.log('PASS 计划时间轴在中断后恢复；字幕开关和旁白服务配置变化仍复用有效上游');
    }
  }

  const id = deliveries[0].workflowId;
  const oldTiming = (await ctx.read(id)).whiteboard.media.current.full_narration.identity;
  await act(id, 'update_plan', { input: { targetDurationSeconds: 30 }, productionPlan: { agentApprovalEnabled: false } });
  assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).status, 'waiting_approval');
  await act(id, 'approve_initial', { confirmed: true });
  await act(id, 'start_production');
  assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).status, 'waiting_approval');
  const retimed = (await ctx.read(id)).whiteboard.media.current.full_narration;
  assert.notEqual(retimed.identity, oldTiming);
  assert.equal(retimed.durationMs, 30000);
  assert.equal(ctx.calls.tts, 0);
  await act(id, 'update_plan', { productionPlan: { narrationMode: 'enabled' } });
  assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).status, 'waiting_approval');
  await act(id, 'approve_initial', { confirmed: true });
  assert.equal((await ctx.action(id, 'start_production')).code, 'TTS_NOT_CONFIGURED');
  ctx.setVoiceConfigured(true);
  await act(id, 'update_plan', { productionPlan: { narrationMode: 'enabled' } });
  assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).status, 'waiting_approval');
  await act(id, 'approve_initial', { confirmed: true });
  await act(id, 'start_production');
  assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).status, 'waiting_approval');
  const voiced = (await ctx.read(id)).whiteboard.media.current.full_narration;
  assert.equal(voiced.timingKind, 'provider_native_words');
  assert.ok(voiced.audio);
  assert.equal(voiced.durationMs, 6000, '切回旁白后应使用实际音频时长');
  assert.equal(ctx.calls.tts, 1, '仅显式切回旁白后的测试替身请求允许调用 TTS');
  console.log('PASS 修改目标时长生成新时间轴，切回旁白恢复配置校验及同次原生时间');
  await fs.writeFile(path.join(ctx.root, 'silent-result.json'), JSON.stringify({ evidence: 'local_fixture_real_ffmpeg', deliveries, calls: ctx.calls }, null, 2));
  console.log(`无旁白媒体验证通过，真实 provider 调用 0。产物目录：${ctx.root}`);
}

async function testSubtitleTiming(ctx) {
  const short = 'a'.repeat(24) + ' ' + 'b'.repeat(4);
  const long = 'c'.repeat(260) + ' ' + 'd'.repeat(10);
  const original = ctx.options.services.aiTextModel.callTextModel;
  const beforeTts = ctx.calls.tts;
  ctx.options.services.aiTextModel.callTextModel = async () => {
    ctx.calls.draft += 1;
    return { success: true, text: JSON.stringify({ schemaVersion: 1, title: '小字号字幕测试', summary: '保留原文与时间。',
      cues: [{ id: 'cue_1', text: short }, { id: 'cue_2', text: long }],
      scenes: [{ id: 'scene_1', title: '阅读', cueIds: ['cue_1', 'cue_2'], imagePrompt: '纸面上的图形清晰分开，底部留白。' }] }) };
  };
  try {
    const id = await ctx.create(false, { input: { inputMode: 'text', content: `${short}\n${long}`, narrationLanguage: 'en-US', aspectRatio: '9:16', targetDurationSeconds: 15 },
      productionPlan: { narrationMode: 'disabled', subtitleFontSize: 24 } });
    const started = await ctx.action(id, 'start_production');
    assert.equal(started.success, true, started.message);
    const prepared = await workflows.runCreativeWorkflow(id, ctx.options);
    assert.equal(prepared.success, true, prepared.message);
    assert.equal(prepared.status, 'waiting_approval');
    const record = await ctx.read(id);
    assert.equal(record.whiteboard.media.stage, 'full_narration');
    assert.equal(record.whiteboard.media.current.full_narration.timingKind, 'planned');
    assert.equal(ctx.calls.tts, beforeTts);
    console.log('PASS 24 px 英文无旁白方案通过预检并完成时间轴阶段，不受默认字号误拦截');
  } finally { ctx.options.services.aiTextModel.callTextModel = original; }
}

async function testSubtitleStyles(ctx) {
  const id = await ctx.create(true);
  assert.equal((await ctx.action(id, 'start_production')).success, true);
  let result = await workflows.runCreativeWorkflow(id, ctx.options);
  assert.equal(result.status, 'done', result.message);
  const deliveries = [];
  for (const productionPlan of [{ subtitleColor: '#FFCC00' }, { subtitleFontSize: 96 }, { subtitleColor: '#1E90FF', subtitleFontSize: 24 }]) {
    const before = await ctx.read(id);
    const calls = { ...ctx.calls };
    assert.equal((await ctx.action(id, 'update_plan', { productionPlan })).success, true);
    assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).status, 'waiting_approval');
    assert.equal((await ctx.action(id, 'approve_initial', { confirmed: true })).success, true);
    assert.equal((await ctx.action(id, 'start_production')).success, true);
    result = await workflows.runCreativeWorkflow(id, ctx.options);
    assert.equal(result.status, 'done', result.message);
    const after = await ctx.read(id);
    const oldMedia = before.whiteboard.media;
    const current = after.whiteboard.media;
    for (const stage of mediaStore.STAGES.slice(0, -1)) assert.equal(current.current[stage.id].identity, oldMedia.current[stage.id].identity, `${stage.id} 不得因字幕样式改变而重建`);
    for (const kind of ['tts', 'image', 'draft', 'annotation']) assert.equal(ctx.calls[kind], calls[kind], `字幕样式调整不得重复请求 ${kind}`);
    assert.equal(current.reused.length, 7);
    const final = current.current.final_delivery;
    assert.notEqual(final.inputIdentity, oldMedia.current.final_delivery.inputIdentity);
    const plan = after.whiteboard.attempts.at(-1).productionPlan;
    assert.deepEqual(final.subtitleStyle, subtitleStyleFor(plan, aspectRatio));
    const receipt = await mediaStore.readData(after, final.receipt, ctx.rootDir);
    assert.deepEqual(receipt.subtitleStyle, final.subtitleStyle);
    assert.equal(receipt.captionsSha256, final.captionsSha256);
    const directory = mediaStore.workDirectory(id, final.video.attemptId, ctx.rootDir);
    const ass = await fs.readFile(path.join(directory, 'captions.ass'), 'utf8');
    const style = ass.split(/\r?\n/u).find(line => line.startsWith('Style: Default,')).split(',');
    assert.equal(Number(style[2]), final.subtitleStyle.fontSize);
    const color = final.subtitleStyle.color;
    assert.equal(style[3], `&H00${color.slice(5, 7)}${color.slice(3, 5)}${color.slice(1, 3)}`);
    assert.ok(!ass.includes('\\N'));
    const srt = await mediaStore.mediaFile(after, final.subtitles, ctx.rootDir);
    assert.match(await fs.readFile(srt.path, 'utf8'), /先画圆形。/u);
    const poster = (await mediaStore.mediaFile(after, final.poster, ctx.rootDir)).path;
    deliveries.push({ style: final.subtitleStyle, poster, video: (await mediaStore.mediaFile(after, final.video, ctx.rootDir)).path });
    console.log(`PASS ${color} / ${final.subtitleStyle.fontSize} px：字幕更新，旁白、线稿、编排和单幕全部复用`);
  }
  await fs.writeFile(path.join(ctx.root, 'subtitle-styles-result.json'), JSON.stringify({ evidence: 'local_fixture_real_ffmpeg', deliveries, calls: ctx.calls }, null, 2));
  console.log(`字幕样式集成验证通过，真实 provider 调用 0。产物目录：${ctx.root}`);
  await testSubtitleTiming(ctx);
}

(async () => {
  const ctx = await setup();
  if (process.argv.includes('--subtitle-timing')) return testSubtitleTiming(ctx);
  if (process.argv.includes('--subtitles')) return testSubtitleStyles(ctx);
  if (process.argv.includes('--silent')) return testSilentMedia(ctx);
  const id = await ctx.create();
  const start = await ctx.action(id, 'start_production');
  assert.equal(start.success, true, start.message);
  let oldPayload;
  for (const stage of mediaStore.STAGES) {
    const result = await workflows.runCreativeWorkflow(id, ctx.options);
    assert.equal(result.success, true, result.message);
    assert.equal(result.status, 'waiting_approval');
    let record = await ctx.read(id);
    assert.equal(record.whiteboard.media.stage, stage.id);
    assert.equal(record.whiteboard.media.gate, mediaStore.GATES[stage.id]);
    const binding = record.whiteboard.media.current[stage.id];
    await mediaStore.validateBinding(record, binding, ctx.rootDir);
    if (stage.id === 'annotation_drafting') {
      for (const scene of binding.scenes) {
        const annotation = await mediaStore.readData(record, scene.annotation, ctx.rootDir);
        assert.equal(scene.planningContract, models.ANNOTATION_PLANNING_CONTRACT);
        assert.equal(scene.visualGrouping.mode, 'independent_clusters');
        assert.equal(annotation.elements.length, 2);
        assert.deepEqual(annotation.canvas, canvas);
        assert.equal(scene.coverage.regions, 2);
        assert.ok(annotation.elements[1].reveal.startMs >= annotation.elements[0].reveal.startMs + annotation.elements[0].reveal.durationMs);
      }
    }
    assert.equal((await ctx.action(id, 'approve_media', { confirmed: false })).success, false);
    if (oldPayload) assert.equal((await workflows.actOnWhiteboardWorkflow(id, oldPayload, ctx.options)).code, 'STALE_IDENTITY');
    oldPayload = { action: 'approve_media', expectedAttemptId: record.whiteboard.attempts.at(-1).id,
      expectedIdentity: record.whiteboard.current.identity, expectedMediaIdentity: mediaStore.mediaIdentity(record.whiteboard.media),
      interactionId: record.whiteboard.media.interactionId, confirmed: true };
    const approved = await ctx.action(id, 'approve_media', { confirmed: true });
    assert.equal(approved.success, true, approved.message);
    console.log(`PASS ${stage.id} 实际媒体产物与版本批准`);
  }
  let record = await ctx.read(id);
  assert.equal(record.status, 'done');
  assert.equal(ctx.calls.tts, 1); assert.equal(ctx.calls.image, 2);
  const final = record.whiteboard.media.current.final_delivery;
  assert.equal(final.validation.frameCount, 360); assert.equal(final.validation.audio, true);
  assert.equal(record.whiteboard.media.approvals.length, 5);
  const file = await workflows.getWhiteboardMediaFile(id, final.video.id, ctx.options);
  assert.equal(file.success, true);
  const info = await mediaTools.probe(file.file_path, ctx.runtime);
  assert.equal(info.streams[0].codec_name, 'h264');
  assert.equal(info.streams[0].width, canvas.width);
  assert.equal(info.streams[0].height, canvas.height);
  assert.equal(info.streams[1].codec_name, 'aac');
  await assert.rejects(mediaTools.validateVideo(file.file_path, { frameCount: 360, audio: true, durationMs: 6000,
    canvas: { width: canvas.height, height: canvas.width } }, ctx.runtime), error => error.code === 'VIDEO_INVALID');

  // A subtitle-only change reuses narration, images, annotations and scene videos.
  const before = { ...ctx.calls };
  assert.equal((await ctx.action(id, 'update_plan', { productionPlan: { agentApprovalEnabled: true, burnSubtitles: false } })).success, true);
  assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).success, true);
  assert.equal((await ctx.action(id, 'approve_initial', { confirmed: true })).success, true);
  assert.equal((await ctx.action(id, 'start_production')).success, true);
  const originalVision = ctx.options.services.aiTextModel.callTextModel;
  ctx.options.services.aiTextModel.callTextModel = async request => {
    if (Array.isArray(request.messages[1]?.content)) {
      assert.equal((await ctx.read(id)).status, 'running', '自动审阅期间必须保持运行态，否则页面会提前停止事件流');
    }
    return originalVision(request);
  };
  const automated = await workflows.runCreativeWorkflow(id, ctx.options);
  ctx.options.services.aiTextModel.callTextModel = originalVision;
  assert.equal(automated.success, true, automated.message);
  assert.equal(automated.status, 'done');
  assert.equal(ctx.calls.tts, before.tts); assert.equal(ctx.calls.image, before.image); assert.equal(ctx.calls.draft, before.draft);
  record = await ctx.read(id);
  assert.equal(record.whiteboard.media.reused.length, 7);
  assert.equal(record.whiteboard.media.approvals.every(approval => approval.actor === 'automation'), true);
  console.log('PASS 自动推进及字幕设置变更复用全部有效上游');

  // BGM is a final mix decision: each toggle reuses all approved source media.
  for (const bgmMode of ['enabled', 'disabled']) {
    const previous = await ctx.read(id);
    const previousFinal = previous.whiteboard.media.current.final_delivery;
    const previousNarration = previous.whiteboard.media.current.full_narration;
    const beforeBgm = { ...ctx.calls };
    assert.equal((await ctx.action(id, 'update_plan', { productionPlan: { bgmMode } })).success, true);
    assert.equal((await ctx.read(id)).whiteboard.media.stale, true);
    assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).status, 'waiting_approval');
    assert.equal((await ctx.action(id, 'approve_initial', { confirmed: true })).success, true);
    assert.equal((await ctx.action(id, 'start_production')).success, true);
    const result = await workflows.runCreativeWorkflow(id, ctx.options);
    assert.equal(result.status, 'done', result.message);
    const updated = await ctx.read(id);
    const mixedFinal = updated.whiteboard.media.current.final_delivery;
    assert.equal(Boolean(mixedFinal.bgm), bgmMode === 'enabled');
    assert.notEqual(mixedFinal.inputIdentity, previousFinal.inputIdentity);
    assert.equal(updated.whiteboard.media.current.full_narration.identity, previousNarration.identity);
    assert.equal(updated.whiteboard.media.current.full_narration.audio.sha256, previousNarration.audio.sha256);
    assert.equal(updated.whiteboard.media.reused.length, 7);
    for (const kind of ['tts', 'image', 'draft']) assert.equal(ctx.calls[kind], beforeBgm[kind]);
    const receipt = await mediaStore.readData(updated, mixedFinal.receipt, ctx.rootDir);
    assert.deepEqual(receipt.bgm, mixedFinal.bgm);
    if (bgmMode === 'enabled') {
      assert.equal(mixedFinal.bgm.license, 'CC0-1.0');
      assert.equal(mixedFinal.bgm.assetSha256, (await mediaTools.prepareBackgroundMusic()).recipe.assetSha256);
    }
  }
  console.log('PASS BGM 开启和关闭均更新成片身份与记录，并复用旁白、线稿、标注、单幕视频');

  // A fresh annotation attempt must not reuse bindings from the former whole-image policy.
  assert.equal((await ctx.action(id, 'update_plan', { productionPlan: { agentApprovalEnabled: false } })).success, true);
  await workflows.runCreativeWorkflow(id, ctx.options);
  await ctx.action(id, 'approve_initial', { confirmed: true });
  await ctx.action(id, 'start_production');
  record = await ctx.read(id);
  for (const history of record.whiteboard.mediaHistory) {
    if (!history.current.full_narration) continue;
    const timing = await mediaStore.readData(record, history.current.full_narration.timeline, ctx.rootDir);
    for (const [sceneId, binding] of Object.entries(history.annotations)) {
      const { identity, planningContract, visualGrouping, ...legacy } = binding;
      legacy.inputIdentity = sha256({ image: history.lineart[sceneId].image.sha256, timing: history.current.full_narration.identity,
        scene: timing.scenes.find(scene => scene.id === sceneId), revision: '' });
      history.annotations[sceneId] = mediaStore.bind(legacy);
    }
  }
  await workflowStore.persistWorkflow(record, ctx.rootDir);
  for (const stage of ['full_narration', 'lineart_generation']) {
    assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).status, 'waiting_approval');
    assert.equal((await ctx.read(id)).whiteboard.media.stage, stage);
    await ctx.action(id, 'approve_media', { confirmed: true });
  }
  const beforeAnnotation = ctx.calls.vision;
  assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).status, 'waiting_approval');
  assert.equal(ctx.calls.vision - beforeAnnotation, 2, '旧分区政策不能通过历史缓存绕过新标注请求');
  record = await ctx.read(id);
  assert.equal(record.whiteboard.media.reused.some(item => item.collection === 'annotations'), false);
  assert.ok(Object.values(record.whiteboard.media.annotations).every(binding => binding.planningContract === models.ANNOTATION_PLANNING_CONTRACT));
  console.log('PASS 新标注政策不复用旧版区域缓存');
  for (const stage of ['scene_render', 'final_delivery']) {
    assert.equal((await ctx.action(id, 'approve_media', { confirmed: true })).success, true);
    assert.equal((await workflows.runCreativeWorkflow(id, ctx.options)).status, 'waiting_approval');
    assert.equal((await ctx.read(id)).whiteboard.media.stage, stage);
  }
  assert.equal((await ctx.action(id, 'approve_media', { confirmed: true })).success, true);
  assert.equal((await ctx.read(id)).status, 'done');

  const rejectedId = await ctx.create(true);
  await ctx.action(rejectedId, 'start_production');
  ctx.options.services.aiTextModel.callTextModel = async request => {
    const response = await originalVision(request);
    if (Array.isArray(request.messages[1]?.content) && request.messages[1].content[0].text.includes('阶段 annotation_drafting')) {
      const findings = JSON.parse(response.text);
      findings.sceneReviews[0].groupsMatchImage = false;
      findings.sceneReviews[0].reason = '测试注入：存在独立视觉簇被错误合并，应暂停并要求核对。';
      response.text = JSON.stringify(findings);
    }
    return response;
  };
  const rejectedReview = await workflows.runCreativeWorkflow(rejectedId, ctx.options);
  ctx.options.services.aiTextModel.callTextModel = originalVision;
  assert.equal(rejectedReview.status, 'waiting_approval');
  const rejectedRecord = await ctx.read(rejectedId);
  assert.equal(rejectedRecord.whiteboard.media.stage, 'annotation_drafting');
  assert.equal(rejectedRecord.whiteboard.media.current.scene_render, undefined);
  assert.ok(rejectedRecord.whiteboard.media.approvals.every(approval => approval.gate !== 'annotation_approval'));
  console.log('PASS 逐幕分组不通过时阻止自动批准与下游渲染');

  // The same submission cannot create a second run, and discussions keep the gate pending.
  const next = await ctx.create();
  const state = await ctx.read(next);
  const payload = { action: 'start_production', expectedAttemptId: state.whiteboard.attempts.at(-1).id,
    expectedIdentity: state.whiteboard.current.identity, requestId: crypto.randomUUID() };
  assert.equal((await workflows.actOnWhiteboardWorkflow(next, payload, ctx.options)).startTask, true);
  assert.equal((await workflows.actOnWhiteboardWorkflow(next, payload, ctx.options)).startTask, false);
  const queued = await ctx.read(next);
  queued.status = 'running'; queued.whiteboard.media.executionId = 'interrupted';
  queued.whiteboard.media.activeAttemptId = 'fixture-request';
  queued.whiteboard.media.attempts.push({ id: 'fixture-request', stage: 'full_narration', status: 'requesting' });
  production.recover(queued, new Date().toISOString());
  assert.equal(queued.status, 'unknown_external_outcome');
  assert.deepEqual(production.actionsFor(queued).map(action => action.id), ['save_lineart_prompt', 'authorize_media_retry']);
  const second = await ctx.create();
  await ctx.action(second, 'start_production');
  ctx.setTts(async () => ({ ok: true, json: async () => ({ audio: (await fs.readFile(path.join(ctx.root, 'fixture.wav'))).toString('base64'), duration: 6, original_duration: 6 }) }));
  const unknown = await workflows.runCreativeWorkflow(second, ctx.options);
  assert.equal(unknown.code, 'UNKNOWN_EXTERNAL_OUTCOME');
  record = await ctx.read(second);
  assert.equal(record.status, 'unknown_external_outcome');
  assert.ok(record.whiteboard.media.artifacts.some(item => item.kind === 'provider_audio'));
  const count = ctx.calls.tts;
  assert.equal((await ctx.action(second, 'retry_media')).success, false);
  assert.equal(ctx.calls.tts, count);
  const deleted = await workflows.deleteCreativeWorkflow(second, ctx.options);
  assert.equal(deleted.success, true, deleted.message);
  await assert.rejects(fs.stat(path.join(ctx.rootDir, '.whiteboard-work', second)), { code: 'ENOENT' });
  // Late provider responses must not resurrect the task or its media directories.
  let release;
  let requested;
  const started = new Promise(resolve => { requested = resolve; });
  ctx.setTts(() => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => nativeResponse(Buffer.alloc(44)) }); requested(); }));
  const lateId = await ctx.create();
  await ctx.action(lateId, 'start_production');
  const pending = workflows.runCreativeWorkflow(lateId, ctx.options);
  await started;
  assert.equal((await workflows.deleteCreativeWorkflow(lateId, ctx.options)).success, true);
  release();
  assert.equal((await pending).status, 'deleted');
  await assert.rejects(fs.stat(path.join(ctx.rootDir, 'whiteboard-artifacts', lateId)), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(ctx.rootDir, '.whiteboard-work', lateId)), { code: 'ENOENT' });
  console.log('PASS 删除清理及外部晚到响应不复活任务');
  const completed = await ctx.read(id);
  const completedFile = await workflows.getWhiteboardMediaFile(id, completed.whiteboard.media.current.final_delivery.video.id, ctx.options);
  assert.equal(completedFile.success, true);
  await fs.writeFile(path.join(ctx.root, 'result.json'), JSON.stringify({ workflowId: id, rootDir: ctx.rootDir, final: completedFile.file_path, aspectRatio, canvas,
    evidence: 'local_fixture_real_ffmpeg', calls: ctx.calls }, null, 2));
  console.log(`白板媒体全链路通过：${canvas.width}×${canvas.height} / 60fps / H.264 + AAC / 360 帧；真实 provider 调用 0。产物目录：${ctx.root}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
