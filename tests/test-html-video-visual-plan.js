const assert = require('assert');
const { buildVisualPlan } = require('../server/services/creative-video/html-video/visualPlanService');
const { expandContentGraphToVisualBeats } = require('../server/services/creative-video/html-video/htmlVideoWorkflow');

const sceneSpec = {
  title: 'UI/UE/UX',
  aspect_ratio: '16:9',
  scenes: [
    {
      id: 'scene_01',
      kind: 'text',
      speech_duration_sec: 18,
      narration_text: 'UI 是界面的样子。UE 是使用过程。UX 是整体体验。',
      visual_text: { headline: '三个概念', cards: ['UI', 'UE', 'UX'] },
    },
    {
      id: 'scene_02',
      kind: 'steps',
      speech_duration_sec: 6,
      narration_text: '第一步观察，第二步优化。',
      visual_text: { headline: '两个步骤', cards: ['观察', '优化'] },
    },
  ],
};

const plan = buildVisualPlan({ sceneSpec, workflowId: '20260709000000000000' });

assert.equal(plan.version, 1);
assert.ok(plan.style_profile.id);
assert.equal(plan.beats.filter(beat => beat.scene_id === 'scene_01').length, 3);
assert.equal(plan.beats.filter(beat => beat.scene_id === 'scene_02').length, 1);
assert.ok(plan.beats.every(beat => beat.duration_sec >= 3 && beat.duration_sec <= 8));
assert.deepEqual(plan.beats.map(beat => beat.order), [1, 2, 3, 4]);
assert.equal(plan.beats[0].intent, 'definition');
assert.equal(plan.beats[3].intent, 'steps');
assert.deepEqual(plan.beats.filter(beat => beat.scene_id === 'scene_01').map(beat => beat.visual_text.cards), [['UI'], ['UE'], ['UX']]);

const expandedGraph = expandContentGraphToVisualBeats({
  graph: {
    nodes: [{
      id: 'scene_01',
      scene_id: 'scene_01',
      kind: 'text',
      label: '三个概念',
      text: 'UI UE UX',
      html_path: 'frames/old-scene.html',
    }],
    edges: [],
  },
  visualPlan: {
    beats: plan.beats.filter(beat => beat.scene_id === 'scene_01'),
  },
  visualDecisions: new Map(plan.beats
    .filter(beat => beat.scene_id === 'scene_01')
    .map(beat => [beat.id, { beat_id: beat.id, scene_id: beat.scene_id, source_mode: 'raw_html' }])),
});
assert.deepEqual(expandedGraph.nodes.map(node => node.id), ['scene_01_b1', 'scene_01_b2', 'scene_01_b3']);
assert.deepEqual(expandedGraph.nodes.map(node => node.data.visual_text.cards), [['UI'], ['UE'], ['UX']]);
assert.ok(expandedGraph.nodes.every(node => node.beat_id === node.id));
assert.ok(expandedGraph.nodes.every(node => node.html_path === ''));
assert.equal(expandedGraph.edges.length, 2);

// 边界：空输入不抛错，返回空 beats
const emptyPlan = buildVisualPlan({});
assert.deepEqual(emptyPlan.beats, []);
assert.equal(emptyPlan.version, 1);

// 边界：无 id 场景生成的 beat id 全局唯一且非空
const noIdPlan = buildVisualPlan({
  sceneSpec: {
    scenes: [
      { kind: 'text', speech_duration_sec: 18, narration_text: '第一段' },
      { kind: 'text', speech_duration_sec: 18, narration_text: '第二段' },
    ],
  },
  workflowId: '20260709000000000001',
});
const noIdBeatIds = noIdPlan.beats.map(beat => beat.id);
assert.ok(noIdBeatIds.every(id => typeof id === 'string' && id.length > 0));
assert.equal(new Set(noIdBeatIds).size, noIdBeatIds.length);

// 边界：缺时长字段回落为 1 个 6s beat
const noDurationPlan = buildVisualPlan({
  sceneSpec: { scenes: [{ id: 'scene_x', kind: 'text', narration_text: '无时长' }] },
  workflowId: '20260709000000000002',
});
assert.equal(noDurationPlan.beats.length, 1);
assert.equal(noDurationPlan.beats[0].duration_sec, 6);

// beat.asset_refs 为空数组时不应吞掉 base 节点已有的素材引用；非空时用 beat refs 覆盖
{
  const baseGraph = {
    nodes: [{
      id: 'scene_01',
      scene_id: 'scene_01',
      kind: 'text',
      label: '三个概念',
      asset_refs: [{ asset_id: 'gen_scene_01', usage: 'subject' }],
    }],
    edges: [],
  };
  const beats = plan.beats.filter(beat => beat.scene_id === 'scene_01');
  const emptyRefsGraph = expandContentGraphToVisualBeats({
    graph: baseGraph,
    visualPlan: { beats: beats.map(beat => ({ ...beat, asset_refs: [] })) },
    visualDecisions: null,
  });
  assert.ok(
    emptyRefsGraph.nodes.every(node => (node.asset_refs || []).some(ref => ref.asset_id === 'gen_scene_01')),
    'beat.asset_refs 为空数组时应回落 base 节点的素材引用',
  );
  const overrideRefsGraph = expandContentGraphToVisualBeats({
    graph: baseGraph,
    visualPlan: {
      beats: beats.map((beat, index) => ({
        ...beat,
        asset_refs: index === 0 ? [{ asset_id: 'gen_other', usage: 'subject' }] : [],
      })),
    },
    visualDecisions: null,
  });
  assert.deepEqual(
    overrideRefsGraph.nodes[0].asset_refs.map(ref => ref.asset_id),
    ['gen_other'],
    'beat.asset_refs 非空时应覆盖 base 节点的素材引用',
  );
}

// ===== 模块2：asset_first motion 编排字段 =====
const { assignMotionOrchestration } = require('../server/services/creative-video/html-video/visualPlanService');

// P0-1：只有明确结构类型的 beat 有 motion_overlay，普通图片 beat 为 null
// （原"每个 beat 必须有 preset"契约已废止，规格 §7.3/§16 P0-1）
{
  const plan = { beats: [
    { id: 'b_text', scene_id: 's1', kind: 'text', asset_refs: [{ asset_id: 'gen_s1' }] },
    { id: 'b_steps', scene_id: 's2', kind: 'steps', asset_refs: [{ asset_id: 'gen_s2' }] },
  ] };
  assignMotionOrchestration(plan, { styleProfile: null });
  assert.strictEqual(plan.beats[0].motion_overlay, null, '普通图片 text beat overlay 应为 null');
  assert.ok(plan.beats[1].motion_overlay && plan.beats[1].motion_overlay.preset === 'three_step_flow', 'steps beat 仍有 overlay');
  assert.ok(plan.beats[0].visual_base && plan.beats[0].visual_base.type === 'generated_image');
  console.log('P0-1 assignMotionOrchestration null tests passed');
}

// P0-1 补充：结构类型 beat（steps）仍写入 theme_tokens / continuity / visual_base
// （保留原用例块的 R5 theme_tokens 回归与 continuity 覆盖，仅把承载 overlay 的 beat 换成结构类型）
{
  const visualPlan = {
    beats: [
      { id: 'scene_02_b1', scene_id: 'scene_02', kind: 'steps', duration_sec: 5.67,
        asset_refs: [{ asset_id: 'gen_scene_02', usage: 'subject' }] },
      // P0-1：同场景普通图片 text beat 不再强制叠卡
      { id: 'scene_02_b2', scene_id: 'scene_02', kind: 'text', duration_sec: 5.67,
        asset_refs: [{ asset_id: 'gen_scene_02', usage: 'subject' }] },
      { id: 'scene_04_b1', scene_id: 'scene_04', kind: 'text', duration_sec: 5.97, asset_refs: [] },
    ],
  };
  // R5：用真实 buildVisualPlan 产出的 style_profile（palette 是数组，索引语义 [background, foreground, accent]）
  const realPlan = buildVisualPlan({
    sceneSpec: { title: 'UI/UE/UX', scenes: [{ id: 'scene_02', kind: 'text', duration_sec: 6, narration_text: 'x' }] },
    workflowId: 'wf-test',
  });
  assignMotionOrchestration(visualPlan, {
    styleProfile: realPlan.style_profile,
  });

  const b1 = visualPlan.beats[0];
  assert.strictEqual(b1.visual_base.type, 'generated_image');
  assert.strictEqual(b1.visual_base.asset_id, 'gen_scene_02');
  assert.strictEqual(b1.visual_base.continuity_group, 'scene_02');
  assert.strictEqual(b1.motion_overlay.preset, 'three_step_flow', 'steps beat 仍有 motion_overlay.preset');
  assert.strictEqual(b1.motion_overlay.avoid_caption_bottom_px, 140);
  const [bg, fg, accent] = realPlan.style_profile.palette;
  assert.strictEqual(b1.motion_overlay.theme_tokens.background, bg);
  assert.strictEqual(b1.motion_overlay.theme_tokens.foreground, fg);
  assert.strictEqual(b1.motion_overlay.theme_tokens.accent, accent);
  assert.ok(typeof b1.motion_overlay.theme_tokens.surface === 'string' && b1.motion_overlay.theme_tokens.surface.length > 0);
  assert.notStrictEqual(b1.motion_overlay.theme_tokens.accent, '#FF5A36', '真实 palette 不得被默认色覆盖（R5 回归）');
  assert.deepStrictEqual(
    { ...b1.continuity },
    { group_id: 'scene_02', reuse_base_layout: true, beat_index: 1, beat_count: 2 },
  );
  assert.strictEqual(visualPlan.beats[1].continuity.beat_index, 2);

  // P0-1：普通图片 text beat overlay 为 null，但 visual_base 照常写入
  const b2 = visualPlan.beats[1];
  assert.strictEqual(b2.motion_overlay, null, '普通图片 text beat overlay 应为 null');
  assert.strictEqual(b2.visual_base.type, 'generated_image');

  // 无图 beat：visual_base.type = diagram，不能留空；diagram base 不叠卡 → overlay null
  const b3 = visualPlan.beats[2];
  assert.strictEqual(b3.visual_base.type, 'diagram');
  assert.strictEqual(b3.visual_base.asset_id, null);
  assert.strictEqual(b3.motion_overlay, null, 'diagram base beat overlay 应为 null');
}

console.log('visual plan motion orchestration tests passed');

console.log('test-html-video-visual-plan passed');
