const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeInput, materializeCandidate, parseSrt } = require('../server/services/creative/whiteboard/contracts');
const { buildSilentTiming, buildNarrationTiming, srtText } = require('../server/services/creative/whiteboard/narrationTiming');

function plan({ mode = 'text', texts = ['先画一个圆形。', '接着画出方形，再停留片刻。'], seconds = 30, language = 'zh-CN', aspectRatio = '16:9', burnSubtitles = true } = {}) {
  const input = normalizeInput({ inputMode: mode, content: texts.join('\n'), targetDurationSeconds: seconds, narrationLanguage: language, aspectRatio });
  const cues = texts.map((text, index) => ({ id: `cue_${index + 1}`, text }));
  const candidate = { schemaVersion: 1, title: '无旁白时间轴', summary: '按内容顺序逐幕绘制。', cues,
    scenes: cues.map(cue => ({ id: `scene_${cue.id}`, title: '画面', cueIds: [cue.id], imagePrompt: '暖米黄纸面上绘制一个清晰的图形，四周留白。' })) };
  return materializeCandidate(candidate, input, { narrationMode: 'disabled', burnSubtitles });
}

const cases = [
  ['主题与正文复用已确认的时间，保留文本与总时长', () => {
    for (const mode of ['topic', 'text']) {
      const artifact = plan({ mode });
      const before = structuredClone(artifact);
      const timing = buildSilentTiming(artifact);
      assert.equal(timing.timingKind, 'planned');
      assert.equal(timing.provider, 'disabled');
      assert.equal(timing.durationMs, 30000);
      assert.deepEqual(timing.cues, artifact.cues);
      assert.equal(timing.scenes[0].startMs, 0);
      assert.equal(timing.scenes.at(-1).endMs, 30000);
      assert.equal(timing.scenes[0].endMs, timing.scenes[1].startMs);
      assert.equal(timing.audioSha256, undefined);
      assert.equal(timing.nativeSubtitlesSha256, undefined);
      assert.deepEqual(artifact, before, '生成时间轴不能修改已确认方案');
      const subtitles = parseSrt(srtText(timing.captions));
      assert.equal(subtitles.map(cue => cue.text).join(''), artifact.cues.map(cue => cue.text).join(''));
      assert.equal(subtitles.at(-1).endMs, 30000);
    }
  }],
  ['中英文横竖字幕拆分后保持顺序与时间边界', () => {
    for (const language of ['zh-CN', 'en-US', 'en-GB']) for (const aspectRatio of ['16:9', '9:16']) {
      const text = language === 'zh-CN' ? '先把复杂的事情拆成今天可以完成的小动作。'.repeat(5)
        : 'Start with one small action. Keep the picture clear and leave time to read. '.repeat(3).trim();
      const timing = buildSilentTiming(plan({ texts: [text], language, aspectRatio, seconds: 60 }));
      assert.ok(timing.captions.length > 1);
      assert.equal(timing.captions[0].startMs, 0);
      assert.equal(timing.captions.at(-1).endMs, 60000);
      assert.equal(timing.captions.map(cue => cue.text).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
      timing.captions.forEach((cue, index) => {
        assert.ok(cue.endMs > cue.startMs);
        if (index) assert.equal(cue.startMs, timing.captions[index - 1].endMs);
      });
    }
  }],
  ['SRT 保留输入时间、间隔及原有时间来源', () => {
    const artifact = plan();
    artifact.timingKind = 'source_srt';
    artifact.cues[0].startMs = 2000;
    artifact.cues[0].endMs = 5000;
    artifact.cues[1].startMs = 6500;
    artifact.cues[1].endMs = 10000;
    artifact.durationMs = 10000;
    const timing = buildSilentTiming(artifact);
    assert.equal(timing.timingKind, 'source_srt');
    assert.deepEqual(timing.cues, artifact.cues);
    assert.equal(timing.captions[0].startMs, 2000);
    assert.equal(timing.captions[1].startMs, 6500);
    assert.equal(timing.scenes[0].endMs, 5750);
  }],
  ['无效时间来源、重叠、越界与字幕覆盖错误均拒绝', () => {
    const mutations = [
      artifact => { artifact.timingKind = 'provider_native_words'; },
      artifact => { artifact.durationMs = NaN; },
      artifact => { artifact.cues[1].startMs = 0; },
      artifact => { artifact.cues[0].endMs = 0; },
      artifact => { artifact.cues[1].endMs = 30001; },
      artifact => { artifact.cues[0].startMs = 0.5; },
      artifact => { artifact.cues[0].text = ' '; },
      artifact => { artifact.cues[1].id = artifact.cues[0].id; },
      artifact => { artifact.scenes[0].cueIds = ['missing']; },
      artifact => { artifact.scenes.reverse(); },
    ];
    for (const mutate of mutations) {
      const artifact = plan();
      mutate(artifact);
      assert.throws(() => buildSilentTiming(artifact), error => error.code === 'TIMELINE_INVALID');
    }
  }],
  ['过短分镜与过快计划字幕给出可操作的错误', () => {
    const shortScene = plan({ burnSubtitles: false });
    shortScene.cues[0].endMs = 700;
    shortScene.cues[1].startMs = 700;
    assert.throws(() => buildSilentTiming(shortScene), /减少分镜或增加目标时长/);
    const fast = plan({ texts: ['绘'.repeat(300)], seconds: 15 });
    assert.throws(() => buildSilentTiming(fast), /增加目标时长.*合并短句/);
    fast.productionPlan.burnSubtitles = false;
    assert.equal(buildSilentTiming(fast).durationMs, 15000, '未显示字幕时仍保留动画时间轴');
    fast.productionPlan.burnSubtitles = true;
    fast.timingKind = 'source_srt';
    assert.equal(buildSilentTiming(fast).timingKind, 'source_srt', '输入 SRT 不套用新计划的阅读速度限制');
  }],
  ['启用旁白仍使用同次原生证据，而非计划时长', () => {
    const artifact = plan({ texts: ['先画圆形。', '再画方形。'] });
    artifact.productionPlan.narrationMode = 'enabled';
    const timing = buildNarrationTiming(artifact, { provider: 'minimax', words: [
      { text: '先画圆形。', start_time: 100, end_time: 2200 },
      { text: '再画方形。', start_time: 3100, end_time: 5300 },
    ] }, 6000);
    assert.equal(timing.timingKind, 'provider_native_words');
    assert.equal(timing.durationMs, 6000);
    assert.equal(timing.cues[0].startMs, 100);
    assert.equal(timing.cues[1].endMs, 5300);
  }],
  ['三种输入的表单均允许无旁白且保留时间与改写设置', async () => {
    const source = await fs.readFile(path.join(__dirname, '../frontend-react/src/components/creative/whiteboard/whiteboardForm.js'), 'utf8');
    const { createWhiteboardDraft, validateWhiteboardDraft, buildWhiteboardPayload } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    for (const mode of ['topic', 'text', 'srt']) {
      const draft = createWhiteboardDraft();
      draft.inputMode = mode;
      draft.productionPlan.narrationMode = 'disabled';
      draft.contents[mode] = mode === 'srt' ? '1\n00:00:00,000 --> 00:00:03,000\n开始绘制。' : '保留这段正文。';
      assert.equal(validateWhiteboardDraft(draft), '');
      const payload = buildWhiteboardPayload(draft);
      assert.equal(payload.productionPlan.narrationMode, 'disabled');
      assert.equal(payload.input.inputMode, mode);
      assert.equal(payload.input.targetDurationSeconds, mode === 'srt' ? undefined : 60);
      if (mode === 'text') assert.equal(payload.input.rewritePolicy, 'preserve');
      if (mode !== 'srt') {
        draft.targetDurationSeconds = 0;
        assert.match(validateWhiteboardDraft(draft), /目标时长/);
      }
    }
  }],
];

(async () => {
  for (const [name, run] of cases) { await run(); console.log(`PASS ${name}`); }
  console.log(`无旁白时间轴：${cases.length} 项验证通过；未调用模型或媒体工具。`);
})().catch(error => { console.error(error); process.exitCode = 1; });
