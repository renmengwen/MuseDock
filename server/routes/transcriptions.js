const express = require('express');
const { createTranscriptionService } = require('../services/transcription/transcriptionTasks');
const { TranscriptionError } = require('../services/transcription/funasr');
const { createLocalFileOpenHandler, assertLocalClient, LocalFileError } = require('../services/localFiles');

function createTranscriptionRouter({ service = createTranscriptionService(), douyin } = {}) {
  const router = express.Router();
  let loginBusy = false;
  const scraper = () => douyin || require('../scraper/douyin');
  const route = handler => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await handler(req, res); }
    catch (error) {
      if (res.headersSent) return;
      const known = error instanceof TranscriptionError || error instanceof LocalFileError;
      res.status(known ? error.status : 500).json({
        success: false, code: known ? error.code : 'TRANSCRIPTION_FAILED',
        message: known ? error.message : '转写工具请求失败，请检查服务状态后重试。',
      });
    }
  };

  router.get('/capabilities', route(async (_req, res) => res.json({ success: true, data: await service.capabilities() })));
  router.get('/', route(async (_req, res) => res.json({ success: true, data: await service.list() })));
  router.post('/', route(async (req, res) => res.status(202).json({ success: true, data: await service.create(req.body) })));
  router.post('/douyin/login', route(async (_req, res) => {
    if (loginBusy) throw new TranscriptionError('LOGIN_BUSY', '正在打开抖音登录，请稍候。', 409);
    loginBusy = true;
    try {
      const result = await scraper().startQrcodeLogin();
      res.json({ success: true, data: {
        loggedIn: !!result.alreadyLoggedIn, needVerify: !!result.needVerify,
        message: result.alreadyLoggedIn ? '抖音已登录，可以开始转写。'
          : result.needVerify ? '请在打开的 Chrome 中完成抖音验证，再检查登录状态。' : '请在打开的 Chrome 中登录抖音，完成后点击“检查登录状态”。',
      } });
    } finally { loginBusy = false; }
  }));
  router.post('/douyin/login/status', route(async (_req, res) => {
    const result = await scraper().checkLoginResult();
    res.json({ success: true, data: {
      loggedIn: !!result.loggedIn, needVerify: !!result.needVerify,
      message: result.loggedIn ? '抖音登录成功，可以开始转写。'
        : result.needVerify ? '请在 Chrome 中完成抖音验证。' : '尚未确认登录，请在 Chrome 中完成登录后再次检查；若浏览器已关闭，请重新登录。',
    } });
  }));
  router.get('/:id', route(async (req, res) => res.json({ success: true, data: await service.get(req.params.id) })));
  router.delete('/:id', route(async (req, res) => {
    assertLocalClient(req, '请在运行 MuseDock 的电脑上删除转写记录。');
    if (!req.is('application/json') || req.body?.confirmed !== true || Object.keys(req.body).some(key => key !== 'confirmed')) {
      throw new TranscriptionError('DELETE_NOT_CONFIRMED', '请先确认删除这条转写及其全部本地文件。');
    }
    res.json({ success: true, data: await service.remove(req.params.id) });
  }));
  router.post('/:id/corrections/retry', route(async (req, res) => res.status(202).json({ success: true, data: await service.retryCorrection(req.params.id) })));
  router.get('/:id/files/:kind', route(async (req, res) => {
    const file = await service.file(req.params.id, req.params.kind);
    res.set('X-Content-Type-Options', 'nosniff');
    if (file.contentType) res.type(file.contentType).sendFile(file.path);
    else res.download(file.path, file.name);
  }));
  router.post('/:id/files/:kind', createLocalFileOpenHandler(async req =>
    (await service.file(req.params.id, req.params.kind)).path));
  return router;
}

module.exports = createTranscriptionRouter();
module.exports.createTranscriptionRouter = createTranscriptionRouter;
