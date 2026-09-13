const { createSceneRenderPool } = require('./sceneRenderPool');

const MAX_CONCURRENCY = 10;

function createAnnotationPool(value) {
  return createSceneRenderPool(value, { defaultConcurrency: MAX_CONCURRENCY,
    maxConcurrency: MAX_CONCURRENCY, cancelMessage: '落墨编排已取消。' });
}

// 复用单幕的公平排队机制；模型编排与本地视频渲染各自共享进程级并发上限。
const annotationPool = createAnnotationPool(process.env.MUSEDOCK_WHITEBOARD_ANNOTATION_CONCURRENCY);

module.exports = { MAX_CONCURRENCY, createAnnotationPool, annotationPool };
