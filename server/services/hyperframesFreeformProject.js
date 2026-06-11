const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mediaPipeline = require('./mediaPipeline');

const ALLOWED_FILES = new Set([
  'index.html',
  'design.md',
  'hyperframes.json',
  'package.json',
  'meta.json',
  'output.mp4',
  'contact_sheet.jpg',
]);

function getFreeformProjectDir(awemeId, runId, rootDir) {
  return path.join(
    mediaPipeline.getMediaDir(awemeId, rootDir),
    'agent_runs',
    `${runId}-hyperframes-freeform`,
  );
}

function resolveFreeformFile(projectDir, fileName) {
  const normalizedName = String(fileName || '').replace(/\\/g, '/');
  const basename = path.posix.basename(normalizedName);
  if (!basename || basename !== normalizedName || normalizedName.includes('..')) {
    throw new Error('非法的工程文件路径。');
  }

  if (!ALLOWED_FILES.has(basename)) {
    throw new Error('不支持访问该工程文件。');
  }

  const rootPath = path.resolve(projectDir);
  const filePath = path.resolve(rootPath, basename);
  const relative = path.relative(rootPath, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('非法的工程文件路径。');
  }

  return filePath;
}

async function writeFreeformFile({ projectDir, fileName, content = '' }) {
  const filePath = resolveFreeformFile(projectDir, fileName);
  await fsp.mkdir(projectDir, { recursive: true });
  await fsp.writeFile(filePath, String(content), 'utf-8');
  return {
    success: true,
    name: path.basename(filePath),
    path: filePath,
    message: '工程文件已保存。',
  };
}

async function readFreeformFile({ projectDir, fileName }) {
  const filePath = resolveFreeformFile(projectDir, fileName);
  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      name: path.basename(filePath),
      path: filePath,
      message: '未找到该工程文件。',
    };
  }

  return {
    success: true,
    name: path.basename(filePath),
    path: filePath,
    content: await fsp.readFile(filePath, 'utf-8'),
  };
}

async function listFreeformFiles(projectDir) {
  const files = [];
  for (const name of ALLOWED_FILES) {
    const filePath = resolveFreeformFile(projectDir, name);
    try {
      const stats = await fsp.stat(filePath);
      if (!stats.isFile()) continue;
      files.push({
        name,
        path: filePath,
        bytes: stats.size,
        updated_at: stats.mtime.toISOString(),
      });
    } catch {
      // Missing allowed files are simply omitted from the project listing.
    }
  }
  return files;
}

async function createFreeformProject({ awemeId, runId, rootDir, files = {} }) {
  const projectDir = getFreeformProjectDir(awemeId, runId, rootDir);
  await Promise.all([
    fsp.mkdir(path.join(projectDir, 'assets'), { recursive: true }),
    fsp.mkdir(path.join(projectDir, 'checks'), { recursive: true }),
    fsp.mkdir(path.join(projectDir, 'inspect', 'frames'), { recursive: true }),
    fsp.mkdir(path.join(projectDir, 'renders'), { recursive: true }),
  ]);

  for (const [fileName, content] of Object.entries(files)) {
    await writeFreeformFile({ projectDir, fileName, content });
  }

  return {
    success: true,
    projectDir,
    files: await listFreeformFiles(projectDir),
    message: 'HyperFrames 自由工程已生成。',
  };
}

function buildFreeformFileUrl(awemeId, runId, fileName) {
  return [
    '/api/agents/douyin',
    encodeURIComponent(String(awemeId)),
    'runs',
    encodeURIComponent(String(runId)),
    'hyperframes-freeform/files',
    encodeURIComponent(String(fileName)),
  ].join('/');
}

module.exports = {
  ALLOWED_FILES,
  getFreeformProjectDir,
  resolveFreeformFile,
  writeFreeformFile,
  readFreeformFile,
  listFreeformFiles,
  createFreeformProject,
  buildFreeformFileUrl,
};
