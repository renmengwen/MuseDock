const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const creativeWorkflowsRouter = require('../server/routes/creativeWorkflows');
const workflows = require('../server/services/creative/creativeWorkflows');
const visualAssetUploads = require('../server/services/creative/visualAssetUploads');
const { createCreativeTaskRegistry, defaultRegistry } = require('../server/services/creative/creativeTaskRegistry');
const { createDiagnostic } = require('../server/services/creative-video/html-video/diagnostics');
const { createEmptyProject } = require('../server/services/creative-video/html-video/projectSchema');

const SSE_HELPER_TIMEOUT_MS = 1000;
const MINIMAL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const RETRY_PLAN_FINGERPRINT = 'a'.repeat(64);

function normalizeTimeoutMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : SSE_HELPER_TIMEOUT_MS;
}

function sseTimeoutError(pathName, body) {
  const snippet = String(body || '').slice(0, 500);
  return new Error(`SSE 请求超时：${pathName}，已收到：${snippet}`);
}

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

async function requestBuffer(server, method, pathName) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: Buffer.concat(chunks),
          headers: res.headers,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function requestRaw(server, method, pathName, body, headers = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers,
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function requestSse(server, pathName, body, options = {}) {
  const { port } = server.address();
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  return new Promise((resolve, reject) => {
    let text = '';
    let settled = false;
    let req = null;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      const error = sseTimeoutError(pathName, text);
      req?.destroy(error);
      settle(reject, error);
    }, timeoutMs);
    req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
    }, res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        text += chunk;
      });
      res.on('end', () => settle(resolve, { statusCode: res.statusCode, body: text, headers: res.headers }));
    });
    req.on('error', error => settle(reject, error));
    req.write(JSON.stringify(body || {}));
    req.end();
  });
}

function startSse(server, pathName, body, options = {}) {
  const { port } = server.address();
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const client = {
    req: null,
    response: null,
    destroy: () => client.req?.destroy(),
  };
  client.response = new Promise((resolve, reject) => {
    let settled = false;
    let req = null;
    const responseTimer = setTimeout(() => {
      const error = sseTimeoutError(pathName, '');
      req?.destroy(error);
      if (settled) return;
      settled = true;
      reject(error);
    }, timeoutMs);
    req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
    }, res => {
      settled = true;
      clearTimeout(responseTimer);
      let text = '';
      let endSettled = false;
      res.setEncoding('utf8');
      const ended = new Promise((resolveEnded, rejectEnded) => {
        const endTimer = setTimeout(() => {
          const error = sseTimeoutError(pathName, text);
          req.destroy(error);
          if (endSettled) return;
          endSettled = true;
          rejectEnded(error);
        }, timeoutMs);
        const finish = closed => {
          if (endSettled) return;
          endSettled = true;
          clearTimeout(endTimer);
          resolveEnded({
            statusCode: res.statusCode,
            body: text,
            headers: res.headers,
            closed,
          });
        };
        res.on('data', chunk => {
          text += chunk;
        });
        res.on('end', () => finish(false));
        res.on('close', () => finish(true));
      });
      resolve({
        req,
        res,
        get body() {
          return text;
        },
        ended,
        destroy: () => req.destroy(),
      });
    });
    client.req = req;
    req.on('error', error => {
      clearTimeout(responseTimer);
      if (!settled) reject(error);
    });
    req.write(JSON.stringify(body || {}));
    req.end();
  });
  return client;
}

async function openSse(server, pathName, body) {
  return startSse(server, pathName, body).response;
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    assert.strictEqual(getResponse.body.workflow_id, fake.workflowId);

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

async function testCreativeWorkflowListEndpointUsesBackendRecords() {
  const app = express();
  app.use(express.json());
  app.locals.creativeWorkflows = {
    listCreativeWorkflowRecords: async () => [
      {
        workflow_id: '202607031200000002',
        status: 'running',
        message: '正在生成工程...',
        created_at: '2026-07-03T12:00:00.000Z',
        updated_at: '2026-07-03T12:02:00.000Z',
        creative_context: { input: { raw_text: '第二个任务' } },
      },
      {
        workflow_id: '202607031200000001',
        status: 'done',
        message: '视频生成完成。',
        created_at: '2026-07-03T11:00:00.000Z',
        updated_at: '2026-07-03T11:05:00.000Z',
        creative_context: { input: { raw_text: '第一个任务' } },
        result: { hyperframes_freeform: { render: { output_url: '/api/output.mp4' } } },
      },
    ],
  };
  app.use('/api/creative-workflows', creativeWorkflowsRouter);
  const server = await listen(app);

  try {
    const { statusCode, body } = await requestJson(server, 'GET', '/api/creative-workflows');
    assert.equal(statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.workflows.length, 2);
    assert.equal(body.workflows[0].workflow_id, '202607031200000002');
    assert.equal(body.workflows[0].input, '第二个任务');
    assert.equal(body.workflows[1].output_url, '/api/output.mp4');
  } finally {
    server.close();
  }
}

async function testCreativeWorkflowDetailUsesNormalizedDto() {
  const app = express();
  app.use(express.json());
  app.locals.creativeWorkflows = {
    getCreativeWorkflow: async () => ({
      success: true,
      data: {
        workflow_id: '202607031200000001',
        status: 'done',
        message: '视频生成完成。',
        creative_context: { input: { raw_text: '详情任务' } },
        result: { hyperframes_freeform: { title: '详情标题', render: { output_url: '/api/detail.mp4' } } },
      },
    }),
  };
  app.use('/api/creative-workflows', creativeWorkflowsRouter);
  const server = await listen(app);

  try {
    const { statusCode, body } = await requestJson(server, 'GET', '/api/creative-workflows/202607031200000001');
    assert.equal(statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.workflow_id, '202607031200000001');
    assert.equal(body.title, '详情标题');
    assert.equal(body.input, '详情任务');
    assert.equal(body.result.render.output_url, '/api/detail.mp4');
    assert.equal(body.workflow.workflow_id, '202607031200000001');
  } finally {
    server.close();
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

async function runCreateRouteReturnsBeforeBackgroundResearchSettlesTest() {
  const app = express();
  const rootDir = tempRoot();
  const mediaRoot = path.join(rootDir, 'media');
  const registry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-background-research',
  });
  let resolveResearch;
  const services = {
    ...routeWorkflowServices(),
    researchService: {
      createResearchContext: async ({ enabled, query, now }) => new Promise(resolve => {
        resolveResearch = () => resolve(enabled
          ? { status: 'ready', query, sources: [], summary: '后台研究完成', updated_at: now }
          : { status: 'disabled', query: '', sources: [], summary: '', updated_at: now });
      }),
    },
  };
  const service = {
    createCreativeWorkflow: (payload) => workflows.createCreativeWorkflow(payload, { rootDir, mediaRoot, services }),
    patchCreativeWorkflowTaskSummary: (workflowId, patch) => workflows.patchCreativeWorkflowTaskSummary(workflowId, patch, { rootDir, services }),
    runCreativeWorkflow: (workflowId, options = {}) => workflows.runCreativeWorkflow(workflowId, { ...options, rootDir, mediaRoot, services }),
  };

  app.use(express.json());
  app.locals.creativeTaskRegistry = registry;
  app.locals.creativeWorkflows = service;
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);
  try {
    const response = await Promise.race([
      requestJson(server, 'POST', '/api/creative-workflows', {
        input: '做一期关于 AI 视频生产的知识科普',
        useResearch: true,
      }),
      delay(100).then(() => ({ timedOut: true })),
    ]);
    assert.notStrictEqual(response.timedOut, true);
    assert.strictEqual(response.statusCode, 202);
    assert.strictEqual(response.body.task_id, 'creative-task-background-research');
    assert.strictEqual(response.body.research_context.status, 'pending');
  } finally {
    resolveResearch?.();
    await new Promise(resolve => server.close(resolve));
  }
}

async function runCreateRouteWithCustomWorkflowServiceWithoutRegistryFailsTest() {
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
      return new Promise(() => {});
    },
  };

  app.use(express.json());
  app.locals.creativeWorkflows = fakeService;
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);

  try {
    assert.strictEqual(defaultRegistry.activeTaskForWorkflow(workflowId), null);
    const createResponse = await requestJson(server, 'POST', '/api/creative-workflows', {
      input: '自定义 workflow service 未注入 registry 时拒绝创建后台任务',
    });
    assert.strictEqual(createResponse.statusCode, 500);
    assert.strictEqual(createResponse.body.success, false);
    assert.strictEqual(createResponse.body.workflow_id, workflowId);
    assert.match(createResponse.body.message, /后台创作任务注册表未配置/);
    assert.strictEqual(defaultRegistry.activeTaskForWorkflow(workflowId), null);
    assert.deepStrictEqual(patchCalls, []);
    assert.deepStrictEqual(runCalls, []);
  } finally {
    const leakedTask = defaultRegistry.activeTaskForWorkflow(workflowId);
    if (leakedTask) {
      defaultRegistry.markDeleted(leakedTask.task_id, '测试清理默认注册表任务。');
    }
    await new Promise(resolve => server.close(resolve));
  }
}

async function runCreateRouteUsesInjectedRegistryTest() {
  const app = express();
  const workflowId = '202606121200000009';
  const registry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-create-route-injected',
    now: () => '2026-06-12T12:00:00.000Z',
  });
  const patchCalls = [];
  const runCalls = [];

  app.use(express.json());
  app.locals.creativeTaskRegistry = registry;
  app.locals.creativeWorkflows = {
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
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);

  try {
    const createResponse = await requestJson(server, 'POST', '/api/creative-workflows', {
      input: '使用 injected registry 启动后台任务',
    });
    assert.strictEqual(createResponse.statusCode, 202);
    assert.strictEqual(createResponse.body.success, true);
    assert.strictEqual(createResponse.body.task_id, 'creative-task-create-route-injected');
    assert.strictEqual(createResponse.body.active_task.task_id, 'creative-task-create-route-injected');
    assert.strictEqual(createResponse.body.active_task.workflow_id, workflowId);
    assert.strictEqual(registry.getTask('creative-task-create-route-injected').workflow_id, workflowId);
    assert.strictEqual(patchCalls[0].id, workflowId);
    await waitFor(() => assert.deepStrictEqual(runCalls, [{ id: workflowId, hasTaskContext: true }]));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function runActiveTaskRouteUsesInjectedRegistryTest() {
  const app = express();
  const workflowId = '202606121200000006';
  const registry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-active-route-injected',
    now: () => '2026-06-12T12:00:00.000Z',
  });
  registry.createDetachedTask({
    workflowId,
    operationId: 'workflow-op-active-route-injected',
    kind: 'creative_workflow',
  });

  app.use(express.json());
  app.locals.creativeTaskRegistry = registry;
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);

  try {
    const activeResponse = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/tasks/active`);
    assert.strictEqual(activeResponse.statusCode, 200);
    assert.strictEqual(activeResponse.body.success, true);
    assert.strictEqual(activeResponse.body.active_task.task_id, 'creative-task-active-route-injected');
    assert.strictEqual(activeResponse.body.active_task.workflow_id, workflowId);
    assert.strictEqual(activeResponse.body.active_task.status, 'running');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function runActiveTaskRouteWithCustomWorkflowServiceDoesNotUseDefaultRegistryTest() {
  const app = express();
  const workflowId = '202606121200000008';
  const defaultTaskId = defaultRegistry.createDetachedTask({
    workflowId,
    operationId: 'workflow-op-default-should-not-leak',
    kind: 'creative_workflow',
  });

  app.use(express.json());
  app.locals.creativeWorkflows = {
    getCreativeWorkflow: async id => ({
      success: true,
      data: { workflow_id: id },
    }),
  };
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);

  try {
    const activeResponse = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/tasks/active`);
    assert.strictEqual(activeResponse.statusCode, 200);
    assert.strictEqual(activeResponse.body.success, true);
    assert.strictEqual(activeResponse.body.workflow_id, workflowId);
    assert.strictEqual(activeResponse.body.active_task, null);
  } finally {
    defaultRegistry.markDeleted(defaultTaskId, '测试清理默认注册表任务。');
    await new Promise(resolve => server.close(resolve));
  }
}

async function runEventsRouteUsesInjectedRegistryTest() {
  const app = express();
  const workflowId = '202606121200000010';
  const registry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-events-route-injected',
    now: () => '2026-06-12T12:00:00.000Z',
  });
  const taskId = registry.createDetachedTask({
    workflowId,
    operationId: 'workflow-op-events-route-injected',
    kind: 'creative_workflow',
  });
  registry.emit(taskId, {
    type: 'stage_progress',
    stage: 'project',
    progress: 50,
    message: 'injected registry replay event',
  });
  registry.markDone(taskId, 'injected registry done');

  app.use(express.json());
  app.locals.creativeTaskRegistry = registry;
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);

  try {
    const sseResponse = await requestSse(server, `/api/creative-workflows/${workflowId}/events`, {
      task_id: taskId,
      since_seq: 0,
    });
    assert.strictEqual(sseResponse.statusCode, 200);
    assert.match(sseResponse.headers['content-type'], /text\/event-stream/);
    assert.match(sseResponse.body, /event: stage_progress/);
    assert.match(sseResponse.body, /injected registry replay event/);
    assert.match(sseResponse.body, /event: task_done/);
    assert.doesNotMatch(sseResponse.body, /未找到后台任务事件流/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function runEventsRouteWithCustomWorkflowServiceWithoutRegistryDoesNotLeakTypeErrorTest() {
  const app = express();
  const workflowId = '202606121200000011';

  app.use(express.json());
  app.locals.creativeWorkflows = {
    getCreativeWorkflow: async id => ({
      success: true,
      data: { workflow_id: id },
    }),
  };
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);

  try {
    const sseResponse = await requestSse(server, `/api/creative-workflows/${workflowId}/events`, {
      task_id: 'creative-task-no-registry',
      since_seq: 0,
    });
    assert.strictEqual(sseResponse.statusCode, 200);
    assert.match(sseResponse.headers['content-type'], /text\/event-stream/);
    assert.match(sseResponse.body, /event: task_stream_closed/);
    assert.match(sseResponse.body, /后台创作任务注册表未配置，无法读取任务事件流。/);
    assert.doesNotMatch(sseResponse.body, /TypeError|Cannot read properties/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function runCustomWorkflowServiceWithoutRegistryDoesNotUseDefaultRegistryTest() {
  const app = express();
  const workflowId = '202606121200000007';
  let capturedTaskRegistry = 'not-called';

  app.use(express.json());
  app.locals.creativeWorkflows = {
    getCreativeWorkflow: async (id, options = {}) => {
      capturedTaskRegistry = options.taskRegistry;
      return {
        success: true,
        data: { workflow_id: id },
      };
    },
  };
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);

  try {
    const response = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}`);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.workflow_id, workflowId);
    assert.ok(!capturedTaskRegistry, 'custom creativeWorkflows service should not receive default global task registry');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function runRetryRouteTests() {
  {
    const app = express();
    const rootDir = tempRoot();
    const projectDir = path.join(rootDir, 'project');
    const workflowId = '202606250800000001';
    const diagnostic = createDiagnostic({
      code: 'provider_missing_text',
      stage: 'ai-frame-html',
      sub_stage: 'frame_html',
      frame_id: 'scene_05',
      retryable: true,
      repair_action: 'retry_frame_html',
    });
    const project = createEmptyProject({ workflowId, runId: 'run-route-retry-plan' });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2), 'utf-8');
    const workflowRecord = {
      workflow_id: workflowId,
      status: 'failed',
      result: {
        hyperframes_freeform: {
          project: {
            html_video_project_path: projectDir,
            project_dir: projectDir,
            scene_spec: {
              title: '测试脚本',
              scenes: [{ id: 'scene_05', narration_text: '第五段旁白。' }],
            },
          },
        },
      },
      last_failure: {
        stage: 'project',
        sub_stage: 'frame_html',
        code: 'provider_missing_text',
        frame_id: 'scene_05',
        project_dir: projectDir,
        diagnostics: [diagnostic],
      },
    };
    const workflowPath = workflows.getWorkflowPath(workflowId, rootDir);
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
    fs.writeFileSync(workflowPath, JSON.stringify(workflowRecord, null, 2), 'utf-8');
    let retryTaskCalls = 0;

    app.use(express.json());
    app.locals.creativeWorkflows = {
      refreshCreativeWorkflowRetryPlan: id => workflows.refreshCreativeWorkflowRetryPlan(id, { rootDir }),
    };
    app.locals.creativeWorkflowTasks = {
      startCreativeWorkflowRetryTask: async () => {
        retryTaskCalls += 1;
        return { success: false };
      },
    };
    app.use('/api/creative-workflows', creativeWorkflowsRouter);

    const server = await listen(app);
    try {
      const response = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/retry-plan`);
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.workflow_id, workflowId);
      assert.strictEqual(response.body.plan.can_retry, true);
      assert.strictEqual(response.body.plan.code, 'provider_missing_text');
      assert.strictEqual(retryTaskCalls, 0);

      const persisted = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
      assert.strictEqual(persisted.retry.latest_plan.code, response.body.plan.code);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  {
    const app = express();
    const workflowId = '202606250800000002';
    app.use(express.json());
    app.locals.creativeWorkflows = {
      refreshCreativeWorkflowRetryPlan: async id => ({
        success: true,
        workflow_id: id,
        plan: { can_retry: false, code: 'workflow_not_failed' },
      }),
    };
    app.use('/api/creative-workflows', creativeWorkflowsRouter);

    const server = await listen(app);
    try {
      const response = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/retry-plan`);
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.message, '当前任务未失败，无需重试。');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  {
    const app = express();
    const workflowId = '202606250800000003';
    const plan = {
      can_retry: true,
      code: 'provider_missing_text',
      mode: 'repair_and_resume',
      plan_fingerprint: RETRY_PLAN_FINGERPRINT,
    };
    const startCalls = [];
    app.use(express.json());
    app.locals.creativeTaskRegistry = createCreativeTaskRegistry({
      idFactory: () => 'creative-task-retry-route',
    });
    app.locals.creativeWorkflows = {
      refreshCreativeWorkflowRetryPlan: async id => ({ success: true, workflow_id: id, plan }),
    };
    app.locals.creativeWorkflowTasks = {
      startCreativeWorkflowRetryTask: async (id, options = {}) => {
        startCalls.push({ id, options });
        return {
          success: true,
          workflow_id: id,
          task_id: 'creative-task-retry-route',
          retry_attempt_id: 'retry_route_001',
          active_task: { task_id: 'creative-task-retry-route', workflow_id: id, status: 'running' },
        };
      },
    };
    app.use('/api/creative-workflows', creativeWorkflowsRouter);

    const server = await listen(app);
    try {
      const response = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/retry`, {
        mode: 'repair_and_resume',
        confirm_plan_code: 'provider_missing_text',
        confirm_plan_fingerprint: RETRY_PLAN_FINGERPRINT,
      });
      assert.strictEqual(response.statusCode, 202);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.workflow_id, workflowId);
      assert.strictEqual(response.body.task_id, 'creative-task-retry-route');
      assert.strictEqual(response.body.retry_attempt_id, 'retry_route_001');
      assert.strictEqual(response.body.plan.code, 'provider_missing_text');
      assert.strictEqual(startCalls.length, 1);
      assert.deepStrictEqual(startCalls[0].options.payload, {
        mode: 'repair_and_resume',
        confirm_plan_code: 'provider_missing_text',
        confirm_plan_fingerprint: RETRY_PLAN_FINGERPRINT,
      });
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  {
    const app = express();
    const workflowId = '202606250800000008';
    const plan = {
      can_retry: true,
      code: 'provider_missing_text',
      mode: 'repair_and_resume',
      plan_fingerprint: RETRY_PLAN_FINGERPRINT,
    };
    let retryTaskCalls = 0;
    app.use(express.json());
    app.locals.creativeWorkflows = {
      refreshCreativeWorkflowRetryPlan: async id => ({ success: true, workflow_id: id, plan }),
    };
    app.locals.creativeWorkflowTasks = {
      startCreativeWorkflowRetryTask: async () => {
        retryTaskCalls += 1;
        return { success: true, workflow_id: workflowId, task_id: 'should-not-start' };
      },
    };
    app.use('/api/creative-workflows', creativeWorkflowsRouter);

    const server = await listen(app);
    try {
      for (const confirmPlanFingerprint of [undefined, 'b'.repeat(64)]) {
        const response = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/retry`, {
          mode: 'repair_and_resume',
          confirm_plan_code: plan.code,
          ...(confirmPlanFingerprint ? { confirm_plan_fingerprint: confirmPlanFingerprint } : {}),
        });
        assert.strictEqual(response.statusCode, 400);
        assert.strictEqual(response.body.code, 'RETRY_PLAN_CODE_CHANGED');
        assert.deepStrictEqual(response.body.plan, plan);
      }
      assert.strictEqual(retryTaskCalls, 0);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  {
    const app = express();
    const workflowId = '202606250800000004';
    app.use(express.json());
    app.locals.creativeWorkflows = {
      refreshCreativeWorkflowRetryPlan: async () => {
        throw new Error('非法 mode 不应刷新恢复计划');
      },
    };
    app.use('/api/creative-workflows', creativeWorkflowsRouter);

    const server = await listen(app);
    try {
      const response = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/retry`, {
        mode: 'rerun_only',
      });
      assert.strictEqual(response.statusCode, 400);
      assert.match(response.body.message, /V1 仅支持 repair_and_resume/);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  {
    const app = express();
    const workflowId = '202606250800000006';
    const startCalls = [];
    app.use(express.json());
    app.locals.creativeWorkflows = {
      refreshCreativeWorkflowRetryPlan: async id => ({
        success: true,
        workflow_id: id,
        plan: { can_retry: true, code: 'frame_layout_qa_unresolved', mode: 'repair_and_resume', plan_fingerprint: RETRY_PLAN_FINGERPRINT },
      }),
    };
    app.locals.creativeWorkflowTasks = {
      startCreativeWorkflowRetryTask: async (id, options = {}) => {
        startCalls.push({ id, options });
        return { success: true, workflow_id: id, task_id: 'creative-task-ignore-layout-qa' };
      },
    };
    app.use('/api/creative-workflows', creativeWorkflowsRouter);

    const server = await listen(app);
    try {
      const response = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/retry`, {
        mode: 'repair_and_resume',
        confirm_plan_code: 'frame_layout_qa_unresolved',
        confirm_plan_fingerprint: RETRY_PLAN_FINGERPRINT,
        ignore_layout_qa_once: true,
      });
      assert.strictEqual(response.statusCode, 202);
      assert.strictEqual(startCalls[0].options.payload.ignore_layout_qa_once, true);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  {
    const app = express();
    const workflowId = '202606250800000007';
    let retryTaskCalls = 0;
    app.use(express.json());
    app.locals.creativeWorkflows = {
      refreshCreativeWorkflowRetryPlan: async id => ({
        success: true,
        workflow_id: id,
        plan: { can_retry: true, code: 'provider_missing_text', mode: 'repair_and_resume', plan_fingerprint: RETRY_PLAN_FINGERPRINT },
      }),
    };
    app.locals.creativeWorkflowTasks = {
      startCreativeWorkflowRetryTask: async () => {
        retryTaskCalls += 1;
        return { success: true, workflow_id: workflowId, task_id: 'should-not-start' };
      },
    };
    app.use('/api/creative-workflows', creativeWorkflowsRouter);

    const server = await listen(app);
    try {
      const response = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/retry`, {
        mode: 'repair_and_resume',
        confirm_plan_code: 'provider_missing_text',
        confirm_plan_fingerprint: RETRY_PLAN_FINGERPRINT,
        ignore_layout_qa_once: true,
      });
      assert.strictEqual(response.statusCode, 400);
      assert.match(response.body.message, /只有布局自动修复后仍失败的任务/);
      assert.strictEqual(retryTaskCalls, 0);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  {
    const app = express();
    const workflowId = '202606250800000005';
    const activeTask = { task_id: 'creative-task-running', workflow_id: workflowId, status: 'running' };
    app.use(express.json());
    app.locals.creativeWorkflows = {
      refreshCreativeWorkflowRetryPlan: async id => ({
        success: true,
        workflow_id: id,
        plan: { can_retry: true, code: 'provider_missing_text', mode: 'repair_and_resume', plan_fingerprint: RETRY_PLAN_FINGERPRINT },
      }),
    };
    app.locals.creativeWorkflowTasks = {
      startCreativeWorkflowRetryTask: async id => ({
        success: false,
        workflow_id: id,
        message: '当前创作任务仍在运行，请等待结束后再重试。',
        active_task: activeTask,
      }),
    };
    app.use('/api/creative-workflows', creativeWorkflowsRouter);

    const server = await listen(app);
    try {
      const response = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/retry`, {
        mode: 'repair_and_resume',
        confirm_plan_code: 'provider_missing_text',
        confirm_plan_fingerprint: RETRY_PLAN_FINGERPRINT,
      });
      assert.strictEqual(response.statusCode, 409);
      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.message, '当前创作任务仍在运行，请等待结束后再重试。');
      assert.strictEqual(response.body.active_task.task_id, 'creative-task-running');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
}

async function run() {
  await runIsolatedRouterTests();
  await testCreativeWorkflowListEndpointUsesBackendRecords();
  await testCreativeWorkflowDetailUsesNormalizedDto();
  await runRealAppMountTest();
  await runCreateRouteReturnsBeforeBackgroundResearchSettlesTest();
  await runCreateRouteWithCustomWorkflowServiceWithoutRegistryFailsTest();
  await runCreateRouteUsesInjectedRegistryTest();
  await runActiveTaskRouteUsesInjectedRegistryTest();
  await runActiveTaskRouteWithCustomWorkflowServiceDoesNotUseDefaultRegistryTest();
  await runCustomWorkflowServiceWithoutRegistryDoesNotUseDefaultRegistryTest();
  await runGetWorkflowUsesActiveRegistryTest();
  await runEventsRouteWithCustomWorkflowServiceWithoutRegistryDoesNotLeakTypeErrorTest();
  await runEventsRouteUsesInjectedRegistryTest();
  await runSseHelperTimeoutsTest();
  await runSseWriteBackpressureKeepsSubscriptionTest();
  await runSseRequestCloseKeepsSubscriptionTest();
  await runSseRouteCleanupStaticTest();
  await runRetryRouteTests();
  await runAssetFileRouteTest();
  await runUploadAssetRoutesTest();
  await runUploadRequirementPersistenceFailureRouteTest();
  await runUploadThenCreateUsesSameRootTest();
  await runUploadRequestGuardTests();
}

async function runUploadRequestGuardTests() {
  const oversizedApp = express();
  let stageCalls = 0;
  oversizedApp.locals.creativeVisualAssetUploads = {
    stageVisualAsset: async () => {
      stageCalls += 1;
      throw new Error('Content-Length 超限时不应调用 stage');
    },
  };
  oversizedApp.use('/api/creative-workflows', creativeWorkflowsRouter);
  const oversizedServer = await listen(oversizedApp);
  try {
    const body = Buffer.concat([MINIMAL_PNG, Buffer.alloc(9 * 1024 * 1024)]);
    const result = await requestRaw(oversizedServer, 'POST', '/api/creative-workflows/assets/uploads', body, {
      'Content-Type': 'image/png',
      'Content-Length': String(body.length),
      'X-File-Name': 'content-length.png',
    });
    assert.equal(result.statusCode, 413);
    assert.match(result.body.message, /8MB/);
    assert.equal(stageCalls, 0);
  } finally {
    await new Promise(resolve => oversizedServer.close(resolve));
  }

  const chunkedApp = express();
  let socketTimeout = 0;
  chunkedApp.locals.creativeAssetUploadTimeoutMs = 1234;
  chunkedApp.locals.creativeVisualAssetUploads = {
    stageVisualAsset: async ({ stream }) => {
      socketTimeout = stream.socket.timeout;
      for await (const _chunk of stream) {}
      return { success: true, upload_id: 'upload_timeouttest', status: 'staged', asset: {} };
    },
  };
  chunkedApp.use('/api/creative-workflows', creativeWorkflowsRouter);
  const chunkedServer = await listen(chunkedApp);
  try {
    const result = await requestRaw(chunkedServer, 'POST', '/api/creative-workflows/assets/uploads', MINIMAL_PNG, {
      'Content-Type': 'image/png',
      'Transfer-Encoding': 'chunked',
      'X-File-Name': 'chunked.png',
    });
    assert.equal(result.statusCode, 201);
    assert.equal(socketTimeout, 1234);
  } finally {
    await new Promise(resolve => chunkedServer.close(resolve));
  }
}

async function runUploadAssetRoutesTest() {
  const app = express();
  const uploadRoot = tempRoot();
  app.use(express.json());
  app.locals.creativeVisualAssetUploads = visualAssetUploads;
  app.locals.creativeAssetUploadRoot = uploadRoot;
  app.use('/api/creative-workflows', creativeWorkflowsRouter);
  const server = await listen(app);

  try {
    const uploaded = await requestRaw(
      server,
      'POST',
      '/api/creative-workflows/assets/uploads',
      MINIMAL_PNG,
      {
        'Content-Type': 'image/png',
        'Content-Length': String(MINIMAL_PNG.length),
        'X-File-Name': encodeURIComponent('../路由封面.png'),
        'X-Asset-Requirement': 'required',
      },
    );
    assert.equal(uploaded.statusCode, 201);
    assert.equal(uploaded.body.success, true);
    assert.equal(uploaded.body.status, 'staged');
    assert.equal(uploaded.body.asset.requirement, 'required');
    assert.match(uploaded.body.message, /上传|暂存/);

    const updated = await requestJson(
      server,
      'PATCH',
      `/api/creative-workflows/assets/uploads/${uploaded.body.upload_id}`,
      { requirement: 'preferred' },
    );
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.body.success, true);
    assert.equal(updated.body.asset.requirement, 'preferred');
    assert.match(updated.body.message, /使用约束已更新/);

    for (const body of [{}, { requirement: null }, { requirement: '' }]) {
      const missingRequirement = await requestJson(
        server,
        'PATCH',
        `/api/creative-workflows/assets/uploads/${uploaded.body.upload_id}`,
        body,
      );
      assert.equal(missingRequirement.statusCode, 400);
      assert.equal(missingRequirement.body.success, false);
      assert.match(missingRequirement.body.message, /使用约束.*不能为空/);
      const manifest = JSON.parse(fs.readFileSync(path.join(uploadRoot, uploaded.body.upload_id, 'upload.json'), 'utf8'));
      assert.equal(manifest.requirement, 'preferred');
    }

    const invalidRequirement = await requestJson(
      server,
      'PATCH',
      `/api/creative-workflows/assets/uploads/${uploaded.body.upload_id}`,
      { requirement: 'optional' },
    );
    assert.equal(invalidRequirement.statusCode, 400);
    assert.match(invalidRequirement.body.message, /required|preferred/);

    const invalidId = await requestJson(
      server,
      'PATCH',
      '/api/creative-workflows/assets/uploads/bad-id',
      { requirement: 'required' },
    );
    assert.equal(invalidId.statusCode, 400);
    assert.match(invalidId.body.message, /上传素材 ID 无效/);

    const missing = await requestJson(
      server,
      'PATCH',
      '/api/creative-workflows/assets/uploads/upload_missing1234',
      { requirement: 'required' },
    );
    assert.equal(missing.statusCode, 404);
    assert.match(missing.body.message, /不存在|损坏/);

    const removed = await requestJson(
      server,
      'DELETE',
      `/api/creative-workflows/assets/uploads/${uploaded.body.upload_id}`,
    );
    assert.equal(removed.statusCode, 200);
    assert.equal(removed.body.success, true);

    const claimedUpload = await visualAssetUploads.stageVisualAsset({
      stream: require('stream').Readable.from(MINIMAL_PNG),
      fileName: '已认领.png',
      mime: 'image/png',
      rootDir: uploadRoot,
    });
    await visualAssetUploads.claimVisualAssets({
      uploadIds: [claimedUpload.upload_id],
      workflowId: '202607161200000006',
      targetDir: tempRoot(),
      rootDir: uploadRoot,
    });
    const claimedUpdate = await requestJson(
      server,
      'PATCH',
      `/api/creative-workflows/assets/uploads/${claimedUpload.upload_id}`,
      { requirement: 'required' },
    );
    assert.equal(claimedUpdate.statusCode, 409);
    assert.match(claimedUpdate.body.message, /已认领/);

    const invalid = await requestRaw(
      server,
      'POST',
      '/api/creative-workflows/assets/uploads',
      Buffer.from('plain'),
      { 'Content-Type': 'text/plain', 'X-File-Name': 'notes.txt' },
    );
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.body.message, /图片格式|PNG|JPEG|WebP/);

    const oversizedBody = Buffer.concat([MINIMAL_PNG, Buffer.alloc(9 * 1024 * 1024)]);
    const oversized = await requestRaw(
      server,
      'POST',
      '/api/creative-workflows/assets/uploads',
      oversizedBody,
      {
        'Content-Type': 'image/png',
        'Content-Length': String(oversizedBody.length),
        'X-File-Name': 'oversized.png',
      },
    );
    assert.equal(oversized.statusCode, 413);
    assert.equal(oversized.body.success, false);
    assert.match(oversized.body.message, /8MB/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function runUploadRequirementPersistenceFailureRouteTest() {
  const app = express();
  app.use(express.json());
  app.locals.creativeVisualAssetUploads = {
    updateStagedVisualAssetRequirement: async () => {
      throw new Error('磁盘写入失败');
    },
  };
  app.use('/api/creative-workflows', creativeWorkflowsRouter);
  const server = await listen(app);

  try {
    const response = await requestJson(
      server,
      'PATCH',
      '/api/creative-workflows/assets/uploads/upload_writefail1',
      { requirement: 'required' },
    );
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.success, false);
    assert.match(response.body.message, /更新暂存图片使用约束失败/);
    assert.match(response.body.message, /请重试/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function runUploadThenCreateUsesSameRootTest() {
  const app = express();
  const rootDir = tempRoot();
  const mediaRoot = path.join(rootDir, 'media');
  const uploadRoot = path.join(rootDir, 'uploads');
  const services = {
    ...routeWorkflowServices(),
    appSettings: {
      getCreativeDefaults: async () => ({
        aspectRatio: '9:16',
        targetDurationSec: 60,
        useResearch: false,
        generateAudio: true,
        generateCaptions: true,
      }),
      getEffectiveSystemSettings: async () => ({ skipValidation: false }),
    },
  };
  let receivedCreateOptions = null;

  app.use(express.json());
  app.locals.creativeAssetUploadRoot = uploadRoot;
  app.locals.creativeWorkflows = {
    createCreativeWorkflow: (payload, options = {}) => {
      receivedCreateOptions = options;
      return workflows.createCreativeWorkflow(payload, { ...options, rootDir, mediaRoot, services });
    },
  };
  app.locals.creativeWorkflowTasks = {
    startCreativeWorkflowTask: async workflowId => ({
      success: true,
      workflow_id: workflowId,
      task_id: 'creative-task-upload-create',
      active_task: { task_id: 'creative-task-upload-create', workflow_id: workflowId, status: 'running' },
    }),
  };
  app.use('/api/creative-workflows', creativeWorkflowsRouter);
  const server = await listen(app);

  try {
    const uploaded = await requestRaw(server, 'POST', '/api/creative-workflows/assets/uploads', MINIMAL_PNG, {
      'Content-Type': 'image/png',
      'Content-Length': String(MINIMAL_PNG.length),
      'X-File-Name': 'route-create.png',
    });
    assert.equal(uploaded.statusCode, 201);

    const created = await requestJson(server, 'POST', '/api/creative-workflows', {
      input: '路由上传后立即创建任务',
      assetIds: [uploaded.body.upload_id],
    });
    assert.equal(created.statusCode, 202);
    assert.equal(created.body.asset_context.assets[0].id, uploaded.body.upload_id);
    assert.equal(receivedCreateOptions.uploadRoot, uploadRoot);
    assert.equal(fs.existsSync(path.join(uploadRoot, uploaded.body.upload_id)), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
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
    assert.strictEqual(response.body.status, 'running');
    assert.strictEqual(response.body.workflow.task_status, 'running');
    assert.strictEqual(response.body.workflow.active_task_id, 'creative-task-route-active');
    assert.strictEqual(response.body.active_task.task_id, 'creative-task-route-active');
    assert.strictEqual(response.body.workflow.stages.find(stage => stage.id === 'project').status, 'running');

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

async function runSseHelperTimeoutsTest() {
  const app = express();
  app.use(express.json());
  app.post('/hang-events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('event: stage_progress\ndata: {"message":"连接保持中"}\n\n');
  });
  const server = await listen(app);

  try {
    const requestResult = await Promise.race([
      requestSse(server, '/hang-events', {}, { timeoutMs: 30 }).then(
        () => 'resolved',
        error => error,
      ),
      delay(120).then(() => 'no-timeout'),
    ]);
    assert.notStrictEqual(requestResult, 'no-timeout');
    assert.ok(requestResult instanceof Error);
    assert.match(requestResult.message, /\/hang-events/);
    assert.match(requestResult.message, /连接保持中/);

    const sse = await startSse(server, '/hang-events', {}, { timeoutMs: 30 }).response;
    const endedResult = await Promise.race([
      sse.ended.then(
        () => 'resolved',
        error => error,
      ),
      delay(120).then(() => 'no-timeout'),
    ]);
    assert.notStrictEqual(endedResult, 'no-timeout');
    assert.ok(endedResult instanceof Error);
    assert.match(endedResult.message, /\/hang-events/);
    assert.match(endedResult.message, /连接保持中/);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

async function runSseRequestCloseKeepsSubscriptionTest() {
  const app = express();
  const workflowId = '202606141200000001';
  let unsubscribeCount = 0;
  let capturedWriteEvent = null;
  let capturedOnClose = null;

  app.use(express.json());
  app.use((req, res, next) => {
    const shouldEmitRequestClose = req.originalUrl === `/api/creative-workflows/${workflowId}/events`;
    next();
    if (shouldEmitRequestClose) {
      setImmediate(() => {
        assert.strictEqual(req.complete, true);
        req.emit('close');
      });
    }
  });
  app.locals.creativeWorkflowTasks = {
    subscribeCreativeWorkflowEvents: async ({ writeEvent, onClose }) => {
      capturedWriteEvent = writeEvent;
      capturedOnClose = onClose;
      writeEvent({
        seq: 1,
        type: 'stage_progress',
        workflow_id: workflowId,
        task_id: 'creative-task-sse-close',
        message: '连接已建立。',
      });
      return {
        success: true,
        unsubscribe: () => {
          unsubscribeCount += 1;
        },
      };
    },
  };
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);
  let sse = null;

  try {
    sse = await openSse(server, `/api/creative-workflows/${workflowId}/events`, {
      task_id: 'creative-task-sse-close',
      since_seq: 0,
    });
    await waitFor(() => assert.strictEqual(unsubscribeCount, 0));
    await delay(20);
    assert.strictEqual(unsubscribeCount, 0);

    const wrote = capturedWriteEvent({
      seq: 2,
      type: 'stage_progress',
      workflow_id: workflowId,
      task_id: 'creative-task-sse-close',
      message: '后续事件仍可写入。',
    });
    assert.strictEqual(wrote, true);
    await waitFor(() => assert.match(sse.body, /后续事件仍可写入/));

    capturedOnClose();
    const ended = await sse.ended;
    assert.strictEqual(ended.statusCode, 200);
    assert.strictEqual(unsubscribeCount, 1);
  } finally {
    if (sse) sse.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

async function runSseWriteBackpressureKeepsSubscriptionTest() {
  const app = express();
  const workflowId = '202606141200000002';
  let unsubscribeCount = 0;
  let capturedWriteEvent = null;
  let capturedOnClose = null;

  app.use(express.json());
  app.use((req, res, next) => {
    const originalWrite = res.write.bind(res);
    res.write = (chunk, encoding, callback) => {
      originalWrite(chunk, encoding, callback);
      return false;
    };
    next();
  });
  app.locals.creativeWorkflowTasks = {
    subscribeCreativeWorkflowEvents: async ({ writeEvent, onClose }) => {
      capturedWriteEvent = writeEvent;
      capturedOnClose = onClose;
      return {
        success: true,
        unsubscribe: () => {
          unsubscribeCount += 1;
        },
      };
    },
  };
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);
  let sseClient = null;
  let sse = null;

  try {
    sseClient = startSse(server, `/api/creative-workflows/${workflowId}/events`, {
      task_id: 'creative-task-sse-backpressure',
      since_seq: 0,
    });
    const ssePromise = sseClient.response;
    await waitFor(() => assert.ok(capturedWriteEvent));

    const wrote = capturedWriteEvent({
      seq: 1,
      type: 'stage_progress',
      workflow_id: workflowId,
      task_id: 'creative-task-sse-backpressure',
      message: '写入遇到背压但连接保持。',
    });
    assert.strictEqual(wrote, true);

    sse = await ssePromise;
    await waitFor(() => assert.match(sse.body, /写入遇到背压但连接保持/));
    await delay(20);
    assert.strictEqual(unsubscribeCount, 0);

    capturedOnClose();
    const ended = await sse.ended;
    assert.strictEqual(ended.statusCode, 200);
    assert.strictEqual(unsubscribeCount, 1);
  } finally {
    if (sse) sse.destroy();
    if (sseClient) sseClient.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

async function runAssetFileRouteTest() {
  const app = express();
  const rootDir = tempRoot();
  const mediaRoot = path.join(rootDir, 'media');
  const workflowId = '202606121200000081';
  const assetDir = path.join(mediaRoot, workflowId, 'assets');
  const assetPath = path.join(assetDir, 'source-image-01.png');
  const projectDir = path.join(mediaRoot, workflowId, 'agent_runs', 'run-1-html-video');
  const generatedPath = path.join(projectDir, 'assets', 'generated-image-01.jpg');
  const outsidePath = path.join(rootDir, 'outside.png');
  fs.mkdirSync(assetDir, { recursive: true });
  fs.mkdirSync(path.dirname(generatedPath), { recursive: true });
  fs.writeFileSync(assetPath, Buffer.from('local asset bytes'));
  fs.writeFileSync(generatedPath, Buffer.from('generated asset bytes'));
  fs.writeFileSync(outsidePath, Buffer.from('outside bytes'));
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    workflow_id: workflowId,
    assets: [
      { id: 'gen_scene_01', source: 'generated', path: 'assets/generated-image-01.jpg' },
    ],
  }, null, 2), 'utf-8');
  fs.writeFileSync(workflows.getWorkflowPath(workflowId, rootDir), JSON.stringify({
    workflow_id: workflowId,
    asset_context: {
      assets: [
        { id: 'article_01', type: 'image', local_path: assetPath, path: 'assets/source-image-01.png' },
        { id: 'bad_01', type: 'image', local_path: outsidePath },
      ],
    },
    result: {
      hyperframes_freeform: {
        project: {
          render_mode: 'html-video',
          html_video_project_path: projectDir,
          project_dir: projectDir,
        },
      },
    },
  }, null, 2), 'utf-8');

  app.use(express.json());
  app.locals.creativeWorkflows = {
    getCreativeWorkflowAssetFile: (id, assetId) => workflows.getCreativeWorkflowAssetFile(id, assetId, { rootDir, mediaRoot }),
  };
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);
  try {
    const ok = await requestBuffer(server, 'GET', `/api/creative-workflows/${workflowId}/assets/article_01/file`);
    assert.strictEqual(ok.statusCode, 200);
    assert.strictEqual(ok.body.toString(), 'local asset bytes');

    const generated = await requestBuffer(server, 'GET', `/api/creative-workflows/${workflowId}/assets/gen_scene_01/file`);
    assert.strictEqual(generated.statusCode, 200);
    assert.strictEqual(generated.body.toString(), 'generated asset bytes');

    const blocked = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/assets/bad_01/file`);
    assert.strictEqual(blocked.statusCode, 404);
    assert.strictEqual(blocked.body.success, false);
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
