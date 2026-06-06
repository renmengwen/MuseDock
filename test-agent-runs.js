const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const agentRuns = require('./server/services/agentRuns');
const agentsRouter = require('./server/routes/agents');
const mediaPipeline = require('./server/services/mediaPipeline');

async function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
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

async function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-test-'));
  const awemeId = '1234567890';
  const paths = mediaPipeline.getMediaPaths(awemeId, rootDir);
  const illegalAwemeId = '..\\agent-runs-escape';
  const escapedDir = path.resolve(rootDir, '..', 'agent-runs-escape');
  const escapedRunsDir = path.join(escapedDir, 'agent_runs');
  const escapedRunPath = path.join(escapedRunsDir, '20260607-000000-000Z-abcdef-viral_rewrite.json');

  await writeJson(path.join(escapedDir, 'metadata.json'), {
    aweme_id: 'escape',
    title: '不应读取的素材',
  });
  await writeJson(path.join(escapedDir, 'analysis_input.json'), {
    aweme_id: 'escape',
    video: { title: '不应读取的素材', author: {}, statistics: {} },
    steps: {},
  });
  await writeJson(path.join(escapedDir, 'transcript.json'), {
    success: true,
    status: 'done',
    text: '不应进入模型调用的转写文本',
  });
  await writeJson(escapedRunPath, {
    success: true,
    run_id: '20260607-000000-000Z-abcdef-viral_rewrite',
    template: 'viral_rewrite',
    result: { summary: '不应读回' },
  });
  const escapedRunCountBefore = fs.readdirSync(escapedRunsDir).length;

  let illegalCreateModelCalled = false;
  const illegalCreate = await agentRuns.createDouyinAgentRun(illegalAwemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async () => {
        illegalCreateModelCalled = true;
        return { success: true, text: '{}' };
      },
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(illegalCreate.success, false);
  assert.strictEqual(illegalCreate.status, 'failed');
  assert.match(illegalCreate.message, /非法|无效/);
  assert.strictEqual(illegalCreateModelCalled, false);
  assert.strictEqual(fs.readdirSync(escapedRunsDir).length, escapedRunCountBefore);

  const illegalList = await agentRuns.listDouyinAgentRuns(illegalAwemeId, { rootDir });
  assert.strictEqual(illegalList.success, false);
  assert.match(illegalList.message, /非法|无效/);

  const illegalGet = await agentRuns.getDouyinAgentRun(illegalAwemeId, '20260607-000000-000Z-abcdef-viral_rewrite', { rootDir });
  assert.strictEqual(illegalGet.success, false);
  assert.match(illegalGet.message, /非法|无效/);

  const missing = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: { callTextModel: async () => ({ success: true, text: '{}' }) },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(missing.success, false);
  assert.strictEqual(missing.status, 'failed');
  assert.match(missing.message, /未找到该视频素材/);
  assert.strictEqual(fs.existsSync(path.join(paths.dir, 'agent_runs')), false);

  await writeJson(paths.metadata, {
    aweme_id: awemeId,
    title: '测试视频',
    author: { nickname: 'Tester' },
    statistics: { digg_count: 10, comment_count: 2 },
    aweme_url: `https://www.douyin.com/video/${awemeId}`,
  });
  fs.mkdirSync(paths.framesDir, { recursive: true });
  fs.writeFileSync(path.join(paths.framesDir, 'frame-0001.jpg'), 'fake');
  await writeJson(paths.analysisInput, {
    aweme_id: awemeId,
    video: {
      title: '测试视频',
      author: { nickname: 'Tester' },
      statistics: { digg_count: 10, comment_count: 2 },
      aweme_url: `https://www.douyin.com/video/${awemeId}`,
    },
    local_assets: { frames: [path.join(paths.framesDir, 'frame-0001.jpg')] },
    transcript: { status: 'done', path: paths.transcript },
    steps: {},
  });

  const noTranscript = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: { callTextModel: async () => ({ success: true, text: '{}' }) },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(noTranscript.success, false);
  assert.strictEqual(noTranscript.status, 'failed');
  assert.match(noTranscript.message, /未找到转写文本/);
  assert.ok(fs.existsSync(noTranscript.path));

  await writeJson(paths.transcript, {
    success: true,
    status: 'done',
    text: '这是一个关于本地创作工作流的视频。',
  });

  const generated = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        assert.match(messages[0].content, /只输出 JSON/);
        assert.match(messages[0].content, /summary, viral_points, audience, comment_insights, topics, rewrite_script, titles/);
        assert.match(messages[1].content, /测试视频/);
        assert.match(messages[1].content, /本地创作工作流/);
        assert.match(messages[1].content, /这个工具提升效率/);
        return {
          success: true,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          text: JSON.stringify({
            summary: '摘要',
            viral_points: ['开头明确'],
            audience: '创作者',
            comment_insights: ['评论关注效率'],
            topics: ['本地素材管理'],
            rewrite_script: '改写脚本',
            titles: ['标题一'],
          }),
        };
      },
    },
    getLocalComments: () => ({
      success: true,
      count: 1,
      data: [
        { content: '这个工具提升效率', like_count: 9, replies: [{ content: '同意', like_count: 1 }] },
      ],
    }),
  });

  assert.strictEqual(generated.success, true);
  assert.strictEqual(generated.status, 'done');
  assert.strictEqual(generated.result.summary, '摘要');
  assert.strictEqual(generated.result.rewrite_script, '改写脚本');
  assert.strictEqual(generated.input_summary.comment_count, 1);
  assert.strictEqual(generated.input_summary.has_transcript, true);
  assert.ok(generated.run_id.endsWith('-viral_rewrite'));
  assert.ok(fs.existsSync(generated.path));

  const listed = await agentRuns.listDouyinAgentRuns(awemeId, { rootDir });
  assert.strictEqual(listed.success, true);
  assert.strictEqual(listed.count, 2);
  assert.strictEqual(listed.data.length, 2);
  assert.strictEqual(listed.data[0].run_id, generated.run_id);

  const detail = await agentRuns.getDouyinAgentRun(awemeId, generated.run_id, { rootDir });
  assert.strictEqual(detail.success, true);
  assert.strictEqual(detail.aweme_id, awemeId);
  assert.strictEqual(detail.run_id, generated.run_id);
  assert.strictEqual(detail.data.result.rewrite_script, '改写脚本');

  const missingDetail = await agentRuns.getDouyinAgentRun(awemeId, 'missing-run', { rootDir });
  assert.strictEqual(missingDetail.success, false);
  assert.strictEqual(missingDetail.aweme_id, awemeId);
  assert.strictEqual(missingDetail.run_id, 'missing-run');
  assert.match(missingDetail.message, /未找到该 Agent 运行记录/);

  const traversalDetail = await agentRuns.getDouyinAgentRun(awemeId, '../metadata', { rootDir });
  assert.strictEqual(traversalDetail.success, false);
  assert.match(traversalDetail.message, /非法|未找到/);

  let failedModelCalled = false;
  const failedModel = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async () => {
        failedModelCalled = true;
        return {
          success: false,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          message: '模型超时',
          raw_response: { error: { message: 'timeout detail' } },
        };
      },
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(failedModelCalled, true);
  assert.strictEqual(failedModel.success, false);
  assert.strictEqual(failedModel.status, 'failed');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(failedModel, 'raw_response'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(failedModel.path, 'utf-8')), 'raw_response'), false);

  const longText = `${'长转写'.repeat(3000)}TAIL_SHOULD_NOT_APPEAR`;
  await writeJson(paths.transcript, {
    success: true,
    status: 'done',
    text: longText,
  });

  const longRun = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        assert.match(messages[1].content, /8000/);
        assert.doesNotMatch(messages[1].content, /TAIL_SHOULD_NOT_APPEAR/);
        return {
          success: true,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          text: JSON.stringify({ summary: '长转写摘要' }),
        };
      },
    },
    getLocalComments: () => ({
      success: true,
      count: 80,
      data: Array.from({ length: 80 }, (_, index) => ({
        content: `评论${index}`,
        like_count: index,
        replies: Array.from({ length: 6 }, (__, replyIndex) => ({ content: `回复${index}-${replyIndex}` })),
      })),
    }),
  });
  assert.strictEqual(longRun.success, true);
  assert.strictEqual(longRun.input_summary.transcript_truncated, true);
  assert.ok(longRun.run_id.endsWith('-viral_rewrite'));
  assert.match(longRun.run_id, /-\d{3}Z-[a-f0-9]{6}-viral_rewrite$/);

  const sameTimeRuns = await Promise.all(Array.from({ length: 5 }, () => agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        model: { provider: 'OpenAI', model_id: 'gpt-test' },
        text: JSON.stringify({ summary: '并发摘要' }),
      }),
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  })));
  assert.strictEqual(new Set(sameTimeRuns.map(item => item.run_id)).size, sameTimeRuns.length);
  assert.strictEqual(new Set(sameTimeRuns.map(item => item.path)).size, sameTimeRuns.length);

  await writeJson(paths.transcript, {
    success: true,
    status: 'done',
    text: '这是一个关于本地创作工作流的视频。',
  });

  const raw = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        model: { provider: 'OpenAI', model_id: 'gpt-test' },
        text: '普通文本结果',
      }),
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(raw.success, true);
  assert.strictEqual(raw.status, 'done');
  assert.strictEqual(raw.raw_text, '普通文本结果');
  assert.strictEqual(raw.result.summary, '');
  assert.match(raw.message, /未能解析为结构化结果/);
  assert.strictEqual(raw.steps.find(step => step.id === 'comments').message, '暂无本地评论缓存');

  const originalCreateDouyinAgentRun = agentRuns.createDouyinAgentRun;
  agentRuns.createDouyinAgentRun = async () => ({
    success: false,
    status: 'failed',
    aweme_id: awemeId,
    run_id: 'failed-run',
    steps: [{ id: 'generate', status: 'failed' }],
    message: '模型调用失败',
  });
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentsRouter);
  const server = await listen(app);
  try {
    const response = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs`, {
      template: 'viral_rewrite',
    });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.status, 'failed');
    assert.deepStrictEqual(response.body.steps, [{ id: 'generate', status: 'failed' }]);
  } finally {
    agentRuns.createDouyinAgentRun = originalCreateDouyinAgentRun;
    await new Promise(resolve => server.close(resolve));
  }
}

run().then(() => {
  console.log('agent run tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
