const assert = require('node:assert/strict');
const { fixture } = require('./test-whiteboard-annotation-workflow');
const store = require('../server/services/creative/whiteboard/mediaStore');
const workflows = require('../server/services/creative/creativeWorkflows');
const production = require('../server/services/creative/whiteboard/productionWorkflows');
const { editedCandidate } = require('../server/services/creative/whiteboard/annotationEditing');
const models = require('../server/services/creative/whiteboard/mediaModels');
const contracts = require('../server/services/creative/whiteboard/contracts');

(async () => {
  const geometry = await import('../frontend-react/src/components/creative/whiteboard/annotationGeometry.mjs');
  for (const canvas of [{ width: 1920, height: 1080 }, { width: 1440, height: 1080 }, { width: 1080, height: 1920 }]) {
    assert.deepEqual(geometry.dragRegion({ x: 20, y: 30, width: 300, height: 200 }, 'move', 9999, -9999, canvas),
      { x: canvas.width - 300, y: 0, width: 300, height: 200 });
    const resized = geometry.dragRegion({ x: 20, y: 30, width: 300, height: 200 }, 'tl', 9999, 9999, canvas);
    assert.deepEqual(resized, { x: 300, y: 210, width: 20, height: 20 });
  }
  const ctx = await fixture(2);
  assert.equal((await ctx.run()).status, 'waiting_approval');
  let record = await ctx.read();
  let binding = record.whiteboard.media.annotations.scene_1;
  const secondIdentity = record.whiteboard.media.annotations.scene_2.identity;
  const original = await store.readData(record, binding.annotation, ctx.rootDir);
  const oldIdentity = binding.identity;
  const calls = [...ctx.calls];
  const edit = { sceneId: 'scene_1', expectedAnnotationIdentity: binding.identity,
    elements: original.elements.map(e => ({ id: e.id, region: { ...e.region, x: 30, width: 500 } })) };
  const stalePayload = ctx.payload(record, 'save_annotation', edit);
  const saved = await ctx.action('save_annotation', edit);
  assert.equal(saved.success, true, saved.message);
  assert.equal(saved.startTask, false);
  record = await ctx.read(); binding = record.whiteboard.media.annotations.scene_1;
  assert.notEqual(binding.identity, oldIdentity);
  assert.equal(record.whiteboard.media.annotations.scene_2.identity, secondIdentity);
  assert.equal(record.whiteboard.media.gate, 'annotation_approval');
  assert.equal(record.status, 'waiting_approval');
  assert.deepEqual([...ctx.calls], calls, '手工保存不得调用模型');
  assert.equal((await store.readData(record, binding.annotation, ctx.rootDir)).elements[0].region.x, 30);
  assert.equal((await workflows.actOnWhiteboardWorkflow(ctx.id, stalePayload, ctx.options)).code, 'STALE_IDENTITY');
  assert.equal((await ctx.action('save_annotation', edit)).code, 'STALE_IDENTITY');
  const currentEdit = { ...edit, expectedAnnotationIdentity: binding.identity };
  assert.equal((await ctx.action('save_annotation', { ...currentEdit, elements: [] })).code, 'INVALID_INPUT');
  assert.equal((await ctx.action('save_annotation', { ...currentEdit, elements: [{ id: 'element_1', region: { x: 1900, y: 0, width: 500, height: 300 } }] })).code, 'INVALID_INPUT');
  ctx.faults.set('scene_1', 'local_failure');
  assert.equal((await ctx.action('save_annotation', currentEdit)).success, false);
  assert.equal((await ctx.read()).whiteboard.media.annotations.scene_1.identity, binding.identity, '本地预览失败时保留已保存版本');
  ctx.faults.delete('scene_1');

  // 从已渲染阶段回改：撤销后续批准和成片，只删除目标幕视频绑定。
  assert.equal((await ctx.action('approve_media', { confirmed: true })).success, true);
  ctx.allowRender = true;
  assert.equal((await ctx.run()).status, 'waiting_approval');
  record = await ctx.read();
  const secondVideo = record.whiteboard.media.scenes.scene_2.identity;
  assert.equal((await ctx.action('save_annotation', currentEdit)).success, true);
  record = await ctx.read();
  assert.equal(record.whiteboard.media.stage, 'annotation_drafting');
  assert.equal(record.whiteboard.media.current.scene_render, undefined);
  assert.equal(record.whiteboard.media.scenes.scene_1, undefined);
  assert.equal(record.whiteboard.media.scenes.scene_2.identity, secondVideo);
  assert.ok(record.whiteboard.media.approvals.filter(a => a.gate === 'annotation_approval').every(a => a.stale));

  // 低覆盖保存不沿用旧接受决定，不能跳过检查；允许继续手动修复。
  binding = record.whiteboard.media.annotations.scene_1;
  ctx.faults.set('scene_1', 'low');
  assert.equal((await ctx.action('save_annotation', { ...currentEdit, expectedAnnotationIdentity: binding.identity })).success, true);
  record = await ctx.read();
  assert.equal(record.whiteboard.media.annotations.scene_1, undefined);
  assert.equal(record.whiteboard.media.gate, 'annotation_coverage_review');
  assert.ok(!production.actionsFor(record).some(a => a.id === 'approve_media'));
  ctx.faults.delete('scene_1');
  assert.equal((await ctx.action('save_annotation', { ...currentEdit, expectedAnnotationIdentity: record.whiteboard.media.lowCoverage[0].identity })).success, true);
  for (const status of ['running', 'queued', 'unknown_external_outcome']) {
    const copy = structuredClone(await ctx.read()); copy.status = status;
    assert.ok(!production.actionsFor(copy).some(a => a.id === 'save_annotation'));
  }

  // 多边形随外框变换，保护区保留绝对位置；重排后仍严格串行且留半秒。
  const visualStyle = contracts.VISUAL_PRESETS.find(preset => preset.id === contracts.HANDWRITTEN_PRESET_ID);
  const poly = { ...original, canvas: { width: 1440, height: 1080 }, elements: [
    { ...original.elements[0], id: 'a', region: { x: 10, y: 10, width: 101, height: 101 }, polygon: [[10, 10], [110, 10], [110, 110]],
      reveal: { ...original.elements[0].reveal, durationMs: 1000, protectedRegions: [{ x: 50, y: 50, width: 10, height: 10 }] } },
    { ...original.elements[0], id: 'b', reveal: { ...original.elements[0].reveal, durationMs: 1500 } },
  ] };
  const edits = [{ id: 'b', region: poly.elements[1].region }, { id: 'a', region: { x: 20, y: 30, width: 201, height: 201 } }];
  const candidate = editedCandidate(poly, { visualGrouping: { mode: 'semantic_regions', reason: '两个独立的语义区域，按用户调整后的顺序绘制。' } }, edits, visualStyle);
  assert.deepEqual(candidate.elements[1].polygon, [[20, 30], [220, 30], [220, 230]]);
  assert.deepEqual(candidate.elements[1].polygon, geometry.resizedPolygon(poly.elements[0], edits[1].region));
  assert.deepEqual(candidate.elements[1].protectedRegions, poly.elements[0].reveal.protectedRegions);
  assert.deepEqual(models.validateAnnotation(candidate, poly.canvas, visualStyle, { startMs: 0, endMs: 3000 }), []);
  const formal = models.materializeAnnotation(candidate, { id: 'scene_1', startMs: 0, endMs: 3000 }, 'image', 'timing', poly.canvas, visualStyle);
  assert.equal(formal.elements[0].reveal.startMs, 0);
  assert.equal(formal.elements[1].reveal.startMs, formal.elements[0].reveal.durationMs);
  assert.equal(formal.elements[1].reveal.startMs + formal.elements[1].reveal.durationMs, 2500);
  assert.deepEqual(formal.elements[1].polygon, candidate.elements[1].polygon);
  assert.deepEqual(geometry.reorderRegions(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  console.log('PASS 落墨编辑：保存持久化、过期拒绝、失败回滚、下游失效、低覆盖重新检查、画幅边界和多边形联动；真实模型调用 0。');
})().catch(error => { console.error(error); process.exitCode = 1; });
