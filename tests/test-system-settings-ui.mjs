import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const systemSettingsPath = path.join(root, 'frontend-react/src/components/settings/SystemSettings.jsx');
const cleanupDialogPath = path.join(root, 'frontend-react/src/components/settings/CleanupConfirmDialog.jsx');
const settingsPagePath = path.join(root, 'frontend-react/src/pages/SettingsPage.jsx');

const [systemSource, dialogSource, pageSource] = await Promise.all([
  readFile(systemSettingsPath, 'utf8'),
  readFile(cleanupDialogPath, 'utf8'),
  readFile(settingsPagePath, 'utf8'),
]);

for (const text of [
  '质检状态',
  '重新检测',
  'html-video 环境',
  '创作任务记录',
  '媒体素材缓存',
  '渲染产物',
  '浏览器数据',
  'Cookie',
]) {
  assert.match(systemSource, new RegExp(text), `SystemSettings should include "${text}"`);
}

assert.doesNotMatch(systemSource, /清理全部/);
assert.match(dialogSource, /确认清理/);
assert.match(dialogSource, /正在清理/);
assert.match(dialogSource, /此操作不可恢复/);
assert.match(dialogSource, /modalBackdrop/);
assert.match(dialogSource, /modalPanel/);
assert.doesNotMatch(dialogSource, /modalOverlay/);
assert.match(pageSource, /SystemSettings/);

console.log('system settings ui tests passed');
