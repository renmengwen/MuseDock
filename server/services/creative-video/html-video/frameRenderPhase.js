const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const defaultMaterializer = require('./materializer');
const defaultFrameRenderer = require('./frameRenderer');
const projectStore = require('./projectStore');
const { saveProject, createProjectDir } = projectStore;
const { normalizeProject, markCheckpointFrame, markCheckpointStage } = require('./projectSchema');
const { createDiagnostic, normalizeDiagnostics } = require('./diagnostics');
const { sanitizePathSegment } = require('./frameIdentity');
const { objectOrEmpty, report, getOutputConfig } = require('./timelineGuards');
const { buildAssetUsageReport, updateRuntimePolicyViolations } = require('./assetUsagePhase');
const { ADAPTER_VERSION } = require('./hyperframesPlaywrightAdapter');
const RUNTIME_ASSET_POLICY_VERSION = 'runtime-asset-policy-v2';

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function runtimeAssetPolicyAttestation(projectDir, project = {}, frame = {}, checkpoint = {}) {
  const htmlPath = path.resolve(projectDir, String(frame.html_path || frame.htmlPath || ''));
  const htmlHash = await fileHash(htmlPath);
  const outputConfig = getOutputConfig(project);
  const registry = await Promise.all((Array.isArray(project.assets) ? project.assets : [])
    .filter(asset => {
      const type = String(asset?.media_type || asset?.type || '').toLowerCase();
      return type === 'image' || type.startsWith('image/');
    })
    .map(async asset => {
      const assetPath = String(asset.path || '');
      let bytesSha256 = '';
      try {
        bytesSha256 = await fileHash(projectStore.resolveProjectPath(projectDir, assetPath));
      } catch {
        bytesSha256 = '';
      }
      return {
        id: String(asset.id || ''),
        media_type: String(asset.media_type || asset.type || ''),
        status: String(asset.status || ''),
        path: assetPath,
        frame_src: String(asset.frame_src || ''),
        bytes_sha256: bytesSha256,
      };
    }));
  registry
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const registryHash = hashValue(JSON.stringify(registry));
  const checkpointKey = String(checkpoint.checkpoint_key || renderCheckpointKey(frame));
  const mp4Path = String(checkpoint.mp4_path || '');
  const outputHash = String(checkpoint.output_hash || '');
  const mp4Hash = checkpoint.mp4_hash || await fileHash(path.resolve(projectDir, mp4Path));
  const frameId = String(frame.id || frame.scene_id || '');
  const resolution = {
    width: Number(outputConfig.resolution?.width) || 0,
    height: Number(outputConfig.resolution?.height) || 0,
  };
  const fps = Number(outputConfig.fps) || 0;
  const durationSec = Number(frame.duration_sec ?? frame.durationSec) || 0;
  const rendererRuntimeContractVersion = `hyperframes-playwright@${ADAPTER_VERSION}`;
  const input = {
    html_hash: htmlHash,
    resolution,
    fps,
    duration_sec: durationSec,
    renderer_runtime_contract_version: rendererRuntimeContractVersion,
    registry,
  };
  return {
    version: RUNTIME_ASSET_POLICY_VERSION,
    frame_id: frameId,
    checkpoint_key: checkpointKey,
    html_hash: htmlHash,
    resolution,
    fps,
    duration_sec: durationSec,
    renderer_runtime_contract_version: rendererRuntimeContractVersion,
    registry,
    registry_hash: registryHash,
    mp4_path: mp4Path,
    output_hash: outputHash,
    mp4_hash: mp4Hash,
    fingerprint: hashValue(JSON.stringify([RUNTIME_ASSET_POLICY_VERSION, frameId, checkpointKey, input, mp4Path, outputHash, mp4Hash])),
  };
}

function renderAttestationMatches(actual, expected) {
  return Boolean(actual && expected && [
    'version',
    'renderer_runtime_contract_version',
    'fingerprint',
    'frame_id',
    'checkpoint_key',
    'mp4_path',
    'output_hash',
    'mp4_hash',
  ].every(key => actual[key] === expected[key]));
}

function runtimePolicyViolations(result = {}) {
  if (result.code !== 'runtime_visual_asset_policy_violation') return [];
  const diagnostic = (Array.isArray(result.diagnostics) ? result.diagnostics : [])
    .find(item => item?.code === result.code);
  return Array.isArray(diagnostic?.details?.violations) ? diagnostic.details.violations : [];
}

async function fileHash(filePath) {
  try {
    return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
  } catch {
    return '';
  }
}

function markRenderCheckpoint(project, sceneId, patch = {}) {
  return markCheckpointFrame(project, 'render', sceneId, patch);
}

// 渲染检查点键：旧工程帧与场景 1:1（frame.id === scene_id），沿用 scene_id 优先；
// beat 展开帧同场景有多帧，必须按帧（beat）唯一键控，否则合成会重复取同一段 mp4；
// scene_html 的 scene 级帧（id = scene:<scene_id>、beat_id 为空）必须按 frame.id 键控，
// 否则会错位成 scene_id 与 frameHtmlPhase/retry 的 scene:<id> 键对不上（R2）。
function renderCheckpointKey(frame = {}) {
  const frameId = String(frame.id || '').trim();
  if (frameId.startsWith('scene:')) return frameId;
  const beatId = String(frame.beat_id || frame.beatId || '').trim();
  if (beatId) return String(frame.id || beatId).trim();
  return String(frame.scene_id || frame.id || '').trim();
}

function relativeProjectPath(projectDir, filePath) {
  return path.relative(projectDir, filePath).replace(/\\/g, '/');
}

async function resolveNarrationPath(project, projectDir, ffmpegComposer, diagnostics) {
  if (project.audio?.narration_path) {
    return path.isAbsolute(project.audio.narration_path)
      ? project.audio.narration_path
      : path.join(projectDir, project.audio.narration_path);
  }
  const manifestPath = project.audio?.tts_manifest_path;
  if (!manifestPath) return null;
  const absoluteManifestPath = path.isAbsolute(manifestPath) ? manifestPath : path.join(projectDir, manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(absoluteManifestPath, 'utf8'));
  } catch (error) {
    diagnostics.push(createDiagnostic({
      code: 'tts_manifest_missing',
      stage: 'compose',
      sub_stage: 'compose',
      user_message: `读取旁白音频清单失败：${error.message}`,
      retryable: true,
      repair_action: 'retry_compose',
      details: { manifest_path: manifestPath },
    }));
    return null;
  }
  const sceneFiles = (Array.isArray(manifest.scenes) ? manifest.scenes : [])
    .map(scene => scene.path || (scene.relative_path ? path.join(projectDir, scene.relative_path) : null))
    .filter(Boolean)
    .map(filePath => ({ path: path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath) }));
  if (!sceneFiles.length) return null;
  if (typeof ffmpegComposer.concatAudioWithFfmpeg !== 'function') return sceneFiles[0].path;
  const outputPath = path.join(projectDir, 'exports', 'narration-track.mp3');
  const concat = await ffmpegComposer.concatAudioWithFfmpeg(sceneFiles, outputPath, projectDir);
  if (!concat.success) {
    diagnostics.push(createDiagnostic({
      code: 'compose_failed',
      stage: 'compose',
      sub_stage: 'compose',
      user_message: concat.message || '旁白音频拼接失败。',
      retryable: true,
      repair_action: 'retry_compose',
      details: { stderr: concat.stderr },
    }));
    return null;
  }
  return concat.output_path || outputPath;
}

async function formalFrameMp4(projectDir, checkpoint = {}) {
  const mp4Path = String(checkpoint.mp4_path || '').trim().replace(/\\/g, '/');
  if (!/^frames\/[^/]+\.mp4$/.test(mp4Path) || path.isAbsolute(mp4Path) || path.posix.normalize(mp4Path) !== mp4Path) return null;
  const framesRoot = await fs.realpath(path.join(projectDir, 'frames')).catch(() => '');
  const realPath = await fs.realpath(path.resolve(projectDir, mp4Path)).catch(() => '');
  if (!framesRoot || !realPath) return null;
  const relative = path.relative(framesRoot, realPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return { relative_path: mp4Path, real_path: realPath, hash: await fileHash(realPath) };
}

async function collectRenderedFramesFromProject(project, projectDir) {
  const renderedFrames = [];
  const checkpointFrames = objectOrEmpty(project?.generation_checkpoint?.stages?.render?.frames);
  for (const frame of Array.isArray(project?.frames) ? project.frames : []) {
    const frameId = frame.id || frame.scene_id || '';
    const checkpointKey = renderCheckpointKey(frame);
    const checkpoint = objectOrEmpty(checkpointFrames[checkpointKey] || checkpointFrames[frameId]);
    if (checkpoint.status !== 'done') continue;
    const formal = await formalFrameMp4(projectDir, checkpoint);
    if (!formal || !checkpoint.output_hash || formal.hash !== checkpoint.output_hash) continue;
    renderedFrames.push({
      path: formal.real_path,
      engine: frame.engine,
      encoding: frame.encoding || checkpoint.encoding,
      frame_id: frameId,
    });
  }
  return renderedFrames;
}

async function missingRenderedFrameIds(project, projectDir) {
  const missing = [];
  const checkpointFrames = objectOrEmpty(project?.generation_checkpoint?.stages?.render?.frames);
  for (const frame of Array.isArray(project?.frames) ? project.frames : []) {
    const frameId = frame.id || frame.scene_id || '';
    const checkpointKey = renderCheckpointKey(frame);
    const checkpoint = objectOrEmpty(checkpointFrames[checkpointKey] || checkpointFrames[frameId]);
    if (checkpoint.status !== 'done') {
      missing.push(checkpointKey || frameId);
    }
  }
  return missing.filter(Boolean);
}

async function ensureProjectDir({ rootDir, workflowId, runId, projectDir }) {
  if (projectDir) return projectDir;
  return createProjectDir({ rootDir, workflowId, runId });
}

async function createProject({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
} = {}) {
  const resolvedProjectDir = await ensureProjectDir({ rootDir, workflowId, runId, projectDir });
  const nextProject = normalizeProject(project);
  await saveProject(resolvedProjectDir, nextProject);
  return {
    success: true,
    project: nextProject,
    project_dir: resolvedProjectDir,
    html_video_project_path: resolvedProjectDir,
  };
}

async function materializeProject({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
  services = {},
} = {}) {
  const materializer = services.materializer || defaultMaterializer;
  const resolvedProjectDir = await ensureProjectDir({ rootDir, workflowId, runId, projectDir });
  const materialized = await materializer.materializeProject({
    projectDir: resolvedProjectDir,
    project: normalizeProject(project),
  });
  const nextProject = normalizeProject(materialized.project);
  await saveProject(resolvedProjectDir, nextProject);
  return {
    success: true,
    project: nextProject,
    project_dir: resolvedProjectDir,
    html_video_project_path: resolvedProjectDir,
    diagnostics: normalizeDiagnostics(materialized.diagnostics, { stage: 'materialize' }),
  };
}

async function renderHtmlVideoFrames({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
  frameIds,
  services = {},
  onProgress = null,
  materialize = false,
} = {}) {
  const materializer = services.materializer || defaultMaterializer;
  const frameRenderer = services.frameRenderer || defaultFrameRenderer;
  const resolvedProjectDir = await ensureProjectDir({ rootDir, workflowId, runId, projectDir });
  let nextProject = normalizeProject(project);
  const diagnostics = [];

  if (materialize) {
    const materialized = await materializer.materializeProject({
      projectDir: resolvedProjectDir,
      project: nextProject,
    });
    nextProject = normalizeProject(materialized.project);
    diagnostics.push(...normalizeDiagnostics(materialized.diagnostics, { stage: 'materialize' }));
  }
  await saveProject(resolvedProjectDir, nextProject);

  const outputConfig = getOutputConfig(nextProject);
  const allFrames = Array.isArray(nextProject.frames) ? nextProject.frames : [];
  const requestedFrameIds = (Array.isArray(frameIds) ? frameIds : (frameIds ? [frameIds] : []))
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const requested = new Set(requestedFrameIds);
  const frames = requested.size
    ? allFrames.filter(frame => requested.has(String(frame.id || '')) || requested.has(String(frame.scene_id || '')))
    : allFrames;
  if (requested.size) {
    const matched = new Set(frames.flatMap(frame => [String(frame.id || ''), String(frame.scene_id || '')].filter(Boolean)));
    const missing = requestedFrameIds.filter(id => !matched.has(id));
    if (missing.length) {
      const diagnostic = createDiagnostic({
        code: 'frame_not_found',
        stage: 'render',
        sub_stage: 'render',
        user_message: `未找到要渲染的帧：${missing.join(', ')}。`,
        retryable: false,
        details: { frame_ids: missing },
      });
      return {
        success: false,
        message: diagnostic.user_message,
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        rendered_frames: [],
        diagnostics: [diagnostic],
      };
    }
  }
  const renderedFrames = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const allFrameIndex = allFrames.indexOf(frame);
    const progressIndex = allFrameIndex >= 0 ? allFrameIndex : index;
    const frameId = frame.id || frame.scene_id || `frame_${progressIndex + 1}`;
    const checkpointKey = renderCheckpointKey(frame) || frameId;
    // scene_html 的帧 id 带 ':'（scene:<id>），Windows 文件名非法，落盘名统一净化；
    // 既有 beat/scene id 只含字母数字下划线，sanitize 为恒等变换，输出文件名不变
    const outputName = sanitizePathSegment(frame.id || frame.scene_id || frameId);
    const frameOutput = path.join(resolvedProjectDir, 'frames', `${outputName}.mp4`);
    const checkpointFrames = objectOrEmpty(nextProject?.generation_checkpoint?.stages?.render?.frames);
    const checkpoint = objectOrEmpty(checkpointFrames[checkpointKey] || checkpointFrames[frameId]);
    if (checkpoint.status === 'done') {
      const formal = await formalFrameMp4(resolvedProjectDir, checkpoint);
      if (formal && checkpoint.output_hash && formal.hash === checkpoint.output_hash) {
        const expected = await runtimeAssetPolicyAttestation(resolvedProjectDir, nextProject, frame, {
          checkpoint_key: checkpointKey,
          mp4_path: checkpoint.mp4_path,
          output_hash: checkpoint.output_hash,
          mp4_hash: formal.hash,
        });
        if (renderAttestationMatches(checkpoint.runtime_asset_policy_attestation, expected)) {
          renderedFrames.push({
            path: formal.real_path,
            engine: frame.engine,
            encoding: frame.encoding || checkpoint.encoding,
            frame_id: frameId,
          });
          continue;
        }
      }
    }
    const rendered = await frameRenderer.renderFrame(frame, {
      projectDir: resolvedProjectDir,
      project: nextProject,
      outputPath: frameOutput,
      resolution: outputConfig.resolution,
      fps: outputConfig.fps,
      onProgress: progress => report(onProgress, {
        type: 'html_video_frame_render_progress',
        stage: 'project',
        sub_stage: 'render',
        message: progress?.message || `正在渲染第 ${progressIndex + 1}/${allFrames.length} 帧...`,
        frame_id: frameId,
        frame_progress: progress?.percent,
        data: {
          frame_id: frameId,
          index: progressIndex,
          total: allFrames.length,
          percent: progress?.percent,
        },
      }),
    });
    diagnostics.push(...normalizeDiagnostics(rendered.diagnostics, {
      stage: 'render',
      sub_stage: 'render',
      frame_id: frameId,
      details: { frame_id: frameId },
    }));
    if (!rendered.success) {
      const policyFailure = rendered.code === 'runtime_visual_asset_policy_violation';
      const policyViolations = runtimePolicyViolations(rendered);
      nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
        markRenderCheckpoint(current, checkpointKey, {
          status: 'failed',
          diagnostic_code: rendered.code || 'render_failed',
        });
        markCheckpointStage(current, 'render', { status: 'failed' });
        if (policyFailure) {
          current.asset_usage_report = updateRuntimePolicyViolations(
            buildAssetUsageReport({ project: current, projectDir: resolvedProjectDir }),
            frameId,
            policyViolations,
          );
        }
        return current;
      });
      diagnostics.push(createDiagnostic({
        code: rendered.code || 'render_failed',
        stage: 'render',
        sub_stage: policyFailure ? 'frame_html' : 'render',
        frame_id: frameId,
        user_message: rendered.message || 'html-video 帧渲染失败。',
        retryable: true,
        repair_action: policyFailure ? 'retry_frame_html' : 'retry_render',
        details: { frame_id: frameId, output_path: rendered.output_path, ...(policyFailure ? { violations: policyViolations } : {}) },
      }));
      return {
        success: false,
        code: rendered.code || 'render_failed',
        message: rendered.message || 'html-video 帧渲染失败。',
        project: nextProject,
        project_dir: resolvedProjectDir,
        html_video_project_path: resolvedProjectDir,
        rendered_frames: renderedFrames,
        diagnostics,
      };
    }

    const outputHash = await fileHash(rendered.output_path);
    const mp4Path = relativeProjectPath(resolvedProjectDir, rendered.output_path);
    const attestation = await runtimeAssetPolicyAttestation(resolvedProjectDir, nextProject, frame, {
      checkpoint_key: checkpointKey, mp4_path: mp4Path, output_hash: outputHash, mp4_hash: outputHash,
    });
    nextProject = await projectStore.writeProjectJson(resolvedProjectDir, current => {
      markRenderCheckpoint(current, checkpointKey, {
        status: 'done',
        mp4_path: mp4Path,
        output_hash: outputHash || '',
        diagnostic_code: '',
        runtime_asset_policy_attestation: attestation,
      });
      const checkpointFrames = objectOrEmpty(current.generation_checkpoint?.stages?.render?.frames);
      const frameStatuses = (Array.isArray(current.frames) ? current.frames : [])
        .map(item => checkpointFrames[renderCheckpointKey(item)]?.status);
      const doneCount = frameStatuses.filter(status => status === 'done').length;
      markCheckpointStage(current, 'render', {
        status: frameStatuses.length && doneCount === frameStatuses.length
          ? 'done'
          : (doneCount ? 'partial' : 'pending'),
      });
      if (current.asset_usage_report?.runtime_policy_violations) {
        current.asset_usage_report = updateRuntimePolicyViolations(current.asset_usage_report, frameId, []);
      }
      return current;
    });
    renderedFrames.push({
      path: rendered.output_path,
      engine: frame.engine,
      encoding: rendered.meta?.encoding,
      frame_id: frameId,
    });
  }

  return {
    success: true,
    project: nextProject,
    project_dir: resolvedProjectDir,
    html_video_project_path: resolvedProjectDir,
    rendered_frames: renderedFrames,
    diagnostics,
  };
}

module.exports = {
  markRenderCheckpoint,
  renderCheckpointKey,
  relativeProjectPath,
  resolveNarrationPath,
  collectRenderedFramesFromProject,
  missingRenderedFrameIds,
  ensureProjectDir,
  createProject,
  materializeProject,
  renderHtmlVideoFrames,
  runtimeAssetPolicyAttestation,
  renderAttestationMatches,
  RUNTIME_ASSET_POLICY_VERSION,
  formalFrameMp4,
};
