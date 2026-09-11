const { execFileSync } = require('node:child_process');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');

const DEVELOPMENT_PORTS = [3000, 5173];

function findListeningPids(ports) {
  if (process.platform !== 'win32') {
    throw new Error('此重启入口用于 Windows，请停止旧服务后运行 npm run dev。');
  }
  if (!ports.length || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('开发服务端口无效。');
  }
  // 按 LocalPort 查询缺失端口会产生非终止错误；先读取连接再筛选，空结果即正常成功。
  const command = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $devPorts = @(${ports.join(',')})
    $devProcessIds = @(Get-NetTCPConnection -ErrorAction Stop |
      Where-Object { $_.State -eq 'Listen' -and $_.LocalPort -in $devPorts } |
      Select-Object -ExpandProperty OwningProcess -Unique)
    ConvertTo-Json -InputObject $devProcessIds -Compress
    exit 0
  `;
  let output;
  try {
    output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
  } catch (error) {
    throw new Error(`读取开发服务端口失败：${String(error.stderr || error.message).trim()}`);
  }
  const pids = JSON.parse(output.trim());
  if (!Array.isArray(pids) || pids.some(pid => !Number.isInteger(pid) || pid <= 0)) {
    throw new Error('读取开发服务进程失败，未停止任何进程。');
  }
  return [...new Set(pids)];
}

function stopProcess(pid) {
  try {
    process.kill(pid);
  } catch (error) {
    // 停止后端会让原开发进程一起关闭前端，已退出的进程无需再停止。
    if (error.code !== 'ESRCH') throw new Error(`停止旧开发服务失败：${error.message}`);
  }
}

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', error => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(new Error(`检查开发端口 ${port} 失败：${error.message}`));
    });
    probe.listen({ port, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}

async function stopDevelopmentServers(ports = DEVELOPMENT_PORTS) {
  const pids = findListeningPids(ports);
  if (pids.includes(process.pid)) throw new Error('不能停止当前重启进程，请检查开发端口配置。');
  for (const pid of pids) stopProcess(pid);
  const deadline = Date.now() + 10000;
  while (!(await Promise.all(ports.map(isPortAvailable))).every(Boolean)) {
    if (Date.now() >= deadline) throw new Error(`开发端口 ${ports.join('、')} 尚未释放，请检查占用进程后重试。`);
    await delay(200);
  }
  return pids.length;
}

if (require.main === module) {
  console.log('正在检查并停止旧开发服务...');
  stopDevelopmentServers().then(count => {
    console.log(count ? '旧服务已停止，端口已释放，正在以最新代码启动开发服务...' : '未发现旧开发服务，正在以最新代码启动开发服务...');
    process.env.MUSEDOCK_RESTART = '1';
    require('../start-server.js');
  }).catch(error => {
    console.error(`重启开发服务失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { findListeningPids, stopProcess, stopDevelopmentServers };
