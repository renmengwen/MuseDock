const app = require('./app');

const PORT = 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n====================================`);
  console.log(`  MuseDock server started`);
  console.log(`  Open: http://localhost:${PORT}`);
  console.log(`====================================\n`);
});
