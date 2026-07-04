const app = require('./app');
const creativeWorkflows = require('./services/creative/creativeWorkflows');
const creativeWorkflowTasks = require('./services/creative/creativeWorkflowTasks');

const PORT = Number(process.env.MUSEDOCK_PORT) || 3000;

async function runStartupRecovery() {
  await creativeWorkflowTasks.recoverOrphanedWorkflows();
  await creativeWorkflows.recoverStaleWorkflowsOnStartup();
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n====================================`);
  console.log(`  MuseDock server started`);
  console.log(`  Open: http://localhost:${PORT}`);
  console.log(`====================================\n`);

  runStartupRecovery().catch(err => {
    console.error('[startup] 清理卡死的创作任务失败:', err.message);
  });
});
