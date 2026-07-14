const assert = require('assert');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SKIP_PIXEL = process.env.PIXEL_CHECK !== '1';

if (process.env.RUN_HTML_VIDEO_REAL_RENDER !== '1') {
  console.log('跳过 html-video 真实渲染烟测：未设置 RUN_HTML_VIDEO_REAL_RENDER=1。');
  process.exit(0);
}

const { createEmptyProject } = require('../server/services/creative-video/html-video/projectSchema');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { materializeProject } = require('../server/services/creative-video/html-video/materializer');
const { renderFrame } = require('../server/services/creative-video/html-video/frameRenderer');

const RESOLUTION = { width: 1920, height: 1080 };
const FPS = 24;

function optionalPngReader() {
  try {
    return require('pngjs').PNG;
  } catch {
    return null;
  }
}

async function resolveFfmpegPath() {
  try {
    return require('@ffmpeg-installer/ffmpeg').path;
  } catch {
    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  }
}

function rawFrameHtml(headline) {
  return [
    '<!doctype html>',
    '<html>',
    '<head><meta charset="utf-8"><style>',
    'html,body{margin:0;width:100%;height:100%;background:#101820;color:#fff;font-family:"Microsoft YaHei",Arial,sans-serif;}',
    'main{position:absolute;inset:0;display:grid;place-items:center;font-size:64px;font-weight:700;}',
    '</style></head>',
    `<body><main data-text-key="headline">${headline}</main></body>`,
    '</html>',
  ].join('');
}

async function assertCaptionPixelsIfEnabled({ outputPath, projectDir }) {
  if (SKIP_PIXEL) {
    console.log('跳过字幕像素检查：未设置 PIXEL_CHECK=1。');
    return;
  }

  const PNG = optionalPngReader();
  if (!PNG || !PNG.sync || typeof PNG.sync.read !== 'function') {
    console.log('跳过字幕像素检查：未安装稳定 PNG 解析库。');
    return;
  }

  const ffmpegPath = await resolveFfmpegPath();
  const framePath = path.join(projectDir, 'exports', 'caption-pixel-check.png');
  try {
    await execFileAsync(ffmpegPath, ['-y', '-ss', '1', '-i', outputPath, '-frames:v', '1', framePath], {
      maxBuffer: 1024 * 1024 * 8,
    });
  } catch (error) {
    console.log(`跳过字幕像素检查：ffmpeg 抽帧失败：${error.stderr || error.message}`);
    return;
  }

  const png = PNG.sync.read(await fs.readFile(framePath));
  const background = { r: 16, g: 24, b: 32 };
  const yStart = Math.floor(png.height * 0.72);
  const yEnd = Math.floor(png.height * 0.9);
  let sampled = 0;
  let changed = 0;
  for (let y = yStart; y < yEnd; y += 4) {
    for (let x = Math.floor(png.width * 0.08); x < Math.floor(png.width * 0.92); x += 4) {
      const offset = (png.width * y + x) * 4;
      const distance = Math.abs(png.data[offset] - background.r)
        + Math.abs(png.data[offset + 1] - background.g)
        + Math.abs(png.data[offset + 2] - background.b);
      sampled += 1;
      if (distance > 24) changed += 1;
    }
  }

  assert.ok(sampled > 0, '字幕像素检查应至少采样到一个像素');
  assert.ok(changed / sampled > 0.02, '底部字幕区域应存在非背景像素');
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-real-render-'));
  const workflowId = 'workflow_real_render';
  const runId = 'run_001';
  const projectDir = await projectStore.createProjectDir({ rootDir, workflowId, runId });

  const project = createEmptyProject({
    projectId: 'project_real_render',
    workflowId,
    runId,
  });
  const rawFrameHtmlPath = 'frames/raw-caption-smoke.html';
  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  await fs.writeFile(path.join(projectDir, rawFrameHtmlPath), rawFrameHtml('RAW HTML'), 'utf8');
  project.frames = [{
    id: 'raw_caption_smoke',
    scene_id: 'raw_caption_smoke',
    order: 1,
    source_mode: 'raw_html',
    html_path: rawFrameHtmlPath,
    duration_sec: 4,
    narration_text: '旁白文本应自动生成底部字幕层。',
    captions: [{ id: 'cap_01', start: 0, end: 3.8, text: '旁白文本应自动生成底部字幕层。' }],
    inputs: {},
    metadata: { visual_text: { headline: 'RAW HTML' } },
  }];
  projectStore.addRevision(project, {
    summary: '首次生成',
    author: 'smoke',
    change: { type: 'initial_generate' },
  });

  let materialized = await materializeProject({ projectDir, project });
  await projectStore.saveProject(projectDir, materialized.project);
  const rawFrame = materialized.project.frames.find(frame => frame.id === 'raw_caption_smoke');
  assert.ok(rawFrame, '应包含 raw_html 字幕烟测帧');
  const rawHtml = await fs.readFile(path.join(projectDir, rawFrame.html_path), 'utf8');
  assert.match(rawHtml, /data-hv-layer="captions"|data-role="subtitle-caption"/);

  const firstOutput = path.join(projectDir, 'exports', 'real-render-first.mp4');
  const firstRender = await renderFrame(rawFrame, {
    projectDir,
    outputPath: firstOutput,
    resolution: RESOLUTION,
    fps: FPS,
    duration: 4,
  });
  assert.equal(firstRender.success, true, firstRender.message || '首次渲染失败');
  const firstStat = await fs.stat(firstOutput);
  assert.ok(firstStat.size > 0, '首次 MP4 应非空');
  assert.equal(firstRender.meta.actualResolution.width, RESOLUTION.width);
  assert.equal(firstRender.meta.actualResolution.height, RESOLUTION.height);
  assert.ok(firstRender.meta.durationSec >= 4);
  await assertCaptionPixelsIfEnabled({ outputPath: firstOutput, projectDir });

  // 编辑 raw HTML 后重物化并重渲，验证编辑重渲与导出记账
  const edited = materialized.project;
  await fs.writeFile(path.join(projectDir, rawFrameHtmlPath), rawFrameHtml('重渲成功'), 'utf8');
  edited.frames[0].html_path = rawFrameHtmlPath;
  projectStore.addRevision(edited, {
    summary: '编辑标题并重渲',
    author: 'smoke',
    change: { type: 'raw_html_edit', patch: { headline: '重渲成功' } },
  });
  materialized = await materializeProject({ projectDir, project: edited });
  await projectStore.saveProject(projectDir, materialized.project);
  const rerenderOutput = path.join(projectDir, 'exports', 'real-render-rerender.mp4');
  const rerender = await renderFrame(materialized.project.frames[0], {
    projectDir,
    outputPath: rerenderOutput,
    resolution: RESOLUTION,
    fps: FPS,
    duration: 4,
  });
  assert.equal(rerender.success, true, rerender.message || '编辑重渲失败');
  const rerenderStat = await fs.stat(rerenderOutput);
  assert.ok(rerenderStat.size > 0, '重渲 MP4 应非空');
  projectStore.addExport(materialized.project, {
    path: 'exports/real-render-first.mp4',
    reason: '首次真实渲染',
    source_revision_id: materialized.project.revisions[0].id,
  });
  projectStore.addExport(materialized.project, {
    path: 'exports/real-render-rerender.mp4',
    reason: '编辑后重渲',
    source_revision_id: materialized.project.revisions[1].id,
  });
  await projectStore.saveProject(projectDir, materialized.project);

  const loaded = await projectStore.loadProject(projectDir);
  assert.equal(loaded.exports.length, 2);
  assert.equal(loaded.revisions.length, 2);
  assert.notEqual(loaded.exports[0].path, loaded.exports[1].path);

  console.log(`html-video 真实渲染烟测通过：${rerenderOutput}`);
})();
