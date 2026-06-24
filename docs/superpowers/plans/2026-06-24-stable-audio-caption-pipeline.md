# Stable Audio Caption Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated videos stable when TTS produces abnormal silence, and add settings to skip audio generation and/or visible subtitle generation.

**Architecture:** Add explicit workflow options for `generateAudio` and `generateCaptions`, persist them in app settings and workflow snapshots, then make audio, captions, timeline validation, and render use those options consistently. TTS output becomes a checked artifact: raw duration is diagnostic, effective speech duration drives captions and frame timing.

**Tech Stack:** Node.js CommonJS backend, React settings UI, existing `ffmpeg`/`ffprobe` command helpers, existing assert-based Node tests.

---

## File Map

- Modify: `server/services/appSettings.js`
  - Persist and normalize `creativeDefaults.generateAudio` and `creativeDefaults.generateCaptions`.
- Modify: `frontend-react/src/components/settings/CreativeDefaultsSettings.jsx`
  - Add two Chinese switch controls in Settings Center.
- Modify: `server/services/creativeWorkflows.js`
  - Resolve creative defaults once per workflow and pass stable media options through all stages.
  - Skip audio stage when disabled.
- Modify: `server/services/agentRuns.js`
  - Preserve skipped audio/caption state in `hyperframes_freeform`.
  - Pass media options into html-video project generation.
- Create: `server/services/ttsAudioQuality.js`
  - Inspect raw TTS audio, detect long tail silence, trim clean audio, and return trusted speech duration.
- Modify: `server/services/sceneTts.js`
  - Use `ttsAudioQuality` before building captions.
  - Retry or fail a scene when effective speech duration is unreasonable.
- Modify: `server/services/storyboardTiming.js`
  - Use `speech_duration_sec` when present and ignore raw audio duration for timing.
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
  - Respect `generateAudio` before reusing/regenerating narration audio.
  - Respect `generateCaptions` when building or validating projects.
- Modify: `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`
  - Do not attach frame captions when captions are disabled.
- Modify: `server/services/creative-video/html-video/captionLayer.js`
  - Return no caption layer when captions are disabled.
- Modify: `server/services/creative-video/html-video/timelineConsistency.js`
  - Skip caption consistency checks when captions are disabled.
  - Skip audio hash checks when audio is disabled.
- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`
  - Limit automatic frame extension.
  - Add render-before guard for abnormal total duration.
- Test: `tests/test-app-settings.js`
- Test: `tests/test-creative-workflows.js`
- Test: `tests/test-scene-tts.js`
- Test: `tests/test-storyboard-timing.js`
- Test: `tests/test-html-video-workflow.js`
- Test: `tests/test-html-video-project-orchestrator.js` or nearest existing orchestrator test file.
- Test: `tests/test-system-settings-ui.mjs`

## Invariants

- `raw_duration_sec` is never used for subtitles or render timing.
- `speech_duration_sec` is the trusted audio duration after silence handling.
- Closing "生成旁白音频" means no TTS call, no audio hash requirement, no audio mux.
- Closing "生成字幕" means no visible subtitle layer and no subtitle consistency requirement.
- A single bad scene cannot silently stretch the whole video.

---

### Task 1: Persist Creative Audio/Subtitle Defaults

**Files:**
- Modify: `server/services/appSettings.js`
- Modify: `frontend-react/src/components/settings/CreativeDefaultsSettings.jsx`
- Test: `tests/test-app-settings.js`
- Test: `tests/test-system-settings-ui.mjs`

- [ ] **Step 1: Write failing app settings tests**

Update every complete-object `creativeDefaults` assertion in `tests/test-app-settings.js`, not only new assertions. The existing `deepStrictEqual` blocks at the default read, saved config normalization, and corrupt-read fallback must include the new keys.

For the default read assertion, add:

```js
generateAudio: true,
generateCaptions: true,
```

For the saved config assertion, add explicit false inputs:

```js
generateAudio: false,
generateCaptions: false,
```

and assert:

```js
generateAudio: false,
generateCaptions: false,
```

Keep `assert.deepStrictEqual(afterCorruptRead, appSettings.DEFAULT_CONFIG);`; it will pass once `DEFAULT_CONFIG` contains the new keys.

Also add direct normalization checks:

```js
assert.equal(appSettings.normalizeCreativeDefaults({}).generateAudio, true);
assert.equal(appSettings.normalizeCreativeDefaults({}).generateCaptions, true);
assert.equal(appSettings.normalizeCreativeDefaults({ generateAudio: false }).generateAudio, false);
assert.equal(appSettings.normalizeCreativeDefaults({ generateCaptions: false }).generateCaptions, false);
```

- [ ] **Step 2: Run settings tests and verify failure**

Run:

```powershell
node tests/test-app-settings.js
```

Expected: fails because `generateAudio` / `generateCaptions` are missing.

- [ ] **Step 3: Implement backend defaults**

In `server/services/appSettings.js`, add:

```js
creativeDefaults: {
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
},
```

In `normalizeCreativeDefaults`, add:

```js
generateAudio: typeof source.generateAudio === 'boolean'
  ? source.generateAudio
  : DEFAULT_CONFIG.creativeDefaults.generateAudio,
generateCaptions: typeof source.generateCaptions === 'boolean'
  ? source.generateCaptions
  : DEFAULT_CONFIG.creativeDefaults.generateCaptions,
```

- [ ] **Step 4: Add UI switch tests**

In `tests/test-system-settings-ui.mjs`, assert the settings UI contains the two labels:

```js
assert.match(creativeDefaultsSource, /生成旁白音频/);
assert.match(creativeDefaultsSource, /生成字幕/);
assert.match(creativeDefaultsSource, /generateAudio/);
assert.match(creativeDefaultsSource, /generateCaptions/);
```

- [ ] **Step 5: Add settings UI switches**

In `CreativeDefaultsSettings.jsx`, add defaults:

```js
generateAudio: true,
generateCaptions: true,
```

Add two switch controls near "联网研究默认开启":

```jsx
<label className="switchControl">
  <input
    type="checkbox"
    checked={creativeDefaults.generateAudio !== false}
    disabled={disabled}
    onChange={event => updateCreativeDefaults({ generateAudio: event.target.checked })}
  />
  <span className="switchTrack" aria-hidden="true">
    <span className="switchThumb" />
  </span>
  <span className="switchText">{creativeDefaults.generateAudio !== false ? '已开启' : '已关闭'}</span>
  <span>生成旁白音频</span>
</label>

<label className="switchControl">
  <input
    type="checkbox"
    checked={creativeDefaults.generateCaptions !== false}
    disabled={disabled}
    onChange={event => updateCreativeDefaults({ generateCaptions: event.target.checked })}
  />
  <span className="switchTrack" aria-hidden="true">
    <span className="switchThumb" />
  </span>
  <span className="switchText">{creativeDefaults.generateCaptions !== false ? '已开启' : '已关闭'}</span>
  <span>生成字幕</span>
</label>
```

- [ ] **Step 6: Verify**

Run:

```powershell
node tests/test-app-settings.js
node tests/test-system-settings-ui.mjs
```

Expected: both pass.

---

### Task 2: Propagate Media Options Through Workflow

**Files:**
- Modify: `server/services/creativeWorkflows.js`
- Modify: `server/services/agentRuns.js`
- Test: `tests/test-creative-workflows.js`

- [ ] **Step 1: Write failing workflow tests**

Add a test where creative defaults disable audio:

```js
let audioCalls = 0;
let projectOptionsSeen = null;

const services = {
  ...baseServices,
  appSettings: {
    getCreativeDefaults: async () => ({
      aspectRatio: '9:16',
      targetDurationSec: 60,
      generateAudio: false,
      generateCaptions: false,
    }),
    getEffectiveSystemSettings: async () => ({ skipValidation: false }),
  },
  agentRuns: {
    ...baseServices.agentRuns,
    synthesizeDouyinRunHyperframesFreeformAudio: async () => {
      audioCalls += 1;
      return { success: true };
    },
    generateDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
      projectOptionsSeen = options.projectOptions;
      return htmlVideoLiteDoneResult();
    },
  },
};

const result = await creativeWorkflows.runOneClickCreativeWorkflow(workflowId, { services });

assert.equal(result.success, true);
assert.equal(audioCalls, 0);
assert.equal(projectOptionsSeen.generateAudio, false);
assert.equal(projectOptionsSeen.generateCaptions, false);
```

- [ ] **Step 2: Run workflow test and verify failure**

Run the specific existing workflow test file:

```powershell
node tests/test-creative-workflows.js
```

Expected: fails because audio stage still calls TTS or options are not passed.

- [ ] **Step 3: Implement option resolver**

In `creativeWorkflows.js`, create a local helper near workflow setup:

```js
function resolveMediaGenerationOptions(defaults = {}, target = {}, options = {}) {
  const source = {
    ...defaults,
    ...(target && typeof target === 'object' ? target : {}),
    ...(options.projectOptions && typeof options.projectOptions === 'object' ? options.projectOptions : {}),
  };
  return {
    generateAudio: source.generateAudio !== false,
    generateCaptions: source.generateCaptions !== false,
  };
}
```

Current code already creates `record.creative_defaults_snapshot` when the workflow is created. Use it when present so a queued workflow is reproducible. If the record was created before these fields existed, read realtime settings once as a fallback:

```js
const creativeDefaultsForMedia = record.creative_defaults_snapshot && typeof record.creative_defaults_snapshot === 'object'
  ? record.creative_defaults_snapshot
  : await services.appSettings.getCreativeDefaults(options);
const mediaOptions = resolveMediaGenerationOptions(
  creativeDefaultsForMedia,
  record.target,
  options,
);
```

Also update `buildCreativeDefaultsSnapshot` and `buildWorkflowTarget` so new workflows persist both booleans. In `buildCreativeDefaultsSnapshot`, insert these fields in the returned object immediately after `useResearch`:

```js
generateAudio: typeof overrideSource.generateAudio === 'boolean'
  ? overrideSource.generateAudio
  : defaultsSource.generateAudio !== false,
generateCaptions: typeof overrideSource.generateCaptions === 'boolean'
  ? overrideSource.generateCaptions
  : defaultsSource.generateCaptions !== false,
```

In `buildWorkflowTarget`, insert these fields in the returned object immediately after `lockTemplate`. This is required because `mergeProjectOptions(record.target, existingProjectOptions)` gives the target layer a chance to carry the media options into project generation:

```js
generateAudio: snapshot.generateAudio !== false,
generateCaptions: snapshot.generateCaptions !== false,
```

- [ ] **Step 4: Skip audio stage when disabled**

Replace the current audio stage body with:

```js
stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'audio', rootDir, async () => {
  if (mediaOptions.generateAudio === false) {
    return {
      success: true,
      skipped: true,
      message: '已关闭旁白音频生成，跳过 TTS。',
      audio: {
        status: 'skipped',
        reason: 'disabled_by_settings',
      },
    };
  }
  return ensureSuccess(
    await services.agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(record.aweme_id, record.run_id, {
      rootDir: mediaRoot,
    }),
    '音频轨生成失败。',
  );
}), services, taskContext));
```

- [ ] **Step 5: Pass options into project generation**

When building `existingProjectOptions`, include:

```js
const existingProjectOptions = {
  ...(options.projectOptions && typeof options.projectOptions === 'object' ? options.projectOptions : {}),
  creative_context: record.creative_context,
  generateAudio: mediaOptions.generateAudio,
  generateCaptions: mediaOptions.generateCaptions,
};
```

- [ ] **Step 6: Verify**

Run:

```powershell
node tests/test-creative-workflows.js
```

Expected: pass.

---

### Task 3: Add Audio Quality Inspector

**Files:**
- Create: `server/services/ttsAudioQuality.js`
- Test: `tests/test-tts-audio-quality.js`

- [ ] **Step 1: Write failing unit tests with mocked command runner**

Create `tests/test-tts-audio-quality.js`:

```js
const assert = require('assert');
const quality = require('../server/services/ttsAudioQuality');

(async () => {
  const calls = [];
  const result = await quality.inspectAndCleanAudio({
    inputPath: 'scene-004.wav',
    outputPath: 'scene-004.clean.wav',
    plannedDurationSec: 9,
    runCommand: async (cmd, args) => {
      calls.push({ cmd, args });
      if (args.includes('-show_entries')) return { ok: true, stdout: '231.040000\n' };
      if (args.includes('silencedetect=noise=-45dB:d=1')) {
        return {
          ok: true,
          stderr: [
            'silence_start: 13.495917',
            'silence_end: 230.609 | silence_duration: 217.113083',
          ].join('\n'),
        };
      }
      return { ok: true, stdout: '', stderr: '' };
    },
    getFfprobeCommand: async () => 'ffprobe',
    getFfmpegCommand: async () => 'ffmpeg',
  });

  assert.equal(result.success, true);
  assert.equal(result.trimmed, true);
  assert.equal(result.raw_duration_sec, 231.04);
  assert.equal(result.speech_duration_sec, 13.996);
  assert.equal(result.tail_silence_sec, 217.113);
  assert.ok(calls.some(call => call.args.includes('-t')));

  const abnormal = await quality.inspectAndCleanAudio({
    inputPath: 'bad.wav',
    plannedDurationSec: 9,
    runCommand: async (cmd, args) => {
      if (args.includes('-show_entries')) return { ok: true, stdout: '80\n' };
      if (args.includes('silencedetect=noise=-45dB:d=1')) return { ok: true, stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    },
    getFfprobeCommand: async () => 'ffprobe',
    getFfmpegCommand: async () => 'ffmpeg',
  });

  assert.equal(abnormal.success, false);
  assert.equal(abnormal.code, 'tts_duration_unreasonable');

  console.log('tts audio quality tests passed');
})();
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
node tests/test-tts-audio-quality.js
```

Expected: fails because module does not exist.

- [ ] **Step 3: Implement inspector**

Create `server/services/ttsAudioQuality.js` with these exported functions:

```js
function roundTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function maxAllowedDuration(plannedDurationSec) {
  const planned = Number(plannedDurationSec || 0);
  if (!Number.isFinite(planned) || planned <= 0) return 30;
  return Math.max(planned * 2.5, planned + 8, 20);
}

function parseSilenceDetect(stderr = '') {
  const text = String(stderr || '');
  const starts = [...text.matchAll(/silence_start:\s*([0-9.]+)/g)].map(match => Number(match[1]));
  const ends = [...text.matchAll(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g)]
    .map(match => ({ end: Number(match[1]), duration: Number(match[2]) }));
  return { starts, ends };
}
```

Implement `inspectAndCleanAudio`:

```js
async function inspectAndCleanAudio({
  inputPath,
  outputPath,
  plannedDurationSec,
  runCommand,
  getFfprobeCommand,
  getFfmpegCommand,
  tailPaddingSec = 0.5,
  silenceNoise = '-45dB',
  silenceDurationSec = 1,
} = {}) {
  const ffprobe = await getFfprobeCommand();
  const durationResult = await runCommand(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ]);
  if (!durationResult.ok) {
    return { success: false, code: 'tts_duration_probe_failed', message: '读取 TTS 音频时长失败。' };
  }

  const rawDuration = roundTime(Number.parseFloat(String(durationResult.stdout || '').trim()));
  if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
    return { success: false, code: 'tts_duration_invalid', message: 'TTS 音频时长无效。' };
  }

  const ffmpeg = await getFfmpegCommand();
  const silenceResult = await runCommand(ffmpeg, [
    '-hide_banner',
    '-i', inputPath,
    '-af', `silencedetect=noise=${silenceNoise}:d=${silenceDurationSec}`,
    '-f', 'null',
    'NUL',
  ]);
  const silence = parseSilenceDetect(silenceResult.stderr || silenceResult.stdout || '');
  const lastStart = silence.starts.length ? silence.starts[silence.starts.length - 1] : null;
  const lastEnd = silence.ends.length ? silence.ends[silence.ends.length - 1] : null;
  const isTailSilence = lastStart != null && (!lastEnd || Math.abs(rawDuration - lastEnd.end) <= 1);
  const tailSilence = isTailSilence
    ? roundTime(lastEnd && Number.isFinite(lastEnd.duration) ? lastEnd.duration : rawDuration - lastStart)
    : 0;
  const allowed = maxAllowedDuration(plannedDurationSec);
  const shouldTrim = isTailSilence && tailSilence >= 2.5 && lastStart > 0.5;
  const speechDuration = shouldTrim ? roundTime(lastStart + tailPaddingSec) : rawDuration;

  if (speechDuration > allowed) {
    return {
      success: false,
      code: 'tts_duration_unreasonable',
      message: `TTS 音频时长异常：计划 ${Number(plannedDurationSec || 0).toFixed(2)} 秒，实际 ${speechDuration.toFixed(2)} 秒。`,
      raw_duration_sec: rawDuration,
      speech_duration_sec: speechDuration,
      allowed_duration_sec: roundTime(allowed),
      tail_silence_sec: tailSilence,
    };
  }

  if (shouldTrim && outputPath) {
    const trimResult = await runCommand(ffmpeg, ['-y', '-i', inputPath, '-t', String(speechDuration), outputPath]);
    if (!trimResult.ok) {
      return { success: false, code: 'tts_trim_failed', message: '裁剪 TTS 长尾静音失败。' };
    }
  }

  return {
    success: true,
    path: shouldTrim && outputPath ? outputPath : inputPath,
    raw_path: inputPath,
    raw_duration_sec: rawDuration,
    speech_duration_sec: speechDuration,
    tail_silence_sec: tailSilence,
    trimmed: shouldTrim,
  };
}
```

Export:

```js
module.exports = {
  inspectAndCleanAudio,
  parseSilenceDetect,
  maxAllowedDuration,
};
```

- [ ] **Step 4: Verify**

Run:

```powershell
node tests/test-tts-audio-quality.js
```

Expected: pass.

---

### Task 4: Integrate Audio Quality Into Scene TTS

**Files:**
- Modify: `server/services/sceneTts.js`
- Modify: `server/services/storyboardTiming.js`
- Test: `tests/test-scene-tts.js`
- Test: `tests/test-storyboard-timing.js`

- [ ] **Step 1: Write failing scene TTS test**

Add a test where `readAudioDuration` returns `231.04`, but `audioQuality.inspectAndCleanAudio` returns clean `13.996`:

```js
const qualityCalls = [];
const result = await sceneTts.synthesizeSceneTts({
  scenes: [{ index: 1, duration: 9, narration_text: '测试旁白。' }],
  outputDir: root,
  runId: 'run-quality',
  ttsModel: {
    callTtsModel: async () => ({
      success: true,
      audioBuffer: Buffer.from('fake audio'),
      format: 'wav',
      model: { model_id: 'tts-test' },
    }),
  },
  audioQuality: {
    inspectAndCleanAudio: async args => {
      qualityCalls.push(args);
      return {
        success: true,
        path: args.outputPath || args.inputPath,
        raw_path: args.inputPath,
        raw_duration_sec: 231.04,
        speech_duration_sec: 13.996,
        tail_silence_sec: 217.113,
        trimmed: true,
      };
    },
  },
  concatenateAudioFiles: async ({ targetPath }) => {
    fs.writeFileSync(targetPath, 'combined');
    return { success: true };
  },
});

assert.equal(result.success, true);
assert.equal(result.scene_tts.scenes[0].duration, 13.996);
assert.equal(result.scene_tts.scenes[0].speech_duration_sec, 13.996);
assert.equal(result.scene_tts.scenes[0].raw_duration_sec, 231.04);
assert.equal(result.scene_tts.scenes[0].trimmed, true);
assert.equal(qualityCalls.length, 1);
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
node tests/test-scene-tts.js
```

Expected: fails because `audioQuality` is not used.

- [ ] **Step 3: Use audio quality result in `sceneTts.js`**

Import:

```js
const defaultAudioQuality = require('./ttsAudioQuality');
```

After writing raw file, call:

```js
const audioQuality = options.audioQuality || defaultAudioQuality;
const cleanFileName = fileName.replace(/(\.[^.]+)$/, '.clean$1');
const cleanPath = path.join(sceneDir, cleanFileName);
const quality = await audioQuality.inspectAndCleanAudio({
  inputPath: filePath,
  outputPath: cleanPath,
  plannedDurationSec: Number(scene?.duration ?? scene?.duration_sec ?? scene?.target_duration_sec ?? 0),
  runCommand: options.runCommand,
  getFfprobeCommand: options.getFfprobeCommand,
  getFfmpegCommand: options.getFfmpegCommand,
});
if (!quality.success) {
  return fail(quality.message || `第 ${sceneIndex} 幕配音时长异常。`, {
    scene_index: sceneIndex,
    code: quality.code,
    diagnostics: quality,
    model,
  });
}
```

Use:

```js
const audioPath = quality.path || filePath;
const duration = roundTime(quality.speech_duration_sec);
```

In `sceneResults.push`, include:

```js
path: audioPath,
raw_path: quality.raw_path || filePath,
raw_duration_sec: quality.raw_duration_sec,
speech_duration_sec: duration,
tail_silence_sec: quality.tail_silence_sec || 0,
trimmed: quality.trimmed === true,
```

Push `audioPath` into `inputPaths`, not raw `filePath`.

- [ ] **Step 4: Update storyboard timing**

In `storyboardTiming.js`, make `getSceneDuration` prefer `speech_duration_sec`:

```js
const explicit = Number(
  sceneTts?.speech_duration_sec
  ?? sceneTts?.duration
  ?? sceneTts?.actual_duration_sec
);
```

Do not invert this order. `actual_duration_sec` can be the raw polluted duration from older records; `speech_duration_sec` is the trusted value.

- [ ] **Step 5: Verify**

Run:

```powershell
node tests/test-scene-tts.js
node tests/test-storyboard-timing.js
```

Expected: both pass.

---

### Task 5: Respect Disabled Captions in Project Generation

**Files:**
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`
- Modify: `server/services/creative-video/html-video/captionLayer.js`
- Modify: `server/services/creative-video/html-video/timelineConsistency.js`
- Test: `tests/test-html-video-workflow.js`
- Test: `tests/test-html-video-caption-layer.js`

- [ ] **Step 1: Write failing tests**

In `tests/test-html-video-workflow.js`, add a project generation case:

```js
const result = await workflow.generateHtmlVideoProject({
  workflowId: 'wf-no-captions',
  runId: 'run-no-captions',
  rootDir,
  creativeContext: {
    scene_spec: {
      title: '无字幕测试',
      aspect_ratio: '16:9',
      scenes: [{
        id: 'scene_01',
        duration: 4,
        narration_text: '这段可以有旁白但不显示字幕。',
        captions: [{ id: 'c1', start: 0, end: 4, text: '这段可以有旁白但不显示字幕。' }],
        visual_text: { headline: '标题' },
      }],
    },
  },
  projectOptions: {
    generateAudio: true,
    generateCaptions: false,
  },
  services: fakeServices,
});

assert.equal(result.success, true);
assert.equal(result.project.frames[0].captions.length, 0);
const html = fs.readFileSync(path.join(result.html_video_project_path, result.project.frames[0].html_path), 'utf8');
assert.doesNotMatch(html, /data-hv-layer="captions"/);
```

In `tests/test-html-video-caption-layer.js`, assert disabled mode returns original html:

```js
const html = '<html><body><main>画面</main></body></html>';
const result = captionLayer.applyCaptionLayer(html, [{ start: 0, end: 1, text: '字幕' }], {
  generateCaptions: false,
});
assert.equal(result, html);
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
node tests/test-html-video-workflow.js
node tests/test-html-video-caption-layer.js
```

Expected: fails because captions are still injected.

- [ ] **Step 3: Implement option normalization**

In `htmlVideoWorkflow.js`, normalize:

```js
const mediaOptions = {
  generateAudio: projectOptions.generateAudio !== false,
  generateCaptions: projectOptions.generateCaptions !== false,
};
```

Pass `mediaOptions` to project builders and validation:

```js
project = await buildRawHtmlFrameProject({
  projectDir,
  workflowId,
  runId,
  graph: contentGraph,
  frameHtmlByNodeId,
  sceneSpec,
  target: templateRenderTarget,
  template,
  mediaOptions,
});

await validateHtmlVideoProject({
  project,
  projectDir,
  templateRegistry: registry,
  environment: env,
  sceneSpec,
  mediaOptions,
});
```

- [ ] **Step 4: Remove captions when disabled**

In `rawHtmlFrameBuilder.js`, extend the function signature to receive `mediaOptions`:

```js
async function buildRawHtmlFrameProject({
  projectDir,
  workflowId,
  runId,
  graph,
  frameHtmlByNodeId,
  sceneSpec = {},
  target = {},
  template = {},
  mediaOptions = {},
} = {}) {
```

When building frames:

```js
const includeCaptions = mediaOptions.generateCaptions !== false;
captions: includeCaptions ? normalizeCaptions(scene, normalizedDurationSec) : [],
```

When applying caption layer:

```js
const htmlWithCaptions = includeCaptions
  ? captionLayer.applyCaptionLayer(html, frame.captions, { durationSec: frame.duration_sec, generateCaptions: true })
  : html;
await fs.writeFile(outputPath, htmlWithCaptions, 'utf8');
```

- [ ] **Step 5: Make `captionLayer` no-op when disabled**

At the top of `applyCaptionLayer`:

```js
if (options.generateCaptions === false) return html;
```

- [ ] **Step 6: Skip caption validation when disabled**

In `validationGate.js`, pass `mediaOptions` through:

```js
const timelineConsistency = validateSceneSpecTimelineConsistency({
  sceneSpec,
  project: input,
  audio: input.audio,
  mediaOptions,
});
```

In `timelineConsistency.js`, accept `mediaOptions` and wrap caption comparison:

```js
const checkCaptions = mediaOptions?.generateCaptions !== false;
if (checkCaptions) {
  const actualCaptions = comparableFrameCaptions(frame, scene);
  const expectedCaptions = comparableSceneCaptions(scene, frame);
  if (normalizeCaptions(actualCaptions) !== normalizeCaptions(expectedCaptions)) {
    add(...);
  }
}
```

- [ ] **Step 7: Verify**

Run:

```powershell
node tests/test-html-video-workflow.js
node tests/test-html-video-caption-layer.js
```

Expected: pass.

---

### Task 6: Respect Disabled Audio in html-video Workflow

**Files:**
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `server/services/creative-video/html-video/timelineConsistency.js`
- Test: `tests/test-html-video-workflow.js`

- [ ] **Step 1: Write failing no-audio test**

Add test:

```js
let ttsCalls = 0;
const result = await workflow.generateHtmlVideoProject({
  workflowId: 'wf-no-audio',
  runId: 'run-no-audio',
  rootDir,
  creativeContext: {
    scene_spec: sceneSpecWithNarration,
    audio: {
      path: 'stale.wav',
      scene_spec_hash: 'old-hash',
    },
  },
  projectOptions: {
    generateAudio: false,
    generateCaptions: true,
  },
  services: {
    ...fakeServices,
    ttsService: {
      synthesizeSceneNarration: async () => {
        ttsCalls += 1;
        return { success: true };
      },
    },
  },
});

assert.equal(result.success, true);
assert.equal(ttsCalls, 0);
assert.equal(result.project.audio.status, 'skipped');
assert.equal(result.project.audio.reason, 'disabled_by_settings');
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: fails because stale audio still triggers mismatch or regeneration.

- [ ] **Step 3: Implement audio disabled branch**

In `htmlVideoWorkflow.js`, before `resolveExistingNarrationAudio` logic:

```js
if (mediaOptions.generateAudio === false) {
  project.audio = {
    ...(project.audio || {}),
    status: 'skipped',
    reason: 'disabled_by_settings',
    narration_path: null,
    tts_manifest_path: null,
  };
} else {
  // existing audio reuse/regeneration logic
}
```

- [ ] **Step 4: Skip audio hash validation when disabled**

Ensure `validationGate.js` already passes `mediaOptions` to `validateSceneSpecTimelineConsistency` from Task 5. Then in `timelineConsistency.js`:

```js
const checkAudio = mediaOptions?.generateAudio !== false;
if (checkAudio && audioInput && hasAudioPath(audioInput)) {
  // existing audio hash check
}
```

- [ ] **Step 5: Verify**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: pass.

---

### Task 7: Add Timeline Safety Gates

**Files:**
- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`
- Test: `tests/test-html-video-project-orchestrator.js` or nearest existing project orchestrator test.

- [ ] **Step 1: Write failing auto-extension limit test**

Create or extend orchestrator test:

```js
const project = {
  frames: [{
    id: 'scene_04',
    duration_sec: 6,
    captions: [{ start: 0, end: 231.04, text: '异常字幕' }],
  }],
  timeline: { tracks: [{ id: 'main', type: 'video', items: [{ frame_id: 'scene_04', duration_sec: 6 }] }] },
};

const result = projectOrchestrator.fitFrameDurationsToCaptions(project);

assert.equal(result.ok, false);
assert.ok(result.diagnostics.some(item => item.code === 'caption_duration_exceeds_reasonable_frame'));
assert.equal(project.frames[0].duration_sec, 6);
```

- [ ] **Step 2: Write failing hidden-bug regression for missing `timingFit.errors`**

Current `renderHtmlVideoProject` reads `timingFit.errors.length`, but `fitFrameDurationsToCaptions` does not return `errors`. Add a regression that fails before the fix and passes after the call site switches to `timingFit.ok`.

Use a project where captions fit so `fitFrameDurationsToCaptions` returns `{ ok: true, diagnostics: [], changed: false }` and rendering can continue without touching `timingFit.errors`:

```js
const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-'));
const project = {
  project_id: 'timing-fit-no-errors-field',
  template_id: 'raw-html',
  output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 4 },
  frames: [{
    id: 'scene_01',
    scene_id: 'scene_01',
    source_mode: 'raw_html',
    html_path: 'frames/scene_01.html',
    duration_sec: 4,
    captions: [{ start: 0, end: 3.5, text: '正常字幕' }],
  }],
  timeline: { tracks: [{ id: 'main', type: 'video', items: [{ frame_id: 'scene_01', duration_sec: 4 }] }] },
  audio: { status: 'skipped' },
};

const result = await projectOrchestrator.renderHtmlVideoProject({
  project,
  projectDir,
  services: {
    materializer: {
      materializeProject: async ({ project }) => ({ project, diagnostics: [] }),
    },
    frameRenderer: {
      renderFrame: async frame => ({
        success: true,
        output_path: path.join(projectDir, 'frames', `${frame.id}.mp4`),
        diagnostics: [],
        meta: { encoding: 'h264' },
      }),
    },
    ffmpegComposer: {
      concatFramesWithFfmpeg: async () => ({ success: true, output_path: path.join(projectDir, 'exports', 'output.mp4') }),
      muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
      verifyDurationWithFfprobe: async () => ({ success: true, duration_sec: 4, expected_duration_sec: 4 }),
    },
  },
});

assert.equal(result.success, true);
```

Expected before fix: `TypeError` from reading `timingFit.errors.length`.

- [ ] **Step 3: Write failing total duration guard test**

```js
const project = {
  output: { duration: 60 },
  target: { duration_sec: 60 },
  frames: [
    { id: 'scene_01', duration_sec: 7.52 },
    { id: 'scene_04', duration_sec: 231.04 },
    { id: 'scene_05', duration_sec: 12.48 },
  ],
};

const result = projectOrchestrator.validateReasonableTimelineDuration(project, { targetDurationSec: 60 });

assert.equal(result.ok, false);
assert.equal(result.code, 'timeline_duration_unreasonable');
```

- [ ] **Step 4: Run and verify failure**

Run:

```powershell
node tests/test-html-video-project-orchestrator.js
```

Expected: fails because helpers do not exist or auto-extension still allows huge diff.

- [ ] **Step 5: Limit frame auto-extension**

In `projectOrchestrator.js`, change `fitFrameDurationsToCaptions` to return `{ ok, diagnostics, changed }`, and before extending add:

```js
const diff = captionEnd - duration;
const tooLarge = diff > 8 || captionEnd > duration * 2 || captionEnd > 30;
if (tooLarge) {
  diagnostics.push(createDiagnostic({
    code: 'caption_duration_exceeds_reasonable_frame',
    stage: 'timeline-consistency',
    user_message: '字幕时间异常超出画面时长，已停止渲染。请重新生成该段配音或缩短字幕时间。',
    details: {
      frame_id: frame.id || frame.scene_id || '',
      duration_sec: duration,
      caption_end_sec: roundDuration(captionEnd),
      diff_sec: roundDuration(diff),
    },
    fallback_allowed: false,
  }));
  continue;
}
```

After the loop:

```js
return {
  ok: !diagnostics.some(item => item.fallback_allowed === false),
  changed,
  diagnostics,
};
```

Update `renderHtmlVideoProject` immediately after the call:

```js
const timingFit = fitFrameDurationsToCaptions(nextProject);
diagnostics.push(...timingFit.diagnostics);
if (!timingFit.ok) {
  const firstError = timingFit.diagnostics.find(item => item.fallback_allowed === false);
  return {
    success: false,
    message: firstError?.user_message || '视频时间轴异常，已停止渲染。',
    project: nextProject,
    project_dir: resolvedProjectDir,
    html_video_project_path: resolvedProjectDir,
    diagnostics,
  };
}
if (timingFit.changed) {
  await saveProject(resolvedProjectDir, nextProject);
}
```

Remove the old `timingFit.errors.length` branch so callers do not read a deleted field.

- [ ] **Step 6: Add total duration guard**

Add:

```js
function validateReasonableTimelineDuration(project, options = {}) {
  const actual = expectedDurationSec(project);
  const target = Number(
    options.targetDurationSec
    ?? project?.target?.duration_sec
    ?? project?.output?.duration
    ?? 0
  );
  if (!Number.isFinite(target) || target <= 0) return { ok: true, duration_sec: actual };
  const allowed = Math.max(target * 1.5, target + 30);
  if (actual > allowed) {
    return {
      ok: false,
      code: 'timeline_duration_unreasonable',
      message: `视频时间轴异常：目标 ${target.toFixed(2)} 秒，当前 ${actual.toFixed(2)} 秒。`,
      target_duration_sec: target,
      duration_sec: actual,
      allowed_duration_sec: allowed,
    };
  }
  return { ok: true, target_duration_sec: target, duration_sec: actual, allowed_duration_sec: allowed };
}
```

Call this before rendering frames. On failure, return `success: false` with Chinese message.

Update the existing `module.exports` block in `projectOrchestrator.js`. Do not create a second export block. Export both helpers for focused tests:

```js
module.exports = {
  createProject,
  materializeProject,
  materializeHtmlVideoProject,
  renderHtmlVideoFramePreview,
  exportHtmlVideoProject,
  renderHtmlVideoProject,
  fitFrameDurationsToCaptions,
  validateReasonableTimelineDuration,
  renderProject: renderHtmlVideoProject,
  exportProject: exportHtmlVideoProject,
  rerenderProject: renderHtmlVideoProject,
  applyEditPatch: require('./editPatchService').applyEditPatch,
};
```

- [ ] **Step 7: Verify**

Run:

```powershell
node tests/test-html-video-project-orchestrator.js
node tests/test-html-video-workflow.js
```

Expected: pass.

---

### Task 8: End-to-End Regression for Reported Failure

**Files:**
- Test: `tests/test-html-video-workflow.js`
- Test: `tests/test-scene-tts.js`

- [ ] **Step 1: Add regression fixture behavior**

Add a test that simulates exactly the observed failure:

```js
const scenes = [
  { index: 1, id: 'scene_01', duration: 7, narration_text: '第一段。' },
  { index: 2, id: 'scene_04', duration: 9, narration_text: '他用 Claude Code 搭建了一套 Python 工具。' },
];
```

Make scene 2 raw duration `231.04`, silence start `13.495917`, clean duration `13.996`.

Assert:

```js
assert.equal(result.scene_tts.scenes[1].raw_duration_sec, 231.04);
assert.equal(result.scene_tts.scenes[1].duration, 13.996);
assert.equal(result.scene_tts.scenes[1].trimmed, true);
assert.ok(result.scene_tts.scenes[1].tail_silence_sec > 200);
```

- [ ] **Step 2: Verify no polluted duration enters project**

In html-video workflow regression, assert:

```js
assert.ok(result.project.frames.every(frame => frame.duration_sec < 30));
assert.ok(result.project.timeline.tracks[0].items.every(item => item.duration_sec < 30));
assert.doesNotMatch(JSON.stringify(result.project), /231\.04/);
```

- [ ] **Step 3: Run targeted tests**

Run:

```powershell
node tests/test-scene-tts.js
node tests/test-html-video-workflow.js
```

Expected: pass.

---

### Task 9: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused suite**

Run:

```powershell
node tests/test-app-settings.js
node tests/test-system-settings-ui.mjs
node tests/test-creative-workflows.js
node tests/test-tts-audio-quality.js
node tests/test-scene-tts.js
node tests/test-storyboard-timing.js
node tests/test-html-video-caption-layer.js
node tests/test-html-video-workflow.js
node tests/test-html-video-project-orchestrator.js
```

Expected: all pass.

- [ ] **Step 2: Run broader existing suite if time allows**

Run:

```powershell
node tests/run-all.js creative video
```

Expected: pass, or only known unrelated failures with exact notes.

- [ ] **Step 3: Manual verification in Settings Center**

Start the app by the repo's existing command. If no command is already running, use the project README command. Verify:

- Settings Center shows `生成旁白音频` and `生成字幕`.
- Turning off audio makes one-click workflow skip TTS stage with Chinese status.
- Turning off captions produces HTML without `data-hv-layer="captions"`.
- Turning both off still renders a silent, subtitle-free video using planned scene durations.

---

## Self-Review

- Spec coverage:
  - Stable handling of long silent TTS: Tasks 3, 4, 8.
  - Settings Center audio/subtitle switches: Tasks 1, 2, 5, 6.
  - Skip TTS when audio disabled: Tasks 2, 6.
  - Skip subtitle generation when captions disabled: Task 5.
  - Prevent frozen long frame regression: Tasks 7, 8.
- Placeholder scan:
  - No placeholder instructions.
- Type consistency:
  - Use `generateAudio`, `generateCaptions`, `raw_duration_sec`, `speech_duration_sec`, `tail_silence_sec`, and `trimmed` consistently.

## Execution Notes

- Do not commit unless the user explicitly asks for commits.
- If committing is requested, use Chinese commit messages, for example:

```powershell
git add server frontend-react tests docs
git commit -m "修复视频音频字幕时间轴稳定性"
```
