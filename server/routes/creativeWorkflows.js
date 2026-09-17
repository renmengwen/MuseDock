const express = require('express');

const defaultCreativeWorkflows = require('../services/creative/creativeWorkflows');
const defaultCreativeWorkflowTasks = require('../services/creative/creativeWorkflowTasks');
const defaultVisualAssetUploads = require('../services/creative/visualAssetUploads');
const { formatSseEvent, normalizeSinceSeq } = require('../services/creative/creativeTaskEvents');
const { WhiteboardError } = require('../services/creative/whiteboard/contracts');
const { createLocalFileOpenHandler } = require('../services/localFiles');
const {
  normalizeCreativeWorkflowDto,
  normalizeCreativeWorkflowSummary,
} = require('../services/creative/creativeWorkflowDto');

const router = express.Router();
const WORKFLOW_ID_PATTERN = /^\d{5,32}$/;
const DEFAULT_UPLOAD_TIMEOUT_MS = 30 * 1000;

function getService(req) {
  return req.app?.locals?.creativeWorkflows || defaultCreativeWorkflows;
}

function getTaskService(req) {
  return req.app?.locals?.creativeWorkflowTasks || defaultCreativeWorkflowTasks;
}

function getVisualAssetUploadService(req) {
  return req.app?.locals?.creativeVisualAssetUploads || defaultVisualAssetUploads;
}

function getVisualAssetUploadRoot(req) {
  return req.app?.locals?.creativeAssetUploadRoot;
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
  if (Number.isInteger(result?.statusCode)) return result.statusCode;
  if (result?.code === 'MODE_ACTION_UNSUPPORTED') return 409;
  if (
    result?.code === 'NOT_FOUND'
    || result?.code === 'NO_SCENE_SPEC'
    || result?.code === 'NO_HTML_VIDEO_PROJECT'
    || result?.code === 'EXPORT_NOT_FOUND'
    || result?.code === 'FRAME_NOT_FOUND'
    || result?.code === 'DRAFT_NOT_FOUND'
    || result?.code === 'EDIT_PLAN_NOT_FOUND'
    || /未找到|不存在/.test(getMessage(result, ''))
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

function openWorkflowFile(method, getReference) {
  return createLocalFileOpenHandler(async (req, res) => {
    const validation = validateWorkflowId(req.params.workflow_id);
    if (!validation.success) { res.status(400).json(validation); return; }
    const reference = safeString(getReference(req));
    if (!reference) { res.status(400).json({ success: false, message: '本地文件标识无效。' }); return; }
    const service = getService(req);
    if (typeof service[method] !== 'function') {
      res.status(501).json({ success: false, message: '当前服务暂不支持打开此类本地文件。' }); return;
    }
    const result = await service[method](validation.workflow_id, reference);
    if (!result || result.success === false) {
      res.status(result?.code === 'PROJECT_FILE_NOT_FOUND' ? 404 : getStatusCode(result))
        .json({ success: false, code: result?.code, message: getMessage(result, '本地文件不存在或无法读取。') });
      return;
    }
    return result.file_path;
  });
}

router.post('/:workflow_id/whiteboard/media/:artifact_id', openWorkflowFile('getWhiteboardMediaFile', req => req.params.artifact_id));
router.post('/:workflow_id/html-video-project/exports/:export_id/file', openWorkflowFile('getHtmlVideoProjectExportFile', req => req.params.export_id));
router.post('/:workflow_id/html-video-project/files/*', openWorkflowFile('getHtmlVideoProjectFile', req => req.params[0]));

function decodeFileNameHeader(value) {
  const fileName = safeString(value);
  if (!fileName) return '';
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

router.post('/assets/uploads', async (req, res) => {
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > defaultVisualAssetUploads.MAX_UPLOAD_BYTES) {
    req.resume();
    return res.status(413).json({ success: false, message: '上传失败：单张图片不能超过 8MB。' });
  }
  if (!Number.isFinite(contentLength)) {
    req.setTimeout(Number(req.app?.locals?.creativeAssetUploadTimeoutMs) || DEFAULT_UPLOAD_TIMEOUT_MS);
  }
  try {
    const result = await getVisualAssetUploadService(req).stageVisualAsset({
      stream: req,
      fileName: decodeFileNameHeader(req.headers['x-file-name']),
      mime: req.headers['content-type'],
      requirement: req.headers['x-asset-requirement'],
      rootDir: getVisualAssetUploadRoot(req),
    });
    return res.status(201).json({
      ...result,
      success: true,
      message: '图片已上传并暂存，创建任务后将自动认领。',
    });
  } catch (error) {
    const detail = safeString(error?.message);
    const message = /^上传/.test(detail) ? detail : `上传图片失败：${detail || '请重试。'}`;
    return res.status(/8MB/.test(message) ? 413 : 400).json({
      success: false,
      message,
    });
  }
});

router.patch('/assets/uploads/:uploadId', async (req, res) => {
  try {
    const result = await getVisualAssetUploadService(req).updateStagedVisualAssetRequirement({
      uploadId: req.params.uploadId,
      requirement: req.body?.requirement,
      rootDir: getVisualAssetUploadRoot(req),
    });
    return res.json({
      ...result,
      success: true,
      message: '暂存图片使用约束已更新。',
    });
  } catch (error) {
    const detail = safeString(error?.message);
    const message = /不存在|损坏/.test(detail)
      ? `${detail} 请重新上传。`
      : (/^上传|^更新/.test(detail) ? detail : `更新暂存图片使用约束失败：${detail || '未知错误'}，请重试。`);
    const status = /已认领/.test(message) ? 409 : (/不存在|损坏/.test(message) ? 404 : (/更新暂存图片使用约束失败/.test(message) ? 500 : 400));
    return res.status(status).json({ success: false, message });
  }
});

router.delete('/assets/uploads/:uploadId', async (req, res) => {
  try {
    const result = await getVisualAssetUploadService(req).removeStagedVisualAsset({
      uploadId: req.params.uploadId,
      rootDir: getVisualAssetUploadRoot(req),
    });
    return res.json({
      ...result,
      success: true,
      message: '暂存图片已删除。',
    });
  } catch (error) {
    const detail = safeString(error?.message);
    const message = /^上传|^删除/.test(detail) ? detail : `删除暂存图片失败：${detail || '请重试。'}`;
    return res.status(/已认领/.test(message) ? 409 : 400).json({ success: false, message });
  }
});

router.get('/modes', async (req, res) => {
  const service = getService(req);
  return res.json(await (service.listCreationModes || defaultCreativeWorkflows.listCreationModes)());
});

router.post('/:workflow_id/whiteboard/actions', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const workflowId = validation.workflow_id;
  const service = getService(req);
  if (typeof service.actOnWhiteboardWorkflow !== 'function') return res.status(501).json({ success: false, message: '当前服务尚未支持白板创作，请更新服务端。' });
  const registry = getTaskRegistry(req);
  const action = req.body?.action;
  if (!['ask_status', 'save_lineart_prompt'].includes(action) && registry?.activeTaskForWorkflow(workflowId)?.status === 'running') {
    return res.status(409).json({ success: false, message: '当前方案仍在处理中，请等待本轮执行结束后再操作。' });
  }
  try {
    const result = await service.actOnWhiteboardWorkflow(workflowId, req.body || {});
    if (!result?.success) return res.status(getStatusCode(result)).json(result || { success: false, message: '白板操作失败。' });
    if (!result.startTask) return res.json(result);
    const started = await getTaskService(req).startCreativeWorkflowTask(workflowId, {
      registry, services: { creativeWorkflows: service },
    });
    if (!started?.success) {
      await service.patchCreativeWorkflowTaskSummary?.(workflowId, { task_status: 'failed', fail_running_stages: true });
      return res.status(500).json({ success: false, workflow_id: workflowId, message: started?.message || '白板版本已保存，但后台启动失败，请刷新任务后重试。' });
    }
    return res.status(202).json({ ...result, task_id: started.task_id, active_task: started.active_task });
  } catch {
    return res.status(500).json({ success: false, workflow_id: workflowId, message: '白板操作失败，请检查服务连接和本地存储后重试。' });
  }
});

router.post('/:workflow_id/whiteboard/chat', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const workflowId = validation.workflow_id;
  const service = getService(req);
  if (typeof service.chatOnWhiteboardWorkflow !== 'function') return res.status(501).json({ success: false, message: '当前服务尚未支持白板自然语言对话，请更新服务端。' });
  const registry = getTaskRegistry(req);
  if (registry?.activeTaskForWorkflow(workflowId)?.status === 'running') {
    return res.status(409).json({ success: false, message: '当前方案仍在处理中，请等待本轮执行结束后再操作。' });
  }
  // 意图分类与回答生成耗时较长，用 SSE 把意图判定与回答增量实时推给前端。
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  let started = null;
  try {
    const result = await service.chatOnWhiteboardWorkflow(workflowId, req.body || {}, {
      onEvent: event => res.write(formatSseEvent({ seq: 0, ...event })),
    });
    if (result?.startTask) {
      started = await getTaskService(req).startCreativeWorkflowTask(workflowId, {
        registry, services: { creativeWorkflows: service },
      });
      if (!started?.success) {
        await service.patchCreativeWorkflowTaskSummary?.(workflowId, { task_status: 'failed', fail_running_stages: true });
        res.write(formatSseEvent({ seq: 0, type: 'chat_error', message: started?.message || '意图已理解并保存，但后台启动失败，请刷新任务后重试。' }));
        return res.end();
      }
    }
    res.write(formatSseEvent({
      seq: 0, type: 'chat_result', success: true, workflow: result?.workflow,
      startTask: Boolean(started), task_id: started?.task_id, active_task: started?.active_task,
    }));
    res.end();
  } catch (error) {
    const code = error.code === 'ENOENT' ? 'NOT_FOUND' : (error.code || 'WHITEBOARD_CHAT_FAILED');
    const message = error instanceof WhiteboardError ? error.message
      : (error.code === 'ENOENT' ? '未找到创作任务。' : '白板消息处理失败，请检查服务连接后重试。');
    const statusCode = error.code === 'ENOENT' ? 404 : (error.statusCode || 500);
    res.write(formatSseEvent({ seq: 0, type: 'chat_error', code, message, statusCode }));
    res.end();
  }
});

router.get('/:workflow_id/whiteboard/attempts/:attempt_id', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const service = getService(req);
  if (typeof service.getWhiteboardArtifact !== 'function') return res.status(501).json({ success: false, message: '当前服务尚未支持白板版本读取。' });
  try {
    const result = await service.getWhiteboardArtifact(validation.workflow_id, req.params.attempt_id);
    return res.status(result.success ? 200 : getStatusCode(result)).json(result);
  } catch {
    return res.status(500).json({ success: false, message: '读取白板版本失败，请稍后重试。' });
  }
});

router.get('/:workflow_id/whiteboard/media/:artifact_id', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const service = getService(req);
  if (typeof service.getWhiteboardMediaFile !== 'function') return res.status(501).json({ success: false, message: '当前服务未启用白板媒体读取。' });
  const result = await service.getWhiteboardMediaFile(validation.workflow_id, req.params.artifact_id);
  if (!result.success) return res.status(getStatusCode(result)).json(result);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(result.artifact.mime || 'application/octet-stream');
  if (req.query.download === '1') return res.download(result.file_path, result.artifact.fileName);
  return res.sendFile(result.file_path);
});

router.post('/', async (req, res) => {
  const service = getService(req);

  try {
    const result = await service.createCreativeWorkflow(req.body || {}, {
      uploadRoot: getVisualAssetUploadRoot(req),
    });
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

// 列出本地已有创作任务，供前端在换设备/清缓存后仍能恢复任务列表（不再只依赖 localStorage）。
router.get('/', async (req, res) => {
  const service = getService(req);
  if (typeof service.listCreativeWorkflowRecords !== 'function') {
    return res.status(501).json({
      success: false,
      message: '当前服务暂不支持读取创作任务列表。',
    });
  }

  try {
    const records = await service.listCreativeWorkflowRecords();
    const workflows = (Array.isArray(records) ? records : [])
      .map(normalizeCreativeWorkflowSummary)
      .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
    return res.json({ success: true, workflows });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `读取创作任务列表失败：${error.message}`,
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

router.patch('/:workflow_id/html-video-project/sfx/events/:event_id', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const eventId = String(req.params.event_id || '').trim();
  if (!eventId) {
    return res.status(400).json({ success: false, workflow_id: workflowId, message: '音效 ID 无效。' });
  }

  try {
    const service = getService(req);
    const result = await service.patchHtmlVideoProjectSfxEvent(workflowId, eventId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '删除音效失败，请重试。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, event_id: eventId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      event_id: eventId,
      message: `删除音效失败：${error.message}`,
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

router.get('/:workflow_id/html-video-project/files/*', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const relativePath = String(req.params[0] || '').trim();
  if (!relativePath) {
    return res.status(400).json({ success: false, workflow_id: workflowId, message: '工程文件路径无效。' });
  }

  try {
    const service = getService(req);
    if (typeof service.getHtmlVideoProjectFile !== 'function') {
      return res.status(501).json({ success: false, workflow_id: workflowId, message: '当前服务暂不支持读取工程文件。' });
    }
    const result = await service.getHtmlVideoProjectFile(workflowId, relativePath);
    if (!result || result.success === false) {
      const message = getMessage(result, '读取工程文件失败。');
      return res.status(result?.code === 'PROJECT_FILE_NOT_FOUND' ? 404 : getStatusCode(result)).json({ success: false, workflow_id: workflowId, message });
    }
    return res.sendFile(result.file_path);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `读取工程文件失败：${error.message}`,
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

router.post('/:workflow_id/html-video-project/edit-plan/:plan_id/accept', async (req, res) => {
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
    const result = await service.acceptHtmlVideoProjectEditPlan(workflowId, planId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '接受编辑计划草稿失败。');
      return res.status(getStatusCode(result)).json({ success: false, code: result?.code, workflow_id: workflowId, plan_id: planId, message });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      plan_id: planId,
      message: `接受编辑计划草稿失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/html-video-project/edit-plan/:plan_id/discard', async (req, res) => {
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
    const result = await service.discardHtmlVideoProjectEditPlan(workflowId, planId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '放弃编辑计划草稿失败。');
      return res.status(getStatusCode(result)).json({ success: false, code: result?.code, workflow_id: workflowId, plan_id: planId, message });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      plan_id: planId,
      message: `放弃编辑计划草稿失败：${error.message}`,
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

router.get('/:workflow_id/assets/:asset_id/file', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) {
    return res.status(400).json(validation);
  }
  const workflowId = validation.workflow_id;
  const assetId = safeString(req.params.asset_id);
  if (!assetId) {
    return res.status(400).json({ success: false, workflow_id: workflowId, message: '素材 ID 无效。' });
  }

  try {
    const service = getService(req);
    if (typeof service.getCreativeWorkflowAssetFile !== 'function') {
      return res.status(501).json({ success: false, workflow_id: workflowId, asset_id: assetId, message: '当前服务暂不支持读取素材文件。' });
    }
    const result = await service.getCreativeWorkflowAssetFile(workflowId, assetId);
    if (!result || result.success === false) {
      const message = getMessage(result, '读取视觉素材失败。');
      return res.status(result?.code === 'ASSET_NOT_FOUND' ? 404 : getStatusCode(result)).json({ success: false, workflow_id: workflowId, asset_id: assetId, message });
    }
    return res.sendFile(result.file_path);
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      asset_id: assetId,
      message: `读取视觉素材失败：${error.message}`,
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
  let heartbeatTimer = null;
  const cleanup = ({ end = false } = {}) => {
    closed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
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

  // 定期发送 SSE 注释帧作为心跳，避免渲染等长阶段无事件时被代理/浏览器判超时断开。
  heartbeatTimer = setInterval(() => {
    if (closed || res.writableEnded || res.destroyed) return;
    try {
      res.write(': heartbeat\n\n');
    } catch {
      cleanup();
    }
  }, 15000);

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

router.get('/:workflow_id/retry-plan', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const workflowId = validation.workflow_id;

  try {
    const service = getService(req);
    const result = await service.refreshCreativeWorkflowRetryPlan(workflowId);
    if (!result || result.success === false) {
      return res.status(getStatusCode(result)).json({
        success: false,
        ...(result || {}),
        workflow_id: result?.workflow_id || workflowId,
        message: getMessage(result, '生成恢复计划失败。'),
      });
    }
    if (result.plan?.can_retry === false) {
      return res.json({
        ...result,
        success: false,
        workflow_id: result.workflow_id || workflowId,
        message: '当前任务未失败，无需重试。',
      });
    }
    return res.json({
      ...result,
      success: true,
      workflow_id: result.workflow_id || workflowId,
      plan: result.plan,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `生成恢复计划失败：${error.message}`,
    });
  }
});

router.post('/:workflow_id/retry', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const workflowId = validation.workflow_id;
  const payload = req.body || {};
  const mode = safeString(payload.mode);
  const confirmPlanCode = safeString(payload.confirm_plan_code);
  const confirmPlanFingerprint = safeString(payload.confirm_plan_fingerprint);
  const ignoreLayoutQaOnce = payload.ignore_layout_qa_once === true;

  if (mode !== 'repair_and_resume') {
    return res.status(400).json({
      success: false,
      workflow_id: workflowId,
      message: 'V1 仅支持 repair_and_resume 恢复模式。',
    });
  }

  try {
    const service = getService(req);
    const refreshed = await service.refreshCreativeWorkflowRetryPlan(workflowId);
    if (!refreshed || refreshed.success === false) {
      return res.status(getStatusCode(refreshed)).json({
        success: false,
        ...(refreshed || {}),
        workflow_id: refreshed?.workflow_id || workflowId,
        message: getMessage(refreshed, '生成恢复计划失败。'),
      });
    }

    const plan = refreshed.plan || {};
    const planFingerprint = safeString(plan.plan_fingerprint);
    if (
      !confirmPlanFingerprint
      || !planFingerprint
      || confirmPlanCode !== safeString(plan.code)
      || confirmPlanFingerprint !== planFingerprint
    ) {
      return res.status(400).json({
        success: false,
        workflow_id: workflowId,
        code: 'RETRY_PLAN_CODE_CHANGED',
        plan,
        message: '恢复计划已变化，请确认最新建议后再重试。',
      });
    }
    if (plan.can_retry !== true) {
      return res.status(400).json({
        success: false,
        workflow_id: workflowId,
        plan,
        message: plan.user_message || '当前任务无法自动重试。',
      });
    }
    if (ignoreLayoutQaOnce && plan.code !== 'frame_layout_qa_unresolved') {
      return res.status(400).json({
        success: false,
        workflow_id: workflowId,
        plan,
        message: '只有布局自动修复后仍失败的任务，才能忽略本次布局警告。',
      });
    }

    const started = await getTaskService(req).startCreativeWorkflowRetryTask(workflowId, {
      registry: getTaskRegistry(req),
      payload: {
        mode: 'repair_and_resume',
        confirm_plan_code: confirmPlanCode,
        confirm_plan_fingerprint: confirmPlanFingerprint,
        ...(ignoreLayoutQaOnce ? { ignore_layout_qa_once: true } : {}),
      },
      services: { creativeWorkflows: service },
    });
    if (!started || started.success === false) {
      const message = getMessage(started, '启动恢复重试任务失败。');
      return res.status(message === '当前创作任务仍在运行，请等待结束后再重试。' ? 409 : 500).json({
        success: false,
        ...(started || {}),
        workflow_id: started?.workflow_id || workflowId,
        message,
      });
    }

    return res.status(202).json({
      ...started,
      success: true,
      workflow_id: started.workflow_id || workflowId,
      plan,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `启动恢复重试任务失败：${error.message}`,
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
    const result = await service.getCreativeWorkflow(workflowId, {
      taskRegistry: getTaskRegistry(req),
    });
    if (!result || result.success === false) {
      return res.status(getStatusCode(result)).json({
        success: false,
        workflow_id: workflowId,
        message: getMessage(result, '创作任务不存在。'),
      });
    }

    return res.json(normalizeCreativeWorkflowDto(result.data || result.workflow || result));
  } catch (error) {
    return res.status(500).json({
      success: false,
      workflow_id: workflowId,
      message: `读取创作任务失败：${error.message}`,
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
