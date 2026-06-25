const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const frameHtmlAgent = require('../server/services/creative-video/html-video/frameHtmlAgent');
const frameFallbackBuilder = require('../server/services/creative-video/html-video/frameFallbackBuilder');
const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { createEmptyProject, markCheckpointStage, markCheckpointFrame } = require('../server/services/creative-video/html-video/projectSchema');
const { computeSceneSpecSpeechHash } = require('../server/services/creative-video/sceneSpecHash');

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

function changedSceneSpec() {
  const spec = sceneSpec();
  return {
    ...spec,
    scenes: spec.scenes.map(scene => (
      scene.id === 'scene_02'
        ? { ...scene, narration_text: '第二幕旁白已修改', captions: [{ text: '第二幕旁白已修改' }] }
        : scene
    )),
  };
}

function changedVisualSceneSpec() {
  const spec = sceneSpec();
  return {
    ...spec,
    scenes: spec.scenes.map(scene => (
      scene.id === 'scene_02'
        ? { ...scene, visual_text: { ...scene.visual_text, headline: '第二幕视觉标题已修改' } }
        : scene
    )),
  };
}

function stableSceneSpecValue(value) {
  if (Array.isArray(value)) return value.map(stableSceneSpecValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableSceneSpecValue(value[key])]),
  );
}

function computeSceneSpecCheckpointHash(spec = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(stableSceneSpecValue(spec || {}))).digest('hex');
}

function contentGraph(label = '三帧恢复') {
  return {
    synopsis: label,
    nodes: [
      { id: 'scene_01', kind: 'text', text: '第一幕' },
      { id: 'scene_02', kind: 'text', text: '第二幕' },
      { id: 'scene_03', kind: 'text', text: '第三幕' },
    ],
    edges: [
      { from: 'scene_01', to: 'scene_02', kind: 'sequence' },
      { from: 'scene_02', to: 'scene_03', kind: 'sequence' },
    ],
  };
}

function staleContentGraph() {
  return {
    synopsis: '旧内容图',
    nodes: [
      { id: 'old_scene_01', kind: 'text', text: '旧第一幕' },
    ],
    edges: [],
  };
}

function invalidCheckpointHtml() {
  return '<!doctype html><html><head></head><body>bad</body></html>';
}

function spacedAnchorHtml(id = 'scene_01') {
  return [
    '<!doctype html><html><head>',
    '<meta name="viewport" content="width=1080,height=1920,initial-scale=1.0">',
    '<style>html,body{margin:0;width:1080px;height:1920px}</style>',
    '</head><body>',
    `<main data-frame-id="${id}"><h1 data-text-key = 'headline'>标题</h1><p data-text-key = "subtitle">副标题</p><section data-text-key = 'body'>正文</section></main>`,
    '</body></html>',
  ].join('');
}

function commentOnlyAnchorHtml() {
  return [
    '<!doctype html><html><head>',
    '<!-- data-text-key="headline" data-text-key="subtitle" data-text-key="body" -->',
    '<script>const fake = \'data-text-key="headline"\';</script>',
    '<style>.fake:after{content:"data-text-key=\\"body\\""}</style>',
    '</head><body><main>bad</main></body></html>',
  ].join('');
}

async function setupProject(rootDir, workflowId, runId, options = {}) {
  const templateRoot = path.join(rootDir, 'templates');
  await createTemplate(templateRoot);
  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();

  const projectDir = await projectStore.createProjectDir({ rootDir, workflowId, runId });
  const scene01Html = options.scene01Html || (options.badScene01Html ? invalidCheckpointHtml() : validHtml('scene_01', '已完成一'));
  await writeFile(path.join(projectDir, 'frames/01-scene_01.html'), scene01Html);
  await writeFile(path.join(projectDir, 'frames/02-scene_02.html'), validHtml('scene_02', '已完成二'));
  const graph = options.contentGraph || contentGraph();
  const project = createEmptyProject({
    projectId: `${workflowId}_${runId}`,
    workflowId,
    runId,
    contentGraph: graph,
  });
  if (!options.omitTemplateId) {
    project.template_id = options.templateId || 'vertical';
  }
  await writeFile(path.join(projectDir, 'content-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
  if (!options.omitSceneSpecHash) {
    project.generation_checkpoint.scene_spec_hash = options.sceneSpecHash || computeSceneSpecCheckpointHash(sceneSpec());
  }
  markCheckpointStage(project, 'content_graph', {
    status: 'done',
    path: 'content-graph.json',
    output_hash: 'graph-out',
  });
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
  if (options.audio) {
    project.audio = options.audio;
  }
  if (options.downstreamDone) {
    markCheckpointFrame(project, 'render', 'scene_01', {
      status: 'done',
      mp4_path: 'frames/scene_01.mp4',
      output_hash: 'render-1',
    });
    markCheckpointFrame(project, 'render', 'scene_03', {
      status: 'done',
      mp4_path: 'frames/scene_03.mp4',
      output_hash: 'render-3',
    });
    markCheckpointStage(project, 'compose', {
      status: 'done',
      output_path: 'exports/output.mp4',
      output_audio_path: 'exports/output-audio.mp4',
      diagnostic_code: '',
    });
    markCheckpointStage(project, 'duration_verify', {
      status: 'done',
      expected_duration_sec: 6,
      actual_duration_sec: 6,
      diagnostic_code: '',
    });
    markCheckpointStage(project, 'visual_inspect', {
      status: 'done',
      report_path: 'inspect/report.json',
      diagnostic_code: '',
    });
    project.exports = [{ id: 'export_001', path: 'exports/output.mp4', format: 'mp4' }];
    project.render_outputs = [{ path: 'exports/output.mp4' }];
    project.status = 'rendered';
  }
  await projectStore.saveProject(projectDir, project);
  return { projectDir, templateRegistry };
}

async function runWorkflow({ rootDir, workflowId, runId, templateRegistry, aiTextModel, target = {}, services = {}, sceneSpecOverride = null, creativeContextOverride = null }) {
  return workflow.generateHtmlVideo({
    workflowId,
    runId,
    rootDir,
    sceneSpec: sceneSpecOverride || sceneSpec(),
    creativeContext: creativeContextOverride || { input: { raw_text: '三帧恢复测试' } },
    target: { html_video_generation_mode: 'raw_html', generate_audio: false, ...target },
    templateRegistry,
    skipValidation: true,
    services: {
      aiTextModel,
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      ...services,
    },
  });
}

function matchingAudio() {
  const spec = sceneSpec();
  return {
    source: 'scene_spec',
    scene_spec_hash: computeSceneSpecSpeechHash(spec),
    scene_count: spec.scenes.length,
    scene_ids: spec.scenes.map(scene => scene.id),
    status: 'ready',
    narration_path: 'tts/narration.mp3',
    tts_manifest_path: 'tts/audio_manifest.json',
  };
}

function mismatchedAudio() {
  return {
    source: 'scene_spec',
    scene_spec_hash: 'old-hash',
    scene_count: 1,
    scene_ids: ['old_scene'],
    status: 'ready',
    narration_path: 'tts/old-narration.mp3',
    tts_manifest_path: 'tts/old-audio_manifest.json',
  };
}

function assertDownstreamInvalidated(project, sceneId = 'scene_03') {
  const checkpoint = project.generation_checkpoint;
  assert.equal(checkpoint.stages.frame_html.frames.scene_01.status, 'done');
  assert.equal(checkpoint.stages.frame_html.frames.scene_02.status, 'done');
  assert.equal(checkpoint.stages.render.frames.scene_01.status, 'done');
  assert.equal(checkpoint.stages.render.frames[sceneId].status, 'pending');
  assert.equal(checkpoint.stages.render.frames[sceneId].mp4_path, '');
  assert.equal(checkpoint.stages.compose.status, 'pending');
  assert.equal(checkpoint.stages.compose.output_path, '');
  assert.equal(checkpoint.stages.compose.output_audio_path, '');
  assert.equal(checkpoint.stages.duration_verify.status, 'pending');
  assert.notEqual(checkpoint.stages.duration_verify.actual_duration_sec, 6);
  assert.equal(checkpoint.stages.visual_inspect.status, 'pending');
  assert.equal(checkpoint.stages.visual_inspect.report_path, null);
  assert.deepEqual(project.exports, []);
  assert.notEqual(project.status, 'rendered');
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
              throw new Error('resume 不应重新生成 content graph。');
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
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-audio-resume-'));
      const workflowId = '202606260000000005_audio_resume';
      const runId = 'run_audio_resume';
      const { templateRegistry } = await setupProject(rootDir, workflowId, runId, { audio: matchingAudio() });
      let ttsCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => ({ success: true, html: validHtml(args.node.id, args.node.id) });

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        templateRegistry,
        target: { generate_audio: true },
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
            }
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              throw new Error('音频恢复场景不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
        services: {
          ttsService: {
            async synthesizeSceneNarration() {
              ttsCalls += 1;
              throw new Error('resume 已有匹配音频时不应调用 TTS。');
            },
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(ttsCalls, 0);
      assert.equal(result.project.audio.narration_path, 'tts/narration.mp3');
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-audio-current-mismatch-'));
      const workflowId = '202606260000000012_audio_current_mismatch';
      const runId = 'run_audio_current_mismatch';
      const { templateRegistry } = await setupProject(rootDir, workflowId, runId, { audio: matchingAudio() });
      let ttsCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => ({ success: true, html: validHtml(args.node.id, args.node.id) });

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        templateRegistry,
        target: { generate_audio: true },
        creativeContextOverride: {
          input: { raw_text: '三帧恢复测试' },
          audio: mismatchedAudio(),
        },
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
            }
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              throw new Error('音频候选选择场景不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
        services: {
          ttsService: {
            async synthesizeSceneNarration() {
              ttsCalls += 1;
              throw new Error('resume 有匹配音频时不应调用 TTS。');
            },
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(ttsCalls, 0);
      assert.equal(result.project.audio.narration_path, 'tts/narration.mp3');
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-spaced-anchor-'));
      const workflowId = '202606260000000006_spaced_anchor';
      const runId = 'run_spaced_anchor';
      const { templateRegistry } = await setupProject(rootDir, workflowId, runId, { scene01Html: spacedAnchorHtml() });
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
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
              throw new Error('合法空格锚点复用场景不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-comment-anchor-'));
      const workflowId = '202606260000000007_comment_anchor';
      const runId = 'run_comment_anchor';
      const { templateRegistry } = await setupProject(rootDir, workflowId, runId, { scene01Html: commentOnlyAnchorHtml() });
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
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
              throw new Error('注释假锚点场景不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_01', 'scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-changed-script-'));
      const workflowId = '202606260000000008_changed_script';
      const runId = 'run_changed_script';
      const { templateRegistry } = await setupProject(rootDir, workflowId, runId);
      const calls = [];
      let contentGraphCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        templateRegistry,
        sceneSpecOverride: changedSceneSpec(),
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
            }
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              contentGraphCalls += 1;
              return { success: true, text: JSON.stringify(contentGraph('脚本已修改')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(contentGraphCalls, 1);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_01', 'scene_02', 'scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-changed-visual-'));
      const workflowId = '202606260000000011_changed_visual';
      const runId = 'run_changed_visual';
      const visualSpec = changedVisualSceneSpec();
      assert.equal(computeSceneSpecSpeechHash(sceneSpec()), computeSceneSpecSpeechHash(visualSpec));
      const { templateRegistry } = await setupProject(rootDir, workflowId, runId);
      const calls = [];
      let contentGraphCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
      };

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        templateRegistry,
        sceneSpecOverride: visualSpec,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
            }
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              contentGraphCalls += 1;
              return { success: true, text: JSON.stringify(contentGraph('视觉字段已修改')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(contentGraphCalls, 1);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_01', 'scene_02', 'scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-rewrite-interrupt-'));
      const workflowId = '202606260000000013_rewrite_interrupt';
      const runId = 'run_rewrite_interrupt';
      const visualSpec = changedVisualSceneSpec();
      const { templateRegistry, projectDir } = await setupProject(rootDir, workflowId, runId, { downstreamDone: true });
      let contentGraphCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => ({
        success: false,
        message: `模拟 ${args.node.id} 失败`,
        diagnostics: [{
          code: 'frame_html_invalid',
          stage: 'ai-frame-html',
          sub_stage: 'frame_html',
          frame_id: args.node.id,
          user_message: '模拟帧 HTML 失败。',
          retryable: true,
          repair_action: 'retry_frame_html',
        }],
      });

      const result = await runWorkflow({
        rootDir,
        workflowId,
        runId,
        templateRegistry,
        sceneSpecOverride: visualSpec,
        aiTextModel: {
          async callTextModel(request) {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.includes('"template_id"')) {
              return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
            }
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              contentGraphCalls += 1;
              return { success: true, text: JSON.stringify(contentGraph('中断新图')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, false);
      assert.equal(contentGraphCalls, 1);
      const project = await projectStore.loadProject(projectDir);
      assert.equal(project.generation_checkpoint.scene_spec_hash, computeSceneSpecCheckpointHash(visualSpec));
      assert.equal(project.content_graph.synopsis, '中断新图');
      assert.notEqual(project.generation_checkpoint.stages.frame_html.frames.scene_01?.status, 'done');
      assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_02, undefined);
      assert.deepEqual(project.exports, []);
      assert.notEqual(project.status, 'rendered');
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-missing-hash-'));
      const workflowId = '202606260000000009_missing_hash';
      const runId = 'run_missing_hash';
      const { templateRegistry } = await setupProject(rootDir, workflowId, runId, { omitSceneSpecHash: true });
      const calls = [];
      let contentGraphCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
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
              contentGraphCalls += 1;
              return { success: true, text: JSON.stringify(contentGraph('缺 hash 重新生成')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(contentGraphCalls, 1);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_01', 'scene_02', 'scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-missing-template-'));
      const workflowId = '202606260000000010_missing_template';
      const runId = 'run_missing_template';
      const { templateRegistry } = await setupProject(rootDir, workflowId, runId, { omitTemplateId: true });
      const calls = [];
      let contentGraphCalls = 0;
      frameHtmlAgent.generateFrameHtml = async args => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
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
              contentGraphCalls += 1;
              return { success: true, text: JSON.stringify(contentGraph('缺模板重新生成')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(contentGraphCalls, 1);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_01', 'scene_02', 'scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-frame-bad-reuse-'));
      const workflowId = '202606260000000003_bad_frame_reuse';
      const runId = 'run_bad_reuse';
      const { templateRegistry } = await setupProject(rootDir, workflowId, runId, { badScene01Html: true });
      const calls = [];
      frameHtmlAgent.generateFrameHtml = async (args) => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
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
              throw new Error('坏 HTML 复用场景不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_01', 'scene_03']);
    }

    {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-stale-graph-'));
      const workflowId = '202606260000000004_stale_graph';
      const runId = 'run_stale_graph';
      const { templateRegistry } = await setupProject(rootDir, workflowId, runId, { contentGraph: staleContentGraph() });
      const calls = [];
      let contentGraphCalls = 0;
      frameHtmlAgent.generateFrameHtml = async (args) => {
        calls.push(args);
        return { success: true, html: validHtml(args.node.id, args.node.id) };
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
              contentGraphCalls += 1;
              return { success: true, text: JSON.stringify(contentGraph('重新生成内容图')) };
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(contentGraphCalls, 1);
      assert.deepEqual(calls.map(item => item.node.id), ['scene_03']);
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
      const { templateRegistry, projectDir } = await setupProject(rootDir, workflowId, runId, { downstreamDone: true });
      const calls = [];
      let contentGraphCalls = 0;
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
              contentGraphCalls += 1;
              throw new Error('resume fallback 不应重新生成 content graph。');
            }
            throw new Error(`不应调用模型生成帧 HTML：${prompt.slice(0, 40)}`);
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(contentGraphCalls, 0);
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
      assertDownstreamInvalidated(project);
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
