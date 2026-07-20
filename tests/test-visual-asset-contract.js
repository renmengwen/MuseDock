const assert = require('assert');

const {
  isGeneratedVisualAsset,
  mergeVisualAssetFormalFields,
  normalizeVisualAsset,
  mergeVisualAssets,
  mergeVisualAssetContexts,
} = require('../server/services/creative/visualAssetContract');

function testGeneratedIdentityUsesFormalOriginFirst() {
  assert.equal(isGeneratedVisualAsset({ origin: 'ai_generated' }), true);
  assert.equal(isGeneratedVisualAsset({ source: 'generated' }), true);
  assert.equal(isGeneratedVisualAsset({ origin: 'source_extract', source: 'generated' }), false);
  assert.equal(isGeneratedVisualAsset({ origin: 'ai_generated', source: 'article' }), true);
}

function testFormalMergeRejectsInvalidEnums() {
  const runtime = {
    media_type: 'image',
    origin: 'user_upload',
    origin_detail: 'creative_input',
    provider: 'local',
    requirement: 'required',
    evidence_class: 'user_supplied',
    status: 'ready',
    parent_asset_id: 'runtime_parent',
  };
  assert.deepEqual(mergeVisualAssetFormalFields(runtime, {
    media_type: 'bogus',
    origin: 'bogus',
    origin_detail: '  project_detail  ',
    provider: {},
    requirement: 'bogus',
    evidence_class: 'bogus',
    status: 'bogus',
    parent_asset_id: '  project_parent  ',
  }), {
    ...runtime,
    origin_detail: 'project_detail',
    parent_asset_id: 'project_parent',
  });
}

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

  const legacy = mergeVisualAssetContexts(
    { assets: [{ id: 'legacy_01', path: 'assets/legacy.png' }] },
    { assets: [] },
  ).assets[0];
  assert.equal(legacy.origin, 'source_extract');
  assert.equal(legacy.origin_detail, 'legacy_unclassified');
  assert.equal(legacy.requirement, 'optional');
  assert.equal(legacy.evidence_class, 'contextual');
}

function focusRegion(id, overrides = {}) {
  return {
    id,
    label: `区域 ${id}`,
    aliases: [' Stars ', 'stars', '', '星标'],
    region: { x: 0.1, y: 0.2, width: 0.4, height: 0.2 },
    method: 'vision',
    confidence_level: 'high',
    verification: { status: 'candidate', method: 'model', evidence: '候选区域' },
    trust_level: 'A',
    unknown: true,
    ...overrides,
  };
}

function focusAsset(focusRegions) {
  return normalizeVisualAsset({
    id: 'capture_focus',
    origin: 'page_capture',
    path: 'assets/capture.png',
    focus_regions: focusRegions,
  });
}

function testFocusRegionNormalizationAndTrustDerivation() {
  const asset = focusAsset([
    focusRegion('manual', {
      method: 'manual',
      focus_point: { x: 0.2, y: 0.25 },
      verification: { status: 'verified', method: 'user_review', evidence: '用户框选' },
    }),
    focusRegion('ocr', {
      method: 'ocr',
      verification: { status: 'verified', method: 'text_match', evidence: 'Stars' },
    }),
    focusRegion('vision_reviewed', {
      method: 'vision',
      verification: { status: 'verified', method: 'crop_review', evidence: '裁剪复核通过' },
    }),
    focusRegion('detector', {
      method: 'detector',
      verification: { status: 'verified', method: 'object_match', evidence: '唯一目标' },
    }),
    focusRegion('vision_candidate'),
    focusRegion('rejected', {
      method: 'dom',
      verification: { status: 'rejected', method: 'conflict', evidence: '多个目标冲突' },
    }),
  ]);

  assert.deepEqual(asset.focus_regions.map(region => region.trust_level), ['A', 'B', 'B', 'B', 'C', 'D']);
  assert.deepEqual(asset.focus_regions[0].aliases, ['Stars', '星标']);
  assert.deepEqual(asset.focus_regions[0].focus_point, { x: 0.2, y: 0.25 });
  assert.equal(asset.focus_regions[4].confidence_level, 'high', 'producer confidence 只能保留，不能升级 trust');
  assert.deepEqual(Object.keys(asset.focus_regions[0]), [
    'id', 'label', 'aliases', 'region', 'focus_point', 'method', 'confidence_level', 'verification', 'trust_level',
  ]);
  assert.deepEqual(normalizeVisualAsset(asset), asset, 'focus_regions normalize 必须幂等');

  const missing = normalizeVisualAsset({ id: 'legacy', source: 'article', path: 'assets/legacy.png' });
  assert.equal(Object.prototype.hasOwnProperty.call(missing, 'focus_regions'), false, '旧资产字段缺失必须保持缺失');
}

function testInvalidFocusRegionsAreSafelyDropped() {
  const asset = focusAsset([
    focusRegion('valid', { confidence_level: undefined }),
    focusRegion('nan', { region: { x: Number.NaN, y: 0, width: 0.2, height: 0.2 } }),
    focusRegion('zero', { region: { x: 0, y: 0, width: 0, height: 0.2 } }),
    focusRegion('overflow', { region: { x: 0.9, y: 0, width: 0.2, height: 0.2 } }),
    focusRegion('negative', { region: { x: -0.1, y: 0, width: 0.2, height: 0.2 } }),
    focusRegion('string_geometry', { region: { x: '0.1', y: 0, width: 0.2, height: 0.2 } }),
    focusRegion('outside_focus', { focus_point: { x: 0.9, y: 0.3 } }),
    focusRegion('bad_method', { method: 'model_guess' }),
    focusRegion('bad_status', { verification: { status: 'unknown', method: 'model', evidence: '' } }),
    focusRegion('duplicate'),
    focusRegion(' duplicate ', { label: '重复二' }),
  ]);

  assert.deepEqual(asset.focus_regions.map(region => region.id), ['valid']);
  assert.equal(asset.focus_regions[0].confidence_level, 'low');
  for (const invalidContainer of [null, 'bad', { id: 'not-an-array' }]) {
    assert.deepEqual(focusAsset(invalidContainer).focus_regions, []);
  }
}

function testFocusRegionMergePresenceSemantics() {
  const existing = focusAsset([focusRegion('existing')]);
  const preserved = mergeVisualAssets([existing], [{ id: existing.id, title: '只更新标题' }])[0];
  assert.deepEqual(preserved.focus_regions, existing.focus_regions, 'incoming 缺失 focus_regions 时应保留已有值');

  for (const clearValue of [[], null, 'bad', { id: 'not-an-array' }]) {
    const cleared = mergeVisualAssets([existing], [{ id: existing.id, focus_regions: clearValue }])[0];
    assert.deepEqual(cleared.focus_regions, [], '显式空数组或非法容器应安全清空');
  }

  const replacement = mergeVisualAssets([existing], [{
    id: existing.id,
    focus_regions: [focusRegion('replacement', {
      method: 'generation_metadata',
      verification: { status: 'verified', method: 'generator', evidence: '生成布局坐标' },
    })],
  }])[0];
  assert.deepEqual(replacement.focus_regions.map(region => region.id), ['replacement']);
  assert.equal(replacement.focus_regions[0].trust_level, 'A');
  assert.deepEqual(mergeVisualAssets([replacement], [replacement]), [replacement]);
}

testGeneratedIdentityUsesFormalOriginFirst();
testFormalMergeRejectsInvalidEnums();
testLegacySourceCompatibility();
testExplicitContract();
testInvalidContractRejected();
testMergeIsStableAndIdempotent();
testContextMergePreservesAssetsAndDiagnostics();
testFocusRegionNormalizationAndTrustDerivation();
testInvalidFocusRegionsAreSafelyDropped();
testFocusRegionMergePresenceSemantics();

console.log('visual asset contract tests passed');
