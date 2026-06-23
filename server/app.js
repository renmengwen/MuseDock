const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../frontend-dist')));
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/config', require('./routes/config'));
app.use('/api/creative-workflows', require('./routes/creativeWorkflows'));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname, '../frontend-dist/index.html'));
});

module.exports = app;
