const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const creativeWorkflows = require('../server/services/creativeWorkflows');
const { createDiagnostic, normalizeDiagnostic, normalizeDiagnostics } = require('../server/services/creative-video/html-video/diagnostics');
const { createEmptyProject, markCheckpointStage, markCheckpointFrame } = require('../server/services/creative-video/html-video/projectSchema');

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

(async () => {
  const diagnostic = createDiagnostic({
    code: 'provider_missing_text',
    stage: 'ai-frame-html',
    sub_stage: 'frame_html',
    frame_id: 'scene_05',
    retryable: true,
    repair_action: 'retry_frame_html',
    user_message: '第 5 帧 HTML 生成时模型返回空内容，将只重试这一帧。',
    details: { provider: 'provider_1781667270005', attempt: 1 },
  });
  assert.equal(diagnostic.sub_stage, 'frame_html');
  assert.equal(diagnostic.frame_id, 'scene_05');
  assert.equal(diagnostic.retryable, true);
  assert.equal(diagnostic.repair_action, 'retry_frame_html');
  assert.equal(Object.hasOwn(diagnostic.details, 'sub_stage'), false);
  assert.equal(Object.hasOwn(diagnostic.details, 'frame_id'), false);
  assert.equal(Object.hasOwn(diagnostic.details, 'retryable'), false);
  assert.equal(Object.hasOwn(diagnostic.details, 'repair_action'), false);

  const detailPollutedDiagnostic = createDiagnostic({
    code: 'frame_html_invalid',
    stage: 'ai-frame-html',
    sub_stage: 'frame_html',
    frame_id: 'scene_01',
    retryable: true,
    repair_action: 'retry_frame_html',
    details: {
      frame_id: 'scene_01',
      sub_stage: 'frame_html',
      retryable: true,
      repair_action: 'retry_frame_html',
      provider: 'provider_1',
    },
  });
  assert.equal(detailPollutedDiagnostic.sub_stage, 'frame_html');
  assert.equal(detailPollutedDiagnostic.frame_id, 'scene_01');
  assert.equal(detailPollutedDiagnostic.retryable, true);
  assert.equal(detailPollutedDiagnostic.repair_action, 'retry_frame_html');
  assert.deepEqual(detailPollutedDiagnostic.details, { provider: 'provider_1' });

  const normalizedDiagnostic = normalizeDiagnostic({
    code: 'raw_html_path_invalid',
    stage: 'frame',
    sub_stage: 'frame_html',
    frame_id: 'scene_02',
    retryable: true,
    repair_action: 'retry_frame_html',
    details: {
      frame_id: 'scene_02',
      sub_stage: 'frame_html',
      retryable: true,
      repair_action: 'retry_frame_html',
      html_path: '../bad.html',
    },
  }, {
    details: {
      frame_id: 'scene_default',
      sub_stage: 'frame_html',
      retryable: false,
      repair_action: 'retry_frame_html',
      source: 'default',
    },
  });
  assert.equal(normalizedDiagnostic.sub_stage, 'frame_html');
  assert.equal(normalizedDiagnostic.frame_id, 'scene_02');
  assert.equal(normalizedDiagnostic.retryable, true);
  assert.equal(normalizedDiagnostic.repair_action, 'retry_frame_html');
  assert.deepEqual(normalizedDiagnostic.details, { source: 'default', html_path: '../bad.html' });

  const normalizedDiagnostics = normalizeDiagnostics([{
    code: 'render_failed',
    sub_stage: 'render',
    frame_id: 'scene_03',
    details: {
      frame_id: 'scene_03',
      sub_stage: 'render',
      retryable: true,
      repair_action: 'retry_render_frame',
      exit_code: 1,
    },
  }]);
  assert.equal(normalizedDiagnostics[0].sub_stage, 'render');
  assert.equal(normalizedDiagnostics[0].frame_id, 'scene_03');
  assert.deepEqual(normalizedDiagnostics[0].details, { exit_code: 1 });

  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'creative-workflow-last-failure-'));
  const mediaRoot = path.join(rootDir, 'media');
  const projectDir = path.join(rootDir, 'project');
  const checkpointProject = createEmptyProject({
    workflowId: '202606250000000001',
    runId: 'run-last-failure',
  });
  markCheckpointStage(checkpointProject, 'content_graph', {
    status: 'done',
    path: 'content-graph.json',
    output_hash: 'graph-hash',
    diagnostic_code: '',
  });
  markCheckpointFrame(checkpointProject, 'frame_html', 'scene_01', {
    status: 'done',
    html_path: 'frames/01-scene_01.html',
    output_hash: 'html-hash-1',
    diagnostic_code: '',
  });
  markCheckpointFrame(checkpointProject, 'frame_html', 'scene_05', {
    status: 'failed',
    diagnostic_code: 'provider_missing_text',
  });
  markCheckpointFrame(checkpointProject, 'render', 'scene_05', {
    status: 'failed',
    diagnostic_code: 'render_failed',
  });
  checkpointProject.generation_checkpoint.stages.compose = {
    ...checkpointProject.generation_checkpoint.stages.compose,
    status: 'done',
    output_path: 'exports/output.mp4',
    output_audio_path: 'exports/output-audio.mp4',
    ignored: '不应复制',
  };
  checkpointProject.generation_checkpoint.stages.duration_verify = {
    ...checkpointProject.generation_checkpoint.stages.duration_verify,
    status: 'failed',
    expected_duration_sec: 60,
    actual_duration_sec: 132,
    diagnostic_code: 'duration_mismatch',
  };
  checkpointProject.generation_checkpoint.stages.visual_inspect = {
    ...checkpointProject.generation_checkpoint.stages.visual_inspect,
    status: 'done',
    report_path: 'inspect/report.json',
  };
  await writeJson(path.join(projectDir, 'project.json'), {
    generation_checkpoint: checkpointProject.generation_checkpoint,
  });

  const now = '2026-06-25T00:00:00.000Z';
  const services = {
    now: () => now,
    idFactory: () => '202606250000000001',
    appSettings: {
      getCreativeDefaults: async () => ({
        useResearch: false,
        generateAudio: false,
        generateCaptions: false,
      }),
      getEffectiveSystemSettings: async () => ({ skipValidation: true }),
    },
    mediaPipeline: {
      prepareDouyinWorkspace: async () => ({
        success: true,
        status: 'ready',
        metadata: {},
        cache: { metadata: 'local', force: false },
        local_video_path: path.join(mediaRoot, 'video.mp4'),
        keyframes: [],
      }),
    },
    agentRuns: {
      createDouyinHyperframesFreeformRun: async () => ({
        success: true,
        run_id: 'run-last-failure',
        message: '导演改写任务已创建。',
      }),
      generateDouyinRunHyperframesFreeformBrief: async () => ({
        success: true,
        message: '成片策划完成。',
      }),
      generateDouyinRunHyperframesFreeformProject: async () => ({
        success: false,
        message: 'provider_1781667270005 返回结果缺少文本内容。',
        html_video_project_path: projectDir,
        diagnostics: [],
        html_video_diagnostics: [diagnostic],
      }),
    },
  };

  const created = await creativeWorkflows.createCreativeWorkflow({
    input: '测试 html-video last_failure',
  }, { rootDir, mediaRoot, services });
  assert.equal(created.success, true);

  const result = await creativeWorkflows.runCreativeWorkflow(created.workflow_id, {
    rootDir,
    mediaRoot,
    services,
    skipValidation: true,
  });
  assert.equal(result.success, false);

  const workflowPath = creativeWorkflows.getWorkflowPath(created.workflow_id, rootDir);
  const record = JSON.parse(await fs.readFile(workflowPath, 'utf8'));
  assert.equal(record.error.stage, 'project');
  assert.equal(record.error.message, 'provider_1781667270005 返回结果缺少文本内容。');
  assert.equal(record.last_failure.stage, 'project');
  assert.equal(record.last_failure.sub_stage, 'frame_html');
  assert.equal(record.last_failure.code, 'provider_missing_text');
  assert.equal(record.last_failure.frame_id, 'scene_05');
  assert.equal(record.last_failure.project_dir, projectDir);
  assert.equal(record.last_failure.message, 'provider_1781667270005 返回结果缺少文本内容。');
  assert.equal(record.last_failure.updated_at, now);
  assert.deepEqual(record.last_failure.diagnostics, [diagnostic]);
  const contentGraphStage = record.project_substages.find(item => item.id === 'content_graph');
  assert.deepEqual(contentGraphStage.artifacts, { kind: 'content_graph', path: 'content-graph.json', hash: 'graph-hash' });
  assert.equal(Object.hasOwn(contentGraphStage, 'path'), false);

  const frameHtmlStage = record.project_substages.find(item => item.id === 'frame_html');
  assert.deepEqual(frameHtmlStage.artifacts, [
    { kind: 'frame_html', frame_id: 'scene_01', path: 'frames/01-scene_01.html', hash: 'html-hash-1' },
  ]);
  assert.deepEqual(frameHtmlStage.diagnostics, [
    createDiagnostic({ code: 'provider_missing_text', sub_stage: 'frame_html', frame_id: 'scene_05' }),
  ]);

  const renderStage = record.project_substages.find(item => item.id === 'render');
  assert.deepEqual(renderStage.diagnostics, [
    createDiagnostic({ code: 'render_failed', sub_stage: 'render', frame_id: 'scene_05' }),
  ]);

  const composeStage = record.project_substages.find(item => item.id === 'compose');
  assert.deepEqual(composeStage.artifacts, [
    { kind: 'compose_output', path: 'exports/output.mp4' },
    { kind: 'compose_audio_output', path: 'exports/output-audio.mp4' },
  ]);
  assert.equal(Object.hasOwn(composeStage, 'ignored'), false);

  const durationStage = record.project_substages.find(item => item.id === 'duration_verify');
  assert.deepEqual(durationStage.artifacts, { kind: 'duration_verify', expected_duration_sec: 60, actual_duration_sec: 132 });
  assert.deepEqual(durationStage.diagnostics, [
    createDiagnostic({ code: 'duration_mismatch', sub_stage: 'duration_verify' }),
  ]);

  const visualStage = record.project_substages.find(item => item.id === 'visual_inspect');
  assert.deepEqual(visualStage.artifacts, { kind: 'visual_report', path: 'inspect/report.json' });
  assert.equal(JSON.stringify(record.project_substages).includes('"frames"'), false);
  assert.equal(JSON.stringify(record.project_substages).includes('generation_checkpoint'), false);
  assert.equal(JSON.stringify(record.project_substages).includes('不应复制'), false);

  const warningDiagnostic = createDiagnostic({
    code: 'frame_duration_auto_extended',
    stage: 'timeline-consistency',
    sub_stage: 'timeline_check',
    severity: 'warning',
    user_message: '已按字幕时长自动延长画面帧。',
    details: { previous_duration_sec: 2, duration_sec: 3.2 },
  });
  const renderDiagnostic = createDiagnostic({
    code: 'render_failed',
    stage: 'render',
    sub_stage: 'render',
    frame_id: 'scene_02',
    retryable: true,
    repair_action: 'rerender_frames',
    user_message: '第 2 帧渲染失败。',
    details: { exit_code: 1 },
  });
  const warningFirstRootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'creative-workflow-warning-first-'));
  const warningFirstMediaRoot = path.join(warningFirstRootDir, 'media');
  const warningFirstProjectDir = path.join(warningFirstRootDir, 'project');
  const warningFirstServices = {
    now: () => now,
    idFactory: () => '202606250000000002',
    appSettings: services.appSettings,
    mediaPipeline: services.mediaPipeline,
    agentRuns: {
      createDouyinHyperframesFreeformRun: async () => ({
        success: true,
        run_id: 'run-warning-first',
        message: '导演改写任务已创建。',
      }),
      generateDouyinRunHyperframesFreeformBrief: async () => ({
        success: true,
        message: '成片策划完成。',
      }),
      generateDouyinRunHyperframesFreeformProject: async () => ({
        success: false,
        message: 'html-video 工程渲染失败。',
        html_video_project_path: warningFirstProjectDir,
        diagnostics: [warningDiagnostic, renderDiagnostic],
      }),
    },
  };
  const warningFirstCreated = await creativeWorkflows.createCreativeWorkflow({
    input: '测试 warning 后实际失败诊断选择',
  }, { rootDir: warningFirstRootDir, mediaRoot: warningFirstMediaRoot, services: warningFirstServices });
  assert.equal(warningFirstCreated.success, true);
  const warningFirstResult = await creativeWorkflows.runCreativeWorkflow(warningFirstCreated.workflow_id, {
    rootDir: warningFirstRootDir,
    mediaRoot: warningFirstMediaRoot,
    services: warningFirstServices,
    skipValidation: true,
  });
  assert.equal(warningFirstResult.success, false);
  const warningFirstRecord = JSON.parse(await fs.readFile(
    creativeWorkflows.getWorkflowPath(warningFirstCreated.workflow_id, warningFirstRootDir),
    'utf8',
  ));
  assert.equal(warningFirstRecord.last_failure.code, 'render_failed');
  assert.equal(warningFirstRecord.last_failure.sub_stage, 'render');
  assert.equal(warningFirstRecord.last_failure.frame_id, 'scene_02');
  assert.deepEqual(warningFirstRecord.last_failure.diagnostics, [warningDiagnostic, renderDiagnostic]);

  console.log('creative workflow diagnostics last_failure tests passed');
})();
