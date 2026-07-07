const assert = require('assert/strict');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const sfxLibrary = require('../server/services/creative-video/html-video/sfxLibrary');

const rootDir = process.cwd();
const library = sfxLibrary.loadSfxLibrary({ rootDir });

assert.equal(library.version, 1);
assert.ok(Array.isArray(library.items));
assert.equal(library.items.length, 20);

const ids = new Set();
for (const item of library.items) {
  assert.ok(item.id, 'sfx id missing');
  assert.ok(!ids.has(item.id), `duplicate sfx id: ${item.id}`);
  ids.add(item.id);
  assert.ok(item.file, `file missing for ${item.id}`);
  const resolved = sfxLibrary.resolveSfxAsset(item.id, { rootDir });
  assert.ok(resolved.path.startsWith(path.resolve(rootDir, 'assets', 'sfx')), 'asset should stay inside assets/sfx');
  assert.ok(fs.existsSync(resolved.path), `asset missing: ${resolved.path}`);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(resolved.path)).digest('hex');
  assert.equal(hash, item.sha256, `sha256 mismatch for ${item.id}`);
}

assert.throws(() => sfxLibrary.resolveSfxAsset('../bad', { rootDir }), /未找到音效|不合法/);

// 默认不传 rootDir 时按 __dirname 定位仓库根，不依赖 process.cwd()
assert.equal(sfxLibrary.DEFAULT_ROOT_DIR, path.resolve(rootDir));
assert.equal(sfxLibrary.loadSfxLibrary().items.length, library.items.length);
const summaryFromObject = sfxLibrary.getSfxLibrarySummary({ library });
assert.equal(summaryFromObject.length, library.items.length);
const resolvedFromObject = sfxLibrary.resolveSfxAsset(library.items[0].id, { library });
assert.ok(fs.existsSync(resolvedFromObject.path));

console.log('html-video sfx library tests passed');
