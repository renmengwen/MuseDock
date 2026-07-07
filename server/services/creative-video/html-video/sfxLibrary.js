const fs = require('fs');
const path = require('path');

const projectStore = require('./projectStore');

// 只读素材随代码打包，按 __dirname 定位仓库根（对齐 templateRegistry），不依赖 process.cwd()
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '../../../..');
const DEFAULT_LIBRARY_RELATIVE_PATH = path.join('assets', 'sfx', 'library.json');
const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

function loadSfxLibrary({ rootDir = DEFAULT_ROOT_DIR, libraryPath = '' } = {}) {
  const resolvedPath = libraryPath
    ? path.resolve(libraryPath)
    : path.resolve(rootDir, DEFAULT_LIBRARY_RELATIVE_PATH);
  const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return { ...parsed, items };
}

function getSfxLibrarySummary({ library, ...options } = {}) {
  const source = library || loadSfxLibrary(options);
  return source.items.map(item => ({
    id: String(item.id || ''),
    title: String(item.title || ''),
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    duration_sec: Number(item.duration_sec || 0),
    default_volume_db: Number.isFinite(Number(item.default_volume_db)) ? Number(item.default_volume_db) : -18,
  })).filter(item => item.id);
}

function resolveSfxAsset(sfxId, { rootDir = DEFAULT_ROOT_DIR, libraryPath = '', library } = {}) {
  const id = String(sfxId || '').trim();
  if (!SAFE_ID.test(id)) throw new Error('音效 ID 不合法。');
  const source = library || loadSfxLibrary({ rootDir, libraryPath });
  const item = (Array.isArray(source.items) ? source.items : []).find(entry => entry && entry.id === id);
  if (!item) throw new Error('未找到音效。');
  const file = String(item.file || '').replace(/\\/g, '/');
  const assetRoot = path.resolve(rootDir, 'assets', 'sfx');
  return {
    item,
    path: projectStore.resolveProjectPath(assetRoot, file),
  };
}

module.exports = {
  DEFAULT_ROOT_DIR,
  DEFAULT_LIBRARY_RELATIVE_PATH,
  loadSfxLibrary,
  getSfxLibrarySummary,
  resolveSfxAsset,
};
