import assert from 'assert';
import fs from 'fs';

const page = fs.readFileSync('frontend-react/src/pages/SettingsPage.jsx', 'utf-8');
const client = fs.readFileSync('frontend-react/src/api/client.js', 'utf-8');

assert.match(client, /getAppSettings\(\)/);
assert.match(client, /saveAppSettings\(payload\)/);
assert.match(client, /getConfigTemplates\(\)/);
assert.match(client, /getSystemHealth\(refresh/);
assert.match(client, /cleanupSystemData\(targets\)/);
assert.match(page, /总览/);
assert.match(page, /创作默认值/);
assert.match(page, /模型配置/);
assert.match(page, /系统/);
assert.match(page, /正在加载设置中心/);
assert.match(page, /SettingsOverview/);
assert.match(page, /ModelSettings/);
assert.match(page, /URLSearchParams\(window\.location\.search\)\.get\('section'\)/, 'SettingsPage should open the section named in the ?section= query param');

console.log('settings center shell tests passed');
