const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const agent = require('../server/services/creative-video/html-video/contentGraphAgent');
const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const aiImageModel = require('../server/services/ai/aiImageModel');

// 测试隔离：生图 phase 的前置检查默认读全局模型配置，本机若配置了 image 模型会让生图链路
// 混入这些集成测试（多一次 planner 的 text 调用，打乱 mock 计数）。统一按未配置处理。
aiImageModel.isConfigured = async () => false;

const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');

function sceneSpec() {
  return {
    title: '内容图重试',
    aspect_ratio: '9:16',
    scenes: [
      {
        id: 'scene_01',
        duration: 2,
        kind: 'text',
        narration_text: '第一幕旁白',
        captions: [{ id: 'cap_01', start: 0, end: 2, duration: 2, text: '第一幕旁白' }],
        visual_text: { headline: '第一幕', keywords: [], cards: [] },
      },
    ],
  };
}

function bindingSceneSpec() {
  return {
    title: '上传素材场景绑定',
    scenes: Array.from({ length: 8 }, (_, index) => ({
      id: `scene_${String(index + 1).padStart(2, '0')}`,
      duration: 2,
      kind: 'text',
    })),
  };
}

function graphTextFor(spec, assetRefs = {}) {
  return JSON.stringify({
    synopsis: '上传素材场景绑定',
    nodes: spec.scenes.map(scene => ({
      id: scene.id,
      kind: 'text',
      label: scene.id,
      durationSec: 2,
      text: scene.id,
      ...(assetRefs[scene.id] ? { asset_refs: assetRefs[scene.id] } : {}),
    })),
    edges: [],
  });
}

async function createRegistry() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-content-graph-retry-'));
  return { rootDir };
}

async function main() {
  const trailingComma = agent.parseContentGraphResponse([
    '```json',
    '{',
    '  "synopsis": "尾逗号",',
    '  "nodes": [',
    '    { "id": "scene_01", "kind": "text", "label": "第一幕", "durationSec": 2, "text": "第一幕", },',
    '  ],',
    '  "edges": [],',
    '}',
    '```',
  ].join('\n'), sceneSpec());
  assert.equal(trailingComma.success, true);
  assert.deepEqual(trailingComma.graph.nodes.map(node => node.id), ['scene_01']);

  const explicitSpec = bindingSceneSpec();
  const explicitAssets = [
    { id: 'upload_s02', file_name: 'S02.png', requirement: 'required' },
    { id: 'upload_s07', file_name: 'S07.png', requirement: 'required' },
    { id: 'upload_s08', file_name: 'S08.png', requirement: 'required' },
    { id: 'upload_existing', file_name: 'existing.png', requirement: 'required' },
    { id: 'upload_ambiguous', file_name: 'ambiguous.png', requirement: 'required' },
    { id: 'upload_missing', file_name: 'missing.png', requirement: 'required' },
    { id: 'upload_multi', file_name: 'multi.png', requirement: 'required' },
    { id: 'upload_unknown', file_name: 'unknown.png', requirement: 'required' },
    { id: 'upload_generated', file_name: 'generated.png', requirement: 'required', generation: { scene_id: 'scene_03' } },
    { id: 'article_required', file_name: 'article.png', requirement: 'required' },
    { id: 'upload_duplicate_a', file_name: 'duplicate.png', requirement: 'required' },
    { id: 'upload_duplicate_b', file_name: 'duplicate.png', requirement: 'required' },
    { id: 'upload_short', file_name: 'chart.png', requirement: 'required' },
    { id: 'upload_optional_long', file_name: 'dashboard-chart.png', requirement: 'preferred' },
  ];
  const explicitContext = {
    input: {
      raw_text: [
        'S02 使用 S02.png。',
        'S07 展示 S07.png；Scene 8 展示 S08.png。',
        'S02 不得覆盖 existing.png。',
        'S02 与 S07 同时提到 ambiguous.png。',
        '这里提到 missing.png 但没有场景。',
        'S02 使用 multi.png；S07 再次使用 multi.png。',
        'S09 使用 unknown.png。',
        'S03 使用 generated.png。S04 使用 article.png。',
        'S03 使用 duplicate.png。S04 使用 dashboard-chart.png。',
      ].join('\n'),
      source_hint: 'Scene 8 展示 S08.png；Scene 8 展示 S08.png。',
    },
    asset_context: { assets: explicitAssets },
  };
  const explicitBinding = await workflow.generateContentGraphWithRetry({
    sceneSpec: explicitSpec,
    creativeContext: explicitContext,
    model: {
      async callTextModel() {
        return { success: true, text: graphTextFor(explicitSpec, {
          scene_01: [{ asset_id: 'upload_existing', usage: 'showcase', reason: '模型已有引用' }],
        }) };
      },
    },
  });
  assert.equal(explicitBinding.success, true);
  const refsByScene = Object.fromEntries(explicitBinding.contentGraph.nodes.map(node => [node.id, node.asset_refs || []]));
  assert.deepEqual(refsByScene.scene_02, [{ asset_id: 'upload_s02', usage: 'subject', reason: '用户明确指定用于该场景' }]);
  assert.deepEqual(refsByScene.scene_07, [{ asset_id: 'upload_s07', usage: 'subject', reason: '用户明确指定用于该场景' }]);
  assert.deepEqual(refsByScene.scene_08, [{ asset_id: 'upload_s08', usage: 'subject', reason: '用户明确指定用于该场景' }]);
  assert.deepEqual(refsByScene.scene_04, [], 'optional 长文件名完整命中时，不得误绑定其内部的 required 短文件名');
  assert.deepEqual(refsByScene.scene_01, [{ asset_id: 'upload_existing', usage: 'showcase', reason: '模型已有引用' }]);
  assert.deepEqual(
    explicitBinding.contentGraph.nodes.flatMap(node => node.asset_refs || []).map(ref => ref.asset_id).sort(),
    ['upload_existing', 'upload_s02', 'upload_s07', 'upload_s08'],
    '同名、短名包含、Scene 歧义/缺失/不存在、生成素材和非 upload 均不得猜测绑定',
  );

  for (const [rawText, shouldBind] of [
    ['S01 使用 dashboard-chart.png。', false],
    ['S01 中文使用chart.png。', true],
  ]) {
    const tokenBoundary = await workflow.generateContentGraphWithRetry({
      sceneSpec: sceneSpec(),
      creativeContext: {
        input: { raw_text: rawText },
        asset_context: { assets: [{ id: 'upload_chart_only', file_name: 'chart.png', requirement: 'required' }] },
      },
      model: { async callTextModel() { return { success: true, text: graphTextFor(sceneSpec()) }; } },
    });
    assert.equal(tokenBoundary.success, true);
    assert.equal(
      tokenBoundary.contentGraph.nodes[0].asset_refs?.[0]?.asset_id || '',
      shouldBind ? 'upload_chart_only' : '',
      'file_name 只有在前后没有紧邻 ASCII 文件名字符时才是独立精确命中',
    );
  }

  const preferredAssets = Array.from({ length: 4 }, (_, index) => ({ id: `preferred_${index + 1}` }));
  const requiredPriority = await workflow.generateContentGraphWithRetry({
    sceneSpec: sceneSpec(),
    creativeContext: {
      input: { raw_text: 'S01 使用 required-priority.png。' },
      asset_context: {
        assets: [
          ...preferredAssets,
          { id: 'upload_required_priority', file_name: 'required-priority.png', requirement: 'required' },
        ],
      },
    },
    model: {
      async callTextModel() {
        return {
          success: true,
          text: graphTextFor(sceneSpec(), {
            scene_01: preferredAssets.map(asset => ({
              asset_id: asset.id, usage: 'showcase', reason: asset.id,
            })),
          }),
        };
      },
    },
  });
  assert.equal(requiredPriority.success, true);
  assert.deepEqual(requiredPriority.contentGraph.nodes[0].asset_refs, [
    { asset_id: 'upload_required_priority', usage: 'subject', reason: '用户明确指定用于该场景' },
    ...preferredAssets.slice(0, 3).map(asset => ({ asset_id: asset.id, usage: 'showcase', reason: asset.id })),
  ], 'required 必须优先保留，原有 optional 按模型顺序补位到总计 4 张');

  for (const fallbackMode of ['provider_failed', 'invalid_json']) {
    let calls = 0;
    const fallback = await workflow.generateContentGraphWithRetry({
      sceneSpec: explicitSpec,
      creativeContext: {
        input: { raw_text: 'Scene 8 使用 fallback.png。' },
        asset_context: { assets: [{ id: `upload_${fallbackMode}`, file_name: 'fallback.png', requirement: 'required' }] },
      },
      model: {
        async callTextModel() {
          calls += 1;
          return calls === 1
            ? { success: false, message: '返回结果缺少文本内容。' }
            : fallbackMode === 'invalid_json'
              ? { success: true, text: '{bad json' }
              : { success: false, message: '返回结果缺少文本内容。' };
        },
      },
    });
    assert.equal(fallback.success, true);
    assert.deepEqual(fallback.contentGraph.nodes.find(node => node.id === 'scene_08').asset_refs, [
      { asset_id: `upload_${fallbackMode}`, usage: 'subject', reason: '用户明确指定用于该场景' },
    ]);
  }

  const capacityAssets = Array.from({ length: 5 }, (_, index) => ({
    id: `upload_capacity_${index + 1}`,
    file_name: `capacity-${index + 1}.png`,
    requirement: 'required',
  }));
  const capacityContext = {
    input: { raw_text: `S01 使用 ${capacityAssets.map(asset => asset.file_name).join('、')}。` },
    asset_context: { assets: capacityAssets },
  };
  const capacityRefs = capacityAssets.slice(0, 3).map(asset => ({
    asset_id: asset.id, usage: 'subject', reason: '模型已有引用',
  }));
  const modelCapacity = await workflow.generateContentGraphWithRetry({
    sceneSpec: sceneSpec(),
    creativeContext: capacityContext,
    model: { async callTextModel() { return { success: true, text: graphTextFor(sceneSpec(), { scene_01: capacityRefs }) }; } },
  });
  assert.equal(modelCapacity.success, false);
  assert.equal(modelCapacity.contentGraph, undefined, '容量失败不得产出超过 4 张 refs 的 Graph');
  const modelCapacityDiagnostic = modelCapacity.diagnostics.find(item => item.code === 'required_asset_scene_capacity_exceeded');
  assert.deepEqual(modelCapacityDiagnostic.details, {
    scene_id: 'scene_01',
    asset_ids: capacityAssets.map(asset => asset.id),
    max_assets: 4,
  });
  assert.equal(modelCapacityDiagnostic.retryable, false);
  assert.equal(modelCapacityDiagnostic.fallback_allowed, false);

  let capacityFallbackCalls = 0;
  const fallbackCapacity = await workflow.generateContentGraphWithRetry({
    sceneSpec: sceneSpec(),
    creativeContext: capacityContext,
    model: {
      async callTextModel() {
        capacityFallbackCalls += 1;
        return { success: false, message: '返回结果缺少文本内容。' };
      },
    },
  });
  assert.equal(capacityFallbackCalls, 2);
  assert.equal(fallbackCapacity.success, false);
  assert.equal(fallbackCapacity.contentGraph, undefined);
  assert.equal(fallbackCapacity.diagnostics[0].code, 'required_asset_scene_capacity_exceeded');
  assert.equal(fallbackCapacity.diagnostics[0].retryable, false);
  assert.equal(fallbackCapacity.diagnostics[0].fallback_allowed, false);

  const capacitySetup = await createRegistry();
  const capacityWorkflowAssets = [];
  for (const asset of capacityAssets) {
    const localPath = path.join(capacitySetup.rootDir, asset.file_name);
    await fs.writeFile(localPath, asset.id, 'utf8');
    capacityWorkflowAssets.push({ ...asset, local_path: localPath });
  }
  const capacityWorkflow = await workflow.generateHtmlVideo({
    workflowId: '202606260000000003_content_graph_capacity',
    runId: 'run_content_graph_capacity',
    rootDir: capacitySetup.rootDir,
    sceneSpec: sceneSpec(),
    creativeContext: {
      ...capacityContext,
      asset_context: { assets: capacityWorkflowAssets },
    },
    target: { generate_audio: false },
    skipValidation: true,
    services: {
      aiTextModel: {
        async callTextModel() {
          return { success: true, text: graphTextFor(sceneSpec(), { scene_01: capacityRefs }) };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
    },
  });
  assert.equal(capacityWorkflow.success, false);
  const normalizedCapacityDiagnostic = capacityWorkflow.html_video_diagnostics
    .find(item => item.code === 'required_asset_scene_capacity_exceeded');
  assert.equal(normalizedCapacityDiagnostic.retryable, false, 'htmlVideoWorkflow normalize 必须保留 retryable=false');
  assert.equal(normalizedCapacityDiagnostic.fallback_allowed, false, 'htmlVideoWorkflow normalize 必须保留 fallback_allowed=false');

  const retryInvalidCalls = [];
  const retryInvalid = await workflow.generateContentGraphWithRetry({
    sceneSpec: sceneSpec(),
    creativeContext: { input: { raw_text: '第二次坏 JSON 也需要 fallback' } },
    target: { duration_sec: 2 },
    model: {
      async callTextModel(request) {
        retryInvalidCalls.push(request);
        if (retryInvalidCalls.length === 1) {
          return { success: false, message: '返回结果缺少文本内容。' };
        }
        return { success: true, text: '{bad json' };
      },
    },
  });
  assert.equal(retryInvalid.success, true);
  assert.equal(retryInvalidCalls.length, 2);
  assert.equal(retryInvalidCalls[1].stream, false);
  assert.deepEqual(retryInvalid.contentGraph.nodes.map(node => node.id), ['scene_01']);

  const mismatchRetryCalls = [];
  const mismatchRetry = await workflow.generateContentGraphWithRetry({
    sceneSpec: sceneSpec(),
    creativeContext: { input: { raw_text: '第一次多出节点，第二次按 scene_spec 修正' } },
    target: { duration_sec: 2 },
    model: {
      async callTextModel(request) {
        mismatchRetryCalls.push(request);
        if (mismatchRetryCalls.length === 1) {
          return {
            success: true,
            text: JSON.stringify({
              synopsis: '多出节点',
              nodes: [
                { id: 'scene_01', kind: 'text', label: '第一幕', durationSec: 2, text: '第一幕' },
                { id: 'scene_02', kind: 'text', label: '多余', durationSec: 2, text: '多余' },
              ],
              edges: [{ from: 'scene_01', to: 'scene_02', kind: 'sequence' }],
            }),
          };
        }
        return {
          success: true,
          text: JSON.stringify({
            synopsis: '已修正',
            nodes: [
              { id: 'scene_01', kind: 'text', label: '第一幕', durationSec: 2, text: '第一幕' },
            ],
            edges: [],
          }),
        };
      },
    },
  });
  assert.equal(mismatchRetry.success, true);
  assert.equal(mismatchRetryCalls.length, 2);
  assert.equal(mismatchRetryCalls[1].stream, false);
  assert.match(mismatchRetryCalls[1].messages[0].content, /scene ids: scene_01/);
  assert.deepEqual(mismatchRetry.contentGraph.nodes.map(node => node.id), ['scene_01']);
  assert.ok(mismatchRetry.diagnostics.some(item => item.code === 'content_graph_scene_spec_mismatch'));

  const retrySetup = await createRegistry();
  const retryGraphCalls = [];
  const retryRender = projectOrchestrator.renderHtmlVideoProject;
  projectOrchestrator.renderHtmlVideoProject = async ({ project, projectDir }) => ({
    success: true,
    project,
    html_video_project_path: projectDir,
    project_dir: projectDir,
    output_path: path.join(projectDir, 'out.mp4'),
    diagnostics: [],
  });
  try {
    const result = await workflow.generateHtmlVideo({
      workflowId: '202606260000000001_content_graph_retry',
      runId: 'run_content_graph_retry',
      rootDir: retrySetup.rootDir,
      sceneSpec: sceneSpec(),
      creativeContext: { input: { raw_text: '空内容需要重试后 fallback' } },
      target: { generate_audio: false },
      skipValidation: true,
      services: {
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.includes('当前帧：scene_01')) {
              return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">第一幕</h1></main></body></html>' };
            }
            retryGraphCalls.push({ prompt, request });
            return { success: false, message: '返回结果缺少文本内容。' };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      },
    });
    assert.equal(result.success, true);
    assert.equal(retryGraphCalls.length, 2);
    assert.equal(retryGraphCalls[1].request.stream, false);
    assert.ok(retryGraphCalls[1].prompt.length < retryGraphCalls[0].prompt.length);
    assert.deepEqual(result.project.content_graph.nodes.map(node => node.id), ['scene_01']);
    assert.equal(result.project.generation_checkpoint.stages.content_graph.status, 'done');
    assert.ok(result.project.generation_checkpoint.stages.content_graph.path);
    assert.ok(result.project.generation_checkpoint.stages.content_graph.output_hash);
    assert.equal(result.html_video_diagnostics.some(item => item.repair_action === 'fallback_scene_spec_graph'), false);
  } finally {
    projectOrchestrator.renderHtmlVideoProject = retryRender;
  }

  const mismatchSetup = await createRegistry();
  const mismatchRender = projectOrchestrator.renderHtmlVideoProject;
  let mismatchRenderCalls = 0;
  projectOrchestrator.renderHtmlVideoProject = async ({ project, projectDir }) => {
    mismatchRenderCalls += 1;
    return {
      success: true,
      project,
      html_video_project_path: projectDir,
      project_dir: projectDir,
      output_path: path.join(projectDir, 'out.mp4'),
      diagnostics: [],
    };
  };
  try {
    const result = await workflow.generateHtmlVideo({
      workflowId: '202606260000000002_content_graph_mismatch',
      runId: 'run_content_graph_mismatch',
      rootDir: mismatchSetup.rootDir,
      sceneSpec: sceneSpec(),
      creativeContext: { input: { raw_text: '首次普通 mismatch 只 warning' } },
      target: { generate_audio: false },
      skipValidation: true,
      services: {
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: '多出节点',
                  nodes: [
                    { id: 'scene_01', kind: 'text', label: '第一幕', durationSec: 2, text: '第一幕' },
                    { id: 'scene_02', kind: 'text', label: '第二幕', durationSec: 2, text: '第二幕' },
                  ],
                  edges: [{ from: 'scene_01', to: 'scene_02', kind: 'sequence' }],
                }),
              };
            }
            return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01"><h1 data-text-key="headline">第一幕</h1></main></body></html>' };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      },
    });
    assert.equal(result.success, false);
    assert.match(result.message, /画面结构与旁白脚本不一致/);
    assert.equal(mismatchRenderCalls, 0);
    const mismatch = result.html_video_diagnostics.find(item => item.code === 'content_graph_scene_spec_mismatch');
    assert.ok(mismatch);
    assert.equal(mismatch.fallback_allowed, false);
    assert.equal(mismatch.repair_action, 'retry_content_graph');
    assert.equal(result.html_video_diagnostics.some(item => item.repair_action === 'fallback_scene_spec_graph'), false);
  } finally {
    projectOrchestrator.renderHtmlVideoProject = mismatchRender;
  }
}

main().then(() => {
  console.log('html-video content graph retry tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
