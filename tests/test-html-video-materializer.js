const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { normalizeProject } = require('../server/services/creative-video/html-video/projectSchema');
const { materializeProject, htmlEscape } = require('../server/services/creative-video/html-video/materializer');
const {
  renderHtmlVideoFrames,
  composeHtmlVideoProject,
} = require('../server/services/creative-video/html-video/projectOrchestrator');
const {
  validateSceneSpecTimelineConsistency,
} = require('../server/services/creative-video/html-video/timelineConsistency');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-materializer-'));
  const projectDir = path.join(rootDir, 'project');
  await fs.mkdir(projectDir, { recursive: true });

  // htmlEscape 是保留导出（frameHtmlPhase 仍在用），escape 行为直接断言
  assert.equal(htmlEscape('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(htmlEscape('"a" & \'b\''), '&quot;a&quot; &amp; &#39;b&#39;');
  assert.equal(htmlEscape(null), '');

  // 旧工程兜底：模板物化路径已删除——override 帧保留用户 HTML，其余旧模板帧产生 template_not_found
  const legacyProject = normalizeProject({
    project_id: 'project_legacy',
    template_id: 'variable_title',
    frames: [
      {
        id: 'scene_01',
        scene_id: 'scene_01',
        order: 1,
        template_id: 'variable_title',
        duration_sec: 4,
        inputs: { title: '旧模板帧' },
      },
      {
        id: 'scene_02',
        scene_id: 'scene_02',
        order: 2,
        template_id: 'variable_title',
        duration_sec: 5,
        inputs: { title: '不应覆盖' },
      },
    ],
    overrides: {
      html: {
        enabled: true,
        frames: {
          scene_02: {
            enabled: true,
            html_path: 'frames/custom_scene_02.html',
          },
        },
      },
    },
  });

  await writeFile(path.join(projectDir, 'frames/custom_scene_02.html'), '<html><body>用户改写</body></html>');

  const legacyResult = await materializeProject({ projectDir, project: legacyProject });

  assert.ok(legacyResult.diagnostics.some(item => item.code === 'template_not_found' && item.frame_id === 'scene_01'));
  assert.equal(legacyResult.project.frames[1].html_path, 'frames/custom_scene_02.html');
  assert.ok(legacyResult.diagnostics.some(item => item.code === 'html_override_active' && item.frame_id === 'scene_02'));

  const overrideHtml = await fs.readFile(path.join(projectDir, 'frames/custom_scene_02.html'), 'utf8');
  assert.equal(overrideHtml, '<html><body>用户改写</body></html>');

  const rawProjectDir = path.join(rootDir, 'raw-project');
  await writeFile(path.join(rawProjectDir, 'frames/01-raw.html'), '<!doctype html><html><body>raw</body></html>');
  const rawResult = await materializeProject({
    projectDir: rawProjectDir,
    project: normalizeProject({
      project_id: 'project_raw',
      frames: [
        {
          id: 'raw_01',
          scene_id: 'raw_01',
          order: 1,
          source_mode: 'raw_html',
          html_path: 'frames/01-raw.html',
          duration_sec: 2,
          narration_text: 'raw 旁白',
          metadata: { from: 'raw-builder' },
        },
      ],
    }),
  });
  assert.equal(rawResult.project.frames[0].html_path, 'frames/01-raw.html');
  assert.equal(rawResult.project.frames[0].source_mode, 'raw_html');
  assert.equal(rawResult.project.frames[0].narration_text, 'raw 旁白');
  assert.equal(rawResult.project.frames[0].captions[0].text, 'raw 旁白');
  assert.equal(rawResult.project.frames[0].metadata.from, 'raw-builder');
  assert.ok(rawResult.diagnostics.some(item => item.code === 'raw_html_caption_injected' && item.frame_id === 'raw_01'));
  const rawHtml = await fs.readFile(path.join(rawProjectDir, 'frames/01-raw.html'), 'utf8');
  assert.match(rawHtml, /data-role="subtitle-caption"/);
  assert.match(rawHtml, /raw 旁白/);

  const disabledCaptionProjectDir = path.join(rootDir, 'disabled-caption-project');
  await writeFile(path.join(disabledCaptionProjectDir, 'frames/01-raw.html'), '<!doctype html><html><body>disabled caption</body></html>');
  const disabledCaptionResult = await materializeProject({
    projectDir: disabledCaptionProjectDir,
    project: normalizeProject({
      project_id: 'project_disabled_caption',
      frames: [
        {
          id: 'disabled_caption_01',
          scene_id: 'disabled_caption_01',
          order: 1,
          source_mode: 'raw_html',
          html_path: 'frames/01-raw.html',
          duration_sec: 3,
          narration_text: '这段旁白不应该被注入字幕层。',
          captions: [],
          generate_captions: false,
        },
      ],
    }),
  });
  assert.deepEqual(disabledCaptionResult.project.frames[0].captions, []);
  const disabledCaptionHtml = await fs.readFile(path.join(disabledCaptionProjectDir, disabledCaptionResult.project.frames[0].html_path), 'utf8');
  assert.doesNotMatch(disabledCaptionHtml, /data-hv-layer="captions"/);

  const rawUnmanagedProjectDir = path.join(rootDir, 'raw-unmanaged-project');
  await writeFile(
    path.join(rawUnmanagedProjectDir, 'frames/01-raw.html'),
    '<!doctype html><html><body><div data-hv-layer="captions" data-hv-managed="false">模板字幕</div></body></html>',
  );
  const rawUnmanagedResult = await materializeProject({
    projectDir: rawUnmanagedProjectDir,
    project: normalizeProject({
      project_id: 'project_raw_unmanaged',
      frames: [
        {
          id: 'raw_unmanaged_01',
          scene_id: 'raw_unmanaged_01',
          order: 1,
          source_mode: 'raw_html',
          html_path: 'frames/01-raw.html',
          duration_sec: 2,
          narration_text: 'raw 非受管旁白',
        },
      ],
    }),
  });
  assert.ok(rawUnmanagedResult.diagnostics.some(item => item.code === 'unmanaged_caption_layer_preserved' && item.frame_id === 'raw_unmanaged_01'));
  const rawUnmanagedHtml = await fs.readFile(path.join(rawUnmanagedProjectDir, 'frames/01-raw.html'), 'utf8');
  assert.equal((rawUnmanagedHtml.match(/data-hv-layer="captions"/g) || []).length, 2);
  assert.match(rawUnmanagedHtml, /模板字幕/);
  assert.match(rawUnmanagedHtml, /raw 非受管旁白/);

  const rawUnmanagedEmptyProjectDir = path.join(rootDir, 'raw-unmanaged-empty-project');
  await writeFile(
    path.join(rawUnmanagedEmptyProjectDir, 'frames/01-raw.html'),
    '<!doctype html><html><body><div data-hv-layer="captions" data-hv-managed="false">模板字幕</div></body></html>',
  );
  const rawUnmanagedEmptyResult = await materializeProject({
    projectDir: rawUnmanagedEmptyProjectDir,
    project: normalizeProject({
      project_id: 'project_raw_unmanaged_empty',
      frames: [
        {
          id: 'raw_unmanaged_empty_01',
          scene_id: 'raw_unmanaged_empty_01',
          order: 1,
          source_mode: 'raw_html',
          html_path: 'frames/01-raw.html',
          duration_sec: 2,
          narration_text: '',
          captions: [],
        },
      ],
    }),
  });
  assert.ok(rawUnmanagedEmptyResult.diagnostics.some(item => item.code === 'unmanaged_caption_layer_preserved' && item.frame_id === 'raw_unmanaged_empty_01'));
  const rawUnmanagedEmptyHtml = await fs.readFile(path.join(rawUnmanagedEmptyProjectDir, 'frames/01-raw.html'), 'utf8');
  assert.equal((rawUnmanagedEmptyHtml.match(/data-hv-layer="captions"/g) || []).length, 1);
  assert.match(rawUnmanagedEmptyHtml, /模板字幕/);

  const rawNoRegistryProjectDir = path.join(rootDir, 'raw-no-registry-project');
  await writeFile(path.join(rawNoRegistryProjectDir, 'frames/01-raw.html'), '<!doctype html><html><body>raw no registry</body></html>');
  const rawNoRegistryResult = await materializeProject({
    projectDir: rawNoRegistryProjectDir,
    project: normalizeProject({
      project_id: 'project_raw_no_registry',
      frames: [
        {
          id: 'raw_no_registry_01',
          scene_id: 'raw_no_registry_01',
          order: 1,
          source_mode: 'raw_html',
          html_path: 'frames/01-raw.html',
          duration_sec: 2,
          narration_text: 'raw 无 registry 旁白',
        },
      ],
    }),
  });
  assert.equal(rawNoRegistryResult.project.frames[0].captions[0].text, 'raw 无 registry 旁白');
  const rawNoRegistryHtml = await fs.readFile(path.join(rawNoRegistryProjectDir, 'frames/01-raw.html'), 'utf8');
  assert.match(rawNoRegistryHtml, /raw 无 registry 旁白/);

  const sharedRawBeatProjectDir = path.join(rootDir, 'shared-raw-beat-project');
  await writeFile(
    path.join(sharedRawBeatProjectDir, 'frames/shared.html'),
    '<!doctype html><html><body><main>shared raw</main></body></html>',
  );
  const sharedRawBeatResult = await materializeProject({
    projectDir: sharedRawBeatProjectDir,
    project: normalizeProject({
      project_id: 'project_shared_raw_beat',
      frames: [
        {
          id: 'scene_long_b1',
          scene_id: 'scene_long',
          beat_id: 'scene_long_b1',
          order: 1,
          source_mode: 'raw_html',
          html_path: 'frames/shared.html',
          duration_sec: 3,
          captions: [{ start: 0, end: 3, text: '第一段字幕' }],
        },
        {
          id: 'scene_long_b2',
          scene_id: 'scene_long',
          beat_id: 'scene_long_b2',
          order: 2,
          source_mode: 'raw_html',
          html_path: 'frames/shared.html',
          duration_sec: 3,
          captions: [{ start: 0, end: 3, text: '第二段字幕' }],
        },
      ],
    }),
  });
  const [firstBeatFrame, secondBeatFrame] = sharedRawBeatResult.project.frames;
  assert.notEqual(firstBeatFrame.html_path, secondBeatFrame.html_path);
  const firstBeatHtml = await fs.readFile(path.join(sharedRawBeatProjectDir, firstBeatFrame.html_path), 'utf8');
  const secondBeatHtml = await fs.readFile(path.join(sharedRawBeatProjectDir, secondBeatFrame.html_path), 'utf8');
  assert.match(firstBeatHtml, /第一段字幕/);
  assert.doesNotMatch(firstBeatHtml, /第二段字幕/);
  assert.match(secondBeatHtml, /第二段字幕/);
  assert.doesNotMatch(secondBeatHtml, /第一段字幕/);
  const mixedBeatValidation = validateSceneSpecTimelineConsistency({
    sceneSpec: { scenes: [{ id: 'scene_long', narration_text: '旁白' }] },
    project: {
      frames: [
        { id: 'scene_long', scene_id: 'scene_long', duration_sec: 3, narration_text: '旁白' },
        { id: 'scene_long_b2', scene_id: 'scene_long', beat_id: 'scene_long_b2', duration_sec: 3, narration_text: '旁白' },
      ],
    },
    mediaOptions: { generateCaptions: false, generateAudio: false },
  });
  assert.equal(mixedBeatValidation.ok, false);
  assert.ok(mixedBeatValidation.diagnostics.some(item => item.code === 'frame_scene_duplicate' && item.frame_id === 'scene_long'));

  const beatRenderProjectDir = path.join(rootDir, 'beat-render-project');
  await fs.mkdir(beatRenderProjectDir, { recursive: true });
  const beatProject = normalizeProject({
    project_id: 'beat_render_project',
    output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 18 },
    audio: { status: 'skipped', reason: 'disabled_by_settings' },
    frames: [
      { id: 'scene_long_b1', scene_id: 'scene_long', beat_id: 'scene_long_b1', order: 1, duration_sec: 6, engine: 'hyperframes-playwright', html_path: 'frames/long.html' },
      { id: 'scene_long_b2', scene_id: 'scene_long', beat_id: 'scene_long_b2', order: 2, duration_sec: 6, engine: 'hyperframes-playwright', html_path: 'frames/long.html' },
      { id: 'scene_long_b3', scene_id: 'scene_long', beat_id: 'scene_long_b3', order: 3, duration_sec: 6, engine: 'hyperframes-playwright', html_path: 'frames/long.html' },
    ],
  });
  await writeFile(path.join(beatRenderProjectDir, 'frames/long.html'), '<!doctype html><html><body>long</body></html>');
  const renderedBeatPaths = [];
  const renderResult = await renderHtmlVideoFrames({
    projectDir: beatRenderProjectDir,
    project: beatProject,
    services: {
      frameRenderer: {
        renderFrame: async (_frame, { outputPath }) => {
          await writeFile(outputPath, `mp4:${path.basename(outputPath)}`);
          renderedBeatPaths.push(outputPath);
          return { success: true, output_path: outputPath, output_hash: path.basename(outputPath), meta: {} };
        },
      },
    },
  });
  assert.equal(renderResult.success, true);
  assert.deepEqual(Object.keys(renderResult.project.generation_checkpoint.stages.render.frames).sort(), [
    'scene_long_b1',
    'scene_long_b2',
    'scene_long_b3',
  ]);
  assert.equal(new Set(renderedBeatPaths.map(item => path.basename(item))).size, 3);
  const composeResult = await composeHtmlVideoProject({
    projectDir: beatRenderProjectDir,
    project: renderResult.project,
    services: {
      ffmpegComposer: {
        concatFramesWithFfmpeg: async (frames, outputPath) => {
          const basenames = frames.map(frame => path.basename(frame.path));
          assert.deepEqual(basenames, ['scene_long_b1.mp4', 'scene_long_b2.mp4', 'scene_long_b3.mp4']);
          assert.equal(new Set(basenames).size, 3);
          await writeFile(outputPath, 'combined');
          return { success: true, output_path: outputPath };
        },
        muxAudioWithFfmpeg: async () => ({ success: true }),
      },
    },
  });
  assert.equal(composeResult.success, true);

  console.log('html-video materializer tests passed');
})();
