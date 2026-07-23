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

async function runWithRoot(rootDir) {
  const projectJsonPath = path.join(rootDir, 'wf-test', 'agent_runs', 'run-test-html-video', 'project.json');

  const buildArgs = fileName => ({
    workflowId: 'wf-test',
    runId: 'run-test',
    rootDir,
    sceneSpec,
    creativeContext: { asset_context: { assets: [] } },
    target: { aspect_ratio: '9:16', maxAiGeneratedImages: 9 },
    skipValidation: true,
    services: {
      generatedImagePlanner: {
        planGeneratedImages: async ({ maxScenes }) => {
          assert.strictEqual(maxScenes, 9, '工作流 target 中的生图上限必须传给生图规划器');
          return {
            success: true,
            plans: [{ scene_id: 'scene_01', generation_prompt: '深夜骑手主视觉' }],
          };
        },
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
  assert.deepStrictEqual({
    media_type: generated[0].media_type,
    origin: generated[0].origin,
    origin_detail: generated[0].origin_detail,
    provider: generated[0].provider,
    requirement: generated[0].requirement,
    evidence_class: generated[0].evidence_class,
    status: generated[0].status,
    mime: generated[0].mime,
    bytes: generated[0].bytes,
  }, {
    media_type: 'image',
    origin: 'ai_generated',
    origin_detail: 'scene_main_visual',
    provider: '',
    requirement: 'optional',
    evidence_class: 'synthetic',
    status: 'ready',
    mime: 'image/png',
    bytes: 3,
  });

  fs.unlinkSync(path.join(rootDir, 'wf-test', 'agent_runs', 'run-test-html-video', generated[0].path));
  await htmlVideoWorkflow.generateHtmlVideo(buildArgs('generated-image-01-newhash.png'));
  const project2 = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
  const generated2 = (project2.assets || []).filter(asset => asset.source === 'generated');
  assert.strictEqual(generated2.length, 1);
  assert.strictEqual(generated2[0].id, 'gen_scene_01');
  assert.ok(generated2[0].path.includes('newhash'));
  assert.strictEqual(generated2[0].generation.scene_id, 'scene_01');

  // 场景三：复用旧 content graph + 其引用的 generated 文件丢失 → requiredSceneIds 兜底按同 id 补回
  // 手工注入引用 gen_scene_01 的 content_graph，删掉图片文件，再以 reuseContentGraph 重跑；
  // planner 故意返回空计划，验证补回走的是 requiredSceneIds 兜底而不是 planner
  const project3Before = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
  project3Before.content_graph = {
    synopsis: 't',
    nodes: [{
      id: 'scene_01',
      kind: 'text',
      label: '深夜骑手',
      durationSec: 5,
      text: '深夜骑手',
      asset_refs: [{ asset_id: 'gen_scene_01', usage: 'subject', reason: 'r' }],
    }],
    edges: [],
  };
  fs.writeFileSync(projectJsonPath, JSON.stringify(project3Before));
  fs.unlinkSync(path.join(rootDir, 'wf-test', 'agent_runs', 'run-test-html-video', generated2[0].path));
  const args3 = buildArgs('generated-image-01-refill.png');
  args3.reuseContentGraph = true;
  args3.services.generatedImagePlanner = {
    planGeneratedImages: async () => ({ success: true, plans: [] }),
  };
  await htmlVideoWorkflow.generateHtmlVideo(args3);
  const project3 = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
  const generated3 = (project3.assets || []).filter(asset => asset.source === 'generated');
  assert.strictEqual(generated3.length, 1);
  assert.strictEqual(generated3[0].id, 'gen_scene_01');
  assert.ok(generated3[0].path.includes('refill'), `path 应指向补回的新文件，实际 ${generated3[0].path}`);
  assert.strictEqual(generated3[0].generation.scene_id, 'scene_01');
}

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-image-persist-test-'));
  try {
    await runWithRoot(rootDir);
  } finally {
    const resolvedTemp = path.resolve(os.tmpdir());
    const resolvedRoot = path.resolve(rootDir);
    const relative = path.relative(resolvedTemp, resolvedRoot);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), '清理目标必须位于系统临时目录内');
    assert.ok(path.basename(resolvedRoot).startsWith('gen-image-persist-test-'), '清理目标必须属于本测试前缀');
    fs.rmSync(resolvedRoot, { recursive: true, force: true });
  }
  console.log('test-generated-image-persist passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
