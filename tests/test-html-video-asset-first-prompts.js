const assert = require('assert');
const {
  buildContentGraphPrompt,
  buildRetryPrompt: buildGraphRetryPrompt,
} = require('../server/services/creative-video/html-video/contentGraphAgent');
const frameHtmlAgent = require('../server/services/creative-video/html-video/frameHtmlAgent');

const sceneSpec = { title: 't', scenes: [{ id: 'scene_01', narration_text: '深夜骑手' }] };

async function run() {
  const hfPrompt = buildContentGraphPrompt({
    sceneSpec,
    creativeContext: { visual_strategy: 'hf_first' },
    target: {},
  });
  assert.ok(!hfPrompt.includes('素材主导'));
  assert.ok(hfPrompt.includes('usage'));

  const generatedAsset = {
    id: 'gen_scene_01',
    source: 'generated',
    path: 'assets/generated-image-01-abc.png',
    frame_src: '../assets/generated-image-01-abc.png',
    alt: '深夜骑手主视觉',
    generation: { scene_id: 'scene_01' },
  };
  const hfWithGenPrompt = buildContentGraphPrompt({
    sceneSpec,
    creativeContext: { visual_strategy: 'hf_first', asset_context: { assets: [generatedAsset] } },
    target: {},
  });
  assert.ok(hfWithGenPrompt.includes('gen_scene_01'));
  assert.ok(hfWithGenPrompt.includes('不强制'));
  assert.ok(hfWithGenPrompt.includes('不是来源证据'));
  assert.ok(!hfWithGenPrompt.includes('素材主导'));

  const assetPrompt = buildContentGraphPrompt({
    sceneSpec,
    creativeContext: { visual_strategy: 'asset_first', asset_context: { assets: [generatedAsset] } },
    target: { visual_strategy: 'asset_first' },
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
    creativeContext: { visual_strategy: 'asset_first', asset_context: { assets: manyAssets } },
    target: { visual_strategy: 'asset_first' },
  });
  ['gen_scene_01', 'gen_scene_02', 'gen_scene_03', 'gen_scene_04', 'article_01', 'article_02', 'article_03', 'article_04']
    .forEach(id => assert.ok(truncatedPrompt.includes(id), `${id} 应出现在 prompt 中`));

  const graphRetryPrompt = buildGraphRetryPrompt({
    sceneSpec,
    creativeContext: { visual_strategy: 'asset_first', asset_context: { assets: [generatedAsset] } },
    target: { visual_strategy: 'asset_first' },
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
    visual_strategy: 'asset_first',
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

  const hfGenPrompt = frameHtmlAgent.buildFrameHtmlPrompt({
    node: frameNode,
    creativeContext: { ...assetFirstContext, visual_strategy: 'hf_first' },
    sceneSpec,
  });
  assert.ok(!hfGenPrompt.includes('素材主导'));
  assert.ok(hfGenPrompt.includes('生成图片'));

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
  // 硬约束 A 回归：hf_first 的 prompt 构造输出不含 motion primitive 词汇
  assert.ok(!hfGenPrompt.includes('data-mp-overlay'), 'hf_first prompt 不得包含 motion primitive 片段词汇');
  console.log('asset-first prompt motion overlay tests passed');

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

  console.log('test-html-video-asset-first-prompts passed');
}

module.exports = { run };

if (require.main === module) {
  run().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
