const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { canvasFor, sha256 } = require('../server/services/creative/whiteboard/contracts');
const { CAPTION_LAYOUT_VERSION, letters, splitCaption, buildNarrationTiming, buildSilentTiming, srtText } = require('../server/services/creative/whiteboard/narrationTiming');
const { narrationStage } = require('../server/services/creative/whiteboard/productionStages');
const store = require('../server/services/creative/whiteboard/mediaStore');
const tools = require('../server/services/creative/whiteboard/mediaTools');

const examples = [
  '而有些女性进入婚外关系时，原有婚姻可能已经长期处于情感枯竭之中。',
  '第二种机制，是认知失调。行为一旦与自己的道德认同发生冲突，',
  '关系被赋予越崇高的意义，当事人就越可能通过冒险来证明它：敢放弃、敢暴露。',
  '第三，把情人带进家门，也可能象征极端的自我暴露。家是最私密的生活领地，',
  '最后，一些明显的破绽还可能属于心理学所说的“行动化”：无法说出口的冲突，',
];

function fixture(text, aspectRatio = '16:9', narrationLanguage = 'zh-CN') {
  const words = letters(text).map((character, index) => ({ text: character, start_time: 125 + index * 180, end_time: 275 + index * 180 }));
  const durationMs = words.at(-1).end_time + 500;
  return { artifact: { narrationText: text, narrationLanguage, aspectRatio, durationMs, timingKind: 'source_srt',
    productionPlan: { narrationMode: 'enabled', burnSubtitles: true },
    cues: [{ id: 'cue_1', text, startMs: 0, endMs: durationMs }],
    scenes: [{ id: 'scene_1', title: '字幕验证', cueIds: ['cue_1'], startMs: 0, endMs: durationMs }] },
  evidence: { provider: 'fixture', words } };
}

function checkTextAndTiming() {
  assert.deepEqual(splitCaption(examples[0]), ['而有些女性进入婚外关系时，', '原有婚姻可能已经长期处于情感枯竭之中。']);
  for (const aspectRatio of ['16:9', '4:3', '9:16']) {
    for (const text of [...examples, '先看这一行，\r\n再看下一句。', '他说：“先看事实！！”然后再看结论。']) {
      const { artifact, evidence } = fixture(text, aspectRatio);
      const before = structuredClone(artifact);
      const timing = buildNarrationTiming(artifact, evidence, artifact.durationMs);
      assert.equal(timing.captionLayoutVersion, CAPTION_LAYOUT_VERSION);
      assert.equal(timing.captions.map(cue => cue.text).join('').replace(/\s/gu, ''), text.replace(/\s/gu, ''));
      let offset = 0;
      for (const caption of timing.captions) {
        const count = letters(caption.text).length;
        assert.ok(count > 0 && !/[\r\n]/u.test(caption.text));
        assert.equal(caption.startMs, evidence.words[offset].start_time);
        assert.equal(caption.endMs, evidence.words[offset + count - 1].end_time);
        offset += count;
      }
      const silent = buildSilentTiming(artifact);
      assert.deepEqual(silent.cues, artifact.cues);
      assert.equal(silent.captions[0].startMs, 0);
      assert.equal(silent.captions.at(-1).endMs, artifact.durationMs);
      silent.captions.forEach((caption, index) => {
        assert.ok(caption.text && !/[\r\n]/u.test(caption.text));
        if (index) assert.equal(caption.startMs, silent.captions[index - 1].endMs);
      });
      assert.deepEqual(artifact, before, '字幕显示切分不得改写已确认正文或源时间');
    }
  }
  const numeric = splitCaption('数值为 3.14，比例为 1,000:1。');
  assert.ok(numeric.some(text => text.includes('3.14')));
  assert.ok(numeric.some(text => text.includes('1,000:1')));
  assert.ok(splitCaption(examples[3])[0].startsWith('第三，把情人带进家门'));
  for (const language of ['en-US', 'en-GB']) {
    const text = 'Watch the first sentence, then read the next sentence. ' + 'W'.repeat(100);
    const parts = splitCaption(text, language, '9:16');
    assert.equal(parts.join(''), text);
    assert.ok(parts.every(part => part.trim().length > 1), '超长英文单词不得退化成逐字闪烁');
  }
  const planned = fixture('对。然后再画一个圆形。').artifact;
  planned.timingKind = 'provisional';
  planned.productionPlan.narrationMode = 'disabled';
  planned.durationMs = planned.cues[0].endMs = planned.scenes[0].endMs = 2500;
  const scheduled = buildSilentTiming(planned);
  assert.equal(scheduled.captions.length, 2);
  assert.ok(scheduled.captions[0].endMs >= 500, '无旁白短句有足够总时间时应分配阅读时间，而非误报时长不足');
  assert.equal(scheduled.captions.at(-1).endMs, 2500);
  assert.deepEqual(scheduled.cues, planned.cues);
  const sourceSrt = buildSilentTiming({ ...planned, timingKind: 'source_srt' });
  assert.ok(sourceSrt.captions[0].endMs < 500, '输入 SRT 继续保留其原有阅读节奏');
  console.log('PASS 五张截图文案、三种画幅、原生字级切换、SRT 多行、引号、数字与中英文长句');
}

function dialogueRows(ass) {
  return ass.split(/\r?\n/u).filter(line => line.startsWith('Dialogue:')).map(line => {
    const fields = line.split(',');
    return { start: fields[1], end: fields[2], text: fields.slice(9).join(',') };
  });
}

async function checkCompiler(root, runtime) {
  for (const aspectRatio of ['16:9', '4:3', '9:16']) {
    const texts = [...examples.flatMap(text => splitCaption(text, 'zh-CN', aspectRatio)),
      ...splitCaption('W'.repeat(100), 'en-US', aspectRatio), '这一条\n仍为单行', '文本 {\\N} 保留'];
    const cues = texts.map((text, index) => ({ text, startMs: index * 1005, endMs: (index + 1) * 1005 }));
    const output = path.join(root, `captions-${aspectRatio.replace(':', '-')}.ass`);
    await tools.python('subtitles', { font: runtime.font, canvas: canvasFor(aspectRatio), cues, output });
    const ass = await fs.readFile(output, 'utf8');
    assert.ok(!ass.includes('\\N') && !ass.includes('\\n'));
    const rows = dialogueRows(ass);
    assert.equal(rows.length, cues.length);
    assert.equal(rows[0].end, '0:00:01.01');
    for (let index = 1; index < rows.length; index += 1) assert.equal(rows[index - 1].end, rows[index].start, '量化后相邻字幕也不能重叠');
  }
  await assert.rejects(tools.python('subtitles', { font: runtime.font, canvas: canvasFor('9:16'),
    cues: [{ text: '超宽字幕'.repeat(30), startMs: 0, endMs: 2000 }], output: path.join(root, 'too-wide.ass') }), /单行宽度/u);
  await assert.rejects(tools.python('subtitles', { font: runtime.font,
    cues: [{ text: '第一句', startMs: 0, endMs: 1010 }, { text: '第二句', startMs: 1000, endMs: 2000 }],
    output: path.join(root, 'overlap.ass') }), /重叠/u);
  console.log('PASS 实际字体测宽、单行 ASS、防止字幕指令注入与百分之一秒边界无重叠');
}

async function checkCachedNarration(root, runtime) {
  const rootDir = path.join(root, 'workflows');
  const workflowId = '20260922000000000001';
  const { artifact, evidence } = fixture(examples[0]);
  const oldMedia = store.makeMedia('fixture-plan', runtime.recipe);
  oldMedia.voiceService = { contractHash: 'fixture-voice' };
  const record = { workflow_id: workflowId, whiteboard: { media: oldMedia, mediaHistory: [] } };
  const inputIdentity = sha256({ text: artifact.narrationText, language: artifact.narrationLanguage, cues: artifact.cues,
    scenes: artifact.scenes.map(({ id, cueIds, startMs, endMs }) => ({ id, cueIds, startMs, endMs })),
    voice: 'fixture-voice', silent: false, take: 0 });
  const oldAttempt = { id: crypto.randomUUID(), stage: 'full_narration', inputIdentity, status: 'validated' };
  oldMedia.attempts.push(oldAttempt);
  const directory = store.workDirectory(workflowId, oldAttempt.id, rootDir);
  await fs.mkdir(directory, { recursive: true });
  const audio = path.join(directory, 'narration.wav');
  await tools.execute(runtime.ffmpeg, ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
    '-t', String(artifact.durationMs / 1000), '-c:a', 'pcm_s16le', audio]);
  const publish = async (item, files) => {
    const result = {};
    for (const [key, file] of Object.entries(files)) result[key] = await store.publishFile(record, item, file.path, { ...file, rootDir });
    item.received = { ...item.received, ...result };
    return { result };
  };
  const jsonFile = async (item, name, value) => {
    const file = path.join(store.workDirectory(workflowId, item.id, rootDir), name);
    await fs.writeFile(file, JSON.stringify(value), { flag: 'wx' });
    return file;
  };
  const oldTiming = { ...buildNarrationTiming(artifact, evidence, artifact.durationMs),
    captions: [{ id: 'cue_1_1', sourceCueId: 'cue_1', text: artifact.narrationText, startMs: 125, endMs: evidence.words.at(-1).end_time }] };
  delete oldTiming.captionLayoutVersion;
  const subtitles = path.join(directory, 'narration.srt');
  await fs.writeFile(subtitles, srtText(oldTiming.captions));
  const files = (await publish(oldAttempt, {
    audio: { path: audio, kind: 'narration', mime: 'audio/wav' },
    native: { path: await jsonFile(oldAttempt, 'provider-subtitles.json', evidence), kind: 'provider_subtitles', mime: 'application/json' },
    timeline: { path: await jsonFile(oldAttempt, 'timeline.json', oldTiming), kind: 'timeline', mime: 'application/json' },
    subtitles: { path: subtitles, kind: 'subtitles', mime: 'application/x-subrip' },
  })).result;
  oldMedia.current.full_narration = store.bind({ kind: 'full_narration', inputIdentity, ...files, durationMs: artifact.durationMs });
  const oldIdentity = oldMedia.current.full_narration.identity;
  record.whiteboard.mediaHistory.push(oldMedia);
  record.whiteboard.media = store.makeMedia('fixture-new-plan', runtime.recipe);
  record.whiteboard.media.voiceService = oldMedia.voiceService;
  const ctx = { workflowId, rootDir, tools, runtime, processOptions: {},
    voice: { service: oldMedia.voiceService },
    services: { aiTtsModel: { callTtsModel: async () => assert.fail('字幕规则更新不能重复请求配音') } },
    read: async () => record,
    change: async callback => ({ result: await callback(record, new Date().toISOString()) }),
    attempt: async (stage, sceneId, external, identity) => {
      assert.equal(external, false);
      const item = { id: crypto.randomUUID(), stage, inputIdentity: identity };
      record.whiteboard.media.attempts.push(item);
      await fs.mkdir(store.workDirectory(workflowId, item.id, rootDir), { recursive: true });
      return item;
    },
    requesting: async () => assert.fail('本地字幕更新不能进入供应商请求状态'),
    filePath: async (state, descriptor) => (await store.mediaFile(state, descriptor, rootDir)).path,
    publish, jsonFile,
  };
  await narrationStage(ctx, artifact);
  const current = record.whiteboard.media.current.full_narration;
  await store.validateBinding(record, current, rootDir);
  assert.equal(current.captionLayoutVersion, CAPTION_LAYOUT_VERSION);
  assert.notEqual(current.identity, oldIdentity);
  assert.equal(current.audio.sha256, files.audio.sha256, '更新排版必须复用原音频内容');
  assert.equal(current.native.sha256, files.native.sha256);
  const updated = await store.readData(record, current.timeline, rootDir);
  assert.equal(updated.captions.length, 2);
  assert.deepEqual(updated.cues, oldTiming.cues);
  assert.deepEqual(updated.scenes, oldTiming.scenes);
  assert.deepEqual(await store.readData(record, oldMedia.current.full_narration.timeline, rootDir), oldTiming, '旧时间轴文件保持原样');
  const completed = record.whiteboard.media;
  record.whiteboard.mediaHistory.push(completed);
  record.whiteboard.media = store.makeMedia('fixture-another-plan', runtime.recipe);
  record.whiteboard.media.voiceService = oldMedia.voiceService;
  await narrationStage(ctx, artifact);
  assert.equal(record.whiteboard.media.current.full_narration.identity, current.identity);
  assert.equal(record.whiteboard.media.attempts.length, 0, '当前版本字幕继续按原有缓存流程复用');
  console.log('PASS 旧版字幕在本地重建、原音频和原生证据复用、旧文件保留、新版继续命中缓存');
}

(async () => {
  checkTextAndTiming();
  await fs.mkdir(path.resolve('.codex-runtime'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.codex-runtime/whiteboard-subtitles-test-'));
  const runtime = await tools.preflight();
  await checkCompiler(root, runtime);
  await checkCachedNarration(root, runtime);
  console.log(`字幕专项验证通过，真实 provider 调用 0。产物目录：${root}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
