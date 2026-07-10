const fs = require('fs');
const path = require('path');
const defaultAiImageModel = require('../../ai/aiImageModel');
const defaultPlanner = require('../../creative/generatedImagePlanner');
const { resolveNodeSceneId } = require('./sceneGraphBinding');
const projectStore = require('./projectStore');
const { createDiagnostic } = require('./diagnostics');

const SIZE_BY_ASPECT_RATIO = {
  '9:16': '1600x2848',
  '16:9': '2848x1600',
};

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildGeneratedAsset({ file, plan, modelInfo, now }) {
  const prompt = safeString(plan.generation_prompt);
  return {
    id: `gen_${safeString(plan.scene_id)}`,
    type: 'image',
    source: 'generated',
    url: file.url,
    path: `assets/${file.file_name}`,
    frame_src: `../assets/${file.file_name}`,
    local_path: file.local_path,
    alt: prompt.slice(0, 120),
    mime: file.mime || 'image/png',
    bytes: file.bytes || 0,
    title: prompt.slice(0, 80),
    attribution: null,
    generation: {
      scene_id: plan.scene_id,
      prompt,
      model_info: modelInfo || null,
      generated_at: now || '',
    },
  };
}

function warningDiagnostic(code, userMessage, details = {}) {
  return createDiagnostic({
    code,
    stage: 'project',
    sub_stage: 'gen_images',
    user_message: userMessage,
    severity: 'warning',
    details,
  });
}

function generatedSceneIdSet(assets = []) {
  return new Set((Array.isArray(assets) ? assets : [])
    .filter(asset => asset?.source === 'generated')
    .map(asset => safeString(asset?.generation?.scene_id))
    .filter(Boolean));
}

function fallbackPlanForScene(scene = {}) {
  const prompt = safeString([scene?.visual_text?.headline, scene?.narration_text].filter(Boolean).join('，')).slice(0, 200);
  return prompt ? { scene_id: safeString(scene.id), generation_prompt: prompt } : null;
}

async function runGeneratedImagePhase({
  sceneSpec = {},
  creativeContext = {},
  projectDir,
  aspectRatio = '',
  requiredSceneIds = [],
  services = {},
  onProgress = null,
  now = '',
} = {}) {
  const base = { creativeContext, generated_count: 0, failures: [], diagnostics: [] };
  const isAssetFirst = creativeContext?.visual_strategy === 'asset_first';
  const planner = services.generatedImagePlanner || defaultPlanner;
  const aiImageModel = services.aiImageModel || defaultAiImageModel;
  const report = async message => {
    if (typeof onProgress !== 'function') return;
    try {
      await onProgress({ type: 'stage_progress', stage: 'project', sub_stage: 'gen_images', message });
    } catch {}
  };

  let configured = true;
  if (typeof aiImageModel.isConfigured === 'function') {
    try {
      configured = await aiImageModel.isConfigured({});
    } catch {
      configured = false;
    }
  }
  if (!configured) {
    if (!isAssetFirst) return { ...base, skipped: true, message: '未配置生图模型，跳过主视觉生成。' };
    await report('已开启图片/视频优先，但未配置生图模型，已跳过主视觉生成。');
    return {
      ...base,
      skipped: true,
      diagnostics: [warningDiagnostic(
        'generated_image_model_missing',
        '已开启图片/视频优先，但未配置生图模型，主视觉生成已跳过。',
      )],
      message: '未配置生图模型，主视觉生成已跳过。',
    };
  }

  const scenes = Array.isArray(sceneSpec?.scenes) ? sceneSpec.scenes : [];
  if (!projectDir || !scenes.length) {
    return { ...base, skipped: true, message: '缺少工程目录或 scene_spec，跳过主视觉生成。' };
  }
  const assetContext = objectOrEmpty(creativeContext.asset_context);
  const existingAssets = Array.isArray(assetContext.assets) ? assetContext.assets : [];
  const alreadyGenerated = generatedSceneIdSet(existingAssets);

  await report('正在规划主视觉素材...');
  let plan;
  try {
    plan = await planner.planGeneratedImages({
      sceneSpec,
      assetContext,
      maxScenes: isAssetFirst ? 4 : 2,
      services,
    });
  } catch (error) {
    return {
      ...base,
      diagnostics: [warningDiagnostic('generated_image_plan_failed', `主视觉规划异常：${error?.message || '未知错误'}，已降级到现有素材。`)],
      message: '主视觉规划异常，已降级到现有素材。',
    };
  }
  if (!plan.success) {
    return {
      ...base,
      diagnostics: [warningDiagnostic('generated_image_plan_failed', `主视觉规划失败：${plan.message || '未知原因'}，已降级到现有素材。`)],
      message: '主视觉规划失败，已降级到现有素材。',
    };
  }

  const pendingPlans = [];
  const pendingSceneIds = new Set();
  for (const item of plan.plans || []) {
    const sceneId = safeString(item?.scene_id);
    if (!sceneId || alreadyGenerated.has(sceneId) || pendingSceneIds.has(sceneId)) continue;
    pendingSceneIds.add(sceneId);
    pendingPlans.push({ ...item, scene_id: sceneId });
  }
  const sceneById = new Map(scenes.map(scene => [safeString(scene?.id), scene]));
  for (const sceneId of (Array.isArray(requiredSceneIds) ? requiredSceneIds.map(safeString) : [])) {
    if (!sceneId || alreadyGenerated.has(sceneId) || pendingSceneIds.has(sceneId)) continue;
    const fallback = fallbackPlanForScene(sceneById.get(sceneId));
    if (!fallback) continue;
    pendingSceneIds.add(sceneId);
    pendingPlans.push(fallback);
  }
  if (!pendingPlans.length) return { ...base, message: plan.message || '没有需要生图的场景。' };

  const size = SIZE_BY_ASPECT_RATIO[
    safeString(aspectRatio) || safeString(sceneSpec.aspect_ratio) || safeString(sceneSpec.aspectRatio)
  ] || '2K';
  const assetDir = path.join(projectDir, 'assets');
  const newAssets = [];
  const failures = [];
  const diagnostics = [];
  const pushFailure = (sceneId, msg) => {
    const message = safeString(msg) || '未知错误';
    failures.push({ scene_id: sceneId, message });
    diagnostics.push(warningDiagnostic(
      'generated_image_failed',
      `场景 ${sceneId} 主视觉生成失败：${message}`,
      { scene_id: sceneId },
    ));
  };

  for (let index = 0; index < pendingPlans.length; index += 1) {
    const item = pendingPlans[index];
    await report(`正在生成场景主视觉（${index + 1}/${pendingPlans.length}）...`);
    try {
      const generated = await aiImageModel.generateImages({
        prompt: item.generation_prompt,
        size,
        maxImages: 1,
        fetchImpl: services.fetchImpl,
      });
      if (!generated.success) {
        pushFailure(item.scene_id, generated.message);
        if (generated.configured === false) break;
        continue;
      }
      const downloaded = await aiImageModel.downloadGeneratedImages({
        images: (generated.images || []).slice(0, 1),
        assetDir,
        fetchImpl: services.fetchImpl,
        startIndex: alreadyGenerated.size + newAssets.length,
      });
      if (!downloaded.success || !downloaded.files.length) {
        pushFailure(item.scene_id, downloaded.failures?.[0]?.message || '图片下载失败。');
        continue;
      }
      newAssets.push(buildGeneratedAsset({
        file: downloaded.files[0],
        plan: item,
        modelInfo: generated.model_info,
        now,
      }));
    } catch (error) {
      pushFailure(item.scene_id, error?.message || '未知异常');
    }
  }

  const message = newAssets.length
    ? `已为 ${newAssets.length} 个场景生成主视觉图片${failures.length ? `，${failures.length} 个场景生成失败已降级` : ''}。`
    : `主视觉生成未产出图片${failures.length ? `：${failures[0].message}` : ''}，已降级到现有素材。`;
  await report(message);
  if (!newAssets.length) return { ...base, failures, diagnostics, message };
  return {
    creativeContext: {
      ...creativeContext,
      asset_context: {
        ...assetContext,
        status: 'ready',
        assets: [...newAssets, ...existingAssets],
      },
    },
    generated_count: newAssets.length,
    failures,
    diagnostics,
    message,
  };
}

function enforceAssetFirstRawHtmlRouting({ decisions, contentGraph, creativeContext } = {}) {
  if (!decisions) return decisions;
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  const assetById = new Map(assets
    .map(asset => [safeString(asset?.id || asset?.asset_id), asset])
    .filter(([id]) => id));
  if (!assetById.size) return decisions;
  const isMap = decisions instanceof Map;
  const isAssetFirst = creativeContext?.visual_strategy === 'asset_first';
  const getDecision = id => (isMap ? decisions.get(id) : decisions[id]);
  const setDecision = (id, value) => {
    if (isMap) decisions.set(id, value);
    else decisions[id] = value;
  };
  for (const node of (Array.isArray(contentGraph?.nodes) ? contentGraph.nodes : [])) {
    const refs = Array.isArray(node?.asset_refs) ? node.asset_refs : [];
    // asset_first 是用户显式要求素材必进画面，任何被引用素材都覆写；
    // 其他策略只有"必用"素材（AI 生成主视觉或显式 subject 用途）才强制 raw_html，
    // 装饰性/背景引用不覆写路由，保留 accepts_image 模板的 template_inputs 路径
    const needsRawHtml = refs.some(ref => {
      const asset = assetById.get(safeString(ref?.asset_id));
      if (!asset) return false;
      return isAssetFirst || asset.source === 'generated' || safeString(ref?.usage) === 'subject';
    });
    if (!needsRawHtml) continue;
    const sceneId = safeString(resolveNodeSceneId(node));
    const decision = sceneId ? getDecision(sceneId) : null;
    if (decision?.source_mode === 'template_inputs') {
      setDecision(sceneId, {
        ...decision,
        source_mode: 'raw_html',
        template_id: null,
        override_reason: 'required_asset_ref',
        fallback_from: 'template_inputs',
        fallback_reason: '该场景已选择视觉素材，模板变量路径无法保证素材进入画面，已改用自由 HTML。',
      });
    }
  }
  return decisions;
}

function hydrateGeneratedAssetsFromProject({ project, creativeContext = {}, projectDir } = {}) {
  const generated = (Array.isArray(project?.assets) ? project.assets : [])
    .filter(asset => asset?.source === 'generated' && safeString(asset?.generation?.scene_id));
  if (!generated.length || !projectDir) return creativeContext;
  const assetContext = objectOrEmpty(creativeContext.asset_context);
  const existing = Array.isArray(assetContext.assets) ? assetContext.assets : [];
  const existingIds = new Set(existing.map(asset => safeString(asset?.id)).filter(Boolean));
  const hydrated = [];
  for (const asset of generated) {
    const id = safeString(asset.id);
    if (!id || existingIds.has(id)) continue;
    const relative = safeString(asset.path);
    if (!relative) continue;
    let localPath;
    try {
      localPath = projectStore.resolveProjectPath(projectDir, relative);
    } catch {
      continue;
    }
    if (!fs.existsSync(localPath)) continue;
    hydrated.push({
      ...asset,
      local_path: localPath,
      frame_src: `../${relative}`,
    });
  }
  if (!hydrated.length) return creativeContext;
  return {
    ...creativeContext,
    asset_context: {
      ...assetContext,
      assets: [...hydrated, ...existing],
    },
  };
}

module.exports = {
  runGeneratedImagePhase,
  buildGeneratedAsset,
  enforceAssetFirstRawHtmlRouting,
  hydrateGeneratedAssetsFromProject,
};
