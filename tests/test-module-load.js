// 加载校验：递归 require server/services 下每个 .js，任一解析/加载失败即非零退出。
// 用于目录重构后抓“改漏的 require 路径”。注意：只校验模块能否加载，不校验运行时 __dirname 路径。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'server', 'services');
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
}
walk(ROOT);

let failed = 0;
for (const f of files) {
  try {
    require(f);
  } catch (err) {
    failed++;
    console.error('LOAD FAIL:', path.relative(ROOT, f));
    console.error('   ', err.message.split('\n')[0]);
  }
}
console.log(`\n校验 ${files.length} 个模块，失败 ${failed} 个。`);
process.exit(failed ? 1 : 0);
