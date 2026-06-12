const assert = require('assert');
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

async function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function waitImmediate() {
  await new Promise(resolve => setImmediate(resolve));
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
  };
}

async function assertMountedPost(server, workflowId) {
  const createResponse = await requestJson(server, 'POST', '/api/creative-workflows', {
    input: '做一个新视频',
  });
  assert.strictEqual(createResponse.statusCode, 200);
  assert.strictEqual(createResponse.body.success, true);
  assert.strictEqual(createResponse.body.status, 'queued');
  assert.strictEqual(createResponse.body.workflow_id, workflowId);
  assert.strictEqual(createResponse.body.creative_context.asset_context.status, 'disabled');
  assert.match(createResponse.body.message, /创作任务已创建/);
}

async function runIsolatedRouterTests() {
  const app = express();
  const fake = createFakeCreativeWorkflows();

  app.use(express.json());
  app.locals.creativeWorkflows = fake.service;
  app.use('/api/creative-workflows', creativeWorkflowsRouter);

  const server = await listen(app);

  try {
    await assertMountedPost(server, fake.workflowId);

    await waitImmediate();
    assert.deepStrictEqual(fake.runWorkflowIds, [fake.workflowId]);

    const getResponse = await requestJson(server, 'GET', `/api/creative-workflows/${fake.workflowId}`);
    assert.strictEqual(getResponse.statusCode, 200);
    assert.strictEqual(getResponse.body.success, true);
    assert.strictEqual(getResponse.body.data.workflow_id, fake.workflowId);

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

  const server = await listen(realApp);

  try {
    await assertMountedPost(server, fake.workflowId);

    await waitImmediate();
    assert.deepStrictEqual(fake.runWorkflowIds, [fake.workflowId]);
  } finally {
    delete realApp.locals.creativeWorkflows;
    await new Promise(resolve => server.close(resolve));
  }
}

async function run() {
  await runIsolatedRouterTests();
  await runRealAppMountTest();
}

run().then(() => {
  console.log('creative workflow route tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
