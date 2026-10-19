const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BUILTIN_INDEXTTS_REF = 'builtin/indextts';
const text = value => typeof value === 'string' ? value.trim() : '';
function number(value, fallback, min, max) {
  const n = value === '' || value == null ? fallback : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function normalizeIndexTts(input = {}, previous = {}) {
  const config = { ...previous, ...input };
  return { rootPath: text(config.rootPath), pythonPath: text(config.pythonPath), referenceAudio: text(config.referenceAudio),
    durationFactor: number(config.durationFactor, 1.25, 0.5, 2),
    maxTextTokens: Math.round(number(config.maxTextTokens, 120, 20, 200)),
    threads: Math.round(number(config.threads, 6, 1, 16)) };
}
function resolveIndexTts(config = {}) {
  const local = normalizeIndexTts(config.localIndexTts || config);
  // Python 会切换到模型仓库，统一在 Node 入口解析路径，避免两端使用不同基准。
  for (const key of ['rootPath', 'pythonPath', 'referenceAudio']) if (local[key]) local[key] = path.resolve(local[key]);
  const rootPath = local.rootPath;
  const pythonPath = local.pythonPath || (rootPath ? path.join(rootPath, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') : '');
  const modelDir = rootPath ? path.join(rootPath, 'repo/checkpoints') : '';
  const files = [pythonPath, local.referenceAudio, modelDir && path.join(modelDir, 'config.yaml')];
  const exists = file => { try { return !!file && fs.statSync(file).isFile(); } catch { return false; } };
  const configured = files.every(exists);
  const hash = file => exists(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : '';
  return { ...local, pythonPath, modelDir, configured,
    referenceSha256: hash(local.referenceAudio), modelConfigSha256: hash(modelDir && path.join(modelDir, 'config.yaml')) };
}
module.exports = { BUILTIN_INDEXTTS_REF, normalizeIndexTts, resolveIndexTts };
