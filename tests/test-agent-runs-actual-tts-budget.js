const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRuns = require('../server/services/agent/agentRuns');

const requirements = Array.from({ length: 6 }, (_, index) => ({
  scene_id: `S${String(index + 1).padStart(2, '0')}`,
  literal: `必须保留原句${index + 1}。`,
}));

function narrationChars(scenes) {
  return scenes.reduce((sum, scene) => sum + Array.from(String(scene.narration_text).replace(/\s+/g, '')).length, 0);
}

function originalScenes() {
  const scenes = requirements.map((item, index) => ({ id: item.scene_id, index: index + 1, narration_text: item.literal }));
  scenes[0].narration_text += '长'.repeat(Math.max(0, 350 - narrationChars(scenes)));
  return scenes;
}

function compressedScenes(extraChars = 30) {
  return requirements.map((item, index) => ({
    id: item.scene_id,
    index: index + 1,
    narration_text: `${item.literal}${'短'.repeat(extraChars)}`,
  }));
}

function writeRun(rootDir, awemeId, runId) {
  const runDir = path.join(rootDir, awemeId, 'agent_runs');
  fs.mkdirSync(runDir, { recursive: true });
  const runPath = path.join(runDir, `${runId}.json`);
  fs.writeFileSync(runPath, JSON.stringify({
    success: true,
    run_id: runId,
    aweme_id: awemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 80 } },
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: '真实 TTS 时长测试',
          target_duration_sec: 80,
          required_narration_literals: requirements,
          storyboard: { scenes: originalScenes() },
        },
      },
    },
  }, null, 2));
  return runPath;
}

function ttsResult(duration, scenes, label) {
  return {
    success: true,
    message: label,
    scene_tts: {
      status: 'done',
      path: `${label}.wav`,
      duration,
      scenes: scenes.map(scene => ({
        ...scene,
        duration: duration / scenes.length,
        speech_duration_sec: duration / scenes.length,
        captions: [{ start: 0, end: duration / scenes.length, text: scene.narration_text }],
      })),
    },
  };
}

async function runDurationCase({ suffix, durations, modelScenes = compressedScenes(), staleModel = null }) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), `actual-tts-${suffix}-`));
  const awemeId = `20260722${suffix.padStart(12, '0')}`;
  const runId = `actual-tts-${suffix}`;
  const runPath = writeRun(rootDir, awemeId, runId);
  let ttsCalls = 0;
  let modelCalls = 0;
  let compressionPrompt = '';
  const resultPromise = agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(awemeId, runId, {
    rootDir,
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        modelCalls += 1;
        compressionPrompt = messages.map(message => message.content).join('\n');
        if (staleModel) return staleModel();
        return { success: true, text: JSON.stringify({ scenes: modelScenes }) };
      },
    },
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes }) => {
        const duration = durations[ttsCalls];
        ttsCalls += 1;
        return ttsResult(duration, scenes, `attempt-${ttsCalls}`);
      },
    },
  });
  return { result: await resultPromise, runPath, rootDir, awemeId, runId, ttsCalls, modelCalls, compressionPrompt };
}

(async () => {
  const success = await runDurationCase({ suffix: '10', durations: [93.622, 91.9] });
  assert.equal(success.result.success, true);
  assert.equal(success.ttsCalls, 2);
  assert.equal(success.modelCalls, 1);
  const hardMax = Number(success.compressionPrompt.match(/硬性总字数上限：(\d+) 字/)?.[1]);
  assert.ok(hardMax > 0 && hardMax <= 334);
  const successState = JSON.parse(fs.readFileSync(success.runPath, 'utf8')).hyperframes_freeform;
  const persistedScenes = successState.brief.data.storyboard.scenes;
  assert.ok(narrationChars(persistedScenes) <= hardMax);
  for (const requirement of requirements) {
    const scene = persistedScenes.find(item => item.id === requirement.scene_id);
    assert.ok(scene.narration_text.includes(requirement.literal));
  }
  assert.equal(successState.audio.status, 'ready');
  assert.ok(Math.abs(successState.audio.duration - 91.9) < 0.01);

  const over = await runDurationCase({ suffix: '11', durations: [93.622, 92.001] });
  assert.equal(over.result.success, false);
  assert.equal(over.result.code, 'tts_actual_duration_over_budget');
  assert.equal(over.result.details.attempt_count, 2);
  assert.equal(over.result.details.actual, 92.001);
  assert.equal(over.result.details.max_allowed, 92);
  const overState = JSON.parse(fs.readFileSync(over.runPath, 'utf8')).hyperframes_freeform;
  assert.equal(overState.status, 'failed');
  assert.equal(overState.audio.status, 'failed');

  const hard = await runDurationCase({ suffix: '12', durations: [101, 100.001] });
  assert.equal(hard.result.success, false);
  assert.equal(hard.result.details.hard_limit_exceeded, true);

  const boundary = await runDurationCase({ suffix: '13', durations: [92] });
  assert.equal(boundary.result.success, true);
  assert.equal(boundary.ttsCalls, 1);
  assert.equal(boundary.modelCalls, 0);

  const overMax = await runDurationCase({ suffix: '14', durations: [93.622], modelScenes: compressedScenes(80) });
  assert.equal(overMax.result.success, false);
  assert.equal(overMax.result.code, 'narration_compression_over_hard_max');
  assert.equal(overMax.ttsCalls, 1);
  assert.equal(overMax.modelCalls, 1);

  const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-tts-stale-'));
  const staleAwemeId = '20260722000000000015';
  const staleRunId = 'actual-tts-stale';
  const staleRunPath = writeRun(staleRoot, staleAwemeId, staleRunId);
  let releaseACompression;
  let markACompressionStarted;
  let aTtsCalls = 0;
  const aCompressionStarted = new Promise(resolve => { markACompressionStarted = resolve; });
  const staleA = agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(staleAwemeId, staleRunId, {
    rootDir: staleRoot,
    aiTextModel: {
      callTextModel: async () => {
        markACompressionStarted();
        return new Promise(resolve => { releaseACompression = resolve; });
      },
    },
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes }) => {
        aTtsCalls += 1;
        return ttsResult(93.622, scenes, 'stale-A');
      },
    },
  });
  await aCompressionStarted;
  const freshB = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(staleAwemeId, staleRunId, {
    rootDir: staleRoot,
    sceneTtsService: { synthesizeSceneTts: async ({ scenes }) => ttsResult(90, scenes, 'fresh-B') },
  });
  assert.equal(freshB.success, true);
  releaseACompression({ success: true, text: JSON.stringify({ scenes: compressedScenes() }) });
  const staleResult = await staleA;
  assert.equal(staleResult.success, false);
  assert.equal(aTtsCalls, 1);
  const staleState = JSON.parse(fs.readFileSync(staleRunPath, 'utf8')).hyperframes_freeform;
  assert.equal(staleState.status, 'ready');
  assert.equal(staleState.audio.path, 'fresh-B.wav');

  console.log('agent runs actual TTS budget tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
