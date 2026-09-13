const { createSceneRenderPool } = require('./sceneRenderPool');
const { imageConcurrency } = require('../../../resources/whiteboard/concurrency-settings.json');

function createImagePool(value) {
  return createSceneRenderPool(value, { defaultConcurrency: imageConcurrency.default,
    maxConcurrency: imageConcurrency.max, cancelMessage: '线稿生成已取消。' });
}

const imagePool = createImagePool(process.env.MUSEDOCK_WHITEBOARD_IMAGE_CONCURRENCY);

module.exports = { createImagePool, imagePool };
