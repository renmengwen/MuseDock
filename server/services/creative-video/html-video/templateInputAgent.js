function stringify(value) {
  return JSON.stringify(value || {}, null, 2);
}

function fail(userMessage, diagnostics = []) {
  return {
    success: false,
    user_message: userMessage,
    message: userMessage,
    fallback_allowed: true,
    diagnostics: diagnostics.length ? diagnostics : [userMessage],
  };
}

function containsRawHtml(text) {
  return /<\s*html\b|<!doctype\b|<\s*script\b/i.test(String(text || ''));
}

function parseJsonOnlyResponse(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return fail('AI 返回为空，无法解析 JSON。', ['empty_response']);
  }
  if (containsRawHtml(raw)) {
    return fail('AI 返回包含 HTML、DOCTYPE 或 script，模板字段必须只返回 JSON。', ['response_contains_html']);
  }
  if (/^```/m.test(raw) || /```/.test(raw)) {
    return fail('AI 返回必须是纯 JSON，不能包含 Markdown 代码块。', ['response_contains_markdown']);
  }
  if (!raw.startsWith('{') || !raw.endsWith('}')) {
    return fail('AI 返回必须是一个 JSON object，不能包含解释、Markdown 或其他文本。', ['response_is_not_json_object']);
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return fail('AI 返回必须是一个 JSON object。', ['parsed_value_is_not_object']);
    }
    return { success: true, data };
  } catch (error) {
    return fail(`AI 返回不是有效 JSON：${error.message}`, [error.message]);
  }
}

function normalizeTypeList(type) {
  if (Array.isArray(type)) return type;
  return type ? [type] : [];
}

function matchesType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return true;
}

function valueLength(value) {
  if (typeof value === 'string' || Array.isArray(value)) return value.length;
  return null;
}

function pathFor(parent, key) {
  if (!parent) return key;
  if (/^\[\d+\]$/.test(key)) return `${parent}${key}`;
  return `${parent}.${key}`;
}

function validateValue(value, schema = {}, path = 'value') {
  const errors = [];
  const types = normalizeTypeList(schema.type);
  if (types.length && !types.some(type => matchesType(value, type))) {
    errors.push(`${path} 类型应为 ${types.join(' 或 ')}`);
    return errors;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} 必须是以下值之一：${schema.enum.join('、')}`);
  }

  const len = valueLength(value);
  if (len != null) {
    if (schema.minLength != null && len < Number(schema.minLength)) {
      errors.push(`${path} 长度不能少于 ${schema.minLength}`);
    }
    if (schema.maxLength != null && len > Number(schema.maxLength)) {
      errors.push(`${path} 长度不能超过 ${schema.maxLength}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum != null && value < Number(schema.minimum)) {
      errors.push(`${path} 不能小于 ${schema.minimum}`);
    }
    if (schema.maximum != null && value > Number(schema.maximum)) {
      errors.push(`${path} 不能大于 ${schema.maximum}`);
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateValue(item, schema.items, `${path}[${index}]`));
    });
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (value[key] === undefined || value[key] === null || value[key] === '') {
        errors.push(`${pathFor(path, key)} 缺少必填字段`);
      }
    }
    const properties = schema.properties && typeof schema.properties === 'object'
      ? schema.properties
      : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (value[key] !== undefined) {
        errors.push(...validateValue(value[key], childSchema, pathFor(path, key)));
      }
    }
  }

  return errors;
}

function normalizeFieldSchema(field = {}) {
  const schema = {
    type: field.type || 'string',
  };
  if (field.enum) schema.enum = field.enum;
  if (field.minLength != null) schema.minLength = field.minLength;
  if (field.maxLength != null) schema.maxLength = field.maxLength;
  if (field.min_length != null) schema.minLength = field.min_length;
  if (field.max_length != null) schema.maxLength = field.max_length;
  if (field.minimum != null) schema.minimum = field.minimum;
  if (field.maximum != null) schema.maximum = field.maximum;
  if (field.items) schema.items = field.items;
  if (field.properties) schema.properties = field.properties;
  if (field.required && Array.isArray(field.required)) schema.required = field.required;
  return schema;
}

function getTemplateInputSchema(template = {}) {
  const inputs = template.inputs || {};
  if (inputs.schema && typeof inputs.schema === 'object') {
    return inputs.schema;
  }
  const properties = {};
  const required = [];
  for (const [key, field] of Object.entries(inputs)) {
    if (key === 'schema') continue;
    properties[key] = normalizeFieldSchema(field);
    if (field && field.required === true) required.push(key);
  }
  return {
    type: 'object',
    required,
    properties,
  };
}

function validateTemplateInputs(inputs, template) {
  const schema = getTemplateInputSchema(template);
  const diagnostics = validateValue(inputs, schema, 'inputs');
  if (diagnostics.length) {
    return fail(`模板字段校验失败：${diagnostics.join('；')}`, diagnostics);
  }
  return {
    success: true,
    inputs,
    schema,
  };
}

function buildTemplateInputPrompt({ sceneSpec, template, creativeContext } = {}) {
  const schema = getTemplateInputSchema(template);
  return [
    '你是 html-video 模板字段填写助手。',
    '只返回 JSON，不要输出 Markdown、解释、注释或代码块。',
    '禁止输出 HTML、CSS、JS、<script>、完整页面、index.html、hyperframes.json、package.json 或 files 数组。',
    '你的任务只是根据 scene_spec 和创作上下文填写模板 inputs.schema 中的字段。',
    '返回 JSON object 必须直接匹配 inputs.schema，不要包裹在 inputs 字段里。',
    '如果字段内容过长，先压缩成适合模板展示的中文短句。',
    'inputs.schema：',
    stringify(schema),
    '模板信息：',
    stringify({
      id: template?.id,
      name: template?.name,
      description: template?.description,
      category: template?.category,
      best_for: template?.best_for,
    }),
    'scene_spec：',
    stringify(sceneSpec),
    'creativeContext：',
    stringify(creativeContext),
  ].join('\n');
}

function parseTemplateInputResponse(responseText, { template } = {}) {
  const parsed = parseJsonOnlyResponse(responseText);
  if (!parsed.success) return parsed;
  return validateTemplateInputs(parsed.data, template);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstString(inputs, names, fallback = '') {
  for (const name of names) {
    if (typeof inputs?.[name] === 'string' && inputs[name].trim()) {
      return inputs[name].trim();
    }
  }
  return fallback;
}

function renderTemplateHtmlWithInputs({ templateHtml, inputs = {}, sceneSpec = {}, templateId } = {}) {
  let html = String(templateHtml || '');
  const headline = firstString(inputs, ['headline', 'title'], sceneSpec.title || '创意视频');
  const subtitle = firstString(inputs, ['subtitle', 'description', 'summary'], '');
  const channel = firstString(inputs, ['channel_info', 'source', 'label'], '');

  if (headline) {
    html = html.replace(/(<h1\b[^>]*>)([\s\S]*?)(<\/h1>)/i, `$1${escapeHtml(headline).replace(/\s+/g, '<br/>')}$3`);
    html = html.replace(/(<h1\b[^>]*class=["'][^"']*\blayer\b[^"']*["'][^>]*>)([\s\S]*?)(<\/h1>)/gi, `$1${escapeHtml(headline).replace(/\s+/g, '<br/>')}$3`);
    html = html.replace(/(<title>)([\s\S]*?)(<\/title>)/i, `$1${escapeHtml(headline)}$3`);
  }
  if (subtitle) {
    html = html.replace(/(<p\b[^>]*>)([\s\S]*?)(<\/p>)/i, `$1${escapeHtml(subtitle)}$3`);
  }
  if (channel) {
    html = html.replace(/(<span>)(?:&gt;&gt;|>>)[\s\S]*?(<\/span>)/i, `$1&gt;&gt; ${escapeHtml(channel)}$2`);
  }

  const sourceJson = JSON.stringify({
    template_id: templateId,
    template_inputs: inputs,
    scene_spec: sceneSpec,
  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const script = `<script type="application/json" id="template-inputs">${sourceJson}</script>`;
  if (!html.includes('id="template-inputs"')) {
    html = html.includes('</body>') ? html.replace('</body>', `${script}\n</body>`) : `${html}\n${script}`;
  }
  return html;
}

module.exports = {
  buildTemplateInputPrompt,
  parseJsonOnlyResponse,
  parseTemplateInputResponse,
  validateTemplateInputs,
  getTemplateInputSchema,
  renderTemplateHtmlWithInputs,
};
