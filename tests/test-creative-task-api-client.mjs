import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../frontend-react/src/api/client.js'), 'utf8');

assert.match(source, /streamCreativeWorkflowEvents\(workflowId,\s*payload,\s*handlers\s*=\s*\{\}\)/);
assert.match(source, /Accept['"]?\s*:\s*['"]text\/event-stream['"]/);
assert.match(source, /method:\s*'POST'/);
assert.match(source, /response\.body\.getReader\(\)/);
assert.match(source, /since_seq/);
assert.match(source, /onEvent/);
assert.match(source, /AbortController/);

console.log('creative task api client tests passed');
