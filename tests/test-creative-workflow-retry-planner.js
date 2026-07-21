const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const creativeWorkflows = require('../server/services/creative/creativeWorkflows');
const {
  classifyCreativeWorkflowFailure,
  createCreativeWorkflowRetryPlan,
  resolveRetryFrameIds,
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

  const shotContractPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        code: 'frame_html_shot_contract_invalid',
        sub_stage: 'render',
        frame_id: 'scene:scene_05',
        diagnostics: [createDiagnostic({
          code: 'frame_html_shot_contract_invalid',
          sub_stage: 'render',
          frame_id: 'scene:scene_05',
          severity: 'error',
        })],
      },
    }),
    project: project(),
  });
  assert.equal(shotContractPlan.repair_action, 'retry_frame_html');
  assert.deepEqual(shotContractPlan.executor_options, {
    regenerate_frame_html: true,
    frame_ids: ['scene:scene_05'],
  });
  assert.deepEqual(shotContractPlan.discard, ['frames:scene:scene_05', 'render_outputs']);

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
  assert.deepEqual(layoutQaPlan.executor_options, {
    regenerate_frame_html: true,
    frame_ids: ['scene_07'],
  });

  const unscopedLayoutQaPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        stage: 'project',
        sub_stage: 'layout_qa',
        code: 'layout_qa_failed',
      },
    }),
    project: project(),
  });
  assert.deepEqual(unscopedLayoutQaPlan.executor_options, { regenerate_frame_html: true });
  assert.deepEqual(unscopedLayoutQaPlan.discard, ['frame_html', 'render_outputs']);

  const unresolvedLayoutQaPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        stage: 'project',
        sub_stage: 'frame_html',
        code: 'frame_layout_qa_unresolved',
        frame_id: 'scene_last_failure',
        diagnostics: [{
          code: 'frame_layout_qa_unresolved',
          stage: 'ai-frame-html',
          sub_stage: 'frame_html',
          frame_id: 'scene_diagnostic_top',
          severity: 'error',
          retryable: true,
          repair_action: 'retry_frame_html',
          details: {
            frame_id: 'scene_diagnostic_details',
            issues: [{ code: 'camera_jitter', frame_id: 'scene_diagnostic_issue', sample_time_sec: 1.25, shot_id: 'shot_02' }],
          },
        }, {
          code: 'frame_layout_qa_unresolved',
          stage: 'ai-frame-html',
          sub_stage: 'frame_html',
          retryable: true,
          repair_action: 'retry_frame_html',
          frame_id: 'scene_diagnostics_array',
        }, createDiagnostic({
          code: 'provider_missing_text',
          stage: 'ai-frame-html',
          sub_stage: 'frame_html',
          frame_id: 'scene_other_code',
        })],
      },
    }),
    project: project({
      generation_checkpoint: {
        stages: {
          frame_html: {
            frames: {
              scene_01: { status: 'done', diagnostic_code: '' },
              scene_02: { status: 'failed', diagnostic_code: 'frame_layout_qa_unresolved' },
              scene_03: { status: 'failed', diagnostic_code: 'frame_layout_qa_unresolved' },
              scene_04: { status: 'failed', diagnostic_code: 'provider_missing_text' },
            },
          },
        },
      },
    }),
  });
  assert.equal(unresolvedLayoutQaPlan.can_retry, true);
  assert.equal(unresolvedLayoutQaPlan.repair_action, 'retry_frame_html');
  assert.deepEqual(unresolvedLayoutQaPlan.executor_options, {
    regenerate_frame_html: true,
    frame_ids: [
      'scene_diagnostic_top',
      'scene_diagnostic_details',
      'scene_diagnostic_issue',
      'scene_diagnostics_array',
      'scene_02',
      'scene_03',
    ],
  });
  assert.deepEqual(unresolvedLayoutQaPlan.discard, [
    'frames:scene_diagnostic_top',
    'frames:scene_diagnostic_details',
    'frames:scene_diagnostic_issue',
    'frames:scene_diagnostics_array',
    'frames:scene_02',
    'frames:scene_03',
    'render_outputs',
  ]);
  assert.deepEqual(resolveRetryFrameIds(['scene_02_b3', 'scene_03_b1'], {
    continuityMode: 'scene_html',
    beatToScene: { scene_02_b3: 'scene_02', scene_03_b1: 'scene_03' },
  }), ['scene:scene_02', 'scene:scene_03']);
  assert.deepEqual(resolveRetryFrameIds(['scene_02_b3', 'scene_03_b1']), ['scene_02_b3', 'scene_03_b1']);
  const unresolvedClassification = classifyCreativeWorkflowFailure({
    workflow: workflow({ last_failure: {
      code: 'frame_layout_qa_unresolved',
      diagnostics: [{
        code: 'frame_layout_qa_unresolved',
        severity: 'error',
        details: { issues: [{ frame_id: 'scene_02', sample_time_sec: 1.25, shot_id: 'shot_02' }] },
      }],
    } }),
    project: project(),
  });
  assert.deepEqual(unresolvedClassification.diagnostic.details.issues[0], {
    frame_id: 'scene_02', sample_time_sec: 1.25, shot_id: 'shot_02',
  });

  const visualQaPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        stage: 'project',
        sub_stage: 'visual_inspect',
        code: 'visual_qa_warning',
        message: 'html-video 成片画面存在开头或镜头边界白屏，未通过视觉安全检查。',
        diagnostics: [
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

  const unregisteredAssetPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        stage: 'project',
        sub_stage: 'asset_usage',
        code: 'unregistered_visual_asset_reference',
        diagnostics: [createDiagnostic({
          code: 'unregistered_visual_asset_reference',
          stage: 'project',
          sub_stage: 'asset_usage',
          severity: 'error',
          retryable: true,
          repair_action: 'retry_frame_html',
          details: {
            unregistered_image_references: [
              { frame_id: 'scene_02_b2', reference: '../assets/evil.png' },
              { frame_id: 'scene_02_b2', reference: '../assets/evil-2.png' },
            ],
          },
        })],
      },
    }),
    project: project({ frames: [{ id: 'scene_02_b1' }, { id: 'scene_02_b2' }] }),
  });
  assert.equal(unregisteredAssetPlan.can_retry, true);
  assert.equal(unregisteredAssetPlan.repair_action, 'retry_frame_html');
  assert.deepEqual(unregisteredAssetPlan.executor_options.frame_ids, ['scene_02_b2']);
  assert.equal(unregisteredAssetPlan.executor_options.regenerate_frame_html, true);
  assert.ok(unregisteredAssetPlan.discard.includes('frames:scene_02_b2'));

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

  for (const code of ['render-playback-start-failed', 'render-playback-runtime-failed']) {
    const playbackProject = project();
    markCheckpointFrame(playbackProject, 'render', 'scene:scene_04', {
      status: 'failed',
      diagnostic_code: code,
    });
    const playbackPlan = createCreativeWorkflowRetryPlan({
      workflow: workflow({
        last_failure: { code, sub_stage: 'render', frame_id: 'scene:scene_04' },
      }),
      project: playbackProject,
    });
    assert.equal(playbackPlan.repair_action, 'retry_frame_html', `${code} 必须重新生成失败 Frame HTML`);
    assert.equal(playbackPlan.retry_from, 'frame_html');
    assert.deepEqual(playbackPlan.executor_options, {
      regenerate_frame_html: true,
      frame_ids: ['scene:scene_04'],
    });
    assert.deepEqual(playbackPlan.discard, ['frames:scene:scene_04', 'render_outputs']);
  }

  const imageNotReadyPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: { code: 'render-shot-image-not-ready', sub_stage: 'render', frame_id: 'scene:scene_04' },
    }),
    project: project(),
  });
  assert.equal(imageNotReadyPlan.repair_action, 'rerender_frames');
  assert.deepEqual(imageNotReadyPlan.executor_options.frame_ids, ['scene:scene_04']);

  const runtimePolicyProject = project();
  markCheckpointFrame(runtimePolicyProject, 'render', 'scene:scene_04', {
    status: 'failed',
    diagnostic_code: 'runtime_visual_asset_policy_violation',
  });
  const runtimePolicyPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({
      last_failure: {
        code: 'runtime_visual_asset_policy_violation',
        sub_stage: 'frame_html',
        frame_id: 'scene:scene_04',
      },
    }),
    project: runtimePolicyProject,
  });
  assert.equal(runtimePolicyPlan.repair_action, 'retry_frame_html');
  assert.deepEqual(runtimePolicyPlan.executor_options, {
    regenerate_frame_html: true,
    frame_ids: ['scene:scene_04'],
  });
  const revalidationPlan = createCreativeWorkflowRetryPlan({
    workflow: workflow({ last_failure: {
      code: 'runtime_asset_policy_revalidation_required', sub_stage: 'render',
      diagnostics: [{ code: 'runtime_asset_policy_revalidation_required', details: { frame_ids: ['scene_01', 'scene_02'] } }],
    } }),
    project: project(),
  });
  assert.equal(revalidationPlan.repair_action, 'rerender_frames');
  assert.deepEqual(revalidationPlan.executor_options.frame_ids, ['scene_01', 'scene_02']);

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

// ===== 模块7：asset_first QA code 的修复映射 =====
const { repairActionForQaIssue } = require('../server/services/creative-video/retryPlanner');

// 可修复：定向 retry_frame_html
{
  const action = repairActionForQaIssue({
    code: 'asset_first_boundary_refresh',
    details: { scene_id: 'scene_05', boundary_sec: 69.71 },
  }, { boundaryToFrameIds: { 'scene_05@69.71': ['scene_05_b2'] } });
  assert.strictEqual(action.type, 'retry_frame_html');
  assert.deepStrictEqual(action.frame_ids, ['scene_05_b2']);
}
// review P2-6 契约变更：asset_missing 的 details.scene_id 才是真实语义（生产端 expected_in_frames
// 写的是 scene_id），修复映射改为经 sceneToFrameIds 查该 scene 的全部 beat（与 boundaryToFrameIds 同模式）
{
  const action = repairActionForQaIssue(
    { code: 'asset_first_asset_missing', details: { asset_id: 'gen_scene_02', scene_id: 'scene_02', beat_id: null } },
    { sceneToFrameIds: { scene_02: ['scene_02_b1', 'scene_02_b2'] } },
  );
  assert.strictEqual(action.type, 'retry_frame_html');
  assert.deepStrictEqual(action.frame_ids, ['scene_02_b1', 'scene_02_b2'], 'asset_missing 按 scene 查全部 beat');
}
// scene_id 查不到映射（caller 未提供或 scene 不存在）：返回 null，不伪造 frame_ids
assert.strictEqual(
  repairActionForQaIssue({ code: 'asset_first_asset_missing', details: { asset_id: 'gen_scene_02', scene_id: 'scene_02', beat_id: null } }, {}),
  null,
);
// R6：asset_missing 拿不到 frame（scene_id=null）时不产生定向重试，返回 null
assert.strictEqual(
  repairActionForQaIssue({ code: 'asset_first_asset_missing', details: { asset_id: 'gen_x', scene_id: null, beat_id: null } }, { sceneToFrameIds: { scene_02: ['scene_02_b1'] } }),
  null,
);
// 不可修复（硬约束 C）：无映射的观察类 code 绝不能映射为 retry_frame_html（会无限循环）
{
  assert.strictEqual(repairActionForQaIssue({ code: 'sample_warning_a' }, {}), null);
  assert.strictEqual(repairActionForQaIssue({ code: 'sample_warning_b' }, {}), null);
  assert.strictEqual(repairActionForQaIssue({ code: 'asset_first_style_drift' }, {}), null);
  assert.strictEqual(repairActionForQaIssue({ code: 'asset_first_caption_invisible' }, {}), null);
}
// 回归：未知 code 返回 null，不影响既有重试计划
assert.strictEqual(repairActionForQaIssue({ code: 'too_many_blank_frames' }, {}), null);
console.log('retry planner asset_first qa mapping tests passed');
