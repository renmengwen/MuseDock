import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const componentPath = path.join(root, 'frontend-react/src/components/settings/CreativeDefaultsSettings.jsx');
const settingsPagePath = path.join(root, 'frontend-react/src/pages/SettingsPage.jsx');

const [componentSource, settingsPageSource] = await Promise.all([
  readFile(componentPath, 'utf8'),
  readFile(settingsPagePath, 'utf8'),
]);

for (const text of [
  '默认画面比例',
  '默认目标时长',
  '帧 HTML 并发上限',
  '按比例默认模板',
  '锁定模板',
  '联网研究默认开启',
  '抖音视频抽帧',
  '强信号卡片',
  '正在保存创作默认值',
  '保存创作默认值',
]) {
  assert.match(componentSource, new RegExp(text), `CreativeDefaultsSettings should include "${text}"`);
}

assert.doesNotMatch(componentSource, /captionMode|showCaptionBar|renderQuality/);
assert.match(componentSource, /frameHtmlConcurrency/);
assert.match(settingsPageSource, /CreativeDefaultsSettings/);

console.log('creative defaults ui tests passed');
