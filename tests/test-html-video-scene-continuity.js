const assert = require('assert');

const { ensureMotionOverlay } = require('../server/services/creative-video/html-video/frameHtmlPhase');

// 缺失 overlay：注入片段 + 填 slot + 设置主题 token 变量
{
  const beat = {
    id: 'scene_04_b1', scene_id: 'scene_04',
    visual_text: { headline: 'UX 的整体视角' },
    narration_text: 'UX 关注用户为什么来',
    motion_overlay: {
      preset: 'key_marker', placement: 'lower_third', max_items: 1,
      avoid_caption_bottom_px: 140,
      theme_tokens: { accent: '#1A73E8', foreground: '#0B0B0B', surface: 'rgba(255,255,255,.9)', background: '#F6F5F2' },
    },
  };
  const html = '<html><head></head><body><div class="hero">base</div></body></html>';
  const result = ensureMotionOverlay(html, beat, { visualStrategy: 'asset_first' });
  assert.strictEqual(result.injected, true);
  assert.ok(result.html.includes('data-mp-overlay="key_marker"'));
  assert.ok(result.html.includes('UX 的整体视角'), 'slot 必须填 beat 的 headline');
  assert.ok(result.html.includes('--mp-accent:#1A73E8'), '必须写入主题 token CSS 变量');
}
// R7：slot 填充必须 htmlEscape
{
  const beat = {
    id: 'x', scene_id: 'x',
    visual_text: { headline: 'A < B & C' },
    motion_overlay: { preset: 'key_marker', placement: 'lower_third', max_items: 1, avoid_caption_bottom_px: 140 },
  };
  const result = ensureMotionOverlay('<html><body></body></html>', beat, { visualStrategy: 'asset_first' });
  assert.ok(result.html.includes('A &lt; B &amp; C'), 'slot 文案必须经 htmlEscape');
  assert.ok(!result.html.includes('A < B & C'), '未转义原文不得出现在 HTML 中');
}
// 已有 overlay：原样返回
{
  const html = '<html><body><div data-mp-overlay="concept_card"></div></body></html>';
  const result = ensureMotionOverlay(html, { motion_overlay: { preset: 'concept_card' } }, { visualStrategy: 'asset_first' });
  assert.strictEqual(result.injected, false);
  assert.strictEqual(result.html, html);
}
// 硬约束 A：hf_first 不注入
{
  const html = '<html><body></body></html>';
  const result = ensureMotionOverlay(html, { motion_overlay: { preset: 'key_marker' } }, { visualStrategy: 'hf_first' });
  assert.strictEqual(result.injected, false);
  assert.strictEqual(result.html, html);
}
console.log('ensure motion overlay tests passed');

const { summarizeBaseLayout } = require('../server/services/creative-video/html-video/frameHtmlPhase');

// 摘要：剥离 overlay 节点，保留 base 结构与内联样式要点，限长
{
  const html = `<html><body>
    <div class="hero" style="position:absolute;inset:0;background:#12100e">
      <img src="assets/generated-image-02.jpg" style="width:100%;height:70%;object-fit:contain">
    </div>
    <div data-mp-overlay="key_marker" style="position:absolute;bottom:200px">重点</div>
  </body></html>`;
  const summary = summarizeBaseLayout(html);
  assert.ok(summary.includes('generated-image-02'), '摘要应包含主视觉引用');
  assert.ok(!summary.includes('data-mp-overlay'), '摘要必须剥离 overlay 节点');
  assert.ok(summary.length <= 1600, '摘要必须限长');
}
console.log('scene continuity phase1 tests passed');

const { bucketJobsByContinuityGroup } = require('../server/services/creative-video/html-video/frameHtmlPhase');

// 分桶不变量：同 scene 的 b2 必须与 b1 同桶（串行、能拿到 summary），不同 scene 不同桶（可并发）
{
  const jobs = [
    { index: 1, node: { metadata: { visual_beat: { id: 's2_b1', continuity: { group_id: 'scene_02', beat_index: 1 } } } } },
    { index: 2, node: { metadata: { visual_beat: { id: 's2_b2', continuity: { group_id: 'scene_02', beat_index: 2 } } } } },
    { index: 3, node: { metadata: { visual_beat: { id: 's3_b1', continuity: { group_id: 'scene_03', beat_index: 1 } } } } },
    { index: 4, node: { metadata: {} } }, // 无组：独立桶（hf_first 形态回归）
  ];
  const buckets = bucketJobsByContinuityGroup(jobs);
  assert.strictEqual(buckets.length, 3);
  assert.deepStrictEqual(buckets[0].map(j => j.index), [1, 2], '同 scene beat 必须同桶串行');
  assert.deepStrictEqual(buckets[1].map(j => j.index), [3]);
  assert.deepStrictEqual(buckets[2].map(j => j.index), [4]);
}
console.log('bucket jobs by continuity group tests passed');

const { runBucketsWithContinuity } = require('../server/services/creative-video/html-video/frameHtmlPhase');

// 集成：桶内串行传摘要、桶间可并发（用注入 runJob 验证）
(async () => {
  const calls = [];
  const buckets = bucketJobsByContinuityGroup([
    { index: 1, node: { metadata: { visual_beat: { id: 's2_b1', continuity: { group_id: 'scene_02', beat_index: 1 } } } } },
    { index: 2, node: { metadata: { visual_beat: { id: 's2_b2', continuity: { group_id: 'scene_02', beat_index: 2 } } } } },
    { index: 3, node: { metadata: { visual_beat: { id: 's3_b1', continuity: { group_id: 'scene_03', beat_index: 1 } } } } },
  ]);
  const results = await runBucketsWithContinuity({
    buckets,
    concurrency: 2,
    runJob: async job => {
      calls.push({ id: job.node.metadata.visual_beat.id, summary: job.previousBeatSummary || '' });
      return { htmlResult: { success: true, html: `<html><body><div class="hero">${job.node.metadata.visual_beat.id}</div></body></html>` } };
    },
  });
  assert.strictEqual(results.length, 3);
  const b2Call = calls.find(c => c.id === 's2_b2');
  assert.ok(b2Call.summary.includes('s2_b1'), 's2_b2 必须拿到 s2_b1 的布局摘要');
  const b1Pos = calls.findIndex(c => c.id === 's2_b1');
  const b2Pos = calls.findIndex(c => c.id === 's2_b2');
  assert.ok(b1Pos < b2Pos, '同桶串行：b1 先于 b2');

  // 首帧属于某 continuity group 时：其 HTML 作为该桶初始 previousHtml（分桶前串行生成的首帧场景）
  const seededCalls = [];
  const seededBuckets = bucketJobsByContinuityGroup([
    { index: 2, node: { metadata: { visual_beat: { id: 's1_b2', continuity: { group_id: 'scene_01', beat_index: 2 } } } } },
  ]);
  await runBucketsWithContinuity({
    buckets: seededBuckets,
    concurrency: 1,
    initialHtmlByGroup: new Map([
      ['scene_01', '<html><body><div class="hero">s1_b1-first-frame</div></body></html>'],
    ]),
    runJob: async job => {
      seededCalls.push({ id: job.node.metadata.visual_beat.id, summary: job.previousBeatSummary || '' });
      return { htmlResult: { success: true, html: '<html><body><div class="hero">s1_b2</div></body></html>' } };
    },
  });
  assert.ok(seededCalls[0].summary.includes('s1_b1-first-frame'), '首帧 HTML 必须作为同组桶的初始摘要来源');

  console.log('run buckets with continuity tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

const { buildSceneTimelineScript, groupBeatsForSceneHtml } = require('../server/services/creative-video/html-video/frameHtmlPhase');

// beat 分组：同 scene 合一，start/end 为组内相对时间
{
  const beats = [
    { id: 'scene_05_b1', scene_id: 'scene_05', duration_sec: 6.33 },
    { id: 'scene_05_b2', scene_id: 'scene_05', duration_sec: 6.33 },
    { id: 'scene_06_b1', scene_id: 'scene_06', duration_sec: 5.99 },
  ];
  const groups = groupBeatsForSceneHtml(beats);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].scene_id, 'scene_05');
  assert.ok(Math.abs(groups[0].duration_sec - 12.66) < 1e-6);
  assert.deepStrictEqual(
    groups[0].beats.map(b => [b.id, b.start_sec, b.end_sec]),
    [['scene_05_b1', 0, 6.33], ['scene_05_b2', 6.33, 12.66]],
  );
}

// 时间线脚本：注入 window.__MP_BEATS__ 并随时间切 body[data-mp-beat]
{
  const script = buildSceneTimelineScript([
    { id: 'scene_05_b1', start_sec: 0, end_sec: 6.33 },
    { id: 'scene_05_b2', start_sec: 6.33, end_sec: 12.66 },
  ]);
  assert.ok(script.includes('__MP_BEATS__'));
  assert.ok(script.includes('data-mp-beat'));
  assert.ok(script.includes('scene_05_b2'));
}
console.log('scene continuity phase2 timeline tests passed');
