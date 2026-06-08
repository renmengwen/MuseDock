const express = require('express');
const { getVideoDetail } = require('../scraper/douyin');
const mediaPipeline = require('../services/mediaPipeline');
const mediaTasks = require('../services/mediaTasks');

const router = express.Router();

async function prepareDouyinMedia(awemeId, force, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const status = !force ? await mediaPipeline.getStatus(awemeId) : null;
  let metadata = status?.metadata?.aweme_id ? status.metadata : null;
  let detail = null;

  if (!metadata) {
    onProgress({ progress: 8, step: 'remote_detail', message: '正在获取抖音视频信息...' });
    detail = await getVideoDetail(awemeId);
    if (!detail.success) return detail;
    if (detail.needLogin || detail.needVerify) return detail;
    metadata = detail.data;
  } else {
    onProgress({ progress: 8, step: 'local_detail', message: '已读取本地视频信息缓存...' });
  }

  if (!metadata?.aweme_id) {
    return {
      success: false,
      aweme_id: awemeId,
      error: 'Douyin detail API did not return video metadata.',
      diagnostic: detail?.diagnostic,
    };
  }

  const result = await mediaPipeline.prepareDouyinMedia(awemeId, metadata, { force, onProgress });
  return {
    ...result,
    cache: { metadata: detail ? 'remote' : 'local', force },
    detail_diagnostic: detail?.diagnostic,
    elapsed: detail?.elapsed,
  };
}

function runPrepareTask(taskId, awemeId, force) {
  setImmediate(async () => {
    try {
      mediaTasks.updateTask(taskId, {
        status: 'running',
        progress: 12,
        step: 'metadata',
        message: force ? '正在重新获取视频信息...' : '正在读取本地缓存或获取视频信息...',
      });
      const result = await prepareDouyinMedia(awemeId, force, {
        onProgress: progress => mediaTasks.updateTask(taskId, {
          status: 'running',
          ...progress,
        }),
      });
      if (result.success === false) {
        mediaTasks.failTask(taskId, new Error(result.message || result.error || '素材准备失败'), result);
        return;
      }
      mediaTasks.completeTask(taskId, {
        message: force ? '素材已重新生成' : '素材准备完成，已复用可用缓存',
        result,
      });
    } catch (error) {
      mediaTasks.failTask(taskId, error);
    }
  });
}

function runTranscribeTask(taskId, awemeId) {
  setImmediate(async () => {
    try {
      mediaTasks.updateTask(taskId, {
        status: 'running',
        progress: 18,
        step: 'transcribe',
        message: '正在压缩或切片音频，并请求音频转写...',
      });
      const result = await mediaPipeline.transcribeAudio(awemeId, {
        onProgress: progress => mediaTasks.updateTask(taskId, {
          status: 'running',
          ...progress,
        }),
      });
      if (result.success === false) {
        mediaTasks.failTask(taskId, new Error(result.message || result.error || '音频转写失败'), result);
        return;
      }
      mediaTasks.completeTask(taskId, {
        message: result.message || '音频转写完成',
        result,
      });
    } catch (error) {
      mediaTasks.failTask(taskId, error);
    }
  });
}

router.post('/douyin/:aweme_id/prepare', async (req, res) => {
  const awemeId = req.params.aweme_id;
  if (!awemeId) return res.status(400).json({ success: false, error: 'Missing aweme_id' });

  try {
    const force = req.query.force === 'true' || req.body?.force === true;
    const asyncMode = req.query.async === 'true' || req.body?.async === true;
    if (asyncMode) {
      const task = mediaTasks.createTask({
        awemeId,
        type: 'prepare',
        label: force ? '重新生成 AI 素材' : '准备 AI 素材',
      });
      runPrepareTask(task.task_id, awemeId, force);
      return res.status(202).json({ success: true, task });
    }

    const result = await prepareDouyinMedia(awemeId, force);
    const statusCode = result.success === false && result.error ? 502 : 200;
    return res.status(statusCode).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, aweme_id: awemeId, error: error.message });
  }
});

router.get('/douyin/:aweme_id/tasks', (req, res) => {
  const tasks = mediaTasks.listTasks({
    awemeId: req.params.aweme_id,
    type: req.query.type,
  });
  return res.json({ success: true, data: tasks });
});

router.get('/douyin/:aweme_id/tasks/:task_id', (req, res) => {
  const task = mediaTasks.getTask(req.params.task_id);
  if (!task || task.aweme_id !== String(req.params.aweme_id)) {
    return res.status(404).json({ success: false, error: '任务不存在或已过期' });
  }
  return res.json({ success: true, task });
});

router.get('/douyin/:aweme_id/status', async (req, res) => {
  try {
    const result = await mediaPipeline.getStatus(req.params.aweme_id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, aweme_id: req.params.aweme_id, error: error.message });
  }
});

router.post('/douyin/:aweme_id/open', async (req, res) => {
  try {
    const target = req.body?.target || req.query.target || 'dir';
    const result = await mediaPipeline.openInExplorer(req.params.aweme_id, target);
    return res.json({ ...result, target });
  } catch (error) {
    return res.status(400).json({ success: false, aweme_id: req.params.aweme_id, error: error.message });
  }
});

router.get('/douyin/:aweme_id/files/frames/:frame_name', async (req, res) => {
  try {
    const framePath = mediaPipeline.resolveFrameFile(req.params.aweme_id, req.params.frame_name);
    return res.sendFile(framePath);
  } catch (error) {
    return res.status(400).json({ success: false, aweme_id: req.params.aweme_id, error: error.message });
  }
});

router.post('/douyin/:aweme_id/transcribe', async (req, res) => {
  try {
    const asyncMode = req.query.async === 'true' || req.body?.async === true;
    if (asyncMode) {
      const task = mediaTasks.createTask({
        awemeId: req.params.aweme_id,
        type: 'transcribe',
        label: '音频转写',
      });
      runTranscribeTask(task.task_id, req.params.aweme_id);
      return res.status(202).json({ success: true, task });
    }

    const result = await mediaPipeline.transcribeAudio(req.params.aweme_id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, aweme_id: req.params.aweme_id, error: error.message });
  }
});

module.exports = router;
