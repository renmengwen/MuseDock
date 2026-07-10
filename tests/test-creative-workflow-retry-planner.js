const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const creativeWorkflows = require('../server/services/creative/creativeWorkflows');
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

  const layoutQaPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        stage: 'project',
        sub_stage: 'layout_qa',
        code: 'layout_qa_failed',
        frame_id: 'scene_07',
        diagnostics: [createDiagnostic({
          code: 'layout_qa_failed',
          stage: 'project',
          sub_stage: 'layout_qa',
          frame_id: 'scene_07',
          retryable: true,
          repair_action: 'retry_frame_html',
        })],
      },
    }),
    project: project(),
  });
  assert.equal(layoutQaPlan.can_retry, true);
  assert.equal(layoutQaPlan.repair_action, 'retry_frame_html');
  assert.equal(layoutQaPlan.retry_from, 'frame_html');
  assert.ok(layoutQaPlan.discard.includes('frames:scene_07'));

  const visualQaPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        stage: 'project',
        sub_stage: 'visual_inspect',
        code: 'visual_qa_warning',
        message: 'html-video 成片画面存在开头或镜头边界白屏，未通过视觉安全检查。',
        diagnostics: [
          createDiagnostic({ code: 'materialized', stage: 'materialize', frame_id: 'scene_01' }),
          createDiagnostic({ code: 'frame_rendered', stage: 'render', sub_stage: 'render', frame_id: 'scene_01' }),
          createDiagnostic({
            code: 'visual_qa_warning',
            stage: 'inspect',
            sub_stage: 'visual_inspect',
            severity: 'error',
            user_message: '视觉质检失败。',
            details: {
              issues: [
                { code: 'blank_opening_frame', message: '开头抽样帧接近空白。' },
                { code: 'blank_segment_boundary', message: '镜头边界 4s 附近出现连续空白帧。', boundary_sec: 4 },
              ],
            },
          }),
        ],
      },
    }),
    project: project({
      frames: [
        { id: 'scene_01_b1', scene_id: 'scene_01', duration_sec: 4 },
        { id: 'scene_02_b1', scene_id: 'scene_02', duration_sec: 4 },
      ],
    }),
  });
  assert.equal(visualQaPlan.can_retry, true);
  assert.equal(visualQaPlan.code, 'visual_qa_warning');
  assert.equal(visualQaPlan.repair_action, 'retry_frame_html');
  assert.equal(visualQaPlan.retry_from, 'frame_html');
  assert.deepEqual(visualQaPlan.executor_options.frame_ids, ['scene_01_b1', 'scene_02_b1']);
  assert.equal(visualQaPlan.executor_options.regenerate_frame_html, true);
  assert.ok(visualQaPlan.discard.includes('frames:scene_01_b1'));
  assert.ok(visualQaPlan.discard.includes('frames:scene_02_b1'));

  // asset_first 必用素材缺失：按缺失素材对应场景重生成帧
  const missingAssetPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        stage: 'project',
        sub_stage: 'asset_usage',
        code: 'required_visual_asset_missing',
        message: '有 1 个必用视觉素材未进入最终画面，已停止导出。',
        diagnostics: [
          createDiagnostic({
            code: 'required_visual_asset_missing',
            stage: 'project',
            sub_stage: 'asset_usage',
            severity: 'error',
            retryable: true,
            repair_action: 'retry_frame_html',
            user_message: '必用视觉素材未进入最终画面。',
            details: { missing_required_asset_ids: ['gen_scene_02'] },
          }),
        ],
      },
    }),
    project: project({
      frames: [
        { id: 'scene_01_b1', scene_id: 'scene_01', duration_sec: 4 },
        { id: 'scene_02_b1', scene_id: 'scene_02', duration_sec: 4 },
        { id: 'scene_02_b2', scene_id: 'scene_02', duration_sec: 4 },
      ],
    }),
  });
  assert.equal(missingAssetPlan.can_retry, true);
  assert.equal(missingAssetPlan.code, 'required_visual_asset_missing');
  assert.equal(missingAssetPlan.repair_action, 'retry_frame_html');
  assert.equal(missingAssetPlan.retry_from, 'frame_html');
  assert.equal(missingAssetPlan.executor_options.regenerate_frame_html, true);
  assert.deepEqual(missingAssetPlan.executor_options.frame_ids, ['scene_02_b1', 'scene_02_b2']);
  assert.ok(missingAssetPlan.discard.includes('frames:scene_02_b1'));
  assert.ok(missingAssetPlan.discard.includes('frames:scene_02_b2'));
  assert.ok(missingAssetPlan.reuse.includes('content_graph'));

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

  const metaFailurePlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        code: 'resume_action_not_configured',
        sub_stage: 'frame_html',
        diagnostics: [createDiagnostic({
          code: 'resume_action_not_configured',
          sub_stage: 'frame_html',
          retryable: false,
        })],
      },
      retry: {
        attempts: [{
          status: 'failed',
          previous_failure: {
            code: 'frame_html_invalid',
            sub_stage: 'frame_html',
            frame_id: 'scene_02',
            diagnostics: [createDiagnostic({
              code: 'frame_html_invalid',
              stage: 'ai-frame-html',
              sub_stage: 'frame_html',
              frame_id: 'scene_02',
              retryable: true,
              repair_action: 'retry_frame_html',
            })],
          },
        }],
      },
    }),
    project: project(),
  });
  assert.equal(metaFailurePlan.can_retry, true);
  assert.equal(metaFailurePlan.code, 'frame_html_invalid');
  assert.equal(metaFailurePlan.repair_action, 'retry_frame_html');
  assert.deepEqual(metaFailurePlan.executor_options, { frame_id: 'scene_02' });

  const checkpointFrameFailure = project();
  markCheckpointFrame(checkpointFrameFailure, 'frame_html', 'scene_03', {
    status: 'failed',
    diagnostic_code: 'frame_html_invalid',
  });
  const metaFailureCheckpointPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        code: 'retry_executor_failed',
        sub_stage: 'frame_html',
        diagnostics: [createDiagnostic({
          code: 'retry_executor_failed',
          sub_stage: 'frame_html',
          retryable: false,
        })],
      },
      retry: { attempts: [{ status: 'failed' }] },
    }),
    project: checkpointFrameFailure,
  });
  assert.equal(metaFailureCheckpointPlan.can_retry, true);
  assert.equal(metaFailureCheckpointPlan.code, 'frame_html_invalid');
  assert.equal(metaFailureCheckpointPlan.repair_action, 'retry_frame_html');
  assert.deepEqual(metaFailureCheckpointPlan.executor_options, { frame_id: 'scene_03' });

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

  const audioTooLongBeforeProjectPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      result: null,
      error: {
        stage: 'audio',
        message: '口播超过目标时长，自动压缩失败：压缩后的旁白仍超过目标时长：预计 143.1 秒，目标 120 秒。',
      },
      last_failure: {
        stage: 'audio',
        message: '口播超过目标时长，自动压缩失败：压缩后的旁白仍超过目标时长：预计 143.1 秒，目标 120 秒。',
      },
    }),
    project: null,
  });
  assert.equal(audioTooLongBeforeProjectPlan.can_retry, false);
  assert.equal(audioTooLongBeforeProjectPlan.code, 'timeline_duration_unreasonable');
  assert.match(audioTooLongBeforeProjectPlan.user_message, /口播超过目标时长/);

  const projectDirMissingMetaPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      result: null,
      error: {
        code: 'project_dir_missing',
        message: '未找到 html-video 工程目录，无法恢复。',
      },
      last_failure: {
        code: 'project_dir_missing',
        message: '未找到 html-video 工程目录，无法恢复。',
      },
      retry: {
        attempts: [{
          status: 'failed',
          previous_failure: {
            stage: 'audio',
            message: '口播超过目标时长，自动压缩失败：压缩后的旁白仍超过目标时长：预计 143.1 秒，目标 120 秒。',
          },
        }],
      },
    }),
    project: null,
  });
  assert.equal(projectDirMissingMetaPlan.can_retry, false);
  assert.equal(projectDirMissingMetaPlan.code, 'timeline_duration_unreasonable');
  assert.match(projectDirMissingMetaPlan.user_message, /口播超过目标时长/);

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
