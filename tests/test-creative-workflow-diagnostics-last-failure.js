const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const creativeWorkflows = require('../server/services/creativeWorkflows');
const { createDiagnostic } = require('../server/services/creative-video/html-video/diagnostics');

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

  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'creative-workflow-last-failure-'));
  const mediaRoot = path.join(rootDir, 'media');
  const projectDir = path.join(rootDir, 'project');
  await writeJson(path.join(projectDir, 'project.json'), {
    generation_checkpoint: {
      stages: [
        {
          id: 'content_graph',
          status: 'done',
          message: '内容图已生成。',
          artifacts: { path: 'content-graph.json' },
          diagnostics: [],
          ignored: '不应复制',
        },
        {
          id: 'frame_html',
          status: 'failed',
          message: '第 5 帧 HTML 生成失败。',
          artifacts: { frame_id: 'scene_05' },
          diagnostics: [diagnostic],
        },
      ],
    },
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
        diagnostics: [diagnostic],
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
  assert.deepEqual(record.project_substages, [
    {
      id: 'content_graph',
      status: 'done',
      message: '内容图已生成。',
      artifacts: { path: 'content-graph.json' },
      diagnostics: [],
    },
    {
      id: 'frame_html',
      status: 'failed',
      message: '第 5 帧 HTML 生成失败。',
      artifacts: { frame_id: 'scene_05' },
      diagnostics: [diagnostic],
    },
  ]);

  console.log('creative workflow diagnostics last_failure tests passed');
})();
