const express = require('express');

const defaultCreativeWorkflows = require('../services/creativeWorkflows');
const defaultCreativeWorkflowTasks = require('../services/creativeWorkflowTasks');
const { formatSseEvent, normalizeSinceSeq } = require('../services/creativeTaskEvents');

const router = express.Router();
const WORKFLOW_ID_PATTERN = /^\d{5,32}$/;

function getService(req) {
  return req.app?.locals?.creativeWorkflows || defaultCreativeWorkflows;
}

function getTaskService(req) {
  return req.app?.locals?.creativeWorkflowTasks || defaultCreativeWorkflowTasks;
}

function hasLocal(req, key) {
  return Boolean(req.app?.locals) && Object.prototype.hasOwnProperty.call(req.app.locals, key);
}

function getRegistryFromTaskService(taskService) {
  if (!taskService) return null;
  if (taskService.taskRegistry) return taskService.taskRegistry;
  if (taskService.registry) return taskService.registry;
  if (typeof taskService.getCreativeTaskRegistry === 'function') {
    return taskService.getCreativeTaskRegistry() || null;
  }
  return null;
}

function getTaskRegistry(req) {
  if (hasLocal(req, 'creativeTaskRegistry')) {
    return req.app.locals.creativeTaskRegistry || null;
  }
  if (hasLocal(req, 'creativeWorkflowTasks')) {
    return getRegistryFromTaskService(req.app.locals.creativeWorkflowTasks);
  }
  if (hasLocal(req, 'creativeWorkflows') && req.app.locals.creativeWorkflows !== defaultCreativeWorkflows) {
    return null;
  }
  return defaultCreativeWorkflowTasks.getCreativeTaskRegistry?.() || null;
}

function getMessage(result, fallback) {
  return result?.message || result?.error || fallback;
}

function getStatusCode(result) {
  if (
    result?.code === 'NOT_FOUND'
    || result?.code === 'NO_SCENE_SPEC'
    || result?.code === 'NO_HTML_VIDEO_PROJECT'
    || result?.code === 'EXPORT_NOT_FOUND'
    || result?.code === 'FRAME_NOT_FOUND'
    || result?.code === 'DRAFT_NOT_FOUND'
  ) return 404;
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

function safeString(value) {
  return String(value || '').trim();
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

    const taskService = getTaskService(req);
    const workflowOptions = {};
    if (req.body && req.body.skipValidation === true) {
      workflowOptions.skipValidation = true;
    }
    const started = await taskService.startCreativeWorkflowTask(result.workflow_id, {
      registry: getTaskRegistry(req),
      workflowOptions,
      services: { creativeWorkflows: service },
    });
    if (!started.success) {
      return res.status(500).json({
        success: false,
        workflow_id: result.workflow_id,
        message: started.message || '创建后台创作任务失败。',
      });
    }
    return res.status(202).json({
      ...result,
      task_id: started.task_id,
      active_task: started.active_task,
      message: result.message || '创作任务已创建，正在后台执行。',
    });
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

router.get('/:workflow_id/html-video-project', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;

  try {
    const service = getService(req);
    const result = await service.getCreativeWorkflowHtmlVideoProject(workflowId);
    if (!result || result.success === false) {
      const message = getMessage(result, '未找到 html-video 工程。');
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
      message: `读取 html-video 工程失败：${error.message}`,
    });
  }
});

router.patch('/:workflow_id/html-video-project/inputs', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;

  try {
    const service = getService(req);
    const result = await service.patchHtmlVideoProjectInputs(workflowId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '保存模板字段失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, message });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `保存模板字段失败：${error.message}`,
    });
  }
});

router.patch('/:workflow_id/html-video-project/frames/:frame_id', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const frameId = String(req.params.frame_id || '').trim();
  if (!frameId) {
    return res.status(400).json({ success: false, workflow_id: workflowId, message: '帧 ID 无效。' });
  }

  try {
    const service = getService(req);
    const result = await service.patchHtmlVideoProjectFrame(workflowId, frameId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '保存帧字段失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, frame_id: frameId, message });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      frame_id: frameId,
      message: `保存帧字段失败：${error.message}`,
    });
  }
});

router.get('/:workflow_id/html-video-project/frames/:frame_id/html', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const frameId = String(req.params.frame_id || '').trim();
  if (!frameId) {
    return res.status(400).json({ success: false, workflow_id: workflowId, frame_id: frameId, message: '帧 ID 无效。' });
  }

  try {
    const accept = String(req.headers.accept || '');
    const wantsText = accept.includes('text/html') || accept.includes('text/plain');
    const service = getService(req);
    const result = await service.getHtmlVideoProjectFrameHtml(workflowId, frameId, { format: wantsText ? 'text' : 'json' });
    if (!result || result.success === false) {
      const message = getMessage(result, '读取帧源码失败。');
      return res.status(getStatusCode(result)).json({
        success: false,
        code: result?.code,
        workflow_id: workflowId,
        frame_id: frameId,
        message,
      });
    }
    if (wantsText) {
      res.type('text/plain; charset=utf-8');
      return res.send(result.html || '');
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      frame_id: frameId,
      message: `读取帧源码失败：${error.message}`,
    });
  }
});

router.put('/:workflow_id/html-video-project/frames/:frame_id/html', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const frameId = String(req.params.frame_id || '').trim();
  if (!frameId) {
    return res.status(400).json({ success: false, workflow_id: workflowId, frame_id: frameId, message: '帧 ID 无效。' });
  }

  try {
    const service = getService(req);
    const result = await service.saveHtmlVideoProjectFrameHtml(workflowId, frameId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '保存帧源码草稿失败。');
      return res.status(getStatusCode(result)).json({
        success: false,
        code: result?.code,
        workflow_id: workflowId,
        frame_id: frameId,
        message,
      });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      frame_id: frameId,
      message: `保存帧源码草稿失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/html-video-project/frames/:frame_id/iterate', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const frameId = String(req.params.frame_id || '').trim();
  if (!frameId) {
    return res.status(400).json({ success: false, workflow_id: workflowId, frame_id: frameId, message: '帧 ID 无效。' });
  }

  try {
    const service = getService(req);
    const result = await service.iterateHtmlVideoProjectFrame(workflowId, frameId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '生成当前帧草稿失败。');
      return res.status(getStatusCode(result)).json({
        success: false,
        code: result?.code,
        workflow_id: workflowId,
        frame_id: frameId,
        message,
      });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      frame_id: frameId,
      message: `生成当前帧草稿失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/html-video-project/frames/:frame_id/drafts/:draft_id/accept', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const frameId = String(req.params.frame_id || '').trim();
  const draftId = String(req.params.draft_id || '').trim();
  if (!frameId) {
    return res.status(400).json({ success: false, workflow_id: workflowId, frame_id: frameId, draft_id: draftId, message: '帧 ID 无效。' });
  }
  if (!draftId) {
    return res.status(400).json({ success: false, workflow_id: workflowId, frame_id: frameId, draft_id: draftId, message: '草稿 ID 无效。' });
  }

  try {
    const service = getService(req);
    const result = await service.acceptHtmlVideoProjectFrameDraft(workflowId, frameId, draftId);
    if (!result || result.success === false) {
      const message = getMessage(result, '接受帧源码草稿失败。');
      return res.status(getStatusCode(result)).json({
        success: false,
        code: result?.code,
        workflow_id: workflowId,
        frame_id: frameId,
        draft_id: draftId,
        message,
      });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      frame_id: frameId,
      draft_id: draftId,
      message: `接受帧源码草稿失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/html-video-project/frames/:frame_id/drafts/:draft_id/discard', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const frameId = String(req.params.frame_id || '').trim();
  const draftId = String(req.params.draft_id || '').trim();
  if (!frameId) {
    return res.status(400).json({ success: false, workflow_id: workflowId, frame_id: frameId, draft_id: draftId, message: '帧 ID 无效。' });
  }
  if (!draftId) {
    return res.status(400).json({ success: false, workflow_id: workflowId, frame_id: frameId, draft_id: draftId, message: '草稿 ID 无效。' });
  }

  try {
    const service = getService(req);
    const result = await service.discardHtmlVideoProjectFrameDraft(workflowId, frameId, draftId);
    if (!result || result.success === false) {
      const message = getMessage(result, '放弃帧源码草稿失败。');
      return res.status(getStatusCode(result)).json({
        success: false,
        code: result?.code,
        workflow_id: workflowId,
        frame_id: frameId,
        draft_id: draftId,
        message,
      });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      frame_id: frameId,
      draft_id: draftId,
      message: `放弃帧源码草稿失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/html-video-project/edit', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;

  try {
    const service = getService(req);
    const result = await service.editHtmlVideoProject(workflowId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '编辑失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, message });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `编辑失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/html-video-project/edit-plan', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;

  try {
    const service = getService(req);
    const result = await service.createHtmlVideoProjectEditPlan(workflowId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '创建编辑计划失败。');
      return res.status(getStatusCode(result)).json({ success: false, code: result?.code, workflow_id: workflowId, message });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `创建编辑计划失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/html-video-project/edit-plan/:plan_id/run', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const planId = safeString(req.params.plan_id);
  if (!planId) {
    return res.status(400).json({ success: false, workflow_id: workflowId, plan_id: planId, message: '编辑计划 ID 无效。' });
  }

  try {
    const service = getService(req);
    const result = await service.runHtmlVideoProjectEditPlan(workflowId, planId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '执行编辑计划失败。');
      return res.status(getStatusCode(result)).json({ success: false, code: result?.code, workflow_id: workflowId, plan_id: planId, message });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      plan_id: planId,
      message: `执行编辑计划失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/html-video-project/render', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;

  try {
    const payload = req.body || {};
    const mode = safeString(payload.mode || payload.action);
    if (mode !== 'materialize' && mode !== 'frame') {
      return res.status(400).json({
        success: false,
        workflow_id: workflowId,
        message: 'html-video render mode 无效，请选择 materialize 或 frame。',
      });
    }
    if (mode === 'frame' && !safeString(payload.frame_id || payload.frameId)) {
      return res.status(400).json({
        success: false,
        workflow_id: workflowId,
        message: '渲染单帧预览失败：缺少帧 ID。',
      });
    }
    const service = getService(req);
    const result = await service.renderHtmlVideoProject(workflowId, payload);
    if (!result || result.success === false) {
      const message = getMessage(result, '渲染单帧预览失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, message });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `渲染单帧预览失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/html-video-project/export', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;

  try {
    const service = getService(req);
    const result = await service.exportHtmlVideoProject(workflowId, { ...(req.body || {}), skip_render: false });
    if (!result || result.success === false) {
      const message = getMessage(result, '导出成片失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, message });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `导出成片失败：${error.message}`,
    });
  }
});

router.get('/:workflow_id/html-video-project/exports', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;

  try {
    const service = getService(req);
    const result = await service.listHtmlVideoProjectExports(workflowId);
    if (!result || result.success === false) {
      const message = getMessage(result, '读取导出记录失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, message });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `读取导出记录失败：${error.message}`,
    });
  }
});

router.get('/:workflow_id/html-video-project/exports/:export_id/file', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const exportId = safeString(req.params.export_id);
  if (!exportId) {
    return res.status(400).json({ success: false, workflow_id: workflowId, message: '导出记录 ID 无效。' });
  }

  try {
    const service = getService(req);
    const result = await service.getHtmlVideoProjectExportFile(workflowId, exportId);
    if (!result || result.success === false) {
      const message = getMessage(result, '读取导出文件失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, export_id: exportId, message });
    }
    return res.sendFile(result.file_path);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      export_id: exportId,
      message: `读取导出文件失败：${error.message}`,
    });
  }
});

router.patch('/:workflow_id/html-video-project', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const payload = req.body || {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !payload.type) {
    return res.status(400).json({
      success: false,
      workflow_id: workflowId,
      message: 'html-video 编辑内容无效，缺少 type 字段。',
    });
  }

  try {
    const service = getService(req);
    const result = await service.patchCreativeWorkflowHtmlVideoProject(workflowId, payload);
    if (!result || result.success === false) {
      const message = getMessage(result, '保存 html-video 工程失败。');
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
      message: `保存 html-video 工程失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/html-video-project', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;

  try {
    const service = getService(req);
    const result = await service.renderCreativeWorkflowHtmlVideoProject(workflowId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '渲染 html-video 工程失败。');
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
      message: `渲染 html-video 工程失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/html-video-project/layout-qa', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;

  try {
    const result = await getService(req).inspectHtmlVideoProjectLayout(workflowId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '布局检查失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, message: `布局检查失败：${error.message}` });
  }
});

router.post('/:workflow_id/html-video-project/frames/:frame_id/layout-qa', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const frameId = String(req.params.frame_id || '').trim();

  try {
    const result = await getService(req).inspectHtmlVideoProjectLayout(workflowId, { ...(req.body || {}), frame_id: frameId });
    if (!result || result.success === false) {
      const message = getMessage(result, '布局检查失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, frame_id: frameId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, frame_id: frameId, message: `布局检查失败：${error.message}` });
  }
});

function sendHtmlVideoReserved(req, res) {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  return res.status(501).json({
    success: false,
    workflow_id: validation.workflow_id,
    feature: req.params.feature,
    message: 'html-video 首版暂未开放该能力，后续版本会接入。',
  });
}

router.patch('/:workflow_id/html-video-project/timeline', sendHtmlVideoReserved);
router.patch('/:workflow_id/html-video-project/frames/:frame_id/html', sendHtmlVideoReserved);
router.patch('/:workflow_id/html-video-project/frames/:frame_id/elements/:element_id', sendHtmlVideoReserved);
router.patch('/:workflow_id/html-video-project/frames/:frame_id/transition', sendHtmlVideoReserved);
router.post('/:workflow_id/html-video-project/frames/:frame_id/enhance', sendHtmlVideoReserved);
router.post('/:workflow_id/html-video-project/frames/:frame_id/unenhance', sendHtmlVideoReserved);
router.all('/:workflow_id/html-video-project/:feature(timeline|html|elements|transition|enhance|unenhance)', sendHtmlVideoReserved);

router.post('/:workflow_id/events', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const taskId = safeString(req.body?.task_id);
  const sinceSeq = normalizeSinceSeq(req.body?.since_seq);
  if (!taskId) {
    return res.status(400).json({ success: false, workflow_id: validation.workflow_id, message: '缺少后台任务 ID。' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let subscriptionResult = null;
  let streamWriteFailed = false;
  let closed = false;
  let unsubscribed = false;
  const cleanup = ({ end = false } = {}) => {
    closed = true;
    if (!unsubscribed && subscriptionResult?.unsubscribe) {
      unsubscribed = true;
      subscriptionResult.unsubscribe();
    }
    if (end && !res.writableEnded) {
      res.end();
    }
  };
  const writeEvent = event => {
    try {
      if (closed || res.writableEnded || res.destroyed) {
        streamWriteFailed = true;
        cleanup();
        return false;
      }
      const wrote = res.write(formatSseEvent(event));
      if (wrote === false) {
        return true;
      }
      return true;
    } catch {
      streamWriteFailed = true;
      cleanup({ end: true });
      return false;
    }
  };

  res.on('close', () => cleanup());
  res.on('error', () => cleanup());
  res.on('finish', () => cleanup());

  try {
    subscriptionResult = await getTaskService(req).subscribeCreativeWorkflowEvents({
      workflowId: validation.workflow_id,
      taskId,
      sinceSeq,
      registry: getTaskRegistry(req),
      writeEvent,
      onClose: () => {
        cleanup({ end: true });
      },
    });
    if (closed || streamWriteFailed) cleanup();
    if (!subscriptionResult || subscriptionResult.success === false) {
      cleanup({ end: true });
    }
  } catch (error) {
    writeEvent({
      seq: sinceSeq + 1,
      type: 'task_stream_closed',
      workflow_id: validation.workflow_id,
      task_id: taskId,
      status: 'failed',
      final_seq: sinceSeq + 1,
      message: `读取任务事件失败：${error.message}`,
    });
    cleanup({ end: true });
  }
});

router.get('/:workflow_id/tasks/active', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const result = await getTaskService(req).getActiveCreativeWorkflowTask(validation.workflow_id, {
    registry: getTaskRegistry(req),
  });
  return res.json(result);
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
    const result = await service.getCreativeWorkflow(workflowId, {
      taskRegistry: getTaskRegistry(req),
    });
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
