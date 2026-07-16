const assert = require('assert');
const {
  buildContentGraphPrompt,
  buildRetryPrompt: buildGraphRetryPrompt,
} = require('../server/services/creative-video/html-video/contentGraphAgent');
const frameHtmlAgent = require('../server/services/creative-video/html-video/frameHtmlAgent');
const { resolveAssetFirstMotionArgs } = require('../server/services/creative-video/html-video/motionOverlayPhase');

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
