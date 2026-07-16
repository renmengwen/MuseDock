const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const { runtimeAssetPolicyAttestation } = require('../server/services/creative-video/html-video/frameRenderPhase');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

let cleanupRoot = '';
(async () => {
  const rootDir = cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-audio-contract-'));
  const projectDir = path.join(rootDir, 'project');
  await writeFile(path.join(projectDir, 'frames', 'scene_01.mp4'), 'frame');
  await writeFile(path.join(projectDir, 'frames', 'scene_01.html'), '<html><body>frame</body></html>');
  await writeFile(path.join(projectDir, 'tts.wav'), 'audio');

  const project = {
    project_id: 'project',
    workflow_id: 'workflow',
    run_id: 'run',
    output: { resolution: { width: 1920, height: 1080 }, fps: 30 },
    frames: [
      { id: 'scene_01', scene_id: 'scene_01', html_path: 'frames/scene_01.html', duration_sec: 2 },
    ],
    generation_checkpoint: {
      stages: {
        render: {
          frames: {
            scene_01: { status: 'done', mp4_path: 'frames/scene_01.mp4' },
          },
        },
      },
    },
    audio: {
      status: 'ready',
      narration_path: path.join(projectDir, 'tts.wav'),
    },
  };
  const outputHash = crypto.createHash('sha256').update(await fs.readFile(path.join(projectDir, 'frames', 'scene_01.mp4'))).digest('hex');
  project.generation_checkpoint.stages.render.frames.scene_01.output_hash = outputHash;
  project.generation_checkpoint.stages.render.frames.scene_01.runtime_asset_policy_attestation = await runtimeAssetPolicyAttestation(
    projectDir, project, project.frames[0], { checkpoint_key: 'scene_01', mp4_path: 'frames/scene_01.mp4', output_hash: outputHash },
  );

  const result = await projectOrchestrator.composeHtmlVideoProject({
    rootDir,
    workflowId: 'workflow',
    runId: 'run',
    projectDir,
    project,
    services: {
      ffmpegComposer: {
        concatFramesWithFfmpeg: async (frames, outputPath) => {
          await writeFile(outputPath, 'silent video');
          return { success: true, output_path: outputPath, strategy: 'stub' };
        },
        muxAudioWithFfmpeg: async ({ outputPath }) => {
          await writeFile(outputPath, 'muxed without audio');
          return { success: true, output_path: outputPath };
        },
        verifyDurationWithFfprobe: async () => ({ success: true, duration_sec: 2, expected_duration_sec: 2 }),
        verifyAudioStreamWithFfprobe: async () => ({
          success: false,
          code: 'audio_stream_missing',
          message: '导出文件没有音频轨。',
        }),
      },
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.diagnostics.some(item => item.code === 'render_output_missing_audio'), true);

  const saved = JSON.parse(await fs.readFile(path.join(projectDir, 'project.json'), 'utf8'));
  assert.equal(saved.generation_checkpoint.stages.compose.status, 'failed');
  assert.equal(saved.generation_checkpoint.stages.compose.diagnostic_code, 'render_output_missing_audio');
  assert.equal(Array.isArray(saved.exports) ? saved.exports.length : 0, 0);

  console.log('html-video audio export contract tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
}).finally(() => cleanupRoot && fs.rm(cleanupRoot, { recursive: true, force: true }));
