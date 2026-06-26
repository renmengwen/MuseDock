const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRuns = require('../server/services/agentRuns');

(async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-incomplete-'));
  const awemeId = '20260626024518995316';
  const runId = 'run-incomplete-narration';
  const runDir = path.join(rootDir, awemeId, 'agent_runs');
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(path.join(runDir, `${runId}.json`), JSON.stringify({
    success: true,
    run_id: runId,
    template: 'hyperframes_freeform',
    aweme_id: awemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 60 } },
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: '旁白完整性测试',
          storyboard: {
            scenes: [
              { index: 1, narration_text: '写Card、Popover或Modal时，你可能遇到过这种情况：明明有' },
              { index: 2, narration_text: '问题不在 border 本身，而在语义不匹配。' },
            ],
          },
        },
      },
    },
  }, null, 2));

  let ttsCalled = false;
  const result = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(awemeId, runId, {
    rootDir,
    sceneTtsService: {
      synthesizeSceneTts: async () => {
        ttsCalled = true;
        return { success: true };
      },
    },
  });

  assert.equal(result.success, false);
  assert.equal(ttsCalled, false);
  assert.match(result.message, /旁白不完整|半句/);

  const persisted = JSON.parse(fs.readFileSync(path.join(runDir, `${runId}.json`), 'utf8'));
  assert.equal(persisted.hyperframes_freeform.audio.status, 'failed');
  assert.match(persisted.hyperframes_freeform.audio.message, /旁白不完整|半句/);

  const conditionalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-conditional-fragment-'));
  const conditionalAwemeId = '20260626061707994797';
  const conditionalRunId = 'run-conditional-fragment';
  const conditionalRunDir = path.join(conditionalRoot, conditionalAwemeId, 'agent_runs');
  fs.mkdirSync(conditionalRunDir, { recursive: true });
  fs.writeFileSync(path.join(conditionalRunDir, `${conditionalRunId}.json`), JSON.stringify({
    success: true,
    run_id: conditionalRunId,
    template: 'hyperframes_freeform',
    aweme_id: conditionalAwemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 60 } },
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: '条件句残片测试',
          storyboard: {
            scenes: [
              { index: 1, narration_text: '如果你正在启动新项目。' },
              { index: 2, narration_text: 'npm 完全够用，关键是团队统一。' },
            ],
          },
        },
      },
    },
  }, null, 2));

  let conditionalTtsCalled = false;
  const conditionalResult = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(conditionalAwemeId, conditionalRunId, {
    rootDir: conditionalRoot,
    sceneTtsService: {
      synthesizeSceneTts: async () => {
        conditionalTtsCalled = true;
        return { success: true };
      },
    },
  });

  assert.equal(conditionalResult.success, false);
  assert.equal(conditionalTtsCalled, false);
  assert.match(conditionalResult.message, /旁白不完整|半句/);

  console.log('agent runs incomplete narration tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
