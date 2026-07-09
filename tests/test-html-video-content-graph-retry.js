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
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function createTemplate(rootDir) {
  const dir = path.join(rootDir, 'vertical');
  await writeFile(path.join(dir, 'template.html-video.yaml'), [
    'id: vertical',
    'name: 竖屏模板',
    'engine: hyperframes',
    'source_entry: index.html',
    'output:',
    '  resolution:',
    '    width: 1080',
    '    height: 1920',
    '  fps: 24',
    '  duration: 4',
    'inputs:',
    '  schema:',
    '    type: object',
    '    properties:',
    '      headline:',
    '        type: string',
    'license:',
    '  commercial_use: true',
    '',
  ].join('\n'));
  await writeFile(path.join(dir, 'index.html'), '<html><body>{{headline}}</body></html>');
}

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

async function createRegistry() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-content-graph-retry-'));
  const templateRoot = path.join(rootDir, 'templates');
  await createTemplate(templateRoot);
  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();
  return { rootDir, templateRegistry };
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
      target: { html_video_generation_mode: 'raw_html', generate_audio: false },
      templateRegistry: retrySetup.templateRegistry,
      skipValidation: true,
      services: {
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
            }
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
      target: { html_video_generation_mode: 'raw_html', generate_audio: false },
      templateRegistry: mismatchSetup.templateRegistry,
      skipValidation: true,
      services: {
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
            }
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
