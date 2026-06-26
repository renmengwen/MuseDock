const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const creativeWorkflows = require('../server/services/creativeWorkflows');
const {
  classifyCreativeWorkflowFailure,
  createCreativeWorkflowRetryPlan,
} = require('../server/services/creative-video/retryPlanner');
const { createDiagnostic } = require('../server/services/creative-video/html-video/diagnostics');
const { createEmptyProject, markCheckpointFrame, markCheckpointStage } = require('../server/services/creative-video/html-video/projectSchema');

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function workflow(overrides = {}) {
  return {
    workflow_id: '202606250000000001',
    status: 'failed',
    error: {},
    result: {
      hyperframes_freeform: {
        project: {
          scene_spec: {
            title: '测试脚本',
            scenes: [{ id: 'scene_01', narration_text: '第一段旁白。' }],
          },
        },
      },
    },
    ...overrides,
  };
}

function project(overrides = {}) {
  return {
    ...createEmptyProject({ workflowId: '202606250000000001', runId: 'run-retry-plan' }),
    ...overrides,
  };
}

(async () => {
  const frameDiagnostic = createDiagnostic({
    code: 'provider_missing_text',
    stage: 'ai-frame-html',
    sub_stage: 'frame_html',
    frame_id: 'scene_05',
    retryable: true,
    repair_action: 'retry_frame_html',
  });
  const framePlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        stage: 'project',
        sub_stage: 'frame_html',
        code: 'provider_missing_text',
        frame_id: 'scene_05',
        diagnostics: [frameDiagnostic],
      },
    }),
    project: project(),
  });
  assert.equal(framePlan.can_retry, true);
  assert.equal(framePlan.mode, 'repair_and_resume');
  assert.equal(framePlan.repair_action, 'retry_frame_html');
  assert.equal(framePlan.retry_from, 'frame_html');

  const workflowErrorFramePlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      error: { code: 'provider_missing_text' },
    }),
    project: project(),
  });
  assert.equal(workflowErrorFramePlan.can_retry, true);
  assert.equal(workflowErrorFramePlan.repair_action, 'retry_frame_html');
  assert.equal(workflowErrorFramePlan.retry_from, 'frame_html');
  assert.equal(workflowErrorFramePlan.code, 'provider_missing_text');

  const contentGraphFailure = {
    stage: 'project',
    sub_stage: 'content_graph',
    code: 'content_graph_invalid',
    message: 'AI 未返回 content graph JSON。',
    diagnostics: [createDiagnostic({
      code: 'content_graph_invalid',
      stage: 'ai-content-graph',
      sub_stage: 'content_graph',
      retryable: true,
      repair_action: 'retry_content_graph',
      user_message: 'AI 未返回 content graph JSON。',
    })],
  };
  const contentGraphPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({ last_failure: contentGraphFailure }),
    project: project(),
  });
  assert.equal(contentGraphPlan.can_retry, true);
  assert.equal(contentGraphPlan.repair_action, 'retry_content_graph');

  const fallbackPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: contentGraphFailure,
      retry: {
        version: 1,
        attempts: [{
          repair_action: 'retry_content_graph',
          status: 'failed',
        }],
      },
    }),
    project: project(),
  });
  assert.equal(fallbackPlan.can_retry, true);
  assert.equal(fallbackPlan.repair_action, 'fallback_scene_spec_graph');

  const trailingCommaPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        stage: 'project',
        sub_stage: 'content_graph',
        code: 'content_graph_invalid',
        diagnostics: [{
          code: 'content_graph_invalid',
          sub_stage: 'content_graph',
          details: {
            raw_response: '{"nodes":[{"id":"scene_01","kind":"text","label":"A","durationSec":2,"text":"A",}],}',
          },
        }],
      },
    }),
    project: project(),
  });
  assert.equal(trailingCommaPlan.can_retry, false);
  assert.notEqual(trailingCommaPlan.repair_action, 'retry_content_graph');

  const timelineProject = project({
    output: { duration: 60 },
    frames: [
      { id: 'scene_01', scene_id: 'scene_01', html_path: 'frames/01.html', duration_sec: 66 },
      { id: 'scene_02', scene_id: 'scene_02', html_path: 'frames/02.html', duration_sec: 66 },
    ],
    audio: { duration_sec: 55 },
  });
  const timelinePlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: { code: 'timeline_duration_unreasonable', sub_stage: 'timeline_check' },
    }),
    project: timelineProject,
  });
  assert.equal(timelinePlan.repair_action, 'repair_timeline');

  const audioTooLongPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: { code: 'timeline_duration_unreasonable', sub_stage: 'timeline_check' },
    }),
    project: {
      ...timelineProject,
      audio: { duration_sec: 61 },
    },
  });
  assert.equal(audioTooLongPlan.repair_action, 'repair_script_and_timeline');

  const renderProject = project();
  markCheckpointFrame(renderProject, 'render', 'scene_01', { status: 'done', mp4_path: 'frames/scene_01.mp4' });
  markCheckpointFrame(renderProject, 'render', 'scene_04', { status: 'failed', diagnostic_code: 'render_failed_timeout' });
  const renderPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: { code: 'render_failed_timeout', sub_stage: 'render', frame_id: 'scene_04' },
    }),
    project: renderProject,
  });
  assert.equal(renderPlan.repair_action, 'rerender_frames');
  assert.deepEqual(renderPlan.executor_options.frame_ids, ['scene_04']);

  const unknownRenderPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: { code: 'unknown_project_failure', sub_stage: 'render' },
    }),
    project: project(),
  });
  assert.equal(unknownRenderPlan.can_retry, false);
  assert.equal(unknownRenderPlan.code, 'unknown_project_failure');
  assert.equal(unknownRenderPlan.repair_action, '');

  const unknownComposePlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      error: { code: 'unknown_project_failure', sub_stage: 'compose' },
    }),
    project: project(),
  });
  assert.equal(unknownComposePlan.can_retry, false);
  assert.equal(unknownComposePlan.code, 'unknown_project_failure');
  assert.equal(unknownComposePlan.repair_action, '');

  const composePlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: { code: 'duration_mismatch', sub_stage: 'duration_verify' },
    }),
    project: project(),
  });
  assert.equal(composePlan.repair_action, 'recompose');

  const composeDurationMessagePlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      error: { message: 'compose duration mismatch' },
    }),
    project: project(),
  });
  assert.equal(composeDurationMessagePlan.repair_action, 'recompose');
  assert.notEqual(composeDurationMessagePlan.repair_action, 'repair_timeline');
  assert.equal(composeDurationMessagePlan.code, 'duration_mismatch');

  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'creative-workflow-retry-planner-'));
  const projectDir = path.join(rootDir, 'project');
  const validateProject = project();
  markCheckpointStage(validateProject, 'validate_project', {
    status: 'failed',
    diagnostic_code: 'project_invalid',
  });
  await writeJson(path.join(projectDir, 'project.json'), validateProject);
  const workflowId = '202606250000000009';
  const workflowRecord = workflow({
    workflow_id: workflowId,
    result: {},
    last_failure: {
      stage: 'project',
      project_dir: projectDir,
      message: '工程校验失败。',
    },
  });
  await writeJson(creativeWorkflows.getWorkflowPath(workflowId, rootDir), workflowRecord);
  assert.equal(creativeWorkflows.extractHtmlVideoProjectPathFromWorkflow(workflowRecord), projectDir);

  const readPlan = await creativeWorkflows.getCreativeWorkflowRetryPlan(workflowId, { rootDir });
  assert.equal(readPlan.success, true);
  assert.equal(readPlan.plan.can_retry, true);
  assert.equal(readPlan.plan.repair_action, 'restart_project');
  assert.notEqual(readPlan.plan.code, 'unknown_project_failure');

  const afterRead = JSON.parse(await fs.readFile(creativeWorkflows.getWorkflowPath(workflowId, rootDir), 'utf8'));
  assert.equal(afterRead.retry, undefined);
  const refreshed = await creativeWorkflows.refreshCreativeWorkflowRetryPlan(workflowId, { rootDir });
  assert.equal(refreshed.success, true);
  const afterRefresh = JSON.parse(await fs.readFile(creativeWorkflows.getWorkflowPath(workflowId, rootDir), 'utf8'));
  assert.equal(afterRefresh.retry.latest_plan.repair_action, 'restart_project');

  const unknownLastFailureCheckpointPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        code: 'unknown_project_failure',
      },
    }),
    project: validateProject,
  });
  assert.equal(unknownLastFailureCheckpointPlan.repair_action, 'restart_project');
  assert.notEqual(unknownLastFailureCheckpointPlan.code, 'unknown_project_failure');

  const unknownWorkflowErrorCheckpointPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      error: {
        code: 'unknown_project_failure',
      },
    }),
    project: validateProject,
  });
  assert.equal(unknownWorkflowErrorCheckpointPlan.repair_action, 'restart_project');
  assert.notEqual(unknownWorkflowErrorCheckpointPlan.code, 'unknown_project_failure');
  assert.equal(unknownWorkflowErrorCheckpointPlan.can_retry, true);

  const workflowErrorCodePlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      error: { code: 'ffmpeg_not_configured' },
      last_failure: { code: 'render_failed_timeout', sub_stage: 'render', frame_id: 'scene_04' },
    }),
    project: project(),
  });
  assert.equal(workflowErrorCodePlan.code, 'ffmpeg_not_configured');
  assert.equal(workflowErrorCodePlan.can_retry, false);
  assert.equal(workflowErrorCodePlan.fallback_allowed, false);

  const workflowErrorMessagePlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      error: { message: 'Playwright Chromium 未配置，无法渲染 html-video。' },
      last_failure: { code: 'render_failed_timeout', sub_stage: 'render', frame_id: 'scene_04' },
    }),
    project: project(),
  });
  assert.equal(workflowErrorMessagePlan.code, 'playwright_not_configured');
  assert.equal(workflowErrorMessagePlan.can_retry, false);
  assert.equal(workflowErrorMessagePlan.fallback_allowed, false);

  for (const code of ['ffmpeg_not_configured', 'playwright_not_configured']) {
    const envPlan = createCreativeWorkflowRetryPlan({
      workflow: workflow({
        last_failure: {
          code,
          diagnostics: [createDiagnostic({ code, sub_stage: 'validate_project', fallback_allowed: false })],
        },
      }),
      project: project(),
    });
    assert.equal(envPlan.can_retry, false);
    assert.equal(envPlan.fallback_allowed, false);
    assert.match(envPlan.user_message, /无法自动重试/);
  }

  const unknown = classifyCreativeWorkflowFailure({ workflow: workflow({ last_failure: { message: '未知失败' } }), project: project() });
  assert.equal(unknown.code, 'unknown_project_failure');

  console.log('creative workflow retry planner tests passed');
})();
