import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(__dirname, '../frontend-react/src/api/client.js');
const source = fs.readFileSync(clientPath, 'utf-8');

const expectedMethods = [
  'generateHyperframesFreeformBrief',
  'generateHyperframesFreeformProject',
  'checkHyperframesFreeformProject',
  'renderHyperframesFreeformProject',
  'inspectHyperframesFreeformVideo',
  'getHyperframesFreeformFile',
  'saveHyperframesFreeformFile',
];

for (const method of expectedMethods) {
  assert.match(source, new RegExp(`${method}\\s*\\(`), `missing api method ${method}`);
}

for (const segment of [
  'hyperframes-freeform/brief',
  'hyperframes-freeform/project',
  'hyperframes-freeform/check',
  'hyperframes-freeform/render',
  'hyperframes-freeform/inspect',
  'hyperframes-freeform/files',
]) {
  assert.ok(source.includes(segment), `missing path segment ${segment}`);
}

assert.match(source, /generateHyperframesFreeformBrief\(awemeId,\s*runId,\s*payload\s*=\s*\{\}/);
assert.match(source, /generateHyperframesFreeformProject\(awemeId,\s*runId,\s*payload\s*=\s*\{\}/);
assert.match(source, /renderHyperframesFreeformProject\(awemeId,\s*runId,\s*payload\s*=\s*\{\}/);
assert.match(source, /saveHyperframesFreeformFile\(awemeId,\s*runId,\s*fileName,\s*content\)/);
assert.match(source, /body:\s*JSON\.stringify\(payload\)/);
assert.match(source, /body:\s*JSON\.stringify\(\{\s*content\s*\}\)/);

for (const identifier of ['awemeId', 'runId', 'fileName']) {
  assert.match(source, new RegExp(`encodeURIComponent\\(${identifier}\\)`), `missing encodeURIComponent(${identifier})`);
}

const getFileMethod = source.match(/getHyperframesFreeformFile\([^]*?\n  \},/);
assert.ok(getFileMethod, 'missing getHyperframesFreeformFile method block');
assert.doesNotMatch(getFileMethod[0], /requestJson/, 'getHyperframesFreeformFile should not force JSON parsing');
assert.match(getFileMethod[0], /method:\s*'GET'|requestRaw/, 'getHyperframesFreeformFile should use raw fetch semantics');

console.log('hyperframes studio api client tests passed');
