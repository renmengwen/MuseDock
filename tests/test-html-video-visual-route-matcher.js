const assert = require('assert');
const path = require('path');
const { matchVisualBeatsToRenderers } = require('../server/services/creative-video/html-video/visualRouteMatcher');

const TEMPLATE_DIR = path.resolve(__dirname, '../server/templates/frame-glitch-title');

function template(id, maxSec = 8) {
  return {
    id,
    engine: 'hyperframes',
    source_entry: 'source/index.html',
    __dir: TEMPLATE_DIR,
    output: {
      resolution: { supported_aspects: ['16:9'] },
      duration: { min_sec: 3, max_sec: maxSec },
    },
    license: { spdx: 'Apache-2.0', commercial_use: true },
    inputs: {
      schema: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', maxLength: 80 },
          subtitle: { type: 'string', maxLength: 120 },
          duration_sec: { type: 'number', minimum: 3, maximum: maxSec },
        },
      },
    },
  };
}

const registry = {
  getTemplate: id => ({
    'frame-glitch-title': template('frame-glitch-title', 8),
  }[id] || null),
};

const plan = {
  beats: [
    {
      id: 'scene_01_b1',
      scene_id: 'scene_01',
      kind: 'text',
      duration_sec: 6,
      source_scene: { speech_duration_sec: 12, duration: 12 },
      visual_text: { headline: '概念开场' },
      narration_text: '先定义概念。',
    },
    {
      id: 'scene_02_b1',
      scene_id: 'scene_02',
      kind: 'text',
      duration_sec: 12,
      source_scene: { speech_duration_sec: 12, duration: 12 },
      visual_text: { headline: '过长段落' },
      narration_text: '这一段仍然太长。',
    },
  ],
};

const decisions = matchVisualBeatsToRenderers({
  visualPlan: plan,
  registry,
  renderTarget: { aspect_ratio: '16:9' },
});

assert.equal(decisions.get('scene_01_b1').source_mode, 'template_inputs');
assert.equal(decisions.get('scene_01_b1').duration_strategy, 'fit');
assert.ok(decisions.get('scene_01_b1').inputs.duration_sec <= 8, 'beat 时长应压过场景时长别名');
assert.equal(decisions.get('scene_02_b1').source_mode, 'raw_html');
assert.match(decisions.get('scene_02_b1').fallback_reason, /模板不支持目标时长/);

console.log('test-html-video-visual-route-matcher passed');

// ===== asset_first 路由测试 =====

function fakeRegistry() {
  const templates = new Map([
    ['frame-glitch-title', { id: 'frame-glitch-title' }],
    ['frame-build-minimal', { id: 'frame-build-minimal' }],
  ]);
  return { getTemplate: id => templates.get(id) || null };
}

const textBeatNoAsset = {
  id: 'scene_04_b1', scene_id: 'scene_04', kind: 'text', duration_sec: 5.97,
  narration_text: 'UX 是整体体验', visual_text: { headline: 'UX', keywords: ['用户', '需求'] },
  asset_refs: [],
};
const textBeatWithAsset = {
  id: 'scene_02_b1', scene_id: 'scene_02', kind: 'text', duration_sec: 5.67,
  narration_text: 'UI 是界面', visual_text: { headline: 'UI' },
  asset_refs: [{ asset_id: 'gen_scene_02', usage: 'subject' }],
};

// 1) asset_first + 有图 beat => raw_html / asset_overlay
{
  const decisions = matchVisualBeatsToRenderers({
    visualPlan: { beats: [textBeatWithAsset] },
    registry: fakeRegistry(),
    renderTarget: { aspectRatio: '9:16' },
    options: { visualStrategy: 'asset_first' },
  });
  const d = decisions.get('scene_02_b1');
  assert.strictEqual(d.source_mode, 'raw_html');
  assert.strictEqual(d.route_role, 'asset_overlay');
  assert.strictEqual(d.template_id, null);
  assert.strictEqual(d.template_blocked_reason, 'asset_first_prefers_visual_base');
}

// 2) asset_first + 无图 text beat => raw_html / diagram_motion（不再回退标题模板）
{
  const decisions = matchVisualBeatsToRenderers({
    visualPlan: { beats: [textBeatNoAsset] },
    registry: fakeRegistry(),
    renderTarget: { aspectRatio: '9:16' },
    options: { visualStrategy: 'asset_first' },
  });
  const d = decisions.get('scene_04_b1');
  assert.strictEqual(d.source_mode, 'raw_html');
  assert.strictEqual(d.route_role, 'diagram_motion');
  assert.strictEqual(d.template_id, null);
}

// 3) 决策 3：asset_first 下 template_inputs 归零
{
  const decisions = matchVisualBeatsToRenderers({
    visualPlan: { beats: [textBeatNoAsset, textBeatWithAsset] },
    registry: fakeRegistry(),
    renderTarget: { aspectRatio: '9:16' },
    options: { visualStrategy: 'asset_first' },
  });
  for (const d of decisions.values()) {
    assert.strictEqual(d.source_mode, 'raw_html');
    assert.strictEqual(d.template_id, null);
    assert.ok(['asset_overlay', 'diagram_motion', 'caption_motion'].includes(d.route_role));
  }
}

// 4) 硬约束 A 回归：hf_first（不传 visualStrategy）行为与现状完全一致
{
  const decisions = matchVisualBeatsToRenderers({
    visualPlan: { beats: [textBeatNoAsset] },
    registry: fakeRegistry(),
    renderTarget: { aspectRatio: '9:16' },
    options: {},
  });
  const d = decisions.get('scene_04_b1');
  assert.strictEqual(d.source_mode, 'raw_html');
  assert.strictEqual(d.route_role, undefined); // hf_first 决策对象不新增字段
  assert.strictEqual(d.diagnostic.code, 'visual_route_fallback');
}
console.log('visual-route-matcher asset_first routing tests passed');
