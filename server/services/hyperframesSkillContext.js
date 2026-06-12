const fs = require('fs');
const path = require('path');

const INCLUDED_REFERENCE_FILES = [
  'captions.md',
  'typography.md',
  'motion-principles.md',
  'video-composition.md',
  'transitions.md',
];

function safeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\r\n?/g, '\n').trim();
}

function hasSkillFile(dir) {
  return Boolean(dir) && fs.existsSync(path.join(dir, 'SKILL.md'));
}

function resolveHyperframesSkillDir({ skillRoot = '', env = process.env } = {}) {
  const explicitSkillRoot = safeString(skillRoot);
  const candidates = explicitSkillRoot
    ? [explicitSkillRoot]
      : [
          env.HYPERFRAMES_SKILL_ROOT,
          path.resolve(__dirname, '..', 'resources', 'hyperframes-skills-official'),
          path.resolve(__dirname, '..', 'resources', 'hyperframes-skills'),
        ];

  for (const candidate of candidates) {
    const normalized = safeString(candidate);
    if (!normalized) {
      continue;
    }

    const resolved = path.resolve(normalized);
    if (hasSkillFile(resolved)) {
      return resolved;
    }

    const nested = path.join(resolved, 'hyperframes');
    if (hasSkillFile(nested)) {
      return nested;
    }
  }

  return '';
}

function readIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function isSameOrInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function realpathIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }
  return fs.realpathSync.native(filePath);
}

function resolveRealIntendedPath(filePath) {
  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved)) {
    return fs.realpathSync.native(resolved);
  }

  const missingParts = [];
  let current = resolved;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return resolved;
    }
    missingParts.unshift(path.basename(current));
    current = parent;
  }

  return path.resolve(fs.realpathSync.native(current), ...missingParts);
}

function resolveSnapshotPaths(sourceDir, projectDir) {
  const sourceRoot = path.resolve(sourceDir);
  const projectRoot = path.resolve(projectDir);
  const targetRoot = path.resolve(projectRoot, '.agents', 'skills', 'hyperframes');
  const realSourceRoot = realpathIfExists(sourceRoot);
  const realProjectRoot = realpathIfExists(projectRoot);
  const realTargetRoot = resolveRealIntendedPath(targetRoot);

  return {
    sourceRoot,
    projectRoot,
    targetRoot,
    realSourceRoot,
    realProjectRoot,
    realTargetRoot,
  };
}

async function loadHyperframesSkillContext({
  skillRoot = '',
  maxChars = 12000,
  env = process.env,
} = {}) {
  const sourceDir = resolveHyperframesSkillDir({ skillRoot, env });
  if (!sourceDir) {
    return {
      success: false,
      message: '未找到 HyperFrames skill，请在设置中配置 skill 目录，或使用项目内置模板。',
      source_dir: '',
      prompt_context: '',
    };
  }

  const chunks = [];
  const skillText = safeString(readIfExists(path.join(sourceDir, 'SKILL.md')));
  if (skillText) {
    chunks.push(`# SKILL.md\n\n${skillText}`);
  }

  const referencesDir = path.join(sourceDir, 'references');
  const referenceFiles = [...INCLUDED_REFERENCE_FILES].sort();
  for (const fileName of referenceFiles) {
    const referenceText = safeString(readIfExists(path.join(referencesDir, fileName)));
    if (referenceText) {
      chunks.push(`## references/${fileName}\n\n${referenceText}`);
    }
  }

  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0
    ? Number(maxChars)
    : 12000;
  const promptContext = safeString(chunks.join('\n\n')).slice(0, limit);

  return {
    success: true,
    message: 'HyperFrames skill 上下文已读取。',
    source_dir: sourceDir,
    prompt_context: promptContext,
  };
}

function copyDirLimited(source, target) {
  fs.mkdirSync(target, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }

    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirLimited(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

async function copySkillSnapshot({ sourceDir, projectDir } = {}) {
  const normalizedSource = safeString(sourceDir);
  const normalizedProject = safeString(projectDir);
  if (!normalizedSource || !normalizedProject || !hasSkillFile(normalizedSource)) {
    return {
      success: false,
      message: '未找到可复制的 HyperFrames skill。',
      target_dir: '',
    };
  }

  const paths = resolveSnapshotPaths(normalizedSource, normalizedProject);
  const lexicalTargetInsideSource = isSameOrInside(paths.sourceRoot, paths.targetRoot);
  const realProjectInsideSource = paths.realSourceRoot
    && paths.realProjectRoot
    && isSameOrInside(paths.realSourceRoot, paths.realProjectRoot);
  const realTargetInsideSource = paths.realSourceRoot
    && paths.realTargetRoot
    && isSameOrInside(paths.realSourceRoot, paths.realTargetRoot);

  if (lexicalTargetInsideSource || realProjectInsideSource || realTargetInsideSource) {
    return {
      success: false,
      message: '不能复制到 HyperFrames skill 源目录内部，请选择其他项目目录。',
      target_dir: paths.targetRoot,
    };
  }

  copyDirLimited(paths.sourceRoot, paths.targetRoot);

  return {
    success: true,
    message: 'HyperFrames skill 快照已保存。',
    target_dir: paths.targetRoot,
  };
}

module.exports = {
  resolveHyperframesSkillDir,
  loadHyperframesSkillContext,
  copySkillSnapshot,
};
