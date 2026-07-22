const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRuns = require('../server/services/agent/agentRuns');
const helpers = require('../server/services/agent/agentRunsFreeformHelpers');
const freeformAgent = require('../server/services/hyperframes/hyperframesFreeformAgent');
const workflowFacade = require('../server/services/creative-video/workflowFacade');
const { executeCreativeWorkflowRetryPlan } = require('../server/services/creative-video/resumeExecutor');
const { createEmptyProject } = require('../server/services/creative-video/html-video/projectSchema');

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

async function generateBrief({ alwaysWrong = false, parserThrows = false } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'required-literal-'));
  const awemeId = alwaysWrong ? '20260722000000000002' : '20260722000000000001';
  const runId = alwaysWrong ? 'required-literal-fail' : 'required-literal-retry';
  const runPath = writeRun(rootDir, awemeId, runId);
  let calls = 0;
  let retryPrompt = '';
  let parseCalls = 0;
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
    ...(parserThrows ? {
      hyperframesFreeformAgent: {
        ...freeformAgent,
        parseFreeformBriefResponse: (...args) => {
          parseCalls += 1;
          if (parseCalls === 2) throw new Error('second parse exploded');
          return freeformAgent.parseFreeformBriefResponse(...args);
        },
      },
    } : {}),
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

  const thrown = await generateBrief({ parserThrows: true });
  assert.equal(thrown.result.success, false);
  assert.equal(thrown.result.code, 'brief_required_literal_missing');
  assert.match(thrown.result.message, /second parse exploded/);

  const recovered = await agentRuns.generateDouyinRunHyperframesFreeformBrief(failed.awemeId, failed.runId, {
    rootDir: failed.rootDir,
    briefOptions: { creative_context: { input: { raw_text: rawText } } },
    skillContext: { loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'test' }) },
    aiTextModel: { callTextModel: async () => ({ success: true, text: JSON.stringify(brief(required[0].literal, required[1].literal)) }) },
  });
  assert.equal(recovered.success, true);
  const recoveredState = JSON.parse(fs.readFileSync(failed.runPath, 'utf8')).hyperframes_freeform.brief;
  assert.equal(Object.prototype.hasOwnProperty.call(recoveredState, 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(recoveredState, 'missing'), false);

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

  const audioRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'required-literal-audio-'));
  const audioAwemeId = '20260722000000000004';
  const audioRunId = 'required-literal-audio';
  const audioRunPath = writeRun(audioRoot, audioAwemeId, audioRunId);
  const audioRun = JSON.parse(fs.readFileSync(audioRunPath, 'utf8'));
  audioRun.hyperframes_freeform = {
    status: 'ready',
    brief: {
      status: 'ready',
      data: {
        ...brief(`${required[0].literal}${'很长的旁白内容'.repeat(80)}`, `${required[1].literal}${'很长的旁白内容'.repeat(80)}`),
        required_narration_literals: required,
      },
    },
  };
  fs.writeFileSync(audioRunPath, JSON.stringify(audioRun, null, 2));
  let audioTtsCalls = 0;
  const audioFailure = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(audioAwemeId, audioRunId, {
    rootDir: audioRoot,
    aiTextModel: { callTextModel: async () => ({ success: true, text: JSON.stringify({ scenes: [{ index: 1, narration_text: '丢失原句。' }] }) }) },
    sceneTtsService: { synthesizeSceneTts: async () => { audioTtsCalls += 1; return { success: true }; } },
  });
  assert.equal(audioFailure.success, false);
  assert.equal(audioFailure.code, 'brief_required_literal_missing');
  assert.ok(audioFailure.missing.length > 0);
  assert.equal(audioTtsCalls, 0);
  const persistedAudioFailure = JSON.parse(fs.readFileSync(audioRunPath, 'utf8')).hyperframes_freeform.audio;
  assert.equal(persistedAudioFailure.code, 'brief_required_literal_missing');
  assert.ok(persistedAudioFailure.missing.length > 0);

  const audioRecovered = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(audioAwemeId, audioRunId, {
    rootDir: audioRoot,
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        text: JSON.stringify({ scenes: [
          { index: 1, narration_text: required[0].literal },
          { index: 2, narration_text: required[1].literal },
        ] }),
      }),
    },
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes }) => ({
        success: true,
        message: '恢复后的 B 音频。',
        scene_tts: {
          status: 'done',
          path: 'recovered-B.wav',
          duration: 2,
          scenes: scenes.map(scene => ({ ...scene, duration: 1, speech_duration_sec: 1, captions: [{ start: 0, end: 1, text: scene.narration_text }] })),
        },
      }),
    },
  });
  assert.equal(audioRecovered.success, true);
  const recoveredAudioState = JSON.parse(fs.readFileSync(audioRunPath, 'utf8')).hyperframes_freeform.audio;
  assert.equal(recoveredAudioState.status, 'ready');
  assert.equal(recoveredAudioState.path, 'recovered-B.wav');
  assert.equal(Object.prototype.hasOwnProperty.call(recoveredAudioState, 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(recoveredAudioState, 'missing'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(recoveredAudioState, 'error'), false);

  const concurrentAudioRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'required-literal-audio-race-'));
  const concurrentAudioAwemeId = '20260722000000000005';
  const concurrentAudioRunId = 'required-literal-audio-race';
  const concurrentAudioRunPath = writeRun(concurrentAudioRoot, concurrentAudioAwemeId, concurrentAudioRunId);
  const concurrentAudioRun = JSON.parse(fs.readFileSync(concurrentAudioRunPath, 'utf8'));
  concurrentAudioRun.hyperframes_freeform = {
    status: 'ready',
    brief: { status: 'ready', data: brief('第一段短旁白。', '第二段短旁白。') },
    audio: { status: 'failed', code: 'old_code', missing: [{ literal: 'old' }], error: 'old_error' },
  };
  fs.writeFileSync(concurrentAudioRunPath, JSON.stringify(concurrentAudioRun, null, 2));
  let releaseAudioA;
  let markAudioAStarted;
  const audioAStarted = new Promise(resolve => { markAudioAStarted = resolve; });
  const audioA = agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(concurrentAudioAwemeId, concurrentAudioRunId, {
    rootDir: concurrentAudioRoot,
    sceneTtsService: {
      synthesizeSceneTts: async () => {
        markAudioAStarted();
        return new Promise(resolve => { releaseAudioA = resolve; });
      },
    },
  });
  await audioAStarted;
  const audioB = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(concurrentAudioAwemeId, concurrentAudioRunId, {
    rootDir: concurrentAudioRoot,
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes }) => ({
        success: true,
        message: 'B 新音频完成。',
        scene_tts: {
          status: 'done',
          path: 'audio-B.wav',
          duration: 2,
          scenes: scenes.map(scene => ({ ...scene, duration: 1, speech_duration_sec: 1, captions: [{ start: 0, end: 1, text: scene.narration_text }] })),
        },
      }),
    },
  });
  assert.equal(audioB.success, true);
  releaseAudioA({ success: false, message: 'A 旧音频后失败。' });
  const staleAudioA = await audioA;
  assert.equal(staleAudioA.success, false);
  const concurrentAudioState = JSON.parse(fs.readFileSync(concurrentAudioRunPath, 'utf8')).hyperframes_freeform.audio;
  assert.equal(concurrentAudioState.status, 'ready');
  assert.equal(concurrentAudioState.path, 'audio-B.wav');
  assert.equal(concurrentAudioState.message, 'B 新音频完成。');
  assert.equal(Object.prototype.hasOwnProperty.call(concurrentAudioState, 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(concurrentAudioState, 'missing'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(concurrentAudioState, 'error'), false);

  const concurrentBriefRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'required-literal-brief-race-'));
  const concurrentBriefAwemeId = '20260722000000000006';
  const concurrentBriefRunId = 'required-literal-brief-race';
  const concurrentBriefRunPath = writeRun(concurrentBriefRoot, concurrentBriefAwemeId, concurrentBriefRunId);
  let releaseBriefA;
  let markBriefAStarted;
  let briefAModelCalls = 0;
  const briefAStarted = new Promise(resolve => { markBriefAStarted = resolve; });
  const sharedBriefOptions = {
    rootDir: concurrentBriefRoot,
    briefOptions: { creative_context: { input: { raw_text: rawText } } },
    skillContext: { loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'test' }) },
  };
  const briefA = agentRuns.generateDouyinRunHyperframesFreeformBrief(concurrentBriefAwemeId, concurrentBriefRunId, {
    ...sharedBriefOptions,
    aiTextModel: {
      callTextModel: async () => {
        briefAModelCalls += 1;
        markBriefAStarted();
        return new Promise(resolve => { releaseBriefA = resolve; });
      },
    },
  });
  await briefAStarted;
  let briefBModelCalls = 0;
  const briefB = await agentRuns.generateDouyinRunHyperframesFreeformBrief(concurrentBriefAwemeId, concurrentBriefRunId, {
    ...sharedBriefOptions,
    aiTextModel: {
      callTextModel: async () => {
        briefBModelCalls += 1;
        return { success: true, text: JSON.stringify({ ...brief(required[0].literal, required[1].literal), title: 'B 新策划' }) };
      },
    },
  });
  assert.equal(briefB.success, true);
  releaseBriefA({ success: true, text: JSON.stringify(brief('A 改写了原句。', 'A 也改写了原句。')) });
  const staleBriefA = await briefA;
  assert.equal(staleBriefA.success, false);
  assert.equal(staleBriefA.superseded, true);
  assert.equal(briefAModelCalls, 1);
  assert.equal(briefBModelCalls, 1);
  const concurrentBriefState = JSON.parse(fs.readFileSync(concurrentBriefRunPath, 'utf8')).hyperframes_freeform.brief;
  assert.equal(concurrentBriefState.status, 'ready');
  assert.equal(concurrentBriefState.data.title, 'B 新策划');

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

  const resumeProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'required-literal-resume-'));
  const resumeProject = createEmptyProject({ workflowId: 'required-literal-resume', runId: 'run' });
  resumeProject.target = { duration_sec: 1 };
  resumeProject.output = { ...resumeProject.output, duration: 1 };
  resumeProject.scene_spec = {
    required_narration_literals: [{ scene_id: 'S01', literal: '必须保留的恢复原句。' }],
    scenes: [{ id: 'scene_01', duration: 20, narration_text: '很长的开场内容放在前面。必须保留的恢复原句。', captions: [] }],
  };
  resumeProject.frames = [{ id: 'scene_01', scene_id: 'scene_01', engine: 'hyperframes-playwright', source_mode: 'raw_html', html_path: 'frames/scene_01.html', duration_sec: 20 }];
  resumeProject.audio = { duration_sec: 20 };
  fs.writeFileSync(path.join(resumeProjectDir, 'project.json'), JSON.stringify(resumeProject, null, 2));
  let resumeTtsCalls = 0;
  const resumeFailure = await executeCreativeWorkflowRetryPlan({
    workflowId: 'required-literal-resume',
    projectDir: resumeProjectDir,
    plan: { mode: 'repair_and_resume', can_retry: true, repair_action: 'repair_script_and_timeline' },
    services: { ttsService: { synthesizeSceneNarration: async () => { resumeTtsCalls += 1; return { success: true }; } } },
  });
  assert.equal(resumeFailure.success, false);
  assert.equal(resumeFailure.code, 'brief_required_literal_missing');
  assert.ok(resumeFailure.missing.length > 0);
  assert.equal(resumeTtsCalls, 0);

  const unchanged = helpers.applyFreeformNarrationRepairs([{ index: 1, narration_text: '旧流程。' }], [{ index: 1, narration_text: '新流程。' }]);
  assert.equal(unchanged.changed, true);
  assert.equal(unchanged.scenes[0].narration_text, '新流程。');

  console.log('agent runs required narration literal tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
