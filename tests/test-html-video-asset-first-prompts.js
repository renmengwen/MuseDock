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

  console.log('test-html-video-asset-first-prompts passed');
}

module.exports = { run };

if (require.main === module) {
  run().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
