const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const projectStore = require('./projectStore');
const { createDiagnostic } = require('./diagnostics');
const { resolveNodeSceneId } = require('./sceneGraphBinding');
const { findFrameByAnyId } = require('./frameIdentity');
const { validateSceneImageSequenceDom } = require('./sceneImageSequenceDom');
const {
  assetReferenceTokens,
  extractVisualAssetReferences,
  htmlReferencesAsset,
  unregisteredVisualAssetReferences,
} = require('./frameHtmlInspection');
const {
  isGeneratedVisualAsset,
  mergeVisualAssetFormalFields,
} = require('../../creative/visualAssetContract');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

/**
 * 把已产出的生成图确定性地绑定到场景 asset_refs（返回克隆，不改入参）：
 * 仅用于路由输入（视觉计划），不回写原始 sceneSpec，
 * 以免影响 scene_spec_hash 的重试复用判定。绑定按 asset id 排序保证确定性。
 */
function bindGeneratedAssetsToSceneSpec(sceneSpec = {}, creativeContext = {}) {
  const assets = Array.isArray(creativeContext?.asset_context?.assets)
    ? creativeContext.asset_context.assets
    : [];
  const bySceneId = new Map();
  for (const asset of assets) {
    if (!isGeneratedVisualAsset(asset)) continue;
    const sceneId = String(asset?.generation?.scene_id || '').trim();
    const assetId = String(asset?.id || asset?.asset_id || '').trim();
    if (!sceneId || !assetId) continue;
    if (!bySceneId.has(sceneId)) bySceneId.set(sceneId, []);
    bySceneId.get(sceneId).push(assetId);
  }
  if (!bySceneId.size || !Array.isArray(sceneSpec?.scenes)) return sceneSpec;
  return {
    ...sceneSpec,
    scenes: sceneSpec.scenes.map(scene => {
      const sceneId = String(scene?.id || scene?.scene_id || '').trim();
      const assetIds = (bySceneId.get(sceneId) || []).slice().sort();
      if (!assetIds.length) return scene;
      const refs = Array.isArray(scene.asset_refs) ? [...scene.asset_refs] : [];
      for (const assetId of assetIds) {
        if (refs.some(ref => String(ref?.asset_id || ref?.id || '') === assetId)) continue;
        refs.push({ asset_id: assetId, usage: 'subject', reason: 'AI 生图主视觉' });
      }
      return { ...scene, asset_refs: refs };
    }),
  };
}

async function materializeCreativeContextAssets(projectDir, creativeContext = {}) {
  const assetContext = objectOrEmpty(creativeContext.asset_context);
  const assets = Array.isArray(assetContext.assets) ? assetContext.assets : [];
  if (!assets.length) return creativeContext;
  await fsp.mkdir(path.join(projectDir, 'assets'), { recursive: true });
  const nextAssets = [];
  const diagnostics = Array.isArray(assetContext.diagnostics) ? [...assetContext.diagnostics] : [];
  for (const asset of assets) {
    const sourcePath = String(asset.local_path || '').trim();
    const hasSourceFile = Boolean(sourcePath && fs.existsSync(sourcePath));
    const fallbackName = path.posix.basename(String(asset.path || `asset-${nextAssets.length + 1}.jpg`).replace(/\\/g, '/'));
    const fileName = fallbackName && !fallbackName.includes('..') ? fallbackName : `asset-${nextAssets.length + 1}.jpg`;
    const targetRelative = `assets/${fileName}`;
    const targetPath = projectStore.resolveProjectPath(projectDir, targetRelative);
    if (hasSourceFile) {
      await fsp.copyFile(sourcePath, targetPath).catch(error => {
        diagnostics.push(createDiagnostic({
          code: 'source_asset_materialize_failed',
          stage: 'project',
          sub_stage: 'assets',
          user_message: `来源图片 ${asset.id || asset.path || ''} 复制到 html-video 工程失败：${error.message}`,
          severity: 'warning',
        }));
      });
    }
    if (!fs.existsSync(targetPath)) {
      diagnostics.push(createDiagnostic({
        code: 'source_asset_materialize_missing',
        stage: 'project',
        sub_stage: 'assets',
        user_message: hasSourceFile
          ? `来源图片 ${asset.id || asset.path || ''} 未进入 html-video 工程。`
          : `来源图片 ${asset.id || asset.path || ''} 缺少本地文件，未进入 html-video 工程。`,
        severity: 'warning',
      }));
      continue;
    }
    nextAssets.push({
      ...asset,
      path: targetRelative,
      frame_src: `../${targetRelative}`,
    });
  }
  creativeContext.asset_context = {
    ...assetContext,
    assets: nextAssets,
    diagnostics,
  };
  return creativeContext;
}

function projectAssetsFromCreativeContext(creativeContext = {}) {
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  return assets.map((asset, index) => ({
    id: asset.id || `source_asset_${index + 1}`,
    type: asset.type || 'image',
    path: asset.path,
    source: asset.source || '',
    media_type: asset.media_type || asset.type || 'image',
    origin: asset.origin || '',
    origin_detail: asset.origin_detail || '',
    provider: asset.provider || '',
    requirement: asset.requirement || '',
    evidence_class: asset.evidence_class || '',
    status: asset.status || '',
    parent_asset_id: asset.parent_asset_id || '',
    url: asset.url || '',
    alt: asset.alt || '',
    attribution: asset.attribution || null,
    generation: asset.generation || null,
    mime: asset.mime || '',
    bytes: Number(asset.bytes) || 0,
    width: Number(asset.width) || 0,
    height: Number(asset.height) || 0,
    created_at: asset.created_at || '',
  })).filter(asset => asset.path);
}

function unregisteredImageReferences(frameHtmlEntries = [], assets = []) {
  const result = [];
  for (const frame of frameHtmlEntries) {
    for (const reference of unregisteredVisualAssetReferences(frame.visualReferences, assets)) {
      result.push({ frame_id: frame.id, reference });
    }
  }
  return result;
}

function updateRuntimePolicyViolations(report = {}, frameId = '', violations = []) {
  const id = String(frameId || '').trim();
  const retained = (Array.isArray(report.runtime_policy_violations) ? report.runtime_policy_violations : [])
    .filter(item => String(item?.frame_id || '') !== id);
  const nextViolations = Array.isArray(violations) ? violations : [];
  const runtimePolicyViolations = nextViolations.length
    ? [...retained, { frame_id: id, code: 'runtime_visual_asset_policy_violation', violations: nextViolations }]
    : retained;
  const runtimeUnregistered = runtimePolicyViolations.flatMap(item => item.violations || [])
    .filter(item => item?.kind === 'unregistered_local_image')
    .map(item => ({ frame_id: item.frame_id || id, reference: item.target || '' }));
  return {
    ...report,
    runtime_policy_violations: runtimePolicyViolations,
    unregistered_image_references: [
      ...(Array.isArray(report.unregistered_image_references) ? report.unregistered_image_references : [])
        .filter(item => item?.source !== 'runtime'),
      ...runtimeUnregistered.map(item => ({ ...item, source: 'runtime' })),
    ],
  };
}

function readFrameHtml(projectDir, frame = {}) {
  const htmlPath = firstNonEmptyString(frame.html_path, frame.htmlPath);
  if (!htmlPath) return '';
  try {
    const absolutePath = projectStore.resolveProjectPath(projectDir, htmlPath);
    if (!fs.existsSync(absolutePath)) return '';
    return fs.readFileSync(absolutePath, 'utf8').replace(/\\/g, '/');
  } catch {
    return '';
  }
}

function mergedTrackableAssets(project = {}, creativeContext = {}) {
  const order = [];
  const byId = new Map();
  const put = (asset, formalOnly = false) => {
    const id = firstNonEmptyString(asset?.id, asset?.asset_id);
    if (!id) return;
    if (!byId.has(id)) {
      order.push(id);
      byId.set(id, { ...asset, id });
      return;
    }
    const current = byId.get(id);
    const merged = formalOnly
      ? mergeVisualAssetFormalFields({ ...asset, ...current, id }, asset)
      : { ...current, ...asset, id };
    byId.set(id, merged);
  };
  (Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : []).forEach(asset => put(asset));
  (Array.isArray(project?.assets) ? project.assets : []).forEach(asset => put(asset, true));
  return order.map(id => byId.get(id));
}

function requiredAssetRefsById(project = {}, assets = []) {
  const byId = new Map();
  const ensure = (assetId, sceneId, usage) => {
    if (!assetId) return;
    const current = byId.get(assetId) || { asset_id: assetId, expected_in_frames: [], usages: [] };
    if (sceneId && !current.expected_in_frames.includes(sceneId)) current.expected_in_frames.push(sceneId);
    if (usage && !current.usages.includes(usage)) current.usages.push(usage);
    byId.set(assetId, current);
  };
  for (const asset of assets) {
    if (asset?.requirement !== 'required') continue;
    const assetId = firstNonEmptyString(asset.id, asset.asset_id);
    ensure(assetId);
    if (isGeneratedVisualAsset(asset)) {
      ensure(assetId, firstNonEmptyString(asset.generation?.scene_id), 'generated');
    }
  }
  for (const node of (Array.isArray(project?.content_graph?.nodes) ? project.content_graph.nodes : [])) {
    const sceneId = firstNonEmptyString(resolveNodeSceneId(node), node?.id);
    for (const ref of (Array.isArray(node?.asset_refs) ? node.asset_refs : [])) {
      const assetId = firstNonEmptyString(ref?.asset_id, ref?.id);
      if (!byId.has(assetId)) continue;
      ensure(assetId, sceneId, firstNonEmptyString(ref?.usage));
    }
  }
  return byId;
}

function resolveFrameNode(frame = {}, nodes = []) {
  const graphNodeId = firstNonEmptyString(frame.graph_node_id);
  if (graphNodeId) {
    const exact = nodes.filter(node => firstNonEmptyString(node?.id) === graphNodeId);
    return exact.length === 1 ? exact[0] : null;
  }
  const frameProject = { frames: [frame] };
  const compatible = nodes.filter(node => [node?.id, resolveNodeSceneId(node)]
    .some(id => id && findFrameByAnyId(frameProject, id)));
  return compatible.length === 1 ? compatible[0] : null;
}

function buildAssetUsageReport({ project = {}, projectDir = '', creativeContext = {} } = {}) {
  const priorRuntimeViolations = Array.isArray(project?.asset_usage_report?.runtime_policy_violations)
    ? project.asset_usage_report.runtime_policy_violations
    : [];
  const runtimeImageReferences = priorRuntimeViolations.flatMap(entry => (entry?.violations || []))
    .filter(item => item?.kind === 'unregistered_local_image')
    .map(item => ({ frame_id: item.frame_id || '', reference: item.target || '', source: 'runtime' }));
  const assets = mergedTrackableAssets(project, creativeContext);
  const frames = Array.isArray(project.frames) ? project.frames : [];
  const nodes = Array.isArray(project?.content_graph?.nodes) ? project.content_graph.nodes : [];
  const validationContext = {
    ...creativeContext,
    asset_context: {
      ...objectOrEmpty(creativeContext?.asset_context),
      assets: assets.map(asset => {
        const assetPath = String(asset.path || '').trim().replace(/\\/g, '/');
        return { ...asset, frame_src: asset.frame_src || (assetPath ? `../${assetPath}` : '') };
      }),
    },
  };
  const frameHtmlEntries = frames.map(frame => {
    const html = readFrameHtml(projectDir, frame);
    const visualReferences = extractVisualAssetReferences(html);
    const node = resolveFrameNode(frame, nodes);
    const validation = node ? validateSceneImageSequenceDom(html, { node, creativeContext: validationContext }) : null;
    return {
      id: firstNonEmptyString(frame.id, frame.beat_id, frame.scene_id),
      references: new Set(visualReferences.map(item => item.reference)),
      visualReferences,
      contract: validation?.success ? validation.contract || null : null,
      legacy_reference_fallback: !html.includes('data-hv-image-sequence')
        && (!validation || (validation.success && !validation.contract)),
    };
  });
  const shotUsagesByAsset = new Map();
  for (const frame of frameHtmlEntries) {
    if (!frame.id || !frame.contract) continue;
    for (const shot of frame.contract.shots) {
      const visibleDurationSec = Math.round((Number(shot.end_sec) - Number(shot.start_sec)) * 1000) / 1000;
      if (!Number.isFinite(visibleDurationSec) || visibleDurationSec <= 0) continue;
      const assetId = firstNonEmptyString(shot.asset_id);
      if (!assetId) continue;
      if (!shotUsagesByAsset.has(assetId)) shotUsagesByAsset.set(assetId, []);
      shotUsagesByAsset.get(assetId).push({
        frame_id: frame.id,
        scene_id: frame.contract.scene_id,
        shot_id: shot.id,
        caption_ids: shot.caption_ids,
        role: shot.role,
        sequence_mode: frame.contract.mode,
        visible_duration_sec: visibleDurationSec,
      });
    }
  }
  const unregisteredVisualReferences = unregisteredImageReferences(frameHtmlEntries, assets);
  if (!assets.length) {
    return {
      status: 'empty',
      assets: [],
      used_asset_ids: [],
      unused_asset_ids: [],
      required_asset_ids: [],
      missing_required_asset_ids: [],
      unregistered_image_references: [...unregisteredVisualReferences, ...runtimeImageReferences],
      runtime_policy_violations: priorRuntimeViolations,
      summary: '没有可追踪的视觉素材。',
    };
  }
  const requiredById = requiredAssetRefsById(project, assets);
  const reportAssets = assets.map((asset, index) => {
    const assetId = firstNonEmptyString(asset.id, `asset_${index + 1}`);
    const tokens = assetReferenceTokens(asset);
    const required = requiredById.get(assetId) || null;
    const shotUsages = shotUsagesByAsset.get(assetId) || [];
    const shotFrameIds = new Set(shotUsages.map(item => item.frame_id));
    const legacyFallback = !required && ['', 'preferred', 'optional'].includes(String(asset.requirement || '').trim());
    const seenFrames = new Set();
    const usedInFrames = frameHtmlEntries.filter(frame => {
      const used = frame.id && (shotFrameIds.has(frame.id) || (
        legacyFallback
        && frame.legacy_reference_fallback
        && htmlReferencesAsset(frame.references, tokens)
      ));
      if (!used || seenFrames.has(frame.id)) return false;
      seenFrames.add(frame.id);
      return true;
    }).map(frame => frame.id);
    const used = shotUsages.length > 0 || (legacyFallback && usedInFrames.length > 0);
    return {
      asset_id: assetId,
      path: asset.path || '',
      frame_src: asset.frame_src || '',
      source: asset.source || '',
      media_type: asset.media_type || asset.type || 'image',
      origin: asset.origin || '',
      origin_detail: asset.origin_detail || '',
      provider: asset.provider || '',
      requirement: asset.requirement || '',
      evidence_class: asset.evidence_class || '',
      status: asset.status || '',
      parent_asset_id: asset.parent_asset_id || '',
      required: Boolean(required),
      expected_in_frames: required?.expected_in_frames || [],
      usage: required?.usages || [],
      shot_usages: shotUsages,
      used,
      used_in_frames: usedInFrames,
      usage_count: shotUsages.length,
    };
  });
  const usedAssetIds = reportAssets.filter(asset => asset.used).map(asset => asset.asset_id);
  const unusedAssetIds = reportAssets.filter(asset => !asset.used).map(asset => asset.asset_id);
  const requiredAssetIds = reportAssets.filter(asset => asset.required).map(asset => asset.asset_id);
  const missingRequiredAssetIds = reportAssets
    .filter(asset => asset.required && !asset.used)
    .map(asset => asset.asset_id);
  const report = {
    status: 'ready',
    assets: reportAssets,
    used_asset_ids: usedAssetIds,
    unused_asset_ids: unusedAssetIds,
    required_asset_ids: requiredAssetIds,
    missing_required_asset_ids: missingRequiredAssetIds,
    unregistered_image_references: [...unregisteredVisualReferences, ...runtimeImageReferences],
    summary: missingRequiredAssetIds.length
      ? `有 ${missingRequiredAssetIds.length} 个必用视觉素材未进入最终 HTML。`
      : (usedAssetIds.length
        ? `最终 HTML 使用了 ${usedAssetIds.length} 张视觉素材。`
        : '最终 HTML 未引用已准备的视觉素材。'),
  };
  report.runtime_policy_violations = priorRuntimeViolations;
  return report;
}

async function attachAssetUsageReport({ project = {}, projectDir = '', creativeContext = {} } = {}) {
  const assetUsageReport = buildAssetUsageReport({ project, projectDir, creativeContext });
  project.asset_usage_report = assetUsageReport;
  if (creativeContext.asset_context) creativeContext.asset_context.asset_usage_report = assetUsageReport;
  return projectDir ? projectStore.saveProject(projectDir, project) : project;
}

function missingRequiredAssetIds(project = {}) {
  return Array.isArray(project?.asset_usage_report?.missing_required_asset_ids)
    ? project.asset_usage_report.missing_required_asset_ids.filter(Boolean)
    : [];
}

module.exports = {
  objectOrEmpty,
  firstNonEmptyString,
  bindGeneratedAssetsToSceneSpec,
  materializeCreativeContextAssets,
  projectAssetsFromCreativeContext,
  buildAssetUsageReport,
  attachAssetUsageReport,
  missingRequiredAssetIds,
  updateRuntimePolicyViolations,
};
