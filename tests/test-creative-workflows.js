const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mediaPipeline = require('../server/services/mediaPipeline');
const { defaultRegistry } = require('../server/services/creativeTaskRegistry');
const {
  STAGE_IDS,
  STAGE_LABELS,
  createCreativeWorkflow,
  runCreativeWorkflow,
  getCreativeWorkflow,
  getCreativeWorkflowHtmlVideoProject,
  getWorkflowPath,
  makeLocalCreativeAwemeId,
  exportHtmlVideoProject,
  appendWorkflowModelCall,
  runResearchProvider,
} = require('../server/services/creativeWorkflows');

const NOW = '2026-06-12T12:00:00.000Z';
const WORKFLOW_ID = '202606121200000001';

function createTempDirs() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-workflows-test-'));
  const mediaRoot = path.join(rootDir, 'media');
  return { rootDir, mediaRoot };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function createFakeServices(overrides = {}) {
  const calls = [];
  const agentRuns = {
    createDouyinHyperframesFreeformRun: async (awemeId, options) => {
      calls.push({ name: 'createRun', awemeId, options });
      return { success: true, status: 'done', run_id: 'run-1', message: '已创建导演任务' };
    },
    generateDouyinRunHyperframesFreeformBrief: async (awemeId, runId, options) => {
      calls.push({ name: 'brief', awemeId, runId, options });
      return { success: true, status: 'done', message: '成片策划完成' };
    },
    synthesizeDouyinRunHyperframesFreeformAudio: async (awemeId, runId, options) => {
      calls.push({ name: 'audio', awemeId, runId, options });
      return { success: true, status: 'done', message: '音频轨生成完成' };
    },
    generateDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
      calls.push({ name: 'project', awemeId, runId, options });
      return { success: true, status: 'done', message: '工程生成完成' };
    },
    checkDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
      calls.push({ name: 'check', awemeId, runId, options });
      return { success: true, status: 'done', message: '工程校验通过' };
    },
    renderDouyinRunHyperframesFreeformVideo: async (awemeId, runId, options) => {
      calls.push({ name: 'render', awemeId, runId, options });
      return { success: true, status: 'done', message: '视频渲染完成' };
    },
    inspectDouyinRunHyperframesFreeformVideo: async (awemeId, runId, options) => {
      calls.push({ name: 'inspect', awemeId, runId, options });
      return { success: true, status: 'done', message: '视频巡检通过', inspect: { status: 'passed' } };
    },
  };

  Object.assign(agentRuns, overrides.agentRuns || {});

  return {
    calls,
    services: {
      now: () => NOW,
      idFactory: () => WORKFLOW_ID,
      aiModelConfig: { getSkipValidation: async () => false },
      researchService: {
        createResearchContext: async ({ enabled, query, now }) => {
          if (overrides.researchContext) {
            return overrides.researchContext({ enabled, query, now });
          }
          return enabled
            ? { status: 'ready', query, sources: [], summary: '研究完成', updated_at: now }
            : { status: 'disabled', query: '', sources: [], summary: '', updated_at: now };
        },
      },
      agentRuns,
      appSettings: {
        getCreativeDefaults: async () => ({
          aspectRatio: '9:16',
          targetDurationSec: 60,
          templateByAspectRatio: {
            '9:16': 'news_signal_vertical',
            '16:9': 'bold_signal',
            '1:1': '',
            '4:5': '',
          },
          lockTemplate: false,
          useResearch: true,
          generateAudio: true,
          generateCaptions: true,
        }),
        getEffectiveSystemSettings: async () => ({ skipValidation: false }),
      },
      ...(overrides.services || {}),
    },
  };
}

async function testCreatesAndRunsTextWorkflow() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services, calls } = createFakeServices();

  assert.deepEqual(STAGE_IDS, ['source', 'research', 'assets', 'agent_run', 'brief', 'audio', 'project', 'check', 'render', 'inspect']);
  assert.equal(STAGE_LABELS.source, '准备来源资料');
  assert.equal(getWorkflowPath(WORKFLOW_ID, rootDir), path.join(rootDir, `${WORKFLOW_ID}.json`));
  assert.match(makeLocalCreativeAwemeId(WORKFLOW_ID), /^\d{5,32}$/);
  assert.throws(() => getWorkflowPath('../bad', rootDir), /非法|无效/);

  const created = await createCreativeWorkflow({
    input: '做一期关于 AI 视频生产的知识科普',
    useResearch: false,
    assetIds: [],
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);
  assert.equal(created.status, 'queued');
  assert.equal(created.workflow_id, WORKFLOW_ID);
  assert.match(created.aweme_id, /^\d{5,32}$/);
  assert.equal(created.creative_context.input.mode, 'text');
  assert.equal(created.research_context.status, 'disabled');
  assert.deepEqual(created.asset_context.assets, []);
  assert.equal(Array.isArray(created.stages), true);
  assert.equal(created.stages.length, STAGE_IDS.length);
  assert.deepEqual(created.stages.map(stage => stage.id), STAGE_IDS);
  const createdSourceStage = created.stages.find(stage => stage.id === 'source');
  assert.equal(createdSourceStage.status, 'queued');
  assert.equal(createdSourceStage.label, '准备来源资料');

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);
  assert.equal(run.status, 'done');
  assert.equal(run.run_id, 'run-1');
  assert.deepEqual(calls.map(call => call.name), ['createRun', 'brief', 'audio', 'project', 'check', 'render', 'inspect']);
  assert.equal(calls[1].options.briefOptions.creative_context.input.mode, 'text');
  assert.equal(calls[3].options.projectOptions.creative_context.asset_context.status, 'empty');
  assert.equal(calls[3].options.useHtmlVideoLiteWorkflow, true);
  assert.equal(calls[0].options.rootDir, mediaRoot);

  const mediaPaths = mediaPipeline.getMediaPaths(created.aweme_id, mediaRoot);
  const metadata = readJson(mediaPaths.metadata);
  const transcript = readJson(mediaPaths.transcript);
  const analysisInput = readJson(mediaPaths.analysisInput);
  assert.equal(metadata.source_type, 'creative_text');
  assert.equal(transcript.text, '做一期关于 AI 视频生产的知识科普');
  assert.equal(analysisInput.creative_context.input.mode, 'text');

  const fetched = await getCreativeWorkflow(WORKFLOW_ID, { rootDir });
  assert.equal(fetched.success, true);
  assert.equal(fetched.data.status, 'done');
  assert.equal(fetched.data.stages.find(stage => stage.id === 'render').status, 'done');
}

async function testCreatesAndRunsSourceUrlWorkflow() {
  const { rootDir, mediaRoot } = createTempDirs();
  const repoUrl = 'https://github.com/owner/repo';
  const { services } = createFakeServices({
    services: {
      now: () => '2026-06-21T00:00:00.000Z',
      sourceFetch: {
        fetchSource: async sourceUrl => ({
          success: true,
          kind: 'github_repo',
          url: sourceUrl,
          title: 'owner/repo',
          markdown: '# owner/repo\n\n真实 README 内容。\n\n![架构图](https://example.com/arch.png)',
          truncated: false,
          metadata: { language: 'JavaScript' },
        }),
      },
      sourceAssets: {
        prepareSourceAssets: async ({ sourceMaterial, now }) => ({
          status: 'ready',
          updated_at: now,
          summary: '已准备 1 张图片素材。',
          diagnostics: [],
          assets: [{
            id: 'article_01',
            type: 'image',
            source: 'article',
            url: 'https://example.com/arch.png',
            path: 'assets/source-image-01.png',
            local_path: path.join(mediaRoot, 'fake-source-image-01.png'),
            alt: sourceMaterial.title,
            mime: 'image/png',
          }],
        }),
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: `做成项目解读视频 ${repoUrl}`,
    useResearch: false,
    assetIds: [],
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);
  assert.equal(created.creative_context.input.mode, 'source_url');
  assert.equal(created.creative_context.input.ignored_url_count, 0);

  const workflowPath = getWorkflowPath(WORKFLOW_ID, rootDir);
  const staleWorkflow = readJson(workflowPath);
  staleWorkflow.source_context = {
    ...(staleWorkflow.source_context || {}),
    source_metadata: {
      kind: 'article',
      url: 'https://old.example/a',
      title: '旧标题',
      truncated: true,
      language: 'OldLang',
    },
  };
  staleWorkflow.creative_context = {
    ...(staleWorkflow.creative_context || {}),
    source_context: staleWorkflow.source_context,
  };
  fs.writeFileSync(workflowPath, JSON.stringify(staleWorkflow, null, 2), 'utf-8');

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);
  assert.equal(run.status, 'done');
  assert.equal(run.source_context.diagnostics.ignored_url_count, 0);

  const mediaPaths = mediaPipeline.getMediaPaths(created.aweme_id, mediaRoot);
  const metadata = readJson(mediaPaths.metadata);
  const transcript = readJson(mediaPaths.transcript);
  const analysisInput = readJson(mediaPaths.analysisInput);

  assert.equal(metadata.source_type, 'source_url');
  assert.equal(metadata.source_kind, 'github_repo');
  assert.equal(metadata.source_url, repoUrl);
  assert.match(transcript.text, /真实 README 内容/);
  assert.equal(transcript.user_hint, '做成项目解读视频');
  assert.equal(transcript.truncated, false);
  assert.equal(analysisInput.source_material.kind, 'github_repo');
  assert.equal(analysisInput.source_material.url, 'https://github.com/owner/repo');
  assert.equal(analysisInput.source_material.title, 'owner/repo');
  assert.equal(analysisInput.source_material.user_hint, '做成项目解读视频');
  assert.match(analysisInput.source_material.markdown, /owner\/repo/);
  assert.equal(analysisInput.source_material.metadata.language, 'JavaScript');
  assert.equal(analysisInput.creative_context.source_context.kind, 'source_url');
  assert.match(analysisInput.creative_context.source_context.transcript, /真实 README 内容/);
  assert.equal(analysisInput.creative_context.source_context.comments_summary, '');
  assert.equal(analysisInput.creative_context.source_context.source_metadata.kind, 'github_repo');
  assert.equal(analysisInput.creative_context.source_context.source_metadata.url, repoUrl);
  assert.equal(analysisInput.creative_context.source_context.source_metadata.title, 'owner/repo');
  assert.equal(analysisInput.creative_context.source_context.source_metadata.truncated, false);
  assert.equal(analysisInput.creative_context.source_context.source_metadata.language, 'JavaScript');
  assert.equal(analysisInput.creative_context.source_context.diagnostics.source_kind, 'github_repo');
  assert.equal(analysisInput.creative_context.source_context.diagnostics.fetched_at, '2026-06-21T00:00:00.000Z');
  assert.equal(analysisInput.creative_context.source_context.diagnostics.ignored_url_count, 0);
  assert.equal(analysisInput.creative_context.asset_context.status, 'ready');
  assert.equal(analysisInput.creative_context.asset_context.assets[0].path, 'assets/source-image-01.png');
  assert.deepEqual(analysisInput.local_assets.images, [path.join(mediaRoot, 'fake-source-image-01.png')]);
  assert.equal(analysisInput.video.aweme_url, '');
}

async function testRunResearchProviderAddsAuditMetadata() {
  const audits = [];
  const result = await runResearchProvider({
    query: 'AI 视频生产',
    aiModelConfig: { getRuntimeConfig: async () => ({ modelId: 'gpt-test' }) },
    aiTextModel: {
      callTextModel: async request => {
        audits.push(request.audit);
        return {
          success: true,
          text: '研究摘要 https://example.com/report',
          raw_response: {},
        };
      },
    },
  });

  assert.equal(result.summary, '研究摘要 https://example.com/report');
  assert.deepEqual(audits, [{
    agent: 'ResearchAgent',
    stage: 'research',
    sub_stage: 'web_search_request',
    attempt: 1,
  }]);
}

async function testAppendWorkflowModelCall() {
  const record = { workflow_id: WORKFLOW_ID };
  appendWorkflowModelCall(record, {
    agent: 'director',
    stage: 'brief',
    sub_stage: 'outline',
    frame_id: 'frame_01',
    node_id: 'node_01',
    attempt: 2,
    model: { provider: 'OpenAI', model_id: 'gpt-test' },
    usage: { prompt_tokens: 10, completion_tokens: 'bad', total_tokens: 15, cached_tokens: 2 },
    duration_ms: 456,
    extra: 'drop',
  });

  const firstCall = record.model_calls[0];
  assert.equal(record.model_calls.length, 1);
  assert.equal(firstCall.id, 'model_call_0001');
  assert.ok(firstCall.created_at);
  assert.equal(firstCall.agent, 'director');
  assert.equal(firstCall.stage, 'brief');
  assert.equal(firstCall.sub_stage, 'outline');
  assert.equal(firstCall.frame_id, 'frame_01');
  assert.equal(firstCall.node_id, 'node_01');
  assert.equal(firstCall.attempt, 2);
  assert.deepEqual(firstCall.model, { provider: 'OpenAI', model_id: 'gpt-test' });
  assert.deepEqual(firstCall.usage, { prompt_tokens: 10, completion_tokens: null, total_tokens: 15, cached_tokens: 2 });
  assert.equal(firstCall.duration_ms, 456);
  assert.equal(firstCall.success, true);
  assert.equal(firstCall.error, '');
  assert.equal(Object.prototype.hasOwnProperty.call(firstCall, 'extra'), false);

  appendWorkflowModelCall(record, {
    id: 'failed_call',
    created_at: '2026-06-12T12:00:00.000Z',
    success: false,
    error: '调用失败',
    usage: { prompt_tokens: 'bad', completion_tokens: 1 },
  });
  assert.equal(record.model_calls[1].id, 'failed_call');
  assert.deepEqual(record.model_calls[1].usage, {
    prompt_tokens: null,
    completion_tokens: 1,
    total_tokens: null,
    cached_tokens: null,
  });
  assert.equal(record.model_calls[1].success, false);
  assert.equal(record.model_calls[1].error, '调用失败');

  for (let index = 0; index < 505; index += 1) {
    appendWorkflowModelCall(record, { id: `explicit_${index}`, created_at: `2026-06-12T12:00:${String(index % 60).padStart(2, '0')}.000Z` });
  }
  assert.equal(record.model_calls.length, 500);
  assert.equal(record.model_calls[0].id, 'explicit_5');
  assert.equal(record.model_calls[499].id, 'explicit_504');
}

async function testSourceUrlStageEmitsSpecificProgressMessages() {
  const { rootDir, mediaRoot } = createTempDirs();
  const emitted = [];
  const now = () => '2026-06-21T00:00:00.000Z';
  const idFactory = () => WORKFLOW_ID;
  const sourceUrl = 'https://mp.weixin.qq.com/s/demo';
  const { services } = createFakeServices({
    services: {
      now,
      idFactory,
      sourceFetch: {
        fetchSource: async url => ({
          success: true,
          kind: 'article',
          url,
          title: '公众号文章',
          markdown: '# 公众号文章\n\n这是一篇用于创作的文章正文。',
          truncated: false,
          metadata: {},
        }),
      },
    },
    agentRuns: {
      generateDouyinRunHyperframesFreeformProject: async () => ({
        success: true,
        status: 'done',
        message: '工程生成完成',
      }),
    },
  });

  const created = await createCreativeWorkflow({
    input: sourceUrl,
    useResearch: false,
    assetIds: [],
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);

  const run = await runCreativeWorkflow(WORKFLOW_ID, {
    rootDir,
    mediaRoot,
    taskContext: {
      emit: async event => emitted.push(event),
    },
    services,
  });

  assert.equal(run.success, true);
  assert.ok(emitted.some(event => (
    event.type === 'stage_progress'
    && event.stage === 'source'
    && /正在读取微信公众号文章/.test(event.message)
  )));
  assert.ok(emitted.some(event => (
    event.type === 'stage_progress'
    && event.stage === 'source'
    && /外部来源资料已读取/.test(event.message)
  )));
  assert.ok(emitted.some(event => (
    event.type === 'stage_done'
    && event.stage === 'source'
    && /外部来源资料已读取并准备完成/.test(event.message)
  )));
}

async function testSourceUrlEmptyMarkdownDoesNotEmitSuccessProgress() {
  const { rootDir, mediaRoot } = createTempDirs();
  const emitted = [];
  const sourceUrl = 'https://example.com/empty';
  const { services } = createFakeServices({
    services: {
      sourceFetch: {
        fetchSource: async url => ({
          success: true,
          kind: 'article',
          url,
          title: '空文章',
          markdown: '',
          truncated: false,
          metadata: {},
        }),
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: sourceUrl,
    useResearch: false,
    assetIds: [],
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);

  const run = await runCreativeWorkflow(WORKFLOW_ID, {
    rootDir,
    mediaRoot,
    taskContext: {
      emit: async event => emitted.push(event),
    },
    services,
  });

  assert.equal(run.success, false);
  assert.equal(run.error.stage, 'source');
  assert.equal(run.stages.find(stage => stage.id === 'source').status, 'failed');
  assert.ok(emitted.some(event => (
    event.type === 'stage_progress'
    && event.stage === 'source'
    && /正在读取网页文章/.test(event.message)
  )));
  assert.equal(emitted.some(event => (
    event.type === 'stage_progress'
    && event.stage === 'source'
    && /外部来源资料已读取/.test(event.message)
  )), false);
  assert.equal(emitted.some(event => (
    event.type === 'stage_done'
    && event.stage === 'source'
  )), false);
}

async function testSuccessfulSourceUrlFetchDropsStaleMetadataAndDiagnostics() {
  const { rootDir, mediaRoot } = createTempDirs();
  const sourceUrl = 'https://example.com/current-article';
  const { services } = createFakeServices({
    services: {
      now: () => '2026-06-21T00:00:00.000Z',
      sourceFetch: {
        fetchSource: async url => ({
          success: true,
          kind: 'article',
          url,
          title: '当前文章',
          markdown: '# 当前文章\n\n本次读取到的正文。',
          truncated: false,
          metadata: {},
        }),
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: `请解读这篇文章 ${sourceUrl}`,
    useResearch: false,
    assetIds: [],
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);

  const workflowPath = getWorkflowPath(WORKFLOW_ID, rootDir);
  const staleWorkflow = readJson(workflowPath);
  staleWorkflow.source_context = {
    ...(staleWorkflow.source_context || {}),
    source_metadata: {
      kind: 'github_repo',
      url: 'https://github.com/old-owner/old-repo',
      title: 'old-owner/old-repo',
      truncated: true,
      owner: 'old-owner',
      repo: 'old-repo',
      language: 'OldLang',
      legacy_only: 'stale',
    },
    diagnostics: {
      code: 'SOURCE_FETCH_EXCEPTION',
      legacy_code: 'stale',
      source_type: 'source_url',
      source_kind: 'github_repo',
      fetched_at: '2026-06-20T00:00:00.000Z',
      ignored_url_count: 3,
    },
  };
  staleWorkflow.creative_context = {
    ...(staleWorkflow.creative_context || {}),
    source_context: staleWorkflow.source_context,
  };
  fs.writeFileSync(workflowPath, JSON.stringify(staleWorkflow, null, 2), 'utf-8');

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);

  const mediaPaths = mediaPipeline.getMediaPaths(created.aweme_id, mediaRoot);
  const analysisInput = readJson(mediaPaths.analysisInput);
  const sourceContext = analysisInput.creative_context.source_context;

  assert.equal(sourceContext.source_metadata.kind, 'article');
  assert.equal(sourceContext.source_metadata.url, sourceUrl);
  assert.equal(sourceContext.source_metadata.title, '当前文章');
  assert.equal(sourceContext.source_metadata.truncated, false);
  assert.equal(sourceContext.source_metadata.owner, undefined);
  assert.equal(sourceContext.source_metadata.repo, undefined);
  assert.equal(sourceContext.source_metadata.language, undefined);
  assert.equal(sourceContext.source_metadata.legacy_only, undefined);
  assert.equal(sourceContext.diagnostics.source_type, 'source_url');
  assert.equal(sourceContext.diagnostics.source_kind, 'article');
  assert.equal(sourceContext.diagnostics.fetched_at, '2026-06-21T00:00:00.000Z');
  assert.equal(sourceContext.diagnostics.ignored_url_count, 0);
  assert.equal(sourceContext.diagnostics.prepared_at, '2026-06-21T00:00:00.000Z');
  assert.equal(sourceContext.diagnostics.code, undefined);
  assert.equal(sourceContext.diagnostics.legacy_code, undefined);
}

async function testSourceUrlFailurePersistsFailedSourceContext() {
  const { rootDir, mediaRoot } = createTempDirs();
  const sourceUrl = 'https://example.com/post';
  const { services, calls } = createFakeServices({
    services: {
      sourceFetch: {
        fetchSource: async url => ({
          success: false,
          kind: 'article',
          url,
          message: '未能读取文章正文，请确认链接可公开访问。',
          diagnostic: { code: 'ARTICLE_EMPTY' },
        }),
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: sourceUrl,
    useResearch: false,
    assetIds: [],
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);
  assert.equal(created.creative_context.input.mode, 'source_url');

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, false);
  assert.equal(run.error.stage, 'source');
  assert.deepEqual(calls, []);
  assert.equal(run.source_context.status, 'failed');
  assert.equal(run.source_context.kind, 'source_url');
  assert.equal(run.source_context.source_metadata.url, sourceUrl);
  assert.equal(run.source_context.diagnostics.code, 'ARTICLE_EMPTY');
  assert.equal(run.creative_context.source_context.status, 'failed');
  assert.equal(run.stages.find(stage => stage.id === 'source').status, 'failed');

  const persisted = await getCreativeWorkflow(WORKFLOW_ID, { rootDir });
  assert.equal(persisted.data.source_context.status, 'failed');
  assert.equal(persisted.data.source_context.kind, 'source_url');
  assert.equal(persisted.data.source_context.source_metadata.url, sourceUrl);
  assert.equal(persisted.data.source_context.diagnostics.code, 'ARTICLE_EMPTY');
  assert.equal(persisted.data.creative_context.source_context.status, 'failed');
  assert.equal(persisted.data.stages.find(stage => stage.id === 'source').status, 'failed');
}

async function testSourceUrlFetchExceptionPersistsFailedSourceContext() {
  const { rootDir, mediaRoot } = createTempDirs();
  const sourceUrl = 'https://example.com/post';
  const { services, calls } = createFakeServices({
    services: {
      sourceFetch: {
        fetchSource: async () => {
          throw new Error('boom');
        },
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: sourceUrl,
    useResearch: false,
    assetIds: [],
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);
  assert.equal(created.creative_context.input.mode, 'source_url');

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, false);
  assert.equal(run.error.stage, 'source');
  assert.deepEqual(calls, []);
  assert.equal(run.source_context.status, 'failed');
  assert.equal(run.source_context.kind, 'source_url');
  assert.equal(run.source_context.source_metadata.url, sourceUrl);
  assert.equal(run.source_context.diagnostics.code, 'SOURCE_FETCH_EXCEPTION');
  assert.equal(run.creative_context.source_context.status, 'failed');
  assert.equal(run.stages.find(stage => stage.id === 'source').status, 'failed');
  assert.notEqual(run.message, 'boom');
  assert.match(run.message, /外部来源/);

  const persisted = await getCreativeWorkflow(WORKFLOW_ID, { rootDir });
  assert.equal(persisted.data.source_context.status, 'failed');
  assert.equal(persisted.data.source_context.kind, 'source_url');
  assert.equal(persisted.data.source_context.source_metadata.url, sourceUrl);
  assert.equal(persisted.data.source_context.diagnostics.code, 'SOURCE_FETCH_EXCEPTION');
  assert.equal(persisted.data.creative_context.source_context.status, 'failed');
  assert.match(persisted.data.message, /外部来源/);
  assert.notEqual(persisted.data.message, 'boom');
}

async function testSourceUrlFetchFailureUsesDefaultChineseMessage() {
  const { rootDir, mediaRoot } = createTempDirs();
  const sourceUrl = 'https://example.com/post';
  const { services } = createFakeServices({
    services: {
      sourceFetch: {
        fetchSource: async url => ({
          success: false,
          kind: 'article',
          url,
        }),
      },
    },
  });

  await createCreativeWorkflow({
    input: sourceUrl,
    useResearch: false,
    assetIds: [],
  }, { rootDir, mediaRoot, services });

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, false);
  assert.equal(run.message, '读取外部来源失败，请确认链接可公开访问。');
  assert.equal(run.source_context.summary, '读取外部来源失败，请确认链接可公开访问。');
}

async function testResearchRunsInBackgroundStage() {
  const { rootDir, mediaRoot } = createTempDirs();
  let researchCalls = 0;
  const { services, calls } = createFakeServices({
    services: {
      researchService: {
        createResearchContext: async ({ enabled, query, now }) => {
          researchCalls += 1;
          return enabled
            ? { status: 'ready', query, sources: [], summary: '后台研究完成', updated_at: now }
            : { status: 'disabled', query: '', sources: [], summary: '', updated_at: now };
        },
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: '做一期关于 AI 视频生产的知识科普',
    useResearch: true,
    assetIds: [],
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);
  assert.equal(researchCalls, 0);
  assert.equal(created.research_context.status, 'pending');
  assert.equal(created.creative_context.research_context.status, 'pending');

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);
  assert.equal(researchCalls, 1);
  assert.equal(calls[1].options.briefOptions.creative_context.research_context.status, 'ready');
  assert.equal(calls[1].options.briefOptions.creative_context.research_context.summary, '后台研究完成');

  const fetched = await getCreativeWorkflow(WORKFLOW_ID, { rootDir, services });
  assert.equal(fetched.data.research_context.status, 'ready');
  assert.equal(fetched.data.creative_context.research_context.status, 'ready');
}

async function testHtmlVideoLiteCompletesVisibleFinalStages() {
  const { rootDir, mediaRoot } = createTempDirs();
  const projectDir = path.join(mediaRoot, '12345', 'agent_runs', 'run-1-html-video');
  const { services, calls } = createFakeServices({
    agentRuns: {
      generateDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
        calls.push({ name: 'project', awemeId, runId, options });
        return {
          success: true,
          status: 'done',
          message: 'html-video lite 成片完成。',
          hyperframes_freeform: {
            status: 'ready',
            project_dir: projectDir,
            project: {
              status: 'ready',
              project_dir: projectDir,
              html_video_project_path: projectDir,
              render_mode: 'html-video',
              scene_spec: { title: '测试', scenes: [] },
              frame_specs: { frames: [{ id: 'frame_01', scene_id: 'scene_01' }] },
            },
            render: {
              status: 'rendered',
              output_path: path.join(projectDir, 'exports', 'output.mp4'),
              render_versions: [{ id: 'run-1-html-video-lite', status: 'rendered' }],
            },
            visual_inspect: { status: 'passed', issues: [] },
          },
        };
      },
      checkDouyinRunHyperframesFreeformProject: async () => {
        throw new Error('不应调用旧 HyperFrames 工程校验');
      },
      renderDouyinRunHyperframesFreeformVideo: async () => {
        throw new Error('不应调用旧 HyperFrames 渲染');
      },
      inspectDouyinRunHyperframesFreeformVideo: async () => {
        throw new Error('不应调用旧 HyperFrames 巡检');
      },
    },
  });

  await createCreativeWorkflow({ input: '做一个 html-video 测试', useResearch: false, assetIds: [] }, { rootDir, mediaRoot, services });
  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);
  assert.deepEqual(calls.map(call => call.name), ['createRun', 'brief', 'audio', 'project']);
  const persisted = readJson(getWorkflowPath(WORKFLOW_ID, rootDir));
  assert.equal(persisted.result.hyperframes_freeform.project.html_video_project_path, projectDir);
  assert.equal(persisted.result.hyperframes_freeform.render.status, 'rendered');
  assert.equal(persisted.status, 'done');
  const checkStage = persisted.stages.find(item => item.id === 'check');
  assert.equal(checkStage.status, 'skipped');
  assert.match(checkStage.message, /跳过旧 HyperFrames/);
  for (const stageId of ['render', 'inspect']) {
    const stage = persisted.stages.find(item => item.id === stageId);
    assert.equal(stage.status, 'done');
    assert.notEqual(stage.status, 'pending');
    assert.notEqual(stage.status, 'queued');
    assert.notEqual(stage.status, 'running');
  }

  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    project_id: 'p1',
    workflow_id: WORKFLOW_ID,
    run_id: 'run-1',
    template_id: 'simple',
    template_inputs: {},
    frames: [],
    timeline: { tracks: [] },
  }, null, 2));
  const htmlVideoProject = await getCreativeWorkflowHtmlVideoProject(WORKFLOW_ID, { rootDir });
  assert.equal(htmlVideoProject.success, true);
  assert.equal(htmlVideoProject.html_video_project_path, projectDir);
}

async function testCreativeDefaultsDisableAudioAndCaptionsInWorkflow() {
  const { rootDir, mediaRoot } = createTempDirs();
  const projectDir = path.join(mediaRoot, '12345', 'agent_runs', 'run-1-html-video');
  let audioCalls = 0;
  let projectOptionsSeen = null;
  const { services } = createFakeServices({
    services: {
      appSettings: {
        getCreativeDefaults: async () => ({
          aspectRatio: '9:16',
          targetDurationSec: 60,
          generateAudio: false,
          generateCaptions: false,
        }),
        getEffectiveSystemSettings: async () => ({ skipValidation: false }),
      },
    },
    agentRuns: {
      synthesizeDouyinRunHyperframesFreeformAudio: async () => {
        audioCalls += 1;
        return { success: true, status: 'done', message: '音频轨生成完成' };
      },
      generateDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
        projectOptionsSeen = options.projectOptions;
        return {
          success: true,
          status: 'done',
          message: 'html-video lite 成片完成。',
          hyperframes_freeform: {
            status: 'ready',
            project_dir: projectDir,
            project: {
              status: 'ready',
              project_dir: projectDir,
              html_video_project_path: projectDir,
              render_mode: 'html-video',
              scene_spec: { title: '测试', scenes: [] },
              frame_specs: { frames: [] },
            },
            render: {
              status: 'rendered',
              output_path: path.join(projectDir, 'exports', 'output.mp4'),
              render_versions: [{ id: 'run-1-html-video-lite', status: 'rendered' }],
            },
            visual_inspect: { status: 'passed', issues: [] },
          },
        };
      },
    },
  });

  await createCreativeWorkflow({ input: '做一个关闭音频字幕的测试', useResearch: false, assetIds: [] }, { rootDir, mediaRoot, services });
  const result = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(result.success, true);
  assert.equal(audioCalls, 0);
  assert.equal(projectOptionsSeen.generateAudio, false);
  assert.equal(projectOptionsSeen.generateCaptions, false);
}

async function testLegacyCreativeDefaultsSnapshotFallsBackToRealtimeMediaOptions() {
  const { rootDir, mediaRoot } = createTempDirs();
  const projectDir = path.join(mediaRoot, '12345', 'agent_runs', 'run-1-html-video');
  let audioCalls = 0;
  let projectOptionsSeen = null;
  const { services } = createFakeServices({
    services: {
      appSettings: {
        getCreativeDefaults: async () => ({
          aspectRatio: '9:16',
          targetDurationSec: 60,
          generateAudio: false,
          generateCaptions: false,
        }),
        getEffectiveSystemSettings: async () => ({ skipValidation: false }),
      },
    },
    agentRuns: {
      synthesizeDouyinRunHyperframesFreeformAudio: async () => {
        audioCalls += 1;
        return { success: true, status: 'done', message: '音频轨生成完成' };
      },
      generateDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
        projectOptionsSeen = options.projectOptions;
        return {
          success: true,
          status: 'done',
          message: 'html-video lite 成片完成。',
          hyperframes_freeform: {
            status: 'ready',
            project_dir: projectDir,
            project: {
              status: 'ready',
              project_dir: projectDir,
              html_video_project_path: projectDir,
              render_mode: 'html-video',
              scene_spec: { title: '测试', scenes: [] },
              frame_specs: { frames: [] },
            },
            render: {
              status: 'rendered',
              output_path: path.join(projectDir, 'exports', 'output.mp4'),
              render_versions: [{ id: 'run-1-html-video-lite', status: 'rendered' }],
            },
            visual_inspect: { status: 'passed', issues: [] },
          },
        };
      },
    },
  });

  await createCreativeWorkflow({ input: '做一个旧快照兼容测试', useResearch: false, assetIds: [] }, { rootDir, mediaRoot, services });
  const workflowPath = getWorkflowPath(WORKFLOW_ID, rootDir);
  const legacyRecord = readJson(workflowPath);
  delete legacyRecord.creative_defaults_snapshot.generateAudio;
  delete legacyRecord.creative_defaults_snapshot.generateCaptions;
  delete legacyRecord.target.generateAudio;
  delete legacyRecord.target.generateCaptions;
  fs.writeFileSync(workflowPath, JSON.stringify(legacyRecord, null, 2), 'utf-8');

  const result = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(result.success, true);
  assert.equal(audioCalls, 0);
  assert.equal(projectOptionsSeen.generateAudio, false);
  assert.equal(projectOptionsSeen.generateCaptions, false);
}

async function testHtmlVideoExportUsesOrchestratorWithTemplateRegistry() {
  const { rootDir, mediaRoot } = createTempDirs();
  const workflowPath = getWorkflowPath(WORKFLOW_ID, rootDir);
  const projectDir = path.join(mediaRoot, '12345', 'agent_runs', 'run-1-html-video');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
  fs.writeFileSync(workflowPath, JSON.stringify({
    workflow_id: WORKFLOW_ID,
    status: 'done',
    result: {
      hyperframes_freeform: {
        project: {
          html_video_project_path: projectDir,
        },
      },
    },
  }, null, 2), 'utf-8');
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    project_id: 'p1',
    workflow_id: WORKFLOW_ID,
    run_id: 'run-1',
    template_id: 'simple',
    template_inputs: { headline: '旧标题' },
    output: { fps: 24 },
    frames: [
      {
        id: 'frame_01',
        scene_id: 'scene_01',
        template_id: 'simple',
        html_path: 'frames/stale.html',
        inputs: { headline: '旧帧标题' },
        duration_sec: 2,
      },
    ],
    timeline: { tracks: [] },
  }, null, 2), 'utf-8');

  const calls = [];
  const result = await exportHtmlVideoProject(WORKFLOW_ID, {}, {
    rootDir,
    htmlVideoProjectOrchestrator: {
      exportHtmlVideoProject: async options => {
        calls.push(options);
        assert.ok(options.templateRegistry);
        assert.equal(options.projectDir, projectDir);
        assert.equal(options.project.frames[0].html_path, 'frames/stale.html');
        return {
          success: true,
          message: '导出完成。',
          html_video_project_path: projectDir,
          output_path: path.join(projectDir, 'exports', 'output.mp4'),
          project: {
            ...options.project,
            frames: [
              {
                ...options.project.frames[0],
                html_path: 'frames/01-scene_01.html',
              },
            ],
            exports: [{ id: 'export_0001', path: 'exports/output.mp4' }],
          },
          diagnostics: [],
        };
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(result.html_video_project.frames[0].html_path, 'frames/01-scene_01.html');
  assert.equal(result.output_path, path.join(projectDir, 'exports', 'output.mp4'));
}

async function testFallbackProjectDoesNotSkipLegacyStages() {
  const { rootDir, mediaRoot } = createTempDirs();
  const projectDir = path.join(mediaRoot, '12345', 'agent_runs', 'run-1-rich-fallback');
  const { services, calls } = createFakeServices({
    agentRuns: {
      generateDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
        calls.push({ name: 'project', awemeId, runId, options });
        return {
          success: true,
          status: 'done',
          message: '创意视频生成完成。（Rich Template 模式）',
          hyperframes_freeform: {
            status: 'ready',
            project_dir: projectDir,
            project: {
              status: 'ready',
              project_dir: projectDir,
              html_video_project_path: projectDir,
              render_mode: 'rich',
              scene_spec: { title: '测试', scenes: [] },
              frame_specs: { frames: [] },
            },
            render: {
              status: 'rendered',
              output_path: path.join(projectDir, 'output.mp4'),
              render_versions: [{ id: 'run-1-rich', status: 'rendered' }],
            },
          },
        };
      },
    },
  });

  await createCreativeWorkflow({ input: '做一个 fallback 测试', useResearch: false, assetIds: [] }, { rootDir, mediaRoot, services });
  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);
  assert.deepEqual(calls.map(call => call.name), ['createRun', 'brief', 'audio', 'project', 'check', 'render', 'inspect']);
}

async function testRejectsEmptyInput() {
  const { rootDir } = createTempDirs();
  const { services } = createFakeServices();

  const result = await createCreativeWorkflow({ input: '' }, { rootDir, services });

  assert.equal(result.success, false);
  assert.match(result.message, /请输入视频方向/);
}

async function testCreatesDouyinWorkflowWithOriginalAwemeId() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices();

  const created = await createCreativeWorkflow({
    input: '7345678901234567890',
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);
  assert.equal(created.aweme_id, '7345678901234567890');
  assert.equal(created.creative_context.input.mode, 'douyin');
  assert.equal(created.creative_context.source_context.kind, 'douyin');
  assert.equal(created.creative_context.source_context.douyin_metadata.aweme_id, '7345678901234567890');
}

async function testPreparesDouyinSourceBeforeAgentRun() {
  const { rootDir, mediaRoot } = createTempDirs();
  const events = [];
  let prepared = false;
  const { services } = createFakeServices({
    agentRuns: {
      createDouyinHyperframesFreeformRun: async (awemeId, options) => {
        events.push(['createRun', awemeId, options.rootDir]);
        if (!prepared) {
          return { success: false, message: 'source not prepared' };
        }
        return { success: true, status: 'done', run_id: 'run-1', message: 'created' };
      },
    },
    services: {
      mediaPipeline: {
        getStatus: async (awemeId, options) => {
          events.push(['getStatus', awemeId, options.rootDir]);
          if (prepared) {
            return {
              success: true,
              exists: true,
              metadata: {
                aweme_id: awemeId,
                title: 'Douyin source title',
                description: 'Douyin source description',
              },
              analysis_input: {
                aweme_id: awemeId,
                local_assets: {
                  video: path.join(mediaRoot, awemeId, 'video.mp4'),
                  frames: [],
                },
              },
              assets: {
                video: { path: path.join(mediaRoot, awemeId, 'video.mp4') },
                frames_dir: { count: 0 },
              },
            };
          }
          return { success: true, exists: false, metadata: null, analysis_input: null };
        },
        prepareDouyinMedia: async (awemeId, metadata, options) => {
          events.push(['prepareMedia', awemeId, options.rootDir, metadata.aweme_id]);
          prepared = true;
          return {
            success: true,
            message: 'source prepared',
            analysis_input: {
              aweme_id: awemeId,
              local_assets: {
                video: path.join(mediaRoot, awemeId, 'video.mp4'),
                frames: [],
              },
              video: {
                title: metadata.title,
                description: metadata.description,
              },
            },
            steps: {
              metadata: { status: 'done' },
              analysis_input: { status: 'done' },
            },
          };
        },
      },
      getVideoDetail: async awemeId => {
        events.push(['getVideoDetail', awemeId]);
        return {
          success: true,
          data: {
            aweme_id: awemeId,
            title: 'Douyin source title',
            description: 'Douyin source description',
            aweme_url: `https://www.douyin.com/video/${awemeId}`,
            video_download_url: 'https://example.test/video.mp4',
          },
        };
      },
    },
  });

  await createCreativeWorkflow({
    input: 'https://www.douyin.com/video/7345678901234567890',
  }, { rootDir, mediaRoot, services });

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);
  assert.deepEqual(events.slice(0, 5), [
    ['getStatus', '7345678901234567890', mediaRoot],
    ['getVideoDetail', '7345678901234567890'],
    ['prepareMedia', '7345678901234567890', mediaRoot, '7345678901234567890'],
    ['getStatus', '7345678901234567890', mediaRoot],
    ['createRun', '7345678901234567890', mediaRoot],
  ]);
  assert.equal(run.creative_context.source_context.status, 'ready');
  assert.equal(run.creative_context.source_context.summary, 'Douyin source title');
  assert.equal(run.creative_context.source_context.douyin_metadata.title, 'Douyin source title');
}

async function testFailsDouyinSourceWhenPreparedMediaIsMissing() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      mediaPipeline: {
        getStatus: async () => ({ success: true, exists: false, metadata: null, analysis_input: null }),
        prepareDouyinMedia: async (awemeId, metadata) => ({
          success: true,
          analysis_input: {
            aweme_id: awemeId,
            video: {
              title: metadata.title,
              description: metadata.description,
            },
            local_assets: {
              video: '',
              frames: [],
            },
          },
          steps: {
            video: { status: 'failed', error: 'download failed' },
            frames: { status: 'skipped' },
          },
        }),
      },
      getVideoDetail: async awemeId => ({
        success: true,
        data: {
          aweme_id: awemeId,
          title: 'Douyin source title',
          description: 'Douyin source description',
          aweme_url: `https://www.douyin.com/video/${awemeId}`,
          video_download_url: '',
        },
      }),
    },
  });

  await createCreativeWorkflow({ input: '7345678901234567890' }, { rootDir, mediaRoot, services });

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, false);
  assert.equal(run.error.stage, 'source');
  assert.match(run.error.message, /抖音素材准备失败/);
  assert.equal(run.stages.find(stage => stage.id === 'source').status, 'failed');
}

async function testFailsDouyinSourceWhenPreparedPathDoesNotExist() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      mediaPipeline: {
        getStatus: async () => ({ success: true, exists: false, metadata: null, analysis_input: null }),
        prepareDouyinMedia: async (awemeId, metadata) => ({
          success: true,
          analysis_input: {
            aweme_id: awemeId,
            video: {
              title: metadata.title,
            },
            local_assets: {
              video: path.join(mediaRoot, awemeId, 'missing-video.mp4'),
              frames: [],
            },
          },
          steps: {
            video: { status: 'done' },
          },
        }),
      },
      getVideoDetail: async awemeId => ({
        success: true,
        data: {
          aweme_id: awemeId,
          title: 'Douyin source title',
          aweme_url: `https://www.douyin.com/video/${awemeId}`,
          video_download_url: 'https://example.test/video.mp4',
        },
      }),
    },
  });

  await createCreativeWorkflow({ input: '7345678901234567890' }, { rootDir, mediaRoot, services });

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, false);
  assert.equal(run.error.stage, 'source');
  assert.match(run.error.message, /未生成可用的本地视频或关键帧/);
}

async function testRepreparesStaleDouyinAnalysisInputWithoutLocalMedia() {
  const { rootDir, mediaRoot } = createTempDirs();
  const events = [];
  let prepared = false;
  const { services } = createFakeServices({
    agentRuns: {
      createDouyinHyperframesFreeformRun: async () => {
        events.push(['createRun']);
        return prepared
          ? { success: true, status: 'done', run_id: 'run-1', message: 'created' }
          : { success: false, message: 'source not prepared' };
      },
    },
    services: {
      mediaPipeline: {
        getStatus: async (awemeId, options) => {
          events.push(['getStatus', options.rootDir]);
          if (prepared) {
            return {
              success: true,
              exists: true,
              metadata: {
                aweme_id: awemeId,
                title: 'Cached title',
                description: 'Cached description',
                aweme_url: `https://www.douyin.com/video/${awemeId}`,
                video_download_url: 'https://example.test/video.mp4',
              },
              analysis_input: {
                aweme_id: awemeId,
                local_assets: {
                  video: path.join(mediaRoot, awemeId, 'video.mp4'),
                  frames: [],
                },
              },
              assets: {
                video: { path: path.join(mediaRoot, awemeId, 'video.mp4') },
                frames_dir: { count: 0 },
              },
            };
          }
          return {
            success: true,
            exists: true,
            metadata: {
              aweme_id: awemeId,
              title: 'Cached title',
              description: 'Cached description',
              aweme_url: `https://www.douyin.com/video/${awemeId}`,
              video_download_url: 'https://example.test/video.mp4',
            },
            analysis_input: {
              aweme_id: awemeId,
              local_assets: {
                video: path.join(mediaRoot, awemeId, 'missing-video.mp4'),
                frames: [],
              },
            },
            assets: {
              video: null,
              frames_dir: { count: 0 },
            },
          };
        },
        prepareDouyinMedia: async (awemeId, metadata, options) => {
          events.push(['prepareMedia', options.rootDir, metadata.title]);
          prepared = true;
          return {
            success: true,
            analysis_input: {
              aweme_id: awemeId,
              local_assets: {
                video: path.join(mediaRoot, awemeId, 'video.mp4'),
                frames: [],
              },
            },
            steps: {
              video: { status: 'done' },
            },
          };
        },
      },
    },
  });

  await createCreativeWorkflow({ input: '7345678901234567890' }, { rootDir, mediaRoot, services });

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);
  assert.deepEqual(events.slice(0, 4), [
    ['getStatus', mediaRoot],
    ['prepareMedia', mediaRoot, 'Cached title'],
    ['getStatus', mediaRoot],
    ['createRun'],
  ]);
}

async function testRepreparesWhenAnalysisInputDoesNotReferenceCurrentMedia() {
  const { rootDir, mediaRoot } = createTempDirs();
  const events = [];
  let prepared = false;
  const currentVideo = path.join(mediaRoot, '7345678901234567890', 'video.mp4');
  const { services } = createFakeServices({
    agentRuns: {
      createDouyinHyperframesFreeformRun: async () => {
        events.push(['createRun']);
        return prepared
          ? { success: true, status: 'done', run_id: 'run-1', message: 'created' }
          : { success: false, message: 'source not prepared' };
      },
    },
    services: {
      mediaPipeline: {
        getStatus: async (awemeId, options) => {
          events.push(['getStatus', options.rootDir]);
          if (prepared) {
            return {
              success: true,
              exists: true,
              metadata: {
                aweme_id: awemeId,
                title: 'Cached title',
                description: 'Cached description',
                aweme_url: `https://www.douyin.com/video/${awemeId}`,
                video_download_url: 'https://example.test/video.mp4',
              },
              analysis_input: {
                aweme_id: awemeId,
                local_assets: {
                  video: currentVideo,
                  frames: [],
                },
              },
              assets: {
                video: { path: currentVideo },
                frames_dir: { count: 0 },
              },
            };
          }
          return {
            success: true,
            exists: true,
            metadata: {
              aweme_id: awemeId,
              title: 'Cached title',
              description: 'Cached description',
              aweme_url: `https://www.douyin.com/video/${awemeId}`,
              video_download_url: 'https://example.test/video.mp4',
            },
            analysis_input: {
              aweme_id: awemeId,
              local_assets: {
                video: '',
                frames: [],
              },
            },
            assets: {
              video: { path: currentVideo },
              frames_dir: { count: 0 },
            },
          };
        },
        prepareDouyinMedia: async (awemeId, metadata, options) => {
          events.push(['prepareMedia', options.rootDir, metadata.title]);
          prepared = true;
          return {
            success: true,
            analysis_input: {
              aweme_id: awemeId,
              local_assets: {
                video: currentVideo,
                frames: [],
              },
            },
            steps: {
              video: { status: 'done' },
            },
          };
        },
      },
    },
  });

  await createCreativeWorkflow({ input: '7345678901234567890' }, { rootDir, mediaRoot, services });

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);
  assert.deepEqual(events.slice(0, 4), [
    ['getStatus', mediaRoot],
    ['prepareMedia', mediaRoot, 'Cached title'],
    ['getStatus', mediaRoot],
    ['createRun'],
  ]);
}

async function testRepreparesWhenAnalysisInputFramesAreStale() {
  const { rootDir, mediaRoot } = createTempDirs();
  const events = [];
  let prepared = false;
  const framesDir = path.join(mediaRoot, '7345678901234567890', 'frames');
  const currentFrame = path.join(framesDir, 'frame-0001.jpg');
  const staleFrame = path.join(mediaRoot, '7345678901234567890', 'old-frames', 'frame-0001.jpg');
  const { services } = createFakeServices({
    agentRuns: {
      createDouyinHyperframesFreeformRun: async () => {
        events.push(['createRun']);
        return prepared
          ? { success: true, status: 'done', run_id: 'run-1', message: 'created' }
          : { success: false, message: 'source not prepared' };
      },
    },
    services: {
      mediaPipeline: {
        getStatus: async (awemeId, options) => {
          events.push(['getStatus', options.rootDir]);
          return {
            success: true,
            exists: true,
            metadata: {
              aweme_id: awemeId,
              title: 'Cached title',
              description: 'Cached description',
              aweme_url: `https://www.douyin.com/video/${awemeId}`,
              video_download_url: 'https://example.test/video.mp4',
            },
            analysis_input: {
              aweme_id: awemeId,
              local_assets: {
                video: '',
                frames: prepared ? [currentFrame] : [staleFrame],
              },
            },
            frames: [{ path: currentFrame, name: 'frame-0001.jpg' }],
            assets: {
              video: null,
              frames_dir: { path: framesDir, count: 1 },
            },
          };
        },
        prepareDouyinMedia: async (awemeId, metadata, options) => {
          events.push(['prepareMedia', options.rootDir, metadata.title]);
          prepared = true;
          return {
            success: true,
            analysis_input: {
              aweme_id: awemeId,
              local_assets: {
                video: '',
                frames: [currentFrame],
              },
            },
            steps: {
              frames: { status: 'done' },
            },
          };
        },
      },
    },
  });

  await createCreativeWorkflow({ input: '7345678901234567890' }, { rootDir, mediaRoot, services });

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);
  assert.deepEqual(events.slice(0, 4), [
    ['getStatus', mediaRoot],
    ['prepareMedia', mediaRoot, 'Cached title'],
    ['getStatus', mediaRoot],
    ['createRun'],
  ]);
}

async function testDouyinLoginRequirementUsesChineseMessage() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      mediaPipeline: {
        getStatus: async () => ({ success: true, exists: false, metadata: null, analysis_input: null }),
        prepareDouyinMedia: async () => {
          throw new Error('prepare should not run');
        },
      },
      getVideoDetail: async () => ({
        success: true,
        needLogin: true,
        message: 'Login required',
      }),
    },
  });

  await createCreativeWorkflow({ input: '7345678901234567890' }, { rootDir, mediaRoot, services });

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, false);
  assert.equal(run.error.stage, 'source');
  assert.match(run.error.message, /登录抖音/);
  assert.doesNotMatch(run.error.message, /Login required/);
}

async function testPersistsFailureFromBriefStage() {
  const { rootDir, mediaRoot } = createTempDirs();
  const taskEvents = [];
  const { services } = createFakeServices({
    agentRuns: {
      generateDouyinRunHyperframesFreeformBrief: async () => ({
        success: false,
        message: '策划失败',
      }),
    },
  });

  await createCreativeWorkflow({ input: '做一期关于 AI 视频生产的知识科普' }, { rootDir, mediaRoot, services });
  const run = await runCreativeWorkflow(WORKFLOW_ID, {
    rootDir,
    mediaRoot,
    services,
    taskContext: {
      emit: async event => {
        taskEvents.push(event);
      },
    },
  });

  assert.equal(run.success, false);
  assert.equal(run.status, 'failed');
  const briefStage = run.stages.find(stage => stage.id === 'brief');
  assert.equal(briefStage.status, 'failed');
  assert.notEqual(briefStage.status, 'running');
  assert.equal(run.error.message, '策划失败');
  assert.equal(briefStage.message, '策划失败');

  const persisted = await getCreativeWorkflow(WORKFLOW_ID, { rootDir });
  assert.equal(persisted.data.status, 'failed');
  assert.equal(persisted.data.error.message, '策划失败');
  const failedEvent = taskEvents.find(event => event.type === 'stage_failed' && event.stage === 'brief');
  assert.equal(failedEvent.stage_progress, 100);
}

async function testTaskEventEmitFailureDoesNotFailWorkflow() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices();

  await createCreativeWorkflow({ input: '做一期关于 AI 视频生产的知识科普', useResearch: false }, { rootDir, mediaRoot, services });
  const run = await runCreativeWorkflow(WORKFLOW_ID, {
    rootDir,
    mediaRoot,
    services,
    taskContext: {
      emit: async () => {
        throw new Error('事件发送失败');
      },
    },
  });

  assert.equal(run.success, true);
  assert.equal(run.status, 'done');
}

async function testStopsWorkflowWhenDeletedDuringGeneration() {
  const { rootDir, mediaRoot } = createTempDirs();
  const filePath = getWorkflowPath(WORKFLOW_ID, rootDir);
  const { services, calls } = createFakeServices({
    agentRuns: {
      generateDouyinRunHyperframesFreeformBrief: async (awemeId, runId, options) => {
        calls.push({ name: 'briefDelete', awemeId, runId, options });
        fs.unlinkSync(filePath);
        return { success: true, status: 'done', message: '成片策划完成' };
      },
    },
  });

  await createCreativeWorkflow({ input: '做一期关于 AI 视频生产的知识科普' }, { rootDir, mediaRoot, services });
  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, false);
  assert.equal(run.status, 'deleted');
  assert.match(run.message, /已停止并删除/);
  assert.deepEqual(calls.map(call => call.name), ['createRun', 'briefDelete']);
  assert.equal(fs.existsSync(filePath), false);
}

async function testMarksStaleBriefStageAsFailedWhenFetched() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      now: () => '2026-06-12T12:20:00.000Z',
    },
  });

  await createCreativeWorkflow({ input: '做一期关于 AI 视频生产的知识科普' }, { rootDir, mediaRoot, services });
  const filePath = getWorkflowPath(WORKFLOW_ID, rootDir);
  const record = readJson(filePath);
  record.status = 'running';
  record.updated_at = '2026-06-12T12:00:00.000Z';
  record.run_id = 'run-1';
  record.stages = record.stages.map(stage => (
    stage.id === 'brief'
      ? {
        ...stage,
        status: 'running',
        message: '正在成片策划...',
        updated_at: '2026-06-12T12:00:00.000Z',
        started_at: '2026-06-12T12:00:00.000Z',
      }
      : stage
  ));
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');

  const fetched = await getCreativeWorkflow(WORKFLOW_ID, { rootDir, services });

  assert.equal(fetched.success, true);
  assert.equal(fetched.data.status, 'failed');
  assert.equal(fetched.data.error.stage, 'brief');
  assert.match(fetched.data.error.message, /长时间未更新/);
  assert.match(fetched.data.error.message, /可能已中断/);
  assert.equal(fetched.data.stages.find(stage => stage.id === 'brief').status, 'failed');

  const persisted = readJson(filePath);
  assert.equal(persisted.status, 'failed');
  assert.match(persisted.message, /长时间未更新/);
}

async function testDoesNotMarkRunningStageStaleWhenActiveTaskExists() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      now: () => '2026-06-12T12:20:00.000Z',
    },
  });

  await createCreativeWorkflow({ input: '做一期关于 AI 视频生产的知识科普' }, { rootDir, mediaRoot, services });
  const filePath = getWorkflowPath(WORKFLOW_ID, rootDir);
  const record = readJson(filePath);
  record.status = 'running';
  record.active_task_id = 'creative-task-running';
  record.stages = record.stages.map(stage => (
    stage.id === 'project'
      ? { ...stage, status: 'running', updated_at: '2026-06-12T12:00:00.000Z', started_at: '2026-06-12T12:00:00.000Z' }
      : stage
  ));
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');

  const fetched = await getCreativeWorkflow(WORKFLOW_ID, {
    rootDir,
    services,
    taskRegistry: {
      activeTaskForWorkflow: () => ({
        task_id: 'creative-task-running',
        workflow_id: WORKFLOW_ID,
        operation_id: 'workflow-op',
        kind: 'creative_workflow',
        status: 'running',
      }),
    },
  });

  assert.equal(fetched.success, true);
  assert.equal(fetched.data.status, 'running');
  assert.equal(fetched.data.stages.find(stage => stage.id === 'project').status, 'running');
}

async function testCustomRootDoesNotUseDefaultRegistryActiveTask() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      now: () => '2026-06-12T12:20:00.000Z',
    },
  });

  await createCreativeWorkflow({ input: '自定义 root 默认 registry 隔离测试' }, { rootDir, mediaRoot, services });
  const filePath = getWorkflowPath(WORKFLOW_ID, rootDir);
  const record = readJson(filePath);
  record.status = 'running';
  record.active_task_id = 'creative-task-default-registry-same-id';
  record.stages = record.stages.map(stage => (
    stage.id === 'project'
      ? { ...stage, status: 'running', updated_at: '2026-06-12T12:00:00.000Z', started_at: '2026-06-12T12:00:00.000Z' }
      : stage
  ));
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');

  const defaultTaskId = defaultRegistry.createDetachedTask({
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-default-registry-same-id',
    kind: 'creative_workflow',
  });

  try {
    const fetched = await getCreativeWorkflow(WORKFLOW_ID, {
      rootDir,
      services,
      staleStageTimeoutMs: 10 * 60 * 1000,
    });

    assert.equal(fetched.success, true);
    assert.equal(fetched.data.status, 'failed');
    assert.equal(fetched.data.stages.find(stage => stage.id === 'project').status, 'failed');
    assert.equal(fetched.data.active_task || null, null);
  } finally {
    defaultRegistry.markDeleted(defaultTaskId, '测试清理默认注册表任务。');
  }
}

async function testMissingWorkflowReturnsChineseMessage() {
  const { rootDir } = createTempDirs();

  const missing = await getCreativeWorkflow(WORKFLOW_ID, { rootDir });

  assert.equal(missing.success, false);
  assert.equal(missing.workflow_id, WORKFLOW_ID);
  assert.match(missing.message, /未找到创作任务/);
}

async function testSceneSpecOperations() {
  const {
    getCreativeWorkflowSceneSpec,
    getCreativeWorkflowVideoSpec,
    patchCreativeWorkflowSceneSpec,
    patchCreativeWorkflowVideoSpec,
    rewriteCreativeWorkflowScene,
    ttsCreativeWorkflowScene,
    rerenderCreativeWorkflow,
    remixCreativeWorkflow,
    getWorkflowPath,
  } = require('../server/services/creativeWorkflows');

  const { rootDir } = createTempDirs();

  const missingSceneSpec = await getCreativeWorkflowSceneSpec('99999999999999', { rootDir });
  assert.equal(missingSceneSpec.success, false);
  assert.match(missingSceneSpec.message, /未找到创作任务/);

  const fakeEditor = {
    applyEditCommand: (spec, edit) => ({
      success: true,
      scene_spec: { ...spec, title: 'edited' },
      edit_type: edit.type,
      requires_tts: false,
      requires_render: true,
    }),
    applyRewriteResult: (spec, sceneId, result) => ({
      success: true,
      scene_spec: { ...spec, title: 'rewritten' },
      requires_tts: true,
      requires_render: true,
    }),
  };

  const fakeRerender = {
    rerenderSceneSpecProject: async () => ({
      success: true,
      output_path: '/tmp/output.mp4',
      message: '渲染完成',
    }),
    rerenderSceneWithLocalTts: async () => ({
      success: true,
      output_path: '/tmp/output.mp4',
      message: '配音完成',
    }),
  };

  const workflowPath = getWorkflowPath(WORKFLOW_ID, rootDir);
  fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
  fs.writeFileSync(workflowPath, JSON.stringify({
    workflow_id: WORKFLOW_ID,
    status: 'done',
    result: {
      hyperframes_freeform: {
        project: {
          scene_spec: {
            title: '测试',
            scenes: [{ id: 'scene_01', duration: 5, narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: [] } }],
          },
          frame_specs: {
            frames: [{ id: 'frame_01_01', scene_id: 'scene_01', start: 0, duration: 5, template: 'hero_title' }],
          },
        },
        render: {
          output_path: '/tmp/old.mp4',
          render_versions: [{ id: 'render_001', status: 'rendered' }],
        },
      },
    },
  }));

  const gotSpec = await getCreativeWorkflowSceneSpec(WORKFLOW_ID, { rootDir });
  assert.equal(gotSpec.success, true);
  assert.equal(gotSpec.scene_spec.title, '测试');

  const gotVideoSpec = await getCreativeWorkflowVideoSpec(WORKFLOW_ID, { rootDir });
  assert.equal(gotVideoSpec.success, true);
  assert.equal(gotVideoSpec.scene_spec.title, '测试');
  assert.equal(gotVideoSpec.frame_specs.frames[0].id, 'frame_01_01');
  assert.equal(gotVideoSpec.render_versions[0].id, 'render_001');

  const patched = await patchCreativeWorkflowSceneSpec(WORKFLOW_ID, { type: 'caption_text', scene_id: 'scene_01', caption_id: 'cap1', text: '新字幕' }, { rootDir, creativeVideoEditor: fakeEditor });
  assert.equal(patched.success, true);
  assert.equal(patched.scene_spec.title, 'edited');
  assert.equal(patched.requires_render, true);

  const patchedVideoSpec = await patchCreativeWorkflowVideoSpec(WORKFLOW_ID, {
    scene_spec: { title: '视频规格编辑后', scenes: [{ id: 'scene_01', duration: 5, narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: [] } }] },
    frame_specs: { frames: [{ id: 'frame_01_01', scene_id: 'scene_01', start: 0, duration: 4, template: 'hero_title' }] },
  }, { rootDir });
  assert.equal(patchedVideoSpec.success, true);
  assert.equal(patchedVideoSpec.scene_spec.title, '视频规格编辑后');
  assert.equal(patchedVideoSpec.frame_specs.frames[0].duration, 4);
  assert.equal(patchedVideoSpec.requires_render, true);

  const rewritten = await rewriteCreativeWorkflowScene(WORKFLOW_ID, 'scene_01', { narration_text: '新旁白' }, { rootDir, creativeVideoEditor: fakeEditor });
  assert.equal(rewritten.success, true);
  assert.equal(rewritten.scene_spec.title, 'rewritten');
  assert.equal(rewritten.requires_tts, true);

  const rerendered = await rerenderCreativeWorkflow(WORKFLOW_ID, {}, { rootDir, creativeVideoRerender: fakeRerender });
  assert.equal(rerendered.success, true);
  assert.equal(rerendered.output_path, '/tmp/output.mp4');

  const ttsResult = await ttsCreativeWorkflowScene(WORKFLOW_ID, 'scene_01', {}, { rootDir, creativeVideoRerender: fakeRerender });
  assert.equal(ttsResult.success, true);
  assert.equal(ttsResult.scene_id, 'scene_01');
  assert.equal(ttsResult.output_path, '/tmp/output.mp4');

  const ttsMissingScene = await ttsCreativeWorkflowScene(WORKFLOW_ID, 'nonexistent', {}, { rootDir, creativeVideoRerender: fakeRerender });
  assert.equal(ttsMissingScene.success, false);
  assert.match(ttsMissingScene.message, /未找到场景/);

  const remixed = await remixCreativeWorkflow(WORKFLOW_ID, { input: '二创版本' }, {
    rootDir,
    mediaRoot: path.join(rootDir, 'media'),
    services: {
      now: () => NOW,
      idFactory: () => '202606121200000002',
      researchService: {
        createResearchContext: async () => ({ status: 'disabled', query: '', sources: [], summary: '', updated_at: NOW }),
      },
    },
  });
  assert.equal(remixed.success, true);
  assert.equal(remixed.source_workflow_id, WORKFLOW_ID);
  assert.equal(remixed.workflow_id, '202606121200000002');
  assert.equal(remixed.scene_spec.title, 'rewritten');
  assert.equal(remixed.frame_specs.frames[0].duration, 4);
}

async function run() {
  await testAppendWorkflowModelCall();
  await testRunResearchProviderAddsAuditMetadata();
  await testCreatesAndRunsTextWorkflow();
  await testCreatesAndRunsSourceUrlWorkflow();
  await testSourceUrlStageEmitsSpecificProgressMessages();
  await testSourceUrlEmptyMarkdownDoesNotEmitSuccessProgress();
  await testSuccessfulSourceUrlFetchDropsStaleMetadataAndDiagnostics();
  await testSourceUrlFailurePersistsFailedSourceContext();
  await testSourceUrlFetchExceptionPersistsFailedSourceContext();
  await testSourceUrlFetchFailureUsesDefaultChineseMessage();
  await testResearchRunsInBackgroundStage();
  await testHtmlVideoLiteCompletesVisibleFinalStages();
  await testCreativeDefaultsDisableAudioAndCaptionsInWorkflow();
  await testLegacyCreativeDefaultsSnapshotFallsBackToRealtimeMediaOptions();
  await testHtmlVideoExportUsesOrchestratorWithTemplateRegistry();
  await testFallbackProjectDoesNotSkipLegacyStages();
  await testRejectsEmptyInput();
  await testCreatesDouyinWorkflowWithOriginalAwemeId();
  await testPreparesDouyinSourceBeforeAgentRun();
  await testFailsDouyinSourceWhenPreparedMediaIsMissing();
  await testFailsDouyinSourceWhenPreparedPathDoesNotExist();
  await testRepreparesStaleDouyinAnalysisInputWithoutLocalMedia();
  await testRepreparesWhenAnalysisInputDoesNotReferenceCurrentMedia();
  await testRepreparesWhenAnalysisInputFramesAreStale();
  await testDouyinLoginRequirementUsesChineseMessage();
  await testPersistsFailureFromBriefStage();
  await testTaskEventEmitFailureDoesNotFailWorkflow();
  await testStopsWorkflowWhenDeletedDuringGeneration();
  await testMarksStaleBriefStageAsFailedWhenFetched();
  await testDoesNotMarkRunningStageStaleWhenActiveTaskExists();
  await testCustomRootDoesNotUseDefaultRegistryActiveTask();
  await testMissingWorkflowReturnsChineseMessage();
  await testSceneSpecOperations();
  console.log('creative workflow tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
