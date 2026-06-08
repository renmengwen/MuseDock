# HyperFrames Original Caption Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first HyperFrames-based video generation flow that turns an AI run's TTS audio and caption timeline into an original text-card narration MP4.

**Architecture:** Build a local HyperFrames project under the selected run directory using only original graphic/text composition, not source video frames or original video backgrounds. The backend generates `index.html`, `project.json`, and a small `captions.json` from `run.tts.captions`, then optionally invokes the HyperFrames CLI to render MP4. The frontend adds AI 工作台 actions for generating the video project and rendering/opening the generated MP4.

**Tech Stack:** Node.js 22, Express, HyperFrames CLI (`npx hyperframes render`), FFmpeg, existing `agentRuns` service, existing `tts.captions`, React AI 工作台.

---

## Current Context

The project already has a working AI content pipeline:

1. Crawl Douyin content.
2. Prepare local media.
3. ASR transcribe local audio.
4. AI 工作台 generates `rewrite_script`.
5. MiMo TTS synthesizes speech.
6. TTS now produces:
   - `tts.path`
   - `tts.url`
   - `tts.duration`
   - `tts.segments`
   - `tts.captions`

This plan starts from a run JSON that already has `tts.captions` and `tts.path`.

## Non-Goals

- Do not use original video frames, original video screenshots, or original video as the final visual background.
- Do not connect image generation yet.
- Do not build a visual editor.
- Do not implement full scene planning by AI yet.
- Do not require HyperFrames as a permanent npm dependency until the render command is actually used; use `npx hyperframes render` first.

## Target User Flow

1. User enters AI 工作台.
2. User loads an aweme_id.
3. User selects a run with TTS audio and captions.
4. User clicks `生成视频工程`.
5. Backend creates:

```text
data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/
  index.html
  captions.json
  project.json
  assets/
    narration.wav
```

6. User clicks `渲染 MP4`.
7. Backend runs HyperFrames CLI in the project directory.
8. Generated MP4 is saved under:

```text
data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/output.mp4
```

9. AI 工作台 shows project path, output path, and an MP4 preview/download link if available.

## Target Run JSON Shape

Add or update `run.video`:

```json
{
  "video": {
    "status": "rendered",
    "template": "original_caption_cards",
    "project_dir": "D:/code3/MediaCrawler-GUI/data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes",
    "index_path": "D:/code3/MediaCrawler-GUI/data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/index.html",
    "output_path": "D:/code3/MediaCrawler-GUI/data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/output.mp4",
    "output_url": "/api/agents/douyin/<aweme_id>/runs/<run_id>/hyperframes/files/output.mp4",
    "duration": 12.4,
    "message": "视频渲染完成。",
    "updated_at": "2026-06-09T00:00:00.000Z"
  }
}
```

## File Structure

- Create `server/services/hyperframesProject.js`
  - Validates run has `tts.path` and `tts.captions`.
  - Creates project directory.
  - Copies TTS audio to `assets/narration.wav`.
  - Writes `captions.json`.
  - Writes `project.json`.
  - Writes `index.html` for original caption-card video.

- Create `server/services/hyperframesRenderer.js`
  - Runs `npx hyperframes render` in the project directory.
  - Returns success/failure and output path.
  - Supports command injection for tests.

- Modify `server/services/agentRuns.js`
  - Adds `createDouyinRunHyperframesProject`.
  - Adds `renderDouyinRunHyperframesVideo`.
  - Adds `resolveDouyinRunHyperframesFile`.
  - Persists `run.video`.

- Modify `server/routes/agents.js`
  - Adds project generation route.
  - Adds render route.
  - Adds file-serving route for generated MP4.

- Modify `frontend-react/src/api/client.js`
  - Adds API helpers.

- Modify `frontend-react/src/pages/AiWorkspace.jsx`
  - Adds `生成视频工程` and `渲染 MP4` actions under TTS section.
  - Shows project/render status and MP4 preview when present.

- Modify `frontend-react/src/styles.css`
  - Adds compact video project panel styles.

- Create `test-hyperframes-project.js`
  - Tests project generation and HTML/caption output.

- Create `test-hyperframes-renderer.js`
  - Tests renderer command construction with injected runner.

- Modify `test-agent-runs.js`
  - Tests Agent run integration and routes.

- Modify `package.json`
  - Adds new tests to `npm test`.

## Task 1: Project Generator RED Test

**Files:**

- Create: `test-hyperframes-project.js`
- Create later: `server/services/hyperframesProject.js`

- [ ] **Step 1: Write failing project generator test**

Create `test-hyperframes-project.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hyperframesProject = require('./server/services/hyperframesProject');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperframes-project-test-'));
  const audioPath = path.join(root, 'narration-source.wav');
  fs.writeFileSync(audioPath, 'fake wav data');

  const runData = {
    run_id: '20260609-000000-000Z-abcdef-viral_rewrite',
    aweme_id: '1234567890',
    result: {
      rewrite_script: '第一句。第二句。',
    },
    tts: {
      path: audioPath,
      duration: 3.75,
      captions: [
        { index: 1, start: 0, end: 1.25, duration: 1.25, text: '第一句。' },
        { index: 2, start: 1.25, end: 3.75, duration: 2.5, text: '第二句。' },
      ],
    },
  };

  const result = await hyperframesProject.createOriginalCaptionProject({
    run: runData,
    projectDir: path.join(root, 'project'),
  });

  assert.equal(result.success, true);
  assert.equal(result.template, 'original_caption_cards');
  assert.ok(fs.existsSync(result.project_dir));
  assert.ok(fs.existsSync(result.index_path));
  assert.ok(fs.existsSync(path.join(result.project_dir, 'captions.json')));
  assert.ok(fs.existsSync(path.join(result.project_dir, 'project.json')));
  assert.ok(fs.existsSync(path.join(result.project_dir, 'assets', 'narration.wav')));

  const captions = JSON.parse(fs.readFileSync(path.join(result.project_dir, 'captions.json'), 'utf-8'));
  assert.deepStrictEqual(captions.captions, runData.tts.captions);
  assert.equal(captions.duration, 3.75);

  const html = fs.readFileSync(result.index_path, 'utf-8');
  assert.match(html, /data-composition-id="original-caption-cards"/);
  assert.match(html, /assets\/narration.wav/);
  assert.match(html, /第一句。/);
  assert.match(html, /第二句。/);
  assert.doesNotMatch(html, /video\.mp4|frame-0001|frames\//);

  const missingTts = await hyperframesProject.createOriginalCaptionProject({
    run: { run_id: 'missing-tts', tts: {} },
    projectDir: path.join(root, 'missing'),
  });
  assert.equal(missingTts.success, false);
  assert.match(missingTts.message, /TTS|字幕/);
}

run().then(() => {
  console.log('hyperframes project tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node test-hyperframes-project.js
```

Expected: fail with module-not-found for `./server/services/hyperframesProject`.

## Task 2: Implement Project Generator

**Files:**

- Create: `server/services/hyperframesProject.js`

- [ ] **Step 1: Create service**

Create `server/services/hyperframesProject.js`:

```js
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');

const TEMPLATE_ORIGINAL_CAPTION_CARDS = 'original_caption_cards';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeCaption(caption, index) {
  return {
    index: Number(caption.index || index + 1),
    start: Number(caption.start || 0),
    end: Number(caption.end || 0),
    duration: Number(caption.duration || 0),
    text: typeof caption.text === 'string' ? caption.text : '',
  };
}

function getSceneTone(index) {
  const tones = [
    { accent: '#fe2c55', bg: '#101216' },
    { accent: '#25f4ee', bg: '#121826' },
    { accent: '#ffd166', bg: '#17130f' },
    { accent: '#a7f3d0', bg: '#101a16' },
  ];
  return tones[index % tones.length];
}

function buildIndexHtml({ captions, duration }) {
  const sceneHtml = captions.map((caption, index) => {
    const tone = getSceneTone(index);
    return [
      `<section class="scene" data-start="${caption.start}" data-duration="${caption.duration}" data-track-index="${index + 1}" style="--accent:${tone.accent};--bg:${tone.bg};">`,
      `  <div class="scene-number">${String(index + 1).padStart(2, '0')}</div>`,
      `  <div class="scene-card">`,
      `    <p>${escapeHtml(caption.text)}</p>`,
      `  </div>`,
      `</section>`,
    ].join('\n');
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MuseDock 原创口播视频</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #0f1115; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    #stage { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #0f1115; }
    .scene { position: absolute; inset: 0; display: grid; place-items: center; padding: 120px 86px; box-sizing: border-box; background:
      radial-gradient(circle at 20% 15%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 34%),
      linear-gradient(160deg, var(--bg), #050608 72%);
    }
    .scene::before { content: ""; position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px); background-size: 52px 52px; mask-image: linear-gradient(to bottom, transparent, #000 18%, #000 82%, transparent); }
    .scene-number { position: absolute; top: 82px; left: 78px; color: var(--accent); font-size: 34px; font-weight: 800; letter-spacing: 0; }
    .scene-card { position: relative; width: 100%; border-left: 10px solid var(--accent); padding: 46px 44px; background: rgba(255,255,255,.09); box-shadow: 0 30px 90px rgba(0,0,0,.28); backdrop-filter: blur(16px); }
    .scene-card p { margin: 0; font-size: 62px; line-height: 1.32; font-weight: 800; letter-spacing: 0; text-wrap: balance; }
    .brand { position: absolute; right: 72px; bottom: 64px; color: rgba(255,255,255,.68); font-size: 26px; font-weight: 700; }
    .caption-bar { position: absolute; left: 64px; right: 64px; bottom: 132px; padding: 24px 28px; border-radius: 8px; background: rgba(0,0,0,.58); color: #fff; font-size: 34px; line-height: 1.42; text-align: center; }
  </style>
</head>
<body>
  <div id="stage" data-composition-id="original-caption-cards" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920">
    <audio data-start="0" data-duration="${duration}" data-track-index="0" src="assets/narration.wav"></audio>
${sceneHtml}
    <div class="brand" data-start="0" data-duration="${duration}" data-track-index="${captions.length + 10}">MuseDock</div>
  </div>
</body>
</html>
`;
}

async function createOriginalCaptionProject({ run, projectDir }) {
  const captions = Array.isArray(run?.tts?.captions)
    ? run.tts.captions.map(normalizeCaption).filter(item => item.text && item.end > item.start)
    : [];
  const audioPath = typeof run?.tts?.path === 'string' ? run.tts.path : '';

  if (!audioPath || captions.length === 0) {
    return {
      success: false,
      message: '生成视频工程失败：请先完成 TTS 合成并生成字幕时间轴。',
    };
  }

  if (!fs.existsSync(audioPath)) {
    return {
      success: false,
      message: '生成视频工程失败：未找到 TTS 音频文件。',
    };
  }

  const duration = Number(run.tts.duration || captions[captions.length - 1].end || 0);
  const assetsDir = path.join(projectDir, 'assets');
  await fsp.rm(projectDir, { recursive: true, force: true });
  await fsp.mkdir(assetsDir, { recursive: true });

  const narrationPath = path.join(assetsDir, 'narration.wav');
  await fsp.copyFile(audioPath, narrationPath);

  const captionsPath = path.join(projectDir, 'captions.json');
  await fsp.writeFile(captionsPath, JSON.stringify({ duration, captions }, null, 2), 'utf-8');

  const projectJsonPath = path.join(projectDir, 'project.json');
  await fsp.writeFile(projectJsonPath, JSON.stringify({
    template: TEMPLATE_ORIGINAL_CAPTION_CARDS,
    run_id: run.run_id || '',
    aweme_id: run.aweme_id || '',
    duration,
    created_at: new Date().toISOString(),
  }, null, 2), 'utf-8');

  const indexPath = path.join(projectDir, 'index.html');
  await fsp.writeFile(indexPath, buildIndexHtml({ captions, duration }), 'utf-8');

  return {
    success: true,
    template: TEMPLATE_ORIGINAL_CAPTION_CARDS,
    project_dir: projectDir,
    index_path: indexPath,
    captions_path: captionsPath,
    project_json_path: projectJsonPath,
    duration,
    message: '视频工程已生成。',
  };
}

module.exports = {
  TEMPLATE_ORIGINAL_CAPTION_CARDS,
  createOriginalCaptionProject,
  buildIndexHtml,
};
```

- [ ] **Step 2: Run GREEN**

Run:

```bash
node test-hyperframes-project.js
```

Expected: `hyperframes project tests passed`.

## Task 3: Renderer RED Test

**Files:**

- Create: `test-hyperframes-renderer.js`
- Create later: `server/services/hyperframesRenderer.js`

- [ ] **Step 1: Write failing renderer test**

Create `test-hyperframes-renderer.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const renderer = require('./server/services/hyperframesRenderer');

async function run() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperframes-renderer-test-'));
  fs.writeFileSync(path.join(projectDir, 'index.html'), '<html></html>');

  const calls = [];
  const result = await renderer.renderHyperframesProject({
    projectDir,
    runCommand: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      fs.writeFileSync(path.join(projectDir, 'output.mp4'), 'fake mp4');
      return { ok: true, code: 0, stdout: 'rendered', stderr: '' };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.output_path, path.join(projectDir, 'output.mp4'));
  assert.equal(fs.readFileSync(result.output_path, 'utf-8'), 'fake mp4');
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /npx/);
  assert.deepStrictEqual(calls[0].args, ['hyperframes', 'render']);
  assert.equal(calls[0].cwd, projectDir);

  const failed = await renderer.renderHyperframesProject({
    projectDir,
    runCommand: async () => ({ ok: false, code: 1, stdout: '', stderr: 'render failed' }),
  });
  assert.equal(failed.success, false);
  assert.match(failed.message, /render failed/);
}

run().then(() => {
  console.log('hyperframes renderer tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node test-hyperframes-renderer.js
```

Expected: fail with module-not-found for `./server/services/hyperframesRenderer`.

## Task 4: Implement Renderer

**Files:**

- Create: `server/services/hyperframesRenderer.js`

- [ ] **Step 1: Create renderer service**

Create `server/services/hyperframesRenderer.js`:

```js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function getNpxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      resolve({ ok: false, code: null, error: error.message, stdout, stderr });
    });
    child.on('close', code => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function renderHyperframesProject({ projectDir, runCommand: runCommandImpl = runCommand } = {}) {
  if (!projectDir || !fs.existsSync(path.join(projectDir, 'index.html'))) {
    return {
      success: false,
      message: '渲染失败：未找到 HyperFrames 工程入口 index.html。',
    };
  }

  const result = await runCommandImpl(getNpxCommand(), ['hyperframes', 'render'], {
    cwd: projectDir,
  });

  if (!result.ok) {
    return {
      success: false,
      message: `HyperFrames 渲染失败：${result.error || result.stderr || result.stdout || `exit ${result.code}`}`,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const outputPath = path.join(projectDir, 'output.mp4');
  if (!fs.existsSync(outputPath)) {
    return {
      success: false,
      message: 'HyperFrames 渲染失败：未生成 output.mp4。',
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    success: true,
    output_path: outputPath,
    message: '视频渲染完成。',
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

module.exports = {
  getNpxCommand,
  runCommand,
  renderHyperframesProject,
};
```

- [ ] **Step 2: Run GREEN**

Run:

```bash
node test-hyperframes-renderer.js
```

Expected: `hyperframes renderer tests passed`.

## Task 5: Agent Integration RED Test

**Files:**

- Modify: `test-agent-runs.js`

- [ ] **Step 1: Add service integration tests**

In `test-agent-runs.js`, after the existing TTS test and `detailAfterTts` assertions, add:

```js
  const projectResult = await agentRuns.createDouyinRunHyperframesProject(awemeId, generated.run_id, {
    rootDir,
    hyperframesProject: {
      createOriginalCaptionProject: async ({ run, projectDir }) => {
        assert.equal(run.run_id, generated.run_id);
        assert.ok(run.tts.captions.length > 0);
        fs.mkdirSync(projectDir, { recursive: true });
        const indexPath = path.join(projectDir, 'index.html');
        fs.writeFileSync(indexPath, '<html>project</html>');
        return {
          success: true,
          template: 'original_caption_cards',
          project_dir: projectDir,
          index_path: indexPath,
          duration: 1.25,
          message: '视频工程已生成。',
        };
      },
    },
  });
  assert.equal(projectResult.success, true);
  assert.equal(projectResult.video.status, 'project_ready');
  assert.equal(projectResult.video.template, 'original_caption_cards');
  assert.ok(projectResult.video.project_dir.includes(`${generated.run_id}-hyperframes`));

  const renderResult = await agentRuns.renderDouyinRunHyperframesVideo(awemeId, generated.run_id, {
    rootDir,
    hyperframesRenderer: {
      renderHyperframesProject: async ({ projectDir }) => {
        const outputPath = path.join(projectDir, 'output.mp4');
        fs.writeFileSync(outputPath, 'fake mp4');
        return { success: true, output_path: outputPath, message: '视频渲染完成。' };
      },
    },
  });
  assert.equal(renderResult.success, true);
  assert.equal(renderResult.video.status, 'rendered');
  assert.ok(renderResult.video.output_url.includes(`/api/agents/douyin/${awemeId}/runs/${generated.run_id}/hyperframes/files/output.mp4`));
  assert.equal(fs.readFileSync(renderResult.video.output_path, 'utf-8'), 'fake mp4');

  const detailAfterVideo = await agentRuns.getDouyinAgentRun(awemeId, generated.run_id, { rootDir });
  assert.equal(detailAfterVideo.data.video.status, 'rendered');
```

- [ ] **Step 2: Add route integration test**

Near the existing route test that mocks `createDouyinAgentRun` and `synthesizeDouyinRunTts`, save and mock these functions:

```js
  const originalCreateDouyinRunHyperframesProject = agentRuns.createDouyinRunHyperframesProject;
  const originalRenderDouyinRunHyperframesVideo = agentRuns.renderDouyinRunHyperframesVideo;
```

Then mock:

```js
  agentRuns.createDouyinRunHyperframesProject = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    message: '视频工程已生成。',
    video: { status: 'project_ready', template: 'original_caption_cards' },
  });
  agentRuns.renderDouyinRunHyperframesVideo = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    message: '视频渲染完成。',
    video: { status: 'rendered', output_url: `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes/files/output.mp4` },
  });
```

Inside the route test `try` block, after the TTS route assertion, add:

```js
    const projectResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes/project`, {});
    assert.strictEqual(projectResponse.statusCode, 200);
    assert.strictEqual(projectResponse.body.success, true);
    assert.strictEqual(projectResponse.body.video.status, 'project_ready');

    const renderResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes/render`, {});
    assert.strictEqual(renderResponse.statusCode, 200);
    assert.strictEqual(renderResponse.body.success, true);
    assert.strictEqual(renderResponse.body.video.status, 'rendered');
```

Inside `finally`, restore:

```js
    agentRuns.createDouyinRunHyperframesProject = originalCreateDouyinRunHyperframesProject;
    agentRuns.renderDouyinRunHyperframesVideo = originalRenderDouyinRunHyperframesVideo;
```

- [ ] **Step 3: Run RED**

Run:

```bash
node test-agent-runs.js
```

Expected: fail because Agent methods and routes are missing.

## Task 6: Implement Agent Integration

**Files:**

- Modify: `server/services/agentRuns.js`

- [ ] **Step 1: Import services**

At the top:

```js
const defaultHyperframesProject = require('./hyperframesProject');
const defaultHyperframesRenderer = require('./hyperframesRenderer');
```

- [ ] **Step 2: Add helper functions**

Near TTS helper functions:

```js
function getHyperframesProjectDir(awemeId, runId, rootDir) {
  return path.join(getAgentRunsDir(awemeId, rootDir), `${runId}-hyperframes`);
}

function getHyperframesFileUrl(awemeId, runId, fileName) {
  return `/api/agents/douyin/${encodeURIComponent(String(awemeId))}/runs/${encodeURIComponent(String(runId))}/hyperframes/files/${encodeURIComponent(fileName)}`;
}
```

- [ ] **Step 3: Add project creation method**

Add before `module.exports`:

```js
async function createDouyinRunHyperframesProject(awemeId, runId, options = {}) {
  if (!isSafeId(awemeId)) return createInvalidAwemeResult(awemeId);
  if (!isSafeRunId(runId)) {
    return { success: false, aweme_id: String(awemeId || ''), run_id: String(runId || ''), message: '未找到或非法的 Agent 运行记录' };
  }

  const runPath = getRunPath(awemeId, runId, options.rootDir);
  const run = await readJsonIfExists(runPath);
  if (!run) {
    return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: '未找到该 Agent 运行记录' };
  }

  const projectService = options.hyperframesProject || defaultHyperframesProject;
  const projectDir = getHyperframesProjectDir(awemeId, runId, options.rootDir);
  const result = await projectService.createOriginalCaptionProject({ run, projectDir });

  if (!result.success) {
    const video = {
      status: 'failed',
      template: 'original_caption_cards',
      message: result.message || '视频工程生成失败。',
      updated_at: new Date().toISOString(),
    };
    await writeJson(runPath, { ...run, video, updated_at: new Date().toISOString() });
    return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video };
  }

  const video = {
    status: 'project_ready',
    template: result.template,
    project_dir: result.project_dir,
    index_path: result.index_path,
    duration: result.duration,
    message: result.message || '视频工程已生成。',
    updated_at: new Date().toISOString(),
  };
  await writeJson(runPath, { ...run, video, updated_at: new Date().toISOString() });
  return { success: true, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video };
}
```

- [ ] **Step 4: Add render method**

Add:

```js
async function renderDouyinRunHyperframesVideo(awemeId, runId, options = {}) {
  if (!isSafeId(awemeId)) return createInvalidAwemeResult(awemeId);
  if (!isSafeRunId(runId)) {
    return { success: false, aweme_id: String(awemeId || ''), run_id: String(runId || ''), message: '未找到或非法的 Agent 运行记录' };
  }

  const runPath = getRunPath(awemeId, runId, options.rootDir);
  const run = await readJsonIfExists(runPath);
  if (!run) {
    return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: '未找到该 Agent 运行记录' };
  }

  const projectDir = run.video?.project_dir || getHyperframesProjectDir(awemeId, runId, options.rootDir);
  const renderer = options.hyperframesRenderer || defaultHyperframesRenderer;
  const result = await renderer.renderHyperframesProject({ projectDir });

  if (!result.success) {
    const video = {
      ...(run.video || {}),
      status: 'failed',
      message: result.message || '视频渲染失败。',
      updated_at: new Date().toISOString(),
    };
    await writeJson(runPath, { ...run, video, updated_at: new Date().toISOString() });
    return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video };
  }

  const video = {
    ...(run.video || {}),
    status: 'rendered',
    template: run.video?.template || 'original_caption_cards',
    project_dir: projectDir,
    output_path: result.output_path,
    output_url: getHyperframesFileUrl(awemeId, runId, 'output.mp4'),
    message: result.message || '视频渲染完成。',
    updated_at: new Date().toISOString(),
  };
  await writeJson(runPath, { ...run, video, updated_at: new Date().toISOString() });
  return { success: true, aweme_id: String(awemeId), run_id: String(runId), message: video.message, video };
}
```

- [ ] **Step 5: Add file resolver**

Add:

```js
function resolveDouyinRunHyperframesFile(awemeId, runId, fileName, options = {}) {
  if (!isSafeId(awemeId) || !isSafeRunId(runId)) {
    throw new Error('Invalid HyperFrames file request');
  }

  const name = String(fileName || '');
  if (!name || path.basename(name) !== name || name !== 'output.mp4') {
    throw new Error('Invalid HyperFrames file request');
  }

  const projectDir = path.resolve(getHyperframesProjectDir(awemeId, runId, options.rootDir));
  const targetPath = path.resolve(projectDir, name);
  const relative = path.relative(projectDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('HyperFrames file is outside project directory');
  }

  return targetPath;
}
```

- [ ] **Step 6: Export new methods**

In `module.exports`, add:

```js
  createDouyinRunHyperframesProject,
  renderDouyinRunHyperframesVideo,
  resolveDouyinRunHyperframesFile,
```

- [ ] **Step 7: Run test**

Run:

```bash
node test-agent-runs.js
```

Expected: still failing until routes are added.

## Task 7: Add Routes

**Files:**

- Modify: `server/routes/agents.js`

- [ ] **Step 1: Add project route**

After TTS routes, add:

```js
router.post('/douyin/:aweme_id/runs/:run_id/hyperframes/project', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinRunHyperframesProject(req.params.aweme_id, req.params.run_id);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '视频工程生成接口异常，请稍后重试。',
    });
  }
});
```

- [ ] **Step 2: Add render route**

Add:

```js
router.post('/douyin/:aweme_id/runs/:run_id/hyperframes/render', async (req, res) => {
  try {
    const result = await agentRuns.renderDouyinRunHyperframesVideo(req.params.aweme_id, req.params.run_id);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '视频渲染接口异常，请稍后重试。',
    });
  }
});
```

- [ ] **Step 3: Add MP4 file route**

Add:

```js
router.get('/douyin/:aweme_id/runs/:run_id/hyperframes/files/:file_name', (req, res) => {
  try {
    const filePath = agentRuns.resolveDouyinRunHyperframesFile(req.params.aweme_id, req.params.run_id, req.params.file_name);
    return res.sendFile(filePath);
  } catch (error) {
    return res.status(400).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '未找到或非法的视频文件。',
    });
  }
});
```

- [ ] **Step 4: Run route tests**

Run:

```bash
node test-agent-runs.js
```

Expected: `agent run tests passed`.

## Task 8: Frontend API

**Files:**

- Modify: `frontend-react/src/api/client.js`

- [ ] **Step 1: Add API helpers**

Add to `api` object:

```js
  createDouyinRunHyperframesProject(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  renderDouyinRunHyperframesVideo(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
```

## Task 9: Frontend Controls

**Files:**

- Modify: `frontend-react/src/pages/AiWorkspace.jsx`
- Modify: `frontend-react/src/styles.css`

- [ ] **Step 1: Add state**

In `AiWorkspace`, near TTS state:

```js
  const [videoGenerating, setVideoGenerating] = useState(false);
  const [videoRendering, setVideoRendering] = useState(false);
```

- [ ] **Step 2: Add handlers**

Add before `return`:

```js
  async function createVideoProject() {
    const value = selectedAwemeId.trim();
    if (!value || !activeRun?.run_id) {
      setStatus({ type: 'error', message: '请先选择一条已完成 TTS 合成的运行记录。' });
      return;
    }
    if (!activeRun.tts?.captions?.length || !activeRun.tts?.url) {
      setStatus({ type: 'error', message: '请先完成 TTS 合成并生成字幕时间轴。' });
      return;
    }

    setVideoGenerating(true);
    setStatus({ type: 'loading', message: '正在生成 HyperFrames 视频工程...' });
    try {
      const json = await api.createDouyinRunHyperframesProject(value, activeRun.run_id);
      setActiveRun(prev => prev ? { ...prev, video: json.video, updated_at: new Date().toISOString() } : prev);
      setRuns(prev => prev.map(run => (
        run.run_id === activeRun.run_id ? { ...run, video: json.video, updated_at: new Date().toISOString() } : run
      )));
      setStatus({ type: json.success ? 'success' : 'error', message: json.message || '视频工程已生成' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setVideoGenerating(false);
    }
  }

  async function renderVideo() {
    const value = selectedAwemeId.trim();
    if (!value || !activeRun?.run_id) {
      setStatus({ type: 'error', message: '请先选择一条已生成视频工程的运行记录。' });
      return;
    }
    if (!activeRun.video?.project_dir) {
      setStatus({ type: 'error', message: '请先生成视频工程。' });
      return;
    }

    setVideoRendering(true);
    setStatus({ type: 'loading', message: '正在调用 HyperFrames 渲染 MP4...' });
    try {
      const json = await api.renderDouyinRunHyperframesVideo(value, activeRun.run_id);
      setActiveRun(prev => prev ? { ...prev, video: json.video, updated_at: new Date().toISOString() } : prev);
      setRuns(prev => prev.map(run => (
        run.run_id === activeRun.run_id ? { ...run, video: json.video, updated_at: new Date().toISOString() } : run
      )));
      setStatus({ type: json.success ? 'success' : 'error', message: json.message || '视频渲染完成' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setVideoRendering(false);
    }
  }
```

- [ ] **Step 3: Render video controls**

Inside the existing TTS playback section, after caption list, add:

```jsx
                  <div className="videoProjectPanel">
                    <div className="videoProjectActions">
                      <Button size="sm" variant="secondary" disabled={videoGenerating || videoRendering} onClick={createVideoProject}>
                        {videoGenerating ? '生成中...' : '生成视频工程'}
                      </Button>
                      <Button size="sm" disabled={videoGenerating || videoRendering || !activeRun.video?.project_dir} onClick={renderVideo}>
                        {videoRendering ? '渲染中...' : '渲染 MP4'}
                      </Button>
                    </div>
                    {activeRun.video ? (
                      <div className="videoProjectMeta">
                        <span>{activeRun.video.message || '视频工程状态已更新'}</span>
                        {activeRun.video.project_dir ? <code>{activeRun.video.project_dir}</code> : null}
                        {activeRun.video.output_url ? (
                          <video controls src={activeRun.video.output_url} />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
```

- [ ] **Step 4: Add styles**

In `styles.css`, near `.ttsPlayback`, add:

```css
.videoProjectPanel { display: grid; gap: 10px; margin-top: 12px; padding: 12px; border: 1px solid #edf0f4; border-radius: 8px; background: #fff; }
.videoProjectActions { display: flex; gap: 8px; flex-wrap: wrap; }
.videoProjectMeta { display: grid; gap: 8px; color: #69717e; font-size: 12px; }
.videoProjectMeta code { display: block; padding: 8px; border-radius: 8px; background: #fafbfc; color: #30343b; word-break: break-all; }
.videoProjectMeta video { width: 100%; max-height: 360px; background: #0f1115; border-radius: 8px; }
```

- [ ] **Step 5: Build frontend**

Run:

```bash
npm run build:frontend
```

Expected: build succeeds.

## Task 10: Test Script

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Add new tests**

Add the new test files to `npm test` after `test-tts-timeline.js`:

```json
"test": "node test-runtime-env.js && node test-ai-text-model.js && node test-ai-tts-model.js && node test-tts-timeline.js && node test-hyperframes-project.js && node test-hyperframes-renderer.js && node test-agent-templates.js && node test-agent-runs.js && node test-agent-run-utils.mjs && node test-media-tasks.js && node test-media-routes.js && node test-media-pipeline.js && node test-media-pipeline-cache.js && node test-content-utils.mjs && node test-media-assets-utils.mjs && node test-table-utils.mjs && node test-workspace-params.mjs && node test-comment-cache-utils.mjs"
```

- [ ] **Step 2: Run all tests**

Run:

```bash
npm test
```

Expected: all tests pass.

## Task 11: Manual Verification

**Files:**

- No source changes unless verification reveals a bug.

- [ ] **Step 1: Restart backend**

Run in PowerShell:

```powershell
$listener = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1
if ($listener) { Stop-Process -Id $listener.OwningProcess -Force; Start-Sleep -Seconds 1 }
Start-Process -FilePath node -ArgumentList 'server/index.js' -WorkingDirectory 'D:\code3\MediaCrawler-GUI' -WindowStyle Hidden
```

- [ ] **Step 2: Verify route existence**

Run:

```powershell
try {
  Invoke-WebRequest -UseBasicParsing -Method Post -ContentType 'application/json' -Body '{}' http://127.0.0.1:3000/api/agents/douyin/1234567890/runs/missing-run/hyperframes/project
} catch {
  [int]$_.Exception.Response.StatusCode
}
```

Expected: `400`, not `404`.

- [ ] **Step 3: Verify UI flow**

Open:

```text
http://127.0.0.1:3000/ai
```

Use a run that already has TTS audio and caption timeline:

1. Click `生成视频工程`.
2. Confirm project path appears.
3. Click `渲染 MP4`.
4. If HyperFrames CLI is not installed, read the error and install/run via `npx` when prompted.
5. Confirm `output.mp4` exists under:

```text
data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/output.mp4
```

## HyperFrames Notes

Official README states:

- HyperFrames turns HTML/CSS/media/seekable animations into deterministic MP4.
- Manual CLI flow is:

```bash
npx hyperframes init my-video
cd my-video
npx hyperframes preview
npx hyperframes render
```

- Requirements are Node.js 22+ and FFmpeg.

For this project, do not call `init` at runtime. The backend writes a complete project directory itself, then runs:

```bash
npx hyperframes render
```

with `cwd` set to the generated project directory.

## Verification Checklist

- [ ] `node test-hyperframes-project.js`
- [ ] `node test-hyperframes-renderer.js`
- [ ] `node test-agent-runs.js`
- [ ] `npm test`
- [ ] `npm run build:frontend`
- [ ] Route check returns `400`, not `404`
- [ ] AI 工作台 shows `生成视频工程`
- [ ] AI 工作台 shows `渲染 MP4`
- [ ] `output.mp4` is generated for a run with `tts.captions`
- [ ] Final video does not use original video frames or original video background
