const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { runFrameHtmlPhase } = require('../server/services/creative-video/html-video/frameHtmlPhase');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { createEmptyProject } = require('../server/services/creative-video/html-video/projectSchema');

const validHtml = '<!doctype html><html><head><meta name="viewport" content="width=1920,height=1080"><style>html,body{width:1920px;height:1080px;margin:0}@keyframes enter{from{opacity:0}to{opacity:1}}main{animation:enter .3s}</style></head><body data-hv-canvas data-width="1920" data-height="1080"><main><h1 data-text-key="headline">标题</h1><p data-text-key="subtitle">副标题</p><section data-text-key="body">正文</section></main></body></html>';

(async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-layout-blocking-'));
  const contentGraph = {
    nodes: [{ id: 'scene_01', scene_id: 'scene_01', kind: 'text', durationSec: 2 }],
    edges: [],
  };
  const project = createEmptyProject({
    projectId: 'layout-blocking',
    workflowId: 'wf-layout-blocking',
    runId: 'run-layout-blocking',
    contentGraph,
  });
  project.visual_plan = { beats: [], style_profile: null };
  await projectStore.saveProject(projectDir, project);

  let modelCalls = 0;
  let qaCalls = 0;
  const result = await runFrameHtmlPhase({
    model: {
      async callTextModel() {
        modelCalls += 1;
        return { success: true, text: validHtml };
      },
    },
    projectDir,
    project,
    contentGraph,
    sceneSpec: {
      scenes: [{ id: 'scene_01', duration_sec: 2, narration_text: '旁白', visual_text: { headline: '标题' } }],
    },
    creativeContext: {},
    templateRenderTarget: { resolution: { width: 1920, height: 1080 } },
    mediaOptions: { generateCaptions: false },
    frameHtmlConcurrency: 1,
    resumeAllowed: false,
    regenerateFrameHtmlRequested: false,
    runLayoutQa: true,
    layoutQaService: {
      async inspectFrameHtmlLayout() {
        qaCalls += 1;
        return {
          success: false,
          issues: [{ code: 'text_overlap', message: '文本互相遮挡', severity: 'error' }],
        };
      },
    },
    onProgress: null,
    diagnostics: [],
    report: async () => {},
    objectOrEmpty: value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
    sha256: value => crypto.createHash('sha256').update(String(value || '')).digest('hex'),
    failure: (message, diagnostics, extra = {}) => ({ success: false, message, diagnostics, ...extra }),
    shouldReuseFrameHtml: () => ({ reuse: false }),
    invalidateFrameHtmlDependents: () => {},
    templateRoutingDecisions: new Map(),
  });

  assert.equal(modelCalls, 2, '首版和布局修复版应各生成一次');
  assert.equal(qaCalls, 2, '首版和修复版应各检查一次布局');
  assert.equal(result.ok, false);
  assert.equal(result.failure.diagnostics[0].code, 'frame_layout_qa_unresolved');
  assert.equal(result.failure.diagnostics[0].severity, 'error');
  assert.equal(result.failure.diagnostics[0].fallback_allowed, false);

  const persisted = await projectStore.loadProject(projectDir);
  const checkpoint = persisted.generation_checkpoint.stages.frame_html.frames.scene_01;
  assert.equal(checkpoint.status, 'failed');
  assert.equal(checkpoint.diagnostic_code, 'frame_layout_qa_unresolved');

  console.log('html-video unresolved layout blocking integration tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
