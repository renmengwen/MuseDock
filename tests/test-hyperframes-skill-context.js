const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const skillContext = require('../server/services/hyperframes/hyperframesSkillContext');

function tryCreateDirectoryLink(sourceDir, linkDir) {
  try {
    fs.symlinkSync(sourceDir, linkDir, 'junction');
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      console.warn(`skip symlink path boundary test: ${error.code}`);
      return false;
    }
    throw error;
  }
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-skill-context-'));
  const skillDir = path.join(root, 'hyperframes');
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# HyperFrames\n\nUse lint, validate, inspect, render.');
  fs.writeFileSync(path.join(skillDir, 'references', 'captions.md'), 'Captions must be readable and synchronized.');
  fs.writeFileSync(path.join(skillDir, 'references', 'ignored.md'), 'SHOULD_NOT_APPEAR');

  const context = await skillContext.loadHyperframesSkillContext({
    skillRoot: root,
    maxChars: 500,
  });

  assert.equal(context.success, true);
  assert.equal(context.source_dir, skillDir);
  assert.match(context.prompt_context, /HyperFrames/);
  assert.match(context.prompt_context, /lint, validate, inspect, render/);
  assert.match(context.prompt_context, /Captions must be readable/);
  assert.doesNotMatch(context.prompt_context, /SHOULD_NOT_APPEAR/);

  const missing = await skillContext.loadHyperframesSkillContext({
    skillRoot: path.join(root, 'missing'),
    env: {},
  });
  assert.equal(missing.success, false);
  assert.match(missing.message, /未找到 HyperFrames skill/);

  const builtin = await skillContext.loadHyperframesSkillContext({
    env: {},
    maxChars: 500,
  });
  assert.equal(builtin.success, true);
  assert.match(builtin.source_dir, /server[\\/]resources[\\/]hyperframes-skills-official$/);
  assert.match(builtin.prompt_context, /HyperFrames/);

  const projectDir = path.join(root, 'project');
  await skillContext.copySkillSnapshot({
    sourceDir: skillDir,
    projectDir,
  });
  assert.equal(fs.existsSync(path.join(projectDir, '.agents', 'skills', 'hyperframes', 'SKILL.md')), true);

  const unsafeProjectDir = path.join(skillDir, 'nested-project');
  const originalReaddirSync = fs.readdirSync;
  let copyAttempted = false;
  fs.readdirSync = function readdirSyncGuarded(targetPath, options) {
    if (path.resolve(targetPath) === path.resolve(skillDir)) {
      copyAttempted = true;
      throw new Error('copy should be rejected before reading source');
    }
    return originalReaddirSync.call(fs, targetPath, options);
  };

  try {
    const unsafeCopy = await skillContext.copySkillSnapshot({
      sourceDir: skillDir,
      projectDir: unsafeProjectDir,
    });
    assert.equal(unsafeCopy.success, false);
    assert.match(unsafeCopy.message, /不能复制到 HyperFrames skill 源目录内部/);
    assert.equal(copyAttempted, false);
    assert.equal(fs.existsSync(path.join(unsafeProjectDir, '.agents')), false);
  } finally {
    fs.readdirSync = originalReaddirSync;
  }

  const linkedProjectDir = path.join(root, 'linked-project');
  if (tryCreateDirectoryLink(skillDir, linkedProjectDir)) {
    const unsafeLinkedCopy = await skillContext.copySkillSnapshot({
      sourceDir: skillDir,
      projectDir: linkedProjectDir,
    });
    assert.equal(unsafeLinkedCopy.success, false);
    assert.match(unsafeLinkedCopy.message, /不能复制到 HyperFrames skill 源目录内部/);
    assert.equal(fs.existsSync(path.join(skillDir, '.agents')), false);
  }

  const projectWithLinkedTarget = path.join(root, 'project-with-linked-target');
  const linkedTargetDir = path.join(projectWithLinkedTarget, '.agents', 'skills', 'hyperframes');
  fs.mkdirSync(path.dirname(linkedTargetDir), { recursive: true });
  if (tryCreateDirectoryLink(skillDir, linkedTargetDir)) {
    const unsafeLinkedTargetCopy = await skillContext.copySkillSnapshot({
      sourceDir: skillDir,
      projectDir: projectWithLinkedTarget,
    });
    assert.equal(unsafeLinkedTargetCopy.success, false);
    assert.match(unsafeLinkedTargetCopy.message, /不能复制到 HyperFrames skill 源目录内部/);
    assert.equal(fs.existsSync(path.join(skillDir, '.agents')), false);
  }

  const projectWithLinkedAgents = path.join(root, 'project-with-linked-agents');
  const linkedAgentsDir = path.join(projectWithLinkedAgents, '.agents');
  fs.mkdirSync(projectWithLinkedAgents, { recursive: true });
  if (tryCreateDirectoryLink(skillDir, linkedAgentsDir)) {
    const unsafeLinkedParentCopy = await skillContext.copySkillSnapshot({
      sourceDir: skillDir,
      projectDir: projectWithLinkedAgents,
    });
    assert.equal(unsafeLinkedParentCopy.success, false);
    assert.match(unsafeLinkedParentCopy.message, /不能复制到 HyperFrames skill 源目录内部/);
    assert.equal(fs.existsSync(path.join(skillDir, 'skills')), false);
  }
}

run().then(() => {
  console.log('hyperframes skill context tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
