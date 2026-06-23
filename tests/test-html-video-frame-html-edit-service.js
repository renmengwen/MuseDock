const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  readFrameHtml,
  saveFrameHtmlDraft,
  acceptFrameDraft,
  discardFrameDraft,
  resolveProjectPath,
} = require('../server/services/creative-video/html-video/frameHtmlEditService');

(async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-video-frame-edit-'));

  try {
    fs.mkdirSync(path.join(projectDir, 'frames'), { recursive: true });
    const officialPath = path.join(projectDir, 'frames', '06-scene_06.html');
    fs.writeFileSync(officialPath, '<!doctype html><html><body>旧版</body></html>', 'utf-8');

    const project = {
      frames: [{
        id: 'frame_internal',
        scene_id: 'scene_06',
        graph_node_id: 'graph_scene_06',
        source_mode: 'raw_html',
        html_path: 'frames/06-scene_06.html',
        drafts: [],
        revisions: [],
      }],
      revisions: [],
    };

    const readResult = await readFrameHtml({
      projectDir,
      project,
      frameId: 'graph_scene_06',
    });
    assert.equal(readResult.success, true);
    assert.equal(readResult.resolved_frame_id, 'frame_internal');
    assert.match(readResult.html, /旧版/);

    const draftHtml = '<!doctype html><html><body>草稿</body></html>';
    const draftResult = await saveFrameHtmlDraft({
      projectDir,
      project,
      frameId: 'graph_scene_06',
      html: draftHtml,
      summary: '保存源码草稿',
      instruction: '调整画面文案',
    });
    assert.equal(draftResult.success, true);
    assert.equal(draftResult.frame_id, 'graph_scene_06');
    assert.equal(draftResult.resolved_frame_id, 'frame_internal');
    assert.equal(draftResult.requires_render, true);
    assert.equal(project.frames[0].drafts.length, 1);
    assert.equal(project.frames[0].active_draft_id, draftResult.draft.id);
    assert.equal(fs.readFileSync(path.join(projectDir, draftResult.draft.html_path), 'utf-8'), draftHtml);
    assert.match(fs.readFileSync(officialPath, 'utf-8'), /旧版/);
    assert.doesNotMatch(fs.readFileSync(officialPath, 'utf-8'), /草稿/);
    assert.throws(() => resolveProjectPath('', 'frames/06-scene_06.html'), /工程目录|逃逸工程目录/);

    fs.writeFileSync(path.join(projectDir, 'frames', 'blocked.html'), '<!doctype html><html><body>阻塞</body></html>', 'utf-8');
    fs.mkdirSync(path.join(projectDir, 'frames', '.drafts'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'frames', '.drafts', 'blocked_frame'), 'not a directory', 'utf-8');
    const blockedFrame = {
      id: 'blocked_frame',
      source_mode: 'raw_html',
      html_path: 'frames/blocked.html',
      drafts: [],
      active_draft_id: '',
    };
    project.frames.push(blockedFrame);
    const blockedDraftResult = await saveFrameHtmlDraft({
      projectDir,
      project,
      frameId: 'blocked_frame',
      html: '<!doctype html><html><body>无法写入</body></html>',
    });
    assert.equal(blockedDraftResult.success, false);
    assert.equal(blockedDraftResult.code, 'FRAME_HTML_WRITE_FAILED');
    assert.equal(blockedFrame.drafts.length, 0);
    assert.equal(blockedFrame.active_draft_id, '');

    const replaceResult = await saveFrameHtmlDraft({
      projectDir,
      project,
      frameId: 'graph_scene_06',
      html: draftHtml,
      mode: 'replace',
    });
    assert.equal(replaceResult.success, false);
    assert.equal(replaceResult.code, 'FRAME_REPLACE_FORBIDDEN');

    const invalidResult = await saveFrameHtmlDraft({
      projectDir,
      project,
      frameId: 'graph_scene_06',
      html: '<div>bad</div>',
    });
    assert.equal(invalidResult.success, false);
    assert.equal(invalidResult.code, 'FRAME_HTML_INVALID');

    const externalScriptResult = await saveFrameHtmlDraft({
      projectDir,
      project,
      frameId: 'graph_scene_06',
      html: '<!doctype html><html><body><script src="https://example.com/a.js"></script></body></html>',
    });
    assert.equal(externalScriptResult.success, false);
    assert.equal(externalScriptResult.code, 'FRAME_HTML_EXTERNAL_SCRIPT_BLOCKED');

    const protocolRelativeScriptResult = await saveFrameHtmlDraft({
      projectDir,
      project,
      frameId: 'graph_scene_06',
      html: '<!doctype html><html><body><script src="//cdn.example/a.js"></script></body></html>',
    });
    assert.equal(protocolRelativeScriptResult.success, false);
    assert.equal(protocolRelativeScriptResult.code, 'FRAME_HTML_EXTERNAL_SCRIPT_BLOCKED');

    const acceptResult = await acceptFrameDraft({
      projectDir,
      project,
      frameId: 'graph_scene_06',
      draftId: draftResult.draft.id,
    });
    assert.equal(acceptResult.success, true);
    assert.equal(acceptResult.accepted_draft_id, draftResult.draft.id);
    assert.equal(project.frames[0].active_draft_id, '');
    assert.equal(project.frames[0].drafts[0].status, 'accepted');
    assert.match(fs.readFileSync(officialPath, 'utf-8'), /草稿/);
    const revisionCountAfterAccept = project.revisions.length;

    const acceptedDiscardResult = await discardFrameDraft({
      project,
      frameId: 'graph_scene_06',
      draftId: draftResult.draft.id,
    });
    assert.equal(acceptedDiscardResult.success, false);
    assert.equal(acceptedDiscardResult.code, 'DRAFT_NOT_READY');
    assert.equal(project.frames[0].drafts[0].status, 'accepted');
    assert.equal(project.revisions.length, revisionCountAfterAccept);

    const secondDraftResult = await saveFrameHtmlDraft({
      projectDir,
      project,
      frameId: 'scene_06',
      html: '<!doctype html><html><body>第二个草稿</body></html>',
    });
    assert.equal(secondDraftResult.success, true);
    assert.equal(project.frames[0].active_draft_id, secondDraftResult.draft.id);

    const discardResult = await discardFrameDraft({
      project,
      frameId: 'scene_06',
      draftId: secondDraftResult.draft.id,
    });
    assert.equal(discardResult.success, true);
    assert.equal(discardResult.discarded_draft_id, secondDraftResult.draft.id);
    assert.equal(project.frames[0].active_draft_id, '');
    assert.equal(project.frames[0].drafts[1].status, 'discarded');

    const templateProject = {
      frames: [{
        id: 'template_frame',
        source_mode: 'template_inputs',
        html_path: 'frames/06-scene_06.html',
      }],
    };
    const templateRead = await readFrameHtml({
      projectDir,
      project: templateProject,
      frameId: 'template_frame',
    });
    assert.equal(templateRead.success, false);
    assert.equal(templateRead.code, 'FRAME_HTML_NOT_AVAILABLE');

    const missingFileProject = {
      frames: [{
        id: 'missing_frame',
        source_mode: 'raw_html',
        html_path: 'frames/missing.html',
      }],
    };
    const missingRead = await readFrameHtml({
      projectDir,
      project: missingFileProject,
      frameId: 'missing_frame',
    });
    assert.equal(missingRead.success, false);
    assert.equal(missingRead.code, 'FRAME_HTML_NOT_AVAILABLE');

    console.log('html-video frame html edit service tests passed');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
})();
