import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(__dirname, '../frontend-react/src/api/client.js');
const source = fs.readFileSync(clientPath, 'utf-8');

const expectedMethods = [
  'getHtmlVideoProject(workflowId)',
  'patchHtmlVideoProjectInputs(workflowId, payload)',
  'patchHtmlVideoProjectFrame(workflowId, frameId, payload)',
  'editHtmlVideoProject(workflowId, payload)',
  'renderHtmlVideoProject(workflowId, payload)',
  'exportHtmlVideoProject(workflowId, payload)',
  'listHtmlVideoProjectExports(workflowId)',
];

for (const method of expectedMethods) {
  assert.ok(source.includes(method), `client should expose ${method}`);
}

for (const segment of [
  '/html-video-project',
  '/html-video-project/inputs',
  '/html-video-project/frames/',
  '/html-video-project/edit',
  '/html-video-project/render',
  '/html-video-project/export',
  '/html-video-project/exports',
]) {
  assert.ok(source.includes(segment), `client should call ${segment}`);
}

assert.match(source, /patchHtmlVideoProjectInputs\([^]*?method:\s*'PATCH'/);
assert.match(source, /patchHtmlVideoProjectFrame\([^]*?method:\s*'PATCH'/);
assert.match(source, /editHtmlVideoProject\([^]*?method:\s*'POST'/);
assert.match(source, /renderHtmlVideoProject\([^]*?method:\s*'POST'/);
assert.match(source, /exportHtmlVideoProject\([^]*?method:\s*'POST'/);
assert.match(source, /body:\s*JSON\.stringify\(payload\s*\|\|\s*\{\}\)/);

for (const identifier of ['workflowId', 'frameId']) {
  assert.match(source, new RegExp(`encodeURIComponent\\(${identifier}\\)`), `missing encodeURIComponent(${identifier})`);
}

console.log('html video api client tests passed');
