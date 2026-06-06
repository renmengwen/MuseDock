const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../frontend-dist')));
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/config', require('./routes/config'));
app.use('/api/debug', require('./routes/debug'));
app.use('/api/douyin', require('./routes/douyin'));
app.use('/api/xhs', require('./routes/xhs'));
app.use('/api/history', require('./routes/history'));
app.use('/api/media', require('./routes/media'));
app.use('/api/agents', require('./routes/agents'));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname, '../frontend-dist/index.html'));
});

module.exports = app;
