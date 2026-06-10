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
assert.ok(source.includes('DEFAULT_RENDER_OPTIONS'));
assert.ok(!source.includes("updateRenderOption('frameStyle', event.target.value)"));
assert.ok(!source.includes('<option value="tech_neon">暗色科技教程</option>'));
assert.ok(!source.includes('<option value="creative_brutalist">Creative Brutalist 海报</option>'));
assert.ok(source.includes('renderOptions.frameStyle'));
assert.match(source, /短语动效/);
assert.match(source, /质量评分/);
assert.match(source, /实际时长/);
assert.match(source, /目标时长/);
assert.match(source, /createDouyinRunStoryboard\(\s*value,\s*activeRun\.run_id,\s*DEFAULT_STORYBOARD_OPTIONS,\s*storyboardOverride,\s*renderOptions\.frameStyle,\s*qualityFeedback,\s*\)/);
assert.match(source, /带问题重新生成分镜/);
assert.match(source, /qualityFeedback/);
assert.match(source, /createStoryboard\(\{ qualityFeedback/);
assert.match(source, /正在带着质量问题重新生成 AI 分镜/);

console.log('AI 工作台不再展示 brief 输入区，且 messages 预览状态引用有效。');
