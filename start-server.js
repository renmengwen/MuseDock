const { exec } = require('child_process');
const path = require('path');

// 启动服务器
const server = exec('node server/index.js', {
  cwd: __dirname,
  env: { ...process.env, NODE_ENV: 'development' }
}, (error, stdout, stderr) => {
  if (error) console.error('Server error:', error.message);
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
});

server.stdout.on('data', (data) => {
  process.stdout.write(data);
});

server.stderr.on('data', (data) => {
  process.stderr.write(data);
});

process.on('SIGTERM', () => {
  server.kill();
  process.exit(0);
});

process.on('SIGINT', () => {
  server.kill();
  process.exit(0);
});

console.log('Server process started, PID:', server.pid);
