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
  return lines.join('\n');
}

function buildContentGraphPrompt({ sceneSpec = {}, creativeContext = {}, target = {} } = {}) {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const targetDuration = target.duration_sec || target.durationSec || target.duration || sceneSpec.target_duration_sec || '';
  const aspectRatio = target.aspect_ratio || target.aspectRatio || sceneSpec.aspect_ratio || sceneSpec.aspectRatio || '';
  const language = target.language || target.lang || 'zh-CN';
  const isSourceUrl = creativeContext?.input?.mode === 'source_url'
    || creativeContext?.source_context?.kind === 'source_url';
  const sourceUrlGroundingRequirements = isSourceUrl ? [
    '- 如果源素材来自 source_url，SOURCE MATERIAL 是视频真正主题，不是装饰信息。',
    '- 每个节点都必须引用或改写来源材料里的具体事实、名字、数字、产品、项目能力、术语或主张。',
    '- 禁止输出可套用到任何文章或任何仓库的泛泛句子。',
    '- GitHub repo 只能基于 README、仓库描述、语言、目录结构和 topics，不要假装读过全量源码。',
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
    '- 每个 node 必须包含 id、kind、label、durationSec，并且根据 kind 包含 text 或 data。',
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
  const scenes = summarizeScenesForRetry(sceneSpec);
  if (Number(attempt) >= 2) {
    return [
      '只输出严格 JSON，不要 Markdown。',
      'schema: {"nodes":[{"id":"string","kind":"text","label":"string","durationSec":2,"text":"string"}]}',
    ].join('\n');
  }
  return [
    '你是 html-video 的 content graph 规划器。上次返回为空，请重新输出严格 JSON。',
    '只输出一个 JSON 对象，必须包含 synopsis、nodes、edges。',
    `目标：aspect ratio=${target.aspect_ratio || target.aspectRatio || sceneSpec.aspect_ratio || ''}，duration=${target.duration_sec || target.durationSec || sceneSpec.target_duration_sec || ''}。`,
    '场景摘要：',
    JSON.stringify(scenes, null, 2),
    'JSON schema：',
    JSON.stringify({
      synopsis: 'string',
      nodes: [{ id: 'scene_01', kind: 'text|data|entity', label: 'string', durationSec: 2, text: 'string' }],
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

function normalizeContentGraph(graph, sceneSpec = {}) {
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
    const normalized = normalizeContentGraph(parsed, sceneSpec);
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
  tolerantParseJson,
  parseContentGraphResponse,
  normalizeContentGraph,
  summarizeCreativeContextForPrompt,
};
