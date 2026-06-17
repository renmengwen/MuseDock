const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { buildRawHtmlFrameProject } = require('../server/services/creative-video/html-video/rawHtmlFrameBuilder');

(async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-raw-html-'));
  const graph = {
    synopsis: '两帧测试',
    nodes: [
      { id: 'scene_01', kind: 'text', label: '第一幕', durationSec: 2.5, text: '第一幕文本' },
      { id: 'scene_02', kind: 'data', label: '第二幕', durationSec: 3, data: { title: '数据', unit: '元', items: [{ label: 'A', value: 12 }] } },
    ],
    edges: [{ from: 'scene_01', to: 'scene_02', kind: 'sequence' }],
  };

  const project = await buildRawHtmlFrameProject({
    projectDir,
    workflowId: 'wf_001',
    runId: 'run_001',
    graph,
    frameHtmlByNodeId: {
      scene_01: '<!doctype html><html><body><main>第一幕</main></body></html>',
      scene_02: '<!doctype html><html><body><main>第二幕</main></body></html>',
    },
    sceneSpec: {
      title: '测试标题',
      scenes: [
        { id: 'scene_01', narration_text: '第一幕旁白', captions: [{ text: '第一幕' }], visual_text: { headline: '第一幕' } },
        { id: 'scene_02', narration_text: '第二幕旁白', captions: [{ text: '第二幕' }], visual_text: { headline: '第二幕' } },
      ],
    },
    target: { aspect_ratio: '16:9', resolution: { width: 1920, height: 1080 }, fps: 30 },
    template: { id: 'bold_signal', output: { resolution: { width: 1280, height: 720 }, fps: 24 } },
  });

  assert.equal(project.workflow_id, 'wf_001');
  assert.equal(project.run_id, 'run_001');
  assert.equal(project.template_id, 'bold_signal');
  assert.equal(project.output.resolution.width, 1920);
  assert.equal(project.output.resolution.height, 1080);
  assert.equal(project.output.fps, 30);
  assert.deepEqual(project.frames.map(frame => frame.html_path), [
    'frames/01-scene_01.html',
    'frames/02-scene_02.html',
  ]);
  assert.ok(project.frames.every(frame => frame.source_mode === 'raw_html'));
  assert.ok(project.frames.every(frame => !Object.prototype.hasOwnProperty.call(frame, 'template_inputs')));
  assert.equal(project.frames[0].duration_sec, 2.5);
  assert.equal(project.frames[0].narration_text, '第一幕旁白');
  assert.deepEqual(project.frames[0].captions, [{ text: '第一幕' }]);
  assert.equal(project.frames[0].metadata.visual_text.headline, '第一幕');
  assert.equal(project.frames[0].metadata.graph_node.kind, 'text');
  assert.equal(project.timeline.tracks[0].items[1].start_sec, 2.5);
  assert.equal(project.timeline.tracks[0].items[1].duration_sec, 3);

  assert.equal(await fs.readFile(path.join(projectDir, 'frames/01-scene_01.html'), 'utf8'), '<!doctype html><html><body><main>第一幕</main></body></html>');
  assert.equal(await fs.readFile(path.join(projectDir, 'frames/02-scene_02.html'), 'utf8'), '<!doctype html><html><body><main>第二幕</main></body></html>');

  console.log('html-video raw html frame builder tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
