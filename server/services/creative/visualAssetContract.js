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
const FOCUS_METHODS = new Set(['manual', 'dom', 'ocr', 'detector', 'vision', 'generation_metadata']);
const FOCUS_VERIFICATION_STATUSES = new Set(['verified', 'candidate', 'rejected']);
const FOCUS_CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);
const FOCUS_ANALYSIS_VERSION = 1;
const FOCUS_ANALYSIS_STATUSES = new Set(['success', 'empty']);
// focus_analysis 是跨 run 复用 vision 结果的缓存凭据：只允许这 7 个字段，缺一多一都整体丢弃。
const FOCUS_ANALYSIS_FIELDS = [
  'version',
  'content_sha256',
  'contract_version',
  'provider',
  'model',
  'prompt_version',
  'status',
];
const FORMAL_FIELDS = [
  'media_type',
  'origin',
  'origin_detail',
  'provider',
  'requirement',
  'evidence_class',
  'status',
  'parent_asset_id',
];
const FORMAL_ENUMS = {
  media_type: MEDIA_TYPES,
  origin: ORIGINS,
  requirement: REQUIREMENTS,
  evidence_class: EVIDENCE_CLASSES,
  status: STATUSES,
};

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

function isGeneratedVisualAsset(asset = {}) {
  const origin = safeString(asset.origin);
  return origin ? origin === 'ai_generated' : safeString(asset.source) === 'generated';
}

function mergeVisualAssetFormalFields(runtime = {}, formal = {}) {
  const merged = { ...runtime };
  for (const field of FORMAL_FIELDS) {
    const value = safeString(formal[field]);
    if (!value) continue;
    const allowed = FORMAL_ENUMS[field];
    const normalized = field === 'origin' ? value : value.toLowerCase();
    if (!allowed || allowed.has(normalized)) merged[field] = normalized;
  }
  const origin = safeString(merged.origin);
  const legacySource = safeString(merged.source).toLowerCase();
  if (ORIGINS.has(origin) && LEGACY_SOURCE_TO_ORIGIN[legacySource]
    && LEGACY_SOURCE_TO_ORIGIN[legacySource] !== origin) {
    delete merged.source;
  }
  return merged;
}

function invalidField(assetId, label) {
  throw new Error(`视觉素材 ${assetId} 的${label}无效。`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function validUnitNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function normalizeFocusVerificationAxis(input) {
  if (!isPlainObject(input) || Object.keys(input).length !== 3
    || !hasOwn(input, 'status') || !hasOwn(input, 'method') || !hasOwn(input, 'evidence')
    || typeof input.method !== 'string' || typeof input.evidence !== 'string') return null;
  const status = safeString(input.status).toLowerCase();
  if (!FOCUS_VERIFICATION_STATUSES.has(status)) return null;
  return { status, method: safeString(input.method), evidence: safeString(input.evidence) };
}

function normalizeFocusRegion(input) {
  if (!isPlainObject(input)) return null;
  const id = safeString(input.id);
  const label = safeString(input.label);
  const method = safeString(input.method).toLowerCase();
  const sourceRegion = input.region;
  const verification = input.verification;
  if (!id || !label || !FOCUS_METHODS.has(method) || !isPlainObject(sourceRegion) || !isPlainObject(verification)) return null;

  const { x, y, width, height } = sourceRegion;
  if (!validUnitNumber(x) || !validUnitNumber(y)
    || !validUnitNumber(width) || !validUnitNumber(height)
    || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null;

  const hasSemantic = hasOwn(verification, 'semantic');
  const hasGeometry = hasOwn(verification, 'geometry');
  const semantic = hasSemantic ? normalizeFocusVerificationAxis(verification.semantic) : null;
  const geometry = hasGeometry ? normalizeFocusVerificationAxis(verification.geometry) : null;
  if (hasSemantic !== hasGeometry || (hasSemantic && (!semantic || !geometry))) return null;
  let status = safeString(verification.status).toLowerCase();
  if (hasSemantic) {
    status = [semantic.status, geometry.status].includes('rejected')
      ? 'rejected'
      : semantic.status === 'verified' && geometry.status === 'verified' ? 'verified' : 'candidate';
  } else if (!FOCUS_VERIFICATION_STATUSES.has(status)) return null;
  const focusPoint = hasOwn(input, 'focus_point') && input.focus_point !== undefined
    ? input.focus_point
    : { x: x + width / 2, y: y + height / 2 };
  if (!isPlainObject(focusPoint)
    || !validUnitNumber(focusPoint.x) || !validUnitNumber(focusPoint.y)
    || focusPoint.x < x || focusPoint.x > x + width
    || focusPoint.y < y || focusPoint.y > y + height) return null;

  const aliases = [];
  const seenAliases = new Set();
  for (const value of (Array.isArray(input.aliases) ? input.aliases : [])) {
    const alias = safeString(value);
    const key = alias.toLowerCase();
    if (!alias || seenAliases.has(key)) continue;
    seenAliases.add(key);
    aliases.push(alias);
  }
  const confidence = safeString(input.confidence_level).toLowerCase();
  let trustLevel = 'C';
  if (status === 'rejected') trustLevel = 'D';
  else if (status === 'verified' && ['manual', 'dom', 'generation_metadata'].includes(method)) trustLevel = 'A';
  else if (status === 'verified' && (['ocr', 'detector'].includes(method)
    || (method === 'vision' && safeString(verification.method).toLowerCase() === 'crop_review'))) trustLevel = 'B';

  return {
    id,
    label,
    aliases,
    region: { x, y, width, height },
    focus_point: { x: focusPoint.x, y: focusPoint.y },
    method,
    confidence_level: FOCUS_CONFIDENCE_LEVELS.has(confidence) ? confidence : 'low',
    verification: {
      status,
      method: safeString(verification.method),
      evidence: safeString(verification.evidence),
      ...(hasSemantic ? { semantic, geometry } : {}),
    },
    trust_level: trustLevel,
  };
}

function normalizeFocusRegions(input) {
  if (!Array.isArray(input)) return [];
  const counts = new Map();
  for (const region of input) {
    const id = isPlainObject(region) ? safeString(region.id) : '';
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return input
    .filter(region => counts.get(isPlainObject(region) ? safeString(region.id) : '') === 1)
    .map(normalizeFocusRegion)
    .filter(Boolean);
}

// 规范化 focus_analysis 缓存记录：非法结构一律返回 null（安全丢弃），幂等且总是返回新对象。
function normalizeFocusAnalysis(input) {
  if (!isPlainObject(input)) return null;
  if (Object.keys(input).length !== FOCUS_ANALYSIS_FIELDS.length
    || FOCUS_ANALYSIS_FIELDS.some(field => !hasOwn(input, field))) return null;
  if (input.version !== FOCUS_ANALYSIS_VERSION) return null;
  const contentSha256 = safeString(input.content_sha256).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentSha256)) return null;
  const contractVersion = safeString(input.contract_version);
  const provider = safeString(input.provider);
  const model = safeString(input.model);
  const promptVersion = safeString(input.prompt_version);
  const status = safeString(input.status).toLowerCase();
  if (!contractVersion || !provider || !model || !promptVersion
    || !FOCUS_ANALYSIS_STATUSES.has(status)) return null;
  return {
    version: FOCUS_ANALYSIS_VERSION,
    content_sha256: contentSha256,
    contract_version: contractVersion,
    provider,
    model,
    prompt_version: promptVersion,
    status,
  };
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

  const normalized = {
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
  if (hasOwn(input, 'focus_regions')) normalized.focus_regions = normalizeFocusRegions(input.focus_regions);
  if (hasOwn(input, 'focus_analysis')) {
    const focusAnalysis = normalizeFocusAnalysis(input.focus_analysis);
    // ...input 会把非法记录带进来，必须显式删除，保证输出不含该字段。
    if (focusAnalysis) normalized.focus_analysis = focusAnalysis;
    else delete normalized.focus_analysis;
  }
  return normalized;
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
  normalizeFocusRegions,
  normalizeFocusAnalysis,
  isGeneratedVisualAsset,
  mergeVisualAssetFormalFields,
  normalizeVisualAsset,
  mergeVisualAssets,
  mergeVisualAssetContexts,
};
