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
  assert.equal(calls[3].options.projectOptions.creative_context.asset_context.status, 'disabled');
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

async function testHtmlVideoLiteSkipsLegacyHyperframesStages() {
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
  for (const stageId of ['check', 'render', 'inspect']) {
    const stage = persisted.stages.find(item => item.id === stageId);
    assert.equal(stage.status, 'skipped');
    assert.match(stage.message, /跳过旧 HyperFrames/);
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
  await testCreatesAndRunsTextWorkflow();
  await testHtmlVideoLiteSkipsLegacyHyperframesStages();
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
