const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { getArtifactRoot } = require('./artifactStore');
const { DEFAULT_ROOT } = require('../workflowStore');
const { WhiteboardError, sha256 } = require('./contracts');
const { hashFile } = require('./mediaTools');
const { safeVisionDiagnostics } = require('./visionDiagnostics');

const MEDIA_CONTRACT = 'musedock-whiteboard-media-v1';
const STAGES = [
  ['full_narration', '生成完整旁白'], ['lineart_generation', '生成线稿'],
  ['annotation_drafting', '编排落墨区域'], ['scene_render', '渲染单幕动画'], ['final_delivery', '合成最终视频'],
].map(([id, label]) => ({ id, label, status: 'pending', message: '' }));
const GATES = { full_narration: 'full_narration', lineart_generation: 'lineart_approval',
  annotation_drafting: 'annotation_approval', scene_render: 'scene_bundle_approval', final_delivery: 'final_approval' };
const TITLES = { full_narration: '请试听完整旁白与检查真实字幕', lineart_approval: '请检查全部线稿',
  annotation_approval: '请检查落墨顺序、区域与保护区', scene_bundle_approval: '请按顺序检查全部单幕动画', final_approval: '最终视频已就绪，请播放并确认' };

function mediaIdentity(media) {
  return sha256({ contract: MEDIA_CONTRACT, planIdentity: media.planIdentity, runId: media.id,
    stage: media.stage, gate: media.gate || '', revision: media.revision,
    latestAttemptId: media.attempts.at(-1)?.id || '',
    ...(media.lowCoverage?.length ? { lowCoverage: media.lowCoverage.map(entry => entry.identity || sha256(entry)) } : {}),
    current: Object.fromEntries(Object.entries(media.current || {}).map(([key, value]) => [key, value?.identity || ''])) });
}

function makeMedia(planIdentity, recipe) {
  return { contractVersion: MEDIA_CONTRACT, id: crypto.randomUUID(), planIdentity, recipe,
    stageSchemaSnapshot: structuredClone(STAGES), stages: structuredClone(STAGES), revision: 1,
    stage: STAGES[0].id, gate: '', current: {}, attempts: [], artifacts: [], approvals: [],
    lineart: {}, annotations: {}, lowCoverage: [], scenes: {}, overrides: {}, stale: false, activeAttemptId: '' };
}

function workDirectory(workflowId, attemptId, rootDir = DEFAULT_ROOT) {
  getArtifactRoot(workflowId, rootDir);
  if (!/^[a-f0-9-]{36}$/.test(attemptId)) throw new WhiteboardError('INVALID_ATTEMPT', '媒体版本标识无效。');
  return path.resolve(rootDir, '.whiteboard-work', workflowId, attemptId);
}

async function publishFile(record, attempt, source, { kind, name, sceneId = '', mime = '', rootDir } = {}) {
  const fileName = path.basename(source);
  if (!/^[a-zA-Z0-9_.-]+$/.test(fileName)) throw new WhiteboardError('INVALID_PATH', '媒体文件名无效。');
  const directory = path.join(getArtifactRoot(record.workflow_id, rootDir), attempt.id);
  await fsp.mkdir(directory, { recursive: true });
  const bytes = await fsp.readFile(source);
  await fsp.writeFile(path.join(directory, fileName), bytes, { flag: 'wx' });
  const artifact = { id: crypto.randomUUID(), attemptId: attempt.id, fileName, kind, name, sceneId, mime,
    bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  record.whiteboard.media.artifacts.push(artifact);
  return artifact;
}

async function mediaFile(record, descriptor, rootDir) {
  const artifact = [record.whiteboard.media, ...(record.whiteboard.mediaHistory || [])].filter(Boolean)
    .flatMap(media => media.artifacts).find(item => item.id === (typeof descriptor === 'string' ? descriptor : descriptor?.id));
  if (!artifact || !/^[a-f0-9-]{36}$/.test(artifact.attemptId) || !/^[a-zA-Z0-9_.-]+$/.test(artifact.fileName)) {
    throw new WhiteboardError('ARTIFACT_INVALID', '未找到当前媒体产物。', 404);
  }
  const root = getArtifactRoot(record.workflow_id, rootDir);
  const file = path.join(root, artifact.attemptId, artifact.fileName);
  try {
    const stat = await fsp.lstat(file);
    const real = await fsp.realpath(file);
    const relative = path.relative(await fsp.realpath(root), real);
    if (!stat.isFile() || stat.isSymbolicLink() || relative.startsWith('..') || path.isAbsolute(relative)
      || stat.size !== artifact.bytes || await hashFile(file) !== artifact.sha256) throw new Error();
  } catch { throw new WhiteboardError('ARTIFACT_INVALID', '媒体文件缺失或已变化，无法继续使用或确认。', 409); }
  return { path: file, artifact };
}

async function readData(record, descriptor, rootDir) {
  return JSON.parse(await fsp.readFile((await mediaFile(record, descriptor, rootDir)).path, 'utf8'));
}

function fileIds(value) {
  if (!value || typeof value !== 'object') return [];
  if (typeof value.id === 'string' && typeof value.sha256 === 'string' && value.fileName) return [value.id];
  return Object.values(value).flatMap(item => Array.isArray(item) ? item.flatMap(fileIds) : fileIds(item));
}

async function validateBinding(record, binding, rootDir) {
  if (!binding || binding.stale) throw new WhiteboardError('STALE_IDENTITY', '当前媒体产物已失效，请先重新生成对应阶段。', 409);
  const { identity, ...body } = binding;
  if (sha256(bindingContent(body)) !== identity) throw new WhiteboardError('ARTIFACT_INVALID', '媒体产物身份不匹配。', 409);
  for (const id of new Set(fileIds(binding))) await mediaFile(record, id, rootDir);
  return binding;
}

function bindingContent(value) {
  if (Array.isArray(value)) return value.map(bindingContent);
  if (!value || typeof value !== 'object') return value;
  if (value.fileName && value.sha256) return { sha256: value.sha256, bytes: value.bytes, mime: value.mime, kind: value.kind, sceneId: value.sceneId };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bindingContent(item)]));
}
function bind(value) { return { ...value, identity: sha256(bindingContent(value)) }; }
function publicMedia(record) {
  const media = structuredClone(record.whiteboard.media);
  if (!media) return null;
  media.identity = mediaIdentity(media);
  media.artifacts = media.artifacts.map(artifact => ({ ...artifact,
    url: `/api/creative-workflows/${record.workflow_id}/whiteboard/media/${artifact.id}` }));
  media.attempts = media.attempts.map(({ input, diagnostics, ...attempt }) => ({ ...attempt,
    ...(diagnostics ? { diagnostics: safeVisionDiagnostics(diagnostics) } : {}) }));
  return media;
}

module.exports = { MEDIA_CONTRACT, STAGES, GATES, TITLES, makeMedia, mediaIdentity, workDirectory,
  publishFile, mediaFile, readData, validateBinding, bind, publicMedia, fileIds };
