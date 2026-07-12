const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
// P1-8：字符串 includes 可被 CSS 选择器/注释绕过——必须按真实 opening tag 判定
{
  const beat = {
    id: 'scene_04_b1', scene_id: 'scene_04',
    visual_text: { headline: '要点' },
    motion_overlay: { preset: 'key_marker', placement: 'lower_third', max_items: 1, avoid_caption_bottom_px: 140 },
  };
  // 仅 <style> 内出现 data-mp-overlay 选择器：无真实节点，必须注入
  const styleOnly = '<html><head><style>[data-mp-overlay]{opacity:0}</style></head><body><div class="hero">base</div></body></html>';
  const styleResult = ensureMotionOverlay(styleOnly, beat, { visualStrategy: 'asset_first' });
  assert.strictEqual(styleResult.injected, true, 'CSS 选择器不算真实 overlay 节点，必须注入兜底');
  // 仅注释里出现：同样必须注入
  const commentOnly = '<html><body><!-- data-mp-overlay 由系统兜底 --><div class="hero">base</div></body></html>';
  const commentResult = ensureMotionOverlay(commentOnly, beat, { visualStrategy: 'asset_first' });
  assert.strictEqual(commentResult.injected, true, '注释里出现不算真实 overlay 节点，必须注入兜底');
  // 真实节点存在：原样返回
  const real = '<html><body><div data-mp-overlay="key_marker">重点</div></body></html>';
  const realResult = ensureMotionOverlay(real, beat, { visualStrategy: 'asset_first' });
  assert.strictEqual(realResult.injected, false);
  assert.strictEqual(realResult.html, real);
}
// P2-5：其他属性值中的 " data-mp-overlay " 子串不算真实 overlay，必须注入兜底
{
  const beat = {
    id: 'scene_04_b1', scene_id: 'scene_04',
    visual_text: { headline: '要点' },
    motion_overlay: { preset: 'key_marker', placement: 'lower_third', max_items: 1, avoid_caption_bottom_px: 140 },
  };
  const probe = '<html><body><div title=" data-mp-overlay ">base</div></body></html>';
  const result = ensureMotionOverlay(probe, beat, { visualStrategy: 'asset_first' });
  assert.strictEqual(result.injected, true, 'title 属性值内的子串不算真实 overlay，必须注入兜底');
}
console.log('ensure motion overlay tests passed');

// P1-8：validationGate 的 overlay 校验与 scene beat scope 完整性检查
const { assetFirstOverlayIssues, sceneBeatScopeIssues } = require('../server/services/creative-video/html-video/validationGate');
{
  // style-only HTML：无真实 overlay 节点，不得产生 overlay issue（含误报 overlay_root_missing）
  const styleOnly = '<html><head><style>[data-mp-overlay]{opacity:0}</style></head><body></body></html>';
  assert.deepStrictEqual(assetFirstOverlayIssues(styleOnly, { visualStrategy: 'asset_first' }), []);
  // 真实越界 overlay：仍要报
  const bad = '<html><body><div data-mp-overlay="key_marker" style="position:absolute;bottom:0;height:200px"></div></body></html>';
  const issues = assetFirstOverlayIssues(bad, { visualStrategy: 'asset_first', frameHeight: 1920 });
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].code, 'overlay_in_caption_safe_area');
}
{
  // scene beat scope 缺失 → scene_beat_scope_missing warning，列出缺失 beat
  const html = '<html><body><div data-mp-beat-scope="scene_05_b1">A</div></body></html>';
  const windows = [
    { id: 'scene_05_b1', start_sec: 0, end_sec: 6.33 },
    { id: 'scene_05_b2', start_sec: 6.33, end_sec: 12.66 },
  ];
  const issues = sceneBeatScopeIssues(html, windows);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].code, 'scene_beat_scope_missing');
  assert.deepStrictEqual(issues[0].missing_beat_ids, ['scene_05_b2']);
  // 全部齐备 → 无 issue
  const full = '<html><body><div data-mp-beat-scope="scene_05_b1">A</div><div data-mp-beat-scope="scene_05_b2">B</div></body></html>';
  assert.deepStrictEqual(sceneBeatScopeIssues(full, windows), []);
  // 只有 CSS 选择器不算：仍缺失
  const cssOnly = '<html><head><style>[data-mp-beat-scope="scene_05_b1"]{opacity:1}</style></head><body></body></html>';
  assert.strictEqual(sceneBeatScopeIssues(cssOnly, windows)[0].missing_beat_ids.length, 2);
  // 非 scene 帧（无 beat_windows）不产生 issue
  assert.deepStrictEqual(sceneBeatScopeIssues(html, []), []);
}
console.log('overlay real-element detection & beat scope tests passed');

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
  // P2-1：initialHtmlByGroup 结构改为 Map<group, Map<beatIndex, html>>，按「beat_index 小于当前的最近前驱」选取
  const seededCalls = [];
  const seededBuckets = bucketJobsByContinuityGroup([
    { index: 2, node: { metadata: { visual_beat: { id: 's1_b2', continuity: { group_id: 'scene_01', beat_index: 2 } } } } },
  ]);
  await runBucketsWithContinuity({
    buckets: seededBuckets,
    concurrency: 1,
    initialHtmlByGroup: new Map([
      ['scene_01', new Map([[1, '<html><body><div class="hero">s1_b1-first-frame</div></body></html>']])],
    ]),
    runJob: async job => {
      seededCalls.push({ id: job.node.metadata.visual_beat.id, summary: job.previousBeatSummary || '' });
      return { htmlResult: { success: true, html: '<html><body><div class="hero">s1_b2</div></body></html>' } };
    },
  });
  assert.ok(seededCalls[0].summary.includes('s1_b1-first-frame'), '首帧 HTML 必须作为同组桶的初始摘要来源');

  // P2-1：定向重试中间 beat 时，初始 previousHtml 必须取「beat_index 更小的最近前驱」而不是组内最大者。
  // b1(index1)、b3(index3) 复用，只重试 b2(index2) => b2 拿到 b1 的摘要（不是未来的 b3）
  const midCalls = [];
  await runBucketsWithContinuity({
    buckets: bucketJobsByContinuityGroup([
      { index: 2, node: { metadata: { visual_beat: { id: 's2_b2', continuity: { group_id: 'scene_02', beat_index: 2 } } } } },
    ]),
    concurrency: 1,
    initialHtmlByGroup: new Map([
      ['scene_02', new Map([
        [1, '<html><body><div class="hero">s2_b1-reused</div></body></html>'],
        [3, '<html><body><div class="hero">s2_b3-reused</div></body></html>'],
      ])],
    ]),
    runJob: async job => {
      midCalls.push({ id: job.node.metadata.visual_beat.id, summary: job.previousBeatSummary || '' });
      return { htmlResult: { success: true, html: '<html><body><div class="hero">s2_b2</div></body></html>' } };
    },
  });
  assert.ok(midCalls[0].summary.includes('s2_b1-reused'), '重试中间 beat 的初始摘要必须来自更小 beat_index 的前驱');
  assert.ok(!midCalls[0].summary.includes('s2_b3-reused'), '不得把未来 beat（更大 beat_index）当作上一帧');

  // P2-2：同组多个非相邻 beat 同批重试。b1(1)、b3(3) 复用，待生成 [b2(2), b4(4)]：
  // 每个 job 的前驱 = max_by_beat_index(桶内已生成的最近前驱, 复用帧里 index 更小的最近前驱)
  // => b2 前驱是 b1；b4 的候选是 generated b2(2) 与 reused b3(3)，取更近的 b3。
  const multiRetryReused = new Map([
    ['scene_02', new Map([
      [1, '<html><body><div class="hero">s2_b1-reused</div></body></html>'],
      [3, '<html><body><div class="hero">s2_b3-reused</div></body></html>'],
    ])],
  ]);
  const multiRetryJobs = bucketJobsByContinuityGroup([
    { index: 2, node: { metadata: { visual_beat: { id: 's2_b2', continuity: { group_id: 'scene_02', beat_index: 2 } } } } },
    { index: 4, node: { metadata: { visual_beat: { id: 's2_b4', continuity: { group_id: 'scene_02', beat_index: 4 } } } } },
  ]);
  const multiCalls = [];
  await runBucketsWithContinuity({
    buckets: multiRetryJobs,
    concurrency: 1,
    initialHtmlByGroup: multiRetryReused,
    runJob: async job => {
      const id = job.node.metadata.visual_beat.id;
      multiCalls.push({ id, summary: job.previousBeatSummary || '' });
      return { htmlResult: { success: true, html: `<html><body><div class="hero">${id}-generated</div></body></html>` } };
    },
  });
  const multiB2 = multiCalls.find(c => c.id === 's2_b2');
  const multiB4 = multiCalls.find(c => c.id === 's2_b4');
  assert.ok(multiB2.summary.includes('s2_b1-reused'), 'b2 的前驱必须是复用的 b1');
  assert.ok(multiB4.summary.includes('s2_b3-reused'), 'b4 的前驱必须是更近的复用帧 b3');
  assert.ok(!multiB4.summary.includes('s2_b2-generated'), 'b4 不得拿更旧的 b2 生成结果当前驱');

  // 变体：复用只有 b1，待生成 [b2, b4]：b4 候选 = generated b2(2) vs reused b1(1) => 取 b2-generated（桶内传递语义保留）
  const singleReusedCalls = [];
  await runBucketsWithContinuity({
    buckets: bucketJobsByContinuityGroup([
      { index: 2, node: { metadata: { visual_beat: { id: 's2_b2', continuity: { group_id: 'scene_02', beat_index: 2 } } } } },
      { index: 4, node: { metadata: { visual_beat: { id: 's2_b4', continuity: { group_id: 'scene_02', beat_index: 4 } } } } },
    ]),
    concurrency: 1,
    initialHtmlByGroup: new Map([
      ['scene_02', new Map([[1, '<html><body><div class="hero">s2_b1-reused</div></body></html>']])],
    ]),
    runJob: async job => {
      const id = job.node.metadata.visual_beat.id;
      singleReusedCalls.push({ id, summary: job.previousBeatSummary || '' });
      return { htmlResult: { success: true, html: `<html><body><div class="hero">${id}-generated</div></body></html>` } };
    },
  });
  const singleB4 = singleReusedCalls.find(c => c.id === 's2_b4');
  assert.ok(singleB4.summary.includes('s2_b2-generated'), '仅 b1 复用时，b4 的前驱是刚生成的 b2（更近）');

  // b2 生成失败：b4 前驱回落到复用的 b3
  const failCalls = [];
  await runBucketsWithContinuity({
    buckets: bucketJobsByContinuityGroup([
      { index: 2, node: { metadata: { visual_beat: { id: 's2_b2', continuity: { group_id: 'scene_02', beat_index: 2 } } } } },
      { index: 4, node: { metadata: { visual_beat: { id: 's2_b4', continuity: { group_id: 'scene_02', beat_index: 4 } } } } },
    ]),
    concurrency: 1,
    initialHtmlByGroup: multiRetryReused,
    runJob: async job => {
      const id = job.node.metadata.visual_beat.id;
      failCalls.push({ id, summary: job.previousBeatSummary || '' });
      if (id === 's2_b2') return { htmlResult: { success: false } };
      return { htmlResult: { success: true, html: `<html><body><div class="hero">${id}-generated</div></body></html>` } };
    },
  });
  const failB4 = failCalls.find(c => c.id === 's2_b4');
  assert.ok(failB4.summary.includes('s2_b3-reused'), 'b2 失败时 b4 前驱回落到复用的 b3');
  assert.ok(!failB4.summary.includes('s2_b1-reused'), 'b2 失败时 b4 不得回落到过旧的 b1');

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

// 时间线脚本：注入 window.__MP_BEATS__，beat 时钟由 __mpStartBeatClock 显式启动（P1-3）
{
  const script = buildSceneTimelineScript([
    { id: 'scene_05_b1', start_sec: 0, end_sec: 6.33 },
    { id: 'scene_05_b2', start_sec: 6.33, end_sec: 12.66 },
  ]);
  assert.ok(script.includes('__MP_BEATS__'));
  assert.ok(script.includes('data-mp-beat'));
  assert.ok(script.includes('scene_05_b2'));
  assert.ok(script.includes('__mpStartBeatClock'), '必须暴露显式启动入口');

  // 行为验证：在沙箱里执行脚本体
  const code = script.replace(/^<script>/, '').replace(/<\/script>$/, '');
  const attrs = {};
  const rafs = [];
  const timers = [];
  const win = {};
  const doc = { body: { setAttribute: (key, value) => { attrs[key] = value; } } };
  new Function('window', 'document', 'requestAnimationFrame', 'setTimeout', code)(
    win, doc, cb => rafs.push(cb), (cb, ms) => timers.push({ cb, ms }),
  );
  // 注入即同步置首 beat：预加载期间画面就是 beat1 状态
  assert.strictEqual(attrs['data-mp-beat'], 'scene_05_b1', '脚本执行时必须同步设置首 beat id');
  // 未被显式启动前不得自行起钟
  assert.strictEqual(rafs.length, 0, '页面加载不得自行 rAF 起钟');
  assert.strictEqual(typeof win.__mpStartBeatClock, 'function');
  // 兜底自启：存在延时定时器（非 adapter 环境预览）
  assert.ok(timers.some(t => t.ms >= 1000), '必须有兜底自启定时器');
  // 显式启动后：时钟以启动时刻为 origin 推进
  win.__mpStartBeatClock();
  assert.ok(rafs.length >= 1, '启动后必须开始 rAF 推进');
  rafs.shift()(10000); // origin = 10000（模拟预加载耗时 10s 后才正式开始）
  assert.strictEqual(attrs['data-mp-beat'], 'scene_05_b1', '正式起点 t=0 必须仍是首 beat');
  rafs.shift()(17000); // t = 7s → 第二个 beat
  assert.strictEqual(attrs['data-mp-beat'], 'scene_05_b2');
  // 幂等：重复启动（兜底定时器再触发）不得重置 origin
  win.__mpStartBeatClock();
  timers.forEach(t => t.cb());
  const pending = rafs.splice(0);
  assert.strictEqual(pending.length, 1, '重复启动不得叠加第二条 rAF 循环');
  pending[0](18000); // 仍相对 origin=10000 → t=8s → b2
  assert.strictEqual(attrs['data-mp-beat'], 'scene_05_b2');

  // 竞态修复：adapter 受控环境（__mpAdapterControlled）不挂 5s 兜底——
  // 预加载 >5s 时兜底不得抢先起钟偏移 origin
  const attrs2 = {};
  const rafs2 = [];
  const timers2 = [];
  const win2 = { __mpAdapterControlled: true };
  const doc2 = { body: { setAttribute: (key, value) => { attrs2[key] = value; } } };
  new Function('window', 'document', 'requestAnimationFrame', 'setTimeout', code)(
    win2, doc2, cb => rafs2.push(cb), (cb, ms) => timers2.push({ cb, ms }),
  );
  assert.strictEqual(timers2.length, 0, 'adapter 受控时不得注册兜底定时器');
  assert.strictEqual(rafs2.length, 0);
  // 模拟预加载 6s 后 adapter 才调用：origin 必须是调用时刻
  win2.__mpStartBeatClock();
  rafs2.shift()(6000); // origin = 6000
  assert.strictEqual(attrs2['data-mp-beat'], 'scene_05_b1', '预加载 >5s 时 t=0 仍必须是首 beat');
  rafs2.shift()(13000); // t = 7s → b2
  assert.strictEqual(attrs2['data-mp-beat'], 'scene_05_b2');
}
// adapter 侧：正式录制起点显式调用 __mpStartBeatClock，且 goto 前置 __mpAdapterControlled 标志（源码级弱断言）
{
  const adapterSource = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'services', 'creative-video', 'html-video', 'hyperframesPlaywrightAdapter.js'),
    'utf8',
  );
  assert.ok(adapterSource.includes('__mpStartBeatClock'), 'adapter 必须在正式播放处显式启动 beat 时钟');
  const flagIndex = adapterSource.indexOf('__mpAdapterControlled');
  const gotoIndex = adapterSource.indexOf('page.goto(');
  assert.ok(flagIndex >= 0, 'adapter 必须置 __mpAdapterControlled 受控标志');
  assert.ok(gotoIndex > flagIndex, '__mpAdapterControlled 必须在 page.goto 之前注入（addInitScript）');
}
console.log('scene continuity phase2 timeline tests passed');

const { buildSceneRenderEntries } = require('../server/services/creative-video/html-video/mixedFrameBuilder');

// scene_html 模式：一个 scene 一条渲染条目，checkpoint 键为 scene:<id>
// （beat_mp4 缺省模式不经过本函数，走 buildMixedFrameProject 原有 beat 循环，
// 其回归由 test-html-video-per-scene-routing.js / test-html-video-workflow.js 覆盖）
{
  const beats = [
    { id: 'scene_05_b1', scene_id: 'scene_05', duration_sec: 6.33 },
    { id: 'scene_05_b2', scene_id: 'scene_05', duration_sec: 6.33 },
  ];
  const entries = buildSceneRenderEntries(beats);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].frame_id, 'scene:scene_05');
  assert.strictEqual(entries[0].scene_id, 'scene_05');
  assert.deepStrictEqual(entries[0].beat_ids, ['scene_05_b1', 'scene_05_b2']);
  assert.ok(Math.abs(entries[0].duration_sec - 12.66) < 1e-6);
  assert.strictEqual(entries[0].route_role, 'scene_html');
}

// scene 级 prompt 约束段：必须含各 beat_id、时间窗口、data-mp-beat-scope 约定与 CSS 可见性规则示例
const { buildSceneBeatsBrief } = require('../server/services/creative-video/html-video/frameHtmlPhase');
{
  const node = {
    id: 'scene:scene_05',
    metadata: {
      beat_windows: [
        { id: 'scene_05_b1', start_sec: 0, end_sec: 6.33 },
        { id: 'scene_05_b2', start_sec: 6.33, end_sec: 12.66 },
      ],
      visual_beats: [
        { id: 'scene_05_b1', visual_text: { headline: '要点一', keywords: ['关键词A'] }, motion_overlay: { preset: 'key_marker' } },
        { id: 'scene_05_b2', visual_text: { headline: '要点二' } },
      ],
    },
  };
  const brief = buildSceneBeatsBrief(node);
  assert.ok(brief.includes('scene_05_b1') && brief.includes('scene_05_b2'), 'brief 必须含各 beat_id');
  assert.ok(brief.includes('0s - 6.33s') && brief.includes('6.33s - 12.66s'), 'brief 必须含各 beat 时间窗口');
  assert.ok(brief.includes('data-mp-beat-scope="<beat_id>"'), 'brief 必须声明 data-mp-beat-scope 约定');
  assert.ok(brief.includes('[data-mp-beat-scope]{opacity:0'), 'brief 必须给出隐藏态 CSS 规则示例');
  assert.ok(/body\[data-mp-beat=.*\] \[data-mp-beat-scope=.*\]\{opacity:1\}/.test(brief), 'brief 必须给出按 beat 显示的 CSS 规则示例');
  assert.ok(brief.includes('要点一') && brief.includes('要点二'), 'brief 必须含各 beat 文案要点');
  // 非 scene 节点（无 beat_windows）返回空串
  assert.strictEqual(buildSceneBeatsBrief({ id: 'scene_05_b1', metadata: {} }), '');

  // P2-3(a)：传入 scene/beats/mediaOptions 时，无系统字幕的 beat 行必须追加「补画面重点短句」要求
  const scene = {
    id: 'scene_05',
    duration_sec: 12.66,
    narration_text: '前半句旁白',
    captions: [{ start: 0, end: 5, text: '前半句旁白' }], // 只覆盖 b1 窗口
  };
  const beats = [
    { id: 'scene_05_b1', scene_id: 'scene_05', duration_sec: 6.33 },
    { id: 'scene_05_b2', scene_id: 'scene_05', duration_sec: 6.33 },
  ];
  const captionAware = buildSceneBeatsBrief(node, { scene, beats, mediaOptions: {} });
  const lines = captionAware.split('\n');
  const b1Line = lines.find(line => line.includes('scene_05_b1：'));
  const b2Line = lines.find(line => line.includes('scene_05_b2：'));
  assert.ok(!b1Line.includes('无系统字幕'), '有字幕的 beat 行不追加要求');
  assert.ok(b2Line.includes('无系统字幕') && b2Line.includes('画面重点短句'), '无字幕 beat 行必须追加画面重点短句要求');
  // 不传 scene（旧调用形态）：行为不变，无追加行
  assert.ok(!buildSceneBeatsBrief(node).includes('无系统字幕'));
}

// frameHtmlAgent：sceneBeatsBrief 作为独立段落进入 prompt（不与 primitive 参考片段混在一起）
const frameHtmlAgentForBrief = require('../server/services/creative-video/html-video/frameHtmlAgent');
{
  const brief = '本帧是同场景多 beat 的连续 HTML（scene_html 模式）\n- scene_05_b1：0s - 6.33s';
  const prompt = frameHtmlAgentForBrief.buildAssetFirstFramePrompt({
    beat: { motion_overlay: { preset: 'key_marker', placement: 'lower_third', max_items: 1, avoid_caption_bottom_px: 140 } },
    primitiveSnippet: '<div data-mp-overlay="key_marker"></div>',
    sceneBeatsBrief: brief,
  });
  assert.ok(prompt.includes(brief), 'sceneBeatsBrief 必须整段进入 prompt');
  const snippetIndex = prompt.indexOf('<div data-mp-overlay="key_marker"></div>');
  const briefIndex = prompt.indexOf('本帧是同场景多 beat 的连续 HTML');
  assert.ok(snippetIndex >= 0 && briefIndex > snippetIndex, 'brief 必须在 primitive 参考片段之后独立成段，不混入片段标签下');
  // 组内全无 motion_overlay 时（Minor4 解耦）：brief 仍单独输出，且不产生 undefined 的 overlay 行
  const briefOnly = frameHtmlAgentForBrief.buildAssetFirstFramePrompt({ beat: {}, sceneBeatsBrief: brief });
  assert.ok(briefOnly.includes(brief));
  assert.ok(!briefOnly.includes('undefined'), '无 motion_overlay 时不得输出 undefined 的 beat 编排行');
}

// retryPlanner：scene_html 模式下 beat 级 frame_ids 归并为 scene 级
const { resolveRetryFrameIds } = require('../server/services/creative-video/retryPlanner');
{
  const ids = resolveRetryFrameIds(['scene_05_b2'], {
    continuityMode: 'scene_html',
    beatToScene: { scene_05_b2: 'scene_05' },
  });
  assert.deepStrictEqual(ids, ['scene:scene_05']);
}
{
  const ids = resolveRetryFrameIds(['scene_05_b2'], { continuityMode: 'beat_mp4', beatToScene: {} });
  assert.deepStrictEqual(ids, ['scene_05_b2']); // 缺省行为不变
}

// P2-A：复用帧必须进入连续性与统计链路（collectReusedFrameContext）
// P2-1：复用 HTML 按 beat_index 全量保存（Map<group, Map<beatIndex, html>>），
// 定向重试任意中间 beat 时可查「beat_index 小于当前的最近前驱」，不再被组内最大者覆盖。
const { collectReusedFrameContext, predecessorHtmlForBeat } = require('../server/services/creative-video/html-video/frameHtmlPhase');
{
  const statsByBeatId = {};
  const initialHtmlByGroup = new Map();
  const b1Html = '<html><body><div class="hero card">s2_b1-reused</div><div data-mp-overlay="key_marker" style="position:absolute;left:48px;right:48px;bottom:200px;height:200px"></div></body></html>';
  collectReusedFrameContext({
    node: { id: 's2_b1', beat_id: 'scene_02_b1', metadata: { visual_beat: { id: 'scene_02_b1', continuity: { group_id: 'scene_02', beat_index: 1 } } } },
    html: b1Html,
    frameKey: 'scene_02_b1',
    frameHeight: 1920,
    statsByBeatId,
    initialHtmlByGroup,
  });
  // (1) 复用 HTML 必须产生统计与 overlay 校验结果
  const stats = statsByBeatId.scene_02_b1;
  assert.ok(stats, '复用帧必须写入 statsByBeatId');
  assert.ok(Number.isFinite(stats.text_blocks), '复用帧必须有静态结构统计');
  assert.ok(stats.overlay_check && stats.overlay_check.valid === true, '含 overlay 的复用帧必须有 overlay_check');
  // (2) initialHtmlByGroup 按 beat_index 拿到该组 HTML
  assert.strictEqual(initialHtmlByGroup.get('scene_02').get(1), b1Html, '复用帧 HTML 必须按 continuity group + beat_index 写入 initialHtmlByGroup');
  // (3) 同组多帧复用：全部按各自 beat_index 保存，互不覆盖
  const b3Html = '<html><body><div class="hero">s2_b3-reused</div></body></html>';
  collectReusedFrameContext({
    node: { id: 's2_b3', beat_id: 'scene_02_b3', metadata: { visual_beat: { id: 'scene_02_b3', continuity: { group_id: 'scene_02', beat_index: 3 } } } },
    html: b3Html,
    frameKey: 'scene_02_b3',
    frameHeight: 1920,
    statsByBeatId,
    initialHtmlByGroup,
  });
  assert.strictEqual(initialHtmlByGroup.get('scene_02').get(3), b3Html, '同组不同 beat_index 各自保存');
  assert.strictEqual(initialHtmlByGroup.get('scene_02').get(1), b1Html, '更大 beat_index 不得覆盖更小的');
  assert.strictEqual(statsByBeatId.scene_02_b3.overlay_check, null, '无 overlay 的复用帧 overlay_check 为 null');
  // (4) 前驱查找：重试 b2 => b1；重试 b4 => b3；组内无更小前驱 => 空
  assert.strictEqual(predecessorHtmlForBeat(initialHtmlByGroup, 'scene_02', 2), b1Html, '重试 b2 的前驱是 b1');
  assert.strictEqual(predecessorHtmlForBeat(initialHtmlByGroup, 'scene_02', 4), b3Html, '重试 b4 的前驱是 b3');
  assert.strictEqual(predecessorHtmlForBeat(initialHtmlByGroup, 'scene_02', 1), '', '无更小前驱时为空');
  assert.strictEqual(predecessorHtmlForBeat(initialHtmlByGroup, 'scene_99', 2), '', '未知组为空');
  // (5) 无 continuity group 的节点：只写统计，不动 initialHtmlByGroup
  collectReusedFrameContext({
    node: { id: 'scene_09', metadata: {} },
    html: '<html><body><p>free</p></body></html>',
    frameKey: 'scene_09',
    frameHeight: 1920,
    statsByBeatId,
    initialHtmlByGroup,
  });
  assert.ok(statsByBeatId.scene_09, '无组复用帧也要有统计');
  assert.strictEqual(initialHtmlByGroup.size, 1, '无组复用帧不写 initialHtmlByGroup');
  // (6) 空 HTML 容错跳过
  collectReusedFrameContext({
    node: { id: 'scene_10', metadata: {} },
    html: '',
    frameKey: 'scene_10',
    frameHeight: 1920,
    statsByBeatId,
    initialHtmlByGroup,
  });
  assert.ok(!('scene_10' in statsByBeatId), '空 HTML 不产生统计条目');
}
console.log('collect reused frame context tests passed');

// R2：renderCheckpointKey 对 scene frame 必须返回 frame.id
const { renderCheckpointKey } = require('../server/services/creative-video/html-video/projectOrchestrator');
assert.strictEqual(
  renderCheckpointKey({ id: 'scene:scene_05', scene_id: 'scene_05', beat_id: null }),
  'scene:scene_05',
);
// 现状行为回归：
assert.strictEqual(renderCheckpointKey({ id: 'scene_02_b1', scene_id: 'scene_02', beat_id: 'scene_02_b1' }), 'scene_02_b1');
assert.strictEqual(renderCheckpointKey({ id: 'scene_01', scene_id: 'scene_01' }), 'scene_01');

// R1：expand 阶段的 scene 级 content graph
const { expandContentGraphToSceneEntries } = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
{
  const graph = { nodes: [
    { id: 'n1', scene_id: 'scene_05', kind: 'text', label: 'L', asset_refs: [] },
  ], edges: [] };
  const visualPlan = { beats: [
    { id: 'scene_05_b1', scene_id: 'scene_05', duration_sec: 6.33,
      visual_text: { headline: 'A' }, continuity: { group_id: 'scene_05', beat_index: 1, beat_count: 2 } },
    { id: 'scene_05_b2', scene_id: 'scene_05', duration_sec: 6.33,
      visual_text: { headline: 'B' }, continuity: { group_id: 'scene_05', beat_index: 2, beat_count: 2 } },
  ] };
  const expanded = expandContentGraphToSceneEntries(graph, visualPlan);
  assert.strictEqual(expanded.nodes.length, 1, '一个 scene 一个 node');
  const node = expanded.nodes[0];
  assert.strictEqual(node.id, 'scene:scene_05');
  assert.strictEqual(node.scene_id, 'scene_05');
  assert.ok(Math.abs(node.duration_sec - 12.66) < 1e-6);
  assert.strictEqual(node.html_path, '', '展开时 html_path 为空，由 frameHtmlPhase 生成后回写');
  assert.deepStrictEqual(node.metadata.beat_windows.map(w => w.id), ['scene_05_b1', 'scene_05_b2']);
  assert.strictEqual(node.metadata.visual_beats.length, 2, '组内全部 beat 编排字段随 node 传递');
}
console.log('scene continuity phase2 render/retry tests passed');

// 模块5 R8：hasCaptionsForBeat 用 scene 字幕切窗结果判定（真实派生路径）
const { hasCaptionsForBeat } = require('../server/services/creative-video/html-video/frameHtmlPhase');
{
  const scene = { id: 'scene_04', duration_sec: 12, narration_text: '前半段有旁白字幕',
    captions: [{ start: 0, end: 5, text: '前半段字幕' }] };
  const beats = [
    { id: 'scene_04_b1', scene_id: 'scene_04', duration_sec: 6 },
    { id: 'scene_04_b2', scene_id: 'scene_04', duration_sec: 6 },
  ];
  // b1 窗口 [0,6)：命中字幕；b2 窗口 [6,12)：无字幕
  assert.strictEqual(hasCaptionsForBeat({ scene, beats, beatId: 'scene_04_b1', mediaOptions: {} }), true);
  assert.strictEqual(hasCaptionsForBeat({ scene, beats, beatId: 'scene_04_b2', mediaOptions: {} }), false);
  // 全局关闭字幕：一律 false
  assert.strictEqual(
    hasCaptionsForBeat({ scene, beats, beatId: 'scene_04_b1', mediaOptions: { generateCaptions: false } }),
    false,
  );
}
console.log('has captions for beat tests passed');
