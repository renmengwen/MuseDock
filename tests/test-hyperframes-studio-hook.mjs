import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.join(__dirname, '../frontend-react/src/hooks/useHyperframesStudio.js');
const source = fs.readFileSync(hookPath, 'utf-8');

assert.match(source, /export function useHyperframesStudio\s*\(/, 'missing useHyperframesStudio export');
assert.match(
  source,
  /export function useHyperframesStudio\s*\(\s*\{\s*initialAwemeId\s*=\s*['"]{2}\s*,\s*initialRunId\s*=\s*['"]{2}\s*\}\s*=\s*\{\s*\}\s*\)/,
  'useHyperframesStudio should accept an options object with default initialAwemeId and initialRunId',
);

for (const action of [
  'generateBrief',
  'generateProject',
  'checkProject',
  'renderVideo',
  'inspectVideo',
  'saveFile',
]) {
  assert.match(source, new RegExp(`\\b${action}\\b`), `missing action ${action}`);
}

for (const loadingText of [
  '正在生成导演策划',
  '正在生成 HyperFrames 工程',
  '正在校验动画工程',
  '正在渲染视频',
  '正在抽帧质检',
]) {
  assert.ok(source.includes(loadingText), `missing loading text ${loadingText}`);
}

for (const stateName of [
  'awemeId',
  'runId',
  'runs',
  'activeRun',
  'selectedFile',
  'fileContent',
  'status',
  'busyAction',
]) {
  assert.match(source, new RegExp(`\\b${stateName}\\b`), `missing state ${stateName}`);
}

assert.match(source, /\bmakeStatus\b/, 'missing makeStatus helper');
assert.match(source, /const\s+\[busyAction,\s*setBusyAction\]\s*=\s*useState/, 'missing busyAction state');

for (const method of [
  'api.generateHyperframesFreeformBrief',
  'api.generateHyperframesFreeformProject',
  'api.checkHyperframesFreeformProject',
  'api.renderHyperframesFreeformProject',
  'api.inspectHyperframesFreeformVideo',
  'api.getHyperframesFreeformFile',
  'api.saveHyperframesFreeformFile',
  'api.listDouyinAgentRuns',
  'api.getDouyinAgentRun',
]) {
  assert.ok(source.includes(method), `missing API call ${method}`);
}

assert.match(source, /await\s+response\.text\(\)/, 'loadFile should read raw Response text');
assert.doesNotMatch(source, /\.content\s*\|\|\s*['"`]/, 'loadFile should not read json.content from raw file response');
assert.match(
  source,
  /api\.saveHyperframesFreeformFile\(\s*awemeId,\s*runId,\s*selectedFile,\s*fileContent\s*\)/,
  'saveFile should save selectedFile and fileContent',
);

console.log('hyperframes studio hook tests passed');
