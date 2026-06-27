const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const { createEmptyProject, normalizeProject } = require('./projectSchema');
const { applyCaptionLayer } = require('./captionLayer');

const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

function safeId(value, label) {
  const text = String(value || '').trim();
  if (!text || text.includes('..') || text.includes('/') || text.includes('\\') || !ID_PATTERN.test(text)) {
    throw new Error(`${label} 不合法。`);
  }
  return text;
}

function assertInside(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('路径不能逃逸工程目录。');
  }
  return target;
}

function resolveProjectPath(projectDir, relativePath) {
  const text = String(relativePath || '');
  if (!text || path.isAbsolute(text)) {
    throw new Error('路径不能逃逸工程目录。');
  }
  return assertInside(projectDir, path.resolve(projectDir, text));
}

async function createProjectDir({ rootDir, workflowId, runId } = {}) {
  if (!rootDir) {
    throw new Error('缺少工程根目录。');
  }
  const safeWorkflowId = safeId(workflowId, 'workflowId');
  const safeRunId = safeId(runId, 'runId');
  const projectDir = path.resolve(rootDir, safeWorkflowId, 'agent_runs', `${safeRunId}-html-video`);
  assertInside(rootDir, projectDir);

  await fs.mkdir(projectDir, { recursive: true });
  for (const name of ['frames', 'assets', 'exports', 'inspect', 'tts']) {
    await fs.mkdir(path.join(projectDir, name), { recursive: true });
  }

  const project = createEmptyProject({
    projectId: `${safeWorkflowId}_${safeRunId}`,
    workflowId: safeWorkflowId,
    runId: safeRunId,
  });
  await saveJsonAtomic(path.join(projectDir, 'project.json'), project);
  await saveJsonAtomic(path.join(projectDir, 'content-graph.json'), project.content_graph);
  return projectDir;
}

async function saveJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `${path.basename(filePath)}.tmp`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function saveProject(projectDir, project) {
  const normalized = normalizeProject(project);
  const projectPath = resolveProjectPath(projectDir, 'project.json');
  await saveJsonAtomic(projectPath, normalized);
  return normalized;
}

async function loadProject(projectDir) {
  const projectPath = resolveProjectPath(projectDir, 'project.json');
  const text = await fs.readFile(projectPath, 'utf8');
  return normalizeProject(JSON.parse(text));
}

async function writeProjectJson(projectDir, updater) {
  const project = await loadProject(projectDir);
  const updated = typeof updater === 'function' ? await updater(project) : project;
  return saveProject(projectDir, updated || project);
}

async function saveContentGraph(projectDir, graph) {
  const relativePath = 'content-graph.json';
  await saveJsonAtomic(resolveProjectPath(projectDir, relativePath), graph);
  return relativePath;
}

async function saveSceneSpec(projectDir, sceneSpec) {
  if (!projectDir || !sceneSpec || typeof sceneSpec !== 'object') return '';
  const relativePath = 'scene-spec.json';
  await saveJsonAtomic(resolveProjectPath(projectDir, relativePath), sceneSpec);
  return relativePath;
}

async function loadSceneSpec(projectDir) {
  if (!projectDir) return null;
  try {
    const text = await fs.readFile(resolveProjectPath(projectDir, 'scene-spec.json'), 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function safeFilePart(value, fallback) {
  const text = String(value || fallback || 'frame')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return text || fallback || 'frame';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function writeRawFrameHtml({ projectDir, sceneId, order, html, captions = [], durationSec = null } = {}) {
  if (!projectDir) throw new Error('缺少 projectDir。');
  const index = Number(order);
  const safeOrder = Number.isFinite(index) && index > 0 ? index : 1;
  const fileName = `${String(safeOrder).padStart(2, '0')}-${safeFilePart(sceneId, `scene_${String(safeOrder).padStart(2, '0')}`)}.html`;
  const htmlPath = `frames/${fileName}`;
  const outputPath = resolveProjectPath(projectDir, htmlPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const output = applyCaptionLayer(html, captions, {
    durationSec,
    generateCaptions: Array.isArray(captions) && captions.length > 0,
  });
  await fs.writeFile(outputPath, output, 'utf8');
  return {
    html_path: htmlPath,
    output_hash: sha256(output),
  };
}

function timestamp() {
  return new Date().toISOString();
}

function nextEntryId(prefix, entries) {
  return `${prefix}_${String((entries || []).length + 1).padStart(4, '0')}`;
}

function addRevision(project, change = {}) {
  if (!Array.isArray(project.revisions)) {
    project.revisions = [];
  }
  const revision = {
    id: change.id || nextEntryId('rev', project.revisions),
    created_at: change.created_at || timestamp(),
    summary: change.summary || '',
    author: change.author || null,
    change: change.change || null,
  };
  project.revisions.push(revision);
  return revision;
}

function splitExportPath(exportPath) {
  const dir = path.posix.dirname(exportPath.replace(/\\/g, '/'));
  const base = path.posix.basename(exportPath);
  const ext = path.posix.extname(base);
  const name = ext ? base.slice(0, -ext.length) : base;
  return {
    dir: dir === '.' ? '' : dir,
    name,
    ext,
  };
}

function uniqueExportPath(project, requestedPath) {
  const used = new Set((project.exports || []).map(item => item && item.path).filter(Boolean));
  if (!used.has(requestedPath)) {
    return requestedPath;
  }
  const parsed = splitExportPath(requestedPath);
  let suffix = 2;
  while (true) {
    const candidateName = `${parsed.name}-${suffix}${parsed.ext}`;
    const candidate = parsed.dir ? `${parsed.dir}/${candidateName}` : candidateName;
    if (!used.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

function addExport(project, exportInfo = {}) {
  if (!Array.isArray(project.exports)) {
    project.exports = [];
  }
  const requestedPath = exportInfo.path || `exports/export-${project.exports.length + 1}.mp4`;
  const exportPath = uniqueExportPath(project, requestedPath);
  const entry = {
    id: exportInfo.id || nextEntryId('export', project.exports),
    created_at: exportInfo.created_at || timestamp(),
    format: exportInfo.format || null,
    path: exportPath,
    ...exportInfo,
    path: exportPath,
  };
  project.exports.push(entry);
  return entry;
}

module.exports = {
  createProjectDir,
  saveProject,
  loadProject,
  writeProjectJson,
  saveContentGraph,
  saveSceneSpec,
  loadSceneSpec,
  writeRawFrameHtml,
  addRevision,
  addExport,
  resolveProjectPath,
};
