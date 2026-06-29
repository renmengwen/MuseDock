const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRuns = require('../server/services/agent/agentRuns');

(async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-html-video-failure-'));
  const awemeId = '20260627010101000001';
  const runId = 'run-html-video-failure-meta';
  const runDir = path.join(rootDir, awemeId, 'agent_runs');
  const projectDir = path.join(rootDir, awemeId, 'agent_runs', `${runId}-html-video`);
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(path.join(runDir, `${runId}.json`), JSON.stringify({
    success: true,
    run_id: runId,
    template: 'hyperframes_freeform',
    aweme_id: awemeId,
    status: 'ready',
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: 'HTML 失败透传测试',
          storyboard: {
            scenes: [{ index: 1, narration_text: '测试旁白。' }],
          },
        },
      },
    },
  }, null, 2));

  const diagnostic = {
    code: 'frame_html_invalid',
    stage: 'ai-frame-html',
    sub_stage: 'frame_html',
    frame_id: 'scene_01',
    retryable: true,
    repair_action: 'retry_frame_html',
    user_message: 'AI 未返回有效 HTML document。',
  };
  const result = await agentRuns.generateDouyinRunHyperframesFreeformProject(awemeId, runId, {
    rootDir,
    useHtmlVideoLiteWorkflow: true,
    creativeVideoWorkflowFacade: {
      generateCreativeVideoProject: async () => ({
        success: false,
        message: 'AI 未返回有效 HTML document。',
        render_mode: 'html-video',
        project_dir: projectDir,
        html_video_project_path: projectDir,
        html_video_diagnostics: [diagnostic],
        fallback_allowed: false,
      }),
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.html_video_project_path, projectDir);
  assert.deepEqual(result.html_video_diagnostics, [diagnostic]);
  assert.equal(result.fallback_allowed, false);

  const persisted = JSON.parse(fs.readFileSync(path.join(runDir, `${runId}.json`), 'utf8'));
  assert.equal(persisted.hyperframes_freeform.project.status, 'failed');
  assert.equal(persisted.hyperframes_freeform.project.html_video_project_path, projectDir);
  assert.deepEqual(persisted.hyperframes_freeform.project.html_video_diagnostics, [diagnostic]);

  const successRunId = 'run-html-video-success-url';
  const successProjectDir = path.join(rootDir, awemeId, 'agent_runs', `${successRunId}-html-video`);
  fs.writeFileSync(path.join(runDir, `${successRunId}.json`), JSON.stringify({
    success: true,
    run_id: successRunId,
    template: 'hyperframes_freeform',
    aweme_id: awemeId,
    status: 'ready',
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: 'HTML 成功 URL 测试',
          storyboard: {
            scenes: [{ index: 1, narration_text: '测试旁白。' }],
          },
        },
      },
    },
  }, null, 2));

  const successResult = await agentRuns.generateDouyinRunHyperframesFreeformProject(awemeId, successRunId, {
    rootDir,
    useHtmlVideoLiteWorkflow: true,
    creativeVideoWorkflowFacade: {
      generateCreativeVideoProject: async () => ({
        success: true,
        message: 'html-video lite 成片完成。',
        render_mode: 'html-video',
        project_dir: successProjectDir,
        html_video_project_path: successProjectDir,
        project: { exports: [{ id: 'export-success-01' }] },
        files: [],
      }),
    },
  });

  assert.equal(successResult.success, true);
  const successPersisted = JSON.parse(fs.readFileSync(path.join(runDir, `${successRunId}.json`), 'utf8'));
  assert.equal(
    successPersisted.hyperframes_freeform.render.output_url,
    `/api/creative-workflows/${encodeURIComponent(awemeId)}/html-video-project/exports/${encodeURIComponent('export-success-01')}/file`,
  );

  console.log('agent runs html-video project failure meta tests passed');
})();
