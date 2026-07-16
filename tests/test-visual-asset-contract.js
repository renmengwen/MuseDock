const assert = require('assert');

const {
  normalizeVisualAsset,
  mergeVisualAssets,
  mergeVisualAssetContexts,
} = require('../server/services/creative/visualAssetContract');

function testLegacySourceCompatibility() {
  const upload = normalizeVisualAsset({ id: 'upload_01', source: 'upload', path: 'assets/upload.png' });
  assert.equal(upload.media_type, 'image');
  assert.equal(upload.origin, 'user_upload');
  assert.equal(upload.origin_detail, 'creative_input');
  assert.equal(upload.requirement, 'preferred');
  assert.equal(upload.evidence_class, 'user_supplied');
  assert.equal(upload.status, 'ready');

  const article = normalizeVisualAsset({ id: 'article_01', source: 'article', path: 'assets/article.png' });
  assert.equal(article.origin, 'source_extract');
  assert.equal(article.origin_detail, 'article_embedded');
  assert.equal(article.requirement, 'optional');
  assert.equal(article.evidence_class, 'direct_source');

  const generated = normalizeVisualAsset({ id: 'gen_scene_01', source: 'generated', path: 'assets/generated.png' });
  assert.equal(generated.origin, 'ai_generated');
  assert.equal(generated.requirement, 'optional');
  assert.equal(generated.evidence_class, 'synthetic');

  const search = normalizeVisualAsset({ id: 'search_01', source: 'search', path: 'assets/search.png' });
  assert.equal(search.origin, 'stock_search');
  assert.equal(search.origin_detail, 'pexels');
  assert.equal(search.requirement, 'optional');
  assert.equal(search.evidence_class, 'contextual');
}

function testExplicitContract() {
  const required = normalizeVisualAsset({
    id: 'upload_required',
    media_type: 'image',
    origin: 'user_upload',
    origin_detail: 'creative_input',
    provider: 'local',
    requirement: 'required',
    evidence_class: 'user_supplied',
    status: 'ready',
  });
  assert.equal(required.requirement, 'required');
  assert.equal(required.provider, 'local');

  const derived = normalizeVisualAsset({
    id: 'crop_01',
    origin: 'derived',
    origin_detail: 'editor_crop',
    requirement: 'optional',
    evidence_class: 'derived_source',
    parent_asset_id: 'article_01',
  });
  assert.equal(derived.parent_asset_id, 'article_01');

  const pageCapture = normalizeVisualAsset({
    id: 'capture_01',
    origin: 'page_capture',
    origin_detail: 'github_repository_page',
  });
  assert.equal(pageCapture.provider, 'chromium');
  assert.equal(pageCapture.requirement, 'optional');
  assert.equal(pageCapture.evidence_class, 'direct_source');
}

function testInvalidContractRejected() {
  assert.throws(() => normalizeVisualAsset({ source: 'upload' }), /缺少 id/);
  assert.throws(() => normalizeVisualAsset({ id: 'bad_origin', origin: 'unknown', requirement: 'optional', evidence_class: 'contextual' }), /素材来源无效/);
  assert.throws(() => normalizeVisualAsset({ id: 'bad_requirement', origin: 'user_upload', requirement: 'always', evidence_class: 'user_supplied' }), /使用约束无效/);
  assert.throws(() => normalizeVisualAsset({ id: 'bad_evidence', origin: 'ai_generated', requirement: 'optional', evidence_class: 'truth' }), /证据类型无效/);
  assert.throws(() => normalizeVisualAsset({ id: 'bad_status', origin: 'user_upload', requirement: 'preferred', evidence_class: 'user_supplied', status: 'loading' }), /素材状态无效/);
  assert.throws(() => normalizeVisualAsset({ id: 'crop_missing_parent', origin: 'derived', requirement: 'optional', evidence_class: 'derived_source' }), /缺少父素材/);
  assert.throws(() => normalizeVisualAsset(null), /必须是对象/);
  assert.throws(() => normalizeVisualAsset([]), /必须是对象/);
  assert.throws(() => normalizeVisualAsset('upload_01'), /必须是对象/);
  assert.throws(() => normalizeVisualAsset({ id: 'unknown_source', source: 'unknown' }), /素材来源无效/);
}

function testMergeIsStableAndIdempotent() {
  const merged = mergeVisualAssets(
    [{ id: 'upload_01', source: 'upload', path: 'assets/upload.png', title: '旧标题' }],
    [
      { id: 'upload_01', source: 'upload', title: '新标题' },
      { id: 'gen_scene_01', source: 'generated', path: 'assets/generated.png' },
    ],
  );
  assert.deepEqual(merged.map(asset => asset.id), ['upload_01', 'gen_scene_01']);
  assert.equal(merged[0].path, 'assets/upload.png');
  assert.equal(merged[0].title, '新标题');
  assert.equal(merged[1].requirement, 'optional');

  const repeated = mergeVisualAssets(merged, merged);
  assert.deepEqual(repeated, merged);

  assert.throws(() => mergeVisualAssets(
    [{ id: 'same_id', source: 'upload', path: 'assets/upload.png' }],
    [{ id: 'same_id', source: 'generated' }],
  ), /来源冲突/);
  assert.throws(() => mergeVisualAssets(
    [{ id: 'same_id', source: 'upload', path: 'assets/upload.png' }],
    [{ id: 'same_id', source: 'unknown' }],
  ), /素材来源无效/);
}

function testContextMergePreservesAssetsAndDiagnostics() {
  const merged = mergeVisualAssetContexts(
    {
      status: 'ready',
      summary: '已有上传素材。',
      assets: [{ id: 'upload_01', source: 'upload', path: 'assets/upload.png' }],
      diagnostics: [{ code: 'upload_ready' }],
    },
    {
      status: 'ready',
      summary: '来源素材准备完成。',
      assets: [{ id: 'article_01', source: 'article', path: 'assets/article.png' }],
      diagnostics: [{ code: 'source_ready' }],
    },
  );
  assert.deepEqual(merged.assets.map(asset => asset.id), ['upload_01', 'article_01']);
  assert.deepEqual(merged.diagnostics.map(item => item.code), ['upload_ready', 'source_ready']);
  assert.equal(merged.summary, '来源素材准备完成。');

  const repeated = mergeVisualAssetContexts(merged, {
    status: '   ',
    assets: [{ id: 'article_01', source: 'article', path: 'assets/article.png' }],
    diagnostics: [{ code: 'source_ready' }],
  });
  assert.deepEqual(repeated.assets, merged.assets);
  assert.deepEqual(repeated.diagnostics, merged.diagnostics);
  assert.equal(repeated.status, 'ready');
}

testLegacySourceCompatibility();
testExplicitContract();
testInvalidContractRejected();
testMergeIsStableAndIdempotent();
testContextMergePreservesAssetsAndDiagnostics();

console.log('visual asset contract tests passed');
