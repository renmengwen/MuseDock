const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { renderHtmlVideoFramePreview } = require('../server/services/creative-video/html-video/projectOrchestrator');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-draft-preview-'));
  const projectDir = path.join(rootDir, 'project');
  await writeFile(path.join(projectDir, 'frames', 'scene_01.html'), '<html><body>正式</body></html>');
  await writeFile(path.join(projectDir, 'frames', '.drafts', 'scene_01', 'draft_0001.html'), '<html><body>草稿</body></html>');
  await writeFile(path.join(projectDir, 'frames', '.drafts', 'scene_01', 'draft_accepted.html'), '<html><body>已接受草稿</body></html>');
  await writeFile(path.join(projectDir, 'frames', '.drafts', 'scene_01', 'draft_unregistered.html'), '<img src="../assets/preview-evil.png">');

  const officialHtmlPath = 'frames/scene_01.html';
  const draftHtmlPath = 'frames/.drafts/scene_01/draft_0001.html';
  const acceptedDraftHtmlPath = 'frames/.drafts/scene_01/draft_accepted.html';
  const project = {
    project_id: 'draft_preview_project',
    workflow_id: 'wf',
    run_id: 'run',
    output: { resolution: { width: 1080, height: 1920 }, fps: 24 },
    frames: [
      {
        id: 'beat_01',
        scene_id: 'scene_01',
        source_mode: 'raw_html',
        html_path: officialHtmlPath,
        duration_sec: 2,
        drafts: [
          { id: 'draft_0001', status: 'ready', html_path: draftHtmlPath },
          { id: 'draft_discarded', status: 'discarded', html_path: 'frames/.drafts/scene_01/draft_discarded.html' },
          { id: 'draft_accepted', status: 'accepted', html_path: acceptedDraftHtmlPath },
          { id: 'draft_unregistered', status: 'ready', html_path: 'frames/.drafts/scene_01/draft_unregistered.html' },
        ],
      },
    ],
    timeline: { tracks: [{ id: 'main', type: 'video', items: [] }] },
  };

  const renderedFrames = [];
  const qaFrames = [];
  const services = {
    materializer: {
      materializeProject: async ({ project: nextProject }) => ({ success: true, project: nextProject, diagnostics: [] }),
    },
    frameRenderer: {
      renderFrame: async (frame, options) => {
        renderedFrames.push(frame);
        if (frame.html_path.includes('draft_unregistered')) {
          return {
            success: false,
            code: 'runtime_visual_asset_policy_violation',
            message: '运行时素材门禁阻断。',
            diagnostics: [{
              code: 'runtime_visual_asset_policy_violation',
              frame_id: frame.id,
              details: { violations: [{ source: 'route', kind: 'unregistered_local_image', target: 'assets/preview-evil.png', frame_id: frame.id }] },
            }],
          };
        }
        await writeFile(options.outputPath, 'mp4');
        return { success: true, output_path: options.outputPath, diagnostics: [] };
      },
    },
    layoutQaService: {
      inspectFrameHtmlLayout: async ({ frame }) => {
        qaFrames.push(frame);
        return { success: true, issues: [], metrics: { frame_id: frame.id } };
      },
    },
  };

  const result = await renderHtmlVideoFramePreview({
    projectDir,
    project,
    frameId: 'scene_01',
    draftId: 'draft_0001',
    services,
    runLayoutQa: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.layout_qa.success, true);
  assert.equal(qaFrames[0].html_path, draftHtmlPath);
  assert.equal(renderedFrames.length, 1);
  assert.equal(renderedFrames[0].html_path, draftHtmlPath);
  assert.equal(result.project.frames[0].html_path, officialHtmlPath);
  assert.match(result.preview_path, /draft_0001/);

  const missingDraft = await renderHtmlVideoFramePreview({
    projectDir,
    project,
    frameId: 'scene_01',
    draftId: 'draft_missing',
    services,
  });
  assert.equal(missingDraft.success, false);
  assert.equal(missingDraft.code, 'DRAFT_NOT_FOUND');

  const discardedDraft = await renderHtmlVideoFramePreview({
    projectDir,
    project,
    frameId: 'scene_01',
    draftId: 'draft_discarded',
    services,
  });
  assert.equal(discardedDraft.success, false);
  assert.equal(discardedDraft.code, 'DRAFT_NOT_FOUND');

  const acceptedDraft = await renderHtmlVideoFramePreview({
    projectDir,
    project,
    frameId: 'scene_01',
    draftId: 'draft_accepted',
    services,
  });
  assert.equal(acceptedDraft.success, true);
  assert.equal(renderedFrames.at(-1).html_path, acceptedDraftHtmlPath);
  assert.match(acceptedDraft.preview_path, /draft_accepted/);
  assert.equal(acceptedDraft.project.frames[0].html_path, officialHtmlPath);

  const renderCountBeforeBlockedDraft = renderedFrames.length;
  const blockedDraft = await renderHtmlVideoFramePreview({
    projectDir,
    project,
    frameId: 'scene_01',
    draftId: 'draft_unregistered',
    services,
  });
  assert.equal(blockedDraft.code, 'runtime_visual_asset_policy_violation');
  assert.equal(renderedFrames.length, renderCountBeforeBlockedDraft + 1, 'preview 必须进入 runtime gate');
  assert.equal(blockedDraft.preview_frame_id, undefined, '失败响应不伪造成功 preview id');
  assert.equal(blockedDraft.project.asset_usage_report.runtime_policy_violations[0].frame_id, 'beat_01');
  assert.equal(blockedDraft.diagnostics.find(item => item.code === 'runtime_visual_asset_policy_violation').frame_id, 'beat_01');
  assert.notEqual(blockedDraft.project.status, 'failed', 'preview 失败不得污染 workflow/project terminal 状态');
  const safeDraftAfterFailure = await renderHtmlVideoFramePreview({
    projectDir, project: blockedDraft.project, frameId: 'scene_01', draftId: 'draft_0001', services,
  });
  assert.equal(safeDraftAfterFailure.project.asset_usage_report.runtime_policy_violations.length, 1, '安全 draft 成功不得清理正式帧违规');
  const safeOfficial = await renderHtmlVideoFramePreview({
    projectDir, project: safeDraftAfterFailure.project, frameId: 'scene_01', services,
  });
  assert.deepEqual(safeOfficial.project.asset_usage_report.runtime_policy_violations, [], '正式 HTML 成功预览才可清理违规');

  await fs.rm(rootDir, { recursive: true, force: true });
  console.log('html-video draft frame preview tests passed');
})();
