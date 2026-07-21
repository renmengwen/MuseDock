const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const aiModelConfig = require('../../ai/aiModelConfig');
const { normalizeFocusRegions, normalizeFocusAnalysis } = require('../../creative/visualAssetContract');
const { createDiagnostic } = require('./diagnostics');
const projectStore = require('./projectStore');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REGIONS = 20;
// 焦点分析缓存契约版本：focus_regions 结构或校验语义变化时必须同步 bump，否则旧缓存会被误判为可复用。
const FOCUS_ANALYSIS_CONTRACT_VERSION = 'focus-region-contract-v1';
// 焦点分析 prompt 版本：修改下方 vision prompt 内容时必须同步 bump，否则旧缓存会被误判为可复用。
const FOCUS_ANALYSIS_PROMPT_VERSION = 'focus-region-prompt-v1';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function labelText(value) {
  return text(value).replace(/\s+/g, ' ');
}

function selectedAssetIds(visualPlan = {}) {
  const ids = [];
  const seen = new Set();
  for (const beat of Array.isArray(visualPlan.beats) ? visualPlan.beats : []) {
    for (const shot of Array.isArray(beat?.visual_base?.shots) ? beat.visual_base.shots : []) {
      const id = text(shot?.asset_id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function regionId(prefix, label, region) {
  const hash = crypto.createHash('sha256')
    .update(`${label}\n${JSON.stringify(region)}`)
    .digest('hex')
    .slice(0, 16);
  return `${prefix}_${hash}`;
}

function uniqueLabels(items, labelOf) {
  const counts = new Map();
  const labeled = items.map(item => ({ item, label: labelText(labelOf(item)) }));
  for (const { label } of labeled) {
    if (!label) continue;
    const key = label.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return labeled.filter(({ label }) => label && counts.get(label.toLowerCase()) === 1);
}

function domFocusRegions(asset = {}) {
  const evidence = asset.page_capture_evidence;
  if (!evidence || evidence.version !== 1 || !Array.isArray(evidence.elements)) return [];
  const adapted = uniqueLabels(evidence.elements, element => element?.label || element?.text)
    .map(({ item, label }) => ({
      id: regionId('dom', label, item?.region),
      label,
      aliases: [],
      region: item?.region,
      method: 'dom',
      confidence_level: 'high',
      verification: {
        status: 'verified',
        method: 'dom_capture',
        evidence: '页面截图时采集的唯一可见 DOM 元素。',
        semantic: { status: 'verified', method: 'dom_capture', evidence: 'DOM 文本标签唯一。' },
        geometry: { status: 'verified', method: 'dom_capture', evidence: 'DOM 可见区域来自截图视口。' },
      },
    }));
  return normalizeFocusRegions(adapted).slice(0, MAX_REGIONS);
}

function parseVisionRegions(response = {}) {
  if (!response || response.success === false) throw new Error('model_failed');
  const raw = text(response.text || response.content);
  if (!raw || !raw.startsWith('{') || !raw.endsWith('}')) throw new Error('invalid_json');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).length !== 1 || !Array.isArray(data.regions)) throw new Error('invalid_shape');
  const adapted = uniqueLabels(data.regions, region => region?.label)
    .map(({ item, label }) => ({
      id: regionId('vision', label, item?.region),
      label,
      aliases: Array.isArray(item?.aliases) ? item.aliases : [],
      region: item?.region,
      ...(item?.focus_point === undefined ? {} : { focus_point: item.focus_point }),
      method: 'vision',
      confidence_level: text(item?.confidence_level).toLowerCase(),
      verification: {
        status: 'candidate',
        method: 'vision_model',
        evidence: '多模态模型返回的未人工复核候选区域。',
        semantic: { status: 'candidate', method: 'vision_model', evidence: '候选标签由多模态模型识别。' },
        geometry: { status: 'candidate', method: 'vision_model', evidence: '候选坐标由多模态模型估计。' },
      },
    }));
  return normalizeFocusRegions(adapted).slice(0, MAX_REGIONS);
}

function mimeFromAsset(asset = {}) {
  const declared = text(asset.mime).toLowerCase();
  if (declared.startsWith('image/')) return declared;
  const extension = path.extname(text(asset.path)).toLowerCase();
  return ({ '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' })[extension]
    || 'image/jpeg';
}

function localImagePath(asset, projectDir) {
  return projectStore.resolveProjectPath(projectDir, text(asset.path));
}

async function readProjectImage(asset, projectDir) {
  const filePath = localImagePath(asset, projectDir);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) throw new Error('invalid_file');
  const bytes = await fs.readFile(filePath);
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('invalid_image_bytes');
  return {
    bytes,
    hash: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function failureDiagnostic(assetId) {
  return createDiagnostic({
    code: 'focus_region_analysis_failed',
    stage: 'project',
    sub_stage: 'focus_region',
    severity: 'warning',
    user_message: `素材 ${assetId} 的焦点区域分析失败，已继续生成视频。`,
    details: { asset_id: assetId },
  });
}

// 分析身份 = 本次 vision 调用实际使用的 provider/model：优先取注入 model 自带标识（测试替身/自定义模型），
// 否则读 aiModelConfig 运行时配置（与 aiTextModel.callTextModel 的解析来源一致）。缺配置返回 null，
// 此时不写 focus_analysis 记录，也不做缓存匹配。
async function resolveAnalysisIdentity(model) {
  if (!model || typeof model.callTextModel !== 'function') return null;
  const declaredProvider = text(model.provider);
  const declaredModel = text(model.modelId || model.model_id);
  if (declaredProvider && declaredModel) return { provider: declaredProvider, model: declaredModel };
  try {
    const config = await aiModelConfig.getRuntimeConfig('text');
    const provider = text(config?.provider);
    const modelId = text(config?.modelId);
    if (config?.enabled === true && provider && modelId) return { provider, model: modelId };
  } catch {
    // 配置读取失败按缺配置处理。
  }
  return null;
}

// durable 缓存匹配：focus_analysis 四元组（bytes 哈希 + 契约版本 + provider/model + prompt 版本）全等才命中。
// 只有 status=empty 的记录会走到这里被复用：status=success 正常伴随非空 focus_regions（上方已跳过素材），
// 能进入 vision 分支说明 regions 已丢失，视为不一致状态重新分析，避免素材永远失去焦点区域。
function matchedFocusAnalysis(asset, imageHash, identity) {
  const record = normalizeFocusAnalysis(asset.focus_analysis);
  if (!record || record.status !== 'empty') return null;
  return record.content_sha256 === imageHash
    && record.contract_version === FOCUS_ANALYSIS_CONTRACT_VERSION
    && record.prompt_version === FOCUS_ANALYSIS_PROMPT_VERSION
    && record.provider === identity.provider
    && record.model === identity.model
    ? record : null;
}

// durable 记录双层落盘的 phase 侧：完整 run 依赖 projectAssetsFromCreativeContext 投影透传
// （buildMixedFrameProject 重建会覆盖本次写入），这里的直接落盘覆盖“run 在重建前中止”的窗口，
// 让下次 resume 仍能命中缓存。落盘尽力而为：project.json 缺失或写入失败只影响下次复用，不打断 workflow。
async function persistFocusAnalysisRecords(projectDir, records) {
  if (!records.size || !text(projectDir)) return;
  try {
    await projectStore.writeProjectJson(projectDir, current => {
      // 按 id 匹配依赖 project.assets 内 id 唯一（正式链路 mergeVisualAssets 按 id 去重保证）；
      // 若出现重复 id 条目，同一记录会写到每个同 id 条目上，语义等价、无副作用。
      for (const entry of (Array.isArray(current.assets) ? current.assets : [])) {
        const record = records.get(text(entry?.id || entry?.asset_id));
        if (record) entry.focus_analysis = { ...record };
      }
      return current;
    });
  } catch {
    // 尽力而为，失败时保持静默降级。
  }
}

async function visionFocusRegions({ asset, image, model, cache }) {
  const { bytes, hash } = image;
  if (!cache.has(hash)) {
    cache.set(hash, (async () => {
      if (!model || typeof model.callTextModel !== 'function') throw new Error('model_missing');
      const response = await model.callTextModel({
        audit: {
          agent: 'FocusRegionAgent',
          stage: 'focus_region',
          sub_stage: 'vision',
          asset_id: text(asset.id || asset.asset_id),
        },
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                '识别图片中适合镜头聚焦的语义区域，只返回严格 JSON object。',
                '格式：{"regions":[{"label":"区域名","aliases":[],"region":{"x":0,"y":0,"width":1,"height":1},"focus_point":{"x":0.5,"y":0.5},"confidence_level":"high|medium|low"}]}。',
                `最多返回 ${MAX_REGIONS} 个区域；坐标必须是 0 到 1 的归一化数值。`,
              ].join('\n'),
            },
            { type: 'image_url', image_url: { url: `data:${mimeFromAsset(asset)};base64,${bytes.toString('base64')}` } },
          ],
        }],
      });
      return parseVisionRegions(response);
    })());
  }
  return cache.get(hash);
}

async function runFocusRegionPhase({
  visualPlan = {}, creativeContext = {}, projectDir = '', target = {}, services = {},
} = {}) {
  const assetContext = creativeContext?.asset_context;
  const assets = Array.isArray(assetContext?.assets) ? assetContext.assets : [];
  if (!assets.length) return { creativeContext, diagnostics: [] };
  const firstAssetById = new Map();
  assets.forEach(asset => {
    const id = text(asset?.id || asset?.asset_id);
    if (id && !firstAssetById.has(id)) firstAssetById.set(id, asset);
  });
  const updates = new Map();
  const diagnostics = [];
  const cache = new Map();
  const durableRecords = new Map();
  // 身份解析懒执行且整个 run 只做一次：DOM 命中或未走 vision 的 run 不读模型配置。
  let identityPromise = null;
  const resolveIdentity = () => {
    if (!identityPromise) identityPromise = resolveAnalysisIdentity(services.aiTextModel);
    return identityPromise;
  };
  for (const id of selectedAssetIds(visualPlan)) {
    const asset = firstAssetById.get(id);
    if (!asset || text(asset.media_type || asset.type || 'image').toLowerCase() !== 'image') continue;
    if (normalizeFocusRegions(asset.focus_regions).length) continue;
    const evidence = asset.page_capture_evidence;
    const hasDomEvidence = evidence?.version === 1
      && Array.isArray(evidence.elements)
      && evidence.elements.length > 0;
    const visionEnabled = target.sourceImageAnalysisEnabled === true;
    let image = null;
    if (hasDomEvidence || visionEnabled) {
      try {
        image = await readProjectImage(asset, projectDir);
      } catch {
        diagnostics.push(failureDiagnostic(id));
        updates.set(asset, { ...asset, focus_regions: [] });
        continue;
      }
    }
    if (hasDomEvidence) {
      const evidenceHash = typeof evidence.image_sha256 === 'string' ? evidence.image_sha256 : '';
      const domBindingValid = /^[a-f0-9]{64}$/i.test(evidenceHash)
        && evidenceHash.toLowerCase() === image.hash;
      if (domBindingValid) {
        const domRegions = domFocusRegions(asset);
        if (domRegions.length) {
          updates.set(asset, { ...asset, focus_regions: domRegions });
          continue;
        }
      } else if (!visionEnabled) {
        diagnostics.push(failureDiagnostic(id));
        updates.set(asset, { ...asset, focus_regions: [] });
        continue;
      }
    }
    if (!visionEnabled) continue;
    const identity = await resolveIdentity();
    if (identity && matchedFocusAnalysis(asset, image.hash, identity)) {
      // durable 缓存命中（empty 结果）：跳过 vision 调用，维持 focus_regions=[]，不产生告警。
      updates.set(asset, { ...asset, focus_regions: [] });
      continue;
    }
    let regions = [];
    let analysisStatus = '';
    try {
      regions = await visionFocusRegions({
        asset,
        image,
        model: services.aiTextModel,
        cache,
      });
      // vision 成功但空结果是合法分析结论（status=empty），不再按失败告警；失败/超时/非 JSON 仍走 catch。
      analysisStatus = regions.length ? 'success' : 'empty';
    } catch {
      diagnostics.push(failureDiagnostic(id));
    }
    // 对 cache 命中结果二次 normalizeFocusRegions 是跨 asset 深拷贝隔离：同 bytes 素材不得共享
    // region 对象（有测试锁定该行为），不可当冗余删除。
    const nextAsset = { ...asset, focus_regions: normalizeFocusRegions(regions) };
    if (analysisStatus && identity) {
      // 只有分析成功（success/empty）才写 durable 记录；失败不写，保证跨 run 可重试。
      nextAsset.focus_analysis = {
        version: 1,
        content_sha256: image.hash,
        contract_version: FOCUS_ANALYSIS_CONTRACT_VERSION,
        provider: identity.provider,
        model: identity.model,
        prompt_version: FOCUS_ANALYSIS_PROMPT_VERSION,
        status: analysisStatus,
      };
      durableRecords.set(id, nextAsset.focus_analysis);
    }
    updates.set(asset, nextAsset);
  }
  await persistFocusAnalysisRecords(projectDir, durableRecords);
  if (!updates.size && !diagnostics.length) return { creativeContext, diagnostics };
  const nextAssetContext = {
    ...assetContext,
    assets: assets.map(asset => updates.get(asset) || asset),
    ...(diagnostics.length ? {
      diagnostics: [
        ...(Array.isArray(assetContext.diagnostics)
          ? assetContext.diagnostics
          : (assetContext.diagnostics ? [assetContext.diagnostics] : [])),
        ...diagnostics,
      ],
    } : {}),
  };
  return {
    creativeContext: { ...creativeContext, asset_context: nextAssetContext },
    diagnostics,
  };
}

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_REGIONS,
  FOCUS_ANALYSIS_CONTRACT_VERSION,
  FOCUS_ANALYSIS_PROMPT_VERSION,
  selectedAssetIds,
  runFocusRegionPhase,
};
