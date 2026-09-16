const HIDDEN = '[已隐藏]';
const SENSITIVE_KEY = /^(?:authorization|authentication|proxyauthorization|cookie|setcookie|apikey|xapikey|accesskey|accesskeyid|accesskeysecret|secretaccesskey|accesstoken|refreshtoken|idtoken|authtoken|xauthtoken|apitoken|bearertoken|sessiontoken|token|password|passwd|secret|secretkey|privatekey|clientsecret|credential|credentials|signature|sig)$/i;
const sensitiveKey = key => SENSITIVE_KEY.test(String(key).replace(/[-_\s]/g, ''));

function headerEntries(headers) {
  if (!headers) return [];
  if (typeof headers.entries === 'function') return [...headers.entries()];
  return Array.isArray(headers) ? headers : Object.entries(headers);
}

function requestSecrets(url, options = {}) {
  const secrets = new Set();
  const add = value => {
    if (typeof value === 'string' && value.length > 0) {
      secrets.add(value);
      secrets.add(JSON.stringify(value).slice(1, -1));
      secrets.add(encodeURIComponent(value));
    }
  };
  for (const [key, value] of headerEntries(options.headers)) {
    if (!sensitiveKey(key)) continue;
    add(String(value));
    add(String(value).replace(/^(?:Bearer|Basic)\s+/i, ''));
    if (/cookie/i.test(key)) String(value).split(';').forEach(part => add(part.slice(part.indexOf('=') + 1).trim()));
  }
  try {
    const parsed = new URL(url);
    add(decodeURIComponent(parsed.username));
    add(decodeURIComponent(parsed.password));
    for (const [key, value] of parsed.searchParams) if (sensitiveKey(key)) add(value);
  } catch { /* 无效 URL 仍由原来的请求路径处理。 */ }
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (sensitiveKey(key)) add(item);
      else if (item && typeof item === 'object') visit(item);
    }
  };
  if (typeof options.body === 'string') {
    try { visit(JSON.parse(options.body)); } catch { /* 不保存请求正文。 */ }
  }
  return [...secrets].sort((a, b) => b.length - a.length);
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return value;
    url.username = '';
    url.password = '';
    // 临时下载链接与查询参数可能携带签名；保留参数名，不保存可复用的值。
    const query = [...new Set(url.searchParams.keys())].map(key => `${encodeURIComponent(key)}=${HIDDEN}`).join('&');
    return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
  } catch { return value; }
}

function redactText(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets) if (secret) text = text.split(secret).join(HIDDEN);
  text = text.replace(/https?:\/\/[^\s<>"'\\]+/gi, redactUrl);
  text = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.\-]+/gi, `$1 ${HIDDEN}`);
  text = text.replace(/((?:authorization|authentication|proxy[-_]?authorization|x[-_]?api[-_]?key|api[-_]?key|access[-_]?key(?:[-_]?(?:id|secret))?|secret[-_]?access[-_]?key|(?:access|refresh|id|auth|x[-_]?auth|api|bearer|session)[-_]?token|token|password|passwd|secret(?:[-_]?key)?|private[-_]?key|client[-_]?secret|credentials?|signature|set[-_]?cookie|cookie)\s*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}\r\n]+)/gi, `$1"${HIDDEN}"`);
  return text;
}

function redactValue(value, secrets = []) {
  if (typeof value === 'string') return redactText(value, secrets);
  if (Array.isArray(value)) return value.map(item => redactValue(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      redactText(key, secrets), sensitiveKey(key) ? HIDDEN : redactValue(item, secrets),
    ]));
  }
  return value;
}

function jsonStringEnd(text, start) {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === '"') return index + 1;
  }
  return text.length;
}

function jsonValueEnd(text, start) {
  if (text[start] === '"') return jsonStringEnd(text, start);
  if (text[start] === '{' || text[start] === '[') {
    let depth = 0;
    for (let index = start; index < text.length; index += 1) {
      if (text[index] === '"') index = jsonStringEnd(text, index) - 1;
      else if (text[index] === '{' || text[index] === '[') depth += 1;
      else if ((text[index] === '}' || text[index] === ']') && --depth === 0) return index + 1;
    }
    return text.length;
  }
  let end = start;
  while (end < text.length && !/[\s,\]}]/.test(text[end])) end += 1;
  return end;
}

function redactJsonSource(text, secrets) {
  const parts = [];
  let cursor = 0;
  for (let index = 0; index < text.length;) {
    if (text[index] !== '"') { index += 1; continue; }
    const end = jsonStringEnd(text, index);
    const value = JSON.parse(text.slice(index, end));
    let after = end;
    while (/\s/.test(text[after] || '') && after < text.length) after += 1;
    if (text[after] === ':' && sensitiveKey(value)) {
      let start = after + 1;
      while (/\s/.test(text[start] || '') && start < text.length) start += 1;
      parts.push(text.slice(cursor, start), JSON.stringify(HIDDEN));
      index = jsonValueEnd(text, start);
      cursor = index;
      continue;
    }
    const redacted = redactText(value, secrets);
    if (redacted !== value) {
      parts.push(text.slice(cursor, index), JSON.stringify(redacted));
      cursor = end;
    }
    index = end;
  }
  return parts.join('') + text.slice(cursor);
}

function redactBody(text, contentType, secrets = []) {
  // 只替换字符串和敏感字段的值，不重新序列化整份 JSON，保留长整数、数值写法和空白。
  try { JSON.parse(text); return redactJsonSource(text, secrets); } catch { /* 原文或 SSE */ }
  if (/event-stream/i.test(contentType)) {
    return text.split(/(?<=\n)/).map(line => {
      const match = line.match(/^(data:\s*)(.*?)(\r?\n)?$/);
      if (!match) return redactText(line, secrets);
      try { JSON.parse(match[2]); return `${match[1]}${redactJsonSource(match[2], secrets)}${match[3] || ''}`; }
      catch { return redactText(line, secrets); }
    }).join('');
  }
  return redactText(text, secrets);
}

function redactHeaders(headers, secrets = []) {
  return Object.fromEntries(headerEntries(headers).map(([key, value]) => [key, sensitiveKey(key) ? HIDDEN : redactText(value, secrets)]));
}

function redactBuffer(buffer, secrets = []) {
  let result = buffer;
  for (const secret of secrets) {
    if (!secret) continue;
    const needle = Buffer.from(secret);
    let index = result.indexOf(needle);
    if (index < 0) continue;
    const parts = [];
    let cursor = 0;
    while (index >= 0) {
      parts.push(result.subarray(cursor, index), Buffer.from(HIDDEN));
      cursor = index + needle.length;
      index = result.indexOf(needle, cursor);
    }
    parts.push(result.subarray(cursor));
    result = Buffer.concat(parts);
  }
  // 二进制封装也可能夹带明文错误或凭据字段。Latin-1 一字节一字符，替换之外的字节保持不变。
  const hiddenBytes = Buffer.from(HIDDEN).toString('latin1');
  return Buffer.from(redactText(result.toString('latin1')).split(HIDDEN).join(hiddenBytes), 'latin1');
}

module.exports = { HIDDEN, requestSecrets, redactUrl, redactText, redactValue, redactBody, redactHeaders, redactBuffer };
