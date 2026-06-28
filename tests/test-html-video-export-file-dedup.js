const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const projectStore = require('../server/services/creative-video/html-video/projectStore');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function makeProject(projectDir) {
  return {
    project_id: 'project',
    workflow_id: 'workflow',
    run_id: 'run',
    output: { resolution: { width: 1920, height: 1080 }, fps: 30 },
    frames: [{ id: 'scene_01', scene_id: 'scene_01', duration_sec: 2 }],
    generation_checkpoint: {
      stages: { render: { frames: { scene_01: { status: 'done', mp4_path: 'frames/scene_01.mp4' } } } },
    },
    audio: { status: 'ready', narration_path: path.join(projectDir, 'tts.wav') },
  };
}

// 每次 mux 都覆盖写同一个 output-audio.mp4，模拟真实 ffmpeg 行为。
const ffmpegComposer = {
  concatFramesWithFfmpeg: async (frames, outputPath) => {
    await writeFile(outputPath, 'silent video');
    return { success: true, output_path: outputPath, strategy: 'stub' };
  },
  muxAudioWithFfmpeg: async ({ outputPath }) => {
    await writeFile(outputPath, 'muxed with audio');
    return { success: true, output_path: outputPath };
  },
  verifyDurationWithFfprobe: async () => ({ success: true, duration_sec: 2, expected_duration_sec: 2 }),
  verifyAudioStreamWithFfprobe: async () => ({ success: true }),
};

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-export-dedup-'));
  const projectDir = path.join(rootDir, 'project');
  await writeFile(path.join(projectDir, 'frames', 'scene_01.mp4'), 'frame');
  await writeFile(path.join(projectDir, 'tts.wav'), 'audio');

  const base = { rootDir, workflowId: 'workflow', runId: 'run', projectDir, services: { ffmpegComposer } };

  const first = await projectOrchestrator.composeHtmlVideoProject({ ...base, project: makeProject(projectDir) });
  assert.equal(first.success, true);

  // 二次导出：复用上一次的 project，触发 addExport 去重改名 output-audio-2.mp4。
  const second = await projectOrchestrator.composeHtmlVideoProject({ ...base, project: first.project });
  assert.equal(second.success, true);

  const saved = JSON.parse(await fs.readFile(path.join(projectDir, 'project.json'), 'utf8'));
  assert.equal(saved.exports.length, 2);
  assert.notEqual(saved.exports[0].path, saved.exports[1].path);

  // 回归点：每条导出记录指向的文件必须真实存在，否则播放报“文件不存在”。
  for (const item of saved.exports) {
    const filePath = projectStore.resolveProjectPath(projectDir, item.path);
    const stat = await fs.stat(filePath);
    assert.equal(stat.isFile(), true, `导出记录 ${item.path} 缺少磁盘文件`);
  }

  console.log('html-video export file dedup tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
