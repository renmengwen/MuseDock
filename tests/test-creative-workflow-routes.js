const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const creativeWorkflowsRouter = require('../server/routes/creativeWorkflows');
const workflows = require('../server/services/creativeWorkflows');
const { createCreativeTaskRegistry } = require('../server/services/creativeTaskRegistry');

async function requestJson(server, method, pathName, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        text += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function requestSse(server, pathName, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        text += chunk;
      });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: text, headers: res.headers }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body || {}));
    req.end();
  });
}

async function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function waitFor(assertion, timeoutMs = 1000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'creative-workflow-route-'));
}

function routeWorkflowServices(now = '2026-06-12T12:00:00.000Z') {
  return {
    idFactory: () => '202606121200000005',
    now: () => now,
    researchService: {
      createResearchContext: async ({ now: n }) => ({
        status: 'disabled',
        query: '',
        sources: [],
        summary: '',
        updated_at: n,
      }),
    },
  };
}

function createFakeCreativeWorkflows(options = {}) {
  const workflowId = options.workflowId || '202606121200000001';
  const runWorkflowIds = [];
  let createMode = 'success';
  let getMode = 'success';

  return {
    workflowId,
    runWorkflowIds,
    setCreateMode(mode) {
      createMode = mode;
    },
    setGetMode(mode) {
      getMode = mode;
    },
    service: {
      createCreativeWorkflow: async () => {
        if (createMode === 'bad-input') {
          return {
            success: false,
            message: '请输入视频方向、抖音 ID 或抖音链接。',
          };
        }
        if (createMode === 'throw') {
          throw new Error('create failed');
        }
        return {
          success: true,
          status: 'queued',
          workflow_id: workflowId,
          creative_context: {
            asset_context: { status: 'disabled' },
          },
          message: '创作任务已创建。',
        };
      },
      runCreativeWorkflow: async id => {
        runWorkflowIds.push(id);
        return { success: true };
      },
      getCreativeWorkflow: async id => {
        if (getMode === 'missing') {
          return {
            success: false,
            workflow_id: id,
            message: '未找到创作任务。',
          };
        }
        return {
          success: true,
          data: { workflow_id: id },
        };
      },
    },
    taskService: {
      startCreativeWorkflowTask: async id => ({
        success: true,
        workflow_id: id,
        task_id: 'creative-task-route',
        active_task: {
          task_id: 'creative-task-route',
          workflow_id: id,
          operation_id: 'workflow-op-route',
          kind: 'creative_workflow',
          status: 'running',
        },
      }),
      subscribeCreativeWorkflowEvents: async ({ workflowId: eventWorkflowId, taskId, sinceSeq, writeEvent }) => {
        writeEvent({
          seq: sinceSeq + 1,
          type: 'stage_progress',
          workflow_id: eventWorkflowId,
          task_id: taskId,
          message: '正在生成工程...',
        });
        writeEvent({
          seq: sinceSeq + 2,
          type: 'task_stream_closed',
          workflow_id: eventWorkflowId,
          task_id: taskId,
          status: 'done',
          final_seq: sinceSeq + 2,
          message: '任务事件流已结束。',
        });
      },
      getActiveCreativeWorkflowTask: async id => ({
        success: true,
        workflow_id: id,
        active_task: { task_id: 'creative-task-route', workflow_id: id, status: 'running' },
      }),
    },
  };
}

async function assertMountedPost(server, workflowId) {
  const createResponse = await requestJson(server, 'POST', '/api/creative-workflows', {
    input: '做一个新视频',
  });
  assert.strictEqual(createResponse.statusCode, 202);
  assert.strictEqual(createResponse.body.success, true);
  assert.strictEqual(createResponse.body.status, 'queued');
  assert.strictEqual(createResponse.body.workflow_id, workflowId);
  assert.strictEqual(createResponse.body.task_id, 'creative-task-route');
  assert.strictEqual(createResponse.body.active_task.status, 'running');
  assert.strictEqual(createResponse.body.creative_context.asset_context.status, 'disabled');
  assert.match(createResponse.body.message, /创作任务已创建/);
}

async function runIsolatedRouterTests() {
  const app = express();
  const fake = createFakeCreativeWorkflows();

  app.use(express.json());
  app.locals.creativeWorkflows = fake.service;
  app.locals.creativeWorkflowTasks = fake.taskService;
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);

  try {
    await assertMountedPost(server, fake.workflowId);

    const getResponse = await requestJson(server, 'GET', `/api/creative-workflows/${fake.workflowId}`);
    assert.strictEqual(getResponse.statusCode, 200);
    assert.strictEqual(getResponse.body.success, true);
    assert.strictEqual(getResponse.body.data.workflow_id, fake.workflowId);

    const sseResponse = await requestSse(server, `/api/creative-workflows/${fake.workflowId}/events`, {
      task_id: 'creative-task-route',
      since_seq: 0,
    });
    assert.strictEqual(sseResponse.statusCode, 200);
    assert.match(sseResponse.headers['content-type'], /text\/event-stream/);
    assert.match(sseResponse.body, /event: stage_progress/);
    assert.match(sseResponse.body, /任务事件流已结束/);

    const activeResponse = await requestJson(server, 'GET', `/api/creative-workflows/${fake.workflowId}/tasks/active`);
    assert.strictEqual(activeResponse.statusCode, 200);
    assert.strictEqual(activeResponse.body.active_task.task_id, 'creative-task-route');

    fake.setCreateMode('bad-input');
    const badInputResponse = await requestJson(server, 'POST', '/api/creative-workflows', {});
    assert.strictEqual(badInputResponse.statusCode, 400);
    assert.strictEqual(badInputResponse.body.success, false);
    assert.match(badInputResponse.body.message, /请输入视频方向、抖音 ID 或抖音链接/);

    fake.setGetMode('missing');
    const missingResponse = await requestJson(server, 'GET', '/api/creative-workflows/202606121200000002');
    assert.strictEqual(missingResponse.statusCode, 404);
    assert.strictEqual(missingResponse.body.success, false);
    assert.match(missingResponse.body.message, /未找到创作任务/);

    fake.setCreateMode('throw');
    const thrownResponse = await requestJson(server, 'POST', '/api/creative-workflows', {
      input: '抛错测试',
    });
    assert.strictEqual(thrownResponse.statusCode, 500);
    assert.strictEqual(thrownResponse.body.success, false);
    assert.match(thrownResponse.body.message, /创建创作任务失败/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function runRealAppMountTest() {
  const realApp = require('../server/app');
  const fake = createFakeCreativeWorkflows({ workflowId: '202606121200000003' });
  realApp.locals.creativeWorkflows = fake.service;
  realApp.locals.creativeWorkflowTasks = fake.taskService;

  const server = await listen(realApp);

  try {
    await assertMountedPost(server, fake.workflowId);
  } finally {
    delete realApp.locals.creativeWorkflows;
    delete realApp.locals.creativeWorkflowTasks;
    await new Promise(resolve => server.close(resolve));
  }
}

async function runDefaultTaskServiceInjectionTest() {
  const app = express();
  const workflowId = '202606121200000004';
  const patchCalls = [];
  const runCalls = [];
  const fakeService = {
    createCreativeWorkflow: async () => ({
      success: true,
      status: 'queued',
      workflow_id: workflowId,
      creative_context: { asset_context: { status: 'disabled' } },
      message: '创作任务已创建。',
    }),
    patchCreativeWorkflowTaskSummary: async (id, patch) => {
      patchCalls.push({ id, patch });
      return { success: true, workflow_id: id };
    },
    runCreativeWorkflow: async (id, options) => {
      runCalls.push({ id, hasTaskContext: Boolean(options.taskContext) });
      return { success: true, workflow_id: id, status: 'done', message: '完成' };
    },
  };

  app.use(express.json());
  app.locals.creativeWorkflows = fakeService;
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);

  try {
    const createResponse = await requestJson(server, 'POST', '/api/creative-workflows', {
      input: '使用 route service 启动后台任务',
    });
    assert.strictEqual(createResponse.statusCode, 202);
    assert.strictEqual(createResponse.body.success, true);
    assert.ok(createResponse.body.task_id);
    await waitFor(() => assert.ok(patchCalls.length >= 1));
    assert.strictEqual(patchCalls[0].id, workflowId);
    await waitFor(() => assert.deepStrictEqual(runCalls, [{ id: workflowId, hasTaskContext: true }]));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function run() {
  await runIsolatedRouterTests();
  await runRealAppMountTest();
  await runDefaultTaskServiceInjectionTest();
  await runGetWorkflowUsesActiveRegistryTest();
  await runSseRouteCleanupStaticTest();
  await runEditorRouteTests();
}

async function runGetWorkflowUsesActiveRegistryTest() {
  const app = express();
  const rootDir = tempRoot();
  const workflowId = '202606121200000005';
  await workflows.createCreativeWorkflow({ input: '真实路由 active registry 测试', useResearch: false }, {
    rootDir,
    services: routeWorkflowServices(),
  });

  const filePath = workflows.getWorkflowPath(workflowId, rootDir);
  const record = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  record.status = 'running';
  record.active_task_id = 'creative-task-route-active';
  record.active_operation_id = 'workflow-op-route-active';
  record.task_status = 'running';
  record.current_stage = 'project';
  record.current_stage_message = '正在生成工程...';
  record.stages = record.stages.map(stage => (
    stage.id === 'project'
      ? {
        ...stage,
        status: 'running',
        message: '正在生成工程...',
        started_at: '2026-06-12T12:00:00.000Z',
        updated_at: '2026-06-12T12:00:00.000Z',
      }
      : stage
  ));
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');

  const registry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-route-active',
    now: () => '2026-06-12T12:20:00.000Z',
  });
  registry.createDetachedTask({
    workflowId,
    operationId: 'workflow-op-route-active',
    kind: 'creative_workflow',
  });

  app.use(express.json());
  app.locals.creativeTaskRegistry = registry;
  app.locals.creativeWorkflows = {
    getCreativeWorkflow: async (id, options = {}) => workflows.getCreativeWorkflow(id, {
      ...options,
      rootDir,
      services: routeWorkflowServices('2026-06-12T12:20:00.000Z'),
      staleStageTimeoutMs: 10 * 60 * 1000,
    }),
  };
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);

  try {
    const response = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}`);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.data.status, 'running');
    assert.strictEqual(response.body.data.task_status, 'running');
    assert.strictEqual(response.body.data.active_task_id, 'creative-task-route-active');
    assert.strictEqual(response.body.data.active_task.task_id, 'creative-task-route-active');
    assert.strictEqual(response.body.data.stages.find(stage => stage.id === 'project').status, 'running');

    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    assert.strictEqual(persisted.status, 'running');
    assert.strictEqual(persisted.stages.find(stage => stage.id === 'project').status, 'running');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function runSseRouteCleanupStaticTest() {
  const routeSource = fs.readFileSync(path.join(__dirname, '../server/routes/creativeWorkflows.js'), 'utf-8');
  assert.match(routeSource, /res\.on\('close'/);
  assert.match(routeSource, /res\.on\('error'/);
  assert.match(routeSource, /res\.on\('finish'/);
  assert.match(routeSource, /function cleanup|const cleanup/);
}

async function runEditorRouteTests() {
  const workflowId = '202606131200000001';
  const sceneSpec = {
    title: '测试',
    scenes: [{ id: 'scene_01', duration: 5, narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: [] } }],
  };
  const frameSpecs = {
    frames: [{ id: 'frame_01_01', scene_id: 'scene_01', start: 0, duration: 5, template: 'hero_title' }],
  };

  const fakeService = {
    getCreativeWorkflowVideoSpec: async id => ({
      success: true,
      workflow_id: id,
      scene_spec: sceneSpec,
      frame_specs: frameSpecs,
      render_versions: [{ id: 'render_001', status: 'rendered' }],
    }),
    patchCreativeWorkflowVideoSpec: async (id, payload) => ({
      success: true,
      workflow_id: id,
      scene_spec: payload.scene_spec || sceneSpec,
      frame_specs: payload.frame_specs || frameSpecs,
      requires_tts: false,
      requires_render: true,
      message: '视频规格已保存。',
    }),
    getCreativeWorkflowSceneSpec: async id => ({
      success: true,
      workflow_id: id,
      scene_spec: sceneSpec,
    }),
    patchCreativeWorkflowSceneSpec: async (id, edit) => ({
      success: true,
      workflow_id: id,
      scene_spec: { ...sceneSpec, title: 'edited' },
      edit_type: edit.type,
      requires_tts: false,
      requires_render: true,
      message: '编辑已保存。',
    }),
    rewriteCreativeWorkflowScene: async (id, sceneId) => ({
      success: true,
      workflow_id: id,
      scene_id: sceneId,
      scene_spec: { ...sceneSpec, title: 'rewritten' },
      requires_tts: true,
      requires_render: true,
      message: '场景已重写。',
    }),
    ttsCreativeWorkflowScene: async (id, sceneId) => ({
      success: true,
      workflow_id: id,
      scene_id: sceneId,
      output_path: '/tmp/output.mp4',
      message: '场景配音已更新。',
    }),
    rerenderCreativeWorkflow: async id => ({
      success: true,
      workflow_id: id,
      output_path: '/tmp/output.mp4',
      message: '成片已重新渲染。',
    }),
    remixCreativeWorkflow: async (id, payload) => ({
      success: true,
      source_workflow_id: id,
      workflow_id: payload?.workflow_id || '202606131200000002',
      message: '二创任务已创建。',
    }),
  };

  const app = express();
  app.use(express.json());
  app.locals.creativeWorkflows = fakeService;
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);

  try {
    const getVideoSpecRes = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/video-spec`);
    assert.strictEqual(getVideoSpecRes.statusCode, 200);
    assert.strictEqual(getVideoSpecRes.body.success, true);
    assert.strictEqual(getVideoSpecRes.body.scene_spec.title, '测试');
    assert.strictEqual(getVideoSpecRes.body.frame_specs.frames[0].id, 'frame_01_01');

    const patchVideoSpecRes = await requestJson(server, 'PATCH', `/api/creative-workflows/${workflowId}/video-spec`, { scene_spec: { ...sceneSpec, title: 'edited video' }, frame_specs: frameSpecs });
    assert.strictEqual(patchVideoSpecRes.statusCode, 200);
    assert.strictEqual(patchVideoSpecRes.body.success, true);
    assert.strictEqual(patchVideoSpecRes.body.requires_render, true);

    const getRes = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/scene-spec`);
    assert.strictEqual(getRes.statusCode, 200);
    assert.strictEqual(getRes.body.success, true);
    assert.strictEqual(getRes.body.scene_spec.title, '测试');

    const patchRes = await requestJson(server, 'PATCH', `/api/creative-workflows/${workflowId}/scene-spec`, { type: 'caption_text', scene_id: 'scene_01', caption_id: 'c1', text: '新字幕' });
    assert.strictEqual(patchRes.statusCode, 200);
    assert.strictEqual(patchRes.body.success, true);
    assert.strictEqual(patchRes.body.requires_render, true);

    const rewriteRes = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/scenes/scene_01/rewrite`, { narration_text: '新旁白' });
    assert.strictEqual(rewriteRes.statusCode, 200);
    assert.strictEqual(rewriteRes.body.success, true);
    assert.strictEqual(rewriteRes.body.requires_tts, true);

    const ttsRes = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/scenes/scene_01/tts`, {});
    assert.strictEqual(ttsRes.statusCode, 200);
    assert.strictEqual(ttsRes.body.success, true);
    assert.strictEqual(ttsRes.body.scene_id, 'scene_01');

    const rerenderRes = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/rerender`, {});
    assert.strictEqual(rerenderRes.statusCode, 200);
    assert.strictEqual(rerenderRes.body.success, true);
    assert.strictEqual(rerenderRes.body.output_path, '/tmp/output.mp4');

    const remixRes = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/remix`, { workflow_id: '202606131200000099' });
    assert.strictEqual(remixRes.statusCode, 200);
    assert.strictEqual(remixRes.body.success, true);
    assert.strictEqual(remixRes.body.source_workflow_id, workflowId);

    const invalidId = await requestJson(server, 'GET', '/api/creative-workflows/invalid!/scene-spec');
    assert.strictEqual(invalidId.statusCode, 400);
    assert.strictEqual(invalidId.body.success, false);

    const emptyScene = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/scenes/%20/rewrite`, {});
    assert.strictEqual(emptyScene.statusCode, 400);
    assert.strictEqual(emptyScene.body.success, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

run().then(() => {
  console.log('creative workflow route tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
