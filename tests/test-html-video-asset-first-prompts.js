const assert = require('assert');
const {
  buildContentGraphPrompt,
  buildRetryPrompt: buildGraphRetryPrompt,
} = require('../server/services/creative-video/html-video/contentGraphAgent');
const frameHtmlAgent = require('../server/services/creative-video/html-video/frameHtmlAgent');
const { resolveAssetFirstMotionArgs } = require('../server/services/creative-video/html-video/motionOverlayPhase');
const { buildVisualPlan } = require('../server/services/creative-video/html-video/visualPlanService');

const sceneSpec = { title: 't', scenes: [{ id: 'scene_01', narration_text: '深夜骑手' }] };

async function run() {
  const generatedAsset = {
    id: 'gen_scene_01',
    source: 'generated',
    path: 'assets/generated-image-01-abc.png',
    frame_src: '../assets/generated-image-01-abc.png',
    alt: '深夜骑手主视觉',
    generation: { scene_id: 'scene_01' },
  };

  const assetPrompt = buildContentGraphPrompt({
    sceneSpec,
    creativeContext: { asset_context: { assets: [generatedAsset] } },
    target: {},
  });
  assert.ok(assetPrompt.includes('素材主导'));
  assert.ok(assetPrompt.includes('subject'));
  assert.ok(assetPrompt.includes('gen_scene_01'));

  const manyAssets = [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `article_0${i + 1}`,
      source: 'article',
      path: `assets/article-image-0${i + 1}.jpg`,
      frame_src: `../assets/article-image-0${i + 1}.jpg`,
      alt: `文章图${i + 1}`,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `gen_scene_0${i + 1}`,
      source: 'generated',
      path: `assets/generated-image-0${i + 1}.png`,
      frame_src: `../assets/generated-image-0${i + 1}.png`,
      alt: `生成图${i + 1}`,
      generation: { scene_id: `scene_0${i + 1}` },
    })),
  ];
  const truncatedPrompt = buildContentGraphPrompt({
    sceneSpec,
    creativeContext: { asset_context: { assets: manyAssets } },
    target: {},
  });
  ['gen_scene_01', 'gen_scene_02', 'gen_scene_03', 'gen_scene_04', 'article_01', 'article_02', 'article_03', 'article_04']
    .forEach(id => assert.ok(truncatedPrompt.includes(id), `${id} 应出现在 prompt 中`));

  const graphRetryPrompt = buildGraphRetryPrompt({
    sceneSpec,
    creativeContext: { asset_context: { assets: [generatedAsset] } },
    target: {},
    attempt: 1,
  });
  assert.ok(graphRetryPrompt.includes('gen_scene_01'));
  assert.ok(graphRetryPrompt.includes('subject'));

  const frameNode = {
    id: 'scene_01',
    kind: 'text',
    label: '深夜骑手',
    asset_refs: [{ asset_id: 'gen_scene_01', usage: 'subject', reason: '主视觉' }],
  };
  const assetFirstContext = {
    asset_context: { assets: [generatedAsset] },
  };
  const framePrompt = frameHtmlAgent.buildFrameHtmlPrompt({
    node: frameNode,
    creativeContext: assetFirstContext,
    sceneSpec,
    target: { aspect_ratio: '9:16' },
  });
  assert.ok(framePrompt.includes('画面主体'));
  assert.ok(framePrompt.includes('标注'));
  assert.ok(framePrompt.includes('生成图片'));
  assert.ok(framePrompt.includes('不是来源证据'));
  assert.ok(!framePrompt.includes('本帧推荐来源图片：'));
  assert.ok(!framePrompt.includes('至少使用其中 2 种'), '不得再强制至少两种表达');
  assert.ok(!framePrompt.includes('没有表达层的帧不合格'), '不得再判无表达层不合格');
  assert.ok(!framePrompt.includes('不要做纯图片轮播'), '不得保留要求混排框选/高亮的旧约束');
  assert.ok(/禁止.*(方框|focus-box)/.test(framePrompt), '必须禁止无坐标画框');
  assert.match(framePrompt, /只选一种，不要把多套布局叠在同一帧/, '主提示词必须要求先收敛为单一布局');
  assert.match(framePrompt, /文字容器内.*grid\/flex 正常流/, '文字内容必须在同一容器内使用正常流排版');
  assert.match(framePrompt, /只改变 transform 与 opacity/, '动画不得修改排版几何属性');
  assert.match(framePrompt, /首帧必须立即显示背景或主视觉/, '首帧不得等待整屏入场后才出现内容');
  assert.match(framePrompt, /文字容器不得用固定高度配合 overflow:hidden/, '文字溢出不得通过裁切掩盖');

  // C-02 Review：真实 Visual Plan 的 image_sequence 必须完整进入 Frame Prompt。
  {
    const assets = ['a', 'b', 'c'].map((id, index) => ({
      id,
      origin: index === 0 ? 'page_capture' : 'source_extract',
      media_type: 'image',
      requirement: index === 2 ? 'required' : 'optional',
      evidence_class: 'direct_source',
      status: 'ready',
      path: `assets/${id}.png`,
      frame_src: `../assets/${id}.png`,
      image_analysis: { fit: index === 0 ? 'contain' : 'cover' },
    }));
    const graph = { nodes: [{ id: 'scene_01', label: '案例并列', asset_refs: assets.map((asset, index) => ({
      asset_id: asset.id,
      usage: index === 0 ? 'subject' : 'showcase',
      reason: `第${index + 1}张案例`,
    })) }], edges: [] };
    const plan = buildVisualPlan({
      graph,
      sceneSpec: { scenes: [{ id: 'scene_01', kind: 'text', duration_sec: 6, narration_text: '三个案例并列展示。' }] },
      creativeContext: { asset_context: { assets } },
      workflowId: 'prompt-sequence',
    });
    const sequencePrompt = frameHtmlAgent.buildAssetFirstFramePrompt({
      beat: plan.beats[0],
      creativeContext: { asset_context: { assets } },
    });
    assert.match(sequencePrompt, /image_sequence/);
    assert.match(sequencePrompt, /sequence_mode：fullscreen_relay/);
    assert.match(sequencePrompt, /shot 1：id=scene_01_shot_03；asset_id=c/);
    assert.doesNotMatch(sequencePrompt, /asset_id=[ab]/);
    assert.match(sequencePrompt, /src=\.\.\/assets\/c\.png/);
    assert.match(sequencePrompt, /role=showcase/);
    assert.match(sequencePrompt, /reason=第3张案例/);
    assert.match(sequencePrompt, /requirement=required/);
    assert.match(sequencePrompt, /fit=cover/);
    assert.match(sequencePrompt, /caption_ids=/);
    assert.match(sequencePrompt, /active_window=.*scene_local/);
    assert.match(sequencePrompt, /minimum_visible_duration_sec=/);
    assert.match(sequencePrompt, /不得换图、少图/);
    assert.match(sequencePrompt, /不得把 Shot 当作 overlay/);
    assert.match(sequencePrompt, /系统会.*确定性注入真实图片层/);
    assert.match(sequencePrompt, /不得自行输出 data-hv-image-sequence、data-hv-shot/);
    assert.match(sequencePrompt, /不得再次输出这些 Shot 的 img\/src/);
    assert.match(sequencePrompt, /overlay-only/);
    assert.match(sequencePrompt, /HF 根容器.*data-hv-canvas 主舞台.*必须保持透明/);
    assert.match(sequencePrompt, /不得用实色、渐变、canvas、svg 或 video 覆盖/);
    assert.match(sequencePrompt, /只允许局部文字、局部卡片和局部装饰/);
    assert.doesNotMatch(sequencePrompt, /缺少 caption timing/);
    assert.doesNotMatch(sequencePrompt, /enter_sec|hold_sec|exit_sec/);
    for (const [name, wrapperPrompt] of [
      ['full', frameHtmlAgent.buildFrameHtmlPrompt({ node: graph.nodes[0], beat: plan.beats[0], creativeContext: { asset_context: { assets } }, sceneSpec: { scenes: [{ id: 'scene_01', narration_text: '案例并列' }] } })],
      ['short', frameHtmlAgent.buildShortFrameHtmlPrompt({ node: graph.nodes[0], beat: plan.beats[0], creativeContext: { asset_context: { assets } }, sceneSpec: { scenes: [{ id: 'scene_01', narration_text: '案例并列' }] } })],
      ['retry', frameHtmlAgent.buildRetryPrompt({ node: graph.nodes[0], beat: plan.beats[0], creativeContext: { asset_context: { assets } }, sceneSpec: { scenes: [{ id: 'scene_01', narration_text: '案例并列' }] } })],
    ]) {
      assert.match(wrapperPrompt, /sequence_mode：fullscreen_relay/, `${name} wrapper 必须消费裁减后的真实 sequence`);
      assert.match(wrapperPrompt, /asset_id=c/);
      assert.match(wrapperPrompt, /src=\.\.\/assets\/c\.png/);
      assert.match(wrapperPrompt, /active_window=.*scene_local/);
      assert.match(wrapperPrompt, /系统 Shot 层注入|唯一图片真值/);
      assert.match(wrapperPrompt, /overlay-only/);
    }
    const movedAssets = assets.map(asset => asset.id === 'a'
      ? { ...asset, path: 'assets/a-new.png', frame_src: '../assets/a-new.png' }
      : asset);
    const movedPlan = buildVisualPlan({
      graph,
      sceneSpec: { scenes: [{ id: 'scene_01', kind: 'text', duration_sec: 6, narration_text: '三个案例并列展示。' }] },
      creativeContext: { asset_context: { assets: movedAssets } },
      workflowId: 'prompt-sequence',
    });
    const movedPrompt = frameHtmlAgent.buildAssetFirstFramePrompt({
      beat: movedPlan.beats[0],
      creativeContext: { asset_context: { assets: movedAssets } },
    });
    assert.match(movedPrompt, /src=\.\.\/assets\/c\.png/);
    assert.doesNotMatch(movedPrompt, /a-new\.png/);
    const tamperedBeat = JSON.parse(JSON.stringify(plan.beats[0]));
    tamperedBeat.visual_base.shots[0].src = 'https://evil.example/c.png';
    const verifiedPrompt = frameHtmlAgent.buildAssetFirstFramePrompt({
      beat: tamperedBeat,
      creativeContext: { asset_context: { assets } },
    });
    assert.match(verifiedPrompt, /src=\.\.\/assets\/c\.png/);
    assert.doesNotMatch(verifiedPrompt, /evil\.example/);
  }

  const shortPrompt = frameHtmlAgent.buildShortFrameHtmlPrompt({
    node: frameNode,
    creativeContext: assetFirstContext,
    sceneSpec,
  });
  assert.ok(shortPrompt.includes('画面主体'));

  const retryPrompt = frameHtmlAgent.buildRetryPrompt({
    node: frameNode,
    creativeContext: assetFirstContext,
    sceneSpec,
    validationMessage: '缺少图片',
  });
  assert.ok(retryPrompt.includes('画面主体'));

  // ===== 模块3：motion overlay prompt 约束 =====
  // P0-2：base 指令与 overlay 指令解耦
  {
    const diagramArgs = resolveAssetFirstMotionArgs({
      metadata: {
        visual_beat: {
          id: 'scene_01_b1',
          visual_base: { type: 'diagram', asset_id: null },
          motion_overlay: null,
        },
      },
    });
    assert.equal(diagramArgs.beat?.id, 'scene_01_b1', 'null overlay 仍必须下传 beat');
    assert.ok(diagramArgs.diagramSkeleton.includes('data-mp-diagram-base'), 'diagram skeleton 不应依赖 overlay');

    const imageNull = frameHtmlAgent.buildAssetFirstFramePrompt({
      beat: {
        visual_base: { type: 'generated_image', asset_id: 'asset_main', fit: 'contain' },
        motion_overlay: null,
        continuity: { group_id: 'scene_01', beat_index: 2, beat_count: 3 },
      },
    });
    assert.ok(imageNull.includes('图片 asset_main 是主视觉'), 'null overlay 仍必须输出图片 base 指令');
    assert.ok(imageNull.includes('复用上一 beat'), 'null overlay 仍必须输出 continuity 指令');
    assert.ok(!imageNull.includes('可用 motion primitive'), 'null overlay 不得输出 primitive guide');
    assert.ok(/不得自创.*(方框|箭头|卡片)/.test(imageNull), 'null overlay 必须明确禁止自创表达层');

    const diagramNull = frameHtmlAgent.buildAssetFirstFramePrompt({
      beat: { visual_base: { type: 'diagram', asset_id: null }, motion_overlay: null },
      diagramSkeleton: '<div data-mp-diagram-base></div>',
    });
    assert.ok(/diagram|结构化/.test(diagramNull), 'null overlay 的无图 beat 仍必须输出 diagram 指令');
    assert.ok(diagramNull.includes('data-mp-diagram-base'), 'diagram skeleton 不应依赖 overlay');
    assert.ok(!diagramNull.includes('可用 motion primitive'));

    const entryArgs = {
      beat: {
        visual_base: { type: 'generated_image', asset_id: 'asset_main', fit: 'contain' },
        motion_overlay: null,
        continuity: { group_id: 'scene_01', beat_index: 2, beat_count: 3 },
      },
      node: { id: 'scene_01_b2' },
    };
    for (const [name, prompt] of [
      ['full', frameHtmlAgent.buildFrameHtmlPrompt(entryArgs)],
      ['short', frameHtmlAgent.buildShortFrameHtmlPrompt(entryArgs)],
      ['retry', frameHtmlAgent.buildRetryPrompt(entryArgs)],
    ]) {
      assert.ok(prompt.includes('图片 asset_main 是主视觉'), `${name} prompt 必须保留 null-overlay base 指令`);
      assert.ok(prompt.includes('复用上一 beat'), `${name} prompt 必须保留 null-overlay continuity 指令`);
    }
  }
  {
    const beat = {
      id: 'scene_02_b2', scene_id: 'scene_02', kind: 'text', duration_sec: 5.67,
      visual_base: { type: 'generated_image', asset_id: 'gen_scene_02', fit: 'contain', continuity_group: 'scene_02' },
      motion_overlay: { preset: 'key_marker', placement: 'lower_third', max_items: 1, avoid_caption_bottom_px: 140 },
      continuity: { group_id: 'scene_02', reuse_base_layout: true, beat_index: 2, beat_count: 3 },
    };
    const prompt = frameHtmlAgent.buildAssetFirstFramePrompt({ beat, primitiveSnippet: '<div data-mp-overlay="key_marker"></div>' });
    assert.ok(prompt.includes('key_marker'), 'prompt 必须点名选中的 motion primitive');
    assert.ok(prompt.includes('data-mp-overlay'), 'prompt 必须内嵌 primitive 参考片段');
    assert.ok(prompt.includes('140'), 'prompt 必须声明底部 140px 字幕安全区');
    assert.ok(/主视觉|main_visual/.test(prompt), '必须声明图片是主视觉、overlay 只做局部');
    assert.ok(/复用上一/.test(prompt), 'continuity beat_index>1 时必须要求复用上一 beat 布局');
    assert.ok(/禁止.*(入场|重新开场)/.test(prompt), '非首 beat 禁止 base 层入场动画');
  }
  // 无图 beat：要求统一 diagram，禁止标题页
  {
    const beat = {
      id: 'scene_04_b1', scene_id: 'scene_04', kind: 'text', duration_sec: 5.97,
      visual_base: { type: 'diagram', asset_id: null, continuity_group: 'scene_04' },
      motion_overlay: { preset: 'concept_card', placement: 'right_panel', max_items: 1, avoid_caption_bottom_px: 140 },
      continuity: { group_id: 'scene_04', reuse_base_layout: true, beat_index: 1, beat_count: 3 },
    };
    const prompt = frameHtmlAgent.buildAssetFirstFramePrompt({ beat, primitiveSnippet: '' });
    assert.ok(/diagram|结构化/.test(prompt), '无图 beat 必须要求生成统一 diagram');
    assert.ok(/禁止.*标题页/.test(prompt));
  }
  // 无 beat 编排参数时，帧 prompt 不含 motion primitive 片段词汇
  assert.ok(!framePrompt.includes('data-mp-overlay'), '无 beat 编排时 prompt 不得包含 motion primitive 片段词汇');
  console.log('asset-first prompt motion overlay tests passed');

  // ===== P2-8 硬约束 A：metadata 内部编排字段不得进入 Frame HTML prompt =====
  {
    const pollutedNode = {
      ...frameNode,
      metadata: {
        scene_id: 'scene_01',
        source_headline: '深夜骑手',
        visual_beat: { id: 'scene_01_b1', motion_overlay: { preset: 'key_marker' } },
        visual_beats: [{ id: 'scene_01_b1' }],
        beat_windows: [{ id: 'scene_01_b1', start_sec: 0, end_sec: 2 }],
      },
    };
    const pollutedPrompt = frameHtmlAgent.buildFrameHtmlPrompt({
      node: pollutedNode,
      creativeContext: {},
      sceneSpec,
    });
    assert.ok(!pollutedPrompt.includes('visual_beat'), 'prompt 不得包含 metadata.visual_beat/visual_beats');
    assert.ok(!pollutedPrompt.includes('beat_windows'), 'prompt 不得包含 metadata.beat_windows');
    assert.ok(!pollutedPrompt.includes('key_marker'), 'prompt 不得泄漏 motion overlay 编排细节');
    assert.ok(pollutedPrompt.includes('source_headline'), '剥离编排字段后其余 metadata 应保留');

    const shortPolluted = frameHtmlAgent.buildShortFrameHtmlPrompt({
      node: pollutedNode,
      creativeContext: {},
      sceneSpec,
    });
    assert.ok(!shortPolluted.includes('visual_beat'), '短 prompt 同样不得包含 visual_beat');
    assert.ok(!shortPolluted.includes('beat_windows'), '短 prompt 同样不得包含 beat_windows');
    console.log('frame html prompt metadata strip tests passed');
  }

  // ===== 模块5 + R8：无字幕 beat 的画面兜底 =====
  {
    const beat = {
      id: 'scene_04_b2', scene_id: 'scene_04', kind: 'text', duration_sec: 5.97,
      narration_text: 'UX 关注用户为什么来',
      visual_base: { type: 'diagram', asset_id: null, continuity_group: 'scene_04' },
      motion_overlay: { preset: 'concept_card', placement: 'right_panel', max_items: 1, avoid_caption_bottom_px: 140 },
      continuity: { group_id: 'scene_04', reuse_base_layout: true, beat_index: 2, beat_count: 3 },
    };
    const noCaption = frameHtmlAgent.buildAssetFirstFramePrompt({ beat, primitiveSnippet: '', hasCaptions: false });
    assert.ok(/重点短句/.test(noCaption), '无字幕 beat 必须要求画面内有重点短句，避免只有旁白');
    const withCaption = frameHtmlAgent.buildAssetFirstFramePrompt({ beat, primitiveSnippet: '', hasCaptions: true });
    assert.ok(!/重点短句/.test(withCaption));
  }
  console.log('asset-first prompt no-caption fallback tests passed');

  // ===== 模板穿线删除：帧 prompt 不得再携带模板身份与模板源码段 =====
  {
    const prompt = frameHtmlAgent.buildFrameHtmlPrompt({
      node: frameNode,
      creativeContext: {},
      sceneSpec,
      target: { aspect_ratio: '9:16' },
      styleProfile: { id: 'sp1', palette: ['#111', '#eee', '#f50'] },
    });
    assert.ok(!prompt.includes('Selected template metadata'), 'prompt 不得再携带模板 metadata 段');
    assert.ok(!prompt.includes('Template HTML'), 'prompt 不得再携带模板源码段');
    console.log('frame prompt template-free tests passed');
  }

  console.log('test-html-video-asset-first-prompts passed');
}

module.exports = { run };

if (require.main === module) {
  run().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
