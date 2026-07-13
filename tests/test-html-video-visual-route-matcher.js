const assert = require('assert');
const { matchVisualBeatsToRenderers } = require('../server/services/creative-video/html-video/visualRouteMatcher');

const beatWithAsset = {
  id: 'scene_02_b1', scene_id: 'scene_02', kind: 'text', duration_sec: 5.67,
  narration_text: 'UI 是界面', visual_text: { headline: 'UI' },
  asset_refs: [{ asset_id: 'gen_scene_02', usage: 'subject' }],
};
const beatNoAsset = {
  id: 'scene_04_b1', scene_id: 'scene_04', kind: 'text', duration_sec: 5.97,
  narration_text: 'UX 是整体体验', visual_text: { headline: 'UX' },
  asset_refs: [],
};

// 单链路：不需要 registry/renderTarget/options，所有 beat 都是 raw_html
{
  const decisions = matchVisualBeatsToRenderers({ visualPlan: { beats: [beatWithAsset, beatNoAsset] } });
  const withAsset = decisions.get('scene_02_b1');
  assert.strictEqual(withAsset.source_mode, 'raw_html');
  assert.strictEqual(withAsset.route_role, 'asset_overlay');
  assert.strictEqual(withAsset.template_id, null);
  const noAsset = decisions.get('scene_04_b1');
  assert.strictEqual(noAsset.source_mode, 'raw_html');
  assert.strictEqual(noAsset.route_role, 'diagram_motion');
  assert.strictEqual(noAsset.template_id, null);
}
// 空/重复 beat 容错
{
  const decisions = matchVisualBeatsToRenderers({ visualPlan: { beats: [beatNoAsset, { ...beatNoAsset }, {}] } });
  assert.strictEqual(decisions.size, 1);
}
console.log('visual-route-matcher single-pipeline tests passed');
