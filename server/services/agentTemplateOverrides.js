const fsp = require('fs/promises');
const path = require('path');
const agentTemplates = require('./agentTemplates');
const storyboardAgent = require('./storyboardAgent');

const DEFAULT_CONFIG_RELATIVE_PATH = path.join('data', 'config', 'agent_templates.json');

function getConfigPath(rootDir) {
  return path.join(rootDir || process.cwd(), DEFAULT_CONFIG_RELATIVE_PATH);
}

async function readConfig(rootDir) {
  try {
    return JSON.parse(await fsp.readFile(getConfigPath(rootDir), 'utf-8'));
  } catch {
    return { task_agents: {}, storyboard_agent: null };
  }
}

async function writeConfig(config, rootDir) {
  const filePath = getConfigPath(rootDir);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

function sanitizeText(value, limit = 20000) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function normalizeModelOptions(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const temperature = Number(source.temperature ?? fallback.temperature ?? 0.4);
  const maxRetries = Number(source.maxRetries ?? fallback.maxRetries ?? 1);
  return {
    temperature: Number.isFinite(temperature) ? Math.min(2, Math.max(0, temperature)) : fallback.temperature ?? 0.4,
    stream: typeof source.stream === 'boolean' ? source.stream : fallback.stream !== false,
    maxRetries: Number.isFinite(maxRetries) ? Math.min(5, Math.max(0, Math.round(maxRetries))) : fallback.maxRetries ?? 1,
  };
}

function validateModelOptions(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const errors = [];

  if ('temperature' in source) {
    const temperature = Number(source.temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      errors.push('temperature 必须是 0 到 2 之间的数字。');
    }
  }
  if ('stream' in source && typeof source.stream !== 'boolean') {
    errors.push('stream 必须是布尔值。');
  }
  if ('maxRetries' in source) {
    const maxRetries = Number(source.maxRetries);
    if (!Number.isFinite(maxRetries) || maxRetries < 0 || maxRetries > 5 || !Number.isInteger(maxRetries)) {
      errors.push('maxRetries 必须是 0 到 5 之间的整数。');
    }
  }

  return { success: errors.length === 0, errors };
}

function validateEditableConfig(config, options = {}) {
  if (!sanitizeText(config.systemPrompt)) {
    return { success: false, message: 'system prompt 不能为空。' };
  }
  if (!sanitizeText(config.userPromptTemplate)) {
    return { success: false, message: 'user prompt 模板不能为空。' };
  }
  const modelValidation = validateModelOptions(config.modelOptions || {});
  if (!modelValidation.success) {
    return {
      success: false,
      message: modelValidation.errors.join(' '),
      errors: modelValidation.errors,
    };
  }
  if (options.requireResultSchema && config.resultSchema !== undefined) {
    if (!config.resultSchema || typeof config.resultSchema !== 'object' || Array.isArray(config.resultSchema)) {
      return { success: false, message: '输出字段说明必须是 JSON 对象。' };
    }
  }
  return { success: true, message: '' };
}

function normalizeTaskConfig(input = {}, fallback) {
  return {
    ...fallback,
    systemPrompt: sanitizeText(input.systemPrompt, 20000) || fallback.systemPrompt,
    userPromptTemplate: sanitizeText(input.userPromptTemplate, 30000) || fallback.userPromptTemplate,
    resultSchema: input.resultSchema && typeof input.resultSchema === 'object' && !Array.isArray(input.resultSchema)
      ? input.resultSchema
      : fallback.resultSchema || {},
    modelOptions: normalizeModelOptions(input.modelOptions, fallback.modelOptions),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

function normalizeStoryboardConfig(input = {}, fallback) {
  return {
    ...fallback,
    systemPrompt: sanitizeText(input.systemPrompt, 20000) || fallback.systemPrompt,
    userPromptTemplate: sanitizeText(input.userPromptTemplate, 30000) || fallback.userPromptTemplate,
    useFrameProfile: typeof input.useFrameProfile === 'boolean' ? input.useFrameProfile : fallback.useFrameProfile,
    modelOptions: normalizeModelOptions(input.modelOptions, fallback.modelOptions),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

function replaceTemplateVars(template, values = {}) {
  return String(template || '').replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key) => {
    const value = values[key];
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : String(value);
  });
}

function buildMessagesFromTemplate(config, values = {}) {
  return [
    { role: 'system', content: sanitizeText(config.systemPrompt, 20000) },
    { role: 'user', content: replaceTemplateVars(config.userPromptTemplate, values) },
  ];
}

function createPreviewMessages(config, values = {}) {
  const validation = validateEditableConfig(config || {});
  if (!validation.success) return validation;
  return {
    success: true,
    message: 'messages 已生成。',
    messages: buildMessagesFromTemplate(config, values),
  };
}

function createStoryboardPreviewMessages(config, values = {}) {
  const validation = validateEditableConfig(config || {});
  if (!validation.success) return validation;
  return {
    success: true,
    message: '分镜 messages 已生成。',
    messages: storyboardAgent.buildStoryboardMessagesFromEditableConfig(config, values),
  };
}

async function listTaskAgentConfigs(options = {}) {
  const config = await readConfig(options.rootDir);
  const data = agentTemplates.listEditableAgentTemplates().map(defaultConfig => {
    const override = config.task_agents?.[defaultConfig.id];
    return {
      ...defaultConfig,
      ...(override ? normalizeTaskConfig(override, defaultConfig) : {}),
      source: override ? 'override' : 'default',
      hasOverride: !!override,
    };
  });
  return { success: true, data };
}

async function getTaskAgentConfig(id, options = {}) {
  const defaultConfig = agentTemplates.getEditableAgentTemplate(id);
  if (!defaultConfig) return { success: false, message: '暂不支持该 Agent 模板。' };
  const config = await readConfig(options.rootDir);
  const override = config.task_agents?.[id];
  return {
    success: true,
    data: {
      ...(override ? normalizeTaskConfig(override, defaultConfig) : defaultConfig),
      source: override ? 'override' : 'default',
      hasOverride: !!override,
    },
  };
}

async function saveTaskAgentConfig(id, input, options = {}) {
  const defaultConfig = agentTemplates.getEditableAgentTemplate(id);
  if (!defaultConfig) return { success: false, message: '暂不支持该 Agent 模板。' };
  const validation = validateEditableConfig(input || {});
  if (!validation.success) return validation;
  const next = normalizeTaskConfig(input, defaultConfig);
  const config = await readConfig(options.rootDir);
  config.task_agents = config.task_agents || {};
  config.task_agents[id] = next;
  await writeConfig(config, options.rootDir);
  return { success: true, message: 'Agent 模板配置已保存。', data: { ...next, source: 'override', hasOverride: true } };
}

async function clearTaskAgentOverride(id, options = {}) {
  const config = await readConfig(options.rootDir);
  if (config.task_agents) delete config.task_agents[id];
  await writeConfig(config, options.rootDir);
  return { success: true, message: '已恢复默认 Agent 模板配置。' };
}

async function resolveTaskAgentConfig(id, options = {}) {
  const detail = await getTaskAgentConfig(id, options);
  if (!detail.success) return null;
  const requestOverride = options.agentConfigOverride && typeof options.agentConfigOverride === 'object'
    ? options.agentConfigOverride
    : null;
  if (!requestOverride) return detail.data;
  const validation = validateEditableConfig(requestOverride, { requireResultSchema: true });
  if (!validation.success) return validation;
  const merged = normalizeTaskConfig(requestOverride, detail.data);
  return { ...merged, source: 'request', hasOverride: detail.data.hasOverride };
}

function getDefaultStoryboardConfig() {
  return storyboardAgent.getEditableStoryboardTemplate();
}

async function getStoryboardAgentConfig(options = {}) {
  const defaultConfig = getDefaultStoryboardConfig();
  const config = await readConfig(options.rootDir);
  const override = config.storyboard_agent;
  return {
    success: true,
    data: {
      ...(override ? normalizeStoryboardConfig(override, defaultConfig) : defaultConfig),
      source: override ? 'override' : 'default',
      hasOverride: !!override,
    },
  };
}

async function saveStoryboardAgentConfig(input, options = {}) {
  const defaultConfig = getDefaultStoryboardConfig();
  const validation = validateEditableConfig(input || {});
  if (!validation.success) return validation;
  const next = normalizeStoryboardConfig(input, defaultConfig);
  const config = await readConfig(options.rootDir);
  config.storyboard_agent = next;
  await writeConfig(config, options.rootDir);
  return { success: true, message: '分镜 Agent 配置已保存。', data: { ...next, source: 'override', hasOverride: true } };
}

async function clearStoryboardAgentOverride(options = {}) {
  const config = await readConfig(options.rootDir);
  config.storyboard_agent = null;
  await writeConfig(config, options.rootDir);
  return { success: true, message: '已恢复默认分镜 Agent 配置。' };
}

async function resolveStoryboardAgentConfig(options = {}) {
  const detail = await getStoryboardAgentConfig(options);
  const requestOverride = options.storyboardConfigOverride && typeof options.storyboardConfigOverride === 'object'
    ? options.storyboardConfigOverride
    : null;
  if (!requestOverride) return detail.data;
  const validation = validateEditableConfig(requestOverride);
  if (!validation.success) return validation;
  const merged = normalizeStoryboardConfig(requestOverride, detail.data);
  return { ...merged, source: 'request', hasOverride: detail.data.hasOverride };
}

module.exports = {
  readConfig,
  listTaskAgentConfigs,
  getTaskAgentConfig,
  saveTaskAgentConfig,
  clearTaskAgentOverride,
  resolveTaskAgentConfig,
  getStoryboardAgentConfig,
  saveStoryboardAgentConfig,
  clearStoryboardAgentOverride,
  resolveStoryboardAgentConfig,
  normalizeModelOptions,
  validateEditableConfig,
  createPreviewMessages,
  createStoryboardPreviewMessages,
  buildMessagesFromTemplate,
  replaceTemplateVars,
};
