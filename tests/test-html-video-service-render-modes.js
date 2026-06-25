const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getWorkflowPath,
  runHtmlVideoProjectEditPlan,
  acceptHtmlVideoProjectEditPlan,
  discardHtmlVideoProjectEditPlan,
  renderHtmlVideoProject,
  exportHtmlVideoProject,
  getHtmlVideoProjectExportFile,
} = require('../server/services/creativeWorkflows');

const WORKFLOW_ID = '202606171200000001';

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function createFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-video-service-modes-'));
  const projectDir = path.join(rootDir, WORKFLOW_ID, 'agent_runs', 'run-1-html-video');
  writeJson(getWorkflowPath(WORKFLOW_ID, rootDir), {
    workflow_id: WORKFLOW_ID,
    run_id: 'run-1',
    status: 'done',
    result: {
      hyperframes_freeform: {
        project: {
          html_video_project_path: projectDir,
        },
      },
    },
  });
  writeJson(path.join(projectDir, 'project.json'), {
    project_id: 'p1',
    workflow_id: WORKFLOW_ID,
    run_id: 'run-1',
    template_id: 'simple',
    template_inputs: {},
    frames: [{ id: 'frame_01', scene_id: 'scene_01', template_id: 'simple', inputs: {} }],
    edit_sessions: [{ id: 'edit_plan_0001', kind: 'edit_plan', status: 'planned' }],
    timeline: { tracks: [] },
    exports: [{ id: 'export_001', path: 'exports/output.mp4', format: 'mp4' }],
  });
  fs.mkdirSync(path.join(projectDir, 'exports'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'exports', 'output.mp4'), 'fake mp4');
  return { rootDir, projectDir };
}

(async () => {
  const { rootDir, projectDir } = createFixture();
  const calls = [];
  const fakeOrchestrator = {
    materializeHtmlVideoProject: async options => {
      calls.push(['materialize', Boolean(options.skipRender)]);
      return {
        success: true,
        message: 'HTML 已重新生成。',
        project: options.project,
        html_video_project_path: projectDir,
      };
    },
    renderHtmlVideoFramePreview: async options => {
      calls.push(['frame', options.frameId, Boolean(options.skipRender)]);
      return {
        success: true,
        message: '单帧预览已更新。',
        project: options.project,
        html_video_project_path: projectDir,
        preview_frame_id: options.frameId,
        preview_path: path.join(projectDir, 'inspect', 'previews', `${options.frameId}.mp4`),
      };
    },
    exportHtmlVideoProject: async options => {
      calls.push(['export', Boolean(options.skipRender)]);
      return {
        success: true,
        message: '成片已导出。',
        project: {
          ...options.project,
          generation_checkpoint: {
            stages: [
              {
                id: 'compose',
                status: 'done',
                message: '成片已导出。',
                artifacts: { output_path: 'exports/output.mp4' },
                diagnostics: [],
                ignored: '不应复制',
              },
            ],
          },
        },
        html_video_project_path: projectDir,
        output_path: path.join(projectDir, 'exports', 'output.mp4'),
      };
    },
  };
  const options = { rootDir, htmlVideoProjectOrchestrator: fakeOrchestrator };

  const missingMode = await renderHtmlVideoProject(WORKFLOW_ID, {}, options);
  assert.equal(missingMode.success, false);
  assert.match(missingMode.message, /mode 无效|materialize|frame/);
  assert.deepEqual(calls, []);

  const materialized = await renderHtmlVideoProject(WORKFLOW_ID, { mode: 'materialize' }, options);
  assert.equal(materialized.success, true);
  assert.deepEqual(calls, [['materialize', false]]);

  const missingFrame = await renderHtmlVideoProject(WORKFLOW_ID, { mode: 'frame' }, options);
  assert.equal(missingFrame.success, false);
  assert.match(missingFrame.message, /帧 ID/);
  assert.deepEqual(calls, [['materialize', false]]);

  const preview = await renderHtmlVideoProject(WORKFLOW_ID, { mode: 'frame', frame_id: 'frame_01' }, options);
  assert.equal(preview.success, true);
  assert.equal(preview.preview_frame_id, 'frame_01');
  assert.deepEqual(calls.slice(-1), [['frame', 'frame_01', false]]);

  const exported = await exportHtmlVideoProject(WORKFLOW_ID, { skip_render: true }, options);
  assert.equal(exported.success, true);
  assert.deepEqual(calls.slice(-1), [['export', false]]);
  const workflowAfterExport = JSON.parse(fs.readFileSync(getWorkflowPath(WORKFLOW_ID, rootDir), 'utf8'));
  const composeSubstage = workflowAfterExport.project_substages.find(item => item.id === 'compose');
  assert.deepEqual(composeSubstage, {
    id: 'compose',
    status: 'done',
    message: '成片已导出。',
    artifacts: { output_path: 'exports/output.mp4' },
    diagnostics: [],
  });

  const exportFile = await getHtmlVideoProjectExportFile(WORKFLOW_ID, 'export_001', { rootDir });
  assert.equal(exportFile.success, true);
  assert.equal(exportFile.file_path, path.join(projectDir, 'exports', 'output.mp4'));

  const missingExportFile = await getHtmlVideoProjectExportFile(WORKFLOW_ID, 'missing_export', { rootDir });
  assert.equal(missingExportFile.success, false);
  assert.match(missingExportFile.message, /未找到导出文件记录/);

  const partialRun = await runHtmlVideoProjectEditPlan(WORKFLOW_ID, 'edit_plan_0001', { confirm: true }, {
    rootDir,
    htmlVideoEditModeService: {
      runEditPlan: async ({ project }) => {
        project.edit_sessions[0].status = 'failed';
        project.edit_sessions[0].generated_drafts = [{ frame_id: 'frame_01', draft_id: 'draft_0001' }];
        return {
          success: false,
          code: 'EDIT_PLAN_FRAME_ITERATE_FAILED',
          plan: project.edit_sessions[0],
          generated_drafts: project.edit_sessions[0].generated_drafts,
          message: '编辑计划执行失败，请查看失败帧。',
        };
      },
    },
  });
  assert.equal(partialRun.success, false);
  assert.equal(partialRun.html_video_project.edit_sessions[0].status, 'failed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8')).edit_sessions[0].generated_drafts[0].draft_id, 'draft_0001');

  const partialAccept = await acceptHtmlVideoProjectEditPlan(WORKFLOW_ID, 'edit_plan_0001', {}, {
    rootDir,
    htmlVideoEditModeService: {
      acceptEditPlanDrafts: async ({ project }) => {
        project.edit_sessions[0].status = 'failed';
        project.edit_sessions[0].accepted_drafts = [{ frame_id: 'frame_01', draft_id: 'draft_0001' }];
        return {
          success: false,
          code: 'DRAFT_NOT_FOUND',
          plan: project.edit_sessions[0],
          message: '接受编辑计划草稿失败。',
        };
      },
    },
  });
  assert.equal(partialAccept.success, false);
  assert.equal(partialAccept.html_video_project.edit_sessions[0].accepted_drafts[0].draft_id, 'draft_0001');
  assert.equal(JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8')).edit_sessions[0].accepted_drafts[0].draft_id, 'draft_0001');

  const partialDiscard = await discardHtmlVideoProjectEditPlan(WORKFLOW_ID, 'edit_plan_0001', {}, {
    rootDir,
    htmlVideoEditModeService: {
      discardEditPlanDrafts: async ({ project }) => {
        project.edit_sessions[0].status = 'failed';
        project.edit_sessions[0].discarded_drafts = [{ frame_id: 'frame_01', draft_id: 'draft_0001' }];
        return {
          success: false,
          code: 'DRAFT_NOT_FOUND',
          plan: project.edit_sessions[0],
          message: '放弃编辑计划草稿失败。',
        };
      },
    },
  });
  assert.equal(partialDiscard.success, false);
  assert.equal(partialDiscard.html_video_project.edit_sessions[0].discarded_drafts[0].draft_id, 'draft_0001');
  assert.equal(JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8')).edit_sessions[0].discarded_drafts[0].draft_id, 'draft_0001');

  console.log('html-video service render mode tests passed');
})();
