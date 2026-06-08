# TTS Caption Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade AI 工作台 TTS 合成 from one-shot full-script synthesis to sentence-level TTS with audio duration probing and a reusable caption timeline.

**Architecture:** Split `rewrite_script` into subtitle-friendly sentences, synthesize each sentence separately with MiMo TTS, read each segment duration with `ffprobe`, build cumulative `captions`, then concatenate segment audio into the existing final TTS audio file. HyperFrames or later video generation should consume the saved `tts.captions` timeline instead of guessing subtitle timings.

**Tech Stack:** Node.js 22, Express, MiMo TTS v2.5, FFmpeg/ffprobe, existing `agentRuns` service, React AI 工作台.

---

## Current Context

The project is on `dev` branch. Existing TTS work already added:

- `server/services/aiTtsModel.js`
- `server/services/agentRuns.js#synthesizeDouyinRunTts`
- `server/routes/agents.js` TTS route
- `frontend-react/src/pages/AiWorkspace.jsx` TTS controls
- `test-ai-tts-model.js`

Important: there may be an interrupted partial RED test already present in `test-agent-runs.js`. Before implementation, run:

```bash
git diff -- test-agent-runs.js
```

If the diff contains an unfinished TTS timeline test, either reuse it as the RED test or cleanly replace it with the test in this plan. Do not blindly duplicate it.

## Target Architecture

```mermaid
flowchart LR
  A["改写脚本"] --> B["按句切分"]
  B --> C["逐句 TTS"]
  C --> D["ffprobe 读取每段时长"]
  D --> E["生成字幕时间轴"]
  E --> F["生成 HyperFrames 工程"]
  F --> G["渲染 MP4"]
```

This plan implements `A` through `E` and leaves `F/G` for the next feature.

## Target Data Shape

Each run JSON should save TTS metadata like:

```json
{
  "tts": {
    "status": "done",
    "voice": "Mia",
    "style_prompt": "请使用自然、清晰、适合短视频口播的语气。",
    "format": "wav",
    "path": "D:/code3/MediaCrawler-GUI/data/media/douyin/<aweme_id>/agent_runs/<run_id>-tts.wav",
    "url": "/api/agents/douyin/<aweme_id>/runs/<run_id>/tts/<run_id>-tts.wav",
    "duration": 3.75,
    "segments": [
      {
        "index": 1,
        "text": "第一句。",
        "duration": 1.25,
        "path": "D:/code3/MediaCrawler-GUI/data/media/douyin/<aweme_id>/agent_runs/<run_id>-tts-segments/segment-001.wav"
      },
      {
        "index": 2,
        "text": "第二句！",
        "duration": 2.5,
        "path": "D:/code3/MediaCrawler-GUI/data/media/douyin/<aweme_id>/agent_runs/<run_id>-tts-segments/segment-002.wav"
      }
    ],
    "captions": [
      {
        "index": 1,
        "start": 0,
        "end": 1.25,
        "duration": 1.25,
        "text": "第一句。"
      },
      {
        "index": 2,
        "start": 1.25,
        "end": 3.75,
        "duration": 2.5,
        "text": "第二句！"
      }
    ],
    "model": {
      "provider": "mimo",
      "model_id": "mimo-v2.5-tts"
    },
    "message": "TTS 语音合成完成。",
    "updated_at": "2026-06-09T00:00:00.000Z"
  }
}
```

## File Structure

- Create `server/services/ttsTimeline.js`
  - Owns script sentence splitting, caption timeline calculation, ffprobe duration probing, and ffmpeg audio concatenation.

- Modify `server/services/agentRuns.js`
  - Uses `ttsTimeline` inside `synthesizeDouyinRunTts`.
  - Saves segment files, final combined audio, `segments`, `captions`, and total duration.
  - Supports dependency injection for tests.

- Modify `frontend-react/src/pages/AiWorkspace.jsx`
  - Shows saved caption timeline under the TTS audio player.

- Modify `frontend-react/src/styles.css`
  - Adds compact caption timeline styles.

- Create `test-tts-timeline.js`
  - Unit tests for splitting and caption timeline utilities.

- Modify `test-agent-runs.js`
  - Integration-style test for sentence-level TTS synthesis and run JSON persistence.

- Modify `package.json`
  - Add `node test-tts-timeline.js` to `npm test`.

## Task 1: Add Timeline Utility Tests

**Files:**

- Create: `test-tts-timeline.js`
- Create later: `server/services/ttsTimeline.js`

- [ ] **Step 1: Write the failing test**

Create `test-tts-timeline.js`:

```js
const assert = require('assert');
const timeline = require('./server/services/ttsTimeline');

function run() {
  assert.deepStrictEqual(
    timeline.splitScriptIntoSentences('第一句。第二句！第三句？第四句\n第五句'),
    ['第一句。', '第二句！', '第三句？', '第四句', '第五句'],
  );

  assert.deepStrictEqual(
    timeline.splitScriptIntoSentences('  开头没有标点  \n\n  还有一句。 '),
    ['开头没有标点', '还有一句。'],
  );

  const captions = timeline.buildCaptionsFromSegments([
    { index: 1, text: '第一句。', duration: 1.25, path: 'segment-001.wav' },
    { index: 2, text: '第二句！', duration: 2.5, path: 'segment-002.wav' },
  ]);

  assert.deepStrictEqual(captions, [
    { index: 1, start: 0, end: 1.25, duration: 1.25, text: '第一句。' },
    { index: 2, start: 1.25, end: 3.75, duration: 2.5, text: '第二句！' },
  ]);

  assert.deepStrictEqual(timeline.buildCaptionsFromSegments([]), []);
}

try {
  run();
  console.log('tts timeline tests passed');
} catch (error) {
  console.error(error);
  process.exit(1);
}
```

- [ ] **Step 2: Run RED**

Run:

```bash
node test-tts-timeline.js
```

Expected: fail with module-not-found for `./server/services/ttsTimeline`.

## Task 2: Implement `ttsTimeline.js`

**Files:**

- Create: `server/services/ttsTimeline.js`

- [ ] **Step 1: Implement minimal utility module**

Create `server/services/ttsTimeline.js`:

```js
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function roundTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function splitScriptIntoSentences(text) {
  const input = typeof text === 'string' ? text.trim() : '';
  if (!input) return [];

  const normalized = input
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const matches = normalized.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [];
  return matches
    .map(item => item.trim())
    .filter(Boolean);
}

function buildCaptionsFromSegments(segments = []) {
  let cursor = 0;
  return segments.map((segment, index) => {
    const duration = roundTime(segment.duration);
    const start = roundTime(cursor);
    const end = roundTime(cursor + duration);
    cursor = end;
    return {
      index: Number(segment.index || index + 1),
      start,
      end,
      duration,
      text: typeof segment.text === 'string' ? segment.text : '',
    };
  });
}

async function getExistingExecutable(filePath) {
  if (!filePath) return '';
  try {
    const stats = await fsp.stat(filePath);
    return stats.isFile() && stats.size > 0 ? filePath : '';
  } catch {
    return '';
  }
}

async function resolveFfprobePath(options = {}) {
  const explicitPath = options.ffprobePath || process.env.FFPROBE_PATH;
  const resolvedExplicitPath = await getExistingExecutable(explicitPath);
  if (resolvedExplicitPath) return resolvedExplicitPath;

  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    const siblingName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const siblingPath = path.join(path.dirname(installer.path), siblingName);
    const resolvedSiblingPath = await getExistingExecutable(siblingPath);
    if (resolvedSiblingPath) return resolvedSiblingPath;
  } catch {
    // Optional dependency fallback. If it is not installed, use PATH lookup below.
  }

  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
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

async function readAudioDuration(filePath, options = {}) {
  const ffprobePath = await resolveFfprobePath(options);
  const result = await runCommand(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);

  if (!result.ok) {
    return {
      success: false,
      message: `读取音频时长失败：${result.error || result.stderr || `ffprobe exited ${result.code}`}`,
    };
  }

  const duration = Number.parseFloat(String(result.stdout || '').trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    return {
      success: false,
      message: '读取音频时长失败：ffprobe 未返回有效时长。',
    };
  }

  return {
    success: true,
    duration: roundTime(duration),
  };
}

async function resolveFfmpegPath(options = {}) {
  const explicitPath = options.ffmpegPath || process.env.FFMPEG_PATH;
  const resolvedExplicitPath = await getExistingExecutable(explicitPath);
  if (resolvedExplicitPath) return resolvedExplicitPath;

  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    const bundledPath = await getExistingExecutable(installer.path);
    if (bundledPath) return bundledPath;
  } catch {
    // Optional dependency fallback. If it is not installed, use PATH lookup below.
  }

  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

async function concatenateAudioFiles({ inputPaths, targetPath, options = {} }) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    return { success: false, message: '没有可拼接的 TTS 分段音频。' };
  }

  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const listPath = path.join(path.dirname(targetPath), `${path.basename(targetPath)}.concat.txt`);
  const listText = inputPaths
    .map(item => `file '${String(item).replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fsp.writeFile(listPath, listText, 'utf-8');

  const ffmpegPath = await resolveFfmpegPath(options);
  const result = await runCommand(ffmpegPath, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    targetPath,
  ]);

  await fsp.rm(listPath, { force: true });

  if (!result.ok) {
    return {
      success: false,
      message: `拼接 TTS 分段音频失败：${result.error || result.stderr || `ffmpeg exited ${result.code}`}`,
    };
  }

  if (!fs.existsSync(targetPath)) {
    return { success: false, message: '拼接 TTS 分段音频失败：未生成目标音频文件。' };
  }

  return { success: true, path: targetPath };
}

module.exports = {
  splitScriptIntoSentences,
  buildCaptionsFromSegments,
  resolveFfprobePath,
  readAudioDuration,
  concatenateAudioFiles,
};
```

- [ ] **Step 2: Run GREEN**

Run:

```bash
node test-tts-timeline.js
```

Expected: `tts timeline tests passed`.

## Task 3: Add Agent Run RED Test

**Files:**

- Modify: `test-agent-runs.js`

- [ ] **Step 1: Add or normalize TTS timeline test**

Find the existing assertion after:

```js
assert.strictEqual(detail.data.result.rewrite_script, '改写脚本');
```

Add this block if it is not already present. If a partial version exists, replace it with this exact block:

```js
  const ttsInputs = [];
  const durationQueue = [1.25];
  const ttsResult = await agentRuns.synthesizeDouyinRunTts(awemeId, generated.run_id, {
    rootDir,
    voice: 'Mia',
    stylePrompt: 'warm natural delivery',
    ttsModel: {
      callTtsModel: async options => {
        ttsInputs.push(options);
        return {
          success: true,
          status: 'done',
          message: 'TTS ok',
          audioBuffer: Buffer.from(`fake wav data ${ttsInputs.length}`),
          format: 'wav',
          voice: options.voice,
          model: { provider: 'mimo', model_id: 'mimo-v2.5-tts' },
        };
      },
    },
    readAudioDuration: async () => durationQueue.shift(),
    concatenateAudio: async ({ targetPath }) => {
      fs.writeFileSync(targetPath, 'combined wav data');
      return { success: true, path: targetPath };
    },
  });
  assert.strictEqual(ttsResult.success, true);
  assert.deepStrictEqual(ttsInputs.map(item => item.text), ['改写脚本']);
  assert.strictEqual(ttsInputs[0].voice, 'Mia');
  assert.strictEqual(ttsInputs[0].stylePrompt, 'warm natural delivery');
  assert.strictEqual(ttsResult.tts.voice, 'Mia');
  assert.strictEqual(ttsResult.tts.format, 'wav');
  assert.ok(ttsResult.tts.url.includes(`/api/agents/douyin/${awemeId}/runs/${generated.run_id}/tts/`));
  assert.strictEqual(fs.readFileSync(ttsResult.tts.path, 'utf-8'), 'combined wav data');
  assert.deepStrictEqual(ttsResult.tts.captions, [
    { index: 1, start: 0, end: 1.25, duration: 1.25, text: '改写脚本' },
  ]);
  assert.strictEqual(ttsResult.tts.duration, 1.25);
  assert.strictEqual(ttsResult.tts.segments.length, 1);
  assert.ok(fs.existsSync(ttsResult.tts.segments[0].path));

  const detailAfterTts = await agentRuns.getDouyinAgentRun(awemeId, generated.run_id, { rootDir });
  assert.strictEqual(detailAfterTts.data.tts.voice, 'Mia');
  assert.strictEqual(detailAfterTts.data.tts.status, 'done');
  assert.deepStrictEqual(detailAfterTts.data.tts.captions, ttsResult.tts.captions);
```

- [ ] **Step 2: Run RED**

Run:

```bash
node test-agent-runs.js
```

Expected: fail because `tts.captions`, `tts.segments`, or dependency injection behavior is not implemented yet.

## Task 4: Upgrade `synthesizeDouyinRunTts`

**Files:**

- Modify: `server/services/agentRuns.js`

- [ ] **Step 1: Import `ttsTimeline`**

Near the existing service imports, add:

```js
const ttsTimeline = require('./ttsTimeline');
```

- [ ] **Step 2: Add helper functions**

Near `getTtsPath`, add:

```js
function getTtsSegmentsDir(awemeId, runId, rootDir) {
  return path.join(getAgentRunsDir(awemeId, rootDir), `${runId}-tts-segments`);
}

function getTtsSegmentFileName(index, format = 'wav') {
  const safeFormat = String(format || 'wav').replace(/[^A-Za-z0-9]/g, '') || 'wav';
  return `segment-${String(index).padStart(3, '0')}.${safeFormat}`;
}
```

- [ ] **Step 3: Replace the one-shot synthesis block**

Inside `synthesizeDouyinRunTts`, replace the current single `ttsModel.callTtsModel({ text: rewriteScript, ... })` flow with this sentence-level flow:

```js
  const sentences = ttsTimeline.splitScriptIntoSentences(rewriteScript);
  if (!sentences.length) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '当前运行结果没有可用于 TTS 合成的有效句子。',
    };
  }

  const ttsModel = options.ttsModel || defaultAiTtsModel;
  const readAudioDuration = options.readAudioDuration || (async filePath => {
    const result = await ttsTimeline.readAudioDuration(filePath, options);
    if (!result.success) throw new Error(result.message);
    return result.duration;
  });
  const concatenateAudio = options.concatenateAudio || ttsTimeline.concatenateAudioFiles;
  const requestedFormat = options.format || 'wav';
  const segmentsDir = getTtsSegmentsDir(awemeId, runId, options.rootDir);
  await fsp.rm(segmentsDir, { recursive: true, force: true });
  await fsp.mkdir(segmentsDir, { recursive: true });

  const segments = [];
  let model = {};
  let format = requestedFormat;
  let resolvedVoice = options.voice || '';

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    const modelResult = await ttsModel.callTtsModel({
      text: sentence,
      voice: options.voice,
      stylePrompt: options.stylePrompt,
      format: requestedFormat,
      configPath: options.configPath,
      ttsConfig: options.ttsConfig,
      fetchImpl: options.fetchImpl,
    });

    if (!modelResult.success) {
      const failedTts = {
        status: modelResult.status || 'failed',
        voice: options.voice || '',
        style_prompt: options.stylePrompt || '',
        message: modelResult.message || `第 ${index + 1} 句 TTS 合成失败`,
        model: modelResult.model || {},
        updated_at: new Date().toISOString(),
      };
      const updatedRun = { ...run, tts: failedTts, updated_at: new Date().toISOString() };
      await writeJson(runPath, updatedRun);
      return {
        success: false,
        aweme_id: String(awemeId),
        run_id: String(runId),
        message: failedTts.message,
        tts: failedTts,
      };
    }

    format = modelResult.format || format;
    resolvedVoice = modelResult.voice || resolvedVoice;
    model = modelResult.model || model;
    const segmentFileName = getTtsSegmentFileName(index + 1, format);
    const segmentPath = path.join(segmentsDir, segmentFileName);
    await writeBinary(segmentPath, modelResult.audioBuffer);
    const duration = await readAudioDuration(segmentPath);
    segments.push({
      index: index + 1,
      text: sentence,
      duration,
      path: segmentPath,
    });
  }

  const fileName = getTtsFileName(runId, format);
  const filePath = getTtsPath(awemeId, runId, format, options.rootDir);
  const concatResult = await concatenateAudio({
    inputPaths: segments.map(segment => segment.path),
    targetPath: filePath,
    options,
  });

  if (concatResult && concatResult.success === false) {
    const failedTts = {
      status: 'failed',
      voice: resolvedVoice,
      style_prompt: options.stylePrompt || '',
      message: concatResult.message || '拼接 TTS 分段音频失败',
      model,
      segments,
      updated_at: new Date().toISOString(),
    };
    const updatedRun = { ...run, tts: failedTts, updated_at: new Date().toISOString() };
    await writeJson(runPath, updatedRun);
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: failedTts.message,
      tts: failedTts,
    };
  }

  const captions = ttsTimeline.buildCaptionsFromSegments(segments);
  const totalDuration = captions.length ? captions[captions.length - 1].end : 0;

  const tts = {
    status: 'done',
    voice: resolvedVoice,
    style_prompt: options.stylePrompt || '',
    format,
    path: filePath,
    url: getTtsUrl(awemeId, runId, fileName),
    duration: totalDuration,
    segments,
    captions,
    model,
    message: 'TTS 语音合成完成。',
    updated_at: new Date().toISOString(),
  };
  const updatedRun = { ...run, tts, updated_at: new Date().toISOString() };
  await writeJson(runPath, updatedRun);

  return {
    success: true,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message: tts.message,
    tts,
  };
```

- [ ] **Step 4: Run Agent test**

Run:

```bash
node test-agent-runs.js
```

Expected: `agent run tests passed`.

## Task 5: Add Captions To Frontend

**Files:**

- Modify: `frontend-react/src/pages/AiWorkspace.jsx`
- Modify: `frontend-react/src/styles.css`

- [ ] **Step 1: Add time formatting helper**

In `AiWorkspace.jsx`, near `getTemplateMeta`, add:

```js
function formatCaptionTime(value) {
  const total = Number(value || 0);
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  const millis = Math.round((total - Math.floor(total)) * 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(2, '0')}`;
}
```

- [ ] **Step 2: Render caption timeline**

In the existing `activeRun.tts?.url` section, after audio metadata, add:

```jsx
                  {Array.isArray(activeRun.tts.captions) && activeRun.tts.captions.length > 0 ? (
                    <div className="ttsCaptionList">
                      {activeRun.tts.captions.map(caption => (
                        <div className="ttsCaptionItem" key={caption.index}>
                          <code>{formatCaptionTime(caption.start)} - {formatCaptionTime(caption.end)}</code>
                          <span>{caption.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
```

- [ ] **Step 3: Add styles**

In `frontend-react/src/styles.css`, near `.ttsPlayback`, add:

```css
.ttsCaptionList { display: grid; gap: 8px; margin-top: 8px; }
.ttsCaptionItem { display: grid; grid-template-columns: 124px minmax(0, 1fr); gap: 10px; align-items: start; padding: 8px 10px; border: 1px solid #edf0f4; border-radius: 8px; background: #fafbfc; }
.ttsCaptionItem code { color: #69717e; font-size: 12px; white-space: nowrap; }
.ttsCaptionItem span { color: #30343b; font-size: 13px; line-height: 1.6; word-break: break-word; }
```

Inside the existing `@media (max-width: 760px)` block, add:

```css
  .ttsCaptionItem { grid-template-columns: 1fr; }
```

- [ ] **Step 4: Build frontend**

Run:

```bash
npm run build:frontend
```

Expected: build succeeds.

## Task 6: Include Tests In `npm test`

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Add timeline test to test script**

In `package.json`, add `node test-tts-timeline.js` after `node test-ai-tts-model.js`:

```json
"test": "node test-runtime-env.js && node test-ai-text-model.js && node test-ai-tts-model.js && node test-tts-timeline.js && node test-agent-templates.js && node test-agent-runs.js && node test-agent-run-utils.mjs && node test-media-tasks.js && node test-media-routes.js && node test-media-pipeline.js && node test-media-pipeline-cache.js && node test-content-utils.mjs && node test-media-assets-utils.mjs && node test-table-utils.mjs && node test-workspace-params.mjs && node test-comment-cache-utils.mjs"
```

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass. Existing `MODULE_TYPELESS_PACKAGE_JSON` warnings may still appear; they are pre-existing and not part of this feature.

## Task 7: Manual Verification

**Files:**

- No source changes unless verification reveals a bug.

- [ ] **Step 1: Start or restart backend**

Run:

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object OwningProcess
```

If an old backend is listening, stop only that process:

```powershell
Stop-Process -Id <OwningProcess> -Force
```

Start:

```powershell
Start-Process -FilePath node -ArgumentList 'server/index.js' -WorkingDirectory 'D:\code3\MediaCrawler-GUI' -WindowStyle Hidden
```

- [ ] **Step 2: Verify TTS route**

Run:

```powershell
try {
  Invoke-WebRequest -UseBasicParsing -Method Post -ContentType 'application/json' -Body '{"voice":"Mia","stylePrompt":"test"}' http://127.0.0.1:3000/api/agents/douyin/1234567890/runs/missing-run/tts
} catch {
  [int]$_.Exception.Response.StatusCode
}
```

Expected: `400`, not `404`. A `400` means the route exists and the missing run is the expected business error.

- [ ] **Step 3: Browser check**

Open:

```text
http://127.0.0.1:3000/ai
```

Use an existing run with `rewrite_script`, click `TTS 合成`, then confirm:

- Audio player appears.
- Caption timeline appears below the player.
- The run JSON contains `tts.captions`.
- Segment audio files exist under:

```text
data/media/douyin/<aweme_id>/agent_runs/<run_id>-tts-segments/
```

## Implementation Notes

- Do not use original video frames as final video visuals for future HyperFrames work. The current feature only creates subtitle timing and audio assets.
- Segment-level TTS is the alignment strategy. Do not estimate subtitle timings by text length.
- `@ffmpeg-installer/ffmpeg` may not include `ffprobe`. `resolveFfprobePath` must support `FFPROBE_PATH` and system `PATH`.
- If `ffprobe` is missing, return a clear Chinese error:

```text
未找到 ffprobe，无法读取分段音频时长。请配置 FFPROBE_PATH 或安装 ffprobe。
```

- Keep generated files inside the selected material run directory:

```text
data/media/douyin/<aweme_id>/agent_runs/
```

- Keep frontend text Chinese by default.

## Verification Checklist

- [ ] `node test-tts-timeline.js`
- [ ] `node test-ai-tts-model.js`
- [ ] `node test-agent-runs.js`
- [ ] `npm test`
- [ ] `npm run build:frontend`
- [ ] Manual route check returns `400` for missing run, not `404`
- [ ] Browser shows audio player and subtitle timeline after TTS synthesis
