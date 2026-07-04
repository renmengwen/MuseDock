const app = require('./app');
const creativeWorkflows = require('./services/creative/creativeWorkflows');
const creativeWorkflowTasks = require('./services/creative/creativeWorkflowTasks');

const PORT = Number(process.env.MUSEDOCK_PORT) || 3000;
// 浏览器/局域网模式默认 0.0.0.0；Electron 主进程注入 127.0.0.1，桌面版不对外开 API
const HOST = process.env.MUSEDOCK_HOST || '0.0.0.0';

async function runStartupRecovery() {
  await creativeWorkflowTasks.recoverOrphanedWorkflows();
  await creativeWorkflows.recoverStaleWorkflowsOnStartup();
}

app.listen(PORT, HOST, () => {
  console.log(`\n====================================`);
  console.log(`  MuseDock server started`);
  console.log(`  Open: http://localhost:${PORT}`);
  console.log(`====================================\n`);

  // Electron utilityProcess 模式下向主进程握手，避免主进程把别人占的端口当成自己
  if (process.parentPort) {
    process.parentPort.postMessage({ type: 'server-ready', port: PORT });
  }

  runStartupRecovery().catch(err => {
    console.error('[startup] 清理卡死的创作任务失败:', err.message);
  });
});
