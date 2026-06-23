const fs = require('fs/promises');
const path = require('path');

const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

function safeId(value, label) {
  const text = String(value || '').trim();
  if (!text || text.includes('..') || text.includes('/') || text.includes('\\') || !ID_PATTERN.test(text)) {
    throw new Error(`${label} 不合法。`);
  }
  return text;
}

function safeFileName(fileName) {
  const name = String(fileName || '').replace(/\\/g, '/');
  if (!name || name.includes('..') || name.includes('/') || path.isAbsolute(name) || path.basename(name) !== name) {
    throw new Error('工程文件名不合法。');
  }
  return name;
}

async function writeCreativeVideoProject({
  rootDir,
  workflowId,
  runId,
  files = {},
} = {}) {
  try {
    if (!rootDir) {
      throw new Error('缺少工程根目录。');
    }
    const safeWorkflowId = safeId(workflowId, 'workflowId');
    const safeRunId = safeId(runId, 'runId');
    const projectDir = path.resolve(rootDir, safeWorkflowId, 'agent_runs', `${safeRunId}-hyperframes-lite`);
    const root = path.resolve(rootDir);
    const relativeProject = path.relative(root, projectDir);
    if (relativeProject.startsWith('..') || path.isAbsolute(relativeProject)) {
      throw new Error('工程目录不合法。');
    }

    const entries = Object.entries(files || {}).map(([fileName, content]) => {
      const safeName = safeFileName(fileName);
      const filePath = path.resolve(projectDir, safeName);
      const relative = path.relative(projectDir, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('工程文件路径不合法。');
      }
      return { safeName, filePath, content };
    });

    const tempDir = path.resolve(rootDir, safeWorkflowId, 'agent_runs', `${safeRunId}-hyperframes-lite.tmp`);
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
    const written = [];
    try {
      for (const { safeName, content } of entries) {
        await fs.writeFile(path.resolve(tempDir, safeName), String(content), 'utf8');
        written.push(safeName);
      }
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw error;
    }

    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rename(tempDir, projectDir);

    return {
      success: true,
      project_dir: projectDir,
      files: written,
      message: '创意视频工程文件已写入。',
    };
  } catch (error) {
    return {
      success: false,
      project_dir: '',
      files: [],
      message: `创意视频工程写入失败：${error.message}`,
    };
  }
}

module.exports = {
  writeCreativeVideoProject,
};
