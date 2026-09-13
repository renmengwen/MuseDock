const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { canvasFor, normalizeInput, materializeCandidate } = require('../server/services/creative/whiteboard/contracts');
const models = require('../server/services/creative/whiteboard/mediaModels');
const timing = require('../server/services/creative/whiteboard/narrationTiming');
const mediaTools = require('../server/services/creative/whiteboard/mediaTools');

(async () => {
  const portrait = canvasFor('9:16');
  assert.deepEqual(canvasFor(), { width: 1920, height: 1080 });
  assert.deepEqual(portrait, { width: 1080, height: 1920 });
  assert.throws(() => canvasFor('1:1'));
  const text = '竖屏字幕'.repeat(12);
  const input = normalizeInput({ inputMode: 'text', content: text, targetDurationSeconds: 15, aspectRatio: '9:16' });
  const candidate = { schemaVersion: 1, title: '竖屏画幅检查', summary: '在纵向画布上依次呈现图形。',
    cues: [{ id: 'cue_1', text }], scenes: [{ id: 'scene_1', title: '纵向图形', cueIds: ['cue_1'], imagePrompt: '暖米黄竖屏纸张，上下安排相互独立的图形并保留连续留白。' }] };
  const artifact = materializeCandidate(candidate, input, {});
  assert.deepEqual(artifact.canvas, portrait);
  assert.equal(artifact.aspectRatio, '9:16');
  assert.equal(materializeCandidate(candidate, { ...input, aspectRatio: undefined }, {}).aspectRatio, '16:9');

  const annotation = { schemaVersion: 2,
    visualGrouping: { mode: 'single_continuous', reason: '下半部树木的树根、树干和枝条相互连通，应作为一个完整主体。' },
    elements: [{ label: '完整树木', region: { x: 100, y: 1150, width: 700, height: 650 }, direction: 'top-to-bottom', weight: 1, protectedRegions: [] }] };
  assert.deepEqual(models.validateAnnotation(annotation, portrait), []);
  assert.ok(models.validateAnnotation(annotation).length, '竖屏的下半部坐标不能误用横屏边界校验');
  const overflow = structuredClone(annotation);
  overflow.elements[0].region.x = 900;
  assert.ok(models.validateAnnotation(overflow, portrait).length, '竖屏横向越界必须拒绝');
  const formal = models.materializeAnnotation(annotation, { id: 'scene_1', startMs: 0, endMs: 2000 }, 'image', 'timing', portrait);
  assert.deepEqual(formal.canvas, portrait);
  assert.ok(models.annotationPrompt({ scene: {}, cues: [], canvas: portrait }).includes('1080×1920'));
  const portraitLineartPrompt = models.lineartPrompt(artifact, artifact.scenes[0]);
  // “手机竖屏 9:16”会被生图模型实体化（画出手机外壳与锁屏时间），构图指令只允许比例描述，
  // 引用画面描述中的设备词时必须带“只理解为画幅比例”的防御条款。
  assert.ok(portraitLineartPrompt.includes('画面高度明显大于宽度'));
  assert.ok(!portraitLineartPrompt.includes('手机竖屏 9:16'));
  assert.ok(portraitLineartPrompt.includes('不要画手机、平板、屏幕'), '必须显式禁止设备与界面元素');
  assert.ok(portraitLineartPrompt.includes('只理解为画幅比例'));
  assert.ok(!models.lineartPrompt(artifact, artifact.scenes[0]).includes('横向宽幅'));
  for (const [modelId, expectedSize] of [['gpt-image-1', '1024x1536'], ['seedream-test', '1440x2560']]) {
    let requested;
    await models.generateLineart({ artifact, scene: artifact.scenes[0], imageConfig: { modelId }, services: {
      aiImageModel: { generateImages: async request => { requested = request; return { success: true, images: [{ b64_json: Buffer.from('fixture-only').toString('base64') }] }; } },
    } });
    assert.equal(requested.size, expectedSize);
    assert.equal(requested.maxImages, 1);
  }

  const parts = timing.splitCaption(text, 'zh-CN', '9:16');
  assert.ok(parts.every(part => Array.from(part).length <= 32));
  assert.equal(parts.join(''), text);
  const evidence = { provider: 'fixture', words: Array.from(text).map((character, index) => ({ text: character, start_time: index * 100, end_time: index * 100 + 99 })) };
  const aligned = timing.buildNarrationTiming(artifact, evidence, 5000);
  assert.equal(aligned.captions.length, 2);
  assert.equal(aligned.captions[1].startMs, 3200, '竖屏重新分段仍须使用原生字级时间');
  assert.equal(aligned.captions.map(cue => cue.text).join(''), text);

  const runtime = await mediaTools.preflight({ aspectRatio: '9:16' });
  assert.equal(runtime.recipe.width, 1080);
  assert.equal(runtime.recipe.height, 1920);
  const root = await fs.mkdtemp(path.resolve('.codex-runtime/whiteboard-canvas-test-'));
  const output = path.join(root, 'portrait.ass');
  const subtitle = await mediaTools.python('subtitles', { font: runtime.font, canvas: portrait,
    cues: [{ text: '字'.repeat(32), startMs: 0, endMs: 2000 }], output });
  assert.equal(subtitle.fontSize, 52);
  assert.equal(subtitle.marginV, 192);
  const ass = await fs.readFile(output, 'utf8');
  assert.match(ass, /PlayResX: 1080\r?\nPlayResY: 1920/);
  assert.ok(ass.includes('\\N'), '竖屏字幕应按实际可用宽度换为两行');
  console.log('横竖画幅合同通过：旧输入兼容、坐标边界、生图尺寸、原生字幕重分段、竖屏字幕画布与安全留白；真实 provider 调用 0。');
})().catch(error => { console.error(error); process.exitCode = 1; });
