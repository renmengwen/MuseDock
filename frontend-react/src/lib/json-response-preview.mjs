export const PREVIEW_CHARACTERS = 100000;
const MAX_PREVIEW_NODES = 2000;
const MAX_PREVIEW_DEPTH = 32;

export function createJsonPreview(text) {
  try { JSON.parse(text); } catch { return null; }

  // 只用 JSON.parse 校验，展示时保留原始 token，避免改写长整数、数值格式和重复字段。
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g;
  const stack = [];
  let root = null;
  let nodeCount = 0;
  let truncated = false;

  for (const match of text.matchAll(tokens)) {
    const raw = match[0];
    if (match.index >= PREVIEW_CHARACTERS) { truncated = true; break; }
    if (raw === ',' || raw === ':') continue;
    if (raw === '}' || raw === ']') { stack.pop(); continue; }

    const parent = stack.at(-1);
    if (parent?.node.type === 'object' && parent.key === null) {
      parent.key = raw;
      continue;
    }
    if (nodeCount >= MAX_PREVIEW_NODES || stack.length >= MAX_PREVIEW_DEPTH) {
      truncated = true;
      break;
    }
    const type = raw === '{' ? 'object' : raw === '[' ? 'array'
      : raw.startsWith('"') ? 'string' : raw === 'null' ? 'null'
        : raw === 'true' || raw === 'false' ? 'boolean' : 'number';
    const node = { type, key: parent?.key ?? null };
    if (type === 'object' || type === 'array') node.children = [];
    else {
      node.text = raw.slice(0, PREVIEW_CHARACTERS - match.index);
      node.truncated = node.text.length < raw.length;
    }
    if (parent) {
      parent.node.children.push(node);
      parent.key = null;
    } else root = node;
    nodeCount += 1;

    if (node.children) stack.push({ node, key: null });
    if (node.truncated) { truncated = true; break; }
  }
  for (const { node } of stack) node.truncated = true;
  return root ? { root, truncated } : null;
}
