const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const freeformProject = require('../server/services/hyperframesFreeformProject');

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-freeform-project-'));
  const awemeId = '1234567890';
  const runId = '20260611-test-storyboard_plan';

  const projectDir = freeformProject.getFreeformProjectDir(awemeId, runId, rootDir);
  assert.ok(projectDir.endsWith(`${runId}-hyperframes-freeform`));
  assert.throws(() => freeformProject.getFreeformProjectDir(awemeId, '../evil', rootDir), /非法/);
  assert.throws(() => freeformProject.getFreeformProjectDir(awemeId, '..\\evil', rootDir), /非法/);

  const created = await freeformProject.createFreeformProject({
    awemeId,
    runId,
    rootDir,
    files: {
      'index.html': '<html><body>ok</body></html>',
      'design.md': '# Design',
      'hyperframes.json': '{}',
      'package.json': '{"private":true}',
    },
  });

  assert.equal(created.success, true);
  assert.equal(fs.existsSync(path.join(projectDir, 'index.html')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'design.md')), true);
  assert.deepEqual(created.files.map(file => file.name).sort(), ['design.md', 'hyperframes.json', 'index.html', 'package.json']);

  const file = await freeformProject.readFreeformFile({ projectDir, fileName: 'design.md' });
  assert.equal(file.success, true);
  assert.equal(file.content, '# Design');

  const saved = await freeformProject.writeFreeformFile({
    projectDir,
    fileName: 'design.md',
    content: '# Updated',
  });
  assert.equal(saved.success, true);
  assert.equal(fs.readFileSync(path.join(projectDir, 'design.md'), 'utf-8'), '# Updated');

  assert.equal(freeformProject.resolveFreeformFile(projectDir, 'output.mp4'), path.join(projectDir, 'output.mp4'));
  await assert.rejects(
    () => freeformProject.writeFreeformFile({ projectDir, fileName: 'output.mp4', content: 'x' }),
    /不支持|文本/,
  );
  fs.writeFileSync(path.join(projectDir, 'contact_sheet.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  await assert.rejects(
    () => freeformProject.readFreeformFile({ projectDir, fileName: 'contact_sheet.jpg' }),
    /不支持|文本/,
  );

  assert.throws(() => freeformProject.resolveFreeformFile(projectDir, '../secret.txt'), /非法/);
  assert.throws(() => freeformProject.resolveFreeformFile(projectDir, '..\\secret.txt'), /非法/);
  assert.throws(() => freeformProject.resolveFreeformFile(projectDir, 'index.html/child'), /非法|不支持/);
  assert.throws(() => freeformProject.resolveFreeformFile(projectDir, 'assets/index.html'), /非法|不支持/);
  assert.throws(() => freeformProject.resolveFreeformFile(projectDir, 'unknown.txt'), /不支持/);
}

run().then(() => {
  console.log('hyperframes freeform project tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
