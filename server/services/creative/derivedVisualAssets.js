const fsp = require('fs/promises');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const { normalizeVisualAsset, mergeVisualAssetContexts } = require('./visualAssetContract');

const ALLOWED_ORIGIN_DETAILS = new Set(['editor_crop', 'video_keyframe', 'page_crop']);
const ALLOWED_PARENT_EVIDENCE = new Set(['direct_source', 'derived_source']);
const MIME_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function matchesImageSignature(mime, header) {
  if (mime === 'image/png') return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/jpeg') return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  return header.length >= 12 && header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP';
}

function cloneJsonValue(value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw new Error('not-json');

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) throw new Error('not-json');

  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key === 'symbol')) throw new Error('not-json');
  const arrayKeys = isArray ? keys.filter(key => key !== 'length') : [];
  if (isArray && (arrayKeys.length !== value.length
    || !arrayKeys.every((key, index) => key === String(index)))) {
    throw new Error('not-json');
  }

  ancestors.add(value);
  try {
    const cloneEntry = key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('not-json');
      return [key, cloneJsonValue(descriptor.value, ancestors)];
    };
    if (isArray) return arrayKeys.map(key => cloneEntry(key)[1]);
    return Object.fromEntries(keys.map(cloneEntry));
  } finally {
    ancestors.delete(value);
  }
}

function cloneJsonDerivation(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('衍生素材的派生信息必须是可序列化的 JSON 对象。');
  }
  try {
    return cloneJsonValue(value, new WeakSet());
  } catch {
    throw new Error('衍生素材的派生信息必须是可序列化的 JSON 对象，不能包含函数、循环引用或特殊对象。');
  }
}

async function resolveAssetRoot(projectDir) {
  const rootInput = safeString(projectDir);
  if (!rootInput) throw new Error('项目目录不能为空，无法登记衍生素材。');
  try {
    const projectRoot = await fsp.realpath(path.resolve(rootInput));
    const assetRoot = await fsp.realpath(path.join(projectRoot, 'assets'));
    if (!inside(projectRoot, assetRoot)) throw new Error('escaped');
    return { projectRoot, assetRoot };
  } catch {
    throw new Error('项目 assets 目录不存在或不安全，请先准备任务素材目录。');
  }
}

async function resolveRegisteredParentFile(parent, projectRoot, assetRoot) {
  const registeredPath = safeString(parent.local_path || parent.path);
  if (!registeredPath) throw new Error(`父素材 ${parent.id} 未登记本地文件，请先完成素材落盘。`);
  const candidate = path.isAbsolute(registeredPath)
    ? registeredPath
    : path.resolve(projectRoot, registeredPath);
  let realPath;
  let stat;
  try {
    realPath = await fsp.realpath(candidate);
    stat = await fsp.stat(realPath);
  } catch {
    throw new Error(`父素材 ${parent.id} 的文件不存在，请重新准备来源素材。`);
  }
  if (!inside(assetRoot, realPath) || !stat.isFile()) {
    throw new Error(`父素材 ${parent.id} 的文件不在项目 assets 目录，请重新准备来源素材。`);
  }
}

async function resolveChildFile(childFilePath, projectRoot, assetRoot) {
  const childInput = safeString(childFilePath);
  if (!childInput) throw new Error('子素材文件路径不能为空，请先生成衍生文件。');
  const candidate = path.isAbsolute(childInput) ? childInput : path.resolve(projectRoot, childInput);
  let realPath;
  let stat;
  try {
    realPath = await fsp.realpath(candidate);
    stat = await fsp.stat(realPath);
  } catch {
    throw new Error('子素材文件不存在，请重新生成后再登记。');
  }
  if (!inside(assetRoot, realPath) || !stat.isFile()) {
    throw new Error('子素材文件必须位于项目 assets 目录，请重新生成到受控目录。');
  }
  if (stat.size <= 0) throw new Error('子素材文件为空，请重新生成后再登记。');
  const mime = MIME_BY_EXTENSION.get(path.extname(realPath).toLowerCase());
  if (!mime) throw new Error('子素材仅支持 PNG、JPEG 或 WebP 图片，请重新生成。');
  const handle = await fsp.open(realPath, 'r');
  const header = Buffer.alloc(Math.min(12, stat.size));
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  if (!matchesImageSignature(mime, header)) throw new Error('子素材图片内容与扩展名不匹配，请重新生成。');
  return {
    realPath,
    relativePath: path.relative(projectRoot, realPath).split(path.sep).join('/'),
    mime,
    bytes: stat.size,
  };
}

async function registerDerivedVisualAsset({
  assetContext = {},
  projectDir = '',
  parentAssetId = '',
  childFilePath = '',
  id = '',
  originDetail = '',
  derivation,
} = {}) {
  const parentId = safeString(parentAssetId);
  if (!parentId) throw new Error('父素材 ID 不能为空，请选择已登记的父素材。');
  const assetId = safeString(id);
  if (!assetId) throw new Error('衍生素材 ID 不能为空，请提供唯一 ID。');
  const detail = safeString(originDetail);
  if (!ALLOWED_ORIGIN_DETAILS.has(detail)) {
    throw new Error('衍生类型无效，只能选择 editor_crop、video_keyframe 或 page_crop。');
  }
  const clonedDerivation = cloneJsonDerivation(derivation);

  const assets = Array.isArray(assetContext?.assets) ? assetContext.assets : [];
  const parentInput = assets.find(asset => safeString(asset?.id || asset?.asset_id) === parentId);
  if (!parentInput) throw new Error(`未找到父素材 ${parentId}，请先登记父素材。`);
  const parent = normalizeVisualAsset(parentInput);
  if (!ALLOWED_PARENT_EVIDENCE.has(parent.evidence_class)) {
    throw new Error(`父素材证据类型 ${parent.evidence_class || '未知'} 不能登记为来源派生素材，请选择来源证据素材。`);
  }

  const { projectRoot, assetRoot } = await resolveAssetRoot(projectDir);
  await resolveRegisteredParentFile(parent, projectRoot, assetRoot);
  const child = await resolveChildFile(childFilePath, projectRoot, assetRoot);

  const asset = normalizeVisualAsset({
    id: assetId,
    media_type: 'image',
    origin: 'derived',
    origin_detail: detail,
    provider: 'local',
    requirement: 'optional',
    evidence_class: 'derived_source',
    parent_asset_id: parentId,
    status: 'ready',
    path: child.relativePath,
    local_path: child.realPath,
    mime: child.mime,
    bytes: child.bytes,
    ...(clonedDerivation ? { derivation: clonedDerivation } : {}),
  });

  const existingInput = assets.find(asset => safeString(asset?.id || asset?.asset_id) === assetId);
  if (existingInput) {
    const existing = normalizeVisualAsset(existingInput);
    if (existing.origin !== 'derived') {
      throw new Error(`素材 ID ${assetId} 已被非衍生素材占用，请更换 ID。`);
    }
    if (existing.parent_asset_id !== parentId) {
      throw new Error(`素材 ID ${assetId} 已绑定其他父素材，请更换 ID。`);
    }
    if (existing.path !== asset.path
      || existing.mime !== asset.mime
      || typeof existing.bytes !== 'number'
      || existing.bytes !== asset.bytes) {
      throw new Error(`素材 ID ${assetId} 登记冲突：子素材文件、格式或大小不同，请更换 ID。`);
    }
    if (existing.origin_detail !== asset.origin_detail) {
      throw new Error(`素材 ID ${assetId} 登记冲突：衍生类型不同，请更换 ID。`);
    }
    if (!isDeepStrictEqual(existing.derivation, asset.derivation)) {
      throw new Error(`素材 ID ${assetId} 登记冲突：派生信息不同，请更换 ID。`);
    }
    const assetContextResult = mergeVisualAssetContexts(assetContext, { status: 'ready', assets: [asset] });
    return { asset: assetContextResult.assets.find(asset => asset.id === assetId), asset_context: assetContextResult };
  }

  const assetContextResult = mergeVisualAssetContexts(assetContext, { status: 'ready', assets: [asset] });
  return { asset: assetContextResult.assets.find(item => item.id === assetId), asset_context: assetContextResult };
}

module.exports = {
  registerDerivedVisualAsset,
};
