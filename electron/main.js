const { app, BrowserWindow, utilityProcess, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');

// 首选冷门端口，被占用时自动换系统分配的空闲端口
const PREFERRED_PORT = 38017;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let serverProc = null;
let mainWindow = null;

function getFreePort(preferred) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => {
      const fallback = net.createServer();
      fallback.once('error', reject);
      fallback.listen(0, '127.0.0.1', () => {
        const port = fallback.address().port;
        fallback.close(() => resolve(port));
      });
    });
    probe.listen(preferred, '127.0.0.1', () => {
      probe.close(() => resolve(preferred));
    });
  });
}

function startServer(port) {
  const dataDir = app.getPath('userData');
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
  const logStream = fs.createWriteStream(path.join(dataDir, 'logs', 'server.log'), { flags: 'a' });

  serverProc = utilityProcess.fork(path.join(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      MUSEDOCK_DATA_DIR: dataDir,
      MUSEDOCK_PORT: String(port),
      MUSEDOCK_HOST: '127.0.0.1',
    },
    stdio: 'pipe',
  });
  serverProc.stdout.on('data', (chunk) => logStream.write(chunk));
  serverProc.stderr.on('data', (chunk) => logStream.write(chunk));
}

// 等 server 子进程通过 IPC 握手，而不是 HTTP 探测——端口被别的程序占用时不会误判
function waitForServerReady(proc, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server 启动超时')), timeoutMs);
    proc.on('message', (msg) => {
      if (msg && msg.type === 'server-ready') {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server 进程异常退出（code ${code}），详见日志 logs/server.log`));
    });
  });
}

async function createWindow() {
  const port = await getFreePort(PREFERRED_PORT);
  const origin = `http://127.0.0.1:${port}`;

  startServer(port);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    autoHideMenuBar: true,
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) event.preventDefault();
  });

  await waitForServerReady(serverProc);
  mainWindow.loadURL(origin);
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  createWindow().catch((err) => {
    dialog.showErrorBox('MuseDock 启动失败', err.message);
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  if (serverProc) serverProc.kill();
});
