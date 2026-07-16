const assert = require('assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const { registerDerivedVisualAsset } = require('../server/services/creative/derivedVisualAssets');

const TEST_TEMP_PREFIX = 'derived-visual-assets-test-';
const tempRoots = [];
const directoryLinks = [];

const IMAGE_BYTES = {
  '.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  '.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9]),
  '.jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9]),
  '.webp': Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x04, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
  ]),
};

function assertSafeTestPath(targetPath) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(targetPath));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.ok(relative.split(path.sep)[0].startsWith(TEST_TEMP_PREFIX));
}

async function createTempRoot(label) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `${TEST_TEMP_PREFIX}${label}-`));
  tempRoots.push(root);
  return root;
}

async function pathExists(targetPath) {
  try {
    await fsp.lstat(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function cleanupTestArtifacts() {
  for (const linkPath of [...directoryLinks].reverse()) {
    assertSafeTestPath(linkPath);
    try {
      await fsp.unlink(linkPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const root of [...tempRoots].reverse()) {
    assertSafeTestPath(root);
    await fsp.rm(root, { recursive: true, force: true });
  }
}

async function assertNoTrackedArtifacts() {
  for (const targetPath of [...directoryLinks, ...tempRoots]) {
    assertSafeTestPath(targetPath);
    assert.equal(await pathExists(targetPath), false, `本轮测试临时路径未清理：${targetPath}`);
  }
}

async function createProject(label = 'project') {
  const projectDir = await createTempRoot(label);
  const assetDir = path.join(projectDir, 'assets');
  await fsp.mkdir(assetDir, { recursive: true });
  return { projectDir, assetDir };
}

async function writeAsset(assetDir, name, content = IMAGE_BYTES[path.extname(name).toLowerCase()] || 'image-bytes') {
  const filePath = path.join(assetDir, name);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content);
  return filePath;
}

function parentAsset(id, localPath, evidenceClass = 'direct_source') {
  return {
    id,
    media_type: 'image',
    origin: evidenceClass === 'derived_source' ? 'derived' : 'source_extract',
    origin_detail: evidenceClass === 'derived_source' ? 'editor_crop' : 'article_embedded',
    provider: 'local',
    requirement: 'optional',
    evidence_class: evidenceClass,
    status: 'ready',
    path: `assets/${path.basename(localPath)}`,
    local_path: localPath,
    mime: 'image/png',
    bytes: 11,
    ...(evidenceClass === 'derived_source' ? { parent_asset_id: 'root_01' } : {}),
  };
}

function registerInput(assetContext, projectDir, parentAssetId, childFilePath, overrides = {}) {
  return {
    assetContext,
    projectDir,
    parentAssetId,
    childFilePath,
    id: 'derived_crop_01',
    originDetail: 'editor_crop',
    derivation: { tool: 'editor', operation: 'crop', version: 1 },
    ...overrides,
  };
}

async function expectFailureUnchanged(input, pattern) {
  const before = structuredClone(input.assetContext);
  await assert.rejects(() => registerDerivedVisualAsset(input), pattern);
  assert.deepEqual(input.assetContext, before);
}

async function createDirectoryLink(target, linkPath) {
  try {
    await fsp.symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    directoryLinks.push(linkPath);
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(error.code)) {
      console.log(`跳过 junction/symlink 逃逸测试：当前平台不允许创建目录链接（${error.code}）。`);
      return false;
    }
    throw error;
  }
}

async function testRegistersControlledDerivedAsset() {
  const { projectDir, assetDir } = await createProject();
  const parentPath = await writeAsset(assetDir, 'parent.png');
  const childPath = await writeAsset(assetDir, 'crops/child.webp');
  const parent = parentAsset('parent_01', parentPath);
  const assetContext = {
    status: 'ready',
    summary: '已有来源素材。',
    assets: [parent],
    diagnostics: [{ code: 'source_ready' }],
  };
  const before = structuredClone(assetContext);

  const result = await registerDerivedVisualAsset(registerInput(
    assetContext,
    projectDir,
    parent.id,
    childPath,
  ));

  assert.deepEqual(assetContext, before, '登记函数不得修改输入上下文或父素材');
  assert.equal(result.asset_context.assets.length, 2);
  assert.deepEqual(result.asset_context.assets[0], parent);
  assert.deepEqual(result.asset_context.diagnostics, assetContext.diagnostics);
  assert.deepEqual({
    id: result.asset.id,
    media_type: result.asset.media_type,
    origin: result.asset.origin,
    origin_detail: result.asset.origin_detail,
    requirement: result.asset.requirement,
    evidence_class: result.asset.evidence_class,
    parent_asset_id: result.asset.parent_asset_id,
    status: result.asset.status,
    path: result.asset.path,
    local_path: result.asset.local_path,
    mime: result.asset.mime,
    bytes: result.asset.bytes,
    derivation: result.asset.derivation,
  }, {
    id: 'derived_crop_01',
    media_type: 'image',
    origin: 'derived',
    origin_detail: 'editor_crop',
    requirement: 'optional',
    evidence_class: 'derived_source',
    parent_asset_id: 'parent_01',
    status: 'ready',
    path: 'assets/crops/child.webp',
    local_path: await fsp.realpath(childPath),
    mime: 'image/webp',
    bytes: IMAGE_BYTES['.webp'].length,
    derivation: { tool: 'editor', operation: 'crop', version: 1 },
  });

  const nestedDerivation = { tool: 'editor', options: { crop: { x: 1, tags: ['hero'] } } };
  const isolatedChildPath = await writeAsset(assetDir, 'crops/isolated.png');
  const isolated = await registerDerivedVisualAsset(registerInput(
    assetContext,
    projectDir,
    parent.id,
    isolatedChildPath,
    { id: 'derived_isolated', derivation: nestedDerivation },
  ));
  nestedDerivation.options.crop.tags.push('input-mutation');
  assert.deepEqual(isolated.asset.derivation.options.crop.tags, ['hero'], '输入嵌套对象不得污染返回素材');
  isolated.asset.derivation.options.crop.tags.push('result-mutation');
  assert.deepEqual(nestedDerivation.options.crop.tags, ['hero', 'input-mutation'], '返回素材不得反向污染输入嵌套对象');

  const negativeZeroPath = await writeAsset(assetDir, 'crops/negative-zero.png');
  const negativeZero = await registerDerivedVisualAsset(registerInput(
    assetContext,
    projectDir,
    parent.id,
    negativeZeroPath,
    { id: 'derived_negative_zero', derivation: { x: -0 } },
  ));
  assert.equal(Object.is(negativeZero.asset.derivation.x, -0), true, 'JSON-like clone 必须保留 -0');
}

async function testRequiresKnownParentAndRegisteredFile() {
  const { projectDir, assetDir } = await createProject();
  const childPath = await writeAsset(assetDir, 'child.png');
  const missingParentContext = { status: 'ready', assets: [] };

  await expectFailureUnchanged(registerInput(
    missingParentContext,
    projectDir,
    '',
    childPath,
  ), /父素材 ID.*不能为空/);
  await expectFailureUnchanged(registerInput(
    missingParentContext,
    projectDir,
    'unknown_parent',
    childPath,
  ), /未找到父素材.*unknown_parent/);

  const unregistered = parentAsset('parent_unregistered', path.join(assetDir, 'missing-parent.png'));
  delete unregistered.local_path;
  delete unregistered.path;
  await expectFailureUnchanged(registerInput(
    { status: 'ready', assets: [unregistered] },
    projectDir,
    unregistered.id,
    childPath,
  ), /父素材.*未登记本地文件/);

  const missingFile = parentAsset('parent_missing_file', path.join(assetDir, 'missing-parent.png'));
  await expectFailureUnchanged(registerInput(
    { status: 'ready', assets: [missingFile] },
    projectDir,
    missingFile.id,
    childPath,
  ), /父素材.*文件不存在/);
}

async function testRejectsUnsafeOrInvalidChildFile() {
  const { projectDir, assetDir } = await createProject();
  const parentPath = await writeAsset(assetDir, 'parent.png');
  const parent = parentAsset('parent_01', parentPath);
  const assetContext = { status: 'ready', assets: [parent] };
  const outsidePath = path.join(projectDir, 'outside.png');
  await fsp.writeFile(outsidePath, 'outside');

  await expectFailureUnchanged(registerInput(
    assetContext,
    projectDir,
    parent.id,
    outsidePath,
  ), /子素材文件必须位于项目 assets 目录/);
  await expectFailureUnchanged(registerInput(
    assetContext,
    projectDir,
    parent.id,
    path.join(assetDir, 'missing.png'),
  ), /子素材文件不存在/);

  const emptyPath = await writeAsset(assetDir, 'empty.png', '');
  await expectFailureUnchanged(registerInput(
    assetContext,
    projectDir,
    parent.id,
    emptyPath,
  ), /子素材文件为空/);

  const unsupportedPath = await writeAsset(assetDir, 'child.gif', 'gif-data');
  await expectFailureUnchanged(registerInput(
    assetContext,
    projectDir,
    parent.id,
    unsupportedPath,
  ), /仅支持 PNG、JPEG 或 WebP/);

  const forgedPath = await writeAsset(assetDir, 'forged.png', 'not-a-png');
  await expectFailureUnchanged(registerInput(
    assetContext,
    projectDir,
    parent.id,
    forgedPath,
  ), /图片内容与扩展名不匹配/);

  class DerivationDetails {
    constructor() {
      this.operation = 'crop';
    }
  }
  const invalidDerivations = [
    ['function', { nested: { callback() {} } }],
    ['class', { details: new DerivationDetails() }],
    ['symbol-key', { [Symbol('hidden')]: 'value' }],
    ['symbol-value', { value: Symbol('hidden') }],
    ['undefined', { value: undefined }],
    ['bigint', { value: 1n }],
    ['date', { value: new Date() }],
  ];
  for (const [label, invalidDerivation] of invalidDerivations) {
    await expectFailureUnchanged(registerInput(
      assetContext,
      projectDir,
      parent.id,
      await writeAsset(assetDir, `${label}-derivation.png`),
      { derivation: invalidDerivation },
    ), /派生信息.*JSON/);
  }

  const circular = {};
  circular.self = circular;
  await expectFailureUnchanged(registerInput(
    assetContext,
    projectDir,
    parent.id,
    await writeAsset(assetDir, 'circular-derivation.png'),
    { derivation: circular },
  ), /派生信息.*JSON/);
}

async function testRejectsLinkedPathEscapes() {
  const projectDir = await createTempRoot('link-root');
  const outsideRoot = await createTempRoot('link-outside');
  const linkedAssetDir = path.join(projectDir, 'assets');
  if (!await createDirectoryLink(outsideRoot, linkedAssetDir)) return;
  const outsideParent = await writeAsset(outsideRoot, 'parent.png');
  const outsideChild = await writeAsset(outsideRoot, 'child.png');
  const linkedRootContext = { status: 'ready', assets: [parentAsset('linked_root_parent', outsideParent)] };
  await expectFailureUnchanged(registerInput(
    linkedRootContext,
    projectDir,
    'linked_root_parent',
    outsideChild,
  ), /assets 目录不存在或不安全/);

  const safe = await createProject('derived-link-entry-');
  const safeParentPath = await writeAsset(safe.assetDir, 'safe-parent.png');
  const outsideDir = await createTempRoot('link-target');
  const outsideLinkedParent = await writeAsset(outsideDir, 'linked-parent.png');
  const outsideLinkedChild = await writeAsset(outsideDir, 'linked-child.png');
  const escapeDir = path.join(safe.assetDir, 'escape');
  if (!await createDirectoryLink(outsideDir, escapeDir)) return;

  const escapedParent = parentAsset('escaped_parent', path.join(escapeDir, path.basename(outsideLinkedParent)));
  await expectFailureUnchanged(registerInput(
    { status: 'ready', assets: [escapedParent] },
    safe.projectDir,
    escapedParent.id,
    await writeAsset(safe.assetDir, 'safe-child.png'),
  ), /父素材.*不在项目 assets 目录/);

  const safeParent = parentAsset('safe_parent', safeParentPath);
  await expectFailureUnchanged(registerInput(
    { status: 'ready', assets: [safeParent] },
    safe.projectDir,
    safeParent.id,
    path.join(escapeDir, path.basename(outsideLinkedChild)),
  ), /子素材文件必须位于项目 assets 目录/);
}

async function testRejectsUntrustedParentEvidenceAndInvalidDetail() {
  const details = ['editor_crop', 'video_keyframe', 'page_crop'];
  for (const originDetail of details) {
    const { projectDir, assetDir } = await createProject(`derived-${originDetail}-`);
    const parentPath = await writeAsset(assetDir, 'parent.png');
    const childPath = await writeAsset(assetDir, `${originDetail}.jpg`);
    const parent = parentAsset(`parent_${originDetail}`, parentPath);
    const result = await registerDerivedVisualAsset(registerInput(
      { status: 'ready', assets: [parent] },
      projectDir,
      parent.id,
      childPath,
      { id: `derived_${originDetail}`, originDetail },
    ));
    assert.equal(result.asset.origin_detail, originDetail);
    assert.equal(result.asset.mime, 'image/jpeg');
  }

  for (const evidenceClass of ['synthetic', 'contextual', 'user_supplied']) {
    const { projectDir, assetDir } = await createProject(`derived-evidence-${evidenceClass}-`);
    const parentPath = await writeAsset(assetDir, 'parent.png');
    const childPath = await writeAsset(assetDir, 'child.png');
    const parent = parentAsset(`parent_${evidenceClass}`, parentPath, evidenceClass);
    await expectFailureUnchanged(registerInput(
      { status: 'ready', assets: [parent] },
      projectDir,
      parent.id,
      childPath,
    ), /父素材证据类型.*不能登记为来源派生素材/);
  }

  const { projectDir, assetDir } = await createProject('derived-invalid-detail-');
  const parentPath = await writeAsset(assetDir, 'parent.png');
  const childPath = await writeAsset(assetDir, 'child.png');
  const parent = parentAsset('parent_detail', parentPath);
  await expectFailureUnchanged(registerInput(
    { status: 'ready', assets: [parent] },
    projectDir,
    parent.id,
    childPath,
    { originDetail: 'freeform_crop' },
  ), /衍生类型无效.*editor_crop.*video_keyframe.*page_crop/);
}

async function testAllowsDerivedSourceParent() {
  const { projectDir, assetDir } = await createProject('derived-chain-');
  const rootPath = await writeAsset(assetDir, 'root.png');
  const parentPath = await writeAsset(assetDir, 'derived-parent.png');
  const childPath = await writeAsset(assetDir, 'derived-child.png');
  const root = parentAsset('root_01', rootPath);
  const parent = parentAsset('derived_parent_01', parentPath, 'derived_source');
  const result = await registerDerivedVisualAsset(registerInput(
    { status: 'ready', assets: [root, parent] },
    projectDir,
    parent.id,
    childPath,
    { id: 'derived_child_01', originDetail: 'page_crop' },
  ));
  assert.equal(result.asset.parent_asset_id, parent.id);
  assert.equal(result.asset.evidence_class, 'derived_source');
}

async function testIdempotencyAndIdConflicts() {
  const { projectDir, assetDir } = await createProject();
  const parentPath = await writeAsset(assetDir, 'parent.png');
  const otherParentPath = await writeAsset(assetDir, 'other-parent.png');
  const childPath = await writeAsset(assetDir, 'child.png');
  const otherChildPath = await writeAsset(assetDir, 'other-child.png');
  const parent = parentAsset('parent_01', parentPath);
  const otherParent = parentAsset('parent_02', otherParentPath);
  const first = await registerDerivedVisualAsset(registerInput(
    { status: 'ready', assets: [parent, otherParent] },
    projectDir,
    parent.id,
    childPath,
  ));
  const beforeRepeated = structuredClone(first.asset_context);
  const repeated = await registerDerivedVisualAsset(registerInput(
    first.asset_context,
    projectDir,
    parent.id,
    childPath,
  ));
  assert.equal(repeated.asset_context.assets.filter(asset => asset.id === 'derived_crop_01').length, 1);
  assert.deepEqual(repeated.asset, first.asset);
  assert.deepEqual(first.asset_context, beforeRepeated, '完全一致的幂等登记不得修改输入上下文');

  const equivalentPathContext = structuredClone(first.asset_context);
  equivalentPathContext.assets.find(asset => asset.id === 'derived_crop_01').path = 'assets/./child.png';
  await expectFailureUnchanged(registerInput(
    equivalentPathContext,
    projectDir,
    parent.id,
    childPath,
  ), /素材 ID.*derived_crop_01.*登记冲突.*文件/);

  const stringBytesContext = structuredClone(first.asset_context);
  stringBytesContext.assets.find(asset => asset.id === 'derived_crop_01').bytes = String(IMAGE_BYTES['.png'].length);
  await expectFailureUnchanged(registerInput(
    stringBytesContext,
    projectDir,
    parent.id,
    childPath,
  ), /素材 ID.*derived_crop_01.*登记冲突.*大小/);

  await expectFailureUnchanged(registerInput(
    first.asset_context,
    projectDir,
    parent.id,
    otherChildPath,
  ), /素材 ID.*derived_crop_01.*登记冲突.*文件/);

  await expectFailureUnchanged(registerInput(
    first.asset_context,
    projectDir,
    parent.id,
    childPath,
    { originDetail: 'page_crop' },
  ), /素材 ID.*derived_crop_01.*登记冲突.*衍生类型/);

  await expectFailureUnchanged(registerInput(
    first.asset_context,
    projectDir,
    parent.id,
    childPath,
    { derivation: { tool: 'editor', operation: 'crop', version: 2 } },
  ), /素材 ID.*derived_crop_01.*登记冲突.*派生信息/);

  const mimeConflictContext = structuredClone(first.asset_context);
  mimeConflictContext.assets.find(asset => asset.id === 'derived_crop_01').mime = 'image/jpeg';
  await expectFailureUnchanged(registerInput(
    mimeConflictContext,
    projectDir,
    parent.id,
    childPath,
  ), /素材 ID.*derived_crop_01.*登记冲突.*格式/);

  await fsp.appendFile(childPath, Buffer.from([0x00]));
  await expectFailureUnchanged(registerInput(
    first.asset_context,
    projectDir,
    parent.id,
    childPath,
  ), /素材 ID.*derived_crop_01.*登记冲突.*大小/);
  await writeAsset(assetDir, 'child.png');

  await expectFailureUnchanged(registerInput(
    first.asset_context,
    projectDir,
    otherParent.id,
    childPath,
  ), /素材 ID.*derived_crop_01.*已绑定其他父素材/);

  const occupied = {
    ...parentAsset('occupied_id', parentPath),
    id: 'derived_crop_01',
  };
  await expectFailureUnchanged(registerInput(
    { status: 'ready', assets: [parent, occupied] },
    projectDir,
    parent.id,
    childPath,
  ), /素材 ID.*derived_crop_01.*已被非衍生素材占用/);
}

(async () => {
  assert.equal(tempRoots.length, 0, '测试开始前不得存在本轮临时根跟踪记录');
  assert.equal(directoryLinks.length, 0, '测试开始前不得存在本轮目录链接跟踪记录');
  await assertNoTrackedArtifacts();
  try {
    await testRegistersControlledDerivedAsset();
    await testRequiresKnownParentAndRegisteredFile();
    await testRejectsUnsafeOrInvalidChildFile();
    await testRejectsLinkedPathEscapes();
    await testRejectsUntrustedParentEvidenceAndInvalidDetail();
    await testAllowsDerivedSourceParent();
    await testIdempotencyAndIdConflicts();
  } finally {
    await cleanupTestArtifacts();
    await assertNoTrackedArtifacts();
  }
  console.log('derived visual asset tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
