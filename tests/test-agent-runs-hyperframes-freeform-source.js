const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRuns = require('../server/services/agent/agentRuns');
const mediaPipeline = require('../server/services/mediaPipeline');

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-freeform-source-'));
  const awemeId = '7345678901234567890';
  const paths = mediaPipeline.getMediaPaths(awemeId, rootDir);
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.metadata, JSON.stringify({ aweme_id: awemeId, title: '素材标题' }, null, 2), 'utf8');
  fs.writeFileSync(paths.transcript, JSON.stringify({
    success: true,
    status: 'done',
    text: '原视频 ASR 转写内容。',
  }, null, 2), 'utf8');
  fs.writeFileSync(paths.analysisInput, JSON.stringify({
    aweme_id: awemeId,
    video: {
      title: '素材标题',
      author: { nickname: '作者' },
      statistics: { comment_count: 10 },
      aweme_url: `https://www.douyin.com/video/${awemeId}`,
    },
    local_assets: { dir: paths.dir, metadata: paths.metadata, video: '', audio: '', frames: [] },
    transcript: { status: 'done', path: paths.transcript },
    comments_summary: { status: 'done', count: 1 },
    steps: {},
  }, null, 2), 'utf8');

  const result = await agentRuns.createDouyinHyperframesFreeformRun(awemeId, {
    rootDir,
    getLocalComments: async () => ({
      success: true,
      count: 1,
      data: [{ comment_id: 'c1', content: '评论里有真实用户痛点', like_count: 8, replies: [] }],
    }),
  });

  assert.equal(result.success, true);
  assert.equal(result.run.input_summary.comment_count, 1);
  assert.match(result.run.result.comments_text, /真实用户痛点/);
  assert.equal(result.run.steps.find(step => step.id === 'comments').status, 'done');
  console.log('agent runs hyperframes freeform source tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
