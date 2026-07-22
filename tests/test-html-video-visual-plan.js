const assert = require('assert');
const { buildVisualPlan } = require('../server/services/creative-video/html-video/visualPlanService');
const { expandContentGraphToVisualBeats } = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const { computeFrameInputFingerprint } = require('../server/services/creative-video/html-video/frameHtmlPhaseSupport');

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

assert.equal(plan.version, 2);
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
assert.equal(emptyPlan.version, 2);

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

// Graph refs 是候选权威；routing beat refs 即使冲突也不能覆盖。
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
  assert.deepEqual(overrideRefsGraph.nodes[0].asset_refs.map(ref => ref.asset_id), ['gen_scene_01']);
}

// C-02：Content Graph 候选决定稳定的 Image Sequence；不从 registry 补图。
{
  const graph = {
    nodes: [
      { id: 'single', asset_refs: [{ asset_id: 'a', usage: 'subject', reason: '主图' }] },
      { id: 'none', asset_refs: [] },
      { id: 'ordinary', asset_refs: ['a', 'b', 'c', 'd'].map(asset_id => ({ asset_id, usage: 'showcase', reason: '普通素材' })) },
      { id: 'required', asset_refs: ['a', 'b', 'c', 'd'].map(asset_id => ({ asset_id, usage: 'showcase', reason: '必用素材' })) },
      { id: 'compare', asset_refs: ['a', 'b'].map(asset_id => ({ asset_id, usage: 'showcase', reason: '两版对比' })) },
      { id: 'two_plain', asset_refs: ['a', 'b'].map(asset_id => ({ asset_id, usage: 'showcase', reason: '普通展示' })) },
      { id: 'overview', asset_refs: [{ asset_id: 'a', usage: 'showcase', reason: '整体概览' }, { asset_id: 'b', usage: 'showcase', reason: '局部细节' }] },
      { id: 'montage', asset_refs: ['a', 'b', 'c', 'd'].map(asset_id => ({ asset_id, usage: 'showcase', reason: '案例并列 montage' })) },
    ],
    edges: [],
  };
  const assets = ['a', 'b', 'c', 'd', 'registry_only'].map(id => ({
    id,
    requirement: id === 'a' || id === 'b' || id === 'c' || id === 'd' ? 'required' : 'optional',
    image_analysis: { fit: id === 'a' ? 'contain' : 'cover', summary: `${id}分析` },
  }));
  // ordinary 的素材不是 required，用于验证普通默认最多 3。
  const ordinaryAssets = assets.map(asset => ({ ...asset, requirement: 'optional' }));
  const scenes = graph.nodes.map(node => ({
    id: node.id,
    kind: node.id === 'compare' ? 'comparison' : 'text',
    duration_sec: 6,
    narration_text: node.id === 'overview' ? '先看整体概览，再看局部细节。' : node.id === 'montage' ? '四个案例并列展示。' : '普通说明。',
  }));
  const ordinaryPlan = buildVisualPlan({ graph, sceneSpec: { scenes }, creativeContext: { asset_context: { assets: ordinaryAssets } }, workflowId: 'wf-c02' });
  const byScene = new Map(ordinaryPlan.beats.map(beat => [beat.scene_id, beat]));
  assert.equal(byScene.get('single').visual_base.type, 'image_sequence');
  assert.equal(byScene.get('single').visual_base.shots[0].id, 'single_shot_01');
  assert.equal(byScene.get('none').visual_base.type, 'diagram');
  assert.equal(byScene.get('ordinary').visual_base.shots.length, 1);
  assert.equal(byScene.get('compare').visual_base.sequence_mode, 'semantic_compare');
  assert.equal(byScene.get('two_plain').visual_base.sequence_mode, 'fullscreen_relay');
  assert.equal(byScene.get('overview').visual_base.sequence_mode, 'fullscreen_relay');
  assert.equal(byScene.get('montage').visual_base.sequence_mode, 'fullscreen_relay');
  assert.equal(byScene.get('montage').visual_base.shots.length, 1);
  assert.ok(!JSON.stringify(ordinaryPlan).includes('registry_only'));
  assert.ok('caption_ids' in byScene.get('single').visual_base.shots[0]);
  assert.ok(!('visible_duration_sec' in byScene.get('single').visual_base.shots[0]));

  const requiredPlan = buildVisualPlan({ graph, sceneSpec: { scenes }, creativeContext: { asset_context: { assets } }, workflowId: 'wf-c02' });
  assert.equal(requiredPlan.beats.find(beat => beat.scene_id === 'required').visual_base.shots.length, 4);
  assert.equal(requiredPlan.input_fingerprint.length, 64);
  assert.deepEqual(requiredPlan, buildVisualPlan({ graph, sceneSpec: { scenes }, creativeContext: { asset_context: { assets } }, workflowId: 'wf-c02' }));
}

// Review：比较语义先选 2；required 冲突时不得静默丢图，明确降级并保留 required。
{
  const sceneSpec = { scenes: [{ id: 'compare', kind: 'comparison', duration_sec: 6, narration_text: '明确比较两个方案。' }] };
  const optionalGraph = { nodes: [{ id: 'compare', asset_refs: ['a', 'b', 'c'].map(asset_id => ({ asset_id, usage: 'showcase', reason: '比较候选' })) }], edges: [] };
  const optionalAssets = ['a', 'b', 'c'].map(id => ({ id, requirement: 'optional' }));
  const comparePlan = buildVisualPlan({ graph: optionalGraph, sceneSpec, creativeContext: { asset_context: { assets: optionalAssets } }, workflowId: 'compare' });
  assert.equal(comparePlan.beats[0].visual_base.sequence_mode, 'semantic_compare');
  assert.deepEqual(comparePlan.beats[0].visual_base.shots.map(shot => shot.asset_id), ['a', 'b']);

  const conflictAssets = optionalAssets.map(asset => ({ ...asset, requirement: asset.id === 'c' ? 'required' : 'optional' }));
  const conflictPlan = buildVisualPlan({ graph: optionalGraph, sceneSpec, creativeContext: { asset_context: { assets: conflictAssets } }, workflowId: 'compare' });
  assert.equal(conflictPlan.beats[0].visual_base.sequence_mode, 'fullscreen_relay');
  assert.equal(conflictPlan.beats[0].visual_base.mode_reason, 'compare_conflict_required_candidates');
  assert.deepEqual(conflictPlan.beats[0].visual_base.shots.map(shot => shot.asset_id), ['c']);
}

// Review：只扫描明确字段、识别否定语义；registry 顺序不影响 plan 与 fingerprint。
{
  const graph = { nodes: [{ id: 'plain', label: '普通展示', metadata: { unsafe_hint: 'montage overview detail comparison' }, asset_refs: [
    { asset_id: 'a', usage: 'showcase', reason: '不是蒙太奇' },
    { asset_id: 'b', usage: 'showcase', reason: '普通素材' },
  ] }], edges: [] };
  const sceneSpec = { scenes: [{ id: 'plain', kind: 'text', duration_sec: 6, narration_text: 'not a montage，只看整体概览。' }] };
  const a = { id: 'a', requirement: 'optional', image_analysis: { fit: 'contain' } };
  const b = { id: 'b', requirement: 'optional', image_analysis: { fit: 'cover' } };
  const first = buildVisualPlan({ graph, sceneSpec, creativeContext: { asset_context: { assets: [a, b] } }, workflowId: 'stable' });
  const second = buildVisualPlan({ graph, sceneSpec, creativeContext: { asset_context: { assets: [b, a] } }, workflowId: 'stable' });
  assert.equal(first.beats[0].visual_base.sequence_mode, 'fullscreen_relay');
  assert.deepEqual(first, second);
}

// Review：否定是高优先级信号，即使句中仍有“案例/并列”也不得触发 montage。
{
  const graph = { nodes: [{ id: 'negative', asset_refs: [{ asset_id: 'a', reason: '案例一' }, { asset_id: 'b', reason: '案例二' }] }], edges: [] };
  for (const narration_text of [
    '不是蒙太奇，而是两个案例普通展示。',
    '不要蒙太奇，两个案例依次展示。',
    'do not use montage; plain relay',
    'not intended as a montage; two cases side by side',
  ]) {
    const result = buildVisualPlan({ graph, sceneSpec: { scenes: [{ id: 'negative', duration_sec: 6, narration_text }] }, workflowId: 'negative' });
    assert.equal(result.beats[0].visual_base.sequence_mode, 'fullscreen_relay', narration_text);
  }
  const positive = buildVisualPlan({
    graph,
    sceneSpec: { scenes: [{ id: 'negative', duration_sec: 6, narration_text: '多个案例以蒙太奇形式并列快速展示。' }] },
    workflowId: 'positive',
  });
  assert.equal(positive.beats[0].visual_base.sequence_mode, 'fullscreen_relay');
}

// Review：Shot src 与正式 registry 路径绑定，并进入 plan/frame fingerprint；无关字段不影响。
{
  const graph = { nodes: [{ id: 'path', asset_refs: [{ asset_id: 'a', usage: 'subject', reason: '主图' }] }], edges: [] };
  const sceneSpec = { scenes: [{ id: 'path', duration_sec: 6, narration_text: '展示主图。' }] };
  const build = asset => buildVisualPlan({ graph, sceneSpec, creativeContext: { asset_context: { assets: [asset] } }, workflowId: 'path' });
  const oldPlan = build({ id: 'a', requirement: 'required', path: 'assets/old.png', frame_src: '../assets/old.png', image_analysis: { fit: 'contain' } });
  const newPlan = build({ id: 'a', requirement: 'required', path: 'assets/new.png', frame_src: '../assets/new.png', image_analysis: { fit: 'contain' } });
  const unrelatedPlan = build({ id: 'a', requirement: 'required', path: 'assets/old.png', frame_src: '../assets/old.png', image_analysis: { fit: 'contain' }, created_at: '2099-01-01', bytes: 999 });
  assert.equal(oldPlan.beats[0].visual_base.shots[0].src, '../assets/old.png');
  assert.equal(newPlan.beats[0].visual_base.shots[0].src, '../assets/new.png');
  assert.notEqual(oldPlan.input_fingerprint, newPlan.input_fingerprint);
  assert.equal(oldPlan.input_fingerprint, unrelatedPlan.input_fingerprint);
  const frameFingerprint = (plan) => {
    const src = plan.beats[0].visual_base.shots[0].src;
    return computeFrameInputFingerprint({
      node: { id: 'path', durationSec: 6, asset_refs: graph.nodes[0].asset_refs, metadata: { visual_beat: plan.beats[0] } },
      beat: plan.beats[0],
      creativeContext: { asset_context: { assets: [{ id: 'a', media_type: 'image', status: 'ready', path: src.replace(/^\.\.\//, ''), frame_src: src }] } },
      continuityMode: 'beat_mp4',
      target: { width: 1080, height: 1920 },
    });
  };
  assert.notEqual(frameFingerprint(oldPlan), frameFingerprint(newPlan));
}

// ===== 模块2：asset_first motion 编排字段 =====
const { assignMotionOrchestration } = require('../server/services/creative-video/html-video/visualPlanService');

// C-03：caption track 只使用 scene-local 时间，并确定性派生 Shot 窗口。
{
  const assets = ['a', 'b', 'c', 'd'].map((id, index) => ({
    id,
    requirement: index === 0 ? 'required' : 'optional',
    image_analysis: { contains_text: id === 'b' },
  }));
  const graph = { nodes: [{ id: 'timed', asset_refs: assets.map(asset => ({ asset_id: asset.id, reason: '案例 montage' })) }], edges: [] };
  const scene = {
    id: 'timed',
    start: 10,
    duration_sec: 8,
    narration_text: '第一段字幕很长，需要规范化拆分为多个稳定的字幕标识。第二段。第三段。第四段。',
    captions: [
      { id: 'long', start: 0, end: 4, text: '第一段字幕非常非常长，需要规范化拆分为多个稳定的字幕标识，并且保持时间连续和标识确定。' },
      { id: 'c2', start: 4, end: 5.5, text: '第二段' },
      { id: 'c3', start: 5.5, end: 6.8, text: '第三段' },
      { id: 'c4', start: 6.8, end: 8, text: '第四段' },
    ],
  };
  const timed = buildVisualPlan({ graph, sceneSpec: { scenes: [scene] }, creativeContext: { asset_context: { assets } }, workflowId: 'c03-timed' });
  const shots = timed.beats[0].visual_base.shots;
  assert.equal(timed.beats[0].visual_base.sequence_mode, 'rhythm_montage');
  assert.equal(shots[0].active_window.start_sec, 0, 'scene.start 不得叠加到 Shot 局部时间');
  assert.equal(shots.at(-1).active_window.end_sec, 8);
  assert.ok(shots.flatMap(shot => shot.caption_ids).some(id => id === 'long_01'));
  assert.ok(shots.flatMap(shot => shot.caption_ids).some(id => id === 'long_02'));
  assert.ok(shots.slice(1).every((shot, index) => shot.active_window.start_sec <= shots[index].active_window.end_sec));
  assert.equal(Math.round((shots[0].active_window.end_sec - shots[1].active_window.start_sec) * 100) / 100, 0.35);
  assert.equal(shots.find(shot => shot.asset_id === 'b').minimum_visible_duration_sec, 2);
  assert.ok(shots.filter(shot => shot.asset_id !== 'b').every(shot => shot.minimum_visible_duration_sec === 1));
  const hasForbiddenTiming = value => Boolean(value && typeof value === 'object' && (
    ['visible_duration_sec', 'enter', 'hold', 'exit', 'camera'].some(key => Object.prototype.hasOwnProperty.call(value, key))
      || Object.values(value).some(hasForbiddenTiming)
  ));
  assert.equal(hasForbiddenTiming(timed), false);
}

// C-03：单图绑定完整规范化字幕轨；同 scene 多 beat 必须携带深等 sequence。
{
  const graph = { nodes: [{ id: 'single-long', asset_refs: [{ asset_id: 'a' }] }], edges: [] };
  const scene = { id: 'single-long', start: 10, duration_sec: 15, narration_text: '这是一段足够长的旁白，用来让场景切成多个 beat，同时生成规范字幕标识。' };
  const plan = buildVisualPlan({ graph, sceneSpec: { scenes: [scene] }, creativeContext: { asset_context: { assets: [{ id: 'a' }] } } });
  assert.ok(plan.beats.length > 1);
  assert.deepEqual(plan.beats[0].visual_base, plan.beats[1].visual_base);
  const shot = plan.beats[0].visual_base.shots[0];
  assert.deepEqual(shot.active_window, { time_base: 'scene_local', start_sec: 0, end_sec: 15 });
  assert.ok(shot.caption_ids.length >= 1);
}

// C-03：短场景先移除 optional；无字幕时 optional 缩为单 Shot，required 冲突则 blocking。
{
  const graph = { nodes: [{ id: 'short', asset_refs: ['required', 'optional'].map(asset_id => ({ asset_id, reason: '依次展示' })) }], edges: [] };
  const assets = [
    { id: 'required', requirement: 'required', image_analysis: { contains_text: true } },
    { id: 'optional', requirement: 'optional' },
  ];
  const short = buildVisualPlan({ graph, sceneSpec: { scenes: [{ id: 'short', duration_sec: 2, narration_text: '短字幕' }] }, creativeContext: { asset_context: { assets } } });
  assert.deepEqual(short.beats[0].visual_base.shots.map(shot => shot.asset_id), ['required']);
  assert.ok(short.diagnostics.some(item => item.code === 'image_sequence_shots_reduced_for_duration'));

  const noCaption = buildVisualPlan({ graph, sceneSpec: { scenes: [{ id: 'short', duration_sec: 4, narration_text: '' }] }, creativeContext: { asset_context: { assets: assets.map(asset => ({ ...asset, requirement: 'optional' })) } } });
  assert.equal(noCaption.beats[0].visual_base.shots.length, 1);
  assert.deepEqual(noCaption.beats[0].visual_base.shots[0].caption_ids, []);

  const requiredAfterOptional = buildVisualPlan({
    graph: { nodes: [{ id: 'no-anchor-required', asset_refs: [{ asset_id: 'optional' }, { asset_id: 'required' }] }], edges: [] },
    sceneSpec: { scenes: [{ id: 'no-anchor-required', duration_sec: 4, narration_text: '' }] },
    creativeContext: { asset_context: { assets } },
  });
  assert.deepEqual(requiredAfterOptional.beats[0].visual_base.shots.map(shot => shot.asset_id), ['required']);

  const conflict = buildVisualPlan({ graph, sceneSpec: { scenes: [{ id: 'short', duration_sec: 2, narration_text: '' }] }, creativeContext: { asset_context: { assets: assets.map(asset => ({ ...asset, requirement: 'required', image_analysis: { contains_text: true } })) } } });
  assert.ok(conflict.diagnostics.some(item => item.code === 'required_asset_shot_timing_conflict' && item.severity === 'error'));
}

// C-03：compare 允许共享字幕；overview 保持概览全场，detail 跟随后续字幕。
{
  const assets = [{ id: 'a' }, { id: 'b' }];
  const captions = [{ id: 'intro', start: 0, end: 3, text: '先看整体' }, { id: 'detail', start: 3, end: 6, text: '再看细节' }];
  const build = (id, kind, narration, reasons) => buildVisualPlan({
    graph: { nodes: [{ id, asset_refs: reasons.map((reason, index) => ({ asset_id: assets[index].id, reason })) }], edges: [] },
    sceneSpec: { scenes: [{ id, kind, duration_sec: 6, narration_text: narration, captions }] },
    creativeContext: { asset_context: { assets } },
  }).beats[0].visual_base;
  const compare = build('compare-c03', 'comparison', '比较两种方案', ['方案 A', '方案 B']);
  assert.equal(compare.sequence_mode, 'semantic_compare');
  assert.ok(compare.shots[0].caption_ids.some(id => compare.shots[1].caption_ids.includes(id)));
  const overview = build('overview-c03', 'text', '先看整体概览，再看局部细节', ['整体概览', '局部细节']);
  assert.equal(overview.sequence_mode, 'overview_detail');
  assert.deepEqual(overview.shots[0].active_window, { time_base: 'scene_local', start_sec: 0, end_sec: 6 });
  assert.equal(overview.shots[1].active_window.start_sec, 3);
}

// C-03：重复 ID、负数、倒序和越界时间必须给出明确 blocking 字幕诊断。
{
  const plan = buildVisualPlan({
    graph: { nodes: [{ id: 'bad-captions', asset_refs: [{ asset_id: 'a' }] }], edges: [] },
    sceneSpec: { scenes: [{ id: 'bad-captions', duration_sec: 4, captions: [
      { id: 'dup', start: -1, end: 2, text: '一' },
      { id: 'dup', start: 3, end: 2, text: '二' },
      { id: 'late', start: 3, end: 5, text: '三' },
    ] }] },
    creativeContext: { asset_context: { assets: [{ id: 'a' }] } },
  });
  assert.ok(plan.diagnostics.some(item => item.code === 'image_sequence_caption_invalid' && item.severity === 'error'));
}

// C-03：caption track 是 plan/frame 输入；仅改字幕也必须改变两级指纹。
{
  const graph = { nodes: [{ id: 'caption-fingerprint', asset_refs: [{ asset_id: 'a' }] }], edges: [] };
  const build = text => buildVisualPlan({
    graph,
    sceneSpec: { scenes: [{ id: 'caption-fingerprint', duration_sec: 4, captions: [{ id: 'caption', start: 0, end: 4, text }] }] },
    creativeContext: { asset_context: { assets: [{ id: 'a' }] } },
    workflowId: 'caption-fingerprint',
  });
  const first = build('旧字幕');
  const second = build('新字幕');
  assert.notEqual(first.input_fingerprint, second.input_fingerprint);
  const frameFingerprint = (plan, text) => computeFrameInputFingerprint({
    node: { id: 'caption-fingerprint', metadata: { visual_beat: plan.beats[0] } },
    beat: plan.beats[0],
    sceneSpec: { scenes: [{ id: 'caption-fingerprint', duration_sec: 4, captions: [{ id: 'caption', start: 0, end: 4, text }] }] },
    continuityMode: 'beat_mp4',
    target: { width: 1080, height: 1920 },
  });
  assert.notEqual(frameFingerprint(first, '旧字幕'), frameFingerprint(second, '新字幕'));
}

// C-03 Review：禁用字幕时忽略 raw captions；启用时非对象和规范化 ID 冲突必须 fail-closed。
{
  const graph = { nodes: [{ id: 'caption-validation', asset_refs: [{ asset_id: 'a' }, { asset_id: 'b' }] }], edges: [] };
  const assets = [{ id: 'a' }, { id: 'b' }];
  const build = scene => buildVisualPlan({ graph, sceneSpec: { scenes: [scene] }, creativeContext: { asset_context: { assets } } });
  const disabled = build({ id: 'caption-validation', duration_sec: 4, generate_captions: false, captions: [null, 'bad'] });
  assert.equal(disabled.diagnostics.some(item => item.code === 'image_sequence_caption_invalid'), false);
  assert.equal(disabled.beats[0].visual_base.shots.length, 1);
  assert.deepEqual(disabled.beats[0].visual_base.shots[0].caption_ids, []);

  const malformed = build({ id: 'caption-validation', duration_sec: 4, captions: [null] });
  assert.ok(malformed.diagnostics.some(item => item.code === 'image_sequence_caption_invalid'));

  const collision = build({ id: 'caption-validation', duration_sec: 4, captions: [
    { id: 'long', start: 0, end: 2, text: '这是一段非常非常长的字幕，需要拆分并生成稳定的子字幕标识，确保能够触发规范化拆分。' },
    { id: 'long_01', start: 2, end: 4, text: '显式冲突' },
  ] });
  assert.ok(collision.diagnostics.some(item => item.code === 'image_sequence_caption_invalid'));
}

// C-03 Review：非 compare 模式不得复制不足的 caption；optional 先裁减，required 则阻断。
{
  const refs = ['a', 'b', 'c', 'd'].map(asset_id => ({ asset_id, reason: '案例 montage' }));
  const scene = { id: 'caption-capacity', duration_sec: 4, narration_text: '', captions: [{ id: 'only', start: 0, end: 4, text: '唯一字幕' }] };
  const optional = buildVisualPlan({
    graph: { nodes: [{ id: 'caption-capacity', asset_refs: refs }], edges: [] },
    sceneSpec: { scenes: [scene] },
    creativeContext: { asset_context: { assets: refs.map(ref => ({ id: ref.asset_id, requirement: 'optional' })) } },
  });
  assert.equal(optional.beats[0].visual_base.shots.length, 1);
  assert.ok(optional.diagnostics.some(item => item.code === 'image_sequence_shots_reduced_for_duration'));

  const required = buildVisualPlan({
    graph: { nodes: [{ id: 'caption-capacity', asset_refs: refs.slice(0, 2) }], edges: [] },
    sceneSpec: { scenes: [scene] },
    creativeContext: { asset_context: { assets: refs.slice(0, 2).map(ref => ({ id: ref.asset_id, requirement: 'required' })) } },
  });
  assert.ok(required.diagnostics.some(item => item.code === 'required_asset_shot_timing_conflict'));
}

// C-03 Review：最终窗口必须满足 minimum；尾部窄字幕对 optional 裁减、对 required 阻断。
{
  const graph = { nodes: [{ id: 'tail-window', asset_refs: [{ asset_id: 'a' }, { asset_id: 'b' }] }], edges: [] };
  const scene = { id: 'tail-window', duration_sec: 4, captions: [
    { id: 'main', start: 0, end: 3.9, text: '主体' },
    { id: 'tail', start: 3.9, end: 4, text: '尾部' },
  ] };
  const optional = buildVisualPlan({ graph, sceneSpec: { scenes: [scene] }, creativeContext: { asset_context: { assets: [{ id: 'a' }, { id: 'b' }] } } });
  assert.equal(optional.beats[0].visual_base.shots.length, 1);
  const required = buildVisualPlan({ graph, sceneSpec: { scenes: [scene] }, creativeContext: { asset_context: { assets: [{ id: 'a' }, { id: 'b', requirement: 'required' }] } } });
  assert.ok(required.diagnostics.some(item => item.code === 'required_asset_shot_timing_conflict'));

  const twoSecond = buildVisualPlan({
    graph,
    sceneSpec: { scenes: [{ ...scene, duration_sec: 2, captions: [{ id: 'main', start: 0, end: 1.9, text: '主体' }, { id: 'tail', start: 1.9, end: 2, text: '尾部' }] }] },
    creativeContext: { asset_context: { assets: [{ id: 'a' }, { id: 'b', requirement: 'required' }] } },
  });
  assert.ok(twoSecond.diagnostics.some(item => item.code === 'required_asset_shot_timing_conflict'));
}

// C-03 Review：semantic_compare 是并行预算；两张 required 文字图可在 2 秒全场共享字幕。
{
  const plan = buildVisualPlan({
    graph: { nodes: [{ id: 'parallel-compare', asset_refs: [{ asset_id: 'a' }, { asset_id: 'b' }] }], edges: [] },
    sceneSpec: { scenes: [{ id: 'parallel-compare', kind: 'comparison', duration_sec: 2, captions: [{ id: 'compare', start: 0, end: 2, text: '对比' }] }] },
    creativeContext: { asset_context: { assets: ['a', 'b'].map(id => ({ id, requirement: 'required', image_analysis: { contains_text: true } })) } },
  });
  assert.equal(plan.beats[0].visual_base.sequence_mode, 'semantic_compare');
  assert.equal(plan.beats[0].visual_base.shots.length, 2);
  assert.equal(plan.diagnostics.some(item => item.code === 'required_asset_shot_timing_conflict'), false);
  assert.ok(plan.beats[0].visual_base.shots.every(shot => shot.active_window.start_sec === 0 && shot.active_window.end_sec === 2));
}

// C-03 Review：overview 预算只计算 detail 窗口，overview 自身保持全场。
{
  const plan = buildVisualPlan({
    graph: { nodes: [{ id: 'overview-budget', asset_refs: [{ asset_id: 'a', reason: '整体概览' }, { asset_id: 'b', reason: '局部细节' }] }], edges: [] },
    sceneSpec: { scenes: [{ id: 'overview-budget', duration_sec: 3, narration_text: '先看整体概览，再看局部细节', captions: [
      { id: 'overview', start: 0, end: 1, text: '整体' },
      { id: 'detail', start: 1, end: 3, text: '细节' },
    ] }] },
    creativeContext: { asset_context: { assets: ['a', 'b'].map(id => ({ id, requirement: 'required', image_analysis: { contains_text: true } })) } },
  });
  assert.equal(plan.diagnostics.some(item => item.code === 'required_asset_shot_timing_conflict'), false);
  assert.equal(plan.beats[0].visual_base.sequence_mode, 'overview_detail');
  assert.deepEqual(plan.beats[0].visual_base.shots[0].active_window, { time_base: 'scene_local', start_sec: 0, end_sec: 3 });
  assert.deepEqual(plan.beats[0].visual_base.shots[1].active_window, { time_base: 'scene_local', start_sec: 1, end_sec: 3 });
}

// C-03 Review 2：全局字幕开关必须覆盖 scene raw captions，并且 canonical 根因不得产生级联诊断。
{
  const graph = { nodes: [{ id: 'global-caption-off', asset_refs: [{ asset_id: 'a' }] }], edges: [] };
  const disabled = buildVisualPlan({
    graph,
    sceneSpec: { scenes: [{ id: 'global-caption-off', duration_sec: 2, captions: [null] }] },
    creativeContext: { asset_context: { assets: [{ id: 'a' }] } },
    mediaOptions: { generateCaptions: false },
  });
  assert.equal(disabled.diagnostics.some(item => item.code === 'image_sequence_caption_invalid'), false);
  assert.deepEqual(disabled.beats[0].visual_base.shots[0].caption_ids, []);

  const invalid = buildVisualPlan({
    graph,
    sceneSpec: { scenes: [{ id: 'global-caption-off', duration_sec: 0.5, captions: [null] }] },
    creativeContext: { asset_context: { assets: [{ id: 'a', requirement: 'required', image_analysis: { contains_text: true } }] } },
  });
  assert.deepEqual(invalid.diagnostics.map(item => item.code), ['image_sequence_caption_invalid']);
  assert.equal('active_window' in invalid.beats[0].visual_base.shots[0], false);
}

// C-03 Review 2：无字幕先尊重 mode；compare 并行，overview required 保持，optional 收口为 relay。
{
  const assets = ['a', 'b'].map(id => ({ id, requirement: 'optional' }));
  const build = (id, kind, narration, reasons, registered = assets, duration = 4) => buildVisualPlan({
    graph: { nodes: [{ id, asset_refs: reasons.map((reason, index) => ({ asset_id: assets[index].id, reason })) }], edges: [] },
    sceneSpec: { scenes: [{ id, kind, duration_sec: duration, narration_text: '' }] },
    creativeContext: { asset_context: { assets: registered } },
  });
  const compareOptional = build('compare-no-caption', 'comparison', '', ['方案A', '方案B']);
  assert.equal(compareOptional.beats[0].visual_base.sequence_mode, 'semantic_compare');
  assert.equal(compareOptional.beats[0].visual_base.shots.length, 2);
  assert.ok(compareOptional.beats[0].visual_base.shots.every(shot => shot.active_window.start_sec === 0 && shot.active_window.end_sec === 4));

  const requiredText = ['a', 'b'].map(id => ({ id, requirement: 'required', image_analysis: { contains_text: true } }));
  const compareRequired = build('compare-required-no-caption', 'comparison', '', ['方案A', '方案B'], requiredText, 2);
  assert.equal(compareRequired.diagnostics.some(item => item.code === 'required_asset_shot_timing_conflict'), false);
  assert.equal(compareRequired.beats[0].visual_base.sequence_mode, 'semantic_compare');

  const overviewOptional = build('overview-no-caption', 'text', '', ['整体概览', '局部细节']);
  assert.equal(overviewOptional.beats[0].visual_base.sequence_mode, 'fullscreen_relay');
  assert.equal(overviewOptional.beats[0].visual_base.shots.length, 1);

  const overviewRequired = build('overview-required-no-caption', 'text', '', ['整体概览', '局部细节'], requiredText, 4);
  assert.equal(overviewRequired.beats[0].visual_base.sequence_mode, 'overview_detail');
  assert.deepEqual(overviewRequired.beats[0].visual_base.shots[0].active_window, { time_base: 'scene_local', start_sec: 0, end_sec: 4 });
  assert.deepEqual(overviewRequired.beats[0].visual_base.shots[1].active_window, { time_base: 'scene_local', start_sec: 2, end_sec: 4 });
}

// C-03 Review 2：无字幕 relay 按异质 minimum 分窗；不足 1 秒的单 optional 收口为 diagram。
{
  const graph = { nodes: [{ id: 'no-caption-relay', asset_refs: [{ asset_id: 'text' }, { asset_id: 'plain' }] }], edges: [] };
  const plan = buildVisualPlan({
    graph,
    sceneSpec: { scenes: [{ id: 'no-caption-relay', duration_sec: 3, narration_text: '' }] },
    creativeContext: { asset_context: { assets: [
      { id: 'text', requirement: 'required', image_analysis: { contains_text: true } },
      { id: 'plain', requirement: 'required' },
    ] } },
  });
  assert.deepEqual(plan.beats[0].visual_base.shots.map(shot => shot.active_window), [
    { time_base: 'scene_local', start_sec: 0, end_sec: 2 },
    { time_base: 'scene_local', start_sec: 2, end_sec: 3 },
  ]);

  for (const duration_sec of [0.5, 0.999]) {
    const short = buildVisualPlan({
      graph: { nodes: [{ id: 'too-short', asset_refs: [{ asset_id: 'optional' }] }], edges: [] },
      sceneSpec: { scenes: [{ id: 'too-short', duration_sec, narration_text: '' }] },
      creativeContext: { asset_context: { assets: [{ id: 'optional', requirement: 'optional' }] } },
    });
    assert.equal(short.beats[0].visual_base.type, 'diagram');
    assert.ok(short.diagnostics.some(item => item.code === 'image_sequence_shots_reduced_for_duration'));
  }
}

// P0-1：只有明确结构类型的 beat 有 motion_overlay，普通图片 beat 为 null
// （原"每个 beat 必须有 preset"契约已废止，规格 §7.3/§16 P0-1）
{
  const plan = { beats: [
    { id: 'b_text', scene_id: 's1', kind: 'text', asset_refs: [{ asset_id: 'gen_s1' }] },
    { id: 'b_steps', scene_id: 's2', kind: 'steps', visual_text: { cards: ['一', '二', '三'] }, asset_refs: [{ asset_id: 'gen_s2' }] },
  ] };
  assignMotionOrchestration(plan, { styleProfile: null });
  assert.strictEqual(plan.beats[0].motion_overlay, null, '普通图片 text beat overlay 应为 null');
  assert.ok(plan.beats[1].motion_overlay && plan.beats[1].motion_overlay.preset === 'three_step_flow', 'steps beat 仍有 overlay');
  assert.ok(plan.beats[0].visual_base && plan.beats[0].visual_base.type === 'generated_image');
  console.log('P0-1 assignMotionOrchestration null tests passed');
}

// assignMotionOrchestration 保留已规划 sequence，并把它按 image 选择 overlay。
{
  const visualBase = { type: 'image_sequence', sequence_mode: 'fullscreen_relay', continuity_group: 's', role: 'main_visual', shots: [{ id: 's_shot_01', asset_id: 'a' }] };
  const plan = { beats: [{ id: 's', scene_id: 's', kind: 'text', visual_base: visualBase }] };
  assignMotionOrchestration(plan);
  assert.deepEqual(plan.beats[0].visual_base, visualBase);
}

// P0-1 补充：结构类型 beat（steps）仍写入 theme_tokens / continuity / visual_base
// （保留原用例块的 R5 theme_tokens 回归与 continuity 覆盖，仅把承载 overlay 的 beat 换成结构类型）
{
  const visualPlan = {
    beats: [
      { id: 'scene_02_b1', scene_id: 'scene_02', kind: 'steps', duration_sec: 5.67, visual_text: { cards: ['一', '二', '三'] },
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
