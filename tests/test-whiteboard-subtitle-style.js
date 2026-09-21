const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeProductionPlan, normalizeInput, materializeCandidate, subtitleStyleFor, canvasFor, sha256 } = require('../server/services/creative/whiteboard/contracts');
const { letters, buildNarrationTiming, buildSilentTiming, buildDisplayCaptions } = require('../server/services/creative/whiteboard/narrationTiming');
const tools = require('../server/services/creative/whiteboard/mediaTools');

function fixture(aspectRatio) {
  const text = '而有些女性进入婚外关系时，原有婚姻可能已经长期处于情感枯竭之中。';
  const words = letters(text).map((text, index) => ({ text, start_time: 100 + index * 200, end_time: 270 + index * 200 }));
  const durationMs = words.at(-1).end_time + 500;
  return { artifact: { narrationText: text, narrationLanguage: 'zh-CN', aspectRatio, durationMs, timingKind: 'source_srt',
    productionPlan: normalizeProductionPlan({}), cues: [{ id: 'cue_1', text, startMs: 0, endMs: durationMs }],
    scenes: [{ id: 'scene_1', title: '字幕样式', cueIds: ['cue_1'], startMs: 0, endMs: durationMs }] },
  evidence: { provider: 'fixture', words } };
}

(async () => {
  const source = await fs.readFile(path.resolve('frontend-react/src/components/creative/whiteboard/whiteboardForm.js'), 'utf8');
  const form = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.equal(normalizeProductionPlan({}).subtitleColor, '#FFFFFF');
  assert.equal(normalizeProductionPlan({}).subtitleFontSize, null);
  for (const aspectRatio of ['16:9', '4:3', '9:16']) {
    const legacy = { burnSubtitles: true };
    const before = structuredClone(legacy);
    assert.deepEqual(subtitleStyleFor(legacy, aspectRatio), { color: '#FFFFFF', fontSize: aspectRatio === '9:16' ? 52 : 48 });
    assert.deepEqual(form.whiteboardSubtitleStyle(legacy, aspectRatio), subtitleStyleFor(legacy, aspectRatio));
    assert.deepEqual(legacy, before, '读旧设置不能改写已冻结方案');
  }
  for (const invalid of ['', '#fff', '#FFFFFFFF', 'red', '#ZZ0000', null, {}, 123]) {
    assert.throws(() => normalizeProductionPlan({ subtitleColor: invalid }), /字幕颜色/u);
    assert.ok(form.validateSubtitleSettings({ subtitleColor: invalid }));
  }
  for (const invalid of [0, 23, 97, 48.5, '48', true, [], NaN]) {
    assert.throws(() => normalizeProductionPlan({ subtitleFontSize: invalid }), /字幕字号/u);
    assert.ok(form.validateSubtitleSettings({ subtitleFontSize: invalid }));
  }
  const draft = form.createWhiteboardDraft();
  draft.contents.topic = '检查字幕样式';
  draft.productionPlan.subtitleColor = '#ffcc00';
  draft.productionPlan.subtitleFontSize = 72;
  assert.equal(form.validateWhiteboardDraft(draft), '');
  const selected = normalizeProductionPlan(form.buildWhiteboardPayload(draft).productionPlan);
  assert.equal(selected.subtitleColor, '#FFCC00');
  assert.equal(selected.subtitleFontSize, 72);
  console.log('PASS 前后端默认值、颜色和字号边界、创建参数与旧设置兼容');

  const short = 'a'.repeat(24) + ' ' + 'b'.repeat(4);
  const long = 'c'.repeat(260) + ' ' + 'd'.repeat(10);
  const input = normalizeInput({ inputMode: 'text', content: `${short}\n${long}`, narrationLanguage: 'en-US', aspectRatio: '9:16', targetDurationSeconds: 15 });
  const planned = materializeCandidate({ schemaVersion: 1, title: '小字号阅读预算', summary: '保留原时间轴。',
    cues: [{ id: 'cue_1', text: short }, { id: 'cue_2', text: long }],
    scenes: [{ id: 'scene_1', title: '阅读', cueIds: ['cue_1', 'cue_2'], imagePrompt: '纸面上的图形清晰分开，底部留白。' }] },
  input, { narrationMode: 'disabled', subtitleFontSize: 24 });
  const readable = buildSilentTiming(planned, { fontSize: 24 });
  assert.throws(() => buildSilentTiming(planned), /计划字幕显示过快/u, '本用例的默认字号确实需要更长时间');
  const reference = buildSilentTiming(planned, { referenceOnly: true });
  assert.deepEqual(reference.cues, planned.cues);
  assert.deepEqual(buildDisplayCaptions(planned, reference, 24), readable.captions);
  console.log('PASS 小字号可读时，默认字号的参考字幕不会误拦截制作');

  await fs.mkdir(path.resolve('.codex-runtime'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.codex-runtime/whiteboard-subtitle-style-test-'));
  const runtime = await tools.preflight();
  const jobs = [];
  for (const aspectRatio of ['16:9', '4:3', '9:16']) {
    const { artifact, evidence } = fixture(aspectRatio);
    const timing = buildNarrationTiming(artifact, evidence, artifact.durationMs);
    const timingIdentity = sha256(timing);
    for (const fontSize of [24, 48, 72, 96]) {
      const styled = { ...artifact, productionPlan: { ...artifact.productionPlan, subtitleColor: '#FFCC00', subtitleFontSize: fontSize } };
      assert.deepEqual(buildNarrationTiming(styled, evidence, artifact.durationMs), timing, '字号不能进入上游旁白时间线身份');
      const captions = buildDisplayCaptions(styled, timing, fontSize, evidence);
      assert.equal(captions.map(cue => cue.text).join(''), artifact.narrationText);
      assert.equal(sha256(timing), timingIdentity);
      if (fontSize === 96) assert.ok(captions.length > timing.captions.length, '大字号必须重新分段，不能挤出单行');
      let offset = 0;
      for (const caption of captions) {
        const count = letters(caption.text).length;
        assert.equal(caption.startMs, evidence.words[offset].start_time);
        assert.equal(caption.endMs, evidence.words[offset + count - 1].end_time);
        offset += count;
      }
      for (const timingKind of ['source_srt', 'provisional']) {
        const silent = { ...styled, timingKind, productionPlan: { ...styled.productionPlan, narrationMode: 'disabled' } };
        const base = buildSilentTiming(silent);
        const before = structuredClone(base);
        const display = buildDisplayCaptions(silent, base, fontSize);
        assert.deepEqual(base, before);
        assert.equal(display[0].startMs, base.cues[0].startMs);
        assert.equal(display.at(-1).endMs, base.cues.at(-1).endMs);
      }
      jobs.push({ font: runtime.font, canvas: canvasFor(aspectRatio), subtitleStyle: { color: '#FFCC00', fontSize }, captions,
        output: path.join(root, `${aspectRatio.replace(':', '-')}-${fontSize}.ass`) });
    }
    assert.throws(() => buildDisplayCaptions(artifact, timing, 96), /原生字幕/u);
    assert.deepEqual(buildDisplayCaptions({ ...artifact, productionPlan: { ...artifact.productionPlan, burnSubtitles: false } }, timing, 96), timing.captions);
  }
  const python = [
    'import sys,json',
    'sys.path.insert(0,sys.argv[1])',
    'import media',
    'data=json.load(sys.stdin)',
    'for job in data["jobs"]:',
    '    result=media.compile_subtitles({**job,"cues":job["captions"]})',
    '    assert result["fontSize"] == job["subtitleStyle"]["fontSize"]',
    '    assert result["color"] == "#FFCC00"',
    'print(json.dumps({"compiled":len(data["jobs"])}))',
  ].join('\n');
  const compiled = await tools.execute(tools.pythonPath(), ['-c', python, path.join(tools.RESOURCE_ROOT, 'python')], { input: { jobs } });
  assert.equal(JSON.parse(compiled.stdout).compiled, 12);
  for (const job of jobs) {
    const ass = await fs.readFile(job.output, 'utf8');
    assert.ok(!ass.includes('\\N'));
    assert.match(ass, new RegExp(`Style: Default,[^,]+,${job.subtitleStyle.fontSize},&H0000CCFF,`));
  }
  await assert.rejects(tools.python('subtitles', { font: runtime.font, cues: [], subtitleStyle: { color: '#fff', fontSize: 48 },
    output: path.join(root, 'invalid-color.ass') }), /字幕颜色/u);
  await assert.rejects(tools.python('subtitles', { font: runtime.font, cues: [], subtitleStyle: { color: '#FFFFFF', fontSize: 97 },
    output: path.join(root, 'invalid-size.ass') }), /字幕字号/u);
  console.log('PASS 3 种画幅 × 4 种字号实际测宽及 ASS 颜色编码，原生时间与源时间轴保持不变');
  console.log(`字幕样式专项验证通过，真实 provider 调用 0。产物目录：${root}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
