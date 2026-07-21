const assert = require('assert/strict');

const {
  FOCUS_TRANSITION_BUDGET_SEC,
  planFocusCues,
} = require('../server/services/creative-video/html-video/focusCuePlanner');
const { buildVisualPlan } = require('../server/services/creative-video/html-video/visualPlanService');

function canonicalRegion({ id, label, aliases = [], trust = 'A', x = 0.05, y = 0.05 }) {
  return {
    id,
    label,
    aliases,
    region: { x, y, width: 0.3, height: 0.2 },
    focus_point: { x: x + 0.15, y: y + 0.1 },
    method: 'dom',
    confidence_level: 'high',
    verification: { status: 'verified', method: 'dom_capture', evidence: '测试用固定证据。' },
    trust_level: trust,
  };
}

function fixture({
  captions,
  regions,
  captionIds = null,
  duration = 8,
  sceneId = 'scene_01',
  assetId = 'asset_hero',
  motionOverlay = null,
} = {}) {
  return {
    sceneSpec: {
      scenes: [{ id: sceneId, duration_sec: duration, captions }],
    },
    visualPlan: {
      version: 2,
      beats: [{
        id: sceneId,
        scene_id: sceneId,
        duration_sec: duration,
        ...(motionOverlay ? { motion_overlay: motionOverlay } : {}),
        visual_base: {
          type: 'image_sequence',
          sequence_mode: 'fullscreen_relay',
          continuity_group: sceneId,
          role: 'main_visual',
          shots: [{
            id: `${sceneId}_shot_01`,
            asset_id: assetId,
            role: 'showcase',
            fit: 'cover',
            caption_ids: captionIds || captions.map(caption => caption.id),
            active_window: { time_base: 'scene_local', start_sec: 0, end_sec: duration },
            minimum_visible_duration_sec: 1,
          }],
        },
      }],
    },
    creativeContext: {
      asset_context: {
        assets: [{ id: assetId, media_type: 'image', path: 'assets/hero.png', focus_regions: regions }],
      },
    },
    mediaOptions: {},
  };
}

function firstShot(visualPlan) {
  return visualPlan.beats[0].visual_base.shots[0];
}

// 规则 1a + 规则 2：英文大小写不敏感包含匹配，keyword 必须取 caption 原文中的实际出现形式。
{
  const input = fixture({
    captions: [{ id: 'cap_01', start: 0, end: 4, text: 'Watch the GitHub Star count rise' }],
    regions: [canonicalRegion({ id: 'r_star', label: 'github star', trust: 'A' })],
    duration: 4,
  });
  planFocusCues(input);
  const shot = firstShot(input.visualPlan);
  assert.equal(shot.camera.initial_view, 'overview');
  assert.equal(shot.camera.focus_cues.length, 1);
  const cue = shot.camera.focus_cues[0];
  assert.match(cue.id, /^cue_[0-9a-f]{16}$/);
  assert.deepEqual(cue.caption_ids, ['cap_01']);
  assert.equal(cue.keyword, 'GitHub Star', 'keyword 必须是 caption 原文中的真实出现形式');
  assert.equal(cue.region_id, 'r_star');
  assert.equal(cue.effect, 'camera_zoom');
  assert.equal(cue.zoom, 'auto');
  assert.equal(cue.return_policy, 'hold_or_next');
  // 规则 7：cue 不写 start_sec/end_sec，字段集合完全锁定。
  assert.deepEqual(
    Object.keys(cue).sort(),
    ['caption_ids', 'effect', 'id', 'keyword', 'region_id', 'return_policy', 'zoom'],
  );
}

// 规则 1b：中文标签包含匹配。
{
  const input = fixture({
    captions: [{ id: 'cap_01', start: 0, end: 4, text: '价格面板显示三个套餐' }],
    regions: [canonicalRegion({ id: 'r_price', label: '价格面板', trust: 'A' })],
    duration: 4,
  });
  planFocusCues(input);
  const cue = firstShot(input.visualPlan).camera.focus_cues[0];
  assert.equal(cue.keyword, '价格面板');
  assert.equal(cue.region_id, 'r_price');
}

// 规则 1c：alias 命中时同样生效，keyword 取 alias 在原文中的出现形式。
{
  const input = fixture({
    captions: [{ id: 'cap_01', start: 0, end: 4, text: '这里的定价卡片一目了然' }],
    regions: [canonicalRegion({ id: 'r_pricing', label: 'pricing panel', aliases: ['定价卡片'], trust: 'A' })],
    duration: 4,
  });
  planFocusCues(input);
  const cue = firstShot(input.visualPlan).camera.focus_cues[0];
  assert.equal(cue.keyword, '定价卡片');
  assert.equal(cue.region_id, 'r_pricing');
}

// 规则 1d：匹配只由 label/aliases 驱动，caption 里出现的业务词不触发无关 region。
{
  const input = fixture({
    captions: [{ id: 'cap_01', start: 0, end: 4, text: 'GitHub Star 数持续上涨' }],
    regions: [canonicalRegion({ id: 'r_button', label: '按钮', trust: 'A' })],
    duration: 4,
  });
  planFocusCues(input);
  assert.equal('camera' in firstShot(input.visualPlan), false, '无命中时不写 camera');
}

// 规则 3：trust A/B → camera_zoom + zoom auto；trust C → highlight_only（无 zoom）；trust D → 不生成 cue。
{
  const input = fixture({
    captions: [
      { id: 'cap_01', start: 0, end: 2, text: 'Star 按钮在这里' },
      { id: 'cap_02', start: 2, end: 4, text: '看价格面板' },
      { id: 'cap_03', start: 4, end: 6, text: '看用户评价区' },
      { id: 'cap_04', start: 6, end: 8, text: '底部页脚说明' },
    ],
    regions: [
      canonicalRegion({ id: 'r_a', label: 'Star 按钮', trust: 'A' }),
      canonicalRegion({ id: 'r_b', label: '价格面板', trust: 'B' }),
      canonicalRegion({ id: 'r_c', label: '用户评价区', trust: 'C' }),
      canonicalRegion({ id: 'r_d', label: '底部页脚', trust: 'D' }),
    ],
  });
  planFocusCues(input);
  const cues = firstShot(input.visualPlan).camera.focus_cues;
  assert.deepEqual(cues.map(cue => cue.region_id), ['r_a', 'r_b', 'r_c']);
  assert.deepEqual(cues.map(cue => cue.effect), ['camera_zoom', 'camera_zoom', 'highlight_only']);
  assert.equal(cues[0].zoom, 'auto');
  assert.equal(cues[1].zoom, 'auto');
  assert.equal('zoom' in cues[2], false, 'highlight_only 不写 zoom 字段');
}

// 规则 4a：同一 caption 命中同一 asset 的多个 region（无法消歧）→ 不生成 cue、不报错。
{
  const input = fixture({
    captions: [{ id: 'cap_01', start: 0, end: 4, text: '价格面板对比' }],
    regions: [
      canonicalRegion({ id: 'r_1', label: '面板', trust: 'A' }),
      canonicalRegion({ id: 'r_2', label: '价格', trust: 'A' }),
    ],
    duration: 4,
  });
  planFocusCues(input);
  assert.equal('camera' in firstShot(input.visualPlan), false);
}

// 规则 4b：caption_id 不在 canonical captions 中 → 跳过该条，不报错、不阻断。
{
  const input = fixture({
    captions: [{ id: 'cap_01', start: 0, end: 4, text: '价格面板显示三个套餐' }],
    regions: [canonicalRegion({ id: 'r_price', label: '价格面板', trust: 'A' })],
    captionIds: ['cap_ghost', 'cap_01'],
    duration: 4,
  });
  planFocusCues(input);
  const cues = firstShot(input.visualPlan).camera.focus_cues;
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0].caption_ids, ['cap_01']);
}

// 规则 4c：asset 无 focus_regions 或 asset 不存在 → 不写 camera、shot 字节级不变（保护帧指纹与 resume 复用），不报错。
{
  const noRegions = fixture({
    captions: [{ id: 'cap_01', start: 0, end: 4, text: '价格面板显示三个套餐' }],
    regions: [],
    duration: 4,
  });
  const shotBefore = JSON.parse(JSON.stringify(firstShot(noRegions.visualPlan)));
  planFocusCues(noRegions);
  assert.deepEqual(firstShot(noRegions.visualPlan), shotBefore, '无 cue 的 shot 必须原样保留');

  const missingAsset = fixture({
    captions: [{ id: 'cap_01', start: 0, end: 4, text: '价格面板显示三个套餐' }],
    regions: [canonicalRegion({ id: 'r_price', label: '价格面板', trust: 'A' })],
    duration: 4,
  });
  missingAsset.visualPlan.beats[0].visual_base.shots[0].asset_id = 'asset_unknown';
  planFocusCues(missingAsset);
  assert.equal('camera' in firstShot(missingAsset.visualPlan), false);
}

// 规则 5a：caption_ids 顺序中相邻多条 caption 命中同一 region → 合并为一个 cue，caption_ids 保序收纳全部。
{
  const input = fixture({
    captions: [
      { id: 'cap_01', start: 0, end: 2, text: 'Star 按钮亮了' },
      { id: 'cap_02', start: 2, end: 4, text: '点下 Star 按钮' },
    ],
    regions: [canonicalRegion({ id: 'r_star', label: 'Star 按钮', trust: 'A' })],
    duration: 4,
  });
  planFocusCues(input);
  const cues = firstShot(input.visualPlan).camera.focus_cues;
  assert.equal(cues.length, 1, '相邻同 region 命中必须合并，不产生重复缩放 cue');
  assert.deepEqual(cues[0].caption_ids, ['cap_01', 'cap_02']);
  assert.equal(cues[0].effect, 'camera_zoom');
}

// 规则 5b：中间隔着命中其他 region 的 caption → 非相邻，不合并。
{
  const input = fixture({
    captions: [
      { id: 'cap_01', start: 0, end: 2, text: 'Star 按钮亮了' },
      { id: 'cap_02', start: 2, end: 4, text: '看价格面板' },
      { id: 'cap_03', start: 4, end: 6, text: '回到 Star 按钮' },
    ],
    regions: [
      canonicalRegion({ id: 'r_star', label: 'Star 按钮', trust: 'A' }),
      canonicalRegion({ id: 'r_price', label: '价格面板', trust: 'A' }),
    ],
    duration: 6,
  });
  planFocusCues(input);
  const cues = firstShot(input.visualPlan).camera.focus_cues;
  assert.deepEqual(cues.map(cue => cue.region_id), ['r_star', 'r_price', 'r_star']);
  assert.deepEqual(cues.map(cue => cue.caption_ids), [['cap_01'], ['cap_02'], ['cap_03']]);
  assert.notEqual(cues[0].id, cues[2].id, '不同 caption 段的 cue id 必须不同');
}

// 规则 5c：中间只是未命中任何 region 的 caption → 不打断同 region 合并。
{
  const input = fixture({
    captions: [
      { id: 'cap_01', start: 0, end: 2, text: 'Star 按钮亮了' },
      { id: 'cap_02', start: 2, end: 4, text: '继续讲别的话题' },
      { id: 'cap_03', start: 4, end: 6, text: '回到 Star 按钮' },
    ],
    regions: [canonicalRegion({ id: 'r_star', label: 'Star 按钮', trust: 'A' })],
    duration: 6,
  });
  planFocusCues(input);
  const cues = firstShot(input.visualPlan).camera.focus_cues;
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0].caption_ids, ['cap_01', 'cap_03']);
}

// 规则 6：聚焦过渡预算常量锁定；合并后字幕总窗口短于预算时 camera_zoom 降级为 highlight_only。
{
  assert.equal(FOCUS_TRANSITION_BUDGET_SEC, 1);
  const short = fixture({
    captions: [
      { id: 'cap_01', start: 0, end: 0.5, text: 'Star 按钮亮了' },
      { id: 'cap_02', start: 0.5, end: 4, text: '继续讲别的话题' },
    ],
    regions: [canonicalRegion({ id: 'r_star', label: 'Star 按钮', trust: 'A' })],
    duration: 4,
  });
  planFocusCues(short);
  const shortCue = firstShot(short.visualPlan).camera.focus_cues[0];
  assert.equal(shortCue.effect, 'highlight_only', '短于预算的窗口必须降级');
  assert.equal('zoom' in shortCue, false);

  const exact = fixture({
    captions: [
      { id: 'cap_01', start: 0, end: 1, text: 'Star 按钮亮了' },
      { id: 'cap_02', start: 1, end: 4, text: '继续讲别的话题' },
    ],
    regions: [canonicalRegion({ id: 'r_star', label: 'Star 按钮', trust: 'A' })],
    duration: 4,
  });
  planFocusCues(exact);
  assert.equal(firstShot(exact.visualPlan).camera.focus_cues[0].effect, 'camera_zoom', '恰好等于预算不降级');

  // 浮点回归：1.4 - 0.4 在 JS 中略小于 1，容差内不得误降级。
  const float = fixture({
    captions: [
      { id: 'cap_01', start: 0.4, end: 1.4, text: 'Star 按钮亮了' },
      { id: 'cap_02', start: 1.4, end: 4, text: '继续讲别的话题' },
    ],
    regions: [canonicalRegion({ id: 'r_star', label: 'Star 按钮', trust: 'A' })],
    duration: 4,
  });
  planFocusCues(float);
  assert.equal(firstShot(float.visualPlan).camera.focus_cues[0].effect, 'camera_zoom');
}

// 规则 7：diagram/generated_image beat 不写 camera；motion_overlay 原样不动。
{
  const overlay = {
    preset: 'key_marker',
    placement: 'bottom_left',
    density: 'medium',
    max_items: 2,
  };
  const input = fixture({
    captions: [{ id: 'cap_01', start: 0, end: 4, text: '价格面板显示三个套餐' }],
    regions: [canonicalRegion({ id: 'r_price', label: '价格面板', trust: 'A' })],
    duration: 4,
    motionOverlay: overlay,
  });
  input.visualPlan.beats.push(
    {
      id: 'scene_02',
      scene_id: 'scene_02',
      visual_base: { type: 'diagram', asset_id: null, fit: 'contain', role: 'main_visual', continuity_group: 'scene_02' },
    },
    {
      id: 'scene_03',
      scene_id: 'scene_03',
      visual_base: { type: 'generated_image', asset_id: 'asset_hero', fit: 'contain', role: 'main_visual', continuity_group: 'scene_03' },
    },
  );
  const diagramBefore = JSON.parse(JSON.stringify(input.visualPlan.beats[1].visual_base));
  const generatedBefore = JSON.parse(JSON.stringify(input.visualPlan.beats[2].visual_base));
  planFocusCues(input);
  assert.deepEqual(input.visualPlan.beats[1].visual_base, diagramBefore, 'diagram beat 不写 camera');
  assert.deepEqual(input.visualPlan.beats[2].visual_base, generatedBefore, '无图镜头 beat 不写 camera');
  assert.deepEqual(input.visualPlan.beats[0].motion_overlay, overlay, 'motion_overlay 必须原样保留');
}

// 规则 8：确定性——同输入两次运行输出深度相等；重复 enrich 幂等。
{
  const build = () => fixture({
    captions: [
      { id: 'cap_01', start: 0, end: 2, text: 'Star 按钮亮了' },
      { id: 'cap_02', start: 2, end: 4, text: '点下 Star 按钮' },
      { id: 'cap_03', start: 4, end: 6, text: '看价格面板' },
      { id: 'cap_04', start: 6, end: 8, text: '看用户评价区' },
    ],
    regions: [
      canonicalRegion({ id: 'r_star', label: 'Star 按钮', trust: 'A' }),
      canonicalRegion({ id: 'r_price', label: '价格面板', trust: 'B' }),
      canonicalRegion({ id: 'r_review', label: '用户评价区', trust: 'C' }),
    ],
  });
  const first = build();
  const second = build();
  planFocusCues(first);
  planFocusCues(second);
  assert.deepEqual(first.visualPlan, second.visualPlan, '同输入两次运行必须深度相等');
  const enrichedOnce = JSON.parse(JSON.stringify(first.visualPlan));
  planFocusCues(first);
  assert.deepEqual(first.visualPlan, enrichedOnce, '重复 enrich 必须幂等');
}

// 与 buildVisualPlan 对齐：planner 用相同输入重建 canonical captions，
// 必须与真实 visual plan 的 shot.caption_ids 对得上（含 scene 无 id 时的回退 sceneId）。
{
  const sceneSpec = {
    scenes: [{
      duration_sec: 4,
      narration_text: '价格面板显示三个套餐',
      captions: [{ id: 'cap_01', start: 0, end: 4, text: '价格面板显示三个套餐' }],
      visual_text: { headline: '价格', keywords: [], cards: [] },
    }],
  };
  const creativeContext = {
    asset_context: {
      assets: [{
        id: 'hero',
        media_type: 'image',
        requirement: 'required',
        path: 'assets/hero.png',
        focus_regions: [canonicalRegion({ id: 'r_price', label: '价格面板', trust: 'A' })],
      }],
    },
  };
  const graph = {
    nodes: [{
      id: 'scene_01',
      scene_id: 'scene_01',
      kind: 'text',
      label: '价格',
      asset_refs: [{ asset_id: 'hero', usage: 'subject' }],
    }],
    edges: [],
  };
  const visualPlan = buildVisualPlan({ graph, sceneSpec, creativeContext, workflowId: 'wf-d04', mediaOptions: {} });
  planFocusCues({ visualPlan, creativeContext, sceneSpec, mediaOptions: {} });
  const beat = visualPlan.beats[0];
  assert.equal(beat.visual_base.type, 'image_sequence');
  const shot = beat.visual_base.shots[0];
  assert.equal(shot.camera.focus_cues.length, 1);
  assert.deepEqual(shot.camera.focus_cues[0].caption_ids, ['cap_01']);
  assert.ok(shot.camera.focus_cues[0].caption_ids.every(id => shot.caption_ids.includes(id)));
  assert.equal(shot.camera.focus_cues[0].region_id, 'r_price');
}

// 词边界回归（Review 阻断项）：纯拉丁字母数字 term 必须按词边界匹配（相邻字符不得是 [A-Za-z0-9]），
// 防止 alias "star" 误命中 "restart"/"starting" 生成指向无关 region 的缩放 cue；CJK term 保持子串匹配。
{
  const starRegion = () => canonicalRegion({ id: 'r_star', label: '收藏按钮', aliases: ['star'], trust: 'A' });
  const noHit = captionText => {
    const input = fixture({
      captions: [{ id: 'cap_01', start: 0, end: 2, text: captionText }],
      regions: [starRegion()],
      duration: 2,
    });
    planFocusCues(input);
    assert.equal('camera' in firstShot(input.visualPlan), false, `"star" 不得命中 "${captionText}"`);
  };
  noHit('please restart the server');
  noHit('starting the demo now');

  const hit = (captionText, expectedKeyword) => {
    const input = fixture({
      captions: [{ id: 'cap_01', start: 0, end: 2, text: captionText }],
      regions: [starRegion()],
      duration: 2,
    });
    planFocusCues(input);
    const cues = firstShot(input.visualPlan).camera.focus_cues;
    assert.equal(cues.length, 1, `"star" 应命中 "${captionText}"`);
    assert.equal(cues[0].keyword, expectedKeyword);
    assert.equal(cues[0].region_id, 'r_star');
  };
  hit('give it a star please', 'star');
  hit('Star 数量突破十万', 'Star');
  // 前部误命中位置被拒绝后必须继续向后扫描，找到合法的词边界出现。
  hit('restart the star button', 'star');

  // 中文 alias 行为不变：CJK 无词边界，子串包含即命中（"价格" 命中 "看价格面板" 的词中位置）。
  const cjk = fixture({
    captions: [{ id: 'cap_01', start: 0, end: 2, text: '看价格面板' }],
    regions: [canonicalRegion({ id: 'r_price', label: '定价区', aliases: ['价格'], trust: 'A' })],
    duration: 2,
  });
  planFocusCues(cjk);
  assert.equal(firstShot(cjk.visualPlan).camera.focus_cues[0].keyword, '价格');
}

console.log('html-video focus cue planner tests passed');
