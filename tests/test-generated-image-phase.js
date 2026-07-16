const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const phase = require('../server/services/creative-video/html-video/generatedImagePhase');

const sceneSpec = {
  aspect_ratio: '9:16',
  scenes: [{ id: 'scene_01', narration_text: '深夜骑手', visual_text: { headline: '深夜骑手' } }],
};

function baseContext() {
  return { asset_context: { assets: [] } };
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
  assert.deepStrictEqual(capturedMaxScenes, [4]);

  let generateCalled = false;
  const rerun = await phase.runGeneratedImagePhase({
    sceneSpec,
    creativeContext: {
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
  assert.strictEqual(asset.origin, 'ai_generated');
  assert.strictEqual(asset.origin_detail, 'scene_main_visual');
  assert.strictEqual(asset.requirement, 'optional');
  assert.strictEqual(asset.evidence_class, 'synthetic');
  assert.strictEqual(asset.status, 'ready');
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

  const plannerFailed = await phase.runGeneratedImagePhase({
    sceneSpec,
    creativeContext: baseContext(),
    projectDir,
    services: {
      generatedImagePlanner: { planGeneratedImages: async () => ({ success: false, plans: [], message: '模型超时' }) },
      aiImageModel: stubModelNoCheck,
    },
  });
  assert.strictEqual(plannerFailed.generated_count, 0);
  assert.strictEqual(plannerFailed.diagnostics.length, 1);
  assert.strictEqual(plannerFailed.diagnostics[0].severity, 'warning');
  assert.match(plannerFailed.diagnostics[0].user_message, /主视觉规划失败/);

  const plannerThrow = await phase.runGeneratedImagePhase({
    sceneSpec,
    creativeContext: baseContext(),
    projectDir,
    services: {
      generatedImagePlanner: { planGeneratedImages: async () => { throw new Error('text 模型崩了'); } },
      aiImageModel: stubModelNoCheck,
    },
  });
  assert.strictEqual(plannerThrow.generated_count, 0);
  assert.match(plannerThrow.diagnostics[0].user_message, /主视觉规划异常/);

  let sizeSeen = '';
  await phase.runGeneratedImagePhase({
    sceneSpec: { scenes: [{ id: 'scene_01', narration_text: 'a' }] },
    creativeContext: baseContext(),
    projectDir,
    aspectRatio: '16:9',
    services: {
      generatedImagePlanner: { planGeneratedImages: async () => ({ success: true, plans: [{ scene_id: 'scene_01', generation_prompt: 'x' }] }) },
      aiImageModel: {
        generateImages: async ({ size }) => { sizeSeen = size; return { success: false, configured: true, images: [], message: '只验 size' }; },
        downloadGeneratedImages: async () => ({ success: false, files: [], failures: [] }),
      },
    },
  });
  assert.strictEqual(sizeSeen, '2848x1600');

  let refillStartIndex = -1;
  const refill = await phase.runGeneratedImagePhase({
    sceneSpec: {
      aspect_ratio: '9:16',
      scenes: [
        { id: 'scene_01', narration_text: 'a' },
        { id: 'scene_02', narration_text: 'b' },
      ],
    },
    creativeContext: {
      asset_context: { assets: [{ id: 'gen_scene_01', source: 'generated', path: 'assets/x.png', generation: { scene_id: 'scene_01' } }] },
    },
    projectDir,
    services: {
      generatedImagePlanner: {
        planGeneratedImages: async () => ({
          success: true,
          plans: [
            { scene_id: 'scene_01', generation_prompt: '已生成过' },
            { scene_id: 'scene_02', generation_prompt: '补齐场景二' },
          ],
        }),
      },
      aiImageModel: {
        generateImages: async ({ prompt }) => {
          assert.strictEqual(prompt, '补齐场景二');
          return { success: true, configured: true, images: [{ url: 'https://cdn.example.com/img-2.png' }] };
        },
        downloadGeneratedImages: async ({ assetDir, startIndex }) => {
          refillStartIndex = startIndex;
          fs.mkdirSync(assetDir, { recursive: true });
          const localPath = path.join(assetDir, 'generated-image-02-def.png');
          fs.writeFileSync(localPath, 'png');
          return {
            success: true,
            files: [{ url: 'https://cdn.example.com/img-2.png', local_path: localPath, file_name: 'generated-image-02-def.png', bytes: 3, mime: 'image/png' }],
            failures: [],
          };
        },
      },
    },
  });
  assert.strictEqual(refillStartIndex, 1);
  assert.strictEqual(refill.generated_count, 1);
  const refillIds = refill.creativeContext.asset_context.assets.map(item => item.id);
  assert.ok(refillIds.includes('gen_scene_02'));
  assert.strictEqual(refillIds.filter(id => id === 'gen_scene_01').length, 1);

  const hydrateFiltered = phase.hydrateGeneratedAssetsFromProject({
    project: {
      assets: [
        { id: 'gen_scene_01', source: 'generated', path: 'assets/generated-image-01-abc.png', generation: { scene_id: 'scene_01' } },
        { id: 'gen_scene_09', source: 'generated', path: 'assets/missing.png', generation: { scene_id: 'scene_09' } },
        { id: 'gen_scene_10', source: 'generated', path: '../escape.png', generation: { scene_id: 'scene_10' } },
        { id: 'article_01', source: 'article', path: 'assets/a.jpg' },
      ],
    },
    creativeContext: {
      asset_context: { assets: [{ id: 'gen_scene_01', source: 'generated', path: 'assets/dup.png', generation: { scene_id: 'scene_01' } }] },
    },
    projectDir: hydrateDir,
  });
  const hydratedIds = hydrateFiltered.asset_context.assets.map(item => item.id);
  assert.deepStrictEqual(hydratedIds, ['gen_scene_01']);
  assert.strictEqual(hydrateFiltered.asset_context.assets[0].path, 'assets/dup.png');

  let hydratedGenerateCalled = false;
  const afterHydrate = await phase.runGeneratedImagePhase({
    sceneSpec,
    creativeContext: hydrated,
    projectDir: hydrateDir,
    services: {
      generatedImagePlanner: { planGeneratedImages: async () => ({ success: true, plans: [{ scene_id: 'scene_01', generation_prompt: '重复' }] }) },
      aiImageModel: {
        generateImages: async () => { hydratedGenerateCalled = true; return { success: false, images: [] }; },
        downloadGeneratedImages: async () => ({ success: false, files: [], failures: [] }),
      },
    },
  });
  assert.strictEqual(afterHydrate.generated_count, 0);
  assert.strictEqual(hydratedGenerateCalled, false);

  console.log('test-generated-image-phase passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
