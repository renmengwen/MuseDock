const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createCreativeWorkflow,
  runCreativeWorkflow,
  getWorkflowPath,
} = require('../server/services/creative/creativeWorkflows');

const NOW = '2026-06-23T00:00:00.000Z';

function createTempDirs() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-workflow-defaults-'));
  return { rootDir, mediaRoot: path.join(rootDir, 'media') };
}

function readWorkflow(workflowId, rootDir) {
  return JSON.parse(fs.readFileSync(getWorkflowPath(workflowId, rootDir), 'utf-8'));
}

function createDefaults(overrides = {}) {
  return {
    aspectRatio: '16:9',
    targetDurationSec: 90,
    useResearch: false,
    generateAudio: true,
    generateCaptions: true,
    autoSfxEnabled: true,
    emotionalVoice: false,
    sourceImageAnalysisEnabled: false,
    extractDouyinFrames: false,
    frameHtmlConcurrency: 1,
    ...overrides,
  };
}

function createServices({
  workflowId = '202606230000000001',
  defaults = createDefaults(),
  systemSettings = { skipValidation: false },
  ttsRuntime = { provider: 'mimo', modelId: 'mimo-v2.5-tts' },
  textRuntime = { enabled: true, provider: 'mock', apiKey: 'sk-test', baseUrl: 'https://example.com/v1', modelId: 'mock-vision', supportsMultimodal: true },
  agentRuns: agentRunOverrides = {},
} = {}) {
  const calls = [];
  const agentRuns = {
    createDouyinHyperframesFreeformRun: async (awemeId, options) => {
      calls.push({ name: 'createRun', awemeId, options });
      return { success: true, status: 'done', run_id: 'run-defaults', message: '已创建运行记录。' };
    },
    generateDouyinRunHyperframesFreeformBrief: async (awemeId, runId, options) => {
      calls.push({ name: 'brief', awemeId, runId, options });
      return { success: true, status: 'done', message: '成片策划完成。' };
    },
    synthesizeDouyinRunHyperframesFreeformAudio: async (awemeId, runId, options) => {
      calls.push({ name: 'audio', awemeId, runId, options });
      return { success: true, status: 'done', message: '音频轨生成完成。' };
    },
    generateDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
      calls.push({ name: 'project', awemeId, runId, options });
      const projectDir = `${options.rootDir || ''}/${awemeId}/agent_runs/${runId}-html-video`;
      return {
        success: true,
        status: 'done',
        message: 'html-video 成片完成。',
        hyperframes_freeform: {
          project_dir: projectDir,
          project: {
            status: 'ready',
            render_mode: 'html-video',
            html_video_project_path: projectDir,
          },
          render: { status: 'rendered' },
          visual_inspect: { status: 'passed' },
        },
      };
    },
    ...agentRunOverrides,
  };

  return {
    calls,
    services: {
      now: () => NOW,
      idFactory: () => workflowId,
      researchService: {
        createResearchContext: async ({ enabled, query, now }) => (
          enabled
            ? { status: 'ready', query, sources: [], summary: '研究完成。', updated_at: now }
            : { status: 'disabled', query: '', sources: [], summary: '', updated_at: now }
        ),
      },
      aiModelConfig: {
        getRuntimeConfig: async type => {
          if (type === 'tts') return ttsRuntime;
          if (type === 'text') return textRuntime;
          return null;
        },
        getSkipValidation: async () => {
          throw new Error('不应直接读取 ai-models skipValidation');
        },
      },
      appSettings: {
        getCreativeDefaults: async () => defaults,
        getEffectiveSystemSettings: async () => systemSettings,
      },
      agentRuns,
    },
  };
}

function assertSnapshotRecord(record, {
  aspectRatio = '16:9',
  durationSec = 90,
  useResearch = false,
  generateAudio = true,
  generateCaptions = true,
  autoSfxEnabled = true,
  emotionalVoice = false,
  sourceImageAnalysisEnabled = false,
  extractDouyinFrames = false,
  frameHtmlConcurrency = 1,
} = {}) {
  assert.ok(record.creative_defaults_snapshot, 'snapshot fields missing');
  assert.equal(record.creative_defaults_snapshot.aspectRatio, aspectRatio);
  assert.equal(record.creative_defaults_snapshot.targetDurationSec, durationSec);
  assert.equal(record.creative_defaults_snapshot.useResearch, useResearch);
  assert.equal(record.creative_defaults_snapshot.generateAudio, generateAudio);
  assert.equal(record.creative_defaults_snapshot.generateCaptions, generateCaptions);
  assert.equal(record.creative_defaults_snapshot.autoSfxEnabled, autoSfxEnabled);
  assert.equal(record.creative_defaults_snapshot.emotionalVoice, emotionalVoice);
  assert.equal(record.creative_defaults_snapshot.sourceImageAnalysisEnabled, sourceImageAnalysisEnabled);
  assert.equal(record.creative_defaults_snapshot.extractDouyinFrames, extractDouyinFrames);
  assert.equal(record.creative_defaults_snapshot.frameHtmlConcurrency, frameHtmlConcurrency);
  assert.ok(record.target, 'target fields missing');
  assert.equal(record.target.aspect_ratio, aspectRatio);
  assert.equal(record.target.duration_sec, durationSec);
  assert.equal(record.target.generateAudio, generateAudio);
  assert.equal(record.target.generateCaptions, generateCaptions);
  assert.equal(record.target.autoSfxEnabled, autoSfxEnabled);
  assert.equal(record.target.emotionalVoice, emotionalVoice);
  assert.equal(record.target.sourceImageAnalysisEnabled, sourceImageAnalysisEnabled);
  assert.equal(record.target.extractDouyinFrames, extractDouyinFrames);
  assert.equal(record.target.frameHtmlConcurrency, frameHtmlConcurrency);
  assert.equal(record.input.use_research, useResearch);
}

async function createAndRead(payload, options = {}) {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services, calls } = createServices(options);
  const created = await createCreativeWorkflow({
    input: '做一期关于 AI 视频生产的知识科普',
    ...payload,
  }, { rootDir, mediaRoot, services });
  assert.equal(created.success, true);
  return {
    rootDir,
    mediaRoot,
    services,
    calls,
    workflowId: options.workflowId || '202606230000000001',
    record: readWorkflow(options.workflowId || '202606230000000001', rootDir),
  };
}

async function testCreateUsesAppDefaultsSnapshot() {
  const { record } = await createAndRead({});
  assertSnapshotRecord(record);
}

async function testLegacyUseResearchOverridesDefaults() {
  const { record } = await createAndRead({ useResearch: true });
  assertSnapshotRecord(record, { useResearch: true });
}

async function testCreativeDefaultsOverrideWins() {
  const { record } = await createAndRead({
    creativeDefaultsOverride: {
      useResearch: true,
      aspectRatio: '9:16',
    },
  });
  assertSnapshotRecord(record, {
    aspectRatio: '9:16',
    useResearch: true,
  });
}

async function testCreativeDefaultsOverrideBeatsLegacyUseResearch() {
  const { record } = await createAndRead({
    useResearch: false,
    creativeDefaultsOverride: {
      useResearch: true,
    },
  });
  assertSnapshotRecord(record, { useResearch: true });
}

async function testCreativeDefaultsOverrideSourceImageAnalysisWins() {
  const { record } = await createAndRead({
    input: '来源图片分析默认值测试 https://example.com/a',
    creativeDefaultsOverride: {
      sourceImageAnalysisEnabled: true,
      extractDouyinFrames: true,
      frameHtmlConcurrency: 3,
    },
  });
  assertSnapshotRecord(record, { sourceImageAnalysisEnabled: true, extractDouyinFrames: true, frameHtmlConcurrency: 3 });
}

async function testMissingDefaultUseResearchDefaultsToTrue() {
  const defaults = createDefaults();
  delete defaults.useResearch;
  const { record } = await createAndRead({}, { defaults });
  assertSnapshotRecord(record, { useResearch: true });
}

async function testAutoSfxDefaultAndOverrideReachWorkflowTarget() {
  const defaultOff = await createAndRead({}, {
    defaults: createDefaults({ autoSfxEnabled: false }),
    workflowId: '202606230000000006',
  });
  assertSnapshotRecord(defaultOff.record, { autoSfxEnabled: false });

  const overrideOn = await createAndRead({
    creativeDefaultsOverride: { autoSfxEnabled: true },
  }, {
    defaults: createDefaults({ autoSfxEnabled: false }),
    workflowId: '202606230000000007',
  });
  assertSnapshotRecord(overrideOn.record, { autoSfxEnabled: true });

  const overrideOff = await createAndRead({
    creativeDefaultsOverride: { autoSfxEnabled: false },
  }, {
    defaults: createDefaults({ autoSfxEnabled: true }),
    workflowId: '202606230000000008',
  });
  assertSnapshotRecord(overrideOff.record, { autoSfxEnabled: false });
}

async function testEmotionalVoiceDefaultPassesToAudioStage() {
  const workflowId = '202606230000000003';
  const { rootDir, mediaRoot } = createTempDirs();
  const { services, calls } = createServices({
    workflowId,
    defaults: createDefaults({ emotionalVoice: true }),
  });

  const created = await createCreativeWorkflow({
    input: '情绪化配音默认值测试',
  }, { rootDir, mediaRoot, services });
  assert.equal(created.success, true);

  const record = readWorkflow(workflowId, rootDir);
  assertSnapshotRecord(record, { emotionalVoice: true });

  const run = await runCreativeWorkflow(workflowId, { rootDir, mediaRoot, services });
  assert.equal(run.success, true);

  const audioCall = calls.find(call => call.name === 'audio');
  assert.ok(audioCall, 'audio stage should run');
  assert.match(audioCall.options.stylePrompt, /情绪|停顿|语气/);
}

async function testDisabledEmotionalVoicePassesNeutralAudioStyle() {
  const workflowId = '202606230000000004';
  const { rootDir, mediaRoot } = createTempDirs();
  const { services, calls } = createServices({
    workflowId,
    defaults: createDefaults({ emotionalVoice: false }),
  });

  const created = await createCreativeWorkflow({
    input: '关闭情绪化配音默认值测试',
  }, { rootDir, mediaRoot, services });
  assert.equal(created.success, true);

  const run = await runCreativeWorkflow(workflowId, { rootDir, mediaRoot, services });
  assert.equal(run.success, true);

  const audioCall = calls.find(call => call.name === 'audio');
  assert.ok(audioCall, 'audio stage should run');
  assert.match(audioCall.options.stylePrompt, /自然|清晰|语速稳定/);
  assert.doesNotMatch(audioCall.options.stylePrompt, /情绪起伏|停顿|加强语气/);
}

async function testMiniMaxSpeech28KeepsEmotionalVoiceStyle() {
  const workflowId = '202606230000000005';
  const { rootDir, mediaRoot } = createTempDirs();
  const { services, calls } = createServices({
    workflowId,
    defaults: createDefaults({ emotionalVoice: true }),
    ttsRuntime: { provider: 'provider_1', providerName: 'minimax', modelId: 'speech-2.8-hd' },
  });

  const created = await createCreativeWorkflow({
    input: 'MiniMax 情绪化配音测试',
  }, { rootDir, mediaRoot, services });
  assert.equal(created.success, true);

  const run = await runCreativeWorkflow(workflowId, { rootDir, mediaRoot, services });
  assert.equal(run.success, true);

  const audioCall = calls.find(call => call.name === 'audio');
  assert.ok(audioCall, 'audio stage should run');
  assert.match(audioCall.options.stylePrompt, /情绪|停顿|语气/);
}

async function testSkipValidationUsesAppSettingsAndRunUsesRecordTarget() {
  const workflowId = '202606230000000002';
  const { rootDir, mediaRoot } = createTempDirs();
  let defaults = createDefaults();
  let systemSettings = { skipValidation: true };
  const { services, calls } = createServices({
    workflowId,
    defaults,
    systemSettings,
  });
  services.appSettings.getCreativeDefaults = async () => defaults;
  services.appSettings.getEffectiveSystemSettings = async () => systemSettings;

  const created = await createCreativeWorkflow({
    input: '运行期默认值快照测试',
  }, { rootDir, mediaRoot, services });
  assert.equal(created.success, true);

  const initialRecord = readWorkflow(workflowId, rootDir);
  assertSnapshotRecord(initialRecord);
  assert.equal(initialRecord.skipValidation, true);

  defaults = createDefaults({
    aspectRatio: '9:16',
    targetDurationSec: 30,
    useResearch: true,
  });
  systemSettings = { skipValidation: false };

  const run = await runCreativeWorkflow(workflowId, {
    rootDir,
    mediaRoot,
    services,
    projectOptions: {
      aspect_ratio: 'runtime_aspect',
      runtimeFlag: 'kept',
    },
  });

  assert.equal(run.success, true);
  assert.deepEqual(calls.map(call => call.name), ['createRun', 'brief', 'audio', 'project']);
  const createRunCall = calls.find(call => call.name === 'createRun');
  const briefCall = calls.find(call => call.name === 'brief');
  const audioCall = calls.find(call => call.name === 'audio');
  assert.equal(createRunCall.options.targetDurationSec, 90);
  assert.equal(createRunCall.options.aspectRatio, '16:9');
  assert.equal(briefCall.options.briefOptions.targetDurationSec, 90);
  assert.equal(briefCall.options.briefOptions.aspectRatio, '16:9');
  assert.equal(audioCall.options.targetDurationSec, 90);
  assert.equal(audioCall.options.aspectRatio, '16:9');
  const projectCall = calls.find(call => call.name === 'project');
  assert.equal(projectCall.options.skipValidation, true);
  assert.equal(projectCall.options.projectOptions.aspect_ratio, 'runtime_aspect');
  assert.equal(projectCall.options.projectOptions.duration_sec, 90);
  assert.equal(projectCall.options.projectOptions.frameHtmlConcurrency, 1);
  assert.equal(projectCall.options.projectOptions.runtimeFlag, 'kept');
  assert.equal(projectCall.options.projectOptions.creative_context.input.raw_text, '运行期默认值快照测试');
}

(async () => {
  await testCreateUsesAppDefaultsSnapshot();
  await testLegacyUseResearchOverridesDefaults();
  await testCreativeDefaultsOverrideWins();
  await testCreativeDefaultsOverrideBeatsLegacyUseResearch();
  await testCreativeDefaultsOverrideSourceImageAnalysisWins();
  await testMissingDefaultUseResearchDefaultsToTrue();
  await testAutoSfxDefaultAndOverrideReachWorkflowTarget();
  await testEmotionalVoiceDefaultPassesToAudioStage();
  await testDisabledEmotionalVoicePassesNeutralAudioStyle();
  await testMiniMaxSpeech28KeepsEmotionalVoiceStyle();
  await testSkipValidationUsesAppSettingsAndRunUsesRecordTarget();
  console.log('creative workflow defaults tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
