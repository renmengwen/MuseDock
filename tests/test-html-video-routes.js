const assert = require('assert/strict');
const express = require('express');
const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');

const creativeWorkflowsRouter = require('../server/routes/creativeWorkflows');

async function requestJson(server, method, pathName, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: { 'Content-Type': 'application/json' },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

async function requestText(server, method, pathName, headers = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: { Accept: 'text/plain', ...headers },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: text, contentType: res.headers['content-type'] || '' }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const workflowId = '202606170000000001';
  const calls = [];
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-export-route-'));
  const exportFilePath = path.join(tmpDir, 'output.mp4');
  await fs.writeFile(exportFilePath, 'fake mp4');
  const fakeService = {
    getCreativeWorkflowHtmlVideoProject: async id => {
      calls.push(['get', id]);
      return {
        success: true,
        workflow_id: id,
        html_video_project: { project_id: 'p1', template_id: 'simple', template_inputs: { headline: '标题' } },
        html_video_project_path: '/tmp/project',
      };
    },
    patchCreativeWorkflowHtmlVideoProject: async (id, payload) => {
      calls.push(['patch', id, payload.type]);
      return {
        success: true,
        workflow_id: id,
        html_video_project: { project_id: 'p1', template_id: 'simple', template_inputs: payload.patch || {} },
        requires_tts: false,
        requires_render: true,
        message: 'html-video 工程已保存。',
      };
    },
    patchHtmlVideoProjectInputs: async (id, payload) => {
      calls.push(['patch-inputs', id, payload.template_inputs_patch?.headline]);
      return { success: true, workflow_id: id, requires_render: true, message: '模板字段已保存，需要重新渲染。' };
    },
    patchHtmlVideoProjectFrame: async (id, frameId, payload) => {
      calls.push(['patch-frame', id, frameId, payload.frame_inputs_patch?.headline]);
      return { success: true, workflow_id: id, requires_render: true, message: '帧字段已保存，需要重新渲染。' };
    },
    getHtmlVideoProjectFrameHtml: async (id, frameId, payload) => {
      calls.push(['get-frame-html', id, frameId, payload?.format || 'json']);
      return { success: true, workflow_id: id, frame_id: frameId, resolved_frame_id: 'frame_01', html: '<!doctype html><html></html>', html_path: 'frames/frame_01.html' };
    },
    saveHtmlVideoProjectFrameHtml: async (id, frameId, payload) => {
      calls.push(['put-frame-html', id, frameId, payload.mode || 'draft']);
      return { success: true, workflow_id: id, frame_id: frameId, draft: { id: 'draft_0001', html_path: 'frames/.drafts/frame_01/draft_0001.html' }, requires_render: true, message: '帧源码草稿已保存，可渲染单帧预览。' };
    },
    acceptHtmlVideoProjectFrameDraft: async (id, frameId, draftId) => {
      calls.push(['accept-draft', id, frameId, draftId]);
      return { success: true, workflow_id: id, frame_id: frameId, accepted_draft_id: draftId, message: '草稿已接受，需要重新导出成片。' };
    },
    discardHtmlVideoProjectFrameDraft: async (id, frameId, draftId) => {
      calls.push(['discard-draft', id, frameId, draftId]);
      return { success: true, workflow_id: id, frame_id: frameId, discarded_draft_id: draftId, message: '草稿已放弃。' };
    },
    editHtmlVideoProject: async (id, payload) => {
      calls.push(['edit', id, payload.instruction]);
      return { success: true, workflow_id: id, requires_render: true, message: '编辑已应用，需要重新渲染。' };
    },
    renderCreativeWorkflowHtmlVideoProject: async id => {
      calls.push(['post', id]);
      return {
        success: true,
        workflow_id: id,
        html_video_project: { project_id: 'p1', template_id: 'simple' },
        html_video_project_path: '/tmp/project',
        output_path: '/tmp/project/exports/output.mp4',
        message: 'HTML 已重新生成。',
      };
    },
    renderHtmlVideoProject: async (id, payload) => {
      calls.push(['render', id, payload?.mode, payload?.frame_id || payload?.frameId || '']);
      return {
        success: true,
        workflow_id: id,
        html_video_project: { project_id: 'p1', template_id: 'simple' },
        html_video_project_path: '/tmp/project',
        output_path: payload?.mode === 'materialize' ? undefined : '/tmp/project/frames/frame_01.mp4',
        message: payload?.mode === 'materialize' ? 'HTML 已重新生成。' : '单帧预览已更新。',
      };
    },
    exportHtmlVideoProject: async (id, payload) => {
      calls.push(['export', id, payload?.skip_render === true]);
      return {
        success: true,
        workflow_id: id,
        html_video_project: { project_id: 'p1', template_id: 'simple' },
        html_video_project_path: '/tmp/project',
        output_path: '/tmp/project/exports/output.mp4',
        message: '成片已导出。',
      };
    },
    listHtmlVideoProjectExports: async id => {
      calls.push(['exports', id]);
      return { success: true, workflow_id: id, exports: [{ id: 'export_001', path: 'exports/output.mp4' }] };
    },
    getHtmlVideoProjectExportFile: async (id, exportId) => {
      calls.push(['export-file', id, exportId]);
      if (exportId !== 'export_001') {
        return { success: false, code: 'EXPORT_NOT_FOUND', workflow_id: id, export_id: exportId, message: '未找到导出文件记录。' };
      }
      return { success: true, workflow_id: id, export_id: exportId, file_path: exportFilePath };
    },
  };

  const app = express();
  app.use(express.json());
  app.locals.creativeWorkflows = fakeService;
  app.use('/api/creative-workflows', creativeWorkflowsRouter);
  const server = await listen(app);

  try {
    const got = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/html-video-project`);
    assert.equal(got.statusCode, 200);
    assert.equal(got.body.success, true);
    assert.ok(got.body.html_video_project);
    assert.equal(got.body.html_video_project_path, '/tmp/project');
    assert.equal(got.body.html_video_project.template_id, 'simple');
    assert.equal(got.body.html_video_project.template_inputs.headline, '标题');

    const patched = await requestJson(server, 'PATCH', `/api/creative-workflows/${workflowId}/html-video-project`, {
      type: 'template_inputs_patch',
      patch: { headline: '新标题' },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.body.success, true);
    assert.equal(patched.body.requires_render, true);

    const rendered = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project`, {});
    assert.equal(rendered.statusCode, 200);
    assert.equal(rendered.body.success, true);
    assert.ok(rendered.body.html_video_project);
    assert.equal(rendered.body.message, 'HTML 已重新生成。');
    assert.equal(rendered.body.output_path, '/tmp/project/exports/output.mp4');

    assert.equal((await requestJson(server, 'PATCH', `/api/creative-workflows/${workflowId}/html-video-project/inputs`, { patch: { headline: '模板' } })).statusCode, 200);
    assert.equal((await requestJson(server, 'PATCH', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01`, { patch: { headline: '帧' } })).statusCode, 200);
    assert.equal((await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/edit`, { instruction: '标题更狠' })).statusCode, 200);
    const materialized = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/render`, { mode: 'materialize' });
    assert.equal(materialized.statusCode, 200);
    assert.equal(materialized.body.message, 'HTML 已重新生成。');
    const framePreview = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/render`, { mode: 'frame', frame_id: 'frame_01' });
    assert.equal(framePreview.statusCode, 200);
    assert.equal(framePreview.body.message, '单帧预览已更新。');
    const frameHtmlJson = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01/html`);
    assert.equal(frameHtmlJson.statusCode, 200);
    assert.equal(frameHtmlJson.body.html, '<!doctype html><html></html>');

    const frameHtmlText = await requestText(server, 'GET', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01/html`);
    assert.equal(frameHtmlText.statusCode, 200);
    assert.match(frameHtmlText.contentType, /text\/plain/);
    assert.equal(frameHtmlText.body, '<!doctype html><html></html>');
    assert.equal(calls.filter(item => item[0] === 'get-frame-html')[1][3], 'text');

    const savedDraft = await requestJson(server, 'PUT', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01/html`, {
      html: '<!doctype html><html></html>',
      mode: 'draft',
    });
    assert.equal(savedDraft.statusCode, 200);
    assert.equal(savedDraft.body.draft.id, 'draft_0001');

    const acceptedDraft = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01/drafts/draft_0001/accept`, {});
    assert.equal(acceptedDraft.statusCode, 200);
    assert.equal(acceptedDraft.body.accepted_draft_id, 'draft_0001');

    const discardedDraft = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01/drafts/draft_0002/discard`, {});
    assert.equal(discardedDraft.statusCode, 200);
    assert.equal(discardedDraft.body.discarded_draft_id, 'draft_0002');

    for (const [payload, pattern] of [
      [{}, /mode 无效|materialize|frame/],
      [{ mode: 'bad' }, /mode 无效|materialize|frame/],
      [{ mode: 'frame' }, /帧 ID/],
    ]) {
      const response = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/render`, payload);
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.success, false);
      assert.match(response.body.message, pattern);
    }
    const exported = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/export`, { skip_render: true });
    assert.ok(exported.body.html_video_project);
    assert.match(exported.body.message, /导出|渲染/);
    const exportsResult = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/html-video-project/exports`);
    assert.equal(exportsResult.statusCode, 200);
    assert.equal(exportsResult.body.exports.length, 1);
    const exportFile = await requestText(server, 'GET', `/api/creative-workflows/${workflowId}/html-video-project/exports/export_001/file`);
    assert.equal(exportFile.statusCode, 200);
    assert.equal(exportFile.body, 'fake mp4');
    const missingExportFile = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/html-video-project/exports/missing_export/file`);
    assert.equal(missingExportFile.statusCode, 404);
    assert.match(missingExportFile.body.message, /未找到导出文件记录/);

    const reservedRequests = [
      ['PATCH', 'timeline'],
      ['PATCH', 'frames/frame_01/elements/headline'],
      ['PATCH', 'frames/frame_01/transition'],
      ['POST', 'frames/frame_01/enhance'],
      ['POST', 'frames/frame_01/unenhance'],
    ];
    for (const [method, suffix] of reservedRequests) {
      const response = await requestJson(server, method, `/api/creative-workflows/${workflowId}/html-video-project/${suffix}`, {});
      assert.equal(response.statusCode, 501, suffix);
      assert.equal(response.body.success, false);
      assert.match(response.body.message, /首版暂未开放/);
      assert.doesNotMatch(response.body.message, /not implemented/i);
    }

    const invalid = await requestJson(server, 'GET', '/api/creative-workflows/bad!/html-video-project');
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.body.message, /创作任务 ID 无效/);

    assert.deepEqual(calls.map(item => item[0]), ['get', 'patch', 'post', 'patch-inputs', 'patch-frame', 'edit', 'render', 'render', 'get-frame-html', 'get-frame-html', 'put-frame-html', 'accept-draft', 'discard-draft', 'export', 'exports', 'export-file', 'export-file']);
    assert.deepEqual(calls.filter(item => item[0] === 'render').map(item => [item[2], item[3]]), [['materialize', ''], ['frame', 'frame_01']]);
    assert.deepEqual(calls.find(item => item[0] === 'export'), ['export', workflowId, false]);
    assert.deepEqual(calls.find(item => item[0] === 'export-file'), ['export-file', workflowId, 'export_001']);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  console.log('html-video route tests passed');
})();
