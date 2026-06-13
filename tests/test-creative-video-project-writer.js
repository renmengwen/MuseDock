const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const writer = require('../server/services/creative-video/projectWriter');

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'creative-video-project-'));
  const result = await writer.writeCreativeVideoProject({
    rootDir,
    workflowId: '202606140000000001',
    runId: 'run_001',
    files: {
      'index.html': '<html></html>',
      'meta.json': '{}',
      'hyperframes.json': '{}',
      'scene_spec.json': '{}',
      'frame_specs.json': '{}',
    },
  });
  assert.equal(result.success, true);
  assert.ok(result.project_dir.includes('202606140000000001'));
  assert.equal(await fs.readFile(path.join(result.project_dir, 'index.html'), 'utf8'), '<html></html>');

  const bad = await writer.writeCreativeVideoProject({
    rootDir,
    workflowId: '202606140000000001',
    runId: 'run_002',
    files: { '../escape.txt': 'bad' },
  });
  assert.equal(bad.success, false);

  const partial = await writer.writeCreativeVideoProject({
    rootDir,
    workflowId: '202606140000000001',
    runId: 'run_003',
    files: { 'index.html': 'partial', '../escape.txt': 'bad' },
  });
  assert.equal(partial.success, false);
  await assert.rejects(
    fs.readFile(path.join(rootDir, '202606140000000001', 'agent_runs', 'run_003-hyperframes-lite', 'index.html'), 'utf8'),
    /ENOENT/
  );

  const writeFailure = await writer.writeCreativeVideoProject({
    rootDir,
    workflowId: '202606140000000001',
    runId: 'run_004',
    files: {
      'index.html': 'partial',
      'meta.json': { toString: () => { throw new Error('序列化失败'); } },
    },
  });
  assert.equal(writeFailure.success, false);
  await assert.rejects(
    fs.readFile(path.join(rootDir, '202606140000000001', 'agent_runs', 'run_004-hyperframes-lite', 'index.html'), 'utf8'),
    /ENOENT/
  );

  console.log('creative video project writer tests passed');
})();
