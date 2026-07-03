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

console.log('creative api client tests passed');
