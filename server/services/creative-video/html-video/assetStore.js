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
  if (!assetPath.startsWith('assets/')) {
    throw new Error('素材路径必须位于 assets 目录。');
  }
  return resolveProjectPath(projectDir, assetPath);
}

module.exports = {
  ensureAssetDir,
  resolveAssetPath,
};
