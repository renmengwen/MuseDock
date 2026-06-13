const express = require('express');

const defaultCreativeWorkflows = require('../services/creativeWorkflows');

const router = express.Router();
const WORKFLOW_ID_PATTERN = /^\d{5,32}$/;

function getService(req) {
  return req.app?.locals?.creativeWorkflows || defaultCreativeWorkflows;
}

function getMessage(result, fallback) {
  return result?.message || result?.error || fallback;
}

router.post('/', async (req, res) => {
  const service = getService(req);

  try {
    const result = await service.createCreativeWorkflow(req.body || {});
    if (!result || result.success === false) {
      return res.status(400).json({
        success: false,
        ...(result || {}),
        message: getMessage(result, '创建创作任务失败。'),
      });
    }

    res.json(result);

    if (result.workflow_id) {
      setImmediate(async () => {
        try {
          await service.runCreativeWorkflow(result.workflow_id);
        } catch (error) {
          console.error('[creative-workflows] background run failed:', error.message);
        }
      });
    }
    return undefined;
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `创建创作任务失败：${error.message}`,
    });
  }
});

router.get('/:workflow_id', async (req, res) => {
  const workflowId = String(req.params.workflow_id || '').trim();
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
    return res.status(400).json({
      success: false,
      workflow_id: workflowId,
      message: '创作任务 ID 无效。',
    });
  }

  try {
    const service = getService(req);
    const result = await service.getCreativeWorkflow(workflowId);
    if (!result || result.success === false) {
      const message = getMessage(result, '未找到创作任务。');
      const statusCode = /未找到|不存在/.test(message) ? 404 : 400;
      return res.status(statusCode).json({
        success: false,
        ...(result || {}),
        workflow_id: result?.workflow_id || workflowId,
        message,
      });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `读取创作任务失败：${error.message}`,
    });
  }
});

module.exports = router;
