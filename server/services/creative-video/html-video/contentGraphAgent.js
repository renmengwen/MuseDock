const contentGraph = require('./contentGraph');
const { createDiagnostic } = require('./diagnostics');

const TRUNCATION_MARKER = '...（已截断）';

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compactText(value, maxLength = 1200) {
  let raw = value;
  if (Array.isArray(value)) {
    raw = value.map(item => compactText(item, 120)).filter(Boolean).join(' / ');
  } else if (value && typeof value === 'object') {
    raw = value.title || value.label || value.name || value.text || value.headline || value.summary || value.description || '';
  }
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text || /^\[object Object\]$/i.test(text)) return '';
  if (text.length <= maxLength) return text;
  if (maxLength <= TRUNCATION_MARKER.length) {
    return TRUNCATION_MARKER.slice(0, maxLength);
  }
  return `${text.slice(0, maxLength - TRUNCATION_MARKER.length).trimEnd()}${TRUNCATION_MARKER}`;
}

function summarizeCreativeContextForPrompt(creativeContext = {}) {
  const input = objectOrEmpty(creativeContext.input);
  const sourceContext = objectOrEmpty(creativeContext.source_context);
  const assetContext = objectOrEmpty(creativeContext.asset_context);
  const brief = objectOrEmpty(creativeContext.brief);
  const audio = objectOrEmpty(creativeContext.audio);
  const lines = [];
  const pairs = [
    ['原始标题', input.title],
    ['原始正文', input.raw_text || input.text || input.content],
    ['来源摘要', sourceContext.summary],
    ['来源全文', sourceContext.transcript || sourceContext.markdown || sourceContext.content],
    ['创作摘要', brief.summary],
    ['评论摘要', creativeContext.comments_summary || creativeContext.comment_summary || creativeContext.comment_insights],
    ['二级评论摘要', creativeContext.secondary_comments_summary || creativeContext.reply_summary],
    ['旁白文本', audio.narration_text || audio.text || creativeContext.narration_text],
  ];
  pairs.forEach(([label, value]) => {
    const maxLength = label.includes('全文') ? 2400 : label.includes('正文') ? 1600 : 700;
    const text = compactText(value, maxLength);
    if (text) lines.push(`${label}：${text}`);
  });
  const allAssets = Array.isArray(assetContext.assets) ? assetContext.assets : [];
  const generatedAssets = allAssets.filter(asset => asset.source === 'generated');
  const nonGenerated = allAssets.filter(asset => asset.source !== 'generated');
  const articleFirst = [
    ...nonGenerated.filter(asset => asset.source !== 'search'),
    ...nonGenerated.filter(asset => asset.source === 'search'),
  ];
  const assets = [
    ...generatedAssets.slice(0, 4),
    ...articleFirst.slice(0, Math.max(0, 8 - Math.min(generatedAssets.length, 4))),
  ];
  if (assets.length) {
    const usableAssets = assets.filter(isAssetUsableForFrames);
    const blockedAssets = assets.filter(asset => !isAssetUsableForFrames(asset));
    lines.push('可用图片素材：');
    usableAssets.forEach((asset, index) => {
      const src = compactText(asset.frame_src || asset.path, 160);
      const label = compactText(asset.alt || asset.title || asset.url || `图片${index + 1}`, 120);
      const source = compactText(asset.source || 'article', 30);
      const generatedFor = asset.source === 'generated' && asset.generation?.scene_id
        ? `；为场景 ${compactText(asset.generation.scene_id, 80)} 生成；不是来源证据`
        : '';
      const analysis = objectOrEmpty(asset.image_analysis);
      const analysisParts = [
        ['类型', analysis.visual_type],
        ['说明', analysis.summary],
        ['建议用法', analysis.best_usage],
        ['展示方式', analysis.contains_text === true ? '完整展示/contain' : analysis.fit],
        ['should_use', analysis.should_use === true ? 'true' : analysis.should_use === false ? 'false' : ''],
        ['avoid_reason', analysis.avoid_reason],
      ].map(([key, value]) => {
        const text = compactText(value, 120);
        return text ? `${key}=${text}` : '';
      }).filter(Boolean);
      const analysisText = analysisParts.length ? `；图片分析：${analysisParts.join('；')}` : '';
      if (src) lines.push(`- ${index + 1}. ${label}；asset_id=${compactText(asset.id, 80)}；来源=${source}${generatedFor}；HTML引用=${src}${analysisText}`);
    });
    if (!usableAssets.length) lines.push('- 无适合直接进入成片的图片。');
    if (blockedAssets.length) {
      const blockedText = blockedAssets
        .map(asset => `${compactText(asset.id || asset.asset_id, 80)}：${compactText(asset.image_analysis?.avoid_reason || asset.image_analysis?.summary || '图片分析建议不要用于成片', 120)}`)
        .filter(Boolean)
        .join('；');
      if (blockedText) lines.push(`不建议用于成片的图片素材：${blockedText}`);
    }
    lines.push('图片使用规则：图片适合增强来源证据、截图展示或解释效果时优先使用；每个 node 最多引用 1 张图片；不适合当前叙事时可以不用。优先使用 article 来源图片；generated 生成图是可用主视觉素材但不是来源证据；search/Pexels 图片只作补充背景或氛围图，不要当来源证据；不要做纯图片轮播；含文字的文章截图必须完整展示，使用 object-fit: contain；图片应与关键词、字幕、数据卡或讲解节点混排。');
  }
  return lines.join('\n');
}

function isAssetUsableForFrames(asset = {}) {
  return objectOrEmpty(asset.image_analysis).should_use !== false;
}

function sceneIdsFromSpec(sceneSpec = {}) {
  return (Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [])
    .map(scene => String(scene?.id || '').trim())
    .filter(Boolean);
}

function buildContentGraphPrompt({ sceneSpec = {}, creativeContext = {}, target = {} } = {}) {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const expectedSceneIds = sceneIdsFromSpec(sceneSpec);
  const targetDuration = target.duration_sec || target.durationSec || target.duration || sceneSpec.target_duration_sec || '';
  const aspectRatio = target.aspect_ratio || target.aspectRatio || sceneSpec.aspect_ratio || sceneSpec.aspectRatio || '';
  const language = target.language || target.lang || 'zh-CN';
  const isSourceUrl = creativeContext?.input?.mode === 'source_url'
    || creativeContext?.source_context?.kind === 'source_url';
  const isAssetFirst = creativeContext?.visual_strategy === 'asset_first'
    || target?.visual_strategy === 'asset_first';
  const sourceUrlGroundingRequirements = isSourceUrl ? [
    '- 如果源素材来自 source_url，SOURCE MATERIAL 是视频真正主题，不是装饰信息。',
    '- 每个节点都必须引用或改写来源材料里的具体事实、名字、数字、产品、项目能力、术语或主张。',
    '- 禁止输出可套用到任何文章或任何仓库的泛泛句子。',
    '- GitHub repo 只能基于 README、仓库描述、语言、目录结构和 topics，不要假装读过全量源码。',
    '- 如果 SOURCE MATERIAL 提供可用图片素材，内容图可以在适合的节点使用 showcase、图文卡、证据截图或对比说明；不适合当前叙事时不要硬塞图片，也不要把图片当作视频主题本身。',
  ] : [];
  const assetFirstRequirements = isAssetFirst ? [
    '- 当前为素材主导（asset_first）模式：图片/视频素材负责画面主体和质感，HTML 动画负责重点标注、拆解、强调和数据表达。',
    '- 优先级：article 来源图 > generated 生成图 > search/Pexels 图。来源图优先做证据和主体；generated 图片是为具体场景生成的主视觉，usage 应为 subject；search 图片只能做 background。',
    '- 每个具象叙事场景尽量绑定一张主视觉图片（usage=subject 或 evidence）；数据、流程、结构类场景可以不绑图片，由 HTML 动画做主体。',
    '- generated 图片的 generation.scene_id 标明了它为哪个场景生成，优先绑定到对应场景。',
  ] : [];
  return [
    '你是 html-video 的 content graph 规划器。请只输出严格 JSON，不要输出 Markdown、解释或额外文本。',
    '',
    'SOURCE MATERIAL / 源素材上下文：',
    summarizeCreativeContextForPrompt(creativeContext) || '（无）',
    '',
    'scene_spec：',
    JSON.stringify({
      title: sceneSpec.title || '',
      aspect_ratio: sceneSpec.aspect_ratio || sceneSpec.aspectRatio || '',
      target_duration_sec: sceneSpec.target_duration_sec || sceneSpec.targetDurationSec || '',
      scenes,
    }, null, 2),
    '',
    `目标：aspect ratio=${aspectRatio || '未指定'}，duration=${targetDuration || '未指定'}，language=${language}。`,
    '',
    '输出要求：',
    '- 只输出一个 JSON 对象，必须包含 synopsis、nodes、edges。',
    '- 每个 intended frame 对应一个 node，nodes 必须按成片叙事顺序排列。',
    `- nodes.length 必须严格等于 scene_spec.scenes.length：${scenes.length}。`,
    `- nodes 的 id 必须逐一严格等于 scene_spec.scenes 的 id：${expectedSceneIds.join(' -> ') || '（无）'}。`,
    '- 禁止新增、删除、合并、拆分或重排序 scene_spec.scenes。',
    '- 每个 node 必须包含 id、kind、label、durationSec，并且根据 kind 包含 text 或 data。',
    isAssetFirst
      ? '- 每个 node 可以输出 asset_refs，每帧最多 1 张，字段为 asset_id、usage、reason；usage 取值 subject|showcase|evidence|background。'
      : '- 每个 node 可以输出 asset_refs，每帧最多 1 张，字段为 asset_id、usage、reason；只把 article 图片当来源证据；generated 生成图是为本片生成的可用素材，适合的场景可以绑定为配图或主视觉（不强制，HTML 动画仍是表达主体），但它不是来源证据；search/Pexels 只作补充。',
    ...assetFirstRequirements,
    '- kind 只能是 text、data、entity；优先使用 text 和 data。',
    '- data node 的 data 必须形如 {"title":"string","unit":"optional shared unit","items":[{"label":"string","value":123}]}。',
    '- 数据帧必须使用可比较的同一单位，数值要合理；不能把不同口径的数据强行放进同一组。',
    '- 必须保留源素材事实，不要编造来源中没有的精确数字、机构、时间、版本、功能或结论。',
    ...sourceUrlGroundingRequirements,
    '- 不要让对象值变成字符串 [object Object]；对象必须提取有意义的 label/text/value。',
    '- 中文素材默认生成中文可见文本，技术名词和品牌名可保留英文。',
    '',
    'JSON schema 草案：',
    JSON.stringify({
      synopsis: 'string',
      nodes: [
        {
          id: 'scene_01',
          kind: 'text|data|entity',
          label: 'string',
          durationSec: 3,
          text: 'required for text/entity when no data',
          data: {
            title: 'string',
            unit: 'optional shared unit',
            items: [{ label: 'string', value: 123 }],
          },
          asset_refs: [{ asset_id: 'article_01', usage: 'subject|showcase|evidence|background', reason: 'string' }],
        },
      ],
      edges: [{ from: 'scene_01', to: 'scene_02', kind: 'sequence|dependency' }],
    }, null, 2),
  ].join('\n');
}

function extractJsonText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const fenced = raw.match(/```(?:json[^\r\n]*)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return raw;
}

function withoutTrailingCommas(text) {
  return String(text || '').replace(/,\s*([}\]])/g, '$1');
}

function repairUnescapedQuotes(text) {
  let repaired = String(text || '');
  for (let index = 0; index < 3; index += 1) {
    const next = repaired.replace(/(:\s*"[^"\r\n]*)"(?=[^,\r\n}\]]*"\s*[,}\]])/g, '$1\\"');
    if (next === repaired) break;
    repaired = next;
  }
  return repaired;
}

function tolerantParseJson(text) {
  const jsonText = extractJsonText(text);
  if (!jsonText) {
    const error = new Error('AI 未返回 content graph JSON。');
    error.code = 'empty_json';
    throw error;
  }
  const candidates = [
    jsonText,
    withoutTrailingCommas(jsonText),
    repairUnescapedQuotes(withoutTrailingCommas(jsonText)),
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function summarizeScenesForRetry(sceneSpec = {}) {
  return (Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : []).map(scene => ({
    id: scene?.id || '',
    title: scene?.title || scene?.visual_text?.headline || scene?.headline || '',
    duration: scene?.duration ?? scene?.duration_sec ?? scene?.durationSec ?? '',
    narration: compactText(scene?.narration_text || scene?.narration || '', 240),
  }));
}

function buildRetryPrompt(sceneSpec = {}, creativeContext = {}, target = {}, originalPrompt = '', attempt = 1) {
  if (sceneSpec && typeof sceneSpec === 'object' && sceneSpec.sceneSpec) {
    const args = sceneSpec;
    return buildRetryPrompt(args.sceneSpec, args.creativeContext, args.target, args.originalPrompt || '', args.attempt || 1);
  }
  const scenes = summarizeScenesForRetry(sceneSpec);
  const expectedSceneIds = sceneIdsFromSpec(sceneSpec);
  const isAssetFirst = creativeContext?.visual_strategy === 'asset_first'
    || target?.visual_strategy === 'asset_first';
  const assetSummary = summarizeCreativeContextForPrompt(creativeContext);
  const contractLines = [
    `scene ids: ${expectedSceneIds.join(', ') || 'none'}`,
    `nodes.length must equal ${expectedSceneIds.length}`,
    'nodes[i].id must equal scene ids in the same order; do not add, remove, merge, split, or reorder scenes.',
    isAssetFirst
      ? 'nodes[i].asset_refs optional; max 1 item with asset_id, usage=subject|showcase|evidence|background, reason. generated assets should keep scene_id binding and are not evidence.'
      : 'nodes[i].asset_refs optional; max 1 item with asset_id, usage, reason. generated assets are usable but are not source evidence.',
  ];
  if (Number(attempt) >= 2) {
    return [
      '只输出严格 JSON，不要 Markdown。',
      ...contractLines,
      assetSummary.includes('gen_') ? '若素材列表中有 gen_* 推荐图，必须继续为对应场景输出 asset_refs，且不要把 generated 当来源证据。' : '',
      'schema: {"nodes":[{"id":"string","kind":"text","label":"string","durationSec":2,"text":"string"}]}',
    ].join('\n');
  }
  return [
    '你是 html-video 的 content graph 规划器。上次返回为空，请重新输出严格 JSON。',
    '只输出一个 JSON 对象，必须包含 synopsis、nodes、edges。',
    ...contractLines,
    `目标：aspect ratio=${target.aspect_ratio || target.aspectRatio || sceneSpec.aspect_ratio || ''}，duration=${target.duration_sec || target.durationSec || sceneSpec.target_duration_sec || ''}。`,
    '场景摘要：',
    JSON.stringify(scenes, null, 2),
    assetSummary ? `素材摘要：\n${assetSummary}` : '',
    isAssetFirst ? 'asset_first 规则：generated 图片优先绑定 generation.scene_id 对应场景，usage 使用 subject；article 仍是证据优先。' : '',
    'JSON schema：',
    JSON.stringify({
      synopsis: 'string',
      nodes: [{ id: 'scene_01', kind: 'text|data|entity', label: 'string', durationSec: 2, text: 'string', asset_refs: [{ asset_id: 'article_01', usage: 'showcase', reason: 'string' }] }],
      edges: [{ from: 'scene_01', to: 'scene_02', kind: 'sequence' }],
    }, null, 2),
  ].join('\n');
}

function normalizeId(value, fallback) {
  const base = compactText(value, 80) || fallback;
  return String(base || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
}

function normalizeData(data = {}) {
  const source = objectOrEmpty(data);
  const items = Array.isArray(source.items) ? source.items : [];
  return {
    title: compactText(source.title || source.label || source.name, 80),
    unit: compactText(source.unit, 30),
    items: items.map((item, index) => {
      const object = objectOrEmpty(item);
      const rawValue = object.value ?? object.metric ?? object.amount ?? object.count ?? object.y ?? 0;
      const number = Number(rawValue);
      return {
        label: compactText(object.label || object.name || object.title || `item_${index + 1}`, 60),
        value: Number.isFinite(number) ? number : compactText(rawValue, 40),
      };
    }).filter(item => item.label),
  };
}

function allowedAssetById(creativeContext = {}) {
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  if (!assets.length) return null;
  return new Map(assets
    .filter(isAssetUsableForFrames)
    .map(asset => [compactText(asset?.id || asset?.asset_id, 80), asset])
    .filter(([id]) => id));
}

function isSourceEvidenceUsage(value = '') {
  return /^(evidence|source|citation|proof)$/i.test(compactText(value, 40))
    || /来源|证据|引用/.test(compactText(value, 40));
}

function normalizeAssetRefs(value, creativeContext = {}) {
  const allowedAssets = allowedAssetById(creativeContext);
  return (Array.isArray(value) ? value : [])
    .map(ref => {
      const object = objectOrEmpty(ref);
      const assetId = compactText(object.asset_id || object.assetId || object.id, 80);
      if (!assetId) return null;
      const asset = allowedAssets?.get(assetId) || null;
      if (allowedAssets && !asset) return null;
      const usage = compactText(object.usage || object.kind || object.type, 40);
      const source = compactText(asset?.source || 'article', 30);
      if (source !== 'article' && isSourceEvidenceUsage(usage)) return null;
      return {
        asset_id: assetId,
        usage,
        reason: compactText(object.reason || object.summary || object.description, 160),
      };
    })
    .filter(Boolean)
    .slice(0, 1);
}

function normalizeContentGraph(graph, sceneSpec = {}, creativeContext = {}) {
  const source = objectOrEmpty(graph);
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  if (!rawNodes.length) {
    return { success: false, message: 'content graph 缺少 nodes。' };
  }
  const nodes = rawNodes.map((node, index) => {
    const kind = ['text', 'data', 'entity'].includes(String(node?.kind || '').trim())
      ? String(node.kind).trim()
      : 'text';
    const id = normalizeId(node?.id, `scene_${String(index + 1).padStart(2, '0')}`);
    const duration = Number(node?.durationSec ?? node?.duration_sec ?? node?.duration);
    const normalized = {
      id,
      kind,
      label: compactText(node?.label || node?.title || node?.text || id, 80) || id,
      durationSec: Number.isFinite(duration) && duration > 0
        ? duration
        : contentGraph.DEFAULT_FRAME_DURATION_SEC,
      metadata: objectOrEmpty(node?.metadata),
    };
    if (kind === 'data') {
      normalized.data = normalizeData(node?.data || node);
    } else {
      normalized.text = compactText(node?.text || node?.description || node?.label || normalized.label, 500) || normalized.label;
    }
    const assetRefs = normalizeAssetRefs(node?.asset_refs, creativeContext);
    if (assetRefs.length) normalized.asset_refs = assetRefs;
    return normalized;
  });

  const idMap = new Map(rawNodes.map((node, index) => [
    normalizeId(node?.id, `scene_${String(index + 1).padStart(2, '0')}`),
    nodes[index].id,
  ]));
  const edges = Array.isArray(source.edges)
    ? source.edges.map(edge => ({
      from: idMap.get(normalizeId(edge?.from, '')) || normalizeId(edge?.from, ''),
      to: idMap.get(normalizeId(edge?.to, '')) || normalizeId(edge?.to, ''),
      kind: edge?.kind === 'dependency' ? 'dependency' : 'sequence',
    })).filter(edge => edge.from && edge.to)
    : nodes.slice(0, -1).map((node, index) => ({ from: node.id, to: nodes[index + 1].id, kind: 'sequence' }));

  const normalizedGraph = {
    schemaVersion: 1,
    intent: compactText(source.intent, 60) || 'promo',
    synopsis: compactText(source.synopsis || sceneSpec.title || '', 300),
    nodes,
    edges,
  };
  const validation = contentGraph.validate(normalizedGraph);
  if (!validation.ok) {
    return { success: false, message: 'content graph 校验失败。', errors: validation.errors, graph: normalizedGraph };
  }
  return { success: true, graph: normalizedGraph };
}

function parseContentGraphResponse(text, sceneSpec = {}, options = {}) {
  try {
    const parsed = tolerantParseJson(text);
    const normalized = normalizeContentGraph(parsed, sceneSpec, options.creativeContext);
    return normalized.success ? normalized : {
      ...normalized,
      diagnostics: [contentGraphDiagnostic(normalized.message || 'content graph 校验失败。', { errors: normalized.errors || [] })],
    };
  } catch (error) {
    return contentGraphFailure(error.code === 'empty_json'
      ? error.message
      : `AI 返回的 content graph JSON 无效：${error.message}`);
  }
}

function contentGraphDiagnostic(message, details = {}) {
  return createDiagnostic({
    code: 'content_graph_invalid',
    stage: 'ai-content-graph',
    sub_stage: 'content_graph',
    retryable: true,
    repair_action: 'retry_content_graph',
    user_message: message,
    details,
  });
}

function contentGraphFailure(message, details = {}) {
  return {
    success: false,
    message,
    diagnostics: [contentGraphDiagnostic(message, details)],
  };
}

module.exports = {
  buildContentGraphPrompt,
  buildRetryPrompt,
  sceneIdsFromSpec,
  tolerantParseJson,
  parseContentGraphResponse,
  normalizeContentGraph,
  summarizeCreativeContextForPrompt,
};
