const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const workflows = require('../server/services/creative/creativeWorkflows');
const workflowTasks = require('../server/services/creative/creativeWorkflowTasks');
const { createCreativeTaskRegistry } = require('../server/services/creative/creativeTaskRegistry');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { createEmptyProject, markCheckpointFrame, markCheckpointStage } = require('../server/services/creative-video/html-video/projectSchema');
const { createDiagnostic } = require('../server/services/creative-video/html-video/diagnostics');

const WORKFLOW_ID = '202606250000000701';

function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'creative-workflow-retry-task-'));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
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

function baseSceneSpec() {
  return {
    title: 'retry frame html',
    scenes: [{
      id: 'scene_01',
      order: 1,
      narration_text: '第一段旁白。',
      captions: [],
      visual_text: { headline: '第一幕' },
      duration_sec: 2,
    }],
  };
}

function createRetryProject() {
  const project = createEmptyProject({ workflowId: WORKFLOW_ID, runId: 'run-retry-task' });
  project.target = { duration_sec: 2, aspect_ratio: '9:16' };
  project.output = {
    duration: 2,
    aspect_ratio: '9:16',
    fps: 30,
    resolution: { width: 1080, height: 1920 },
  };
  project.scene_spec = baseSceneSpec();
  project.audio = { status: 'skipped', reason: 'disabled_by_settings' };
  project.content_graph = {
    nodes: [{ id: 'scene_01', kind: 'text', label: '第一幕', durationSec: 2, text: '第一幕' }],
    edges: [],
  };
  project.frames = [{
    id: 'scene_01',
    scene_id: 'scene_01',
    order: 1,
    engine: 'hyperframes-playwright',
    source_mode: 'raw_html',
    html_path: 'frames/01-scene_01.html',
    duration_sec: 2,
    captions: [],
  }];
  project.timeline = {
    tracks: [{ id: 'main', items: [{ id: 'scene_01', frame_id: 'scene_01', duration_sec: 2, start_sec: 0 }] }],
  };
  markCheckpointStage(project, 'content_graph', { status: 'done', path: 'content-graph.json' });
  markCheckpointFrame(project, 'frame_html', 'scene_01', {
    status: 'failed',
    html_path: 'frames/01-scene_01.html',
    diagnostic_code: 'provider_missing_text',
  });
  return project;
}

async function createFailedWorkflowFixture(rootDir) {
  const projectDir = path.join(rootDir, 'media', WORKFLOW_ID, 'agent_runs', 'run-retry-task-html-video');
  const project = createRetryProject();
  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'exports'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'inspect'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'frames', '01-scene_01.html'), '<html><body>old</body></html>', 'utf8');
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
  const record = {
    workflow_id: WORKFLOW_ID,
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
        scene_spec: baseSceneSpec(),
        frame_specs: {
          scene_01: { visual_text: { headline: '第一幕' } },
        },
      },
    },
    },
    retry: { version: 1, attempts: [], latest_plan: {} },
    last_failure: {
      stage: 'project',
      sub_stage: 'frame_html',
      code: 'provider_missing_text',
      frame_id: 'scene_01',
      project_dir: projectDir,
      message: '第 1 帧 HTML 生成失败。',
      diagnostics: [diagnostic],
      updated_at: '2026-06-25T00:00:00.000Z',
    },
  };
  await writeJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir), record);
  return { projectDir, previousFailure: record.last_failure };
}

async function createMissingRequiredAssetFailureFixture(rootDir) {
  const fixture = await createFailedWorkflowFixture(rootDir);
  const project = await projectStore.loadProject(fixture.projectDir);
  project.asset_usage_report = {
    assets: [{ asset_id: 'upload_required_scene', expected_in_frames: [] }],
    missing_required_asset_ids: ['upload_required_scene'],
  };
  markCheckpointStage(project, 'content_graph', {
    status: 'done',
    path: 'content-graph.json',
    input_hash: 'old-input',
    output_hash: 'old-output',
  });
  await fs.writeFile(path.join(fixture.projectDir, 'content-graph.json'), JSON.stringify(project.content_graph), 'utf8');
  await projectStore.saveProject(fixture.projectDir, project);

  const workflowPath = workflows.getWorkflowPath(WORKFLOW_ID, rootDir);
  const record = await readJson(workflowPath);
  record.creative_context = {
    input: { raw_text: 'Scene 1 使用 required.png', source_hint: '保留完整提示' },
    source_context: { summary: '完整来源上下文' },
    research_context: { summary: '完整研究上下文' },
    asset_context: { assets: [{ id: 'upload_required_scene', file_name: 'required.png', requirement: 'required' }] },
    brief: { summary: '完整策划上下文' },
    audio: { narration_text: '完整旁白上下文' },
    custom_nested: { keep: true },
  };
  record.last_failure = {
    stage: 'project',
    sub_stage: 'asset_usage',
    code: 'required_visual_asset_missing',
    project_dir: fixture.projectDir,
    message: '必用视觉素材未进入画面。',
    diagnostics: [createDiagnostic({
      code: 'required_visual_asset_missing',
      sub_stage: 'asset_usage',
      severity: 'error',
      retryable: true,
      repair_action: 'retry_frame_html',
      details: { missing_required_asset_ids: ['upload_required_scene'] },
    })],
  };
  await writeJson(workflowPath, record);
  return fixture;
}

async function createLayoutQaFailureFixture(rootDir) {
  const fixture = await createFailedWorkflowFixture(rootDir);
  const diagnostic = createDiagnostic({
    code: 'frame_layout_qa_unresolved',
    stage: 'ai-frame-html',
    sub_stage: 'frame_html',
    frame_id: 'scene_01',
    retryable: true,
    repair_action: 'retry_frame_html',
    user_message: '第 1 帧自动修复后仍存在布局遮挡。',
  });
  const workflowPath = workflows.getWorkflowPath(WORKFLOW_ID, rootDir);
  const record = await readJson(workflowPath);
  record.last_failure = {
    ...record.last_failure,
    code: 'frame_layout_qa_unresolved',
    message: '第 1 帧自动修复后仍存在布局遮挡。',
    diagnostics: [diagnostic],
  };
  await writeJson(workflowPath, record);
  const project = await projectStore.loadProject(fixture.projectDir);
  markCheckpointFrame(project, 'frame_html', 'scene_01', {
    status: 'failed',
    diagnostic_code: 'frame_layout_qa_unresolved',
  });
  await projectStore.saveProject(fixture.projectDir, project);
  return fixture;
}

async function createMissingProjectArtifactFixture(rootDir, options = {}) {
  const projectDir = path.join(rootDir, 'media', WORKFLOW_ID, 'agent_runs', 'missing-project-json');
  await fs.mkdir(projectDir, { recursive: true });
  const diagnostics = [];
  if (options.withProjectReadDiagnostic) {
    diagnostics.push(createDiagnostic({
      code: 'project_read_failed',
      sub_stage: 'validate_project',
      user_message: '读取 html-video 工程失败。',
      retryable: true,
      repair_action: 'restart_project',
    }));
  }
  if (options.withStaleFrameDiagnostic) {
    diagnostics.push(createDiagnostic({
      code: 'provider_missing_text',
      stage: 'ai-frame-html',
      sub_stage: 'frame_html',
      frame_id: 'scene_01',
      retryable: true,
      repair_action: 'retry_frame_html',
      user_message: '第 1 帧 HTML 生成时模型返回空内容。',
    }));
  }
  const record = {
    workflow_id: WORKFLOW_ID,
    success: false,
    status: 'failed',
    message: '工程校验失败。',
    stages: workflowStages('failed'),
    result: {
      hyperframes_freeform: {
        project: {
          render_mode: 'html-video',
          scene_spec: baseSceneSpec(),
        },
      },
    },
    retry: { version: 1, attempts: [], latest_plan: {} },
    error: {
      code: 'unknown_project_failure',
      sub_stage: 'validate_project',
      message: '读取 html-video 工程失败。',
    },
    last_failure: {
      stage: 'project',
      sub_stage: 'validate_project',
      code: 'unknown_project_failure',
      project_dir: projectDir,
      message: '读取 html-video 工程失败。',
      diagnostics,
      updated_at: '2026-06-25T00:00:00.000Z',
    },
  };
  await writeJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir), record);
  return { projectDir };
}

async function createVisualInspectFailureFixture(rootDir) {
  const projectDir = path.join(rootDir, 'media', WORKFLOW_ID, 'agent_runs', 'visual-inspect-html-video');
  const project = createRetryProject();
  const videoPath = path.join(projectDir, 'exports', 'output.mp4');
  const audioPath = path.join(projectDir, 'exports', 'output-audio.mp4');
  markCheckpointFrame(project, 'frame_html', 'scene_01', {
    status: 'done',
    html_path: 'frames/01-scene_01.html',
    diagnostic_code: '',
  });
  markCheckpointFrame(project, 'render', 'scene_01', {
    status: 'done',
    mp4_path: 'frames/scene_01.mp4',
    diagnostic_code: '',
  });
  markCheckpointStage(project, 'render', { status: 'done' });
  markCheckpointStage(project, 'compose', {
    status: 'done',
    output_path: 'exports/output.mp4',
    output_audio_path: 'exports/output-audio.mp4',
    diagnostic_code: '',
  });
  markCheckpointStage(project, 'visual_inspect', {
    status: 'failed',
    diagnostic_code: 'visual_inspect_failed',
  });
  project.exports = [];
  await fs.mkdir(path.join(projectDir, 'exports'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  await fs.writeFile(videoPath, 'video', 'utf8');
  await fs.writeFile(audioPath, 'audio', 'utf8');
  await projectStore.saveProject(projectDir, project);

  const record = {
    workflow_id: WORKFLOW_ID,
    success: false,
    status: 'failed',
    message: '视觉巡检失败。',
    stages: workflowStages('failed'),
    result: {
      hyperframes_freeform: {
        project: {
          render_mode: 'html-video',
          html_video_project_path: projectDir,
          project_dir: projectDir,
          scene_spec: baseSceneSpec(),
        },
      },
    },
    retry: { version: 1, attempts: [], latest_plan: {} },
    last_failure: {
      stage: 'project',
      sub_stage: 'visual_inspect',
      code: 'visual_inspect_failed',
      project_dir: projectDir,
      message: '视觉巡检失败。',
      diagnostics: [createDiagnostic({
        code: 'visual_inspect_failed',
        sub_stage: 'visual_inspect',
        retryable: true,
        repair_action: 'rerun_visual_inspect',
      })],
      updated_at: '2026-06-25T00:00:00.000Z',
    },
  };
  await writeJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir), record);
  return { projectDir, videoPath, audioPath };
}

async function createVisualQaWarningFailureFixture(rootDir) {
  const projectDir = path.join(rootDir, 'media', WORKFLOW_ID, 'agent_runs', 'visual-qa-warning-html-video');
  const project = createRetryProject();
  const videoPath = path.join(projectDir, 'exports', 'output.mp4');
  markCheckpointFrame(project, 'frame_html', 'scene_01', {
    status: 'done',
    html_path: 'frames/01-scene_01.html',
    diagnostic_code: '',
  });
  markCheckpointFrame(project, 'render', 'scene_01', {
    status: 'done',
    mp4_path: 'frames/scene_01.mp4',
    diagnostic_code: '',
  });
  markCheckpointStage(project, 'render', { status: 'done' });
  markCheckpointStage(project, 'compose', {
    status: 'done',
    output_path: 'exports/output.mp4',
    diagnostic_code: '',
  });
  markCheckpointStage(project, 'visual_inspect', {
    status: 'failed',
    report_path: 'inspect/visual-report.json',
    diagnostic_code: 'visual_qa_warning',
  });
  await fs.mkdir(path.join(projectDir, 'exports'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'inspect'), { recursive: true });
  await fs.writeFile(videoPath, 'video', 'utf8');
  await fs.writeFile(path.join(projectDir, 'frames', '01-scene_01.html'), '<html><body>old</body></html>', 'utf8');
  await projectStore.saveProject(projectDir, project);

  const record = {
    workflow_id: WORKFLOW_ID,
    success: false,
    status: 'failed',
    message: 'html-video 成片画面存在开头或镜头边界白屏，未通过视觉安全检查。',
    stages: workflowStages('failed'),
    result: {
      hyperframes_freeform: {
        project: {
          render_mode: 'html-video',
          html_video_project_path: projectDir,
          project_dir: projectDir,
          scene_spec: baseSceneSpec(),
        },
      },
    },
    retry: { version: 1, attempts: [], latest_plan: {} },
    last_failure: {
      stage: 'project',
      sub_stage: 'visual_inspect',
      code: 'visual_qa_warning',
      project_dir: projectDir,
      message: 'html-video 成片画面存在开头或镜头边界白屏，未通过视觉安全检查。',
      diagnostics: [createDiagnostic({
        code: 'visual_qa_warning',
        stage: 'inspect',
        sub_stage: 'visual_inspect',
        severity: 'error',
        user_message: '视觉质检失败。',
        details: {
          issues: [{ code: 'blank_opening_frame', message: '开头抽样帧接近空白。' }],
          metrics: { blank_timed_sample_count: 2 },
        },
      })],
      updated_at: '2026-06-25T00:00:00.000Z',
    },
  };
  await writeJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir), record);
  return { projectDir, videoPath };
}

function fakeHtmlVideoServices(calls = {}) {
  return {
    resumeActions: {
      retryFrameHtml: async ({ project, projectDir, frame_id }) => {
        calls.retryFrameHtml = (calls.retryFrameHtml || 0) + 1;
        const written = await projectStore.writeRawFrameHtml({
          projectDir,
          sceneId: frame_id,
          order: 1,
          html: '<html><body>new</body></html>',
          captions: [],
          durationSec: 2,
        });
        project.frames[0].html_path = written.html_path;
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
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, `mp4:${frame.id}`, 'utf8');
        return { success: true, output_path: outputPath, meta: {} };
      },
    },
    ffmpegComposer: {
      concatFramesWithFfmpeg: async (frames, outputPath) => {
        calls.compose = (calls.compose || 0) + 1;
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, frames.map(frame => frame.frame_id).join(','), 'utf8');
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

(async () => {
  assert.equal(typeof workflowTasks.startCreativeWorkflowRetryTask, 'function');

  {
    const registry = createCreativeTaskRegistry({ idFactory: () => 'active-task' });
    const activeTaskId = registry.createDetachedTask({
      workflowId: WORKFLOW_ID,
      operationId: 'active-op',
      kind: 'creative_workflow',
    });
    const result = await workflowTasks.startCreativeWorkflowRetryTask(WORKFLOW_ID, {
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
    assert.equal(result.workflow_id, WORKFLOW_ID);
    assert.equal(result.message, '当前创作任务仍在运行，请等待结束后再重试。');
    assert.equal(result.active_task.task_id, activeTaskId);
    assert.equal(registry.getTask(activeTaskId).status, 'running');
  }

  {
    const rootDir = await tempRoot();
    const { projectDir } = await createFailedWorkflowFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    const registry = createCreativeTaskRegistry({
      idFactory: () => 'retry-task-success',
      now: () => '2026-06-25T01:00:00.000Z',
    });
    const calls = {};
    const started = await workflowTasks.startCreativeWorkflowRetryTask(WORKFLOW_ID, {
      rootDir,
      registry,
      retryAttemptId: 'retry_attempt_success',
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
    assert.equal(started.retry_attempt_id, 'retry_attempt_success');
    await waitFor(() => assert.equal(registry.getTask(started.task_id).status, 'done'));

    const record = await readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
    assert.equal(record.operation, 'retry');
    assert.equal(record.retry_attempt_id, 'retry_attempt_success');
    assert.equal(record.status, 'done');
    assert.equal(record.last_failure, null);
    assert.equal(record.retry.attempts.at(-1).status, 'done');
    assert.equal(record.retry.attempts.at(-1).id, 'retry_attempt_success');
    assert.equal(record.stages.find(stage => stage.id === 'project').status, 'done');
    assert.equal(record.stages.find(stage => stage.id === 'check').status, 'skipped');
    assert.equal(record.stages.find(stage => stage.id === 'render').status, 'done');
    assert.equal(record.stages.find(stage => stage.id === 'inspect').status, 'done');
    assert.deepEqual(record.result.hyperframes_freeform.project.scene_spec, baseSceneSpec());
    assert.equal(record.result.hyperframes_freeform.project.frame_specs.scene_01.visual_text.headline, '第一幕');
    assert.equal(record.result.hyperframes_freeform.project.html_video_project_path, projectDir);
    assert.equal(record.result.hyperframes_freeform.project.project_dir, projectDir);
    assert.equal(calls.retryFrameHtml, 1);
    assert.equal(calls.renderFrame, 1);
    assert.equal(calls.compose, 1);
    assert.equal(calls.visualInspect, 1);
    assert.equal(calls.visualInspectArgs.projectDir, projectDir);
    assert.match(calls.visualInspectArgs.outputPath, /exports[\\/]output\.mp4$/);
    assert.equal(calls.visualInspectArgs.expectedAspectRatio, '9:16');
  }

  {
    const rootDir = await tempRoot();
    await createFailedWorkflowFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    let resumeCalls = 0;
    const result = await workflows.retryCreativeWorkflow(WORKFLOW_ID, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: 'f'.repeat(64),
    }, {
      rootDir,
      services: {
        resumeActions: {
          retryFrameHtml: async () => {
            resumeCalls += 1;
            return { success: true };
          },
        },
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.code, 'RETRY_PLAN_CODE_CHANGED');
    assert.equal(result.plan.plan_fingerprint, plan.plan.plan_fingerprint);
    assert.equal(resumeCalls, 0, '执行前计划指纹变化时不得调用 resumeExecutor');
  }

  {
    const rootDir = await tempRoot();
    const { projectDir } = await createFailedWorkflowFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    const calls = {};
    const result = await workflows.retryCreativeWorkflow(WORKFLOW_ID, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, {
      rootDir,
      services: {
        now: () => '2026-06-25T01:00:00.000Z',
        aiTextModel: {
          callTextModel: async () => ({
            success: true,
            model: { provider: 'test-provider', model_id: 'test-model' },
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
            text: '<html></html>',
          }),
        },
        htmlVideoWorkflow: {
          generateHtmlVideo: async args => {
            calls.generateHtmlVideo = (calls.generateHtmlVideo || 0) + 1;
            calls.generateArgs = args;
            await args.services.aiTextModel.callTextModel({
              audit: {
                agent: 'FrameHtmlAgent',
                stage: 'frame_html',
                sub_stage: 'frame_html',
                frame_id: 'scene_01',
                attempt: 1,
              },
              messages: [],
            });
            const project = await projectStore.loadProject(projectDir);
            project.frames[0].html_path = 'frames/01-scene_01.html';
            markCheckpointFrame(project, 'frame_html', 'scene_01', {
              status: 'done',
              html_path: 'frames/01-scene_01.html',
              output_hash: 'new-hash',
              diagnostic_code: '',
            });
            return {
              success: true,
              project,
              project_dir: projectDir,
              html_video_project_path: projectDir,
              output_path: path.join(projectDir, 'exports', 'output.mp4'),
              message: 'html-video 已恢复。',
            };
          },
        },
        materializer: {
          materializeProject: async () => {
            throw new Error('默认 retryFrameHtml 返回成片后不应再次 materialize');
          },
        },
        frameRenderer: {
          renderFrame: async () => {
            throw new Error('默认 retryFrameHtml 返回成片后不应再次 render');
          },
        },
        ffmpegComposer: {
          concatFramesWithFfmpeg: async () => {
            throw new Error('默认 retryFrameHtml 返回成片后不应再次 compose');
          },
        },
      },
    });
    assert.equal(result.success, true);
    assert.equal(calls.generateHtmlVideo, 1);
    assert.equal(calls.generateArgs.workflowId, WORKFLOW_ID);
    assert.equal(calls.generateArgs.runId, 'run-retry-task');
    assert.equal(calls.generateArgs.reuseContentGraph, true);
    assert.equal(calls.generateArgs.projectOptions.reuseContentGraph, true);
    assert.equal(result.data.model_calls.at(-1).stage, 'frame_html');
    assert.equal(result.data.model_calls.at(-1).model.model_id, 'test-model');
    assert.equal(result.output_path, path.join(projectDir, 'exports', 'output.mp4'));
  }

  {
    const rootDir = await tempRoot();
    const { projectDir } = await createMissingProjectArtifactFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    assert.equal(plan.success, true);
    assert.equal(plan.project_dir, projectDir);
    assert.equal(plan.plan.can_retry, true);
    assert.equal(plan.plan.repair_action, 'restart_project');

    const calls = {};
    const restarted = createRetryProject();
    markCheckpointFrame(restarted, 'frame_html', 'scene_01', {
      status: 'done',
      html_path: 'frames/01-scene_01.html',
      diagnostic_code: '',
    });
    const result = await workflows.retryCreativeWorkflow(WORKFLOW_ID, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_restart_project',
      services: {
        now: () => '2026-06-25T03:00:00.000Z',
        ...fakeHtmlVideoServices(calls),
        resumeActions: {
          restartProject: async ({ project, projectDir: actionProjectDir, projectLoadError }) => {
            calls.restartProject = (calls.restartProject || 0) + 1;
            assert.equal(project, null);
            assert.equal(actionProjectDir, projectDir);
            assert.match(projectLoadError.message, /project\.json|ENOENT|no such file/i);
            await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
            await fs.writeFile(path.join(projectDir, 'frames', '01-scene_01.html'), '<html><body>restart</body></html>', 'utf8');
            return { success: true, project: restarted };
          },
        },
      },
    });
    assert.equal(result.success, true);

    const record = await readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
    assert.equal(record.status, 'done');
    assert.equal(record.last_failure, null);
    assert.equal(record.retry.attempts.at(-1).status, 'done');
    assert.equal(calls.restartProject, 1);
    assert.equal(calls.renderFrame, 1);
    assert.equal(calls.compose, 1);
    assert.equal(calls.visualInspect, 1);
  }

  {
    const rootDir = await tempRoot();
    const { projectDir } = await createLayoutQaFailureFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    const calls = {};
    const result = await workflows.retryCreativeWorkflow(WORKFLOW_ID, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
      ignore_layout_qa_once: true,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_ignore_layout_qa',
      services: {
        now: () => '2026-06-25T03:30:00.000Z',
        htmlVideoWorkflow: {
          generateHtmlVideo: async args => {
            calls.generateArgs = args;
            const project = await projectStore.loadProject(projectDir);
            markCheckpointFrame(project, 'frame_html', 'scene_01', {
              status: 'done',
              html_path: 'frames/01-scene_01.html',
              diagnostic_code: '',
            });
            return {
              success: true,
              project,
              project_dir: projectDir,
              html_video_project_path: projectDir,
              output_path: path.join(projectDir, 'exports', 'output.mp4'),
            };
          },
        },
      },
    });
    assert.equal(result.success, true);
    assert.equal(calls.generateArgs.runLayoutQa, true);
    assert.deepEqual(calls.generateArgs.ignoreLayoutQaFrameIds, ['scene_01']);
    const record = await readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
    assert.equal(record.retry.attempts.at(-1).ignore_layout_qa_once, true);
  }

  {
    const rootDir = await tempRoot();
    const { projectDir } = await createMissingProjectArtifactFixture(rootDir, { withProjectReadDiagnostic: true });
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    assert.equal(plan.success, true);
    assert.equal(plan.project_dir, projectDir);
    assert.equal(plan.plan.repair_action, 'restart_project');
  }

  {
    const rootDir = await tempRoot();
    const { projectDir } = await createMissingProjectArtifactFixture(rootDir, { withStaleFrameDiagnostic: true });
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    assert.equal(plan.success, true);
    assert.equal(plan.project_dir, projectDir);
    assert.equal(plan.plan.repair_action, 'restart_project');
    assert.notEqual(plan.plan.code, 'provider_missing_text');
  }

  {
    const rootDir = await tempRoot();
    const { videoPath, audioPath } = await createVisualInspectFailureFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    assert.equal(plan.success, true);
    assert.equal(plan.plan.repair_action, 'rerun_visual_inspect');

    const calls = {};
    const result = await workflows.retryCreativeWorkflow(WORKFLOW_ID, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_visual_inspect',
      services: {
        now: () => '2026-06-25T04:00:00.000Z',
        ...fakeHtmlVideoServices(calls),
      },
    });
    assert.equal(result.success, true);
    assert.equal(calls.visualInspect, 1);
    assert.equal(path.resolve(calls.visualInspectArgs.outputPath), path.resolve(videoPath));
    assert.notEqual(path.resolve(calls.visualInspectArgs.outputPath), path.resolve(audioPath));
    assert.equal(calls.renderFrame || 0, 0);
    assert.equal(calls.compose || 0, 0);
  }

  {
    const rootDir = await tempRoot();
    const { projectDir } = await createVisualQaWarningFailureFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    assert.equal(plan.success, true);
    assert.equal(plan.plan.code, 'visual_qa_warning');
    assert.equal(plan.plan.repair_action, 'retry_frame_html');
    assert.equal(plan.plan.executor_options.regenerate_frame_html, true);

    const calls = {};
    const result = await workflows.retryCreativeWorkflow(WORKFLOW_ID, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_visual_qa_warning',
      services: {
        now: () => '2026-06-25T04:30:00.000Z',
        htmlVideoWorkflow: {
          generateHtmlVideo: async args => {
            calls.generateHtmlVideo = (calls.generateHtmlVideo || 0) + 1;
            calls.generateArgs = args;
            const project = await projectStore.loadProject(projectDir);
            markCheckpointStage(project, 'visual_inspect', {
              status: 'done',
              report_path: 'inspect/visual-report.json',
              diagnostic_code: '',
            });
            await projectStore.saveProject(projectDir, project);
            return {
              success: true,
              project,
              project_dir: projectDir,
              html_video_project_path: projectDir,
              output_path: path.join(projectDir, 'exports', 'output.mp4'),
              visualInspectResult: { success: true, issues: [], metrics: {}, report_path: 'inspect/visual-report.json' },
            };
          },
        },
      },
    });
    assert.equal(result.success, true);
    assert.equal(calls.generateHtmlVideo, 1);
    assert.equal(calls.generateArgs.reuseContentGraph, true);
    // 计划带定向 frame_ids：不再全局禁用复用，由定向失效的 checkpoint 驱动只重生成目标帧
    assert.equal(calls.generateArgs.regenerateFrameHtml, false);
    assert.equal(calls.generateArgs.projectOptions.regenerateFrameHtml, false);
    const retriedProject = await projectStore.loadProject(projectDir);
    assert.equal(
      retriedProject.generation_checkpoint.stages.frame_html.frames.scene_01.status,
      'pending',
      '目标帧的 frame_html checkpoint 应被定向失效',
    );
    assert.equal(
      retriedProject.generation_checkpoint.stages.render.frames.scene_01.status,
      'pending',
      '目标帧的 render checkpoint 应被定向失效',
    );
  }

  {
    const rootDir = await tempRoot();
    await createFailedWorkflowFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    const registry = createCreativeTaskRegistry({
      idFactory: () => 'retry-task-business-failed',
      now: () => '2026-06-25T02:30:00.000Z',
    });
    const started = await workflowTasks.startCreativeWorkflowRetryTask(WORKFLOW_ID, {
      rootDir,
      registry,
      retryAttemptId: 'retry_attempt_business_failed',
      payload: { mode: 'repair_and_resume', confirm_plan_code: plan.plan.code, confirm_plan_fingerprint: plan.plan.plan_fingerprint },
      workflowOptions: {
        rootDir,
        services: {
          now: () => '2026-06-25T02:30:00.000Z',
          resumeActions: {
            retryFrameHtml: async () => ({
              success: false,
              message: '模型仍然没有返回 HTML。',
              diagnostics: [createDiagnostic({
                code: 'frame_html_invalid',
                sub_stage: 'frame_html',
                frame_id: 'scene_01',
                user_message: '模型仍然没有返回 HTML。',
                retryable: true,
                repair_action: 'retry_frame_html',
              })],
            }),
          },
        },
      },
    });
    assert.equal(started.success, true);
    await waitFor(() => assert.equal(registry.getTask(started.task_id).status, 'failed'));

    const record = await readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
    assert.equal(record.status, 'failed');
    assert.equal(record.error.code, 'frame_html_invalid');
    assert.equal(record.error.sub_stage, 'frame_html');
    assert.equal(record.last_failure.code, 'frame_html_invalid');
    assert.equal(record.last_failure.sub_stage, 'frame_html');
    assert.equal(record.last_failure.diagnostics[0].code, 'frame_html_invalid');
  }

  {
    const rootDir = await tempRoot();
    const { previousFailure } = await createFailedWorkflowFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    const failed = await workflows.retryCreativeWorkflow(WORKFLOW_ID, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, {
      rootDir,
      services: {
        now: () => '2026-06-25T02:00:00.000Z',
        resumeActions: {
          retryFrameHtml: async () => ({
            success: false,
            message: '模型仍然没有返回 HTML。',
            diagnostics: [createDiagnostic({
              code: 'frame_html_invalid',
              sub_stage: 'frame_html',
              frame_id: 'scene_01',
              user_message: '模型仍然没有返回 HTML。',
              retryable: true,
              repair_action: 'retry_frame_html',
            })],
          }),
        },
      },
      retryAttemptId: 'retry_attempt_failed',
    });
    assert.equal(failed.success, false);

    const record = await readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
    const lastAttempt = record.retry.attempts.at(-1);
    assert.equal(lastAttempt.status, 'failed');
    assert.deepEqual(lastAttempt.previous_failure, previousFailure);
    assert.equal(record.last_failure.code, 'frame_html_invalid');
    assert.equal(record.last_failure.message, '模型仍然没有返回 HTML。');
    assert.equal(record.last_failure.diagnostics[0].code, 'frame_html_invalid');
    assert.equal(record.project_substages.some(stage => stage.id === 'frame_html' && stage.status === 'failed'), true);
  }

  // P1-1b：workflow 无 creative_context continuity_mode 时，defaultRetryFrameHtmlAction
  // 必须从落盘 project 回填 continuity_mode。
  {
    assert.equal(
      workflows.resolveRetryContinuityMode(
        { creative_context: { continuity_mode: 'scene_html' } },
        { continuity_mode: 'beat_mp4' },
      ).continuity_mode,
      'scene_html',
      'workflow 显式 continuity_mode 优先',
    );
    assert.deepEqual(
      workflows.resolveRetryContinuityMode({}, { continuity_mode: 'scene_html' }),
      { continuity_mode: 'scene_html' },
      'workflow 缺 continuity_mode 时回填落盘 project 的值',
    );
    assert.deepEqual(
      workflows.resolveRetryContinuityMode({}, {}),
      { continuity_mode: null },
      '两边都没有时为 null，交由下游默认 beat_mp4',
    );

    let captured = null;
    const result = await workflows.defaultRetryFrameHtmlAction({
      workflow: { workflow_id: 'wf-retry-strategy' },
      project: {
        run_id: 'run-retry-strategy',
        continuity_mode: 'scene_html',
      },
      projectDir: path.join(os.tmpdir(), 'wf-retry-strategy', 'agent_runs', 'run-retry-strategy-html-video'),
      services: {
        htmlVideoWorkflow: {
          generateHtmlVideo: async args => {
            captured = args;
            return { success: true, project: {}, message: 'ok' };
          },
        },
      },
    });
    assert.equal(result.success, true);
    assert.ok(captured, '应调用 generateHtmlVideo');
    assert.equal(captured.creativeContext.continuity_mode, 'scene_html',
      'P1-1b：retry 必须透传落盘 continuity_mode');
  }

  // P1-6：默认 retryFrameHtml 返回 generateHtmlVideo 结果（字段名 visual_report）时，
  // retry 汇总必须能读到并把 warnings 透出到 record.result 的 visual_inspect。
  {
    const rootDir = await tempRoot();
    const { projectDir } = await createVisualQaWarningFailureFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    const result = await workflows.retryCreativeWorkflow(WORKFLOW_ID, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_visual_report_warnings',
      services: {
        now: () => '2026-06-25T05:00:00.000Z',
        htmlVideoWorkflow: {
          generateHtmlVideo: async () => {
            const project = await projectStore.loadProject(projectDir);
            markCheckpointStage(project, 'visual_inspect', {
              status: 'done',
              report_path: 'inspect/visual-report.json',
              diagnostic_code: '',
            });
            await projectStore.saveProject(projectDir, project);
            return {
              success: true,
              project,
              project_dir: projectDir,
              html_video_project_path: projectDir,
              output_path: path.join(projectDir, 'exports', 'output.mp4'),
              visual_report: {
                success: true,
                issues: [],
                metrics: {},
                report_path: 'inspect/visual-report.json',
                warnings: [{
                  code: 'asset_first_style_drift',
                  severity: 'warning',
                  message: '相邻画面风格漂移超过阈值。',
                  details: { scene_id: 'scene_01', time: 1.2, score: 0.6 },
                }],
              },
            };
          },
        },
      },
    });
    assert.equal(result.success, true);
    const record = await readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
    const inspect = record.result.hyperframes_freeform.visual_inspect;
    assert.equal(inspect.status, 'done', 'warnings 非阻断，status 不降级');
    assert.equal(inspect.warnings.length, 1, 'visual_report.warnings 必须透出到汇总');
    assert.equal(inspect.warnings[0].code, 'asset_first_style_drift');
    assert.equal(inspect.warnings[0].details.scene_id, 'scene_01');
    assert.match(inspect.message, /1 条观察告警/);
  }

  // required 素材无 expected frame 时必须走默认 retryContentGraph：失效旧 Graph、
  // 透传完整 creative_context，并复用 generateHtmlVideo 的完整成片输出，禁止二次 render/compose。
  {
    const rootDir = await tempRoot();
    const { projectDir } = await createMissingRequiredAssetFailureFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    assert.equal(plan.plan.repair_action, 'retry_content_graph');
    let captured = null;
    let generateCalls = 0;
    const result = await workflows.retryCreativeWorkflow(WORKFLOW_ID, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_required_graph',
      services: {
        now: () => '2026-06-25T05:30:00.000Z',
        htmlVideoWorkflow: {
          generateHtmlVideo: async args => {
            generateCalls += 1;
            captured = args;
            const invalidated = await projectStore.loadProject(projectDir);
            assert.equal(invalidated.generation_checkpoint.stages.content_graph.status, 'pending');
            assert.equal(invalidated.generation_checkpoint.stages.content_graph.path, '');
            assert.deepEqual(invalidated.content_graph.nodes, []);
            return {
              success: true,
              project: invalidated,
              project_dir: projectDir,
              html_video_project_path: projectDir,
              output_path: path.join(projectDir, 'exports', 'output.mp4'),
              visual_report: { success: true, issues: [], metrics: {}, report_path: 'inspect/visual-report.json' },
            };
          },
        },
        materializer: { materializeProject: async () => { throw new Error('完整输出后不应再次 materialize'); } },
        frameRenderer: { renderFrame: async () => { throw new Error('完整输出后不应再次 render'); } },
        ffmpegComposer: { concatFramesWithFfmpeg: async () => { throw new Error('完整输出后不应再次 compose'); } },
      },
    });
    assert.equal(result.success, true);
    assert.equal(generateCalls, 1, '默认 retryContentGraph action 必须已注册且只调用一次');
    assert.equal(captured.reuseContentGraph, false);
    assert.equal(captured.projectOptions.reuseContentGraph, false);
    assert.equal(captured.regenerateFrameHtml, true);
    assert.equal(captured.projectOptions.regenerateFrameHtml, true);
    assert.equal(captured.creativeContext.input.source_hint, '保留完整提示');
    assert.equal(captured.creativeContext.source_context.summary, '完整来源上下文');
    assert.equal(captured.creativeContext.research_context.summary, '完整研究上下文');
    assert.equal(captured.creativeContext.brief.summary, '完整策划上下文');
    assert.equal(captured.creativeContext.audio.narration_text, '完整旁白上下文');
    assert.deepEqual(captured.creativeContext.custom_nested, { keep: true });
  }

  // 既有 P1：resume 的 rerun_visual_inspect 巡检出阻断白屏时必须返回失败，
  // 不能把白屏成片标成"恢复完成"。
  {
    const rootDir = await tempRoot();
    const { projectDir } = await createVisualInspectFailureFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    assert.equal(plan.plan.repair_action, 'rerun_visual_inspect');
    const calls = {};
    const services = fakeHtmlVideoServices(calls);
    services.visualQaService = {
      inspectRenderedVideo: async () => ({
        success: false,
        message: '开头抽样帧接近空白。',
        issues: [{ code: 'blank_opening_frame', message: '开头抽样帧接近空白。', times: [0.2] }],
        metrics: { blank_timed_sample_count: 2 },
        report_path: 'inspect/visual-report.json',
      }),
    };
    const result = await workflows.retryCreativeWorkflow(WORKFLOW_ID, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_blocking_inspect',
      services: { now: () => '2026-06-25T06:00:00.000Z', ...services },
    });
    assert.equal(result.success, false, '阻断白屏不能返回成功');
    const record = await readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
    assert.equal(record.status, 'failed');
    // 诊断 code 与主流程字面一致（visual_qa_warning），retryPlanner 才会给出重生成镜头的计划
    assert.equal(record.last_failure.code, 'visual_qa_warning');
    assert.equal(record.retry.attempts.at(-1).status, 'failed');
    const project = await projectStore.loadProject(projectDir);
    assert.equal(
      project.generation_checkpoint.stages.visual_inspect.status,
      'failed',
      '阻断白屏时 checkpoint 应写 failed 而不是 warning',
    );
    // 阻断失败后的下一轮 retry plan 必须是 retry_frame_html（重生成镜头），
    // 而不是 rerun_visual_inspect（对同一份白屏成片反复巡检不收敛）
    const nextPlan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    assert.equal(nextPlan.success, true);
    assert.equal(nextPlan.plan.repair_action, 'retry_frame_html', '阻断白屏后应重生成镜头而不是死循环重巡检');
  }

  // 既有 P1：compose 后巡检（composeAndInspect 路径）阻断白屏同样返回失败
  {
    const rootDir = await tempRoot();
    const { projectDir } = await createFailedWorkflowFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    const calls = {};
    const services = fakeHtmlVideoServices(calls);
    services.visualQaService = {
      inspectRenderedVideo: async () => ({
        success: false,
        issues: [{ code: 'blank_segment_boundary', message: '镜头边界抽样帧接近空白。', boundary_sec: 1.9 }],
        metrics: {},
        report_path: 'inspect/visual-report.json',
      }),
    };
    const result = await workflows.retryCreativeWorkflow(WORKFLOW_ID, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_blocking_compose',
      services: { now: () => '2026-06-25T06:30:00.000Z', ...services },
    });
    assert.equal(result.success, false);
    const record = await readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
    assert.equal(record.last_failure.code, 'visual_qa_warning');
    const project = await projectStore.loadProject(projectDir);
    assert.equal(project.generation_checkpoint.stages.visual_inspect.status, 'failed');
    // 阻断失败后下一轮 retry plan 收敛到重生成镜头
    const nextPlan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    assert.equal(nextPlan.plan.repair_action, 'retry_frame_html');
  }

  // 回归：巡检 success=false 但不含阻断 code（仅参考性问题）时，resume 仍按 warning 语义成功
  {
    const rootDir = await tempRoot();
    const { projectDir } = await createVisualInspectFailureFixture(rootDir);
    const plan = await workflows.refreshCreativeWorkflowRetryPlan(WORKFLOW_ID, { rootDir });
    const calls = {};
    const services = fakeHtmlVideoServices(calls);
    services.visualQaService = {
      inspectRenderedVideo: async () => ({
        success: false,
        issues: [{ code: 'aspect_ratio_mismatch', message: '成片宽高比与目标不一致。' }],
        metrics: {},
        report_path: 'inspect/visual-report.json',
      }),
    };
    const result = await workflows.retryCreativeWorkflow(WORKFLOW_ID, {
      mode: 'repair_and_resume',
      confirm_plan_code: plan.plan.code,
      confirm_plan_fingerprint: plan.plan.plan_fingerprint,
    }, {
      rootDir,
      retryAttemptId: 'retry_attempt_nonblocking_inspect',
      services: { now: () => '2026-06-25T07:00:00.000Z', ...services },
    });
    assert.equal(result.success, true, '非阻断的巡检失败维持 warning 语义，不阻断恢复');
    const project = await projectStore.loadProject(projectDir);
    assert.equal(project.generation_checkpoint.stages.visual_inspect.status, 'warning');
  }

  console.log('creative workflow retry task tests passed');
})();
