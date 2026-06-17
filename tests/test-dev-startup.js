const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const startServer = fs.readFileSync(path.join(root, 'start-server.js'), 'utf-8');
const serverIndex = fs.readFileSync(path.join(root, 'server/index.js'), 'utf-8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf-8');

assert.equal(packageJson.scripts.dev, 'node start-server.js', 'npm run dev should start the combined development runner');
assert.equal(packageJson.scripts.start, 'node server/index.js', 'npm start should keep the built frontend production-style server');
assert.match(startServer, /const nodeCommand = process\.execPath/, 'development runner should use the active Node executable');
assert.match(startServer, /nodeCommand,\s*\['server\/index\.js'\]/, 'development runner should keep the backend stable while long creative tasks are running');
assert.doesNotMatch(startServer, /--watch/, 'development runner should not auto-restart the backend because it interrupts long creative tasks');
assert.match(startServer, /frontendCommand,\s*frontendArgs/, 'development runner should start the Vite frontend server');
assert.match(startServer, /'cmd\.exe'.*'npm',\s*'run',\s*'dev:frontend'/s, 'development runner should launch npm scripts through cmd.exe on Windows');
assert.match(startServer, /NODE_ENV:\s*'development'/, 'development runner should set NODE_ENV=development');
assert.match(startServer, /http:\/\/localhost:5173/, 'development runner should tell developers to open the Vite URL');
assert.match(readme, /npm run dev[\s\S]*http:\/\/localhost:5173/, 'README should document the hot-reload development entry');
assert.match(readme, /npm run start[\s\S]*http:\/\/localhost:3000/, 'README should document the built frontend entry');
assert.match(serverIndex, /require\(['"]\.\/services\/creativeWorkflowTasks['"]\)/, 'server startup should load creative workflow task recovery');
assert.match(serverIndex, /async function runStartupRecovery\(\)/, 'server startup should define a startup recovery wrapper');
const orphanRecoveryIndex = serverIndex.indexOf('creativeWorkflowTasks.recoverOrphanedWorkflows()');
const staleRecoveryIndex = serverIndex.indexOf('creativeWorkflows.recoverStaleWorkflowsOnStartup()');
assert.ok(orphanRecoveryIndex >= 0, 'startup recovery should recover orphaned creative workflow tasks');
assert.ok(staleRecoveryIndex >= 0, 'startup recovery should keep stale workflow recovery');
assert.ok(orphanRecoveryIndex < staleRecoveryIndex, 'orphaned task recovery should run before stale workflow recovery');
assert.match(serverIndex, /runStartupRecovery\(\)\.catch/, 'server startup should call the startup recovery wrapper');
assert.match(serverIndex, /\[startup\] 清理卡死的创作任务失败:/, 'startup recovery failures should use a Chinese log message');

console.log('dev startup tests passed');
