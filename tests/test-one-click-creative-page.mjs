import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, '../frontend-react/src/pages/OneClickCreativePage.jsx');
const appPath = path.join(__dirname, '../frontend-react/src/App.jsx');
const shellPath = path.join(__dirname, '../frontend-react/src/components/AppShell.jsx');

assert.ok(fs.existsSync(pagePath), 'missing page frontend-react/src/pages/OneClickCreativePage.jsx');

const page = fs.readFileSync(pagePath, 'utf-8');
const app = fs.readFileSync(appPath, 'utf-8');
const shell = fs.readFileSync(shellPath, 'utf-8');

for (const text of [
  '一键创作',
  '输入视频方向、抖音 ID 或抖音链接',
  '联网获取最新资料',
  '图片素材将在下一阶段开放',
  '一键生成视频',
  '正在创建创作任务...',
  '请输入视频方向、抖音 ID 或抖音链接',
]) {
  assert.ok(page.includes(text), `OneClickCreativePage.jsx should include normal Chinese text: ${text}`);
}

for (const symbol of [
  'CreativeInputForm',
  'WorkflowStageList',
  'WorkflowStatusPanel',
  'AssetContextNotice',
]) {
  assert.match(page, new RegExp(`function\\s+${symbol}\\s*\\(`), `OneClickCreativePage.jsx should define ${symbol}`);
}

assert.match(page, /createCreativeWorkflow/, 'OneClickCreativePage should create creative workflows');
assert.match(page, /getCreativeWorkflow/, 'OneClickCreativePage should poll creative workflows');
assert.match(page, /setInterval/, 'OneClickCreativePage should poll with setInterval');
assert.match(page, /assetIds:\s*\[\]/, 'OneClickCreativePage payload should preserve empty assetIds');
assert.match(page, /disabled=\{isBusy\}/, 'OneClickCreativePage should disable submit while busy');

assert.match(app, /OneClickCreativePage/, 'App.jsx should import and render OneClickCreativePage');
assert.match(app, /<Navigate\s+to="\/creative"\s+replace\s+\/>/, 'App.jsx index route should navigate to /creative');

assert.match(shell, /to="\/creative"/, 'AppShell should include a creative nav item');
for (const text of ['内容抓取', '抓取记录', '素材工作台', '高级成片', '设置']) {
  assert.ok(shell.includes(text), `AppShell should preserve nav text: ${text}`);
}

console.log('one click creative page tests passed');
