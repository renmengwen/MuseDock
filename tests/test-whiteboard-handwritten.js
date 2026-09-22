const { importBrowserModule } = require('./helpers/import-browser-module.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const contracts = require('../server/services/creative/whiteboard/contracts');
const models = require('../server/services/creative/whiteboard/mediaModels');
const timing = require('../server/services/creative/whiteboard/narrationTiming');

(async () => {
  const { HANDWRITTEN_PRESET_ID, VISUAL_PRESETS, normalizeInput, materializeCandidate, canvasFor, renderingFor, candidateContractFor } = contracts;
  const canvas = canvasFor('4:3');
  assert.deepEqual(canvas, { width: 1440, height: 1080 });
  const input = normalizeInput({ inputMode: 'text', content: '先看关系，再得结论。', targetDurationSeconds: 15,
    aspectRatio: '4:3', visualStylePreset: HANDWRITTEN_PRESET_ID });
  const candidate = { schemaVersion: 1, title: '手写图解', summary: '依次绘制关系和结论。', cues: [{ id: 'cue_1', text: input.content }],
    scenes: [{ id: 'scene_1', title: '关系图解', cueIds: ['cue_1'], imagePrompt: '纯白纸面上，两个人物及红蓝关系词组依次出现。', imageTexts: ['关系', '结论'] }] };
  const artifact = materializeCandidate(candidate, input, { handDisplayMode: 'show', narrationMode: 'enabled', bgmMode: 'enabled' });
  assert.deepEqual(artifact.canvas, canvas);
  assert.equal(artifact.visualStyle.rendererCompatibility, 'whiteboard-handwritten-stream-v1');
  assert.equal(artifact.visualStyle.promptRecipeSha256, contracts.sha256(artifact.visualStyle.promptRecipe));
  assert.equal(renderingFor(artifact.visualStyle).canvasHex, '#FFFFFF');
  assert.equal(renderingFor(artifact.visualStyle).inkMode, 'source-color');
  assert.equal(artifact.productionPlan.handDisplayMode, 'show');
  assert.equal(artifact.productionPlan.narrationMode, 'enabled');
  assert.equal(artifact.productionPlan.bgmMode, 'enabled');
  assert.equal(artifact.durationMs, 15000, '样例的 12 秒不能成为产品固定时长');
  assert.ok(candidateContractFor(input).schema.properties.scenes.items.required.includes('imageTexts'));
  const missingTexts = structuredClone(candidate);
  delete missingTexts.scenes[0].imageTexts;
  assert.ok(contracts.validateCandidate(missingTexts, input).some(error => error.includes('imageTexts')));
  const brokenStyle = structuredClone(artifact.visualStyle);
  brokenStyle.rendering.canvasHex = '#F5EBD7';
  assert.throws(() => renderingFor(brokenStyle), error => error.code === 'CONTRACT_UNSUPPORTED');
  assert.equal(VISUAL_PRESETS.length, 7);
  for (const preset of VISUAL_PRESETS.slice(0, 6)) {
    const legacyInput = { ...input, visualStylePreset: preset.id, aspectRatio: undefined };
    const legacy = materializeCandidate(missingTexts, legacyInput, {});
    assert.deepEqual(legacy.canvas, canvasFor('16:9'));
    assert.equal(legacy.visualStyle.rendererCompatibility, 'warm-paper-stream-v1');
    assert.equal(renderingFor(legacy.visualStyle), null);
    assert.equal(candidateContractFor(legacyInput).schema, contracts.CANDIDATE_SCHEMA);
    assert.ok(models.lineartPrompt(legacy, legacy.scenes[0]).includes('暖米黄纸底'));
  }

  const scene = { id: 'scene_1', cueIds: ['cue_1'], startMs: 170, endMs: 6170 };
  const annotation = { schemaVersion: 3, visualGrouping: { mode: 'semantic_regions', reason: '标题、人物、词组和关系线独立排列，按叙事顺序逐个揭示。' },
    elements: Array.from({ length: 16 }, (_, index) => ({ label: `语义区域 ${index + 1}`,
      region: { x: 30 + index % 4 * 340, y: 30 + Math.floor(index / 4) * 220, width: 280, height: 170 },
      direction: 'left-to-right', weight: index + 1, protectedRegions: [] })) };
  annotation.elements[0].polygon = [[35, 35], [300, 35], [300, 190], [35, 190]];
  assert.deepEqual(models.validateAnnotation(annotation, canvas, artifact.visualStyle, scene), []);
  assert.ok(models.validateAnnotation(annotation, canvas).length, '旧模板不能接受新的多分区候选');
  const invalid = structuredClone(annotation);
  invalid.elements[0].polygon = [[35, 35], [300, 190], [300, 35], [35, 190]];
  assert.ok(models.validateAnnotation(invalid, canvas, artifact.visualStyle).some(error => error.includes('polygon')));
  invalid.elements[0].polygon = [[35, 35], [1441, 35], [300, 190]];
  assert.ok(models.validateAnnotation(invalid, canvas, artifact.visualStyle).length);
  invalid.elements[0].polygon = [[30, 30], [310, 30], [310, 200], [30, 200]];
  const beforeValidation = structuredClone(invalid);
  const boundaryErrors = models.validateAnnotation(invalid, canvas, artifact.visualStyle);
  assert.equal(boundaryErrors.length, 1);
  assert.match(boundaryErrors[0], /区域 1.*第 2 个点 \[310,30\].*x=30\.\.309.*y=30\.\.199/);
  assert.deepEqual(invalid, beforeValidation, '校验不得静默改写多边形或放宽边界');
  invalid.elements[0].polygon = [[30, 30], [309, 30], [309, 199], [30, 199]];
  assert.deepEqual(models.validateAnnotation(invalid, canvas, artifact.visualStyle), []);
  invalid.elements[0].polygon.push([30, 30]);
  assert.match(models.validateAnnotation(invalid, canvas, artifact.visualStyle)[0], /第 5 个点与第 1 个点重复/);
  invalid.elements[0].polygon = [[30, 30], [31, 31], [32, 32]];
  assert.match(models.validateAnnotation(invalid, canvas, artifact.visualStyle)[0], /面积为零/);
  assert.ok(models.validateAnnotation({ ...annotation, elements: Array(25).fill(annotation.elements[0]) }, canvas, artifact.visualStyle).length);
  assert.ok(models.validateAnnotation(annotation, canvas, artifact.visualStyle, { startMs: 0, endMs: 2000 }).length);
  const formal = models.materializeAnnotation(annotation, scene, 'image', 'timing', canvas, artifact.visualStyle);
  assert.deepEqual(formal.rendering, artifact.visualStyle.rendering);
  assert.deepEqual(formal.elements[0].polygon, annotation.elements[0].polygon);
  assert.ok(formal.elements.every(element => element.reveal.durationMs >= 100));
  assert.equal(formal.elements.at(-1).reveal.startMs + formal.elements.at(-1).reveal.durationMs, 5500);
  for (let index = 1; index < formal.elements.length; index += 1) {
    assert.equal(formal.elements[index].reveal.startMs, formal.elements[index - 1].reveal.startMs + formal.elements[index - 1].reveal.durationMs);
  }
  const annotationInput = { scene, cues: [], canvas, visualStyle: artifact.visualStyle, imageTexts: candidate.scenes[0].imageTexts,
    imageSha256: 'image', timingIdentity: 'timing' };
  const plan = models.annotationInput(annotationInput);
  assert.equal(plan.planningContract, models.HANDWRITTEN_ANNOTATION_CONTRACT);
  assert.match(plan.prompt, /1440×1080/);
  assert.match(plan.prompt, /schemaVersion=3/);
  assert.notEqual(plan.inputIdentity, models.annotationInput({ ...annotationInput, imageTexts: ['不同原文'] }).inputIdentity);
  assert.equal(models.annotationInput(annotationInput, plan.planningContract).inputIdentity, plan.inputIdentity, '恢复重建同一冻结输入身份');
  assert.match(plan.prompt, /region\.x\+region\.width-1/);
  const legacyPlan = models.annotationInput(annotationInput, models.LEGACY_HANDWRITTEN_ANNOTATION_CONTRACT);
  assert.doesNotMatch(legacyPlan.prompt, /region\.x\+region\.width-1/);
  assert.notEqual(plan.inputIdentity, legacyPlan.inputIdentity, '新请求显式使用新的边界提示词版本');
  assert.equal(models.annotationInput({ ...annotationInput, visualStyle: VISUAL_PRESETS.find(item => item.id === HANDWRITTEN_PRESET_ID) },
    models.LEGACY_HANDWRITTEN_ANNOTATION_CONTRACT).inputIdentity,
  '24195721b3b40ee45dc8833382a222a48f8448b9a80576a1b2ecd1bf760d2b62', '旧版提示词和输入身份必须保持原字节语义，供旧候选恢复');

  for (const [modelId, expected] of [['gpt-image-2', '1536x1024'], ['fixture-image', '2304x1728']]) {
    let request;
    await models.generateLineart({ artifact, scene: candidate.scenes[0], imageConfig: { modelId }, services: {
      aiImageModel: { generateImages: async value => { request = value; return { success: true, images: [{ b64_json: Buffer.from('fixture').toString('base64') }] }; } },
    } });
    assert.equal(request.size, expected);
    assert.match(request.prompt, /纯白/);
    assert.match(request.prompt, /1440×1080/);
    assert.match(request.prompt, /唯一允许的画内原文/);
    assert.equal(request.maxImages, 1);
  }
  assert.equal(models.lineartPrompt(artifact, candidate.scenes[0]), models.lineartPrompt({ ...artifact,
    productionPlan: { ...artifact.productionPlan, burnSubtitles: false } }, candidate.scenes[0]), '字幕开关不应触发重复生图');
  const textScenes = [{ sceneId: 'scene_1', title: '关系图解', imageTexts: ['关系', '结论'] }];
  const findings = { passed: true, summary: '实图文字核对结果。', issues: [], imageCount: 1,
    textReviews: [{ sceneId: 'scene_1', observedTexts: ['关系', '结伦'], reason: '末尾词组第二个字与原文不同，需要用户检查。' }] };
  assert.deepEqual(models.validateVisualReview(findings, { imageCount: 1, imageTextScenes: textScenes }), []);
  assert.equal(models.imageTextReviewIssues(findings, textScenes).length, 1, '错字必须覆盖 passed=true 的矛盾结论');
  assert.ok(models.validateVisualReview({ ...findings, textReviews: [] }, { imageCount: 1, imageTextScenes: textScenes }).length);

  for (const [aspectRatio, limit] of [['4:3', 24], ['16:9', 28], ['9:16', 16]]) {
    const parts = timing.splitCaption('字'.repeat(73), 'zh-CN', aspectRatio);
    assert.ok(parts.every(part => part.length > 0 && part.length <= limit));
    assert.equal(parts.join(''), '字'.repeat(73));
  }
  const formSource = await fs.readFile(require.resolve('../frontend-react/src/components/creative/whiteboard/whiteboardForm.js'), 'utf8');
  const form = await importBrowserModule('frontend-react/src/components/creative/whiteboard/whiteboardForm.js');
  assert.deepEqual(form.WHITEBOARD_CANVAS_FORMATS, contracts.CANVAS_FORMATS);
  const draft = { ...form.createWhiteboardDraft(), aspectRatio: '4:3', visualStylePreset: HANDWRITTEN_PRESET_ID };
  draft.contents.topic = '关系图解';
  assert.equal(form.validateWhiteboardDraft(draft), '');
  assert.equal(form.whiteboardCanvasLabel('4:3'), '横屏 4:3');
  assert.equal(form.buildWhiteboardPayload(JSON.parse(JSON.stringify(draft))).input.aspectRatio, '4:3');
  console.log('白底手写图解合同通过：7 个模板、3 种画幅、冻结参数与原文、16 区多边形、时长预算、旧合同兼容、图片尺寸与文字诊断；真实 provider 调用 0。');
})().catch(error => { console.error(error); process.exitCode = 1; });
