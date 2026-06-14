#!/usr/bin/env node

/**
 * 自动发现并运行所有测试文件
 * 用法: node tests/run-all.js [filter...]
 *
 * 可选参数:
 *   filter  只运行文件名包含指定关键词的测试
 *           例如: node tests/run-all.js creative video
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

// 获取测试目录
const testsDir = __dirname;

// 获取命令行过滤参数
const filters = process.argv.slice(2);

// 发现测试文件
const testFiles = fs
  .readdirSync(testsDir)
  .filter((f) => /^test-.*\.(js|mjs)$/.test(f))
  .filter((f) => {
    if (filters.length === 0) return true;
    return filters.some((filter) => f.includes(filter));
  })
  .sort();

if (testFiles.length === 0) {
  console.log(`${colors.yellow}没有找到匹配的测试文件${colors.reset}`);
  process.exit(0);
}

console.log(`${colors.bold}${colors.cyan}运行 ${testFiles.length} 个测试文件...${colors.reset}\n`);

// 运行结果统计
const results = {
  passed: [],
  failed: [],
};

// 串行运行测试
for (const file of testFiles) {
  const filePath = path.join(testsDir, file);
  const isMjs = file.endsWith('.mjs');

  console.log(`${colors.cyan}▸ ${file}${colors.reset}`);

  try {
    execSync(`node --experimental-vm-modules "${filePath}"`, {
      stdio: 'inherit',
      cwd: path.dirname(testsDir),
      env: { ...process.env },
    });
    results.passed.push(file);
    console.log('');
  } catch (error) {
    results.failed.push({ file, error });
    console.log('');
  }
}

// 打印结果摘要
console.log('\n' + '='.repeat(60));
console.log(`${colors.bold}测试结果摘要${colors.reset}`);
console.log('='.repeat(60));

if (results.passed.length > 0) {
  console.log(
    `${colors.green}✓ 通过: ${results.passed.length}${colors.reset}`
  );
}

if (results.failed.length > 0) {
  console.log(
    `${colors.red}✗ 失败: ${results.failed.length}${colors.reset}`
  );
  console.log(`\n${colors.red}失败的测试:${colors.reset}`);
  results.failed.forEach(({ file }) => {
    console.log(`  ${colors.red}✗ ${file}${colors.reset}`);
  });
}

console.log('='.repeat(60));

// 退出码
if (results.failed.length > 0) {
  process.exit(1);
}
