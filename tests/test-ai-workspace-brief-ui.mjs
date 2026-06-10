import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const aiWorkspacePath = path.join(__dirname, '../frontend-react/src/pages/AiWorkspace.jsx');
const source = fs.readFileSync(aiWorkspacePath, 'utf-8');

assert.ok(!source.includes('<h4>创作 brief</h4>'));
assert.ok(!source.includes('<h4>AI 分镜视觉 brief</h4>'));
assert.ok(!source.includes('setAgentMessagesPreview'));
assert.ok(source.includes("frameStyle: 'creative_brutalist'"));
assert.ok(!source.includes("updateRenderOption('frameStyle', event.target.value)"));
assert.ok(!source.includes('<option value="tech_neon">暗色科技教程</option>'));
assert.ok(!source.includes('<option value="creative_brutalist">Creative Brutalist 海报</option>'));
assert.ok(source.includes('renderOptions.frameStyle'));
assert.ok(source.includes('createDouyinRunStoryboard(value, activeRun.run_id, DEFAULT_STORYBOARD_OPTIONS, storyboardOverride, renderOptions.frameStyle)'));

console.log('AI 工作台不再展示 brief 输入区，且 messages 预览状态引用有效。');
