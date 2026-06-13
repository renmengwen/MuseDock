const { spawn } = require('child_process');

const isWindows = process.platform === 'win32';
const frontendCommand = isWindows ? 'cmd.exe' : 'npm';
const frontendArgs = isWindows ? ['/d', '/s', '/c', 'npm', 'run', 'dev:frontend'] : ['run', 'dev:frontend'];
const nodeCommand = process.execPath;
const children = [];

function startProcess(name, command, args) {
  const child = spawn(command, args, {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  children.push(child);

  child.stdout.on('data', data => {
    process.stdout.write(`[${name}] ${data}`);
  });

  child.stderr.on('data', data => {
    process.stderr.write(`[${name}] ${data}`);
  });

  child.on('exit', (code, signal) => {
    if (code === 0 || signal) return;
    console.error(`[${name}] 进程异常退出，退出码：${code}`);
    shutdown(code || 1);
  });

  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

startProcess('api', nodeCommand, ['server/index.js']);
startProcess('web', frontendCommand, frontendArgs);

console.log('开发服务已启动：');
console.log('- 前端热更新：http://localhost:5173');
console.log('- 后端 API：http://localhost:3000');
console.log('提示：为避免中断长任务，后端不会自动重启；修改后端代码后请手动重启 npm run dev。');
console.log('提示：npm start 仍用于读取 frontend-dist 的构建产物。');

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
