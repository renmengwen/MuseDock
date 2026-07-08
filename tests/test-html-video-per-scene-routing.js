const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

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

  console.log('html-video per-scene routing tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
