const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');

const express = require('express');

const {
  findRenderOutputs,
  cleanupTargets,
} = require('../server/services/systemMaintenance');
const configRouter = require('../server/routes/config');

async function createTempRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'system-cleanup-'));
}

async function writeFile(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content);
}

function postJson(port, route, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: route,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        raw += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: JSON.parse(raw) });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function testFindRenderOutputsWhitelist() {
  const rootDir = await createTempRoot();
  const mediaRoot = path.join(rootDir, 'data', 'media');
  const workflowRoot = path.join(rootDir, 'data', 'creative-workflows');
  const projectRoot = path.join(mediaRoot, 'html-video', 'project-a');

  const expectedFiles = [
    path.join(mediaRoot, 'renders', 'direct.mp4'),
    path.join(projectRoot, 'exports', 'final.webm'),
    path.join(projectRoot, 'frames', 'clip.mp4'),
    path.join(projectRoot, 'inspect', 'previews', 'preview.mp4'),
    path.join(projectRoot, 'output.mp4'),
  ];
  for (const filePath of expectedFiles) {
    await writeFile(filePath, 'video');
  }
  await writeFile(path.join(projectRoot, 'metadata.json'), '{}');
  await writeFile(path.join(projectRoot, 'transcript.json'), '{}');
  await writeFile(path.join(workflowRoot, 'workflow.json'), JSON.stringify({
    result: {
      hyperframes_freeform: {
        render: {
          output_path: expectedFiles[0],
          render_versions: [{ output_path: expectedFiles[1] }],
        },
      },
    },
    video: {
      output_path: expectedFiles[2],
      render_versions: [{ output_path: expectedFiles[3] }],
    },
    visual_inspect: {
      output_path: expectedFiles[4],
    },
  }));

  const outputs = await findRenderOutputs({ rootDir, mediaRoot });
  const normalized = outputs.map(item => path.resolve(item.path)).sort();
  assert.deepStrictEqual(normalized, expectedFiles.map(filePath => path.resolve(filePath)).sort());
  assert.ok(!normalized.some(filePath => filePath.endsWith('metadata.json')), 'metadata.json 不应被识别为可清理产物');
  assert.ok(!normalized.some(filePath => filePath.endsWith('transcript.json')), 'transcript.json 不应被识别为可清理产物');

  await fsp.rm(rootDir, { recursive: true, force: true });
}

async function testEscapedCandidateIsSkipped() {
  const rootDir = await createTempRoot();
  const mediaRoot = path.join(rootDir, 'data', 'media');
  const workflowRoot = path.join(rootDir, 'data', 'creative-workflows');
  const outsideFile = path.join(rootDir, 'outside.mp4');

  await writeFile(outsideFile, 'outside');
  await writeFile(path.join(workflowRoot, 'workflow.json'), JSON.stringify({
    video: { output_path: outsideFile },
  }));

  const result = await cleanupTargets({
    targets: ['render-outputs'],
    rootDir,
    mediaRoot,
    hasRunningCreativeTasks: async () => false,
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(outsideFile), true, '逃逸白名单的候选文件不能被删除');
  assert.ok(result.skipped.some(item => path.resolve(item.path) === path.resolve(outsideFile)), '逃逸候选应记录为 skipped');

  await fsp.rm(rootDir, { recursive: true, force: true });
}

async function testRunningCreativeTasksBlockCleanup() {
  const rootDir = await createTempRoot();
  const mediaRoot = path.join(rootDir, 'data', 'media');
  await writeFile(path.join(rootDir, 'data', 'creative-workflows', 'workflow.json'), '{}');

  const result = await cleanupTargets({
    targets: ['creative-workflows'],
    rootDir,
    mediaRoot,
    hasRunningCreativeTasks: async () => true,
  });

  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('当前有创作任务正在运行'));

  await fsp.rm(rootDir, { recursive: true, force: true });
}

async function testCookiesCleanupClearsMemory() {
  const rootDir = await createTempRoot();
  const cookieFile = path.join(rootDir, 'data', 'cookies.json');
  const storedCookies = { douyin: 'douyin-cookie', xhs: 'xhs-cookie' };
  await writeFile(cookieFile, JSON.stringify(storedCookies));

  const result = await cleanupTargets({
    targets: ['cookies'],
    rootDir,
    cookieFile,
    storedCookies,
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(storedCookies.douyin, '');
  assert.strictEqual(storedCookies.xhs, '');
  assert.ok(!fs.existsSync(cookieFile) || fs.readFileSync(cookieFile, 'utf8') === '');

  await fsp.rm(rootDir, { recursive: true, force: true });
}

async function testDefaultCookieFileCleanup() {
  const rootDir = await createTempRoot();
  const cookieFile = path.join(rootDir, 'douyin-cookies.json');
  const storedCookies = { douyin: 'douyin-cookie', xhs: 'xhs-cookie' };
  await writeFile(cookieFile, JSON.stringify(storedCookies));

  const result = await cleanupTargets({
    targets: ['cookies'],
    rootDir,
    storedCookies,
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(storedCookies.douyin, '');
  assert.strictEqual(storedCookies.xhs, '');
  assert.strictEqual(fs.existsSync(cookieFile), false, '默认应清理根目录 douyin-cookies.json');

  await fsp.rm(rootDir, { recursive: true, force: true });
}

async function testRouteUnknownTargetReturns400() {
  const app = express();
  app.use(express.json());
  app.use('/api/config', configRouter);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const port = server.address().port;
    const response = await postJson(port, '/api/config/maintenance/cleanup', { targets: ['unknown'] });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.message, '不支持的清理类型。');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function run() {
  await testFindRenderOutputsWhitelist();
  await testEscapedCandidateIsSkipped();
  await testRunningCreativeTasksBlockCleanup();
  await testCookiesCleanupClearsMemory();
  await testDefaultCookieFileCleanup();
  await testRouteUnknownTargetReturns400();
  console.log('system maintenance cleanup tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
