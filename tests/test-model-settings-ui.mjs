import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const globalModelSelectorPath = path.join(root, 'frontend-react/src/components/settings/GlobalModelSelector.jsx');
const modelConfigFormPath = path.join(root, 'frontend-react/src/components/settings/ModelConfigForm.jsx');
const useSettingsPath = path.join(root, 'frontend-react/src/hooks/useSettings.js');

const [globalModelSelectorSource, modelConfigFormSource, useSettingsSource] = await Promise.all([
  readFile(globalModelSelectorPath, 'utf8'),
  readFile(modelConfigFormPath, 'utf8'),
  readFile(useSettingsPath, 'utf8'),
]);

assert.match(
  globalModelSelectorSource,
  /当前图片生成仅支持火山方舟 Seedream 4\.0-5\.0 以及 OpenAI gpt-image-2。/
);
assert.match(
  globalModelSelectorSource,
  /当前 TTS 功能仅支持小米 MiMo 和 MiniMax 供应商。/
);
assert.doesNotMatch(
  modelConfigFormSource,
  /当前 TTS 功能仅支持小米 MiMo 和 MiniMax 供应商。/
);
assert.match(useSettingsSource, /seedream-4-0 \/ gpt-image-2/);

console.log('model settings ui tests passed');
