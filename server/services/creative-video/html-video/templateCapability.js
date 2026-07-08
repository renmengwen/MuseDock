const fs = require('fs');

const { resolveSourceEntryPath } = require('./templateRegistry');

// 模板入口 HTML 是应用静态资产，运行期不变，故按入口路径缓存检测结果，
// 避免 matcher 对同一模板反复读盘（每场景每候选都会查一次）。
const capabilityCache = new Map();

function supportsTemplateInputs(template = {}) {
  const sourcePath = resolveSourceEntryPath(template);
  if (!sourcePath) return false;
  if (capabilityCache.has(sourcePath)) return capabilityCache.get(sourcePath);
  let result = false;
  try {
    if (fs.existsSync(sourcePath)) {
      const html = fs.readFileSync(sourcePath, 'utf8');
      result = /window\.__HV_VARS__|data-hv-bind\s*=|\{\{\s*[\w.]+\s*\}\}/.test(html);
    }
  } catch (_) {
    result = false;
  }
  capabilityCache.set(sourcePath, result);
  return result;
}

module.exports = { supportsTemplateInputs };
