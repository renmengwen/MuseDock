const app = require('./app');
const creativeWorkflows = require('./services/creativeWorkflows');

const PORT = 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n====================================`);
  console.log(`  MuseDock server started`);
  console.log(`  Open: http://localhost:${PORT}`);
  console.log(`====================================\n`);

  creativeWorkflows.recoverStaleWorkflowsOnStartup().catch(err => {
    console.error('[startup] 清理卡死工作流失败:', err);
  });
});
