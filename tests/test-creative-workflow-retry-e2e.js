const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const fsSync = require('fs');
const createdTempDirs = [];
const mkdtemp = fs.mkdtemp.bind(fs);
fs.mkdtemp = async (...args) => { const dir = await mkdtemp(...args); createdTempDirs.push(dir); return dir; };
process.on('exit', () => createdTempDirs.forEach(dir => fsSync.rmSync(dir, { recursive: true, force: true })));

const workflows = require('../server/services/creative/creativeWorkflows');
const workflowTasks = require('../server/services/creative/creativeWorkflowTasks');
const { createCreativeTaskRegistry } = require('../server/services/creative/creativeTaskRegistry');
const { createCreativeWorkflowRetryPlan } = require('../server/services/creative-video/retryPlanner');
const { parseContentGraphResponse } = require('../server/services/creative-video/html-video/contentGraphAgent');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { runtimeAssetPolicyAttestation } = require('../server/services/creative-video/html-video/frameRenderPhase');
const {
  createEmptyProject,
  markCheckpointFrame,
  markCheckpointStage,
} = require('../server/services/creative-video/html-video/projectSchema');
const { createDiagnostic } = require('../server/services/creative-video/html-video/diagnostics');
const { buildAssetUsageReport } = require('../server/services/creative-video/html-video/assetUsagePhase');
const { executeCreativeWorkflowRetryPlan } = require('../server/services/creative-video/resumeExecutor');

function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'creative-workflow-retry-e2e-'));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function fileHash(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function waitFor(assertion, timeoutMs = 1000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

function workflowStages(projectStatus = 'failed') {
  return workflows.STAGE_IDS.map(id => ({
    id,
    label: workflows.STAGE_LABELS[id],
    status: id === 'project' ? projectStatus : 'pending',
    message: '',
  }));
}

function sceneSpec(sceneIds = ['scene_01']) {
  return {
    title: 'retry e2e',
    scenes: sceneIds.map((id, index) => ({
      id,
      order: index + 1,
      narration_text: `第 ${index + 1} 段旁白。`,
      captions: [],
      visual_text: { headline: `第 ${index + 1} 幕` },
      duration_sec: 2,
    })),
  };
}

function createProject({ workflowId, runId = 'run-retry-e2e', sceneIds = ['scene_01'], targetDurationSec = 2 } = {}) {
  const project = createEmptyProject({ workflowId, runId });
  project.target = { duration_sec: targetDurationSec, aspect_ratio: '9:16' };
  project.output = {
    duration: targetDurationSec,
    aspect_ratio: '9:16',
    fps: 30,
    resolution: { width: 1080, height: 1920 },
  };
  project.scene_spec = sceneSpec(sceneIds);
  project.audio = { status: 'skipped', reason: 'disabled_by_settings' };
  project.content_graph = {
    nodes: sceneIds.map((id, index) => ({
      id,
      kind: 'text',
      label: `第 ${index + 1} 幕`,
      durationSec: 2,
      text: `第 ${index + 1} 幕`,
    })),
    edges: [],
  };
  project.frames = sceneIds.map((id, index) => ({
    id,
    scene_id: id,
    order: index + 1,
    engine: 'hyperframes-playwright',
    source_mode: 'raw_html',
    html_path: `frames/${String(index + 1).padStart(2, '0')}-${id}.html`,
    duration_sec: 2,
    captions: [],
  }));
  project.timeline = {
    tracks: [{
      id: 'main',
      items: sceneIds.map((id, index) => ({
        id,
        frame_id: id,
        duration_sec: 2,
        start_sec: index * 2,
      })),
    }],
  };
  markCheckpointStage(project, 'content_graph', { status: 'done', path: 'content-graph.json' });
  return project;
}

function retryWorkflowRecord({ workflowId, projectDir, lastFailure, sceneIds = ['scene_01'] }) {
  return {
    workflow_id: workflowId,
    success: false,
    status: 'failed',
    message: '工程阶段失败。',
    stages: workflowStages('failed'),
    result: {
      hyperframes_freeform: {
        project: {
          render_mode: 'html-video',
          html_video_project_path: projectDir,
          project_dir: projectDir,
          scene_spec: sceneSpec(sceneIds),
          frame_specs: Object.fromEntries(sceneIds.map(id => [id, { visual_text: { headline: id } }])),
        },
      },
    },
    retry: { version: 1, attempts: [], latest_plan: {} },
    last_failure: lastFailure,
  };
}

async function createFrameHtmlFailureFixture(rootDir, workflowId = '202606250000001001') {
  const projectDir = path.join(rootDir, 'media', workflowId, 'agent_runs', 'run-retry-e2e-html-video');
  const sceneIds = ['scene_01', 'scene_02'];
  const project = createProject({ workflowId, sceneIds, targetDurationSec: 4 });
  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'frames', '01-scene_01.html'), '<html><body>old</body></html>', 'utf8');
  await fs.writeFile(path.join(projectDir, 'frames', '02-scene_02.html'), '<html><body>kept</body></html>', 'utf8');
  const mp4Path = 'frames/scene_02.mp4';
  await fs.writeFile(path.join(projectDir, mp4Path), 'mp4:scene_02', 'utf8');
  const outputHash = await fileHash(path.join(projectDir, mp4Path));
  markCheckpointFrame(project, 'frame_html', 'scene_01', {
    status: 'failed',
    html_path: 'frames/01-scene_01.html',
    diagnostic_code: 'provider_missing_text',
  });
  markCheckpointFrame(project, 'frame_html', 'scene_02', {
    status: 'done',
    html_path: 'frames/02-scene_02.html',
    output_hash: 'kept-scene-02-html',
    diagnostic_code: '',
  });
  markCheckpointFrame(project, 'render', 'scene_02', {
    status: 'done',
    mp4_path: mp4Path,
    output_hash: outputHash,
    diagnostic_code: '',
    runtime_asset_policy_attestation: await runtimeAssetPolicyAttestation(projectDir, project, project.frames[1], {
      checkpoint_key: 'scene_02', mp4_path: mp4Path, output_hash: outputHash,
    }),
  });
  markCheckpointStage(project, 'render', { status: 'partial' });
  await projectStore.saveProject(projectDir, project);

  const diagnostic = createDiagnostic({
    code: 'provider_missing_text',
    stage: 'ai-frame-html',
    sub_stage: 'frame_html',
    frame_id: 'scene_01',
    retryable: true,
    repair_action: 'retry_frame_html',
    user_message: '第 1 帧 HTML 生成时模型返回空内容。',
  });
  const lastFailure = {
    stage: 'project',
    sub_stage: 'frame_html',
    code: 'provider_missing_text',
    frame_id: 'scene_01',
    project_dir: projectDir,
    message: '第 1 帧 HTML 生成失败。',
    diagnostics: [diagnostic],
    updated_at: '2026-06-25T00:00:00.000Z',
  };
  await writeJson(
    workflows.getWorkflowPath(workflowId, rootDir),
    retryWorkflowRecord({ workflowId, projectDir, lastFailure, sceneIds }),
  );
  return { workflowId, projectDir };
}

async function createMultiSceneLayoutQaFailureFixture(rootDir, workflowId = '202606250000001015') {
  const projectDir = path.join(rootDir, 'media', workflowId, 'agent_runs', 'run-layout-qa-retry');
  const sceneIds = ['scene_01', 'scene_02', 'scene_03', 'scene_04'];
  const project = createProject({ workflowId, sceneIds, targetDurationSec: 8 });
  markCheckpointFrame(project, 'frame_html', 'scene_01', { status: 'done', output_hash: 'scene-01-kept' });
  markCheckpointFrame(project, 'frame_html', 'scene_02', {
    status: 'failed', diagnostic_code: 'frame_layout_qa_unresolved',
  });
  markCheckpointFrame(project, 'frame_html', 'scene_03', {
    status: 'failed', diagnostic_code: 'frame_layout_qa_unresolved',
  });
  markCheckpointFrame(project, 'frame_html', 'scene_04', {
    status: 'failed', diagnostic_code: 'provider_missing_text',
  });
  markCheckpointFrame(project, 'render', 'scene_01', { status: 'done', output_hash: 'scene-01-render-kept' });
  markCheckpointFrame(project, 'render', 'scene_02', { status: 'failed', diagnostic_code: 'frame_layout_qa_unresolved' });
  markCheckpointFrame(project, 'render', 'scene_03', { status: 'failed', diagnostic_code: 'frame_layout_qa_unresolved' });
  markCheckpointFrame(project, 'render', 'scene_04', { status: 'failed', diagnostic_code: 'provider_missing_text' });
  await projectStore.saveProject(projectDir, project);

  const diagnostics = [{
    code: 'frame_layout_qa_unresolved',
    stage: 'ai-frame-html',
    sub_stage: 'frame_html',
    frame_id: 'scene_02',
    severity: 'error',
    retryable: true,
    repair_action: 'retry_frame_html',
    details: {
      issues: [{ code: 'camera_jitter', frame_id: 'scene_02', sample_time_sec: 1.25, shot_id: 'shot_02' }],
    },
  }, {
    code: 'frame_layout_qa_unresolved',
    sub_stage: 'frame_html',
    details: { frame_id: 'scene_03' },
  }, {
    code: 'provider_missing_text',
    sub_stage: 'frame_html',
    frame_id: 'scene_04',
  }];
  const lastFailure = {
    stage: 'project',
    sub_stage: 'frame_html',
    code: 'frame_layout_qa_unresolved',
    frame_id: 'scene_02',
    project_dir: projectDir,
    message: '场景摄影机预览 QA 仍未通过。',
    diagnostics,
  };
  await writeJson(
    workflows.getWorkflowPath(workflowId, rootDir),
    retryWorkflowRecord({ workflowId, projectDir, lastFailure, sceneIds }),
  );
  return { workflowId, projectDir };
}

async function createRenderFailureFixture(rootDir, workflowId = '202606250000001002') {
  const projectDir = path.join(rootDir, 'media', workflowId, 'agent_runs', 'run-render-timeout');
  const sceneIds = ['scene_01', 'scene_02'];
  const project = createProject({ workflowId, sceneIds, targetDurationSec: 4 });
  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  for (const frame of project.frames) {
    await fs.writeFile(path.join(projectDir, frame.html_path), `<html><body>${frame.id}</body></html>`, 'utf8');
    markCheckpointFrame(project, 'frame_html', frame.scene_id, {
      status: 'done',
      html_path: frame.html_path,
      diagnostic_code: '',
    });
  }
  const mp4Path = 'frames/scene_01.mp4';
  await fs.writeFile(path.join(projectDir, mp4Path), 'mp4:scene_01', 'utf8');
  const outputHash = await fileHash(path.join(projectDir, mp4Path));
  markCheckpointFrame(project, 'render', 'scene_01', {
    status: 'done',
    mp4_path: mp4Path,
    output_hash: outputHash,
    diagnostic_code: '',
    runtime_asset_policy_attestation: await runtimeAssetPolicyAttestation(projectDir, project, project.frames[0], {
      checkpoint_key: 'scene_01', mp4_path: mp4Path, output_hash: outputHash,
    }),
  });
  markCheckpointFrame(project, 'render', 'scene_02', {
    status: 'failed',
    diagnostic_code: 'render_failed_timeout',
  });
  markCheckpointStage(project, 'render', { status: 'failed' });
  await projectStore.saveProject(projectDir, project);

  const diagnostic = createDiagnostic({
    code: 'render_failed_timeout',
    stage: 'render',
    sub_stage: 'render',
    frame_id: 'scene_02',
    retryable: true,
    repair_action: 'rerender_frames',
  });
  const lastFailure = {
    stage: 'project',
    sub_stage: 'render',
    code: 'render_failed_timeout',
    frame_id: 'scene_02',
    project_dir: projectDir,
    message: '第 2 帧渲染超时。',
    diagnostics: [diagnostic],
    updated_at: '2026-06-25T00:00:00.000Z',
  };
  await writeJson(
    workflows.getWorkflowPath(workflowId, rootDir),
    retryWorkflowRecord({ workflowId, projectDir, lastFailure, sceneIds }),
  );
  return { workflowId, projectDir };
}

async function createComposeMismatchFixture(rootDir, workflowId = '202606250000001003') {
  const projectDir = path.join(rootDir, 'media', workflowId, 'agent_runs', 'run-compose-mismatch');
  const sceneIds = ['scene_01', 'scene_02'];
  const project = createProject({ workflowId, sceneIds, targetDurationSec: 4 });
  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  for (const frame of project.frames) {
    const mp4Path = `frames/${frame.id}.mp4`;
    await fs.writeFile(path.join(projectDir, frame.html_path), `<html><body>${frame.id}</body></html>`, 'utf8');
    await fs.writeFile(path.join(projectDir, mp4Path), `mp4:${frame.id}`, 'utf8');
    const outputHash = await fileHash(path.join(projectDir, mp4Path));
    markCheckpointFrame(project, 'frame_html', frame.scene_id, {
      status: 'done',
      html_path: frame.html_path,
      diagnostic_code: '',
    });
    markCheckpointFrame(project, 'render', frame.scene_id, {
      status: 'done',
      mp4_path: mp4Path,
      output_hash: outputHash,
      diagnostic_code: '',
      runtime_asset_policy_attestation: await runtimeAssetPolicyAttestation(projectDir, project, frame, {
        checkpoint_key: frame.scene_id, mp4_path: mp4Path, output_hash: outputHash,
      }),
    });
  }
  markCheckpointStage(project, 'render', { status: 'done' });
  markCheckpointStage(project, 'compose', { status: 'done', output_path: 'exports/output.mp4' });
  markCheckpointStage(project, 'duration_verify', {
    status: 'failed',
    expected_duration_sec: 4,
    actual_duration_sec: 7,
    diagnostic_code: 'duration_mismatch',
  });
  await projectStore.saveProject(projectDir, project);

  const diagnostic = createDiagnostic({
    code: 'duration_mismatch',
    stage: 'compose',
    sub_stage: 'duration_verify',
    retryable: true,
    repair_action: 'recompose',
  });
  const lastFailure = {
    stage: 'project',
    sub_stage: 'duration_verify',
    code: 'duration_mismatch',
    project_dir: projectDir,
    message: '导出视频时长校验失败。',
    diagnostics: [diagnostic],
    updated_at: '2026-06-25T00:00:00.000Z',
  };
  await writeJson(
    workflows.getWorkflowPath(workflowId, rootDir),
    retryWorkflowRecord({ workflowId, projectDir, lastFailure, sceneIds }),
  );
  return { workflowId, projectDir };
}

function fakeHtmlVideoServices(calls = {}) {
  calls.source = calls.source || 0;
  calls.research = calls.research || 0;
  calls.brief = calls.brief || 0;
  calls.audio = calls.audio || 0;
  calls.content_graph = calls.content_graph || 0;
  return {
    sourceService: { run: async () => { calls.source += 1; } },
    researchService: { run: async () => { calls.research += 1; } },
    briefService: { run: async () => { calls.brief += 1; } },
    audioService: { run: async () => { calls.audio += 1; } },
    resumeActions: {
      retryContentGraph: async ({ project }) => {
        calls.content_graph += 1;
        return { success: true, project };
      },
      retryFrameHtml: async ({ project, projectDir, frame_id }) => {
        calls.retryFrameHtml = (calls.retryFrameHtml || 0) + 1;
        calls.retryFrameHtmlIds = [...(calls.retryFrameHtmlIds || []), frame_id];
        const frame = project.frames.find(item => item.scene_id === frame_id || item.id === frame_id);
        const written = await projectStore.writeRawFrameHtml({
          projectDir,
          sceneId: frame_id,
          order: frame?.order || 1,
          html: `<html><body>${frame_id}:new</body></html>`,
          captions: [],
          durationSec: frame?.duration_sec || 2,
        });
        if (frame) frame.html_path = written.html_path;
        markCheckpointFrame(project, 'frame_html', frame_id, {
          status: 'done',
          html_path: written.html_path,
          output_hash: written.output_hash,
          diagnostic_code: '',
        });
        return { success: true, project };
      },
    },
    materializer: {
      materializeProject: async ({ project }) => ({ project, diagnostics: [] }),
    },
    frameRenderer: {
      renderFrame: async (frame, { outputPath }) => {
        calls.renderFrame = (calls.renderFrame || 0) + 1;
        calls.renderFrameIds = [...(calls.renderFrameIds || []), frame.scene_id || frame.id];
        calls.renderFrameKeys = [...(calls.renderFrameKeys || []), frame.id];
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, `mp4:${frame.scene_id || frame.id}`, 'utf8');
        return { success: true, output_path: outputPath, meta: {} };
      },
    },
    ffmpegComposer: {
      concatFramesWithFfmpeg: async (frames, outputPath) => {
        calls.compose = (calls.compose || 0) + 1;
        calls.composeFrameIds = frames.map(frame => frame.frame_id);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, calls.composeFrameIds.join(','), 'utf8');
        return { success: true, output_path: outputPath };
      },
      verifyDurationWithFfprobe: async () => ({
        success: true,
        expected_duration_sec: 2,
        actual_duration_sec: 2,
      }),
    },
    visualQaService: {
      inspectRenderedVideo: async args => {
        calls.visualInspect = (calls.visualInspect || 0) + 1;
        calls.visualInspectArgs = args;
        return { success: true, issues: [], metrics: {}, report_path: 'inspect/visual-report.json' };
      },
    },
  };
}

function contentGraphFailureWorkflow(overrides = {}) {
  const diagnostic = createDiagnostic({
    code: 'content_graph_invalid',
    stage: 'ai-content-graph',
    sub_stage: 'content_graph',
    retryable: true,
    repair_action: 'retry_content_graph',
    user_message: 'AI 未返回 content graph JSON。',
  });
  return {
    workflow_id: '202606250000001004',
    status: 'failed',
    result: {
      hyperframes_freeform: {
        project: {
          scene_spec: sceneSpec(),
        },
      },
    },
    last_failure: {
      stage: 'project',
      sub_stage: 'content_graph',
      code: 'content_graph_invalid',
      message: 'AI 未返回 content graph JSON。',
      diagnostics: [diagnostic],
    },
    ...overrides,
  };
}

function plannerProject(overrides = {}) {
  return {
    ...createProject({ workflowId: '202606250000001005', targetDurationSec: 60 }),
    ...overrides,
  };
}

(async () => {
  assert.equal(path.basename(__filename).startsWith('test-'), true);

  {
    const rootDir = await tempRoot();
    const projectDir = path.join(rootDir, 'beat-checkpoint-project');
    const runtimeWorkflowId = '202606250000001006';
    const project = createProject({ workflowId: runtimeWorkflowId, sceneIds: ['scene_01'] });
    project.frames[0].id = 'beat_01';
    await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
    await fs.writeFile(path.join(projectDir, project.frames[0].html_path), '<img src="../assets/beat-checkpoint-evil.png">', 'utf8');
    markCheckpointFrame(project, 'frame_html', 'beat_01', { status: 'done', html_path: project.frames[0].html_path });
    markCheckpointFrame(project, 'render', 'beat_01', { status: 'failed', diagnostic_code: 'runtime_visual_asset_policy_violation' });
    await projectStore.saveProject(projectDir, project);
    const report = buildAssetUsageReport({ project, projectDir, creativeContext: { asset_context: { assets: [] } } });
    const diagnostic = createDiagnostic({
      code: 'runtime_visual_asset_policy_violation',
      sub_stage: 'frame_html',
      frame_id: 'beat_01',
      severity: 'error',
      details: { violations: [{ kind: 'unregistered_local_image', target: 'assets/beat-checkpoint-evil.png', frame_id: 'beat_01' }] },
    });
    project.asset_usage_report = {
      ...report,
      runtime_policy_violations: [{ frame_id: 'beat_01', code: diagnostic.code, violations: diagnostic.details.violations }],
    };
    await projectStore.saveProject(projectDir, project);
    await writeJson(workflows.getWorkflowPath(runtimeWorkflowId, rootDir), {
      workflow_id: runtimeWorkflowId,
      status: 'failed',
      result: { hyperframes_freeform: { project: { project_dir: projectDir, html_video_project_path: projectDir } } },
      last_failure: {
        stage: 'project', sub_stage: 'frame_html', code: diagnostic.code, frame_id: 'beat_01',
        project_dir: projectDir, diagnostics: [diagnostic], message: '运行时素材门禁阻断。',
      },
    });
    const refreshed = await workflows.refreshCreativeWorkflowRetryPlan(runtimeWorkflowId, { rootDir });
    const plan = refreshed.plan;
    assert.deepEqual(report.unregistered_image_references, [
      { frame_id: 'beat_01', reference: '../assets/beat-checkpoint-evil.png' },
    ]);
    assert.deepEqual(plan.executor_options.frame_ids, ['beat_01']);
    assert.equal(plan.executor_options.regenerate_frame_html, true);
    let invalidated = false;
    const result = await executeCreativeWorkflowRetryPlan({
      workflowId: runtimeWorkflowId,
      workflow: {},
      projectDir,
      rootDir,
      plan,
      services: {
        resumeActions: {
          retryFrameHtml: async ({ project: nextProject, frame_id }) => {
            assert.equal(frame_id, 'beat_01');
            assert.equal(nextProject.generation_checkpoint.stages.frame_html.frames.beat_01.status, 'pending');
            assert.equal(nextProject.generation_checkpoint.stages.render.frames.beat_01.status, 'pending');
            invalidated = true;
            return { success: true, project: nextProject, output_path: 'exports/recovered.mp4' };
          },
        },
      },
    });
    assert.equal(result.success, true);
    assert.equal(invalidated, true, 'report 的真实 beat frame_id 必须贯穿至 checkpoint 定向失效');
  }

  {
    const rootDir = await tempRoot();
    const { workflowId, projectDir } = await createFrameHtmlFailureFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(workflowId, { rootDir });
    assert.equal(plan.success, true);
    assert.equal(plan.plan.repair_action, 'retry_frame_html');

    const registry = createCreativeTaskRegistry({
      idFactory: () => 'retry-e2e-task',
      now: () => '2026-06-25T01:00:00.000Z',
    });
    const calls = {};
    const started = await workflowTasks.startCreativeWorkflowRetryTask(workflowId, {
      rootDir,
      registry,
      retryAttemptId: 'retry_attempt_e2e_done',
      payload: { mode: 'repair_and_resume', confirm_plan_code: plan.plan.code, confirm_plan_fingerprint: plan.plan.plan_fingerprint },
      workflowOptions: {
        rootDir,
        services: {
          now: () => '2026-06-25T01:00:00.000Z',
          ...fakeHtmlVideoServices(calls),
        },
      },
    });
    assert.equal(started.success, true);
    await waitFor(() => assert.equal(registry.getTask(started.task_id).status, 'done'));

    const record = await readJson(workflows.getWorkflowPath(workflowId, rootDir));
    assert.equal(record.status, 'done');
    assert.equal(record.last_failure, null);
    assert.equal(record.retry.attempts.at(-1).status, 'done');
    assert.equal(record.stages.find(stage => stage.id === 'project').status, 'done');
    assert.equal(record.stages.find(stage => stage.id === 'check').status, 'skipped');
    assert.equal(record.stages.find(stage => stage.id === 'render').status, 'done');
    assert.equal(record.stages.find(stage => stage.id === 'inspect').status, 'done');
    assert.equal(calls.source, 0);
    assert.equal(calls.research, 0);
    assert.equal(calls.brief, 0);
    assert.equal(calls.audio, 0);
    assert.equal(calls.content_graph, 0);
    assert.deepEqual(calls.retryFrameHtmlIds, ['scene_01']);
    assert.deepEqual(calls.renderFrameIds, ['scene_01']);
    assert.equal(calls.compose, 1);
    assert.equal(calls.visualInspect, 1);
    assert.equal(calls.visualInspectArgs.projectDir, projectDir);
  }

  {
    const rootDir = await tempRoot();
    const { workflowId, projectDir } = await createMultiSceneLayoutQaFailureFixture(rootDir);
    const refreshed = await workflows.refreshCreativeWorkflowRetryPlan(workflowId, { rootDir });
    assert.deepEqual(refreshed.plan.executor_options, {
      regenerate_frame_html: true,
      frame_ids: ['scene_02', 'scene_03'],
    });
    const record = await readJson(workflows.getWorkflowPath(workflowId, rootDir));
    assert.deepEqual(record.last_failure.diagnostics[0].details.issues[0], {
      code: 'camera_jitter', frame_id: 'scene_02', sample_time_sec: 1.25, shot_id: 'shot_02',
    });

    const retriedFrameIds = [];
    const retried = await executeCreativeWorkflowRetryPlan({
      workflowId,
      workflow: record,
      projectDir,
      rootDir,
      plan: refreshed.plan,
      services: {
        resumeActions: {
          retryFrameHtml: async ({ project, frame_id }) => {
            retriedFrameIds.push(frame_id);
            if (frame_id === 'scene_02') {
              const persisted = await projectStore.loadProject(projectDir);
              const frameHtml = persisted.generation_checkpoint.stages.frame_html.frames;
              const render = persisted.generation_checkpoint.stages.render.frames;
              assert.deepEqual({ status: frameHtml.scene_01.status, output_hash: frameHtml.scene_01.output_hash }, {
                status: 'done', output_hash: 'scene-01-kept',
              });
              assert.deepEqual({ status: render.scene_01.status, output_hash: render.scene_01.output_hash }, {
                status: 'done', output_hash: 'scene-01-render-kept',
              });
              for (const sceneId of ['scene_02', 'scene_03']) {
                assert.equal(frameHtml[sceneId].status, 'pending');
                assert.equal(render[sceneId].status, 'pending');
              }
              assert.deepEqual({
                status: frameHtml.scene_04.status,
                diagnostic_code: frameHtml.scene_04.diagnostic_code,
              }, {
                status: 'failed', diagnostic_code: 'provider_missing_text',
              });
              assert.deepEqual({
                status: render.scene_04.status,
                diagnostic_code: render.scene_04.diagnostic_code,
              }, {
                status: 'failed', diagnostic_code: 'provider_missing_text',
              });
            }
            assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_01.status, 'done');
            assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_02.status, 'pending');
            assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_03.status, 'pending');
            assert.equal(project.generation_checkpoint.stages.frame_html.frames.scene_04.diagnostic_code, 'provider_missing_text');
            return {
              success: true,
              project,
              ...(frame_id === 'scene_03' ? { output_path: 'exports/recovered.mp4' } : {}),
            };
          },
        },
      },
    });
    assert.equal(retried.success, true);
    assert.deepEqual(retriedFrameIds, ['scene_02', 'scene_03']);
  }

  {
    const rootDir = await tempRoot();
    const { workflowId, projectDir } = await createMultiSceneLayoutQaFailureFixture(rootDir, '202606250000001016');
    let project = await projectStore.loadProject(projectDir);
    await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
    for (const frame of project.frames) {
      await fs.writeFile(path.join(projectDir, frame.html_path), `<html><body>${frame.id}:old</body></html>`, 'utf8');
    }
    await fs.writeFile(path.join(projectDir, 'frames', 'scene_01.mp4'), 'mp4:scene_01', 'utf8');
    const sceneOneHash = await fileHash(path.join(projectDir, 'frames', 'scene_01.mp4'));
    markCheckpointFrame(project, 'frame_html', 'scene_01', {
      status: 'done', html_path: project.frames[0].html_path, input_hash: 'scene-01-input',
      input_fingerprint: 'scene-01-fingerprint', output_hash: 'scene-01-html', diagnostic_code: '',
    });
    markCheckpointFrame(project, 'render', 'scene_01', {
      status: 'done', mp4_path: 'frames/scene_01.mp4', output_hash: sceneOneHash, diagnostic_code: '',
      runtime_asset_policy_attestation: await runtimeAssetPolicyAttestation(projectDir, project, project.frames[0], {
        checkpoint_key: 'scene_01', mp4_path: 'frames/scene_01.mp4', output_hash: sceneOneHash,
      }),
    });
    for (const sceneId of ['scene_02', 'scene_03']) {
      markCheckpointFrame(project, 'frame_html', sceneId, {
        status: 'done', html_path: `frames/${sceneId}.html`, input_hash: 'stale-input',
        input_fingerprint: 'stale-fingerprint', output_hash: 'stale-html', diagnostic_code: 'frame_layout_qa_unresolved',
      });
      markCheckpointFrame(project, 'render', sceneId, {
        status: 'done', mp4_path: `frames/${sceneId}.mp4`, output_hash: 'stale-mp4', diagnostic_code: '',
        runtime_asset_policy_attestation: { version: 'runtime-asset-policy-v1', fingerprint: 'stale' },
      });
    }
    markCheckpointStage(project, 'frame_html', { status: 'failed' });
    markCheckpointStage(project, 'render', { status: 'done' });
    markCheckpointStage(project, 'compose', {
      status: 'done', output_path: 'exports/old.mp4', output_audio_path: 'exports/old-audio.mp4', diagnostic_code: '',
    });
    markCheckpointStage(project, 'duration_verify', {
      status: 'done', expected_duration_sec: 8, actual_duration_sec: 8, diagnostic_code: '',
    });
    markCheckpointStage(project, 'visual_inspect', {
      status: 'done', report_path: 'inspect/old-visual-report.json', diagnostic_code: '',
    });
    project.exports = [{ type: 'video', path: 'exports/old.mp4' }];
    project.render_outputs = [{ path: 'exports/old.mp4' }];
    project.status = 'ready';
    await projectStore.saveProject(projectDir, project);

    const before = await projectStore.loadProject(projectDir);
    const keptFrameHtml = JSON.parse(JSON.stringify(before.generation_checkpoint.stages.frame_html.frames.scene_01));
    const keptRender = JSON.parse(JSON.stringify(before.generation_checkpoint.stages.render.frames.scene_01));
    const unrelatedFrameHtml = JSON.parse(JSON.stringify(before.generation_checkpoint.stages.frame_html.frames.scene_04));
    const unrelatedRender = JSON.parse(JSON.stringify(before.generation_checkpoint.stages.render.frames.scene_04));
    const refreshed = await workflows.refreshCreativeWorkflowRetryPlan(workflowId, { rootDir });
    const record = await readJson(workflows.getWorkflowPath(workflowId, rootDir));
    await assert.rejects(() => executeCreativeWorkflowRetryPlan({
      workflowId, workflow: record, projectDir, rootDir, plan: refreshed.plan,
      services: { resumeActions: { retryFrameHtml: async () => { throw new Error('模拟失效写盘后的进程中断'); } } },
    }), /模拟失效写盘后的进程中断/);

    const interruptedRaw = await readJson(path.join(projectDir, 'project.json'));
    const checkpoint = interruptedRaw.generation_checkpoint.stages;
    for (const sceneId of ['scene_02', 'scene_03']) {
      assert.deepEqual(checkpoint.frame_html.frames[sceneId], {
        status: 'pending', html_path: '', input_hash: '', input_fingerprint: '', output_hash: '', diagnostic_code: '',
      });
      assert.deepEqual(checkpoint.render.frames[sceneId], {
        status: 'pending', mp4_path: '', output_hash: '', diagnostic_code: '',
      });
    }
    assert.equal(checkpoint.frame_html.status, 'partial');
    assert.equal(checkpoint.render.status, 'partial');
    assert.deepEqual(checkpoint.frame_html.frames.scene_01, keptFrameHtml);
    assert.deepEqual(checkpoint.render.frames.scene_01, keptRender);
    assert.deepEqual(checkpoint.frame_html.frames.scene_04, unrelatedFrameHtml);
    assert.deepEqual(checkpoint.render.frames.scene_04, unrelatedRender);
    assert.deepEqual(checkpoint.compose, { status: 'pending', output_path: '', output_audio_path: '', diagnostic_code: '' });
    assert.equal(checkpoint.duration_verify.status, 'pending');
    assert.equal(checkpoint.duration_verify.expected_duration_sec, null);
    assert.equal(checkpoint.duration_verify.actual_duration_sec, null);
    assert.deepEqual(checkpoint.visual_inspect, { status: 'pending', report_path: null, diagnostic_code: '' });
    assert.deepEqual(interruptedRaw.exports, []);
    assert.deepEqual(interruptedRaw.render_outputs || [], []);
    assert.equal(interruptedRaw.status, 'draft');

    const calls = {};
    const resumed = await executeCreativeWorkflowRetryPlan({
      workflowId, workflow: record, projectDir, rootDir, plan: refreshed.plan,
      services: fakeHtmlVideoServices(calls),
    });
    assert.equal(resumed.success, false, '其他错误 Scene 仍未完成时不得误报全工程恢复成功');
    assert.deepEqual(calls.retryFrameHtmlIds, ['scene_02', 'scene_03']);
    assert.deepEqual(calls.renderFrameIds, ['scene_02', 'scene_03']);
    assert.equal(calls.renderFrameIds.includes('scene_01'), false, '有效 Scene 1 MP4 不得重渲染');
    assert.equal(calls.renderFrameIds.includes('scene_04'), false, '其他失败原因不得混入本次恢复');
    assert.equal(calls.compose || 0, 0, '旧合成结果不得复用，缺少 Scene 4 时也不得开始新合成');
    assert.equal(calls.visualInspect || 0, 0, '旧视觉报告不得复用');
  }

  {
    const rootDir = await tempRoot();
    const { workflowId, projectDir } = await createRenderFailureFixture(rootDir, '202606250000001014');
    const project = await projectStore.loadProject(projectDir);
    markCheckpointFrame(project, 'render', 'scene_02', {
      status: 'failed',
      diagnostic_code: 'frame_html_shot_contract_invalid',
    });
    await projectStore.saveProject(projectDir, project);
    const diagnostic = createDiagnostic({
      code: 'frame_html_shot_contract_invalid',
      sub_stage: 'render',
      frame_id: 'scene_02',
      severity: 'error',
      retryable: true,
      repair_action: 'retry_frame_html',
    });
    const record = await readJson(workflows.getWorkflowPath(workflowId, rootDir));
    record.last_failure = {
      stage: 'project',
      sub_stage: 'render',
      code: 'frame_html_shot_contract_invalid',
      frame_id: 'scene_02',
      project_dir: projectDir,
      message: 'Image Sequence 运行时合同失败。',
      diagnostics: [diagnostic],
    };
    await writeJson(workflows.getWorkflowPath(workflowId, rootDir), record);

    const refreshed = await workflows.refreshCreativeWorkflowRetryPlan(workflowId, { rootDir });
    assert.equal(refreshed.plan.repair_action, 'retry_frame_html');
    assert.deepEqual(refreshed.plan.executor_options, {
      regenerate_frame_html: true,
      frame_ids: ['scene_02'],
    });

    const calls = {};
    const services = fakeHtmlVideoServices(calls);
    const retryFrameHtml = services.resumeActions.retryFrameHtml;
    services.resumeActions.retryFrameHtml = async args => {
      assert.equal(args.frame_id, 'scene_02');
      assert.equal(args.project.generation_checkpoint.stages.frame_html.frames.scene_02.status, 'pending');
      assert.equal(args.project.generation_checkpoint.stages.render.frames.scene_02.status, 'pending');
      assert.equal(args.project.generation_checkpoint.stages.frame_html.frames.scene_01.status, 'done');
      assert.equal(args.project.generation_checkpoint.stages.render.frames.scene_01.status, 'done');
      return retryFrameHtml(args);
    };
    const retried = await workflows.retryCreativeWorkflow(workflowId, {
      mode: 'repair_and_resume',
      confirm_plan_code: refreshed.plan.code,
      confirm_plan_fingerprint: refreshed.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_shot_contract',
      services,
    });
    assert.equal(retried.success, true);
    assert.deepEqual(calls.retryFrameHtmlIds, ['scene_02']);
    assert.deepEqual(calls.renderFrameIds, ['scene_02']);
    assert.deepEqual(calls.composeFrameIds, ['scene_01', 'scene_02']);
  }

  {
    const rootDir = await tempRoot();
    const workflowId = '202606250000001016';
    const projectDir = path.join(rootDir, 'media', workflowId, 'agent_runs', 'run-layout-qa-failed');
    const sceneIds = ['scene_01', 'scene_06'];
    const layoutProject = createProject({ workflowId, sceneIds, targetDurationSec: 4 });
    layoutProject.continuity_mode = 'scene_html';
    layoutProject.frames.forEach((frame, index) => {
      frame.id = `scene:${frame.scene_id}`;
      layoutProject.content_graph.nodes[index].id = frame.id;
      layoutProject.content_graph.nodes[index].scene_id = frame.scene_id;
      layoutProject.timeline.tracks[0].items[index].frame_id = frame.id;
    });
    await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
    for (const frame of layoutProject.frames) {
      await fs.writeFile(path.join(projectDir, frame.html_path), `<html><body>${frame.id}:old</body></html>`, 'utf8');
      markCheckpointFrame(layoutProject, 'frame_html', frame.id, {
        status: 'done',
        html_path: frame.html_path,
        input_hash: `${frame.scene_id}-input`,
        input_fingerprint: `${frame.scene_id}-fingerprint`,
        output_hash: `${frame.scene_id}-html`,
        diagnostic_code: frame.scene_id === 'scene_06' ? 'layout_qa_failed' : '',
      });
      const mp4Path = `frames/${frame.scene_id}.mp4`;
      await fs.writeFile(path.join(projectDir, mp4Path), `mp4:${frame.scene_id}:old`, 'utf8');
      const outputHash = await fileHash(path.join(projectDir, mp4Path));
      markCheckpointFrame(layoutProject, 'render', frame.id, {
        status: 'done',
        mp4_path: mp4Path,
        output_hash: outputHash,
        diagnostic_code: '',
        runtime_asset_policy_attestation: await runtimeAssetPolicyAttestation(projectDir, layoutProject, frame, {
          checkpoint_key: frame.id,
          mp4_path: mp4Path,
          output_hash: outputHash,
        }),
      });
    }
    markCheckpointStage(layoutProject, 'frame_html', { status: 'done' });
    markCheckpointStage(layoutProject, 'render', { status: 'done' });
    await projectStore.saveProject(projectDir, layoutProject);

    const diagnostic = createDiagnostic({
      code: 'layout_qa_failed',
      stage: 'project',
      sub_stage: 'layout_qa',
      frame_id: 'scene:scene_06',
      severity: 'error',
      retryable: true,
      repair_action: 'retry_frame_html',
    });
    const lastFailure = {
      stage: 'project',
      sub_stage: 'layout_qa',
      code: 'layout_qa_failed',
      frame_id: 'scene:scene_06',
      project_dir: projectDir,
      message: 'Scene 6 布局 QA 未通过。',
      diagnostics: [diagnostic],
    };
    await writeJson(
      workflows.getWorkflowPath(workflowId, rootDir),
      retryWorkflowRecord({ workflowId, projectDir, lastFailure, sceneIds }),
    );

    const refreshed = await workflows.refreshCreativeWorkflowRetryPlan(workflowId, { rootDir });
    assert.deepEqual(refreshed.plan.executor_options, {
      regenerate_frame_html: true,
      frame_ids: ['scene:scene_06'],
    });
    const before = await projectStore.loadProject(projectDir);
    const nonTargetFrameHtml = structuredClone(before.generation_checkpoint.stages.frame_html.frames['scene:scene_01']);
    const nonTargetRender = structuredClone(before.generation_checkpoint.stages.render.frames['scene:scene_01']);
    const calls = {};
    const services = fakeHtmlVideoServices(calls);
    const retryFrameHtml = services.resumeActions.retryFrameHtml;
    services.resumeActions.retryFrameHtml = async args => {
      assert.equal(args.frame_id, 'scene:scene_06');
      const checkpoint = args.project.generation_checkpoint.stages;
      assert.deepEqual(checkpoint.frame_html.frames['scene:scene_06'], {
        status: 'pending',
        html_path: '',
        input_hash: '',
        input_fingerprint: '',
        output_hash: '',
        diagnostic_code: '',
      });
      assert.equal(checkpoint.render.frames['scene:scene_06'].status, 'pending');
      assert.equal(checkpoint.render.frames['scene:scene_06'].mp4_path, '');
      assert.equal(checkpoint.render.frames['scene:scene_06'].output_hash, '');
      assert.deepEqual(checkpoint.frame_html.frames['scene:scene_01'], nonTargetFrameHtml);
      assert.deepEqual(checkpoint.render.frames['scene:scene_01'], nonTargetRender);
      return retryFrameHtml(args);
    };
    const retried = await workflows.retryCreativeWorkflow(workflowId, {
      mode: 'repair_and_resume',
      confirm_plan_code: refreshed.plan.code,
      confirm_plan_fingerprint: refreshed.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_layout_qa_failed',
      services,
    });
    assert.equal(retried.success, true);
    assert.deepEqual(calls.retryFrameHtmlIds, ['scene:scene_06']);
    assert.deepEqual(calls.renderFrameKeys, ['scene:scene_06']);
    assert.deepEqual(calls.renderFrameIds, ['scene_06']);
    assert.equal(calls.renderFrameIds.includes('scene_01'), false, '非目标 Scene 不得因布局 QA 恢复而重渲染');
    assert.deepEqual(calls.composeFrameIds, ['scene:scene_01', 'scene:scene_06']);
  }

  {
    const rootDir = await tempRoot();
    const workflowId = '202606250000001017';
    const projectDir = path.join(rootDir, 'media', workflowId, 'agent_runs', 'run-layout-qa-full-regenerate');
    const sceneIds = ['scene_01', 'scene_02'];
    const fullProject = createProject({ workflowId, sceneIds, targetDurationSec: 4 });
    await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
    for (const frame of fullProject.frames) {
      await fs.writeFile(path.join(projectDir, frame.html_path), `<html><body>${frame.id}:old</body></html>`, 'utf8');
      markCheckpointFrame(fullProject, 'frame_html', frame.id, {
        status: 'done',
        html_path: frame.html_path,
        input_hash: `${frame.id}-input`,
        input_fingerprint: `${frame.id}-fingerprint`,
        output_hash: `${frame.id}-html`,
        diagnostic_code: '',
      });
      const mp4Path = `frames/${frame.id}.mp4`;
      await fs.writeFile(path.join(projectDir, mp4Path), `mp4:${frame.id}:old`, 'utf8');
      const outputHash = await fileHash(path.join(projectDir, mp4Path));
      markCheckpointFrame(fullProject, 'render', frame.id, {
        status: 'done',
        mp4_path: mp4Path,
        output_hash: outputHash,
        diagnostic_code: '',
        runtime_asset_policy_attestation: await runtimeAssetPolicyAttestation(projectDir, fullProject, frame, {
          checkpoint_key: frame.id,
          mp4_path: mp4Path,
          output_hash: outputHash,
        }),
      });
    }
    delete fullProject.generation_checkpoint.stages.frame_html.frames.scene_02;
    delete fullProject.generation_checkpoint.stages.render.frames.scene_02;
    markCheckpointFrame(fullProject, 'frame_html', 'legacy_scene_alias', {
      status: 'done', html_path: 'frames/legacy.html', output_hash: 'legacy-html', diagnostic_code: '',
    });
    markCheckpointFrame(fullProject, 'render', 'legacy_scene_alias', {
      status: 'done', mp4_path: 'frames/legacy.mp4', output_hash: 'legacy-mp4', diagnostic_code: '',
    });
    markCheckpointStage(fullProject, 'frame_html', { status: 'done' });
    markCheckpointStage(fullProject, 'render', { status: 'done' });
    markCheckpointStage(fullProject, 'compose', { status: 'done', output_path: 'exports/old.mp4' });
    markCheckpointStage(fullProject, 'duration_verify', {
      status: 'done', expected_duration_sec: 4, actual_duration_sec: 4,
    });
    markCheckpointStage(fullProject, 'visual_inspect', {
      status: 'done', report_path: 'inspect/old-report.json',
    });
    fullProject.exports = [{ id: 'old-export', path: 'exports/old.mp4' }];
    fullProject.status = 'done';
    await projectStore.saveProject(projectDir, fullProject);

    const lastFailure = {
      stage: 'project',
      sub_stage: 'layout_qa',
      code: 'layout_qa_failed',
      project_dir: projectDir,
      message: '布局 QA 未提供具体 Frame ID。',
      diagnostics: [createDiagnostic({
        code: 'layout_qa_failed', stage: 'project', sub_stage: 'layout_qa', retryable: true,
      })],
    };
    await writeJson(
      workflows.getWorkflowPath(workflowId, rootDir),
      retryWorkflowRecord({ workflowId, projectDir, lastFailure, sceneIds }),
    );
    const refreshed = await workflows.refreshCreativeWorkflowRetryPlan(workflowId, { rootDir });
    assert.deepEqual(refreshed.plan.executor_options, { regenerate_frame_html: true });

    const calls = {};
    const services = fakeHtmlVideoServices(calls);
    let globalActionCalls = 0;
    services.resumeActions.retryFrameHtml = async ({ project, projectDir: actionProjectDir, frame_id }) => {
      globalActionCalls += 1;
      assert.equal(frame_id, undefined, '全量重生成不得按每个 Frame 重复调用全局 Action');
      const stages = project.generation_checkpoint.stages;
      for (const frameId of sceneIds) {
        assert.equal(stages.frame_html.frames[frameId].status, 'pending');
        assert.equal(stages.frame_html.frames[frameId].html_path, '');
        assert.equal(stages.frame_html.frames[frameId].input_hash, '');
        assert.equal(stages.frame_html.frames[frameId].input_fingerprint, '');
        assert.equal(stages.frame_html.frames[frameId].output_hash, '');
        assert.equal(stages.render.frames[frameId].status, 'pending');
        assert.equal(stages.render.frames[frameId].mp4_path, '');
        assert.equal(stages.render.frames[frameId].output_hash, '');
      }
      assert.equal(stages.frame_html.frames.legacy_scene_alias.status, 'pending');
      assert.equal(stages.frame_html.frames.legacy_scene_alias.html_path, '');
      assert.equal(stages.render.frames.legacy_scene_alias.status, 'pending');
      assert.equal(stages.render.frames.legacy_scene_alias.mp4_path, '');
      assert.equal(stages.compose.status, 'pending');
      assert.equal(stages.duration_verify.status, 'pending');
      assert.equal(stages.visual_inspect.status, 'pending');
      assert.deepEqual(project.exports, []);
      assert.equal(project.status, 'draft');
      for (const frame of project.frames) {
        const written = await projectStore.writeRawFrameHtml({
          projectDir: actionProjectDir,
          sceneId: frame.id,
          order: frame.order,
          html: `<html><body>${frame.id}:new</body></html>`,
          captions: [],
          durationSec: frame.duration_sec,
        });
        frame.html_path = written.html_path;
        markCheckpointFrame(project, 'frame_html', frame.id, {
          status: 'done', html_path: written.html_path, output_hash: written.output_hash, diagnostic_code: '',
        });
      }
      markCheckpointStage(project, 'frame_html', { status: 'done' });
      return { success: true, project };
    };
    const retried = await workflows.retryCreativeWorkflow(workflowId, {
      mode: 'repair_and_resume',
      confirm_plan_code: refreshed.plan.code,
      confirm_plan_fingerprint: refreshed.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_layout_qa_full_regenerate',
      services,
    });
    assert.equal(retried.success, true);
    assert.equal(globalActionCalls, 1);
    assert.deepEqual(calls.renderFrameKeys, ['scene_01', 'scene_02']);
    assert.equal(calls.renderFrameKeys.includes('legacy_scene_alias'), false);
    assert.deepEqual(calls.composeFrameIds, ['scene_01', 'scene_02']);
  }

  {
    const firstPlan = createCreativeWorkflowRetryPlan({
      workflow: contentGraphFailureWorkflow(),
      project: plannerProject(),
    });
    assert.equal(firstPlan.repair_action, 'retry_content_graph');

    const fallbackPlan = createCreativeWorkflowRetryPlan({
      workflow: contentGraphFailureWorkflow({
        retry: {
          version: 1,
          attempts: [{ repair_action: 'retry_content_graph', status: 'failed' }],
        },
      }),
      project: plannerProject(),
    });
    assert.equal(fallbackPlan.repair_action, 'fallback_scene_spec_graph');
  }

  {
    const rawResponse = '{"nodes":[{"id":"scene_01","kind":"text","label":"A","durationSec":2,"text":"A",}],}';
    const parsed = parseContentGraphResponse(rawResponse, sceneSpec());
    assert.equal(parsed.success, true);
    const plan = createCreativeWorkflowRetryPlan({
      workflow: contentGraphFailureWorkflow({
        last_failure: {
          stage: 'project',
          sub_stage: 'content_graph',
          code: 'content_graph_invalid',
          diagnostics: [createDiagnostic({
            code: 'content_graph_invalid',
            sub_stage: 'content_graph',
            details: { raw_response: rawResponse },
          })],
        },
      }),
      project: plannerProject(),
    });
    assert.equal(plan.can_retry, false);
    assert.equal(plan.code, 'content_graph_ok');
  }

  {
    const timelineProject = plannerProject({
      target: { duration_sec: 60, aspect_ratio: '9:16' },
      output: { duration: 60 },
      audio: { duration_sec: 55 },
      frames: [
        { id: 'scene_01', scene_id: 'scene_01', duration_sec: 66 },
        { id: 'scene_02', scene_id: 'scene_02', duration_sec: 66 },
      ],
      timeline: {
        tracks: [{
          id: 'main',
          items: [
            { id: 'scene_01', frame_id: 'scene_01', start_sec: 0, duration_sec: 66 },
            { id: 'scene_02', frame_id: 'scene_02', start_sec: 66, duration_sec: 66 },
          ],
        }],
      },
    });
    const plan = createCreativeWorkflowRetryPlan({
      workflow: {
        workflow_id: '202606250000001006',
        status: 'failed',
        last_failure: { code: 'timeline_duration_unreasonable', sub_stage: 'timeline_check' },
      },
      project: timelineProject,
    });
    assert.equal(plan.repair_action, 'repair_timeline');

    const audioTooLongPlan = createCreativeWorkflowRetryPlan({
      workflow: {
        workflow_id: '202606250000001007',
        status: 'failed',
        last_failure: { code: 'timeline_duration_unreasonable', sub_stage: 'timeline_check' },
      },
      project: {
        ...timelineProject,
        audio: { duration_sec: 61 },
      },
    });
    assert.equal(audioTooLongPlan.repair_action, 'repair_script_and_timeline');
  }

  {
    const rootDir = await tempRoot();
    const { workflowId } = await createRenderFailureFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(workflowId, { rootDir });
    assert.equal(plan.plan.repair_action, 'rerender_frames');
    assert.deepEqual(plan.plan.executor_options.frame_ids, ['scene_02']);

    const calls = {};
    const retried = await workflows.retryCreativeWorkflow(workflowId, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_render_timeout',
      services: {
        now: () => '2026-06-25T02:00:00.000Z',
        ...fakeHtmlVideoServices(calls),
      },
    });
    assert.equal(retried.success, true);
    assert.deepEqual(calls.renderFrameIds, ['scene_02']);
    assert.equal(calls.compose, 1);
    assert.equal(calls.visualInspect, 1);
  }

  {
    const rootDir = await tempRoot();
    const { workflowId } = await createComposeMismatchFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(workflowId, { rootDir });
    assert.equal(plan.plan.repair_action, 'recompose');

    const calls = {};
    const retried = await workflows.retryCreativeWorkflow(workflowId, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_recompose',
      services: {
        now: () => '2026-06-25T03:00:00.000Z',
        ...fakeHtmlVideoServices(calls),
      },
    });
    assert.equal(retried.success, true);
    assert.equal(calls.source, 0);
    assert.equal(calls.research, 0);
    assert.equal(calls.brief, 0);
    assert.equal(calls.audio, 0);
    assert.equal(calls.content_graph, 0);
    assert.equal(calls.retryFrameHtml || 0, 0);
    assert.equal(calls.renderFrame || 0, 0);
    assert.equal(calls.compose, 1);
  }

  {
    const rootDir = await tempRoot();
    const { workflowId, projectDir } = await createRenderFailureFixture(rootDir, '202606250000001012');
    const project = await projectStore.loadProject(projectDir);
    await fs.writeFile(path.join(projectDir, project.frames[1].html_path), '<img src="../assets/resume-render-evil.png">', 'utf8');
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(workflowId, { rootDir });
    const calls = {};
    const retried = await workflows.retryCreativeWorkflow(workflowId, {
      mode: 'repair_and_resume', confirm_plan_code: plan.plan.code, confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, { rootDir, retryAttemptId: 'retry_attempt_render_asset_gate', services: { ...fakeHtmlVideoServices(calls) } });
    assert.equal(retried.success, true, '静态引用扫描只做早诊断，最终裁决属于真实 renderer');
    assert.equal(calls.renderFrame, 1);
    assert.equal(calls.compose, 1);
    assert.equal(calls.visualInspect, 1);
  }

  {
    const rootDir = await tempRoot();
    const { workflowId, projectDir } = await createComposeMismatchFixture(rootDir, '202606250000001013');
    const project = await projectStore.loadProject(projectDir);
    await fs.writeFile(path.join(projectDir, project.frames[0].html_path), '<img src="../assets/resume-compose-evil.png">', 'utf8');
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(workflowId, { rootDir });
    const calls = {};
    const retried = await workflows.retryCreativeWorkflow(workflowId, {
      mode: 'repair_and_resume', confirm_plan_code: plan.plan.code, confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, { rootDir, retryAttemptId: 'retry_attempt_compose_asset_gate', services: { ...fakeHtmlVideoServices(calls) } });
    assert.equal(retried.success, false, 'compose-only 发现 HTML 漂移必须回到 runtime render');
    assert.equal(calls.compose || 0, 0);
    assert.equal(calls.visualInspect || 0, 0);
    const revalidationPlan = await workflows.refreshCreativeWorkflowRetryPlan(workflowId, { rootDir });
    assert.equal(revalidationPlan.plan.repair_action, 'rerender_frames');
    assert.deepEqual(revalidationPlan.plan.executor_options.frame_ids, ['scene_01']);
  }

  {
    for (const code of ['ffmpeg_not_configured', 'playwright_not_configured']) {
      const plan = createCreativeWorkflowRetryPlan({
        workflow: {
          workflow_id: code === 'ffmpeg_not_configured' ? '202606250000001008' : '202606250000001009',
          status: 'failed',
          last_failure: {
            code,
            sub_stage: 'validate_project',
            diagnostics: [createDiagnostic({ code, sub_stage: 'validate_project', fallback_allowed: false })],
          },
        },
        project: plannerProject(),
      });
      assert.equal(plan.can_retry, false);
      assert.equal(plan.fallback_allowed, false);
    }
  }

  {
    const registry = createCreativeTaskRegistry({ idFactory: () => 'active-e2e-task' });
    const activeTaskId = registry.createDetachedTask({
      workflowId: '202606250000001010',
      operationId: 'active-op',
      kind: 'creative_workflow',
    });
    const result = await workflowTasks.startCreativeWorkflowRetryTask('202606250000001010', {
      registry,
      services: {
        creativeWorkflows: {
          patchCreativeWorkflowTaskSummary: async () => {
            throw new Error('active guard 不应写入 workflow summary');
          },
          retryCreativeWorkflow: async () => {
            throw new Error('active guard 不应启动 retry');
          },
        },
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.message, '当前创作任务仍在运行，请等待结束后再重试。');
    assert.equal(result.active_task.task_id, activeTaskId);
    assert.equal(registry.getTask(activeTaskId).status, 'running');
  }

  console.log('creative workflow retry e2e tests passed');
})();
