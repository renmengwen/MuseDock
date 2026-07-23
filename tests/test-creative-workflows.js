const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mediaPipeline = require('../server/services/mediaPipeline');
const researchService = require('../server/services/researchService');
const visualAssetUploads = require('../server/services/creative/visualAssetUploads');
const { Readable } = require('stream');
const { defaultRegistry } = require('../server/services/creative/creativeTaskRegistry');
const {
  STAGE_IDS,
  STAGE_LABELS,
  createCreativeWorkflow,
  runCreativeWorkflow,
  getCreativeWorkflow,
  getCreativeWorkflowHtmlVideoProject,
  getCreativeWorkflowAssetFile,
  getWorkflowPath,
  makeLocalCreativeAwemeId,
  exportHtmlVideoProject,
  appendWorkflowModelCall,
  runResearchProvider,
} = require('../server/services/creative/creativeWorkflows');
const { computeSceneSpecSpeechHash } = require('../server/services/creative-video/sceneSpecHash');

const NOW = '2026-06-12T12:00:00.000Z';
const WORKFLOW_ID = '202606121200000001';
const MINIMAL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

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
      const projectDir = path.join(options.rootDir || '', String(awemeId), 'agent_runs', `${runId}-html-video`);
      return {
        success: true,
        status: 'done',
        message: 'html-video 成片完成。',
        hyperframes_freeform: {
          status: 'ready',
          project_dir: projectDir,
          project: {
            status: 'ready',
            project_dir: projectDir,
            html_video_project_path: projectDir,
            render_mode: 'html-video',
            visual_plan: {
              beats: [{ id: 'beat_1' }, { id: 'beat_2' }, { id: 'beat_3' }],
              style_profile: { id: 'clean_education' },
            },
            frames: [
              { id: 'frame_1', source_mode: 'raw_html' },
              { id: 'frame_2', source_mode: 'raw_html' },
              { id: 'frame_3', source_mode: 'raw_html' },
            ],
            render_decisions: [
              { frame_id: 'frame_2', fallback_from: 'scene_html' },
              { frame_id: 'frame_3', fallback_reason: 'missing_asset' },
            ],
          },
          render: { status: 'rendered' },
          visual_inspect: { status: 'passed' },
        },
      };
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
          pexelsBackfillEnabled: true,
          useResearch: true,
          generateAudio: true,
          generateCaptions: true,
          sourceImageAnalysisEnabled: false,
          extractDouyinFrames: false,
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
  assert.equal(created.creative_context.continuity_mode, 'scene_html');
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
  assert.deepEqual(calls.map(call => call.name), ['createRun', 'brief', 'audio', 'project']);
  assert.equal(calls[1].options.briefOptions.creative_context.input.mode, 'text');
  assert.equal(calls[3].options.projectOptions.creative_context.asset_context.status, 'empty');
  assert.equal(calls[3].options.projectOptions.creative_context.continuity_mode, 'scene_html');
  assert.equal(calls[3].options.useHtmlVideoLiteWorkflow, true);
  assert.equal(calls[3].options.workflowId, WORKFLOW_ID);
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
  assert.deepEqual(fetched.data.result.hyperframes_freeform.project.visual_route_summary, {
    total_beats: 3,
    raw_html: 3,
    fallback: 2,
    style_profile_id: 'clean_education',
  });
}

async function testCreatesWorkflowWithClaimedUploadAndPreservesItThroughSourceStage() {
  const { rootDir, mediaRoot } = createTempDirs();
  const uploadRoot = path.join(rootDir, 'uploads');
  const staged = await visualAssetUploads.stageVisualAsset({
    stream: Readable.from(MINIMAL_PNG),
    fileName: '用户封面.png',
    mime: 'image/png',
    requirement: 'required',
    rootDir: uploadRoot,
  });
  const { services } = createFakeServices();

  const created = await createCreativeWorkflow({
    input: '用上传图片做一期本地 AI 视频',
    useResearch: false,
    assetIds: [staged.upload_id],
  }, { rootDir, mediaRoot, uploadRoot, services });

  assert.equal(created.success, true);
  assert.deepEqual(created.creative_context.input.asset_ids, [staged.upload_id]);
  assert.deepEqual(created.asset_context.assets.map(asset => asset.id), [staged.upload_id]);
  assert.equal(created.asset_context.assets[0].origin, 'user_upload');
  assert.equal(created.asset_context.assets[0].requirement, 'required');
  assert.equal(fs.existsSync(created.asset_context.assets[0].local_path), true);
  assert.equal(fs.existsSync(path.join(uploadRoot, staged.upload_id)), false);

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });
  assert.equal(run.success, true);
  assert.deepEqual(run.asset_context.assets.map(asset => asset.id), [staged.upload_id]);
  assert.equal(run.asset_context.assets[0].origin, 'user_upload');
}

async function testDouyinUploadUsesAwemeMediaDirectory() {
  const { rootDir, mediaRoot } = createTempDirs();
  const uploadRoot = path.join(rootDir, 'uploads');
  const awemeId = '7345678901234567890';
  const staged = await visualAssetUploads.stageVisualAsset({
    stream: Readable.from(MINIMAL_PNG),
    fileName: '抖音封面.png',
    mime: 'image/png',
    rootDir: uploadRoot,
  });
  const { services } = createFakeServices();

  const created = await createCreativeWorkflow({
    input: awemeId,
    useResearch: false,
    assetIds: [staged.upload_id],
  }, { rootDir, mediaRoot, uploadRoot, services });

  assert.equal(created.success, true);
  const expectedDir = mediaPipeline.getMediaDir(awemeId, mediaRoot);
  assert.equal(path.dirname(path.dirname(created.asset_context.assets[0].local_path)), expectedDir);
  const served = await getCreativeWorkflowAssetFile(WORKFLOW_ID, staged.upload_id, { rootDir, mediaRoot });
  assert.equal(served.success, true);
  assert.equal(served.file_path, created.asset_context.assets[0].local_path);
}

async function testPersistFailureReleasesClaimForReuse() {
  const { rootDir: parentDir, mediaRoot } = createTempDirs();
  const uploadRoot = path.join(parentDir, 'uploads');
  const invalidRoot = path.join(parentDir, 'workflow-root-is-file');
  fs.writeFileSync(invalidRoot, 'not a directory', 'utf8');
  const staged = await visualAssetUploads.stageVisualAsset({
    stream: Readable.from(MINIMAL_PNG),
    fileName: '可重试.png',
    mime: 'image/png',
    rootDir: uploadRoot,
  });
  const { services } = createFakeServices();

  await assert.rejects(() => createCreativeWorkflow({
    input: '持久化失败后可重试',
    assetIds: [staged.upload_id],
  }, { rootDir: invalidRoot, mediaRoot, uploadRoot, services }), /EEXIST|ENOTDIR|directory/);

  const manifest = readJson(path.join(uploadRoot, staged.upload_id, 'upload.json'));
  assert.equal(manifest.status, 'staged');
  assert.equal(manifest.workflow_id, undefined);
  assert.equal(fs.existsSync(path.join(mediaPipeline.getMediaDir(WORKFLOW_ID, mediaRoot), 'assets')), true);
  assert.deepEqual(fs.readdirSync(path.join(mediaPipeline.getMediaDir(WORKFLOW_ID, mediaRoot), 'assets')), []);

  const retryRoot = path.join(parentDir, 'retry-workflows');
  const retried = await createCreativeWorkflow({
    input: '持久化失败后可重试',
    assetIds: [staged.upload_id],
  }, { rootDir: retryRoot, mediaRoot, uploadRoot, services });
  assert.equal(retried.success, true);
}

async function testPersistFailureReportsReleaseFailureAndDeletesCopies() {
  const { rootDir: parentDir, mediaRoot } = createTempDirs();
  const uploadRoot = path.join(parentDir, 'uploads');
  const invalidRoot = path.join(parentDir, 'workflow-root-is-file-release-fails');
  fs.writeFileSync(invalidRoot, 'not a directory', 'utf8');
  const staged = await visualAssetUploads.stageVisualAsset({
    stream: Readable.from(MINIMAL_PNG),
    fileName: '释放失败.png',
    mime: 'image/png',
    rootDir: uploadRoot,
  });
  const base = createFakeServices().services;
  const services = {
    ...base,
    visualAssetUploads: {
      ...visualAssetUploads,
      releaseClaimedVisualAssets: async () => { throw new Error('release injected failure'); },
    },
  };

  await assert.rejects(() => createCreativeWorkflow({
    input: '持久化和释放都失败',
    assetIds: [staged.upload_id],
  }, { rootDir: invalidRoot, mediaRoot, uploadRoot, services }), /释放上传素材失败.*release injected failure/);

  const assetsDir = path.join(mediaPipeline.getMediaDir(WORKFLOW_ID, mediaRoot), 'assets');
  assert.equal(fs.existsSync(assetsDir), true);
  assert.deepEqual(fs.readdirSync(assetsDir), []);
}

async function testFinalizeFailurePersistsWarningDiagnostic() {
  const { rootDir, mediaRoot } = createTempDirs();
  const uploadRoot = path.join(rootDir, 'uploads');
  const staged = await visualAssetUploads.stageVisualAsset({
    stream: Readable.from(MINIMAL_PNG),
    fileName: '清理失败.png',
    mime: 'image/png',
    rootDir: uploadRoot,
  });
  const base = createFakeServices().services;
  const services = {
    ...base,
    visualAssetUploads: {
      ...visualAssetUploads,
      finalizeClaimedVisualAssets: async () => { throw new Error('finalize injected failure'); },
    },
  };

  const created = await createCreativeWorkflow({
    input: '成功持久化但暂存清理失败',
    assetIds: [staged.upload_id],
  }, { rootDir, mediaRoot, uploadRoot, services });

  assert.equal(created.success, true);
  const warning = created.asset_context.diagnostics.find(item => item.code === 'upload_finalize_failed');
  assert.equal(warning.severity, 'warning');
  assert.match(warning.message, /暂存清理失败.*finalize injected failure/);
  const persisted = readJson(getWorkflowPath(WORKFLOW_ID, rootDir));
  assert.equal(persisted.asset_context.diagnostics.some(item => item.code === 'upload_finalize_failed'), true);
  assert.equal(persisted.creative_context.asset_context.diagnostics.some(item => item.code === 'upload_finalize_failed'), true);
  assert.equal(fs.existsSync(path.join(uploadRoot, staged.upload_id)), true);
}

async function testCreatesAndRunsSourceUrlWorkflow() {
  const { rootDir, mediaRoot } = createTempDirs();
  const repoUrl = 'https://github.com/owner/repo';
  const pexelsApiKey = 'pexels-from-settings';
  const { services } = createFakeServices({
    services: {
      now: () => '2026-06-21T00:00:00.000Z',
      appSettings: {
        getCreativeDefaults: async () => ({
          aspectRatio: '9:16',
          targetDurationSec: 60,
          pexelsBackfillEnabled: true,
          useResearch: true,
          generateAudio: true,
          generateCaptions: true,
          sourceImageAnalysisEnabled: false,
          extractDouyinFrames: false,
        }),
        getEffectiveSystemSettings: async () => ({ skipValidation: false, pexelsApiKey }),
        getPexelsApiKey: async () => pexelsApiKey,
      },
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
        prepareSourceAssets: async ({ sourceMaterial, now, deps }) => {
          assert.equal(deps.pexelsApiKey, pexelsApiKey);
          assert.equal(deps.pexelsBackfillEnabled, true);
          return {
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
          };
        },
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
  const uploadedPath = path.join(mediaRoot, 'fake-upload-image.png');
  fs.mkdirSync(mediaRoot, { recursive: true });
  fs.writeFileSync(uploadedPath, 'upload-image', 'utf8');
  const uploadedAssetContext = {
    status: 'ready',
    assets: [{
      id: 'upload_01',
      source: 'upload',
      origin: 'user_upload',
      origin_detail: 'creative_input',
      provider: 'local',
      requirement: 'preferred',
      evidence_class: 'user_supplied',
      status: 'ready',
      path: 'assets/upload-image.png',
      local_path: uploadedPath,
    }],
  };
  staleWorkflow.asset_context = { status: 'ready', assets: [] };
  staleWorkflow.creative_context.asset_context = uploadedAssetContext;
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
  assert.equal(run.asset_context.image_analysis.status, 'disabled');
  assert.equal(run.asset_context.assets[0].image_analysis.status, 'disabled');
  assert.deepEqual(
    run.asset_context.assets.map(asset => asset.id).filter(id => ['upload_01', 'article_01'].includes(id)),
    ['upload_01', 'article_01'],
  );
  assert.equal(run.asset_context.assets.find(asset => asset.id === 'upload_01').requirement, 'preferred');
  assert.equal(analysisInput.creative_context.asset_context.image_analysis.status, 'disabled');
  assert.equal(analysisInput.creative_context.asset_context.assets.find(asset => asset.id === 'article_01').image_analysis.status, 'disabled');
  assert.equal(analysisInput.creative_context.asset_context.assets.find(asset => asset.id === 'article_01').path, 'assets/source-image-01.png');
  assert.deepEqual(analysisInput.local_assets.images, [uploadedPath, path.join(mediaRoot, 'fake-source-image-01.png')]);
  assert.equal(analysisInput.video.aweme_url, '');
}

async function testSourceUrlWorkflowRunsSourceImageAnalysisWhenEnabled() {
  const { rootDir, mediaRoot } = createTempDirs();
  const repoUrl = 'https://github.com/owner/repo';
  const { services } = createFakeServices({
    services: {
      aiModelConfig: {
        getRuntimeConfig: async type => (type === 'text'
          ? { enabled: true, provider: 'mock', apiKey: 'sk-test', baseUrl: 'https://example.com/v1', modelId: 'mock-vision', supportsMultimodal: true }
          : null),
      },
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
      sourceImageAnalysis: {
        analyzeSourceImageAssets: async ({ enabled, assets, runtime }) => {
          assert.equal(enabled, true);
          assert.equal(runtime.modelId, 'mock-vision');
          return {
            status: 'ready',
            summary: '已完成 1 张来源图片多模态分析。',
            assets: assets.map(asset => ({
              ...asset,
              image_analysis: {
                status: 'ready',
                visual_type: 'architecture_diagram',
                summary: '展示系统模块关系',
                best_usage: '用于模块关系讲解',
                should_use: true,
              },
            })),
          };
        },
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: `做成项目解读视频 ${repoUrl}`,
    useResearch: false,
    assetIds: [],
    creativeDefaultsOverride: {
      sourceImageAnalysisEnabled: true,
    },
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);

  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });
  const mediaPaths = mediaPipeline.getMediaPaths(created.aweme_id, mediaRoot);
  const analysisInput = readJson(mediaPaths.analysisInput);

  assert.equal(run.success, true);
  assert.equal(run.asset_context.image_analysis.status, 'ready');
  assert.equal(run.asset_context.assets[0].image_analysis.status, 'ready');
  assert.equal(analysisInput.creative_context.asset_context.image_analysis.status, 'ready');
  assert.equal(analysisInput.creative_context.asset_context.assets[0].image_analysis.status, 'ready');
  assert.equal(analysisInput.creative_context.asset_context.assets[0].image_analysis.visual_type, 'architecture_diagram');
  assert.deepEqual(analysisInput.local_assets.images, [path.join(mediaRoot, 'fake-source-image-01.png')]);
}

async function testRejectsSourceImageAnalysisWithoutMultimodalTextModel() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      aiModelConfig: {
        getRuntimeConfig: async type => (type === 'text'
          ? { enabled: true, provider: 'mock', modelId: 'mock-text', supportsMultimodal: false }
          : null),
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: '做成项目解读视频 https://github.com/owner/repo',
    creativeDefaultsOverride: {
      sourceImageAnalysisEnabled: true,
    },
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, false);
  assert.match(created.message, /多模态|来源图片/);
}

async function testRejectsSourceImageAnalysisWithDisabledTextModel() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      aiModelConfig: {
        getRuntimeConfig: async type => (type === 'text'
          ? { enabled: false, provider: 'mock', modelId: 'mock-vision', supportsMultimodal: true }
          : null),
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: '做成项目解读视频 https://github.com/owner/repo',
    creativeDefaultsOverride: {
      sourceImageAnalysisEnabled: true,
    },
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, false);
  assert.match(created.message, /未配置可用的分析模型|来源图片/);
}

async function testRejectsSourceImageAnalysisWithIncompleteTextModel() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      aiModelConfig: {
        getRuntimeConfig: async type => (type === 'text'
          ? { enabled: true, provider: 'mock', modelId: 'mock-vision', supportsMultimodal: true }
          : null),
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: '做成项目解读视频 https://github.com/owner/repo',
    creativeDefaultsOverride: {
      sourceImageAnalysisEnabled: true,
    },
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, false);
  assert.match(created.message, /未配置可用的分析模型|来源图片/);
}

async function testTextWorkflowDoesNotRequireSourceImageAnalysisModel() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices();

  const created = await createCreativeWorkflow({
    input: '纯文本创作不需要来源图片分析模型',
    creativeDefaultsOverride: {
      sourceImageAnalysisEnabled: true,
    },
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);
  assert.equal(created.creative_context.input.mode, 'text');
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

async function testRunWorkflowPersistsResearchModelCalls() {
  const { rootDir, mediaRoot } = createTempDirs();
  const modelRequests = [];
  const { services } = createFakeServices({
    services: {
      researchService,
      aiModelConfig: { getRuntimeConfig: async () => ({ modelId: 'gpt-test' }) },
      aiTextModel: {
        callTextModel: async request => {
          modelRequests.push(request);
          return {
            success: true,
            text: '研究摘要 https://example.com/report',
            raw_response: {},
            model: { provider: 'OpenAI', model_id: 'gpt-test' },
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cached_tokens: 0 },
          };
        },
      },
      webSearchProvider: async () => ({
        results: [{ title: '研究报告', url: 'https://example.com/report', summary: 'AI 视频生产资料。' }],
      }),
    },
  });

  const created = await createCreativeWorkflow({
    input: '做一期关于 AI 视频生产的知识科普',
    useResearch: true,
    assetIds: [],
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);
  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });
  assert.equal(run.success, true);

  const saved = readJson(getWorkflowPath(WORKFLOW_ID, rootDir));
  assert.equal(modelRequests.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(modelRequests[0], 'audit'), false);
  assert.ok(saved.model_calls.some(call => (
    call.agent === 'ResearchAgent'
    && call.stage === 'research'
    && call.sub_stage === 'web_search_summary'
    && call.model.model_id === 'gpt-test'
    && call.usage.cached_tokens === 0
  )));
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

async function testHtmlVideoExportUsesOrchestrator() {
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
    output: { fps: 24 },
    frames: [
      {
        id: 'frame_01',
        scene_id: 'scene_01',
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

async function testHtmlVideoExportRestoresMissingNarrationReference() {
  const { rootDir, mediaRoot } = createTempDirs();
  const workflowPath = getWorkflowPath(WORKFLOW_ID, rootDir);
  const runId = 'run-1';
  const projectDir = path.join(mediaRoot, '12345', 'agent_runs', `${runId}-html-video`);
  const narrationPath = path.join(mediaRoot, '12345', 'agent_runs', `${runId}-tts.wav`);
  const sceneSpec = {
    scenes: [
      { id: 'scene_01', order: 1, narration_text: '第一段旁白。', captions: [{ text: '第一段旁白。' }] },
      { id: 'scene_02', order: 2, narration_text: '第二段旁白。', captions: [{ text: '第二段旁白。' }] },
    ],
  };
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
  fs.writeFileSync(narrationPath, 'fake narration', 'utf-8');
  fs.writeFileSync(path.join(projectDir, 'scene-spec.json'), JSON.stringify(sceneSpec, null, 2), 'utf-8');
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
    run_id: runId,
    output: { fps: 24 },
    frames: [],
    timeline: { tracks: [] },
    audio: {
      narration_path: null,
      tts_manifest_path: null,
    },
  }, null, 2), 'utf-8');

  let projectSeen = null;
  const result = await exportHtmlVideoProject(WORKFLOW_ID, {}, {
    rootDir,
    htmlVideoProjectOrchestrator: {
      exportHtmlVideoProject: async options => {
        projectSeen = options.project;
        return {
          success: true,
          message: '导出完成。',
          html_video_project_path: projectDir,
          output_path: path.join(projectDir, 'exports', 'output-audio.mp4'),
          project: {
            ...options.project,
            exports: [{ id: 'export_0001', path: 'exports/output-audio.mp4' }],
          },
          diagnostics: [],
        };
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(projectSeen.audio.narration_path, narrationPath);
  assert.equal(projectSeen.audio.status, 'ready');
  assert.equal(projectSeen.audio.source, 'scene_spec');
  assert.equal(projectSeen.audio.scene_spec_hash, computeSceneSpecSpeechHash(sceneSpec));
  assert.deepEqual(projectSeen.audio.scene_ids, ['scene_01', 'scene_02']);
}

async function testNonHtmlVideoProjectResultFails() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services, calls } = createFakeServices({
    agentRuns: {
      generateDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
        calls.push({ name: 'project', awemeId, runId, options });
        return {
          success: true,
          status: 'done',
          message: '非 html-video 工程不应继续。',
          hyperframes_freeform: {
            status: 'ready',
            project: {
              status: 'ready',
              render_mode: 'legacy',
            },
          },
        };
      },
    },
  });

  await createCreativeWorkflow({ input: '做一个 fallback 测试', useResearch: false, assetIds: [] }, { rootDir, mediaRoot, services });
  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, false);
  assert.match(run.message, /html-video production 未返回可用工程/);
  assert.deepEqual(calls.map(call => call.name), ['createRun', 'brief', 'audio', 'project']);
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

async function testCreatesDouyinWorkflowFromShareTextShortLink() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      fetchImpl: async url => {
        assert.equal(url, 'https://v.douyin.com/mAshaRrok1Y/');
        return {
          status: 302,
          headers: {
            get: name => name.toLowerCase() === 'location'
              ? 'https://www.iesdouyin.com/share/video/7646434824751828239/?from=web_code_link'
              : '',
          },
        };
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: '6.97 :2pm aAG:/ 05/29 B@t.rr 一期视频带你彻底上手飞书CLI! https://v.douyin.com/mAshaRrok1Y/ 复制此链接，打开Dou音搜索，直接观看视频！',
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);
  assert.equal(created.aweme_id, '7646434824751828239');
  assert.equal(created.creative_context.input.mode, 'douyin');
  assert.equal(created.creative_context.input.douyin_url, 'https://www.iesdouyin.com/share/video/7646434824751828239/?from=web_code_link');
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
          events.push(['prepareMedia', awemeId, options.rootDir, metadata.aweme_id, options.extractFrames]);
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
      sourceAssets: {
        prepareSourceAssets: async ({ sourceMaterial, deps }) => {
          events.push(['sourceAssets', sourceMaterial.kind, sourceMaterial.title, deps.pexelsApiKey || '']);
          return {
            status: 'ready',
            summary: '已准备 1 张图片素材。',
            diagnostics: [],
            assets: [{
              id: 'search_01',
              type: 'image',
              source: 'search',
              url: 'https://images.pexels.test/tesla.jpg',
              path: 'assets/search-image-01.jpg',
              local_path: path.join(mediaRoot, 'search-image-01.jpg'),
              alt: sourceMaterial.title,
              mime: 'image/jpeg',
            }],
          };
        },
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
    ['prepareMedia', '7345678901234567890', mediaRoot, '7345678901234567890', false],
    ['getStatus', '7345678901234567890', mediaRoot],
    ['sourceAssets', 'douyin_video', 'Douyin source title', ''],
  ]);
  assert.deepEqual(events[5], ['createRun', '7345678901234567890', mediaRoot]);
  assert.equal(run.creative_context.source_context.status, 'ready');
  assert.equal(run.creative_context.source_context.summary, 'Douyin source title');
  assert.equal(run.creative_context.source_context.douyin_metadata.title, 'Douyin source title');
  assert.equal(run.asset_context.assets[0].source, 'search');
}

async function testDouyinSourceFetchesCommentsAndRunsAsrBeforeAgentRun() {
  const { rootDir, mediaRoot } = createTempDirs();
  const events = [];
  const awemeId = '7345678901234567890';
  let prepared = false;
  let metadata = null;

  function writeAnalysisInput() {
    const paths = mediaPipeline.getMediaPaths(awemeId, mediaRoot);
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.video, 'video', 'utf8');
    const analysisInput = {
      aweme_id: awemeId,
      video: {
        title: metadata.title,
        description: metadata.description,
        statistics: metadata.statistics || {},
        aweme_url: metadata.aweme_url,
      },
      local_assets: {
        dir: paths.dir,
        metadata: paths.metadata,
        video: paths.video,
        audio: paths.audio,
        frames: [],
      },
      comments_summary: { status: 'placeholder', message: 'Comment analysis is not connected yet.' },
      transcript: { status: 'not_requested', path: '' },
      steps: {
        metadata: { status: 'done' },
        video: { status: 'done', path: paths.video },
        transcript: { status: 'not_requested' },
      },
      updated_at: NOW,
    };
    fs.writeFileSync(paths.analysisInput, JSON.stringify(analysisInput, null, 2), 'utf8');
    return analysisInput;
  }

  const { services } = createFakeServices({
    services: {
      mediaPipeline: {
        getStatus: async () => {
          events.push(['getStatus']);
          if (!prepared) return { success: true, exists: false, metadata: null, analysis_input: null };
          const paths = mediaPipeline.getMediaPaths(awemeId, mediaRoot);
          return {
            success: true,
            exists: true,
            metadata,
            analysis_input: readJson(paths.analysisInput),
          };
        },
        prepareDouyinMedia: async () => {
          events.push(['prepareMedia']);
          prepared = true;
          const analysisInput = writeAnalysisInput();
          return {
            success: true,
            analysis_input: analysisInput,
            steps: analysisInput.steps,
          };
        },
        transcribeAudio: async () => {
          events.push(['transcribe']);
          const paths = mediaPipeline.getMediaPaths(awemeId, mediaRoot);
          fs.writeFileSync(paths.transcript, JSON.stringify({
            success: true,
            status: 'done',
            text: '这是一段 ASR 转写文本。',
            message: 'ASR 完成。',
          }, null, 2), 'utf8');
          const analysisInput = readJson(paths.analysisInput);
          analysisInput.transcript = { status: 'done', path: paths.transcript, message: 'ASR 完成。' };
          analysisInput.steps.transcript = analysisInput.transcript;
          fs.writeFileSync(paths.analysisInput, JSON.stringify(analysisInput, null, 2), 'utf8');
          return { success: true, status: 'done', text: '这是一段 ASR 转写文本。', message: 'ASR 完成。' };
        },
      },
      getVideoDetail: async () => {
        events.push(['getVideoDetail']);
        metadata = {
          aweme_id: awemeId,
          title: '带评论的抖音视频',
          description: '需要自动抓评论和 ASR',
          aweme_url: `https://www.douyin.com/video/${awemeId}`,
          video_download_url: 'https://example.test/video.mp4',
          statistics: { comment_count: 12 },
        };
        return { success: true, data: metadata };
      },
      getLocalDouyinComments: async () => {
        events.push(['getLocalComments']);
        return { success: true, count: 0, data: [] };
      },
      getComments: async () => {
        events.push(['getComments']);
        return {
          success: true,
          count: 1,
          data: [{ comment_id: 'c1', content: '想看后续', like_count: 3, replies: [] }],
        };
      },
      saveDouyinComments: () => {
        events.push(['saveComments']);
        return { saved: 1 };
      },
    },
  });

  await createCreativeWorkflow({ input: `https://www.douyin.com/video/${awemeId}` }, { rootDir, mediaRoot, services });
  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);
  assert.deepEqual(events.slice(0, 7), [
    ['getStatus'],
    ['getVideoDetail'],
    ['prepareMedia'],
    ['getStatus'],
    ['getLocalComments'],
    ['getComments'],
    ['saveComments'],
  ]);
  assert.equal(events[7][0], 'transcribe');
  assert.equal(run.creative_context.source_context.diagnostics.comments.status, 'done');
  assert.equal(run.creative_context.source_context.diagnostics.transcript.status, 'done');

  const analysisInput = readJson(mediaPipeline.getMediaPaths(awemeId, mediaRoot).analysisInput);
  assert.equal(analysisInput.comments_summary.status, 'done');
  assert.equal(analysisInput.comments_summary.count, 1);
  assert.equal(analysisInput.transcript.status, 'done');
}

async function testDouyinSourceContinuesWhenCommentSaveAndAsrFail() {
  const { rootDir, mediaRoot } = createTempDirs();
  const events = [];
  const awemeId = '7345678901234567890';
  const paths = mediaPipeline.getMediaPaths(awemeId, mediaRoot);
  const metadata = {
    aweme_id: awemeId,
    title: '可降级抖音视频',
    description: '评论缓存和 ASR 失败也应继续成片',
    aweme_url: `https://www.douyin.com/video/${awemeId}`,
    video_download_url: 'https://example.test/video.mp4',
  };
  let prepared = false;

  function writeAnalysisInput() {
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.video, 'video', 'utf8');
    const analysisInput = {
      aweme_id: awemeId,
      video: { title: metadata.title, description: metadata.description, aweme_url: metadata.aweme_url },
      local_assets: { dir: paths.dir, metadata: paths.metadata, video: paths.video, audio: paths.audio, frames: [] },
      comments_summary: { status: 'placeholder', message: 'Comment analysis is not connected yet.' },
      transcript: { status: 'not_requested', path: '' },
      steps: { video: { status: 'done', path: paths.video }, transcript: { status: 'not_requested' } },
      updated_at: NOW,
    };
    fs.writeFileSync(paths.analysisInput, JSON.stringify(analysisInput, null, 2), 'utf8');
    return analysisInput;
  }

  const { services } = createFakeServices({
    services: {
      mediaPipeline: {
        getStatus: async () => {
          events.push(['getStatus']);
          if (!prepared) return { success: true, exists: false, metadata: null, analysis_input: null };
          return { success: true, exists: true, metadata, analysis_input: readJson(paths.analysisInput) };
        },
        prepareDouyinMedia: async () => {
          events.push(['prepareMedia']);
          prepared = true;
          const analysisInput = writeAnalysisInput();
          return { success: true, analysis_input: analysisInput, steps: analysisInput.steps };
        },
        transcribeAudio: async () => {
          events.push(['transcribe']);
          throw new Error('ASR provider timeout');
        },
      },
      getVideoDetail: async () => {
        events.push(['getVideoDetail']);
        return { success: true, data: metadata };
      },
      getLocalDouyinComments: async () => {
        events.push(['getLocalComments']);
        return { success: true, count: 0, data: [] };
      },
      getComments: async () => {
        events.push(['getComments']);
        return { success: true, count: 1, data: [{ comment_id: 'c1', content: '先缓存评论', replies: [] }] };
      },
      saveDouyinComments: async () => {
        events.push(['saveComments']);
        await new Promise(resolve => setTimeout(resolve, 5));
        throw new Error('db busy');
      },
    },
  });

  await createCreativeWorkflow({ input: `https://www.douyin.com/video/${awemeId}` }, { rootDir, mediaRoot, services });
  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);
  assert.deepEqual(events.slice(0, 8), [
    ['getStatus'],
    ['getVideoDetail'],
    ['prepareMedia'],
    ['getStatus'],
    ['getLocalComments'],
    ['getComments'],
    ['saveComments'],
    ['transcribe'],
  ]);
  assert.equal(run.creative_context.source_context.diagnostics.comments.status, 'failed');
  assert.match(run.creative_context.source_context.diagnostics.comments.message, /db busy/);
  assert.equal(run.creative_context.source_context.diagnostics.transcript.status, 'failed');
  assert.match(run.creative_context.source_context.diagnostics.transcript.message, /ASR provider timeout/);

  const analysisInput = readJson(paths.analysisInput);
  assert.equal(analysisInput.comments_summary.status, 'failed');
  assert.equal(analysisInput.steps.transcript.status, 'failed');
  assert.match(analysisInput.steps.transcript.message, /ASR provider timeout/);
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

async function testGetWorkflowHydratesAssetUsageReportFromProject() {
  const { rootDir, mediaRoot } = createTempDirs();
  const workflowId = WORKFLOW_ID;
  const projectDir = path.join(mediaRoot, workflowId, 'agent_runs', 'html-video-project');
  fs.mkdirSync(path.join(projectDir, 'frames'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'frames', '01.html'),
    '<!doctype html><html><body><img src="../assets/source-image-01.png"></body></html>',
    'utf8',
  );
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    workflow_id: workflowId,
    frames: [{ id: 'scene_01', scene_id: 'scene_01', html_path: 'frames/01.html' }],
    assets: [{ id: 'article_01', path: 'assets/source-image-01.png' }],
  }, null, 2), 'utf8');
  const assetContext = {
    status: 'ready',
    assets: [{ id: 'article_01', type: 'image', source: 'article', path: 'assets/source-image-01.png' }],
  };
  fs.writeFileSync(getWorkflowPath(workflowId, rootDir), JSON.stringify({
    success: true,
    workflow_id: workflowId,
    aweme_id: workflowId,
    status: 'done',
    message: 'done',
    stages: [],
    asset_context: assetContext,
    creative_context: { asset_context: assetContext },
    result: {
      hyperframes_freeform: {
        project: {
          render_mode: 'html-video',
          html_video_project_path: projectDir,
          project_dir: projectDir,
        },
        render: { status: 'rendered', output_path: '' },
      },
    },
  }, null, 2), 'utf8');

  const fetched = await getCreativeWorkflow(workflowId, {
    rootDir,
    mediaRoot,
    services: { now: () => NOW },
  });
  assert.equal(fetched.success, true);
  assert.equal(fetched.data.asset_context.asset_usage_report.used_asset_ids[0], 'article_01');
  assert.equal(fetched.data.result.hyperframes_freeform.project.asset_usage_report.used_asset_ids[0], 'article_01');
  const persisted = readJson(getWorkflowPath(workflowId, rootDir));
  assert.equal(persisted.asset_context.asset_usage_report.used_asset_ids[0], 'article_01');
}

async function testGetWorkflowHydratesGeneratedProjectAssets() {
  const { rootDir, mediaRoot } = createTempDirs();
  const workflowId = WORKFLOW_ID;
  const projectDir = path.join(mediaRoot, workflowId, 'agent_runs', 'html-video-project-generated');
  fs.mkdirSync(path.join(projectDir, 'frames'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'frames', '01.html'),
    '<!doctype html><html><body><img src="../assets/generated-image-01.jpg"></body></html>',
    'utf8',
  );
  const projectPath = path.join(projectDir, 'project.json');
  const verifiedProjectFocus = id => ({
    id,
    label: '项目已验证焦点',
    aliases: ['verified'],
    region: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
    method: 'manual',
    confidence_level: 'high',
    verification: { status: 'verified', method: 'user_review', evidence: 'project canonical' },
  });
  fs.writeFileSync(projectPath, JSON.stringify({
    workflow_id: workflowId,
    frames: [{ id: 'scene_01', scene_id: 'scene_01', html_path: 'frames/01.html' }],
    assets: [
      { id: 'gen_scene_01', source: 'generated', path: 'assets/generated-image-01.jpg', generation: { scene_id: 'scene_01' } },
      {
        id: 'search_01',
        source: 'search',
        path: 'assets/search-image-01.webp',
        focus_regions: [{
          id: 'project_region',
          label: '项目焦点',
          aliases: [' focus ', 'FOCUS'],
          region: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
          method: 'vision',
          confidence_level: 'high',
          verification: { status: 'candidate', method: 'model', evidence: '项目 canonical' },
          trust_level: 'A',
        }],
      },
      {
        id: 'source_conflict_01',
        source: 'generated',
        path: 'assets/project-source-conflict.png',
        focus_regions: [verifiedProjectFocus('project_source_conflict_region')],
      },
      {
        id: 'path_conflict_01',
        source: 'search',
        path: 'assets/project-path-conflict.png',
        focus_regions: [verifiedProjectFocus('project_path_conflict_region')],
      },
    ],
  }, null, 2), 'utf8');
  const assetContext = {
    status: 'ready',
    assets: [{
      id: 'search_01',
      type: 'image',
      source: 'search',
      path: 'assets/search-image-01.webp',
      focus_regions: [{
        id: 'stale_region',
        label: '陈旧焦点',
        aliases: [],
        region: { x: 0, y: 0, width: 0.2, height: 0.2 },
        method: 'vision',
        verification: { status: 'candidate', method: 'model', evidence: 'workflow stale' },
      }],
    }, {
      id: 'source_conflict_01',
      type: 'image',
      source: 'upload',
      path: 'assets/workflow-source-conflict.png',
      focus_regions: [{
        id: 'workflow_source_region',
        label: 'Workflow 原焦点',
        aliases: [],
        region: { x: 0, y: 0, width: 0.2, height: 0.2 },
        method: 'vision',
        verification: { status: 'candidate', method: 'model', evidence: 'workflow canonical' },
      }],
    }, {
      id: 'path_conflict_01',
      type: 'image',
      source: 'search',
      path: 'assets/workflow-path-conflict.png',
    }],
  };
  fs.writeFileSync(getWorkflowPath(workflowId, rootDir), JSON.stringify({
    success: true,
    workflow_id: workflowId,
    aweme_id: workflowId,
    status: 'done',
    message: 'done',
    stages: [],
    asset_context: assetContext,
    creative_context: { asset_context: assetContext },
    result: {
      hyperframes_freeform: {
        project: {
          render_mode: 'html-video',
          html_video_project_path: projectDir,
          project_dir: projectDir,
        },
        render: { status: 'rendered', output_path: '' },
      },
    },
  }, null, 2), 'utf8');

  const fetched = await getCreativeWorkflow(workflowId, {
    rootDir,
    mediaRoot,
    services: { now: () => NOW },
  });
  assert.equal(fetched.success, true);
  assert.deepEqual(
    fetched.data.asset_context.assets.map(asset => asset.id),
    ['search_01', 'source_conflict_01', 'path_conflict_01', 'gen_scene_01'],
  );
  assert.equal(fetched.data.asset_context.assets.find(asset => asset.id === 'gen_scene_01').source, 'generated');
  assert.equal(fetched.data.asset_context.assets.find(asset => asset.id === 'search_01').focus_regions[0].id, 'project_region');
  assert.equal(fetched.data.asset_context.assets.find(asset => asset.id === 'search_01').focus_regions[0].trust_level, 'C');
  assert.equal(fetched.data.asset_context.assets.find(asset => asset.id === 'source_conflict_01').focus_regions[0].id, 'workflow_source_region');
  assert.equal(fetched.data.asset_context.assets.find(asset => asset.id === 'source_conflict_01').source, 'upload');
  assert.equal(fetched.data.asset_context.assets.find(asset => asset.id === 'source_conflict_01').path, 'assets/workflow-source-conflict.png');
  assert.equal(Object.prototype.hasOwnProperty.call(
    fetched.data.asset_context.assets.find(asset => asset.id === 'path_conflict_01'),
    'focus_regions',
  ), false);
  assert.equal(fetched.data.asset_context.asset_usage_report.used_asset_ids[0], 'gen_scene_01');
  assert.equal(fetched.data.result.hyperframes_freeform.project.asset_usage_report.used_asset_ids[0], 'gen_scene_01');
  const persisted = readJson(getWorkflowPath(workflowId, rootDir));
  assert.equal(persisted.creative_context.asset_context.assets.find(asset => asset.id === 'gen_scene_01').source, 'generated');
  assert.equal(persisted.creative_context.asset_context.assets.find(asset => asset.id === 'search_01').focus_regions[0].id, 'project_region');
  assert.equal(persisted.asset_context.asset_usage_report.used_asset_ids[0], 'gen_scene_01');
  assert.equal(persisted.asset_context.assets.find(asset => asset.id === 'source_conflict_01').focus_regions[0].id, 'workflow_source_region');
  assert.equal(persisted.creative_context.asset_context.assets.find(asset => asset.id === 'source_conflict_01').focus_regions[0].id, 'workflow_source_region');
  assert.equal(Object.prototype.hasOwnProperty.call(
    persisted.asset_context.assets.find(asset => asset.id === 'path_conflict_01'),
    'focus_regions',
  ), false);
  assert.equal(Object.prototype.hasOwnProperty.call(
    persisted.creative_context.asset_context.assets.find(asset => asset.id === 'path_conflict_01'),
    'focus_regions',
  ), false);

  const persistedPath = getWorkflowPath(workflowId, rootDir);
  const afterFirstHydration = fs.readFileSync(persistedPath, 'utf8');
  const fetchedAgain = await getCreativeWorkflow(workflowId, {
    rootDir,
    mediaRoot,
    services: { now: () => NOW },
  });
  assert.deepEqual(fetchedAgain.data.asset_context.assets, fetched.data.asset_context.assets, '第二次 same-ID 水合必须幂等');
  assert.equal(fs.readFileSync(persistedPath, 'utf8'), afterFirstHydration);

  const changedProject = readJson(projectPath);
  changedProject.assets.find(asset => asset.id === 'search_01').focus_regions = [];
  fs.writeFileSync(projectPath, JSON.stringify(changedProject, null, 2), 'utf8');
  const focusCleared = await getCreativeWorkflow(workflowId, {
    rootDir,
    mediaRoot,
    services: { now: () => NOW },
  });
  assert.deepEqual(focusCleared.data.asset_context.assets.find(asset => asset.id === 'search_01').focus_regions, []);
  assert.deepEqual(readJson(persistedPath).creative_context.asset_context.assets.find(asset => asset.id === 'search_01').focus_regions, []);

  const afterFocusChange = fs.readFileSync(persistedPath, 'utf8');
  changedProject.assets.find(asset => asset.id === 'search_01').debug_note = '不相关工程字段';
  fs.writeFileSync(projectPath, JSON.stringify(changedProject, null, 2), 'utf8');
  await getCreativeWorkflow(workflowId, {
    rootDir,
    mediaRoot,
    services: { now: () => NOW },
  });
  assert.equal(fs.readFileSync(persistedPath, 'utf8'), afterFocusChange, '不相关 project 字段不应触发 workflow 持久化抖动');
}

async function testGetWorkflowDoesNotHydrateProjectOutsideMediaRoot() {
  const { rootDir, mediaRoot } = createTempDirs();
  const workflowId = WORKFLOW_ID;
  const projectDir = path.join(rootDir, 'outside-html-video-project');
  fs.mkdirSync(path.join(projectDir, 'frames'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'frames', '01.html'),
    '<!doctype html><html><body><img src="../assets/external.png"></body></html>',
    'utf8',
  );
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    workflow_id: workflowId,
    frames: [{ id: 'scene_01', scene_id: 'scene_01', html_path: 'frames/01.html' }],
    assets: [{
      id: 'external_asset',
      source: 'generated',
      path: 'assets/external.png',
      local_path: path.join(rootDir, 'secrets', 'external.png'),
      generation: { scene_id: 'scene_01' },
    }],
  }, null, 2), 'utf8');
  const assetContext = { status: 'ready', assets: [] };
  fs.writeFileSync(getWorkflowPath(workflowId, rootDir), JSON.stringify({
    success: true,
    workflow_id: workflowId,
    aweme_id: workflowId,
    status: 'done',
    message: 'done',
    stages: [],
    asset_context: assetContext,
    creative_context: { asset_context: assetContext },
    result: {
      hyperframes_freeform: {
        project: {
          render_mode: 'html-video',
          html_video_project_path: projectDir,
          project_dir: projectDir,
        },
        render: { status: 'rendered', output_path: '' },
      },
    },
  }, null, 2), 'utf8');

  const fetched = await getCreativeWorkflow(workflowId, {
    rootDir,
    mediaRoot,
    services: { now: () => NOW },
  });
  assert.equal(fetched.success, true);
  assert.deepEqual(fetched.data.asset_context.assets, []);
  assert.equal(fetched.data.asset_context.asset_usage_report, undefined);
  const persisted = readJson(getWorkflowPath(workflowId, rootDir));
  assert.deepEqual(persisted.asset_context.assets, []);
  assert.equal(persisted.asset_context.asset_usage_report, undefined);
}

async function run() {
  await testAppendWorkflowModelCall();
  await testRunResearchProviderAddsAuditMetadata();
  await testRunWorkflowPersistsResearchModelCalls();
  await testCreatesAndRunsTextWorkflow();
  await testCreatesWorkflowWithClaimedUploadAndPreservesItThroughSourceStage();
  await testDouyinUploadUsesAwemeMediaDirectory();
  await testPersistFailureReleasesClaimForReuse();
  await testPersistFailureReportsReleaseFailureAndDeletesCopies();
  await testFinalizeFailurePersistsWarningDiagnostic();
  await testCreatesAndRunsSourceUrlWorkflow();
  await testSourceUrlWorkflowRunsSourceImageAnalysisWhenEnabled();
  await testRejectsSourceImageAnalysisWithoutMultimodalTextModel();
  await testRejectsSourceImageAnalysisWithDisabledTextModel();
  await testRejectsSourceImageAnalysisWithIncompleteTextModel();
  await testTextWorkflowDoesNotRequireSourceImageAnalysisModel();
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
  await testHtmlVideoExportUsesOrchestrator();
  await testHtmlVideoExportRestoresMissingNarrationReference();
  await testNonHtmlVideoProjectResultFails();
  await testRejectsEmptyInput();
  await testCreatesDouyinWorkflowWithOriginalAwemeId();
  await testCreatesDouyinWorkflowFromShareTextShortLink();
  await testPreparesDouyinSourceBeforeAgentRun();
  await testDouyinSourceFetchesCommentsAndRunsAsrBeforeAgentRun();
  await testDouyinSourceContinuesWhenCommentSaveAndAsrFail();
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
  await testGetWorkflowHydratesAssetUsageReportFromProject();
  await testGetWorkflowHydratesGeneratedProjectAssets();
  await testGetWorkflowDoesNotHydrateProjectOutsideMediaRoot();
  console.log('creative workflow tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
