import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const systemSettingsPath = path.join(root, 'frontend-react/src/components/settings/SystemSettings.jsx');
const cleanupDialogPath = path.join(root, 'frontend-react/src/components/settings/CleanupConfirmDialog.jsx');
const settingsPagePath = path.join(root, 'frontend-react/src/pages/SettingsPage.jsx');
const creativeDefaultsPath = path.join(root, 'frontend-react/src/components/settings/CreativeDefaultsSettings.jsx');
const settingsOverviewPath = path.join(root, 'frontend-react/src/components/settings/SettingsOverview.jsx');

const [systemSource, dialogSource, pageSource, creativeDefaultsSource, overviewSource] = await Promise.all([
  readFile(systemSettingsPath, 'utf8'),
  readFile(cleanupDialogPath, 'utf8'),
  readFile(settingsPagePath, 'utf8'),
  readFile(creativeDefaultsPath, 'utf8'),
  readFile(settingsOverviewPath, 'utf8'),
]);

for (const text of [
  '质检状态',
  '素材服务',
  'PEXELS_API_KEY',
  'Pexels 后，一键成片会在没有可用来源图片时自动搜索补图',
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
assert.match(dialogSource, /fixed inset-0/);
assert.match(dialogSource, /role="dialog"/);
assert.doesNotMatch(dialogSource, /modalOverlay/);
assert.match(pageSource, /SystemSettings/);
assert.match(overviewSource, /Pexels 补图/);
assert.match(pageSource, /modelSettingsLoading=\{modelSettings\.loading\}/);
assert.match(pageSource, /disabled=\{loadingApp \|\| savingApp \|\| modelSettings\.loading\}/);
assert.match(creativeDefaultsSource, /生成旁白音频/);
assert.match(creativeDefaultsSource, /情绪化配音/);
assert.match(creativeDefaultsSource, /生成字幕/);
assert.match(creativeDefaultsSource, /来源图片多模态分析/);
assert.match(creativeDefaultsSource, /generateAudio/);
assert.match(creativeDefaultsSource, /emotionalVoice/);
assert.match(creativeDefaultsSource, /generateCaptions/);
assert.match(creativeDefaultsSource, /sourceImageAnalysisEnabled/);
assert.match(creativeDefaultsSource, /sourceImageAnalysisUnavailable/);
assert.match(creativeDefaultsSource, /disabled=\{disabled \|\| \(!sourceImageAnalysisEnabled && sourceImageAnalysisUnavailable\)\}/);

console.log('system settings ui tests passed');
