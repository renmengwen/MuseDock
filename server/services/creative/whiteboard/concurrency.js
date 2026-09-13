const { imagePool } = require('./imagePool');
const { annotationPool } = require('./annotationPool');
const { sceneRenderPool } = require('./sceneRenderPool');

let initialized = false;
let initialization;

function configureWhiteboardConcurrency(settings = {}) {
  imagePool.setConcurrency(settings.imageConcurrency);
  annotationPool.setConcurrency(settings.annotationConcurrency);
  sceneRenderPool.setConcurrency(settings.renderConcurrency);
  initialized = true;
}

async function ensureWhiteboardConcurrency(loadSettings) {
  if (initialized) return;
  if (!initialization) {
    initialization = Promise.resolve().then(loadSettings).then(settings => {
      // 设置中心可能已经保存了更新值，迟到的启动读取不能覆盖它。
      if (!initialized) configureWhiteboardConcurrency(settings);
    }).finally(() => { initialization = null; });
  }
  await initialization;
}

module.exports = { configureWhiteboardConcurrency, ensureWhiteboardConcurrency };
