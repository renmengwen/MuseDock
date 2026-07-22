const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRuns = require('../server/services/agent/agentRuns');
const helpers = require('../server/services/agent/agentRunsFreeformHelpers');
const freeformAgent = require('../server/services/hyperframes/hyperframesFreeformAgent');
const workflowFacade = require('../server/services/creative-video/workflowFacade');

const rawText = 'S01 使用首页。旁白必须包含“必须保留的首页原句。”；S02 使用截图。旁白必须完整包含“必须保留的截图原句。”。';
const required = freeformAgent.extractRequiredNarrationLiterals(rawText);

function brief(first, second) {
  return {
    title: '原句合同测试',
    storyboard: {
      scenes: [
        { id: 'S01', index: 1, narration_text: first },
        { id: 'S02', index: 2, narration_text: second },
      ],
    },
  };
}

function writeRun(rootDir, awemeId, runId) {
  const runDir = path.join(rootDir, awemeId, 'agent_runs');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, `${runId}.json`), JSON.stringify({
    success: true,
    run_id: runId,
    aweme_id: awemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 60 } },
    hyperframes_freeform: { status: 'idle' },
  }, null, 2));
  return path.join(runDir, `${runId}.json`);
}

async function generateBrief({ alwaysWrong = false } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'required-literal-'));
  const awemeId = alwaysWrong ? '20260722000000000002' : '20260722000000000001';
  const runId = alwaysWrong ? 'required-literal-fail' : 'required-literal-retry';
  const runPath = writeRun(rootDir, awemeId, runId);
  let calls = 0;
  let retryPrompt = '';
  const result = await agentRuns.generateDouyinRunHyperframesFreeformBrief(awemeId, runId, {
    rootDir,
    briefOptions: { creative_context: { input: { raw_text: rawText } } },
    skillContext: { loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'test' }) },
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        calls += 1;
        if (calls === 2) retryPrompt = messages.map(item => item.content).join('\n');
        return {
          success: true,
          text: JSON.stringify(alwaysWrong || calls === 1
            ? brief('被同义改写的首页旁白。', '被同义改写的截图旁白。')
            : brief(`开场。${required[0].literal}`, `${required[1].literal}收尾。`)),
        };
      },
    },
  });
  return { result, calls, retryPrompt, runPath, rootDir, awemeId, runId };
}

(async () => {
  const retried = await generateBrief();
  assert.equal(retried.result.success, true);
  assert.equal(retried.calls, 2);
  assert.match(retried.retryPrompt, /上一次结果未通过原句校验/);
  const persisted = JSON.parse(fs.readFileSync(retried.runPath, 'utf8'));
  assert.deepEqual(persisted.hyperframes_freeform.brief.data.required_narration_literals, required);

  let capturedSceneSpec = null;
  const project = await workflowFacade.generateCreativeVideoProject({
    workflowId: 'required-literal-scene-spec',
    runId: 'run',
    creativeContext: {
      brief: persisted.hyperframes_freeform.brief.data,
      audio: {
        status: 'done',
        path: 'output.wav',
        scenes: persisted.hyperframes_freeform.brief.data.storyboard.scenes.map(scene => ({ ...scene, duration: 1 })),
      },
    },
    target: { duration_sec: 2 },
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async ({ sceneSpec }) => {
          capturedSceneSpec = sceneSpec;
          return { success: true, scene_spec: sceneSpec, project: { frames: [] } };
        },
      },
    },
  });
  assert.equal(project.success, true);
  assert.deepEqual(capturedSceneSpec.required_narration_literals, required);

  const failed = await generateBrief({ alwaysWrong: true });
  assert.equal(failed.result.success, false);
  assert.equal(failed.result.code, 'brief_required_literal_missing');
  assert.equal(failed.calls, 2);
  let ttsCalls = 0;
  const audio = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(failed.awemeId, failed.runId, {
    rootDir: failed.rootDir,
    sceneTtsService: { synthesizeSceneTts: async () => { ttsCalls += 1; return { success: true }; } },
  });
  assert.equal(audio.success, false);
  assert.equal(ttsCalls, 0);

  const scenes = [
    { index: 1, narration_text: `开场。${required[0].literal}` },
    { index: 2, narration_text: required[1].literal },
  ];
  const unsafeRepair = helpers.applyFreeformNarrationRepairs(scenes, [
    { index: 1, narration_text: '压缩后丢失原句。' },
  ], required);
  assert.equal(unsafeRepair.changed, false);
  assert.equal(unsafeRepair.requiredLiteralValidation.code, 'brief_required_literal_missing');
  assert.deepEqual(unsafeRepair.scenes, scenes);

  let ttsAfterCompression = 0;
  const compressed = await helpers.compressFreeformNarrationWithModel({
    modelService: { callTextModel: async () => ({ success: true, text: JSON.stringify({ scenes: [{ index: 1, narration_text: '压缩丢失原句。' }] }) }) },
    freeformAgent,
    scenes,
    budget: { max_recommended_chars: 1 },
    targetDurationSec: 1,
    requiredNarrationLiterals: required,
  });
  if (compressed.success) ttsAfterCompression += 1;
  assert.equal(compressed.success, false);
  assert.equal(compressed.code, 'brief_required_literal_missing');
  assert.equal(ttsAfterCompression, 0);

  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'required-literal-truncate-'));
  const legacyAwemeId = '20260722000000000003';
  const legacyRunId = 'required-literal-truncate';
  const legacyRunPath = writeRun(legacyRoot, legacyAwemeId, legacyRunId);
  const legacyRun = JSON.parse(fs.readFileSync(legacyRunPath, 'utf8'));
  legacyRun.storyboard_plan = {
    target_duration_sec: 1,
    required_narration_literals: [required[0]],
    scenes: [{ index: 1, target_duration_sec: 1, narration_text: `很长的开场铺垫。${required[0].literal}` }],
  };
  fs.writeFileSync(legacyRunPath, JSON.stringify(legacyRun, null, 2));
  const truncate = await agentRuns.compressDouyinRunSceneNarration(legacyAwemeId, legacyRunId, { rootDir: legacyRoot });
  assert.equal(truncate.success, false);
  assert.equal(truncate.code, 'brief_required_literal_missing');
  assert.equal(JSON.parse(fs.readFileSync(legacyRunPath, 'utf8')).storyboard_plan.scenes[0].narration_text, legacyRun.storyboard_plan.scenes[0].narration_text);

  const unchanged = helpers.applyFreeformNarrationRepairs([{ index: 1, narration_text: '旧流程。' }], [{ index: 1, narration_text: '新流程。' }]);
  assert.equal(unchanged.changed, true);
  assert.equal(unchanged.scenes[0].narration_text, '新流程。');

  console.log('agent runs required narration literal tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
