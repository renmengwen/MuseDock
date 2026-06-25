const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRuns = require('../server/services/agentRuns');
const narrationBudget = require('../server/services/storyboardNarrationBudget');

(async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-budget-'));
  const awemeId = '20260625112010037731';
  const runId = '20260625-freeform-budget';
  const runDir = path.join(rootDir, awemeId, 'agent_runs');
  fs.mkdirSync(runDir, { recursive: true });

  const scenes = Array.from({ length: 7 }, (_, index) => ({
    index: index + 1,
    headline: `第 ${index + 1} 幕`,
    narration_text: `第${index + 1}幕。${'这是一段明显超过六十秒总预算的口播内容'.repeat(12)}。`,
  }));
  const originalChars = scenes.reduce((sum, scene) => sum + narrationBudget.countNarrationChars(scene.narration_text), 0);

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
          title: '预算测试',
          storyboard: { scenes },
        },
      },
    },
  }, null, 2));

  let capturedScenes = null;
  const result = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(awemeId, runId, {
    rootDir,
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes }) => {
        capturedScenes = scenes;
        return {
          success: true,
          message: 'ok',
          scene_tts: {
            status: 'done',
            duration: scenes.length,
            scenes: scenes.map(scene => ({
              index: scene.index,
              duration: 1,
              speech_duration_sec: 1,
              narration_text: scene.narration_text,
              captions: [{ start: 0, end: 1, text: scene.narration_text }],
            })),
          },
        };
      },
    },
  });

  assert.equal(result.success, true);
  assert.ok(capturedScenes);
  const fittedChars = capturedScenes.reduce((sum, scene) => sum + narrationBudget.countNarrationChars(scene.narration_text), 0);
  assert.ok(fittedChars < originalChars);
  assert.ok(fittedChars <= 270);

  const persisted = JSON.parse(fs.readFileSync(path.join(runDir, `${runId}.json`), 'utf8'));
  const persistedScenes = persisted.hyperframes_freeform.brief.data.storyboard.scenes;
  assert.deepEqual(
    persistedScenes.map(scene => scene.narration_text),
    capturedScenes.map(scene => scene.narration_text),
  );
  assert.equal(persisted.hyperframes_freeform.brief.data.narration_budget.status, 'ok');

  console.log('agent runs freeform audio budget tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
