const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const phase = require('../server/services/creative-video/html-video/generatedImagePhase');

const sceneSpec = {
  aspect_ratio: '9:16',
  scenes: [{ id: 'scene_01', narration_text: '深夜骑手', visual_text: { headline: '深夜骑手' } }],
};

function baseContext(strategy = 'asset_first') {
  return { visual_strategy: strategy, asset_context: { assets: [] } };
}

function imageModel(fileName = 'generated-image-01-abc.png') {
  return {
    generateImages: async ({ size }) => {
      assert.strictEqual(size, '1600x2848');
      return {
        success: true,
        configured: true,
        images: [{ url: 'https://cdn.example.com/img.png' }],
        model_info: { provider: 'volcark', model_id: 'seedream' },
      };
    },
    downloadGeneratedImages: async ({ assetDir }) => {
      fs.mkdirSync(assetDir, { recursive: true });
      const localPath = path.join(assetDir, fileName);
      fs.writeFileSync(localPath, 'png');
      return {
        success: true,
        files: [{ url: 'https://cdn.example.com/img.png', local_path: localPath, file_name: fileName, bytes: 3, mime: 'image/png' }],
        failures: [],
      };
    },
  };
}

async function run() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-image-phase-test-'));

  const notConfiguredModel = {
    isConfigured: async () => false,
    generateImages: async () => { throw new Error('不应到达'); },
    downloadGeneratedImages: async () => { throw new Error('不应到达'); },
  };
  const hfSkipped = await phase.runGeneratedImagePhase({
    sceneSpec,
    creativeContext: baseContext('hf_first'),
    projectDir,
    services: { aiImageModel: notConfiguredModel },
  });
  assert.strictEqual(hfSkipped.skipped, true);
  assert.strictEqual(hfSkipped.diagnostics.length, 0);

  const afSkipped = await phase.runGeneratedImagePhase({
    sceneSpec,
    creativeContext: baseContext(),
    projectDir,
    services: { aiImageModel: notConfiguredModel },
  });
  assert.strictEqual(afSkipped.skipped, true);
  assert.strictEqual(afSkipped.diagnostics[0].severity, 'warning');

  const capturedMaxScenes = [];
  const noOpPlanner = { planGeneratedImages: async ({ maxScenes }) => { capturedMaxScenes.push(maxScenes); return { success: true, plans: [] }; } };
  const stubModelNoCheck = { generateImages: async () => ({ success: false, images: [] }), downloadGeneratedImages: async () => ({ success: false, files: [], failures: [] }) };
  await phase.runGeneratedImagePhase({ sceneSpec, creativeContext: baseContext(), projectDir, services: { generatedImagePlanner: noOpPlanner, aiImageModel: stubModelNoCheck } });
  await phase.runGeneratedImagePhase({ sceneSpec, creativeContext: baseContext('hf_first'), projectDir, services: { generatedImagePlanner: noOpPlanner, aiImageModel: stubModelNoCheck } });
  assert.deepStrictEqual(capturedMaxScenes, [4, 2]);

  let generateCalled = false;
  const rerun = await phase.runGeneratedImagePhase({
    sceneSpec,
    creativeContext: {
      visual_strategy: 'asset_first',
      asset_context: { assets: [{ id: 'gen_scene_01', source: 'generated', path: 'assets/x.png', generation: { scene_id: 'scene_01' } }] },
    },
    projectDir,
    services: {
      generatedImagePlanner: { planGeneratedImages: async () => ({ success: true, plans: [{ scene_id: 'scene_01', generation_prompt: '重复' }] }) },
      aiImageModel: { ...stubModelNoCheck, generateImages: async () => { generateCalled = true; return { success: false, images: [] }; } },
    },
  });
  assert.strictEqual(rerun.generated_count, 0);
  assert.strictEqual(generateCalled, false);

  const result = await phase.runGeneratedImagePhase({
    sceneSpec,
    creativeContext: baseContext(),
    projectDir,
    services: {
      generatedImagePlanner: { planGeneratedImages: async () => ({ success: true, plans: [{ scene_id: 'scene_01', generation_prompt: '深夜骑手主视觉' }] }) },
      aiImageModel: imageModel(),
    },
  });
  assert.strictEqual(result.generated_count, 1);
  const asset = result.creativeContext.asset_context.assets[0];
  assert.strictEqual(asset.id, 'gen_scene_01');
  assert.strictEqual(asset.source, 'generated');
  assert.strictEqual(asset.path, 'assets/generated-image-01-abc.png');
  assert.strictEqual(asset.frame_src, '../assets/generated-image-01-abc.png');
  assert.strictEqual(asset.generation.scene_id, 'scene_01');

  const required = await phase.runGeneratedImagePhase({
    sceneSpec,
    creativeContext: baseContext(),
    projectDir,
    requiredSceneIds: ['scene_01'],
    services: {
      generatedImagePlanner: { planGeneratedImages: async () => ({ success: true, plans: [] }) },
      aiImageModel: imageModel('generated-image-01-req.png'),
    },
  });
  assert.strictEqual(required.generated_count, 1);
  assert.strictEqual(required.creativeContext.asset_context.assets[0].id, 'gen_scene_01');

  const decisions = new Map([
    ['scene_01', { source_mode: 'template_inputs', template_id: 'frame-bold-poster' }],
    ['scene_02', { source_mode: 'template_inputs', template_id: 'frame-bold-signal' }],
  ]);
  phase.enforceAssetFirstRawHtmlRouting({
    decisions,
    contentGraph: {
      nodes: [
        { id: 'scene_01', asset_refs: [{ asset_id: 'gen_scene_01', usage: 'subject' }] },
        { id: 'scene_02', asset_refs: [{ asset_id: 'article_01', usage: 'evidence' }] },
      ],
    },
    creativeContext: {
      visual_strategy: 'asset_first',
      asset_context: { assets: [{ id: 'gen_scene_01', source: 'generated' }, { id: 'article_01', source: 'article' }] },
    },
  });
  assert.strictEqual(decisions.get('scene_01').source_mode, 'raw_html');
  assert.strictEqual(decisions.get('scene_02').source_mode, 'template_inputs');

  const hydrateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-image-hydrate-test-'));
  fs.mkdirSync(path.join(hydrateDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(hydrateDir, 'assets', 'generated-image-01-abc.png'), 'png');
  const hydrated = phase.hydrateGeneratedAssetsFromProject({
    project: { assets: [{ id: 'gen_scene_01', source: 'generated', path: 'assets/generated-image-01-abc.png', generation: { scene_id: 'scene_01' } }] },
    creativeContext: baseContext(),
    projectDir: hydrateDir,
  });
  assert.strictEqual(hydrated.asset_context.assets[0].id, 'gen_scene_01');
  assert.ok(hydrated.asset_context.assets[0].local_path.endsWith('generated-image-01-abc.png'));

  console.log('test-generated-image-phase passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
