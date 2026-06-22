import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('frontend-react/src/pages/OneClickCreativePage.jsx', 'utf8');
const startNewTaskMatch = source.match(/function startNewTask\(\) \{[\s\S]*?\n  \}/);

assert.match(source, /useResearchTouched/, 'missing useResearchTouched touched state');
assert.match(source, /api\.getAppSettings\(\)/, 'missing app settings load for creative defaults');
assert.match(source, /creativeDefaultsOverride/, 'missing creativeDefaultsOverride request payload');
assert.match(source, /useResearchTouchedRef/, 'missing useResearchTouchedRef guard');
assert.match(source, /setUseResearchTouched\(true\)/, 'missing touched setter in user toggle handler');
assert.ok(startNewTaskMatch, 'missing startNewTask function');
assert.match(startNewTaskMatch[0], /setUseResearch\(true\)/, 'startNewTask should keep resetting useResearch to true');
assert.match(
  startNewTaskMatch[0],
  /useResearchTouchedRef\.current\s*=\s*false/,
  'startNewTask should reset useResearchTouchedRef',
);
assert.match(
  startNewTaskMatch[0],
  /setUseResearchTouched\(false\)/,
  'startNewTask should reset useResearchTouched state',
);
assert.doesNotMatch(
  source,
  /useResearch:\s*useResearch,\s*assetIds/s,
  'request payload should not unconditionally send useResearch before assetIds',
);

console.log('one click research defaults tests passed');
