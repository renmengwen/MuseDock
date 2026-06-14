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

function getStatusCode(result) {
  if (result?.code === 'NOT_FOUND' || result?.code === 'NO_SCENE_SPEC') return 404;
  return 400;
}

function validateWorkflowId(workflowId) {
  const id = String(workflowId || '').trim();
  if (!WORKFLOW_ID_PATTERN.test(id)) {
    return {
      success: false,
      workflow_id: id,
      message: '创作任务 ID 无效。',
    };
  }
  return { success: true, workflow_id: id };
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
      const workflowOptions = {};
      if (req.body && req.body.skipValidation === true) {
        workflowOptions.skipValidation = true;
      }
      setImmediate(async () => {
        try {
          await service.runCreativeWorkflow(result.workflow_id, workflowOptions);
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

router.get('/:workflow_id/video-spec', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;

  try {
    const service = getService(req);
    const result = await service.getCreativeWorkflowVideoSpec(workflowId);
    if (!result || result.success === false) {
      const message = getMessage(result, '未找到视频规格。');
      return res.status(getStatusCode(result)).json({
        success: false,
        workflow_id: workflowId,
        message,
      });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `读取视频规格失败：${error.message}`,
    });
  }
});

router.patch('/:workflow_id/video-spec', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const payload = req.body || {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({
      success: false,
      workflow_id: workflowId,
      message: '视频规格内容无效。',
    });
  }

  try {
    const service = getService(req);
    const result = await service.patchCreativeWorkflowVideoSpec(workflowId, payload);
    if (!result || result.success === false) {
      const message = getMessage(result, '保存视频规格失败。');
      return res.status(getStatusCode(result)).json({
        success: false,
        workflow_id: workflowId,
        message,
      });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `保存视频规格失败：${error.message}`,
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

router.get('/:workflow_id/scene-spec', async (req, res) => {
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
    const result = await service.getCreativeWorkflowSceneSpec(workflowId);
    if (!result || result.success === false) {
      const message = getMessage(result, '未找到场景规格。');
      const statusCode = getStatusCode(result);
      return res.status(statusCode).json({
        success: false,
        workflow_id: workflowId,
        message,
      });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `读取场景规格失败：${error.message}`,
    });
  }
});

router.patch('/:workflow_id/scene-spec', async (req, res) => {
  const workflowId = String(req.params.workflow_id || '').trim();
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
    return res.status(400).json({
      success: false,
      workflow_id: workflowId,
      message: '创作任务 ID 无效。',
    });
  }

  const edit = req.body;
  if (!edit || typeof edit !== 'object' || !edit.type) {
    return res.status(400).json({
      success: false,
      workflow_id: workflowId,
      message: '编辑内容无效，缺少 type 字段。',
    });
  }

  try {
    const service = getService(req);
    const result = await service.patchCreativeWorkflowSceneSpec(workflowId, edit);
    if (!result || result.success === false) {
      const message = getMessage(result, '编辑失败。');
      const statusCode = getStatusCode(result);
      return res.status(statusCode).json({
        success: false,
        workflow_id: workflowId,
        message,
      });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `编辑场景规格失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/scenes/:scene_id/rewrite', async (req, res) => {
  const workflowId = String(req.params.workflow_id || '').trim();
  const sceneId = String(req.params.scene_id || '').trim();
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
    return res.status(400).json({
      success: false,
      workflow_id: workflowId,
      message: '创作任务 ID 无效。',
    });
  }

  if (!sceneId) {
    return res.status(400).json({
      success: false,
      workflow_id: workflowId,
      scene_id: sceneId,
      message: '场景 ID 无效。',
    });
  }

  try {
    const service = getService(req);
    const result = await service.rewriteCreativeWorkflowScene(workflowId, sceneId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '重写失败。');
      const statusCode = getStatusCode(result);
      return res.status(statusCode).json({
        success: false,
        workflow_id: workflowId,
        scene_id: sceneId,
        message,
      });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      scene_id: sceneId,
      message: `重写场景失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/scenes/:scene_id/tts', async (req, res) => {
  const workflowId = String(req.params.workflow_id || '').trim();
  const sceneId = String(req.params.scene_id || '').trim();
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
    return res.status(400).json({
      success: false,
      workflow_id: workflowId,
      message: '创作任务 ID 无效。',
    });
  }

  if (!sceneId) {
    return res.status(400).json({
      success: false,
      workflow_id: workflowId,
      scene_id: sceneId,
      message: '场景 ID 无效。',
    });
  }

  try {
    const service = getService(req);
    const result = await service.ttsCreativeWorkflowScene(workflowId, sceneId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '配音失败。');
      const statusCode = getStatusCode(result);
      return res.status(statusCode).json({
        success: false,
        workflow_id: workflowId,
        scene_id: sceneId,
        message,
      });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      scene_id: sceneId,
      message: `配音场景失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/rerender', async (req, res) => {
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
    const result = await service.rerenderCreativeWorkflow(workflowId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '重新渲染失败。');
      const statusCode = getStatusCode(result);
      return res.status(statusCode).json({
        success: false,
        workflow_id: workflowId,
        message,
      });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `重新渲染失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/remix', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;

  try {
    const service = getService(req);
    const result = await service.remixCreativeWorkflow(workflowId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '创建二创任务失败。');
      return res.status(getStatusCode(result)).json({
        success: false,
        workflow_id: workflowId,
        message,
      });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `创建二创任务失败：${error.message}`,
    });
  }
});

router.delete('/:workflow_id', async (req, res) => {
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
    const result = await service.deleteCreativeWorkflow(workflowId);
    const statusCode = result.success ? 200 : 404;
    return res.status(statusCode).json({
      workflow_id: workflowId,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `删除创作任务失败：${error.message}`,
    });
  }
});

module.exports = router;
