const assert = require('assert/strict');
const express = require('express');
const http = require('http');

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

async function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const workflowId = '202606170000000001';
  const calls = [];
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
    renderHtmlVideoProject: async id => {
      calls.push(['render', id]);
      return {
        success: true,
        workflow_id: id,
        html_video_project: { project_id: 'p1', template_id: 'simple' },
        html_video_project_path: '/tmp/project',
        output_path: '/tmp/project/frames/frame_01.mp4',
        message: '单帧预览已更新。',
      };
    },
    exportHtmlVideoProject: async id => {
      calls.push(['export', id]);
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
    assert.equal((await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/render`, {})).body.message, '单帧预览已更新。');
    const exported = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/export`, {});
    assert.ok(exported.body.html_video_project);
    assert.match(exported.body.message, /导出|渲染/);
    const exportsResult = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/html-video-project/exports`);
    assert.equal(exportsResult.statusCode, 200);
    assert.equal(exportsResult.body.exports.length, 1);

    const reservedRequests = [
      ['PATCH', 'timeline'],
      ['PATCH', 'frames/frame_01/html'],
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

    assert.deepEqual(calls.map(item => item[0]), ['get', 'patch', 'post', 'patch-inputs', 'patch-frame', 'edit', 'render', 'export', 'exports']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('html-video route tests passed');
})();
