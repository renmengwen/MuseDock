const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { renderFrame } = require('../server/services/creative-video/html-video/frameRenderer');

(async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-frame-renderer-'));
  const htmlPath = path.join(projectDir, 'frames', '01-scene_01.html');
  const absoluteLegacyHtmlPath = path.join(projectDir, 'legacy', 'absolute.html');
  await fs.mkdir(path.dirname(htmlPath), { recursive: true });
  await fs.writeFile(htmlPath, '<html><body>帧</body></html>', 'utf8');
  await fs.mkdir(path.dirname(absoluteLegacyHtmlPath), { recursive: true });
  await fs.writeFile(absoluteLegacyHtmlPath, '<html><body>旧路径</body></html>', 'utf8');

  let receivedSourcePath = '';
  const state = {};
  const result = await renderFrame(
    {
      id: 'scene_01',
      source_mode: 'raw_html',
      html_path: 'frames/01-scene_01.html',
      duration_sec: 4,
    },
    {
      projectDir,
      outputPath: path.join(projectDir, 'frames', 'scene_01.mp4'),
      state,
      adapter: {
        render: async input => {
          receivedSourcePath = input.template.sourcePath;
          assert.equal(input.template.id, 'scene_01');
          assert.equal(input.template.engine, 'hyperframes-playwright');
          assert.equal(input.config.duration, 4);
          return {
            output_path: input.config.outputPath,
            meta: { durationSec: input.config.duration },
            diagnostics: [],
          };
        },
      },
    },
  );

  assert.equal(result.success, true);
  assert.equal(receivedSourcePath, htmlPath);
  assert.equal(state.status, 'done');

  let defaultResolution = null;
  const defaultResolutionResult = await renderFrame(
    {
      id: 'scene_default_resolution',
      source_mode: 'raw_html',
      html_path: 'frames/01-scene_01.html',
      duration_sec: 4,
    },
    {
      projectDir,
      outputPath: path.join(projectDir, 'frames', 'scene_default_resolution.mp4'),
      adapter: {
        render: async input => {
          defaultResolution = input.config.resolution;
          return {
            output_path: input.config.outputPath,
            diagnostics: [],
          };
        },
      },
    },
  );
  assert.equal(defaultResolutionResult.success, true);
  assert.deepEqual(defaultResolution, { width: 1920, height: 1080 });

  let legacySourcePath = '';
  const legacyResult = await renderFrame(
    {
      id: 'legacy_absolute',
      source_mode: 'raw_html',
      sourcePath: absoluteLegacyHtmlPath,
      duration_sec: 3,
    },
    {
      outputPath: path.join(projectDir, 'frames', 'legacy_absolute.mp4'),
      adapter: {
        render: async input => {
          legacySourcePath = input.template.sourcePath;
          return {
            output_path: input.config.outputPath,
            diagnostics: [],
          };
        },
      },
    },
  );
  assert.equal(legacyResult.success, true);
  assert.equal(legacySourcePath, absoluteLegacyHtmlPath);

  let unmaterializedAdapterCalled = false;
  const unmaterializedResult = await renderFrame(
    {
      id: 'template_input_frame',
      source_mode: 'template_inputs',
      duration_sec: 3,
      inputs: { headline: '标题' },
    },
    {
      projectDir,
      outputPath: path.join(projectDir, 'frames', 'template_input_frame.mp4'),
      adapter: {
        render: async () => {
          unmaterializedAdapterCalled = true;
          return { output_path: 'should-not-render.mp4', diagnostics: [] };
        },
      },
    },
  );
  assert.equal(unmaterializedResult.success, false);
  assert.equal(unmaterializedAdapterCalled, false);
  assert.match(unmaterializedResult.message, /旧版模板帧不支持再编辑或重渲染/);
  assert.equal(unmaterializedResult.diagnostics[0].code, 'legacy_template_frame');

  const asyncProgressEvents = [];
  const asyncProgressState = {};
  const asyncProgressResult = await renderFrame(
    {
      id: 'scene_02',
      source_mode: 'raw_html',
      html_path: 'frames/01-scene_01.html',
      duration_sec: 4,
    },
    {
      projectDir,
      outputPath: path.join(projectDir, 'frames', 'scene_02.mp4'),
      state: asyncProgressState,
      onProgress: async event => {
        await new Promise(resolve => setImmediate(resolve));
        asyncProgressEvents.push({ percent: event.percent, message: event.message });
      },
      adapter: {
        render: async (input, ctx) => {
          ctx.onProgress(40, '正在录制 html-video 帧...');
          ctx.onProgress(80, '正在收尾 html-video 帧...');
          return {
            output_path: input.config.outputPath,
            meta: { durationSec: input.config.duration },
            diagnostics: [],
          };
        },
      },
    },
  );

  assert.equal(asyncProgressResult.success, true);
  assert.deepEqual(asyncProgressEvents, [
    { percent: 40, message: '正在录制 html-video 帧...' },
    { percent: 80, message: '正在收尾 html-video 帧...' },
  ]);
  assert.equal(asyncProgressState.status, 'done');

  let rejectingProgressCalled = false;
  const rejectingProgressResult = await renderFrame(
    {
      id: 'scene_03',
      source_mode: 'raw_html',
      html_path: 'frames/01-scene_01.html',
      duration_sec: 4,
    },
    {
      projectDir,
      outputPath: path.join(projectDir, 'frames', 'scene_03.mp4'),
      onProgress: async event => {
        rejectingProgressCalled = true;
        assert.equal(event.percent, 30);
        await new Promise(resolve => setImmediate(resolve));
        throw new Error('progress failed');
      },
      adapter: {
        render: async (input, ctx) => {
          ctx.onProgress(30, '正在录制 html-video 帧...');
          return {
            output_path: input.config.outputPath,
            meta: { durationSec: input.config.duration },
            diagnostics: [],
          };
        },
      },
    },
  );
  assert.equal(rejectingProgressCalled, true);
  assert.equal(rejectingProgressResult.success, true);

  const failedProgressEvents = [];
  const failedProgressState = {};
  const failedProgressResult = await renderFrame(
    {
      id: 'scene_04',
      source_mode: 'raw_html',
      html_path: 'frames/01-scene_01.html',
      duration_sec: 4,
    },
    {
      projectDir,
      outputPath: path.join(projectDir, 'frames', 'scene_04.mp4'),
      state: failedProgressState,
      onProgress: async event => {
        await new Promise(resolve => setImmediate(resolve));
        failedProgressEvents.push({ percent: event.percent, message: event.message });
      },
      adapter: {
        render: async (input, ctx) => {
          ctx.onProgress(60, '正在录制 html-video 帧...');
          throw new Error('render failed');
        },
      },
    },
  );
  assert.equal(failedProgressResult.success, false);
  assert.deepEqual(failedProgressEvents, [
    { percent: 60, message: '正在录制 html-video 帧...' },
  ]);
  assert.equal(failedProgressState.status, 'failed');

  console.log('html-video frame renderer tests passed');
})();
