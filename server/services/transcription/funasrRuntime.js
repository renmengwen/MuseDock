const fs = require('fs');
const path = require('path');
const { recordedFetch } = require('../diagnostics/apiCallRecorder');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { setTimeout: delay } = require('timers/promises');
const { TranscriptionError, transcriptionEndpoint } = require('./funasr');

const execute = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SERVER_SCRIPT = path.join(__dirname, '../../resources/funasr/server.py');
const PYTHON_CHECK = [
  'import importlib.util, sys',
  'names = ("funasr", "torch", "torchaudio", "fastapi", "uvicorn", "multipart", "soundfile")',
  'sys.exit(0 if sys.version_info >= (3, 10) and all(importlib.util.find_spec(name) for name in names) else 1)',
].join('\n');

function localTarget(config) {
  if (!config.builtin || config.provider !== 'funasr') return null;
  const endpoint = new URL(transcriptionEndpoint(config.baseUrl));
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) return null;
  // 启动锁合并 localhost 别名，但探测保留原地址，以复用仅监听 IPv6 的现有服务。
  const lockUrl = new URL(endpoint);
  if (lockUrl.hostname === 'localhost') lockUrl.hostname = '127.0.0.1';
  return { endpoint, key: lockUrl.origin, host: lockUrl.hostname.replace(/^\[|\]$/g, ''), port: Number(endpoint.port || 80) };
}

function connectionRefused(error) {
  const cause = error?.cause || error;
  return cause?.code === 'ECONNREFUSED'
    || (cause?.errors?.length > 0 && cause.errors.every(connectionRefused));
}

function startupError(diagnostic = '') {
  if (/ModuleNotFoundError|ImportError|DLL load failed/i.test(diagnostic)) {
    return new TranscriptionError('ASR_DEPENDENCIES_MISSING', 'FunASR 的 Python 依赖缺失或不兼容，请在所选环境中安装 FunASR 服务依赖及匹配的 PyTorch、torchaudio。', 503);
  }
  if (/address already in use|10048|10013|Errno 98|Errno 48/i.test(diagnostic)) {
    return new TranscriptionError('ASR_PORT_IN_USE', 'FunASR 端口已被占用或禁止监听，请在模型设置中更换本地服务端口。', 503);
  }
  return new TranscriptionError('ASR_START_FAILED', 'FunASR 启动失败，请检查所选 Python 环境、模型缓存和模型下载网络后重试。', 503);
}

function createFunasrRuntime(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = recordedFetch(options.fetchImpl || globalThis.fetch, { category: 'transcription' });
  const spawnImpl = options.spawnImpl || spawn;
  const runPython = options.execute || execute;
  const starts = new Map();
  const children = new Map();
  const configuredTimeout = Number(env.FUNASR_START_TIMEOUT_MS);
  const startTimeoutMs = options.startTimeoutMs ?? (Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.min(configuredTimeout, 1800000) : 300000);
  const probeTimeoutMs = options.probeTimeoutMs ?? 1500;
  const pollIntervalMs = options.pollIntervalMs ?? 750;

  async function getJson(url, timeoutMs) {
    try {
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))) });
      const payload = await response.json().catch(() => null);
      return { status: response.status, ok: response.ok, payload };
    } catch (error) {
      if (connectionRefused(error)) return { stopped: true };
      throw new TranscriptionError('ASR_HEALTH_UNAVAILABLE', '本地 FunASR 服务未响应健康检查，请检查服务状态和端口；稍后可重新开始转写。', 503);
    }
  }

  async function probe(target, timeoutMs = probeTimeoutMs) {
    const health = await getJson(`${target.endpoint.origin}/health`, timeoutMs);
    if (health.stopped) return 'stopped';
    if (health.ok && health.payload?.status === 'ready' && health.payload?.model === 'paraformer'
      && health.payload?.timing_source === 'funasr_sentence_info') return 'ready';
    if (['loading', 'starting'].includes(health.payload?.status)) return 'loading';
    // 兼容已手动启动且只提供 OpenAI 模型列表的服务，不要求第三方实现 /health。
    const modelsUrl = new URL(target.endpoint);
    modelsUrl.pathname = modelsUrl.pathname.replace(/\/audio\/transcriptions$/, '/models');
    const models = await getJson(modelsUrl.href, timeoutMs);
    if (models.stopped) return 'stopped';
    if (models.ok && Array.isArray(models.payload?.data)
      && models.payload.data.some(model => ['paraformer', 'paraformer-zh'].includes(model?.id))) return 'ready';
    if ([health.status, models.status].some(status => status === 401 || status === 403)) {
      throw new TranscriptionError('ASR_LOCAL_AUTH_REQUIRED', '此 FunASR 服务需要鉴权，请通过供应商配置填写服务地址与 API Key，再选择该供应商的 ASR 模型。', 401);
    }
    if (health.status === 503 || models.status === 503) return 'loading';
    throw new TranscriptionError('ASR_PORT_IN_USE', '本地服务地址已有其他服务响应，但未检测到可用的 Paraformer。请检查 FunASR 服务地址或更换端口。', 503);
  }

  async function findPython(config) {
    const explicit = String(env.FUNASR_PYTHON || config.pythonPath || '').trim();
    const executable = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
    const dataRoot = options.dataRoot || require('../../dataRoot');
    const projectRoot = options.projectRoot || PROJECT_ROOT;
    const candidates = explicit ? [explicit] : [
      path.join(dataRoot, 'data/runtime/funasr', executable),
      path.join(projectRoot, '.venv-funasr', executable),
      ...(env.VIRTUAL_ENV ? [path.join(env.VIRTUAL_ENV, executable)] : []),
      'python', 'python3',
    ];
    for (const candidate of new Set(candidates)) {
      if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
      try {
        await runPython(candidate, ['-B', '-c', PYTHON_CHECK], {
          cwd: projectRoot, env: { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
          windowsHide: true, shell: false, timeout: 10000, maxBuffer: 64 * 1024,
        });
        return candidate;
      } catch { /* 候选环境只检查依赖，不加载模型，也不自动安装包。 */ }
    }
    throw new TranscriptionError('ASR_PYTHON_NOT_READY', explicit
      ? '配置的 FunASR Python 无法运行或缺少依赖，请检查“FunASR Python 路径”并按安装说明补齐依赖。'
      : '未找到已安装 FunASR 的 Python 环境。请在模型设置中填写“FunASR Python 路径”，或按安装说明创建项目的 .venv-funasr 环境。', 503);
  }

  function stop(state) {
    if (children.get(state.key) === state) children.delete(state.key);
    // 关闭父进程管道让实际 Python 进程退出，兼容 Windows venv 的解释器转发进程。
    state.child.stdin?.end();
    if (!state.exited) state.child.kill();
  }

  function launch(target, python, config) {
    let child;
    const modelCache = String(env.MODELSCOPE_CACHE || config.modelCache || '').trim();
    try {
      child = spawnImpl(python, ['-B', SERVER_SCRIPT, '--host', target.host, '--port', String(target.port),
        '--device', env.FUNASR_DEVICE || 'cpu', '--parent-stdin',
        ...(modelCache ? ['--model-cache', modelCache] : [])], {
        cwd: options.projectRoot || PROJECT_ROOT, shell: false, windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe'],
        // 内置本地服务不继承其他供应商或显式 ASR 配置的鉴权。
        env: { ...env, FUNASR_API_KEY: '', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
      });
    } catch { throw startupError(); }
    const state = { key: target.key, child, exited: false, error: null, diagnostic: '' };
    children.set(target.key, state);
    child.stdin?.on('error', () => {});
    child.stderr?.on('data', chunk => {
      // 仅在内存保留有限诊断用于错误分类，不把原始路径、下载地址或环境信息写入任务/日志。
      state.diagnostic = (state.diagnostic + String(chunk)).slice(-8192);
    });
    child.once('error', () => { state.error = startupError(); });
    child.once('close', () => {
      state.exited = true;
      state.error ||= startupError(state.diagnostic);
      if (children.get(target.key) === state) children.delete(target.key);
    });
    child.unref();
    child.stdin?.unref?.();
    child.stderr?.unref?.();
    return state;
  }

  async function ensureRunning(target, config, report) {
    await report('正在检查本地 FunASR 服务...');
    let state = children.get(target.key);
    const initial = await probe(target);
    if (initial === 'ready') return { started: false };
    if (initial === 'stopped' && !state) {
      if (target.endpoint.pathname !== '/v1/audio/transcriptions') {
        throw new TranscriptionError('ASR_AUTOSTART_URL_INVALID', '自动启动的 FunASR 服务地址需要使用 http://127.0.0.1:端口/v1，请在模型设置中修改。');
      }
      await report('FunASR 尚未运行，正在检查本地 Python 环境...');
      const python = await findPython(config);
      // 检查 Python 期间用户可能已手动启动服务，启动前再确认一次。
      const current = await probe(target);
      if (current === 'ready') return { started: false };
      if (current === 'stopped') {
        await report('正在启动 FunASR 并加载模型，首次运行可能需要下载模型...');
        state = launch(target, python, config);
      }
    }
    const startedAt = Date.now();
    try {
      while (Date.now() - startedAt < startTimeoutMs) {
        if (state?.error) throw state.error;
        const remaining = startTimeoutMs - (Date.now() - startedAt);
        if (await probe(target, Math.min(probeTimeoutMs, remaining)) === 'ready') {
          if (state?.error) throw state.error;
          await report('FunASR 已就绪，正在继续转写任务...');
          return { started: !!state };
        }
        await report(`正在等待 FunASR 加载模型（已等待 ${Math.floor((Date.now() - startedAt) / 1000)} 秒）...`);
        await delay(Math.min(pollIntervalMs, Math.max(1, startTimeoutMs - (Date.now() - startedAt))));
      }
      throw new TranscriptionError('ASR_START_TIMEOUT', '等待 FunASR 启动超时，请检查模型缓存、下载网络和 Python 环境后重新开始转写。', 504);
    } catch (error) {
      if (state) stop(state);
      throw error;
    }
  }

  async function ensure(config, { onProgress } = {}) {
    const target = localTarget(config);
    if (!target || env.FUNASR_AUTO_START === '0') return { started: false };
    let entry = starts.get(target.key);
    if (!entry) {
      entry = { listeners: new Set() };
      starts.set(target.key, entry);
      entry.promise = Promise.resolve().then(() => ensureRunning(target, config, async message => {
        for (const listener of entry.listeners) await listener({ message });
      })).finally(() => starts.delete(target.key));
    }
    if (onProgress) entry.listeners.add(onProgress);
    try { return await entry.promise; }
    finally { if (onProgress) entry.listeners.delete(onProgress); }
  }

  return { ensure, close() { for (const state of children.values()) stop(state); } };
}

const runtime = createFunasrRuntime();
module.exports = { createFunasrRuntime, ensureFunasrService: runtime.ensure };
