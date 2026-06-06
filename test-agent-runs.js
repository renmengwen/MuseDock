const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRuns = require('./server/services/agentRuns');
const mediaPipeline = require('./server/services/mediaPipeline');

async function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-test-'));
  const awemeId = '1234567890';
  const paths = mediaPipeline.getMediaPaths(awemeId, rootDir);

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
  assert.strictEqual(listed.data.length, 2);
  assert.strictEqual(listed.data[0].run_id, generated.run_id);

  const detail = await agentRuns.getDouyinAgentRun(awemeId, generated.run_id, { rootDir });
  assert.strictEqual(detail.success, true);
  assert.strictEqual(detail.data.result.rewrite_script, '改写脚本');

  const missingDetail = await agentRuns.getDouyinAgentRun(awemeId, 'missing-run', { rootDir });
  assert.strictEqual(missingDetail.success, false);
  assert.match(missingDetail.message, /未找到该 Agent 运行记录/);

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
}

run().then(() => {
  console.log('agent run tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
