const path = require('path');

// 所有可写数据（DB/cookie/媒体/配置）的根目录。
// Electron 打包后由主进程注入 MUSEDOCK_DATA_DIR 指向 userData；开发环境缺省为仓库根目录。
module.exports = process.env.MUSEDOCK_DATA_DIR || path.join(__dirname, '..');
