const fsp = require('fs/promises');
const path = require('path');
const { getWorkflowPath, DEFAULT_ROOT } = require('../workflowStore');
const { WhiteboardError, canonicalJson, sha256, validateCandidate } = require('./contracts');

function getArtifactRoot(workflowId, rootDir = DEFAULT_ROOT) {
  getWorkflowPath(workflowId, rootDir);
  const parent = path.resolve(rootDir, 'whiteboard-artifacts');
  const target = path.resolve(parent, String(workflowId));
  const relative = path.relative(parent, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new WhiteboardError('INVALID_PATH', '白板产物路径无效。');
  return target;
}

function getAttemptDirectory(workflowId, attemptId, rootDir) {
  if (!/^[a-f0-9-]{36}$/.test(attemptId || '')) throw new WhiteboardError('INVALID_ATTEMPT', '白板版本标识无效。');
  return path.join(getArtifactRoot(workflowId, rootDir), attemptId);
}

async function writeImmutable(workflowId, attemptId, fileName, value, rootDir) {
  const directory = getAttemptDirectory(workflowId, attemptId, rootDir);
  const bytes = canonicalJson(value);
  await fsp.mkdir(directory, { recursive: true });
  await fsp.writeFile(path.join(directory, fileName), bytes, { encoding: 'utf8', flag: 'wx' });
  return sha256(bytes);
}

async function readAttemptFailure(record, attempt, rootDir) {
  if (attempt?.kind !== 'model' || attempt.status !== 'failed') return null;
  const failure = {
    attemptId: attempt.id, attemptNumber: attempt.number,
    errorCode: attempt.errorCode, message: attempt.message,
  };
  if (attempt.errorCode !== 'CANDIDATE_INVALID' || !attempt.taskSha256 || ![0, 1].includes(attempt.repairCount)) return failure;
  try {
    const directory = getAttemptDirectory(record.workflow_id, attempt.id, rootDir);
    const taskBytes = await fsp.readFile(path.join(directory, 'task.json'), 'utf8');
    const task = JSON.parse(taskBytes);
    if (sha256(taskBytes) !== attempt.taskSha256 || task.inputIdentity !== attempt.inputIdentity
      || canonicalJson(task.input) !== canonicalJson(attempt.input)
      || canonicalJson(task.productionPlan) !== canonicalJson(attempt.productionPlan)) throw new Error('failure input mismatch');
    const bytes = await fsp.readFile(path.join(directory, `candidate-response-${attempt.repairCount}.json`), 'utf8');
    const saved = JSON.parse(bytes);
    if (!saved || !Object.hasOwn(saved, 'candidate') || !Array.isArray(saved.validationErrors)
      || !saved.validationErrors.length || saved.validationErrors.some(error => typeof error !== 'string')) throw new Error('invalid failure record');
    // 旧失败记录也用当前字段诊断补全反馈；原始候选和错误文件保持不变。
    const invalidJson = saved.candidate && Object.keys(saved.candidate).length === 1 && typeof saved.candidate.invalidJson === 'string';
    const validationErrors = invalidJson ? saved.validationErrors : validateCandidate(saved.candidate, attempt.input);
    return { ...failure, candidate: saved.candidate, candidateSha256: sha256(bytes),
      validationErrors: validationErrors.length ? validationErrors : saved.validationErrors };
  } catch (error) {
    // 早期任务或未保存候选的失败仍可携带已记录的失败原因重新生成。
    if (error.code === 'ENOENT') return failure;
    throw new WhiteboardError('ARTIFACT_INVALID', '上次失败方案的诊断文件已变化或损坏，无法安全读取重试上下文，请检查本地任务文件。', 409);
  }
}

async function publishArtifact({ record, attempt, candidate, artifact, taskSha256, rootDir }) {
  const candidateSha256 = await writeImmutable(record.workflow_id, attempt.id, 'candidate.json', candidate, rootDir);
  const artifactSha256 = await writeImmutable(record.workflow_id, attempt.id, 'content-plan.json', artifact, rootDir);
  const identity = sha256({
    creationModeId: record.creationModeId,
    creationModeContractVersion: record.creationModeContractVersion,
    skillContractVersion: record.skillContractVersion,
    skillSourceRevision: record.skillSourceRevision,
    inputIdentity: attempt.inputIdentity,
    artifactSha256,
  });
  const receipt = { schemaVersion: 1, status: 'validated', taskSha256, candidateSha256, artifactSha256, identity };
  const resultSha256 = await writeImmutable(record.workflow_id, attempt.id, 'result.json', receipt, rootDir);
  return { attemptId: attempt.id, identity, taskSha256, candidateSha256, artifactSha256, resultSha256, stale: false };
}

async function readArtifact(record, binding, rootDir) {
  if (!binding) return null;
  const directory = getAttemptDirectory(record.workflow_id, binding.attemptId, rootDir);
  try {
    const entries = await Promise.all([
      ['task.json', 'taskSha256'], ['candidate.json', 'candidateSha256'],
      ['content-plan.json', 'artifactSha256'], ['result.json', 'resultSha256'],
    ].map(async ([fileName, hashKey]) => {
      const bytes = await fsp.readFile(path.join(directory, fileName), 'utf8');
      if (sha256(bytes) !== binding[hashKey]) throw new Error('hash mismatch');
      return JSON.parse(bytes);
    }));
    const [task, , artifact, result] = entries;
    if (result.status !== 'validated' || result.identity !== binding.identity
      || result.artifactSha256 !== binding.artifactSha256 || result.taskSha256 !== binding.taskSha256
      || result.candidateSha256 !== binding.candidateSha256
      || task.formalWritesAllowed !== false || task.approvalWritesAllowed !== false) throw new Error('binding mismatch');
    const attempt = record.whiteboard.attempts.find(item => item.id === binding.attemptId);
    const identity = sha256({
      creationModeId: record.creationModeId, creationModeContractVersion: record.creationModeContractVersion,
      skillContractVersion: record.skillContractVersion, skillSourceRevision: record.skillSourceRevision,
      inputIdentity: attempt?.inputIdentity, artifactSha256: binding.artifactSha256,
    });
    if (identity !== binding.identity || task.inputIdentity !== attempt?.inputIdentity) throw new Error('identity mismatch');
    return artifact;
  } catch {
    throw new WhiteboardError('ARTIFACT_INVALID', '当前方案文件缺失或已变化，无法批准。请检查本地文件或生成新的方案版本。', 409);
  }
}

module.exports = { getArtifactRoot, writeImmutable, readAttemptFailure, publishArtifact, readArtifact };
