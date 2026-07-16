const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { runtimeAssetPolicyAttestation } = require('../server/services/creative-video/html-video/frameRenderPhase');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function makeProject(projectDir) {
  const project = {
    project_id: 'project',
    workflow_id: 'workflow',
    run_id: 'run',
    output: { resolution: { width: 1920, height: 1080 }, fps: 30 },
    frames: [{ id: 'scene_01', scene_id: 'scene_01', html_path: 'frames/scene_01.html', duration_sec: 2 }],
    generation_checkpoint: {
      stages: { render: { frames: { scene_01: { status: 'done', mp4_path: 'frames/scene_01.mp4' } } } },
    },
    audio: { status: 'ready', narration_path: path.join(projectDir, 'tts.wav') },
  };
  const outputHash = crypto.createHash('sha256').update(await fs.readFile(path.join(projectDir, 'frames', 'scene_01.mp4'))).digest('hex');
  const checkpoint = project.generation_checkpoint.stages.render.frames.scene_01;
  checkpoint.output_hash = outputHash;
  checkpoint.runtime_asset_policy_attestation = await runtimeAssetPolicyAttestation(projectDir, project, project.frames[0], {
    checkpoint_key: 'scene_01', mp4_path: checkpoint.mp4_path, output_hash: outputHash,
  });
  return project;
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

let cleanupRoot = '';
(async () => {
  const rootDir = cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-export-dedup-'));
  const projectDir = path.join(rootDir, 'project');
  await writeFile(path.join(projectDir, 'frames', 'scene_01.mp4'), 'frame');
  await writeFile(path.join(projectDir, 'frames', 'scene_01.html'), '<html><body>frame</body></html>');
  await writeFile(path.join(projectDir, 'tts.wav'), 'audio');

  const base = { rootDir, workflowId: 'workflow', runId: 'run', projectDir, services: { ffmpegComposer } };

  const first = await projectOrchestrator.composeHtmlVideoProject({ ...base, project: await makeProject(projectDir) });
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
}).finally(() => cleanupRoot && fs.rm(cleanupRoot, { recursive: true, force: true }));
