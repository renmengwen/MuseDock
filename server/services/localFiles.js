const fsp = require('fs/promises');
const path = require('path');
const net = require('net');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execute = promisify(execFile);
const OPENABLE_EXTENSIONS = new Set([
  '.txt', '.srt', '.vtt', '.ass', '.json', '.md', '.yaml', '.yml', '.pdf',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.mp4', '.webm', '.mov', '.mkv', '.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac',
]);

class LocalFileError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function isLoopback(value) {
  const host = String(value || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  return host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1'
    || (net.isIP(host) === 4 && host.startsWith('127.'));
}

function assertLocalClient(req, message = '请在运行 MuseDock 的电脑上打开本地文件。') {
  let host;
  let origin;
  try {
    host = new URL(`http://${req.get('host')}`);
    if (req.get('origin')) origin = new URL(req.get('origin'));
  } catch { throw new LocalFileError('LOCAL_FILE_FORBIDDEN', message, 403); }
  if (!isLoopback(req.socket?.remoteAddress) || !isLoopback(host.hostname) || host.username || host.password
    || (origin && (!['http:', 'https:'].includes(origin.protocol) || !isLoopback(origin.hostname) || origin.username || origin.password))
    || req.get('sec-fetch-site') === 'cross-site') {
    throw new LocalFileError('LOCAL_FILE_FORBIDDEN', message, 403);
  }
}

function assertLocalFileRequest(req) {
  assertLocalClient(req);
  if (!req.is('application/json') || !req.body || Array.isArray(req.body)
    || Object.keys(req.body).some(key => key !== 'target')
    || !['file', 'folder'].includes(req.body.target)) {
    throw new LocalFileError('LOCAL_FILE_INVALID_REQUEST', '打开文件参数无效，请刷新页面后重试。');
  }
  return req.body.target;
}

async function openLocalFile(filePath, { target = 'file', platform = process.platform, executeImpl = execute } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !['file', 'folder'].includes(target)) {
    throw new LocalFileError('LOCAL_FILE_INVALID', '本地文件位置无效，请重新加载这条记录。');
  }
  let fullPath;
  try {
    fullPath = await fsp.realpath(filePath);
    if (!(await fsp.stat(fullPath)).isFile()) throw new Error();
  } catch { throw new LocalFileError('LOCAL_FILE_NOT_FOUND', '本地文件不存在或无法读取，请重新加载这条记录。', 404); }
  if (target === 'file' && !OPENABLE_EXTENSIONS.has(path.extname(fullPath).toLowerCase())) {
    throw new LocalFileError('LOCAL_FILE_TYPE_UNSUPPORTED', '此文件类型请通过“打开所在文件夹”查看。');
  }
  const destination = target === 'folder' ? path.dirname(fullPath) : fullPath;
  let command;
  let args;
  if (platform === 'win32') {
    // 路径只作为数据解码，避免空格、中文、引号或 & 被解释为 PowerShell 命令。
    const encodedPath = Buffer.from(destination, 'utf8').toString('base64');
    command = 'powershell.exe';
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference = 'Stop'; $museDockFilePath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')); Start-Process -FilePath $museDockFilePath -ErrorAction Stop`];
  } else if (platform === 'darwin' || platform === 'linux') {
    command = platform === 'darwin' ? 'open' : 'xdg-open';
    args = [destination];
  } else {
    throw new LocalFileError('LOCAL_FILE_PLATFORM_UNSUPPORTED', '当前系统暂不支持自动打开本地文件。');
  }
  try {
    await executeImpl(command, args, { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 });
  } catch {
    throw new LocalFileError('LOCAL_FILE_OPEN_FAILED', target === 'folder'
      ? '无法打开文件所在文件夹，请检查系统文件管理器后重试。'
      : '无法用默认程序打开此文件，请点击“打开所在文件夹”查看，或为此文件类型设置默认应用。', 500);
  }
}

function createLocalFileOpenHandler(resolveFile, { openFile } = {}) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const target = assertLocalFileRequest(req);
      const filePath = await resolveFile(req, res);
      if (res.headersSent) return;
      await (openFile || req.app?.locals?.localFileOpener || openLocalFile)(filePath, { target });
      return res.json({ success: true, message: target === 'folder' ? '已请求系统打开文件所在文件夹。' : '已请求系统打开本地文件。' });
    } catch (error) {
      if (res.headersSent) return;
      const known = Number.isInteger(error.status) && error.status >= 400 && error.status < 600;
      return res.status(known ? error.status : 500).json({ success: false,
        code: known ? error.code : 'LOCAL_FILE_OPEN_FAILED',
        message: known ? error.message : '无法打开本地文件，请检查文件是否存在后重试。' });
    }
  };
}

module.exports = { LocalFileError, isLoopback, assertLocalClient, assertLocalFileRequest, openLocalFile, createLocalFileOpenHandler };
