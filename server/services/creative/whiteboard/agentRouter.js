'use strict';

// 白板对话意图理解层：把用户自由文本交给已配置的文本模型，输出结构化意图，
// 替代历史正则猜测。安全边界：这里永远不会输出确认产物、授权扣费类动作，
// 那些操作只能由用户通过审批卡按钮显式触发。

const defaultTextModel = require('../../ai/aiTextModel');
const { WhiteboardError } = require('./contracts');

const INTENT_CONTRACT = 'whiteboard-message-intent-v1';

function buildContextBlock(context = {}) {
  const lines = [];
  lines.push(context.phase === 'production' ? '当前处于视频制作阶段。' : '当前处于内容与分镜方案阶段。');
  if (context.stageLabel) lines.push(`当前阶段：${context.stageLabel}${context.gateTitle ? `（${context.gateTitle}）` : ''}。`);
  if (context.progressMessage) lines.push(`当前状态：${context.progressMessage}。`);
  if (context.lastError) lines.push(`最近一次错误：${context.lastError}。`);
  if (Array.isArray(context.scenes) && context.scenes.length) {
    lines.push('可用幕列表（序号. 标题 [id]，括号内为已完成产物）：');
    for (const scene of context.scenes) {
      const products = [
        scene.hasLineart ? '线稿' : '',
        scene.hasAnnotation ? '落墨标注' : '',
        scene.hasVideo ? '单幕动画' : '',
      ].filter(Boolean).join('、');
      lines.push(`${scene.index}. ${scene.title} [${scene.id}]${products ? `（已完成：${products}）` : '（尚无产物）'}`);
    }
  }
  lines.push(context.canReviseScenes ? '当前允许修改指定幕（revise_scenes）。' : '当前不允许修改指定幕。');
  lines.push(context.canRevisePlan ? '当前允许修改整体内容与分镜方案（revise_plan）。' : '当前不允许修改整体方案（制作已开始）。');
  return lines.join('\n');
}

function intentMessages({ message, context }) {
  const system = [
    '你是白板视频创作流程的意图理解模块。根据【当前制作状态】与【用户消息】，判定用户意图，只返回一个 JSON 对象：',
    '{"action":"...","sceneIds":["..."],"instruction":"..."}',
    'action 只能取以下值之一：',
    '- "revise_scenes"：用户明确要求重新生成或修改某些幕的画面（线稿、落墨编排、单幕动画）。sceneIds 必须从可用幕列表中选取 id；用户用序号指代（如"1、2、6、7"）时转换为对应 id。instruction 为用户的完整修改要求，保留用户原话中的原因与要求，不要自行扩展。',
    '- "revise_plan"：用户要求修改整体内容、分镜或旁白方案（仅当允许方案修订时可选）。',
    '- "answer"：询问进度、询问原因、一般讨论，或意图不明确。',
    '判定规则：',
    '- 用户消息同时包含疑问和明确的重新生成/修改指令时（例如"为什么有边框？重新生成"），按 revise_* 处理。',
    '- 只有疑问没有修改指令时（例如"为什么有边框？"），选 answer。',
    '- 不确定时一律选 answer，宁可不猜。',
    '只输出 JSON，不要输出任何其他文字。',
  ].join('\n');
  // OpenAI Responses 协议要求 input 消息中出现 "json" 字样才允许 json_object 格式，
  // system 消息会被拆到 instructions 字段、不参与该校验，因此在这里显式声明。
  const user = `【当前制作状态】\n${buildContextBlock(context)}\n\n【用户消息】\n${message}\n\n请只返回一个 JSON 对象。`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function normalizeIntent(candidate, context = {}) {
  if (!candidate || typeof candidate !== 'object') throw new Error('意图理解结果不是 JSON 对象。');
  const action = candidate.action;
  if (!['revise_scenes', 'revise_plan', 'answer'].includes(action)) throw new Error(`未知意图：${action}`);
  if (action === 'answer') return { action, instruction: '' };
  if (action === 'revise_plan') {
    if (!context.canRevisePlan) throw new Error('当前阶段不允许修改整体方案。');
    const instruction = String(candidate.instruction || '').trim();
    if (!instruction) throw new Error('缺少方案修改意见。');
    return { action, instruction };
  }
  if (!context.canReviseScenes) throw new Error('当前阶段不允许修改指定幕。');
  const validIds = new Set((context.scenes || []).map(scene => scene.id));
  const requested = Array.isArray(candidate.sceneIds) ? candidate.sceneIds : [];
  const sceneIds = [...new Set(requested.map(id => String(id).trim()).filter(id => validIds.has(id)))];
  if (!sceneIds.length) throw new Error('未能从消息中识别出要修改的幕。');
  const instruction = String(candidate.instruction || '').trim();
  return { action, sceneIds, instruction };
}

async function getTextConfig(services = {}) {
  const aiModelConfig = services.aiModelConfig || require('../../ai/aiModelConfig');
  return aiModelConfig.getRuntimeConfig('text');
}

// 分类失败时抛出 WhiteboardError，由调用方决定降级策略。
async function classifyIntent({ message, context, services = {}, onRequest } = {}) {
  const textConfig = await getTextConfig(services);
  if (!textConfig?.enabled || !textConfig.apiKey || !textConfig.baseUrl || !textConfig.modelId) {
    throw new WhiteboardError('INTENT_MODEL_NOT_CONFIGURED', '自然语言意图理解需要在设置中配置分析模型。');
  }
  await onRequest?.();
  const response = await (services.aiTextModel || defaultTextModel).callTextModel({
    textConfig,
    messages: intentMessages({ message, context }),
    temperature: 0,
    maxTokens: 600,
    response_format: { type: 'json_object' },
    requestTimeoutMs: 60000,
    maxRetries: 1,
  });
  if (!response?.success || typeof response.text !== 'string') {
    throw new WhiteboardError('INTENT_CLASSIFICATION_FAILED', response?.message || '意图理解请求失败，请稍后重试。');
  }
  let parsed;
  try {
    parsed = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  } catch {
    throw new WhiteboardError('INTENT_CLASSIFICATION_FAILED', '意图理解返回了无法解析的结果，请换一种表述重试。');
  }
  return { contract: INTENT_CONTRACT, ...normalizeIntent(parsed, context) };
}

function answerMessages({ message, context }) {
  const system = [
    '你是白板视频创作助手。根据【当前制作状态】回答用户的问题或回应用户的讨论。',
    '规则：',
    '- 只依据当前制作状态回答，不要编造没有的进度、原因或承诺。',
    '- 用户对产物提出质疑时，结合最近一次错误如实解释，并提示可以用修改指定幕或确认/重试按钮继续流程。',
    '- 用简洁的中文回答，一般不超过 200 字。',
    '- 不输出 JSON，直接输出自然语言。',
  ].join('\n');
  const user = `【当前制作状态】\n${buildContextBlock(context)}\n\n【用户消息】\n${message}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// 状态问答的流式回答；onDelta 逐块收到增量文本，返回完整文本。
async function streamAnswer({ message, context, services = {}, onDelta, onRequest } = {}) {
  const textConfig = await getTextConfig(services);
  if (!textConfig?.enabled || !textConfig.apiKey || !textConfig.baseUrl || !textConfig.modelId) {
    throw new WhiteboardError('INTENT_MODEL_NOT_CONFIGURED', '自然语言问答需要在设置中配置分析模型。');
  }
  await onRequest?.();
  const response = await (services.aiTextModel || defaultTextModel).callTextModel({
    textConfig,
    messages: answerMessages({ message, context }),
    temperature: 0.4,
    maxTokens: 1200,
    stream: true,
    onDelta,
    streamChunkTimeoutMs: 30000,
    requestTimeoutMs: 120000,
    maxRetries: 1,
  });
  if (!response?.success || typeof response.text !== 'string') {
    throw new WhiteboardError('ANSWER_GENERATION_FAILED', response?.message || '回答生成失败，请稍后重试。');
  }
  return response.text;
}

module.exports = { INTENT_CONTRACT, buildContextBlock, classifyIntent, streamAnswer, normalizeIntent };
