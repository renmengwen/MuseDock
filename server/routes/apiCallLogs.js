const express = require('express');
const { getApiCallStore } = require('../services/diagnostics/apiCallStore');
const { getApiCallStorageWarning } = require('../services/diagnostics/apiCallRecorder');

const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/', (req, res) => {
  try {
    const store = req.app.locals.apiCallStore || getApiCallStore(req.app.locals.apiCallLogDirectory);
    const result = store.list({ workflowId: String(req.query.workflow_id || '').slice(0, 200),
      state: String(req.query.state || ''), before: req.query.before, limit: req.query.limit });
    res.json({ success: true, ...result, warning: getApiCallStorageWarning() });
  } catch {
    res.status(503).json({ success: false, message: 'API 调用记录暂时无法读取，请检查本地存储空间与权限后重试。' });
  }
});

router.get('/:id', (req, res) => {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(400).json({ success: false, message: 'API 记录编号无效，请从列表重新打开详情。' });
  }
  try {
    const store = req.app.locals.apiCallStore || getApiCallStore(req.app.locals.apiCallLogDirectory);
    const record = store.get(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: '未找到这条 API 调用记录，请刷新列表。' });
    return res.json({ success: true, record });
  } catch {
    return res.status(503).json({ success: false, message: 'API 返回详情读取失败，请检查本地存储空间与权限后重试。' });
  }
});

module.exports = router;
