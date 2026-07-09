const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const htmlVideoWorkflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');

const sceneSpec = {
  title: 't',
  aspect_ratio: '9:16',
  target_duration_sec: 10,
  scenes: [{ id: 'scene_01', order: 1, duration_sec: 5, narration_text: '深夜骑手' }],
};

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-image-persist-test-'));
  const projectJsonPath = path.join(rootDir, 'wf-test', 'agent_runs', 'run-test-html-video', 'project.json');

  const buildArgs = fileName => ({
    workflowId: 'wf-test',
    runId: 'run-test',
    rootDir,
    sceneSpec,
    creativeContext: { visual_strategy: 'asset_first', asset_context: { assets: [] } },
    target: { aspect_ratio: '9:16' },
    skipValidation: true,
    services: {
      generatedImagePlanner: {
        planGeneratedImages: async () => ({
          success: true,
          plans: [{ scene_id: 'scene_01', generation_prompt: '深夜骑手主视觉' }],
        }),
      },
      aiImageModel: {
        generateImages: async () => ({
          success: true,
          configured: true,
          images: [{ url: 'https://cdn.example.com/img-1.png' }],
        }),
        downloadGeneratedImages: async ({ assetDir }) => {
          fs.mkdirSync(assetDir, { recursive: true });
          const localPath = path.join(assetDir, fileName);
          fs.writeFileSync(localPath, 'png');
          return {
            success: true,
            files: [{ url: 'https://cdn.example.com/img-1.png', local_path: localPath, file_name: fileName, bytes: 3, mime: 'image/png' }],
            failures: [],
          };
        },
      },
      aiTextModel: {
        callTextModel: async () => ({ success: false, message: '模拟 content graph 失败' }),
      },
    },
  });

  const result = await htmlVideoWorkflow.generateHtmlVideo(buildArgs('generated-image-01-abc.png'));
  assert.strictEqual(result.success, false);
  assert.ok(fs.existsSync(projectJsonPath), 'project.json 应已写盘');
  const project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
  const generated = (project.assets || []).filter(asset => asset.source === 'generated');
  assert.strictEqual(generated.length, 1);
  assert.strictEqual(generated[0].generation.scene_id, 'scene_01');

  fs.unlinkSync(path.join(rootDir, 'wf-test', 'agent_runs', 'run-test-html-video', generated[0].path));
  await htmlVideoWorkflow.generateHtmlVideo(buildArgs('generated-image-01-newhash.png'));
  const project2 = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
  const generated2 = (project2.assets || []).filter(asset => asset.source === 'generated');
  assert.strictEqual(generated2.length, 1);
  assert.strictEqual(generated2[0].id, 'gen_scene_01');
  assert.ok(generated2[0].path.includes('newhash'));
  assert.strictEqual(generated2[0].generation.scene_id, 'scene_01');

  console.log('test-generated-image-persist passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
