const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const aiImageModel = require('../server/services/ai/aiImageModel');

// 测试隔离：本机若配置了 image 模型，生图链路会混入本测试的 mock 计数，统一按未配置处理。
aiImageModel.isConfigured = async () => false;

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { matchScenesToTemplates } = require('../server/services/creative-video/html-video/sceneTemplateMatcher');
const { buildMixedFrameProject } = require('../server/services/creative-video/html-video/mixedFrameBuilder');
const { validateHtmlVideoProject } = require('../server/services/creative-video/html-video/validationGate');
const { validateTemplateInputs } = require('../server/services/creative-video/html-video/templateInputAgent');
const { resolveFrameRenderSource } = require('../server/services/creative-video/html-video/frameRenderSource');
const { resolveGenerationMode } = require('../server/services/creative-video/html-video/htmlVideoWorkflow');

(async () => {
  assert.equal(resolveGenerationMode({}), 'per_scene');
  assert.equal(resolveGenerationMode({ html_video_generation_mode: 'per_scene' }), 'per_scene');
  assert.equal(resolveGenerationMode({ html_video_generation_mode: 'raw_html' }), 'raw_html');
  assert.equal(resolveGenerationMode({ htmlVideoGenerationMode: 'template_inputs' }), 'template_inputs');

  const registry = createTemplateRegistry();
  registry.scanTemplates();
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-per-scene-'));

  const sceneSpec = {
    scenes: [
      {
        id: 'scene_data',
        kind: 'data',
        duration_sec: 4,
        narration_text: '核心指标达到 88.6%。',
        visual_text: { headline: '核心指标 88.6%', keywords: ['核心指标'], cards: ['核心指标 88.6%'] },
      },
      {
        id: 'scene_quote',
        kind: 'quote',
        duration_sec: 5,
        narration_text: '保持专注。',
        visual_text: { headline: '保持专注', cards: ['保持专注'] },
      },
      {
        id: 'scene_free',
        kind: 'unknown',
        duration_sec: 3,
        narration_text: '没有对应模板的自由场景。',
        visual_text: { headline: '自由内容' },
      },
    ],
  };

  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'frames/03-scene_free.html'),
    '<!doctype html><html><head><style>body{width:1920px;height:1080px}</style></head><body><main data-text-key="headline">自由内容</main><p data-text-key="subtitle">字幕</p><p data-text-key="body">正文</p></body></html>',
    'utf8',
  );

  const graph = {
    nodes: [
      { id: 'node_data', scene_id: 'scene_data', durationSec: 4 },
      { id: 'node_quote', scene_id: 'scene_quote', durationSec: 5 },
      { id: 'node_free', scene_id: 'scene_free', durationSec: 3, html_path: 'frames/03-scene_free.html' },
    ],
    edges: [
      { from: 'node_data', to: 'node_quote', kind: 'sequence' },
      { from: 'node_quote', to: 'node_free', kind: 'sequence' },
    ],
  };

  const decisions = matchScenesToTemplates({
    scenes: sceneSpec.scenes,
    registry,
    renderTarget: { aspectRatio: '16:9' },
  });
  assert.equal(decisions.get('scene_data').source_mode, 'template_inputs');
  assert.equal(decisions.get('scene_data').template_id, 'frame-pentagram-stat');
  assert.equal(decisions.get('scene_quote').source_mode, 'template_inputs');
  assert.equal(decisions.get('scene_quote').template_id, 'frame-electric-studio');
  assert.equal(decisions.get('scene_free').source_mode, 'raw_html');

  const project = await buildMixedFrameProject({
    projectDir,
    workflowId: 'wf',
    runId: 'run',
    graph,
    sceneSpec,
    target: { aspect_ratio: '16:9', resolution: { width: 1920, height: 1080 }, fps: 30 },
    registry,
    decisions,
    mediaOptions: { generateCaptions: false },
  });

  assert.equal(project.template_id, null);
  const dataFrame = project.frames.find(frame => frame.id === 'scene_data');
  const quoteFrame = project.frames.find(frame => frame.id === 'scene_quote');
  const freeFrame = project.frames.find(frame => frame.id === 'scene_free');

  assert.equal(dataFrame.source_mode, 'template_inputs');
  assert.equal(dataFrame.template_id, 'frame-pentagram-stat');
  assert.equal(dataFrame.html_path, null);
  assert.equal(validateTemplateInputs(dataFrame.inputs, registry.getTemplate(dataFrame.template_id)).success, true);

  assert.equal(quoteFrame.source_mode, 'template_inputs');
  assert.equal(quoteFrame.template_id, 'frame-electric-studio');
  assert.equal(quoteFrame.html_path, null);
  assert.equal(validateTemplateInputs(quoteFrame.inputs, registry.getTemplate(quoteFrame.template_id)).success, true);

  assert.equal(freeFrame.source_mode, 'raw_html');
  assert.equal(freeFrame.template_id, null);
  assert.equal(freeFrame.html_path, 'frames/03-scene_free.html');
  assert.ok(freeFrame.fallback_reason);

  const validation = await validateHtmlVideoProject({
    project,
    projectDir,
    templateRegistry: registry,
    environment: { ok: true, diagnostics: [] },
    options: { commercialOnly: true },
  });
  assert.equal(validation.ok, true);
  assert.ok(!validation.diagnostics.some(item => item.code === 'template_missing'));

  const templateSource = resolveFrameRenderSource({ projectDir, project, frame: dataFrame });
  assert.equal(templateSource.needs_materialize, true);
  assert.equal(templateSource.template_id, 'frame-pentagram-stat');
  const rawSource = resolveFrameRenderSource({ projectDir, project, frame: freeFrame });
  assert.equal(rawSource.needs_materialize, false);
  assert.equal(rawSource.html_path, 'frames/03-scene_free.html');

  // 端到端：generateHtmlVideo（per_scene）必须把 beat 级视觉计划与路由决策持久化进 project。
  const workflowRootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-per-scene-workflow-'));
  const workflowSceneSpec = {
    title: '逐场景视觉计划',
    aspect_ratio: '16:9',
    scenes: sceneSpec.scenes,
  };
  const originalRenderHtmlVideoProject = projectOrchestrator.renderHtmlVideoProject;
  projectOrchestrator.renderHtmlVideoProject = async ({ project: renderProject, projectDir: renderProjectDir }) => ({
    success: true,
    message: 'mock render success',
    project: renderProject,
    project_dir: renderProjectDir,
    html_video_project_path: renderProjectDir,
    output_path: path.join(renderProjectDir, 'exports', 'output.mp4'),
    diagnostics: [],
  });
  let result;
  try {
    result = await workflow.generateHtmlVideo({
      workflowId: 'wf-per-scene-visual-plan',
      runId: 'run-per-scene-visual-plan',
      rootDir: workflowRootDir,
      sceneSpec: workflowSceneSpec,
      creativeContext: { input: { raw_text: '逐场景视觉计划' } },
      target: { generateAudio: false, generateCaptions: false },
      templateRegistry: registry,
      skipValidation: true,
      services: {
        aiTextModel: {
          callTextModel: async request => {
            const prompt = request.messages.map(item => item.content).join('\n');
            if (prompt.startsWith('你是 html-video 的 content graph')) {
              return {
                success: true,
                text: JSON.stringify({
                  synopsis: '逐场景视觉计划',
                  nodes: workflowSceneSpec.scenes.map(scene => ({
                    id: scene.id,
                    kind: scene.kind,
                    label: scene.visual_text.headline,
                    durationSec: scene.duration_sec,
                    text: scene.narration_text,
                  })),
                  edges: workflowSceneSpec.scenes.slice(1).map((scene, index) => ({
                    from: workflowSceneSpec.scenes[index].id,
                    to: scene.id,
                    kind: 'sequence',
                  })),
                }),
              };
            }
            const frameId = request.audit?.frame_id || 'scene_free';
            return {
              success: true,
              text: `<!doctype html><html><body><main data-frame-id="${frameId}"><h1 data-text-key="headline">自由内容</h1><p data-text-key="subtitle">字幕</p><section data-text-key="body">正文</section></main></body></html>`,
            };
          },
        },
        environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      },
    });
  } finally {
    projectOrchestrator.renderHtmlVideoProject = originalRenderHtmlVideoProject;
  }
  assert.equal(result.success, true, JSON.stringify({
    message: result.message,
    diagnostics: result.html_video_diagnostics,
  }, null, 2));
  assert.ok(result.project.visual_plan);
  assert.ok(Array.isArray(result.project.visual_plan.beats));
  assert.ok(result.project.visual_plan.beats.length >= workflowSceneSpec.scenes.length);
  assert.ok(result.project.visual_plan.beats.every(beat => !('source_scene' in beat)));
  assert.ok(result.project.visual_plan.style_profile && result.project.visual_plan.style_profile.id);
  assert.ok(Array.isArray(result.project.render_decisions));
  assert.ok(result.project.render_decisions.length >= result.project.frames.length);
  assert.ok(result.project.render_decisions.every(item => item.beat_id || item.scene_id));

  // 持久化校验：project.json 落盘后经 normalizeProject 仍保留两个新字段。
  const savedProject = JSON.parse(await fs.readFile(path.join(result.html_video_project_path, 'project.json'), 'utf8'));
  assert.ok(Array.isArray(savedProject.visual_plan.beats));
  assert.ok(savedProject.visual_plan.beats.every(beat => !('source_scene' in beat)));
  assert.ok(Array.isArray(savedProject.render_decisions));
  assert.ok(savedProject.render_decisions.length >= savedProject.frames.length);

  console.log('html-video per-scene routing tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
