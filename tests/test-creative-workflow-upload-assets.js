const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const uploads = require('../server/services/creative/visualAssetUploads');

const IMAGE_BYTES = {
  'image/png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  'image/jpeg': Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=', 'base64'),
  'image/webp': Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vv9UAA=', 'base64'),
};

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function testStagesSupportedImagesAndSanitizesFileNames() {
  const rootDir = tempDir('creative-upload-stage-');
  const cases = [
    ['image/png', '..\\nested/../.主页.png', 'required', '.png'],
    ['image/jpeg', '封面.jpg', undefined, '.jpg'],
    ['image/webp', '插图.webp', undefined, '.webp'],
  ];

  for (const [mime, fileName, requirement, extension] of cases) {
    const staged = await uploads.stageVisualAsset({
      stream: Readable.from(IMAGE_BYTES[mime]),
      fileName,
      mime,
      requirement,
      rootDir,
    });
    const uploadDir = path.join(rootDir, staged.upload_id);
    const manifest = JSON.parse(fs.readFileSync(path.join(uploadDir, 'upload.json'), 'utf8'));

    assert.match(staged.upload_id, uploads.UPLOAD_ID_PATTERN);
    assert.equal(path.extname(fs.readdirSync(uploadDir).find(name => name.startsWith('source.'))), extension);
    assert.equal(manifest.file_name.includes('..'), false);
    assert.equal(manifest.file_name.includes('/'), false);
    assert.equal(manifest.file_name.includes('\\'), false);
    assert.equal(manifest.file_name.startsWith('.'), false);
    assert.equal(manifest.requirement, requirement || 'preferred');
    assert.equal(staged.asset.requirement, requirement || 'preferred');
  }
}

async function testRejectsUnsupportedAndOversizedUploadsWhileReading() {
  const invalidRoot = tempDir('creative-upload-invalid-');
  await assert.rejects(() => uploads.stageVisualAsset({
    stream: Readable.from(Buffer.from('fake-png')),
    fileName: 'spoofed.png',
    mime: 'image/png',
    rootDir: invalidRoot,
  }), /图片内容|格式不匹配/);

  await assert.rejects(() => uploads.stageVisualAsset({
    stream: Readable.from(Buffer.from('plain text')),
    fileName: 'notes.txt',
    mime: 'text/plain',
    rootDir: invalidRoot,
  }), /PNG|JPEG|WebP|图片格式/);
  assert.deepEqual(fs.readdirSync(invalidRoot), []);

  const oversizedRoot = tempDir('creative-upload-oversized-');
  let chunksRead = 0;
  async function* oversizedStream() {
    for (const chunk of [IMAGE_BYTES['image/png'], Buffer.alloc(5 * 1024 * 1024), Buffer.alloc(4 * 1024 * 1024), Buffer.alloc(1024)]) {
      chunksRead += 1;
      yield chunk;
    }
  }
  const stream = oversizedStream();
  stream.destroy = () => {};
  await assert.rejects(() => uploads.stageVisualAsset({
    stream,
    fileName: 'too-large.png',
    mime: 'image/png',
    rootDir: oversizedRoot,
  }), /8MB/);
  assert.ok(chunksRead >= 3);
  assert.deepEqual(fs.readdirSync(oversizedRoot), []);
}

async function testClaimsOnceAndPreflightsTheWholeBatch() {
  const rootDir = tempDir('creative-upload-claim-');
  const targetDir = tempDir('creative-upload-target-');
  const first = await uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/png']),
    fileName: '../主页.png',
    mime: 'image/png',
    requirement: 'required',
    rootDir,
  });
  const second = await uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/webp']),
    fileName: '备选.webp',
    mime: 'image/webp',
    rootDir,
  });

  const claimed = await uploads.claimVisualAssets({
    uploadIds: [first.upload_id],
    workflowId: '202607161200000001',
    targetDir,
    rootDir,
  });
  assert.equal(claimed.assets[0].origin, 'user_upload');
  assert.equal(claimed.assets[0].origin_detail, 'creative_input');
  assert.equal(claimed.assets[0].provider, 'local');
  assert.equal(claimed.assets[0].evidence_class, 'user_supplied');
  assert.equal(claimed.assets[0].requirement, 'required');
  assert.equal(fs.existsSync(claimed.assets[0].local_path), true);
  assert.match(claimed.assets[0].path, /^assets\//);

  await assert.rejects(() => uploads.claimVisualAssets({
    uploadIds: [first.upload_id],
    targetDir,
    rootDir,
  }), /已认领/);

  const untouchedTarget = tempDir('creative-upload-preflight-');
  await assert.rejects(() => uploads.claimVisualAssets({
    uploadIds: [second.upload_id, first.upload_id],
    targetDir: untouchedTarget,
    rootDir,
  }), /已认领/);
  assert.equal(fs.existsSync(path.join(untouchedTarget, 'assets')), false);
  const secondManifest = JSON.parse(fs.readFileSync(path.join(rootDir, second.upload_id, 'upload.json'), 'utf8'));
  assert.equal(secondManifest.status, 'staged');

  await uploads.removeStagedVisualAsset({ uploadId: second.upload_id, rootDir });
  assert.equal(fs.existsSync(path.join(rootDir, second.upload_id)), false);
  await assert.rejects(() => uploads.removeStagedVisualAsset({ uploadId: first.upload_id, rootDir }), /已认领/);
}

async function testUpdatesStagedRequirementAtomicallyAndSerializesMutations() {
  const rootDir = tempDir('creative-upload-requirement-');
  const targetDir = tempDir('creative-upload-requirement-target-');
  const staged = await uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/png']),
    fileName: '待更新.png',
    mime: 'image/png',
    rootDir,
  });

  const updated = await uploads.updateStagedVisualAssetRequirement({
    uploadId: staged.upload_id,
    requirement: 'required',
    rootDir,
  });
  assert.equal(updated.asset.requirement, 'required');
  const claimed = await uploads.claimVisualAssets({
    uploadIds: [staged.upload_id],
    workflowId: '202607161200000005',
    targetDir,
    rootDir,
  });
  assert.equal(claimed.assets[0].requirement, 'required');

  await assert.rejects(() => uploads.updateStagedVisualAssetRequirement({
    uploadId: 'bad-id',
    requirement: 'required',
    rootDir,
  }), /上传素材 ID 无效/);
  await assert.rejects(() => uploads.updateStagedVisualAssetRequirement({
    uploadId: 'upload_missing1234',
    requirement: 'required',
    rootDir,
  }), /不存在|损坏/);
  await assert.rejects(() => uploads.updateStagedVisualAssetRequirement({
    uploadId: staged.upload_id,
    requirement: 'required',
    rootDir,
  }), /已认领/);

  const rollbackRoot = tempDir('creative-upload-requirement-rollback-');
  const rollbackStaged = await uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/png']),
    fileName: '保持原值.png',
    mime: 'image/png',
    rootDir: rollbackRoot,
  });
  for (const requirement of [undefined, null, '']) {
    await assert.rejects(() => uploads.updateStagedVisualAssetRequirement({
      uploadId: rollbackStaged.upload_id,
      requirement,
      rootDir: rollbackRoot,
    }), /使用约束.*不能为空/);
    const manifest = JSON.parse(fs.readFileSync(path.join(rollbackRoot, rollbackStaged.upload_id, 'upload.json'), 'utf8'));
    assert.equal(manifest.requirement, 'preferred');
  }
  await assert.rejects(() => uploads.updateStagedVisualAssetRequirement({
    uploadId: rollbackStaged.upload_id,
    requirement: 'required',
    rootDir: rollbackRoot,
    writeManifest: async () => { throw new Error('disk full'); },
  }), /请重试/);
  const unchanged = JSON.parse(fs.readFileSync(path.join(rollbackRoot, rollbackStaged.upload_id, 'upload.json'), 'utf8'));
  assert.equal(unchanged.requirement, 'preferred');

  let releaseWrite;
  let markWriteStarted;
  const writeStarted = new Promise(resolve => { markWriteStarted = resolve; });
  const writeGate = new Promise(resolve => { releaseWrite = resolve; });
  const queuedUpdate = uploads.updateStagedVisualAssetRequirement({
    uploadId: rollbackStaged.upload_id,
    requirement: 'required',
    rootDir: rollbackRoot,
    writeManifest: async (filePath, manifest) => {
      markWriteStarted();
      await writeGate;
      await fs.promises.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8');
    },
  });
  await writeStarted;
  const queuedDelete = uploads.removeStagedVisualAsset({
    uploadId: rollbackStaged.upload_id,
    rootDir: rollbackRoot,
  });
  const deleteRace = await Promise.race([
    queuedDelete.then(() => 'done'),
    new Promise(resolve => setTimeout(() => resolve('waiting'), 30)),
  ]);
  assert.equal(deleteRace, 'waiting');
  releaseWrite();
  await queuedUpdate;
  await queuedDelete;
}

async function testRollsBackBatchWhenSecondManifestWriteFails() {
  const rootDir = tempDir('creative-upload-manifest-rollback-');
  const targetDir = tempDir('creative-upload-manifest-target-');
  const staged = [];
  for (const fileName of ['第一张.png', '第二张.png']) {
    staged.push(await uploads.stageVisualAsset({
      stream: Readable.from(IMAGE_BYTES['image/png']),
      fileName,
      mime: 'image/png',
      rootDir,
    }));
  }
  let writes = 0;
  const writeManifest = async (filePath, manifest) => {
    writes += 1;
    if (writes === 2) throw new Error('second manifest write failed');
    await fs.promises.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8');
  };

  await assert.rejects(() => uploads.claimVisualAssets({
    uploadIds: staged.map(item => item.upload_id),
    workflowId: '202607161200000002',
    targetDir,
    rootDir,
    writeManifest,
  }), /认领上传素材失败|second manifest/);

  for (const item of staged) {
    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, item.upload_id, 'upload.json'), 'utf8'));
    assert.equal(manifest.status, 'staged');
    assert.equal(manifest.workflow_id, undefined);
  }
  assert.deepEqual(fs.readdirSync(path.join(targetDir, 'assets')), []);
}

async function testCleansExpiredUploadsAndEnforcesStagedQuotas() {
  const cleanupRoot = tempDir('creative-upload-cleanup-');
  const expired = await uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/png']),
    fileName: 'expired.png',
    mime: 'image/png',
    rootDir: cleanupRoot,
    now: () => '2026-07-14T00:00:00.000Z',
  });
  await uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/png']),
    fileName: 'current.png',
    mime: 'image/png',
    rootDir: cleanupRoot,
    now: () => '2026-07-16T00:00:00.000Z',
  });
  assert.equal(fs.existsSync(path.join(cleanupRoot, expired.upload_id)), false);

  const countRoot = tempDir('creative-upload-count-quota-');
  await uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/png']),
    fileName: 'one.png',
    mime: 'image/png',
    rootDir: countRoot,
    maxStagedUploads: 1,
  });
  await assert.rejects(() => uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/png']),
    fileName: 'two.png',
    mime: 'image/png',
    rootDir: countRoot,
    maxStagedUploads: 1,
  }), /数量|配额/);

  const bytesRoot = tempDir('creative-upload-bytes-quota-');
  await uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/png']),
    fileName: 'one.png',
    mime: 'image/png',
    rootDir: bytesRoot,
    maxStagedBytes: IMAGE_BYTES['image/png'].length + IMAGE_BYTES['image/jpeg'].length - 1,
  });
  await assert.rejects(() => uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/jpeg']),
    fileName: 'two.jpg',
    mime: 'image/jpeg',
    rootDir: bytesRoot,
    maxStagedBytes: IMAGE_BYTES['image/png'].length + IMAGE_BYTES['image/jpeg'].length - 1,
  }), /总大小|配额/);
}

async function testExpiredClaimedCleanupKeepsTaskAsset() {
  const rootDir = tempDir('creative-upload-claimed-cleanup-');
  const targetDir = tempDir('creative-upload-claimed-target-');
  const staged = await uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/png']),
    fileName: 'claimed.png',
    mime: 'image/png',
    rootDir,
    now: () => '2026-07-14T00:00:00.000Z',
  });
  const claimed = await uploads.claimVisualAssets({
    uploadIds: [staged.upload_id],
    workflowId: '202607161200000003',
    targetDir,
    rootDir,
  });

  await uploads.cleanupExpiredStagedVisualAssets({
    rootDir,
    now: () => '2026-07-16T00:00:00.000Z',
  });

  assert.equal(fs.existsSync(path.join(rootDir, staged.upload_id)), false);
  assert.equal(fs.existsSync(claimed.assets[0].local_path), true);
}

async function testUnfinishedOversizedUploadDoesNotBlockClaimOrRemove() {
  const rootDir = tempDir('creative-upload-concurrency-');
  const targetDir = tempDir('creative-upload-concurrency-target-');
  const removable = await uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/png']),
    fileName: 'remove.png',
    mime: 'image/png',
    rootDir,
  });
  const claimable = await uploads.stageVisualAsset({
    stream: Readable.from(IMAGE_BYTES['image/png']),
    fileName: 'claim.png',
    mime: 'image/png',
    rootDir,
  });
  let releaseStream;
  let markWaiting;
  const waiting = new Promise(resolve => { markWaiting = resolve; });
  const gate = new Promise(resolve => { releaseStream = resolve; });
  async function* unfinishedOversizedStream() {
    yield IMAGE_BYTES['image/png'];
    yield Buffer.alloc(uploads.MAX_UPLOAD_BYTES);
    markWaiting();
    await gate;
  }
  const hangingUpload = uploads.stageVisualAsset({
    stream: unfinishedOversizedStream(),
    fileName: 'hanging.png',
    mime: 'image/png',
    rootDir,
  });
  await waiting;

  const mutations = Promise.all([
    uploads.removeStagedVisualAsset({ uploadId: removable.upload_id, rootDir }),
    uploads.claimVisualAssets({
      uploadIds: [claimable.upload_id],
      workflowId: '202607161200000004',
      targetDir,
      rootDir,
    }),
  ]);
  const race = await Promise.race([
    mutations.then(() => 'done'),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 100)),
  ]);
  releaseStream();
  await assert.rejects(() => hangingUpload, /8MB/);
  await mutations;
  assert.equal(race, 'done');
}

async function run() {
  await testStagesSupportedImagesAndSanitizesFileNames();
  await testRejectsUnsupportedAndOversizedUploadsWhileReading();
  await testClaimsOnceAndPreflightsTheWholeBatch();
  await testUpdatesStagedRequirementAtomicallyAndSerializesMutations();
  await testRollsBackBatchWhenSecondManifestWriteFails();
  await testCleansExpiredUploadsAndEnforcesStagedQuotas();
  await testUnfinishedOversizedUploadDoesNotBlockClaimOrRemove();
  await testExpiredClaimedCleanupKeepsTaskAsset();
  console.log('creative workflow upload asset tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
