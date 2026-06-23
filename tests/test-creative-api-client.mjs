import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(__dirname, '../frontend-react/src/api/client.js');
const source = fs.readFileSync(clientPath, 'utf-8');

assert.match(source, /createCreativeWorkflow\s*\(/);
assert.match(source, /getCreativeWorkflow\s*\(/);
assert.ok(source.includes('/api/creative-workflows'));
assert.match(source, /method:\s*'POST'/);
assert.match(source, /headers:\s*\{\s*'Content-Type':\s*'application\/json'\s*\}/);
assert.match(source, /body:\s*JSON\.stringify\(payload\)/);
assert.match(source, /encodeURIComponent\(workflowId\)/);

assert.match(source, /getCreativeWorkflowSceneSpec\s*\(/, 'client should expose getCreativeWorkflowSceneSpec');
assert.match(source, /patchCreativeWorkflowSceneSpec\s*\(/, 'client should expose patchCreativeWorkflowSceneSpec');
assert.match(source, /rewriteCreativeWorkflowScene\s*\(/, 'client should expose rewriteCreativeWorkflowScene');
assert.match(source, /ttsCreativeWorkflowScene\s*\(/, 'client should expose ttsCreativeWorkflowScene');
assert.match(source, /rerenderCreativeWorkflow\s*\(/, 'client should expose rerenderCreativeWorkflow');
assert.ok(source.includes('/scene-spec'), 'client should call scene-spec endpoint');
assert.ok(source.includes('/scenes/'), 'client should call scene-level endpoints');
assert.ok(source.includes('/rerender'), 'client should call rerender endpoint');

assert.ok(source.includes('getCreativeVideoSpec(workflowId)'), 'client should expose getCreativeVideoSpec');
assert.ok(source.includes('patchCreativeVideoSpec(workflowId, payload)'), 'client should expose patchCreativeVideoSpec');
assert.ok(source.includes('rerenderCreativeVideo(workflowId, payload)'), 'client should expose rerenderCreativeVideo');
assert.ok(source.includes('remixCreativeVideo(workflowId, payload)'), 'client should expose remixCreativeVideo');
assert.ok(source.includes('/video-spec'), 'client should call video-spec endpoint');
assert.ok(source.includes('/remix'), 'client should call remix endpoint');

console.log('creative api client tests passed');
