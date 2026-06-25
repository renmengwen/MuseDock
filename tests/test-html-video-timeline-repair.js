const assert = require('assert/strict');

const {
  analyzeTimelineMismatch,
  compressNarrationForTarget,
  repairProjectTimeline,
} = require('../server/services/creative-video/html-video/timelineRepair');

function buildSceneSpec() {
  return {
    title: '时间轴修复',
    aspect_ratio: '9:16',
    theme: '科技',
    scenes: [
      {
        id: 'scene_01',
        order: 1,
        theme: '科技',
        visual_text: '保留画面提示',
        visual_metadata: { palette: 'blue', layout: 'split' },
        duration: 90,
        narration_text: '第一幕旁白内容非常长，需要压缩到目标时长。',
        captions: [
          { id: 'caption_01', start: 0, end: 45, text: '第一幕字幕内容非常长，需要压缩。' },
          { id: 'caption_02', start: 45, end: 90, text: '第一幕第二段字幕也需要缩短。' },
        ],
      },
      {
        id: 'scene_02',
        order: 2,
        theme: '科技',
        duration: 42,
        narration_text: '第二幕旁白内容也很长。',
        captions: [
          { id: 'caption_03', start: 0, end: 42, text: '第二幕字幕同样需要压缩。' },
        ],
      },
    ],
  };
}

function buildProject() {
  return {
    project_id: 'timeline-repair',
    target: { duration_sec: 60 },
    output: { duration: 132 },
    content_graph: {
      nodes: [
        { id: 'scene_01', durationSec: 90 },
        { id: 'scene_02', durationSec: 42 },
      ],
      edges: [],
    },
    frames: [
      {
        id: 'scene_01',
        scene_id: 'scene_01',
        duration_sec: 90,
        captions: [{ text: '第一幕字幕内容非常长，需要压缩。', start: 0, end: 45 }],
      },
      {
        id: 'scene_02',
        scene_id: 'scene_02',
        duration_sec: 42,
        captions: [{ text: '第二幕字幕同样需要压缩。', start: 0, end: 42 }],
      },
    ],
    timeline: {
      tracks: [
        {
          id: 'main',
          type: 'video',
          items: [
            { frame_id: 'scene_01', duration_sec: 90 },
            { frame_id: 'scene_02', duration_sec: 42 },
          ],
        },
      ],
    },
    audio: {
      status: 'ready',
      source: 'scene_spec',
      scene_count: 2,
      scene_ids: ['scene_01', 'scene_02'],
      scene_spec_hash: 'hash',
      narration_path: 'tts/combined.wav',
    },
  };
}

{
  const project = buildProject();
  const result = analyzeTimelineMismatch({
    project,
    sceneSpec: buildSceneSpec(),
    targetDurationSec: 60,
    audioManifest: { duration_sec: 55 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.repair_action, 'repair_timeline');
  assert.equal(result.requires_script_repair, false);
  assert.equal(result.target_duration_sec, 60);
  assert.equal(result.frame_duration_sec, 132);
  assert.equal(result.timeline_duration_sec, 132);
  assert.equal(result.audio_duration_sec, 55);
}

{
  const result = analyzeTimelineMismatch({
    project: buildProject(),
    sceneSpec: buildSceneSpec(),
    targetDurationSec: 60,
    audioManifest: {
      scenes: [
        { id: 'scene_01', duration: 31 },
        { id: 'scene_02', durationSec: 31 },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.requires_script_repair, true);
  assert.equal(result.repair_action, 'repair_script_and_timeline');
}

{
  const result = analyzeTimelineMismatch({
    project: buildProject(),
    sceneSpec: buildSceneSpec(),
    targetDurationSec: 60,
    audioManifest: { duration_sec: 60.5 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.requires_script_repair, true);
  assert.equal(result.repair_action, 'repair_script_and_timeline');
}

{
  const compressed = compressNarrationForTarget(buildSceneSpec(), 60);

  assert.equal(compressed.title, '时间轴修复');
  assert.equal(compressed.aspect_ratio, '9:16');
  assert.equal(compressed.scenes[0].id, 'scene_01');
  assert.equal(compressed.scenes[0].order, 1);
  assert.equal(compressed.scenes[0].theme, '科技');
  assert.deepEqual(compressed.scenes[0].visual_metadata, { palette: 'blue', layout: 'split' });
  assert.equal(compressed.scenes[0].visual_text, '保留画面提示');
  assert.equal(compressed.scenes[0].narration_text.length < buildSceneSpec().scenes[0].narration_text.length, true);
  assert.equal(compressed.scenes[0].captions[0].text.length < buildSceneSpec().scenes[0].captions[0].text.length, true);
  assert.equal(compressed.scenes[1].id, 'scene_02');
  assert.equal(compressed.scenes[1].order, 2);
  assert.equal(compressed.scenes[1].theme, '科技');

  const original = buildSceneSpec();
  compressNarrationForTarget(original, 60);
  assert.equal(original.scenes[0].narration_text, '第一幕旁白内容非常长，需要压缩到目标时长。');
  assert.equal(original.scenes[0].captions[0].text, '第一幕字幕内容非常长，需要压缩。');
}

{
  const project = buildProject();
  const result = repairProjectTimeline({
    project,
    sceneSpec: buildSceneSpec(),
    targetDurationSec: 60,
    audioManifest: { duration_sec: 55 },
  });

  assert.equal(result.ok, true);
  assert.equal(project.frames[0].duration_sec, 90);
  assert.equal(result.project.frames[0].duration_sec < 90, true);
  assert.equal(result.project.frames[1].duration_sec < 42, true);
  const repairedTotal = result.project.frames.reduce((total, frame) => total + frame.duration_sec, 0);
  assert.equal(Math.abs(repairedTotal - 60) < 0.001, true);
  assert.equal(result.project.timeline.tracks[0].items[0].duration_sec, result.project.frames[0].duration_sec);
  assert.equal(result.project.content_graph.nodes[0].durationSec, result.project.frames[0].duration_sec);
  assert.equal(result.project.frames[0].captions[0].end <= result.project.frames[0].duration_sec, true);
  assert.equal(result.project.frames[1].captions[0].end <= result.project.frames[1].duration_sec, true);
}

console.log('html-video timeline repair tests passed');
