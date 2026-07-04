const { app, BrowserWindow, utilityProcess, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

// 固定冷门端口，避开常见的 3000 冲突；浏览器访问 http://127.0.0.1:38017 同样可用
const PORT = 38017;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let serverProc = null;
let mainWindow = null;

function startServer() {
  const dataDir = app.getPath('userData');
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
  const logStream = fs.createWriteStream(path.join(dataDir, 'logs', 'server.log'), { flags: 'a' });

  serverProc = utilityProcess.fork(path.join(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      MUSEDOCK_DATA_DIR: dataDir,
      MUSEDOCK_PORT: String(PORT),
    },
    stdio: 'pipe',
  });
  serverProc.stdout.on('data', (chunk) => logStream.write(chunk));
  serverProc.stderr.on('data', (chunk) => logStream.write(chunk));
}

function waitForServer(retries = 150) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const req = http.get(`http://127.0.0.1:${PORT}/`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (left <= 0) return reject(new Error('server 启动超时'));
        setTimeout(() => attempt(left - 1), 200);
      });
    };
    attempt(retries);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    autoHideMenuBar: true,
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await waitForServer();
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  startServer();
  createWindow().catch((err) => {
    console.error(err);
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  if (serverProc) serverProc.kill();
});
