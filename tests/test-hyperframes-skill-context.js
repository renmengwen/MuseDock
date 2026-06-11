const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const skillContext = require('../server/services/hyperframesSkillContext');

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
  });
  assert.equal(missing.success, false);
  assert.match(missing.message, /未找到 HyperFrames skill/);

  const projectDir = path.join(root, 'project');
  await skillContext.copySkillSnapshot({
    sourceDir: skillDir,
    projectDir,
  });
  assert.equal(fs.existsSync(path.join(projectDir, '.agents', 'skills', 'hyperframes', 'SKILL.md')), true);
}

run().then(() => {
  console.log('hyperframes skill context tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
