const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const frameHtmlAgent = require('../server/services/creative-video/html-video/frameHtmlAgent');
const frameFallbackBuilder = require('../server/services/creative-video/html-video/frameFallbackBuilder');
const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { createEmptyProject, markCheckpointFrame } = require('../server/services/creative-video/html-video/projectSchema');

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
    '  duration: 6',
    'license:',
    '  commercial_use: true',
    '',
  ].join('\n'));
  await writeFile(path.join(dir, 'index.html'), '<html><body>{{headline}}</body></html>');
}

function validHtml(id, text = id) {
  return [
    '<!doctype html><html><head>',
    '<meta name="viewport" content="width=1080,height=1920,initial-scale=1.0">',
    '<style>html,body{margin:0;width:1080px;height:1920px}@keyframes enter{from{opacity:0}to{opacity:1}}main{animation:enter .4s both}</style>',
    '</head><body>',
    `<main data-frame-id="${id}"><h1 data-text-key="headline">${text}</h1><p data-text-key="subtitle">副标题</p><section data-text-key="body">正文</section></main>`,
    '</body></html>',
  ].join('');
}

function sceneSpec() {
  return {
    title: '帧 HTML 恢复',
    aspect_ratio: '9:16',
    scenes: [
      { id: 'scene_01', duration: 2, narration_text: '第一幕旁白', captions: [{ text: '第一幕旁白' }], visual_text: { headline: '第一幕' } },
      { id: 'scene_02', duration: 2, narration_text: '第二幕旁白', captions: [{ text: '第二幕旁白' }], visual_text: { headline: '第二幕' } },
      { id: 'scene_03', duration: 2, narration_text: '第三幕旁白', captions: [{ text: '第三幕旁白' }], visual_text: { headline: '第三幕' } },
    ],
  };
}

async function setupProject(rootDir, workflowId, runId) {
  const templateRoot = path.join(rootDir, 'templates');
  await createTemplate(templateRoot);
  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();

  const projectDir = await projectStore.createProjectDir({ rootDir, workflowId, runId });
  await writeFile(path.join(projectDir, 'frames/01-scene_01.html'), validHtml('scene_01', '已完成一'));
  await writeFile(path.join(projectDir, 'frames/02-scene_02.html'), validHtml('scene_02', '已完成二'));
  const project = createEmptyProject({ projectId: `${workflowId}_${runId}`, workflowId, runId });
  markCheckpointFrame(project, 'frame_html', 'scene_01', {
    status: 'done',
    html_path: 'frames/01-scene_01.html',
    input_hash: 'in-1',
    output_hash: 'out-1',
  });
  markCheckpointFrame(project, 'frame_html', 'scene_02', {
    status: 'done',
    html_path: 'frames/02-scene_02.html',
    input_hash: 'in-2',
    output_hash: 'out-2',
  });
  markCheckpointFrame(project, 'frame_html', 'scene_03', {
    status: 'failed',
    html_path: '',
    diagnostic_code: 'provider_missing_text',
  });
  await projectStore.saveProject(projectDir, project);
  return { projectDir, templateRegistry };
}

async function runWorkflow({ rootDir, workflowId, runId, templateRegistry, aiTextModel }) {
  return workflow.generateHtmlVideo({
    workflowId,
    runId,
    rootDir,
    sceneSpec: sceneSpec(),
    creativeContext: { input: { raw_text: '三帧恢复测试' } },
    target: { html_video_generation_mode: 'raw_html', generate_audio: false },
    templateRegistry,
    skipValidation: true,
    services: {
      aiTextModel,
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
    },
  });
}

async function main() {
  const originalGenerateFrameHtml = frameHtmlAgent.generateFrameHtml;
  const originalBuildFallbackFrameHtml = frameFallbackBuilder.buildFallbackFrameHtml;
  const originalRender = projectOrchestrator.renderHtmlVideoProject;

  projectOrchestrator.renderHtmlVideoProject = async ({ project, projectDir }) => ({
    success: true,
    project,
    html_video_project_path: projectDir,
    project_dir: projectDir,
    output_path: path.join(projectDir, 'out.mp4'),
    diagnostics: [],
  });

  try {
    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-frame-resume-'));
      const workflowId = '202606260000000001_frame_resume';
      const runId = 'run_resume';
      const { templateRegistry } = await setupProject(rootDir, workflowId, runId);
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async (args) => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, '第三幕') };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        templateRegistry,
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
                  synopsis: '三帧恢复',
                  nodes: [
                    { id: 'scene_01', kind: 'text', text: '第一幕' },
                    { id: 'scene_02', kind: 'text', text: '第二幕' },
                    { id: 'scene_03', kind: 'text', text: '第三幕' },
                  ],
                  edges: [
                    { from: 'scene_01', to: 'scene_02', kind: 'sequence' },
                    { from: 'scene_02', to: 'scene_03', kind: 'sequence' },
                  ],
                }),
              };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].node.id, 'scene_03');
      const project = await projectStore.loadProject(path.join(rootDir, workflowId, 'agent_runs', `${runId}-html-video`));
      assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_01.html_path, 'frames/01-scene_01.html');
      assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_02.html_path, 'frames/02-scene_02.html');
      assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_03.status, 'done');
    }

    {
      const calls = [];
      const result = await originalGenerateFrameHtml({
        model: {
          async callTextModel(request) {
            calls.push(request);
            return { success: true, text: '' };
          },
        },
        frameId: 'scene_03',
        attempt: 2,
        modelOptions: { stream: false },
        shortPrompt: true,
        graph: { nodes: [{ id: 'scene_03', text: '第三幕' }], edges: [] },
        node: { id: 'scene_03', text: '第三幕' },
        index: 2,
        total: 3,
        sceneSpec: sceneSpec(),
        target: { resolution: { width: 1080, height: 1920 } },
      });
      assert.equal(result.success, false);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].stream, false);
      assert.equal(result.diagnostics[0].code, 'provider_missing_text');
      assert.match(calls[0].messages[0].content, /当前帧：scene_03/);
      assert.doesNotMatch(calls[0].messages[0].content, /Source context summary|content graph node|Visual continuity lock/);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-frame-fallback-'));
      const workflowId = '202606260000000002_frame_fallback';
      const runId = 'run_fallback';
      const { templateRegistry, projectDir } = await setupProject(rootDir, workflowId, runId);
      const calls = [];
      const fallbackCalls = [];
      frameHtmlAgent.generateFrameHtml = async (args) => {
        calls.push(args);
        return {
          success: false,
          message: args.attempt === 1 ? '返回结果缺少文本内容。' : '流式返回结果缺少文本内容。',
          diagnostics: [{
            code: 'provider_missing_text',
            stage: 'ai-frame-html',
            sub_stage: 'frame_html',
            frame_id: args.node.id,
            user_message: '返回结果缺少文本内容。',
            retryable: true,
            repair_action: 'retry_frame_html',
          }],
        };
      };
      frameFallbackBuilder.buildFallbackFrameHtml = (args) => {
        fallbackCalls.push(args);
        return originalBuildFallbackFrameHtml(args);
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        templateRegistry,
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
                  synopsis: '三帧 fallback',
                  nodes: [
                    { id: 'scene_01', kind: 'text', text: '第一幕' },
                    { id: 'scene_02', kind: 'text', text: '第二幕' },
                    { id: 'scene_03', kind: 'text', text: '第三幕' },
                  ],
                  edges: [
                    { from: 'scene_01', to: 'scene_02', kind: 'sequence' },
                    { from: 'scene_02', to: 'scene_03', kind: 'sequence' },
                  ],
                }),
              };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].node.id, 'scene_03');
      assert.equal(calls[0].attempt, 1);
      assert.equal(calls[1].node.id, 'scene_03');
      assert.equal(calls[1].attempt, 2);
      assert.deepEqual(calls[1].modelOptions, { stream: false });
      assert.equal(calls[1].shortPrompt, true);
      assert.equal(fallbackCalls.length, 1);
      assert.equal(fallbackCalls[0].scene.id, 'scene_03');

      const project = await projectStore.loadProject(projectDir);
      const frame = project.generation_checkpoint.stages.frame_html.frames.scene_03;
      assert.equal(frame.status, 'done');
      assert.equal(frame.diagnostic_code, 'fallback_frame_html_used');
      const warning = result.diagnostics.find(item => item.code === 'fallback_frame_html_used');
      assert.ok(warning);
      assert.equal(warning.stage, 'ai-frame-html');
      assert.equal(warning.sub_stage, 'frame_html');
      assert.equal(warning.frame_id, 'scene_03');
      assert.equal(warning.severity, 'warning');
      assert.equal(warning.fallback_allowed, true);
      assert.equal(warning.retryable, false);
      assert.equal(warning.user_message, '当前帧 AI 生成连续失败，已使用基础 HTML 兜底。');
      const fallbackHtml = await fs.readFile(path.join(projectDir, frame.html_path), 'utf8');
      assert.match(fallbackHtml, /data-text-key="headline"/);
      assert.match(fallbackHtml, /data-text-key="subtitle"/);
      assert.match(fallbackHtml, /data-text-key="body"/);
    }
  } finally {
    frameHtmlAgent.generateFrameHtml = originalGenerateFrameHtml;
    frameFallbackBuilder.buildFallbackFrameHtml = originalBuildFallbackFrameHtml;
    projectOrchestrator.renderHtmlVideoProject = originalRender;
  }

  console.log('html-video frame html resume tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
