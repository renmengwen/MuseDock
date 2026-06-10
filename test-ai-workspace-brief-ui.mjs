import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const aiWorkspacePath = path.join(__dirname, 'frontend-react/src/pages/AiWorkspace.jsx');
const source = fs.readFileSync(aiWorkspacePath, 'utf-8');

assert.ok(!source.includes('<h4>创作 brief</h4>'));
assert.ok(!source.includes('<h4>AI 分镜视觉 brief</h4>'));
assert.ok(!source.includes('setAgentMessagesPreview'));

console.log('AI 工作台不再展示 brief 输入区，且 messages 预览状态引用有效。');
