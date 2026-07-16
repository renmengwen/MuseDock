const ORIGINS = new Set([
  'user_upload',
  'source_extract',
  'page_capture',
  'ai_generated',
  'stock_search',
  'derived',
]);

const REQUIREMENTS = new Set(['required', 'preferred', 'optional']);
const EVIDENCE_CLASSES = new Set([
  'direct_source',
  'user_supplied',
  'synthetic',
  'contextual',
  'derived_source',
]);
const MEDIA_TYPES = new Set(['image', 'video']);
const STATUSES = new Set(['ready', 'rejected']);

const PROFILE_BY_ORIGIN = {
  user_upload: {
    origin_detail: 'creative_input',
    provider: 'local',
    requirement: 'preferred',
    evidence_class: 'user_supplied',
  },
  source_extract: {
    origin_detail: 'article_embedded',
    requirement: 'optional',
    evidence_class: 'direct_source',
  },
  page_capture: {
    origin_detail: 'web_page',
    provider: 'chromium',
    requirement: 'optional',
    evidence_class: 'direct_source',
  },
  ai_generated: {
    origin_detail: 'scene_main_visual',
    requirement: 'optional',
    evidence_class: 'synthetic',
  },
  stock_search: {
    origin_detail: 'pexels',
    provider: 'pexels',
    requirement: 'optional',
    evidence_class: 'contextual',
  },
  derived: {
    requirement: 'optional',
    evidence_class: 'derived_source',
  },
};

const LEGACY_SOURCE_TO_ORIGIN = {
  upload: 'user_upload',
  article: 'source_extract',
  github: 'source_extract',
  github_readme: 'source_extract',
  readme: 'source_extract',
  generated: 'ai_generated',
  ai_generated: 'ai_generated',
  pexels: 'stock_search',
  search: 'stock_search',
};

const LEGACY_SOURCE_DETAIL = {
  github: 'github_readme',
  github_readme: 'github_readme',
  readme: 'github_readme',
};

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function invalidField(assetId, label) {
  throw new Error(`视觉素材 ${assetId} 的${label}无效。`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveInputOrigin(input, assetId) {
  const legacySource = safeString(input.source).toLowerCase();
  const legacyOrigin = legacySource ? LEGACY_SOURCE_TO_ORIGIN[legacySource] : '';
  const explicitOrigin = safeString(input.origin);
  if (legacySource && !legacyOrigin && !explicitOrigin) invalidField(assetId, '素材来源');
  if (legacyOrigin && explicitOrigin && legacyOrigin !== explicitOrigin) {
    throw new Error(`视觉素材 ${assetId} 的来源冲突。`);
  }
  return explicitOrigin || legacyOrigin;
}

function normalizeVisualAsset(input = {}) {
  if (!isPlainObject(input)) throw new Error('视觉素材必须是对象。');
  const id = safeString(input.id || input.asset_id);
  if (!id) throw new Error('视觉素材缺少 id。');

  const legacySource = safeString(input.source).toLowerCase();
  const origin = resolveInputOrigin(input, id);
  if (!ORIGINS.has(origin)) invalidField(id, '素材来源');
  const defaults = PROFILE_BY_ORIGIN[origin];

  const mediaType = safeString(input.media_type || input.type || 'image').toLowerCase();
  if (!MEDIA_TYPES.has(mediaType)) invalidField(id, '媒体类型');
  const requirement = safeString(input.requirement || defaults.requirement).toLowerCase();
  if (!REQUIREMENTS.has(requirement)) invalidField(id, '使用约束');
  const evidenceClass = safeString(input.evidence_class || defaults.evidence_class).toLowerCase();
  if (!EVIDENCE_CLASSES.has(evidenceClass)) invalidField(id, '证据类型');
  const status = safeString(input.status || 'ready').toLowerCase();
  if (!STATUSES.has(status)) invalidField(id, '素材状态');

  const parentAssetId = safeString(input.parent_asset_id);
  if (origin === 'derived' && !parentAssetId) {
    throw new Error(`衍生素材 ${id} 缺少父素材。`);
  }

  return {
    ...input,
    id,
    media_type: mediaType,
    origin,
    origin_detail: safeString(input.origin_detail || LEGACY_SOURCE_DETAIL[legacySource] || defaults.origin_detail),
    provider: safeString(input.provider || defaults.provider),
    requirement,
    evidence_class: evidenceClass,
    status,
    ...(parentAssetId ? { parent_asset_id: parentAssetId } : {}),
  };
}

function definedObject(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ''));
}

function normalizeMergedVisualAsset(input) {
  if (safeString(input.origin || input.source)) return normalizeVisualAsset(input);
  if (!safeString(input.path || input.local_path || input.url)) return normalizeVisualAsset(input);
  return normalizeVisualAsset({
    ...input,
    origin: 'source_extract',
    origin_detail: 'legacy_unclassified',
    requirement: 'optional',
    evidence_class: 'contextual',
  });
}

function mergeVisualAssets(...lists) {
  const order = [];
  const byId = new Map();
  for (const input of lists.flat()) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) continue;
    const id = safeString(input.id || input.asset_id);
    if (!id) normalizeVisualAsset(input);
    if (!byId.has(id)) order.push(id);
    const current = byId.get(id) || null;
    const incomingOrigin = (Object.prototype.hasOwnProperty.call(input, 'origin')
      || Object.prototype.hasOwnProperty.call(input, 'source'))
      ? resolveInputOrigin(input, id)
      : '';
    if (current && incomingOrigin && current.origin !== incomingOrigin) {
      throw new Error(`视觉素材 ${id} 的来源冲突。`);
    }
    const combined = { ...(current || {}), ...definedObject(input), id };
    byId.set(id, normalizeMergedVisualAsset(combined));
  }
  return order.map(id => byId.get(id));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function mergeDiagnostics(...lists) {
  const diagnostics = [];
  const seen = new Set();
  for (const item of lists.flat()) {
    const key = JSON.stringify(stableValue(item));
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(item);
  }
  return diagnostics;
}

function mergeVisualAssetContexts(base = {}, incoming = {}) {
  const baseDiagnostics = Array.isArray(base.diagnostics) ? base.diagnostics : [];
  const incomingDiagnostics = Array.isArray(incoming.diagnostics) ? incoming.diagnostics : [];
  return {
    ...base,
    ...incoming,
    status: safeString(incoming.status) || safeString(base.status) || 'empty',
    assets: mergeVisualAssets(base.assets || [], incoming.assets || []),
    diagnostics: mergeDiagnostics(baseDiagnostics, incomingDiagnostics),
  };
}

module.exports = {
  ORIGINS,
  REQUIREMENTS,
  EVIDENCE_CLASSES,
  MEDIA_TYPES,
  STATUSES,
  normalizeVisualAsset,
  mergeVisualAssets,
  mergeVisualAssetContexts,
};
