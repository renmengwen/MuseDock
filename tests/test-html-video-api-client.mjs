import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(__dirname, '../frontend-react/src/api/client.js');
const source = fs.readFileSync(clientPath, 'utf-8');

const expectedMethods = [
  'getHtmlVideoProject(workflowId)',
  'patchHtmlVideoProjectFrame(workflowId, frameId, payload)',
  'editHtmlVideoProject(workflowId, payload)',
  'renderHtmlVideoProject(workflowId, payload)',
  'exportHtmlVideoProject(workflowId, payload)',
  'listHtmlVideoProjectExports(workflowId)',
  'getHtmlVideoProjectExportFileUrl(workflowId, exportId)',
  'getHtmlVideoProjectFrameHtml(workflowId, frameId)',
  'saveHtmlVideoProjectFrameHtml(workflowId, frameId, payload)',
  'acceptHtmlVideoProjectFrameDraft(workflowId, frameId, draftId)',
  'discardHtmlVideoProjectFrameDraft(workflowId, frameId, draftId)',
  'inspectHtmlVideoProjectLayout(workflowId, payload)',
  'iterateHtmlVideoProjectFrame(workflowId, frameId, payload)',
  'createHtmlVideoProjectEditPlan(workflowId, payload)',
  'runHtmlVideoProjectEditPlan(workflowId, planId, payload)',
  'acceptHtmlVideoProjectEditPlan(workflowId, planId)',
  'discardHtmlVideoProjectEditPlan(workflowId, planId)',
];

for (const method of expectedMethods) {
  assert.ok(source.includes(method), `client should expose ${method}`);
}

for (const segment of [
  '/html-video-project',
  '/html-video-project/frames/',
  '/html-video-project/frames/${encodeURIComponent(frameId)}/html',
  '/drafts/${encodeURIComponent(draftId)}/accept',
  '/drafts/${encodeURIComponent(draftId)}/discard',
  '/html-video-project/layout-qa',
  '/html-video-project/frames/${encodeURIComponent(frameId)}/iterate',
  '/html-video-project/edit',
  '/html-video-project/edit-plan',
  '/run',
  '/accept',
  '/discard',
  '/html-video-project/render',
  '/html-video-project/export',
  '/html-video-project/exports',
  '/file',
]) {
  assert.ok(source.includes(segment), `client should call ${segment}`);
}

assert.ok(!source.includes('patchHtmlVideoProjectInputs'), 'client should not expose patchHtmlVideoProjectInputs');
assert.ok(!source.includes('/html-video-project/inputs'), 'client should not call /html-video-project/inputs');
assert.match(source, /patchHtmlVideoProjectFrame\([^]*?method:\s*'PATCH'/);
assert.match(source, /saveHtmlVideoProjectFrameHtml\([^]*?method:\s*'PUT'/);
assert.match(source, /acceptHtmlVideoProjectFrameDraft\([^]*?method:\s*'POST'/);
assert.match(source, /discardHtmlVideoProjectFrameDraft\([^]*?method:\s*'POST'/);
assert.match(source, /inspectHtmlVideoProjectLayout\([^]*?method:\s*'POST'/);
assert.match(source, /iterateHtmlVideoProjectFrame\([^]*?method:\s*'POST'/);
assert.match(source, /editHtmlVideoProject\([^]*?method:\s*'POST'/);
assert.match(source, /createHtmlVideoProjectEditPlan\([^]*?method:\s*'POST'/);
assert.match(source, /runHtmlVideoProjectEditPlan\([^]*?method:\s*'POST'/);
assert.match(source, /acceptHtmlVideoProjectEditPlan\([^]*?method:\s*'POST'/);
assert.match(source, /discardHtmlVideoProjectEditPlan\([^]*?method:\s*'POST'/);
assert.match(source, /renderHtmlVideoProject\([^]*?method:\s*'POST'/);
assert.match(source, /exportHtmlVideoProject\([^]*?method:\s*'POST'/);
assert.match(source, /body:\s*JSON\.stringify\(payload\s*\|\|\s*\{\}\)/);

for (const identifier of ['workflowId', 'frameId', 'draftId', 'planId', 'exportId']) {
  assert.match(source, new RegExp(`encodeURIComponent\\(${identifier}\\)`), `missing encodeURIComponent(${identifier})`);
}

console.log('html video api client tests passed');
