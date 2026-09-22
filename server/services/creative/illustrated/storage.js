const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const workflowStore = require('../workflowStore');
const { MODE, ErrorType, hash } = require('./contracts');

function assertContract(record) {
  if (record.creationModeId !== MODE || record.creationModeContractVersion !== 1 || record.illustrated?.schemaVersion !== 1) {
    throw new ErrorType('CONTRACT_UNSUPPORTED', '此任务的模式或合同版本不受支持，请检查应用版本。', 409);
  }
}
function mediaRoot(workflowId, rootDir = workflowStore.DEFAULT_ROOT) {
  workflowStore.getWorkflowPath(workflowId, rootDir);
  return path.join(path.resolve(rootDir), '.illustrated-media', workflowId);
}
async function digest(file) {
  const value = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) value.update(chunk);
  return value.digest('hex');
}
async function putFile(record, source, { kind, ext, mime, ...metadata }, rootDir) {
  if (!/^[a-z][a-z0-9_-]*$/.test(kind) || !/^[a-z0-9]+$/.test(ext)) throw new ErrorType('ARTIFACT_INVALID', '媒体类型无效。');
  const fileHash = await digest(source);
  const id = kind + '_' + fileHash;
  const fileName = id + '.' + ext;
  const directory = mediaRoot(record.workflow_id, rootDir);
  await fsp.mkdir(directory, { recursive: true });
  const target = path.join(directory, fileName);
  if (path.resolve(source) !== target) {
    try { await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (await digest(target) !== fileHash) throw new ErrorType('ARTIFACT_INVALID', '媒体文件校验失败，请检查磁盘后重试。');
  const stat = await fsp.stat(target);
  const artifact = { ...metadata, id, kind, fileName, mime, sha256: fileHash, bytes: stat.size, createdAt: new Date().toISOString() };
  record.illustrated.artifacts[id] ||= artifact;
  return record.illustrated.artifacts[id];
}
async function putBuffer(record, buffer, meta, rootDir) {
  const directory = path.join(mediaRoot(record.workflow_id, rootDir), 'work');
  await fsp.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, crypto.randomUUID() + '.' + meta.ext);
  await fsp.writeFile(temporary, buffer, { flag: 'wx' });
  try { return await putFile(record, temporary, meta, rootDir); }
  finally { await fsp.unlink(temporary).catch(() => {}); }
}
async function mediaFile(record, id, rootDir, { checkHash = false } = {}) {
  assertContract(record);
  const artifact = record.illustrated.artifacts[id];
  if (!artifact || !/^[a-z][a-z0-9_-]+$/.test(id) || path.basename(artifact.fileName) !== artifact.fileName) throw new ErrorType('ARTIFACT_NOT_FOUND', '媒体记录不存在。', 404);
  const directory = mediaRoot(record.workflow_id, rootDir);
  const file = path.join(directory, artifact.fileName);
  const [stat, actual, parent] = await Promise.all([fsp.lstat(file), fsp.realpath(file), fsp.realpath(directory)]);
  if (stat.isSymbolicLink() || !stat.isFile() || !workflowStore.isPathInside(actual, parent)
    || stat.size !== artifact.bytes || (checkHash && await digest(file) !== artifact.sha256)) {
    throw new ErrorType('ARTIFACT_INVALID', '媒体文件已变化或不完整，请重新生成受影响片段。', 409);
  }
  return { path: file, artifact };
}
async function validArtifact(record, id, rootDir) {
  if (!id) return false;
  try { await mediaFile(record, id, rootDir, { checkHash: true }); return true; }
  catch { return false; }
}
function url(record, id, download = false) {
  return '/api/creative-workflows/' + record.workflow_id + '/illustrated/media/' + id + (download ? '?download=1' : '');
}
async function mutate(workflowId, options, callback) {
  const rootDir = options.rootDir || workflowStore.DEFAULT_ROOT;
  return workflowStore.withWorkflowFileQueue(workflowStore.getWorkflowPath(workflowId, rootDir), async () => {
    const record = await workflowStore.readWorkflow(workflowId, rootDir);
    assertContract(record);
    const result = await callback(record);
    record.updated_at = new Date().toISOString();
    await workflowStore.persistWorkflowUnlocked(record, rootDir);
    return { record, result };
  });
}
function safeError(error) {
  if (error instanceof ErrorType || (error?.code && /^(NARRATION_|TIMELINE_|MEDIA_|AUDIO_|BGM_|ASR_)/.test(error.code))) return { code: error.code, message: error.message, statusCode: error.statusCode || 400 };
  return { code: 'LOCAL_OPERATION_FAILED', message: '本地处理失败，请检查媒体环境、文件与磁盘空间后重试。', statusCode: 500 };
}
function audit(record, action, data = {}) {
  record.illustrated.events.push({ action, ...data, at: new Date().toISOString() });
  record.illustrated.events = record.illustrated.events.slice(-400);
}
function revision(record, action) {
  record.illustrated.revision += 1;
  audit(record, action, { revision: record.illustrated.revision });
}

module.exports = { ...workflowStore, assertContract, mediaRoot, digest, putFile, putBuffer, mediaFile, validArtifact, url, mutate, safeError, audit, revision };
