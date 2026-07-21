const assert = require('assert/strict');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const CHECK_PIXELS = process.env.PIXEL_CHECK === '1';

if (process.env.RUN_HTML_VIDEO_REAL_RENDER !== '1') {
  console.log('跳过 html-video 真实渲染烟测：未设置 RUN_HTML_VIDEO_REAL_RENDER=1。');
  process.exit(0);
}

const htmlVideoWorkflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const environmentDoctor = require('../server/services/creative-video/html-video/environmentDoctor');
const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const { createEmptyProject } = require('../server/services/creative-video/html-video/projectSchema');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { isBlockingVisualQaCode } = require('../server/services/creative-video/visualQaCodes');

const RESOLUTION = { width: 640, height: 360 };
const FPS = 12;
const DURATION_SEC = 3;

function rawFrameHtml(headline) {
  return [
    '<!doctype html>',
    '<html>',
    '<head><meta charset="utf-8"><style>',
    'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#17315c;color:#fff;font-family:"Microsoft YaHei",Arial,sans-serif;}',
    'main{position:absolute;inset:0;background:linear-gradient(135deg,#17315c,#2d6ca2);}',
    'main::before{content:"";position:absolute;width:42%;aspect-ratio:1;border-radius:50%;left:6%;top:12%;background:linear-gradient(135deg,#4de1ff,#9a6cff);animation:drift 3s ease-in-out infinite alternate;}',
    'h1{position:absolute;left:52%;right:6%;top:22%;margin:0;font-size:42px;line-height:1.15;text-shadow:0 3px 16px #07152e;}',
    '.hv-caption-layer{bottom:12px!important;font-size:42px!important;}',
    '@keyframes drift{from{transform:translateX(0) scale(.88)}to{transform:translateX(24px) scale(1.08)}}',
    '</style></head>',
    `<body><main><h1 data-text-key="headline">${headline}</h1></main></body>`,
    '</html>',
  ].join('');
}

function parseRate(value) {
  const [numerator, denominator = '1'] = String(value || '').split('/').map(Number);
  return denominator ? numerator / denominator : 0;
}

async function probeVideo(outputPath) {
  const ffprobePath = await environmentDoctor.resolveFfprobePath();
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,r_frame_rate',
    '-of', 'json',
    outputPath,
  ], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const stream = JSON.parse(stdout).streams?.[0];
  assert.ok(stream, `ffprobe 未返回视频流：${outputPath}`);
  const fps = parseRate(stream.avg_frame_rate) || parseRate(stream.r_frame_rate);
  return { ...stream, fps };
}

async function assertRealVideo(outputPath) {
  const stat = await fs.stat(outputPath);
  assert.ok(stat.size > 0, `真实 MP4 应非空：${outputPath}`);
  const stream = await probeVideo(outputPath);
  assert.equal(stream.codec_type, 'video');
  assert.equal(stream.width, RESOLUTION.width);
  assert.equal(stream.height, RESOLUTION.height);
  assert.ok(Math.abs(stream.fps - FPS) < 0.01, `目标帧率 ${FPS}，实际 ${stream.fps}`);
  return { ...stream, size: stat.size };
}

function assertPathWithin(parentPath, childPath, label) {
  const absoluteParent = path.resolve(parentPath);
  const absoluteChild = path.resolve(childPath);
  const relative = path.relative(absoluteParent, absoluteChild);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${label} 必须位于本次运行目录内`);
  return absoluteChild;
}

async function assertCaptionPixelsIfEnabled(outputPath) {
  if (!CHECK_PIXELS) {
    console.log('跳过字幕像素检查：未设置 PIXEL_CHECK=1。');
    return;
  }
  const ffmpegPath = await environmentDoctor.resolveFfmpegPath();
  const { stdout } = await execFileAsync(ffmpegPath, [
    '-v', 'error', '-ss', '1', '-i', outputPath,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  assert.equal(stdout.length, RESOLUTION.width * RESOLUTION.height * 3, '字幕像素检查应读取完整 RGB 帧');
  let brightPixels = 0;
  for (let y = Math.floor(RESOLUTION.height * 0.58); y < Math.floor(RESOLUTION.height * 0.92); y += 1) {
    for (let x = Math.floor(RESOLUTION.width * 0.08); x < Math.floor(RESOLUTION.width * 0.92); x += 1) {
      const offset = (y * RESOLUTION.width + x) * 3;
      if (stdout[offset] > 215 && stdout[offset + 1] > 215 && stdout[offset + 2] > 215) brightPixels += 1;
    }
  }
  assert.ok(brightPixels > 200, `字幕区域应包含可读亮色文字像素，实际 ${brightPixels}`);
}

async function runFormalPreview(rootDir) {
  const workflowId = 'workflow_real_preview';
  const runId = 'run_real_preview';
  const projectDir = await projectStore.createProjectDir({ rootDir, workflowId, runId });
  const htmlPath = 'frames/raw-layout-preview.html';
  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  await fs.writeFile(path.join(projectDir, htmlPath), rawFrameHtml('正式预览'), 'utf8');

  const project = createEmptyProject({ projectId: 'project_real_preview', workflowId, runId });
  project.output = { resolution: RESOLUTION, fps: FPS, duration: DURATION_SEC };
  project.continuity_mode = 'scene_html';
  project.frames = [{
    id: 'scene:scene_preview',
    scene_id: 'scene_preview',
    graph_node_id: 'scene_preview',
    source_mode: 'raw_html',
    html_path: htmlPath,
    duration_sec: DURATION_SEC,
    narration_text: '正式预览会生成真实视频。',
    captions: [{ id: 'caption_preview', start: 0, end: DURATION_SEC, text: '正式预览会生成真实视频。' }],
    inputs: {},
  }];
  project.timeline = {
    tracks: [{
      id: 'main',
      type: 'video',
      items: [{ id: 'preview_item', kind: 'frame', frame_id: 'scene:scene_preview', start_sec: 0, duration_sec: DURATION_SEC }],
    }],
  };

  const result = await projectOrchestrator.renderHtmlVideoFramePreview({
    rootDir,
    workflowId,
    runId,
    project,
    frameId: 'scene:scene_preview',
    runLayoutQa: true,
  });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics, null, 2));
  assert.match(result.preview_path, /[\\/]inspect[\\/]previews[\\/].+\.mp4$/);
  assert.equal(result.layout_qa?.success, true, JSON.stringify(result.layout_qa, null, 2));
  assert.equal(result.layout_qa?.metrics?.skipped, false, '布局 QA 必须由真实 Chrome 执行');
  const materializedFrame = result.project.frames.find(frame => frame.id === 'scene:scene_preview');
  const materializedHtml = await fs.readFile(path.join(projectDir, materializedFrame.html_path), 'utf8');
  assert.match(materializedHtml, /data-hv-layer="captions"|data-role="subtitle-caption"/,
    'raw_html 物化后必须包含受管字幕层');
  const stream = await assertRealVideo(result.preview_path);
  await assertCaptionPixelsIfEnabled(result.preview_path);
  return { outputPath: result.preview_path, stream, layoutQa: result.layout_qa };
}

async function runFormalWorkflow(rootDir) {
  const workflowId = 'workflow_real_full';
  const runId = 'run_real_full';
  const narration = '正式工作流会完成渲染、合成和视觉质检。';
  const sceneSpec = {
    title: '真实完整工作流',
    aspect_ratio: '16:9',
    target_duration_sec: DURATION_SEC,
    scenes: [{
      id: 'scene_01',
      kind: 'text',
      duration_sec: DURATION_SEC,
      narration_text: narration,
      captions: [{ id: 'caption_01', start: 0, end: DURATION_SEC, text: narration }],
      visual_text: { headline: '真实完整工作流', keywords: [], cards: [] },
    }],
  };
  const progress = [];
  let modelCalls = 0;
  const result = await htmlVideoWorkflow.generateHtmlVideo({
    workflowId,
    runId,
    rootDir,
    sceneSpec,
    creativeContext: {
      input: { raw_text: narration },
      continuity_mode: 'scene_html',
      asset_context: { assets: [] },
    },
    target: {
      aspect_ratio: '16:9',
      width: RESOLUTION.width,
      height: RESOLUTION.height,
      fps: FPS,
      duration_sec: DURATION_SEC,
      generateAudio: false,
      generateCaptions: true,
      autoSfxEnabled: false,
    },
    skipValidation: false,
    runLayoutQa: true,
    services: {
      aiImageModel: { isConfigured: async () => false },
      aiTextModel: {
        callTextModel: async request => {
          modelCalls += 1;
          const prompt = request.messages.map(message => (
            typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
          )).join('\n');
          if (prompt.startsWith('你是 html-video 的 content graph')) {
            return {
              success: true,
              text: JSON.stringify({
                synopsis: '真实完整工作流',
                nodes: [{
                  id: 'scene_01',
                  kind: 'text',
                  label: '真实完整工作流',
                  durationSec: DURATION_SEC,
                  text: narration,
                  asset_refs: [],
                }],
                edges: [],
              }),
            };
          }
          return { success: true, text: rawFrameHtml('真实完整工作流') };
        },
      },
    },
    onProgress: event => { progress.push(event); },
  });

  assert.equal(result.success, true, JSON.stringify({
    message: result.message,
    diagnostics: result.diagnostics,
    visual_report: result.visual_report,
  }, null, 2));
  assert.ok(modelCalls >= 2, '正式工作流应生成 content graph 与 Frame HTML');
  const layoutDone = progress.find(event => event.type === 'html_video_layout_qa_done');
  assert.ok(layoutDone, '正式工作流必须执行渲染前布局 QA');
  assert.equal(layoutDone.data?.layout_qa?.metrics?.skipped, false, '正式工作流布局 QA 不得跳过真实 Chrome');

  const stream = await assertRealVideo(result.output_path);
  const projectPath = path.join(result.project_dir, 'project.json');
  const persistedProject = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  assert.equal(persistedProject.workflow_id, workflowId);
  assert.equal(persistedProject.run_id, runId);
  const expectedProjectDir = path.join(rootDir, workflowId, 'agent_runs', `${runId}-html-video`);
  assert.equal(path.resolve(result.project_dir), path.resolve(expectedProjectDir));
  assertPathWithin(rootDir, result.project_dir, 'project_dir');
  assertPathWithin(result.project_dir, result.output_path, 'output_path');
  const checkpoint = persistedProject.generation_checkpoint.stages;
  assert.equal(checkpoint.compose.status, 'done');
  assert.equal(checkpoint.duration_verify.status, 'done');
  assert.notEqual(checkpoint.duration_verify.status, 'skipped');

  const reportPath = assertPathWithin(
    result.project_dir,
    path.resolve(result.project_dir, result.visual_report.report_path),
    'report_path',
  );
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(report.safety_only, false);
  const contactSheetPath = assertPathWithin(
    result.project_dir,
    path.isAbsolute(report.contact_sheet_path)
      ? report.contact_sheet_path
      : path.resolve(result.project_dir, report.contact_sheet_path),
    'contact_sheet_path',
  );
  const contactSheetStat = await fs.stat(contactSheetPath);
  assert.ok(contactSheetStat.size > 0, '完整视觉 QA 的 contact sheet 必须存在且非空');
  assert.ok(Number(report.metrics?.frame_count) > 0, '完整视觉 QA 应包含真实抽帧指标');
  assert.ok((report.warnings || []).some(item => String(item.code).startsWith('asset_first_')),
    '完整视觉 QA 应包含可识别的 asset-first 观测结果');
  assert.equal(checkpoint.visual_inspect.report_path, 'inspect/visual-report.json');
  assert.equal(checkpoint.visual_inspect.status, report.success ? 'done' : 'warning');
  assert.equal(result.visual_report.success, report.success);
  assert.deepEqual(result.visual_report.issues || [], report.issues || []);
  assert.equal(report.success, false, '真实夹具应稳定产生非阻断 issue，证明工作流仍输出成片');
  assert.ok(report.issues.some(issue => issue.code === 'contact_sheet_too_small'),
    '真实夹具应包含明确的非阻断 contact_sheet_too_small');
  assert.equal(report.issues.some(issue => isBlockingVisualQaCode(issue.code)), false,
    '真实夹具不得包含共享 blocking issue');
  if (CHECK_PIXELS) {
    assert.equal((report.warnings || []).some(issue => issue.code === 'asset_first_caption_invisible'), false,
      '字幕像素验收开启时不得带着 caption_invisible 告警假通过');
  }
  await assertCaptionPixelsIfEnabled(result.output_path);

  return {
    outputPath: result.output_path,
    stream,
    report: {
      success: report.success,
      issueCodes: (report.issues || []).map(item => item.code),
      warningCodes: (report.warnings || []).map(item => item.code),
      checkpointStatus: checkpoint.visual_inspect.status,
      contactSheetPath: report.contact_sheet_path,
      frameCount: report.metrics.frame_count,
    },
  };
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-real-render-'));
  const preview = await runFormalPreview(rootDir);
  const workflow = await runFormalWorkflow(rootDir);
  console.log(JSON.stringify({
    message: 'html-video 正式预览与完整工作流真实烟测通过。',
    preview,
    workflow,
  }, null, 2));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
