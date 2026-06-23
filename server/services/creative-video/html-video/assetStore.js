const fs = require('fs/promises');
const path = require('path');

const { resolveProjectPath } = require('./projectStore');

async function ensureAssetDir(projectDir) {
  const assetDir = resolveProjectPath(projectDir, 'assets');
  await fs.mkdir(assetDir, { recursive: true });
  return assetDir;
}

function resolveAssetPath(projectDir, relativePath) {
  const assetPath = String(relativePath || '').replace(/\\/g, '/');
  if (path.isAbsolute(assetPath)) {
    throw new Error('素材路径不能是绝对路径。');
  }
  if (assetPath.split('/').some(part => part === '..')) {
    throw new Error('素材路径不能包含 ..。');
  }
  if (!assetPath.startsWith('assets/')) {
    throw new Error('素材路径必须位于 assets 目录。');
  }
  return resolveProjectPath(projectDir, assetPath);
}

module.exports = {
  ensureAssetDir,
  resolveAssetPath,
};
