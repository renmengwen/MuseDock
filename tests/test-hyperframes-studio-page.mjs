import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, '../frontend-react/src/pages/HyperframesStudioPage.jsx');
const componentsDir = path.join(__dirname, '../frontend-react/src/components/hyperframes-studio');
const page = fs.readFileSync(pagePath, 'utf-8');

for (const symbol of [
  'useHyperframesStudio',
  'StudioSidebar',
  'DirectorPanel',
  'ProjectPanel',
  'RenderPreview',
  'StudioStatus',
]) {
  assert.ok(page.includes(symbol), `HyperframesStudioPage.jsx should include ${symbol}`);
}

assert.ok(page.length < 5000, 'HyperframesStudioPage.jsx should stay under 5000 characters');
assert.ok(!page.includes('api.'), 'HyperframesStudioPage.jsx should not call api directly');

for (const component of [
  'StudioStatus',
  'StudioSidebar',
  'DirectorPanel',
  'ProjectPanel',
  'RenderPreview',
]) {
  const componentPath = path.join(componentsDir, `${component}.jsx`);
  assert.ok(fs.existsSync(componentPath), `missing component file ${component}.jsx`);
  const source = fs.readFileSync(componentPath, 'utf-8');
  assert.match(source, new RegExp(`export function ${component}\\s*\\(`), `${component}.jsx should export function ${component}`);
}

console.log('hyperframes studio page tests passed');
