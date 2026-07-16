const crypto = require('crypto');
const { constants } = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { normalizeVisualAsset } = require('./visualAssetContract');

const DEFAULT_ROOT = path.join(require('../../dataRoot'), 'data/creative-asset-uploads');
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const STAGED_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STAGED_UPLOADS = 100;
const MAX_STAGED_TOTAL_BYTES = 256 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const UPLOAD_ID_PATTERN = /^upload_[a-z0-9_-]{8,80}$/;
const EXTENSION_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};
const REQUIREMENTS = new Set(['required', 'preferred']);

let mutationQueue = Promise.resolve();
const activeReservationsByRoot = new Map();

function withMutationQueue(task) {
  // ponytail: 本地单用户上传量很小；并发成为瓶颈时再换成按 upload_id 分片的锁。
  const current = mutationQueue.catch(() => {}).then(task);
  mutationQueue = current;
  return current;
}

function createUploadId() {
  return `upload_${crypto.randomBytes(12).toString('hex')}`;
}

function normalizeMime(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function normalizeRequirement(value) {
  const requirement = String(value || 'preferred').trim().toLowerCase();
  if (!REQUIREMENTS.has(requirement)) {
    throw new Error('上传图片的使用约束无效，只能选择 required 或 preferred。');
  }
  return requirement;
}

function sanitizeFileName(value, mime) {
  const extension = EXTENSION_BY_MIME[mime];
  const base = String(value || '').trim().split(/[\\/]/).pop().replace(/[<>:"|?*\u0000-\u001f]/g, '_');
  const stem = path.basename(base, path.extname(base)).replace(/^[. ]+|[. ]+$/g, '').trim() || 'image';
  return `${stem.slice(0, 120)}${extension}`;
}

function uploadDirFor(rootDir, uploadId) {
  if (!UPLOAD_ID_PATTERN.test(String(uploadId || ''))) throw new Error('上传素材 ID 无效。');
  return path.join(path.resolve(rootDir || DEFAULT_ROOT), uploadId);
}

function matchesMagicBytes(mime, header) {
  if (mime === 'image/png') return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/jpeg') return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  return header.length >= 12 && header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP';
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  try {
    await fsp.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function listStagedUsageAndCleanup({ rootDir, nowMs, stagedTtlMs }) {
  await fsp.mkdir(rootDir, { recursive: true });
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });
  let count = 0;
  let bytes = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !UPLOAD_ID_PATTERN.test(entry.name)) continue;
    const uploadDir = path.join(rootDir, entry.name);
    let manifest;
    try {
      manifest = JSON.parse(await fsp.readFile(path.join(uploadDir, 'upload.json'), 'utf8'));
    } catch {
      continue;
    }
    if (manifest.status !== 'staged' && manifest.status !== 'claimed') continue;
    const createdMs = Date.parse(String(manifest.created_at || ''));
    if (Number.isFinite(createdMs) && nowMs - createdMs >= stagedTtlMs) {
      await fsp.rm(uploadDir, { recursive: true, force: true });
      continue;
    }
    if (manifest.status !== 'staged') continue;
    count += 1;
    bytes += Number(manifest.bytes) || 0;
  }
  return { count, bytes };
}

async function cleanupExpiredStagedVisualAssets({
  rootDir = DEFAULT_ROOT,
  now = () => new Date().toISOString(),
  stagedTtlMs = STAGED_TTL_MS,
} = {}) {
  return withMutationQueue(async () => {
    const nowValue = typeof now === 'function' ? now() : now;
    const nowMs = Date.parse(String(nowValue || '')) || Date.now();
    return listStagedUsageAndCleanup({ rootDir: path.resolve(rootDir), nowMs, stagedTtlMs });
  });
}

async function stageVisualAsset({
  stream,
  fileName,
  mime,
  requirement,
  rootDir = DEFAULT_ROOT,
  now = () => new Date().toISOString(),
  uploadId,
  stagedTtlMs = STAGED_TTL_MS,
  maxStagedUploads = MAX_STAGED_UPLOADS,
  maxStagedBytes = MAX_STAGED_TOTAL_BYTES,
} = {}) {
  const normalizedMime = normalizeMime(mime);
  if (!ALLOWED_MIME.has(normalizedMime)) throw new Error('上传失败：仅支持 PNG、JPEG、WebP 图片格式。');
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') throw new Error('上传失败：未收到图片内容。');

  const normalizedRequirement = normalizeRequirement(requirement);
  const createdAt = typeof now === 'function' ? now() : String(now || '');
  const nowMs = Date.parse(createdAt) || Date.now();
  const resolvedRoot = path.resolve(rootDir || DEFAULT_ROOT);
  const id = uploadId || createUploadId();
  const uploadDir = uploadDirFor(resolvedRoot, id);
  const normalizedFileName = sanitizeFileName(fileName, normalizedMime);
  const sourcePath = path.join(uploadDir, `source${EXTENSION_BY_MIME[normalizedMime]}`);
  let handle = null;
  let bytes = 0;
  let header = Buffer.alloc(0);
  let limitError = '';
  let reservation = null;

  reservation = await withMutationQueue(async () => {
    const usage = await listStagedUsageAndCleanup({ rootDir: resolvedRoot, nowMs, stagedTtlMs });
    const active = activeReservationsByRoot.get(resolvedRoot) || new Map();
    if (usage.count + active.size >= maxStagedUploads) {
      throw new Error(`上传失败：暂存图片数量已达到 ${maxStagedUploads} 张配额。`);
    }
    await fsp.mkdir(uploadDir, { recursive: false });
    const next = { id, bytes: 0 };
    active.set(id, next);
    activeReservationsByRoot.set(resolvedRoot, active);
    return next;
  });

  try {
    handle = await fsp.open(sourcePath, 'wx');
    const iterator = stream[Symbol.asyncIterator]();
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      const buffer = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
      bytes += buffer.length;
      reservation.bytes = bytes;
      if (!limitError && bytes > MAX_UPLOAD_BYTES) limitError = '上传失败：单张图片不能超过 8MB。';
      if (limitError) continue;
      if (header.length < 12) header = Buffer.concat([header, buffer]).subarray(0, 12);
      await handle.writeFile(buffer);
    }
    if (limitError) throw new Error(limitError);
    if (bytes === 0) throw new Error('上传失败：图片内容为空。');
    if (!matchesMagicBytes(normalizedMime, header)) throw new Error('上传失败：图片内容与声明格式不匹配。');
    await handle.close();
    handle = null;

    const manifest = {
      upload_id: id,
      file_name: normalizedFileName,
      mime: normalizedMime,
      bytes,
      requirement: normalizedRequirement,
      status: 'staged',
      created_at: createdAt,
    };
    await withMutationQueue(async () => {
      const usage = await listStagedUsageAndCleanup({ rootDir: resolvedRoot, nowMs, stagedTtlMs });
      const active = activeReservationsByRoot.get(resolvedRoot) || new Map();
      const reservedBytes = [...active.values()].reduce((total, item) => total + item.bytes, 0);
      if (usage.bytes + reservedBytes > maxStagedBytes) {
        throw new Error(`上传失败：暂存图片总大小已超过 ${maxStagedBytes} 字节配额。`);
      }
      await writeJsonAtomic(path.join(uploadDir, 'upload.json'), manifest);
      active.delete(id);
      if (active.size) activeReservationsByRoot.set(resolvedRoot, active);
      else activeReservationsByRoot.delete(resolvedRoot);
    });
    reservation = null;
    return { success: true, upload_id: id, status: 'staged', asset: { ...manifest, id } };
  } catch (error) {
    await handle?.close().catch(() => {});
    await withMutationQueue(async () => {
      const active = activeReservationsByRoot.get(resolvedRoot);
      active?.delete(id);
      if (active?.size === 0) activeReservationsByRoot.delete(resolvedRoot);
      await fsp.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    });
    throw error;
  }
}

async function readStagedUpload(rootDir, uploadId) {
  const uploadDir = uploadDirFor(rootDir, uploadId);
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(path.join(uploadDir, 'upload.json'), 'utf8'));
  } catch {
    throw new Error(`上传素材 ${uploadId} 不存在或暂存记录已损坏。`);
  }
  if (manifest.upload_id !== uploadId) throw new Error(`上传素材 ${uploadId} 的暂存记录无效。`);
  if (manifest.status === 'claimed') throw new Error(`上传素材 ${uploadId} 已认领，不能重复使用。`);
  if (manifest.status !== 'staged') throw new Error(`上传素材 ${uploadId} 当前不可认领。`);
  if (!ALLOWED_MIME.has(manifest.mime)) throw new Error(`上传素材 ${uploadId} 的图片格式无效。`);
  normalizeRequirement(manifest.requirement);

  const sourcePath = path.join(uploadDir, `source${EXTENSION_BY_MIME[manifest.mime]}`);
  const stat = await fsp.stat(sourcePath).catch(() => null);
  if (!stat?.isFile() || stat.size !== manifest.bytes) throw new Error(`上传素材 ${uploadId} 的图片文件不存在或不完整。`);
  return { uploadDir, sourcePath, manifest };
}

async function claimVisualAssets({
  uploadIds = [],
  workflowId,
  targetDir,
  rootDir = DEFAULT_ROOT,
  writeManifest = writeJsonAtomic,
} = {}) {
  return withMutationQueue(async () => {
    const ids = [...new Set((Array.isArray(uploadIds) ? uploadIds : []).map(value => String(value || '').trim()))];
    for (const id of ids) {
      if (!UPLOAD_ID_PATTERN.test(id)) throw new Error(`上传素材 ID 无效：${id || '空值'}。`);
    }
    if (ids.length === 0) return { success: true, assets: [], claim: { upload_ids: [], copied_paths: [] } };
    if (!targetDir) throw new Error('认领上传素材失败：缺少任务素材目录。');

    const taskDir = path.resolve(targetDir);
    const resolvedWorkflowId = String(workflowId || path.basename(taskDir)).trim();
    const staged = [];
    for (const id of ids) staged.push(await readStagedUpload(rootDir, id));

    const assetsDir = path.join(taskDir, 'assets');
    const copiedPaths = [];
    const assets = staged.map(({ manifest, sourcePath }) => {
      const destinationName = `${manifest.upload_id}-${manifest.file_name}`;
      const localPath = path.join(assetsDir, destinationName);
      return normalizeVisualAsset({
        id: manifest.upload_id,
        source: 'upload',
        media_type: 'image',
        origin: 'user_upload',
        origin_detail: 'creative_input',
        provider: 'local',
        requirement: manifest.requirement,
        evidence_class: 'user_supplied',
        status: 'ready',
        file_name: manifest.file_name,
        mime: manifest.mime,
        bytes: manifest.bytes,
        path: path.posix.join('assets', destinationName),
        local_path: localPath,
        created_at: manifest.created_at,
        _source_path: sourcePath,
      });
    });

    try {
      await fsp.mkdir(assetsDir, { recursive: true });
      for (const asset of assets) {
        await fsp.copyFile(asset._source_path, asset.local_path, constants.COPYFILE_EXCL);
        copiedPaths.push(asset.local_path);
      }
    } catch (error) {
      await Promise.all(copiedPaths.map(filePath => fsp.rm(filePath, { force: true }).catch(() => {})));
      throw new Error(`认领上传素材失败：${error.message}`);
    }

    const updated = [];
    try {
      for (const item of staged) {
        await writeManifest(path.join(item.uploadDir, 'upload.json'), {
          ...item.manifest,
          status: 'claimed',
          workflow_id: resolvedWorkflowId,
        });
        updated.push(item);
      }
    } catch (error) {
      for (const item of updated.reverse()) {
        await writeManifest(path.join(item.uploadDir, 'upload.json'), item.manifest).catch(() => {});
      }
      await Promise.all(copiedPaths.map(filePath => fsp.rm(filePath, { force: true }).catch(() => {})));
      throw new Error(`认领上传素材失败：${error.message}`);
    }
    return {
      success: true,
      assets: assets.map(({ _source_path, ...asset }) => asset),
      claim: {
        upload_ids: ids,
        workflow_id: resolvedWorkflowId,
        copied_paths: copiedPaths,
      },
    };
  });
}

async function updateStagedVisualAssetRequirement({
  uploadId,
  requirement,
  rootDir = DEFAULT_ROOT,
  writeManifest = writeJsonAtomic,
} = {}) {
  return withMutationQueue(async () => {
    const id = String(uploadId || '').trim();
    if (!UPLOAD_ID_PATTERN.test(id)) throw new Error(`上传素材 ID 无效：${id || '空值'}。`);
    if (requirement == null || String(requirement).trim() === '') {
      throw new Error('上传图片的使用约束不能为空，只能选择 required 或 preferred。');
    }
    const normalizedRequirement = normalizeRequirement(requirement);
    const { uploadDir, manifest } = await readStagedUpload(rootDir, id);
    const updated = { ...manifest, requirement: normalizedRequirement };
    try {
      await writeManifest(path.join(uploadDir, 'upload.json'), updated);
    } catch (error) {
      throw new Error(`更新暂存图片使用约束失败：${error.message || '未知错误'}，请重试。`);
    }
    return { success: true, upload_id: id, status: 'staged', asset: { ...updated, id } };
  });
}

async function releaseClaimedVisualAssets({ claim = {}, rootDir = DEFAULT_ROOT, writeManifest = writeJsonAtomic } = {}) {
  return withMutationQueue(async () => {
    const ids = Array.isArray(claim.upload_ids) ? claim.upload_ids : [];
    const records = [];
    for (const id of ids) {
      const uploadDir = uploadDirFor(rootDir, id);
      const manifest = JSON.parse(await fsp.readFile(path.join(uploadDir, 'upload.json'), 'utf8'));
      if (manifest.status !== 'claimed' || manifest.workflow_id !== claim.workflow_id) {
        throw new Error(`上传素材 ${id} 的认领状态已变化，无法释放。`);
      }
      records.push({ uploadDir, manifest });
    }
    await Promise.all((claim.copied_paths || []).map(filePath => fsp.rm(filePath, { force: true })));
    const restored = [];
    try {
      for (const item of records) {
        const { workflow_id, ...manifest } = item.manifest;
        await writeManifest(path.join(item.uploadDir, 'upload.json'), { ...manifest, status: 'staged' });
        restored.push(item);
      }
    } catch (error) {
      for (const item of restored.reverse()) {
        await writeManifest(path.join(item.uploadDir, 'upload.json'), item.manifest).catch(() => {});
      }
      throw error;
    }
    return { success: true, upload_ids: ids };
  });
}

async function finalizeClaimedVisualAssets({ claim = {}, rootDir = DEFAULT_ROOT } = {}) {
  return withMutationQueue(async () => {
    const ids = Array.isArray(claim.upload_ids) ? claim.upload_ids : [];
    for (const id of ids) {
      const uploadDir = uploadDirFor(rootDir, id);
      const manifest = JSON.parse(await fsp.readFile(path.join(uploadDir, 'upload.json'), 'utf8'));
      if (manifest.status !== 'claimed' || manifest.workflow_id !== claim.workflow_id) {
        throw new Error(`上传素材 ${id} 的认领状态已变化，无法完成清理。`);
      }
    }
    await Promise.all(ids.map(id => fsp.rm(uploadDirFor(rootDir, id), { recursive: true, force: true })));
    return { success: true, upload_ids: ids };
  });
}

async function removeStagedVisualAsset({ uploadId, rootDir = DEFAULT_ROOT } = {}) {
  return withMutationQueue(async () => {
    const { uploadDir } = await readStagedUpload(rootDir, String(uploadId || '').trim());
    await fsp.rm(uploadDir, { recursive: true, force: true });
    return { success: true, upload_id: uploadId, status: 'removed' };
  });
}

module.exports = {
  DEFAULT_ROOT,
  MAX_UPLOAD_BYTES,
  STAGED_TTL_MS,
  MAX_STAGED_UPLOADS,
  MAX_STAGED_TOTAL_BYTES,
  ALLOWED_MIME,
  UPLOAD_ID_PATTERN,
  stageVisualAsset,
  updateStagedVisualAssetRequirement,
  claimVisualAssets,
  releaseClaimedVisualAssets,
  finalizeClaimedVisualAssets,
  cleanupExpiredStagedVisualAssets,
  removeStagedVisualAsset,
};
