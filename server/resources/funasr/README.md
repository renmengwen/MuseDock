# 抖音转写与独立 FunASR 服务

在 MuseDock 左侧栏点击 **抖音转写**，粘贴单条公开视频链接、分享文案或视频 ID。输入框下方可选择是否自动校订，然后点击 **开始转写**。此工具复用 MuseDock 自己的抖音解析、媒体下载与 FFmpeg 能力，独立保存转写任务，不创建视频创作任务。

- **仅转写**：使用 FunASR，保存原始文字、句级 SRT、JSON 和音频。
- **自动校订**：转写完成后调用设置中心选择的分析模型，只校订文字与标点，原始文件保持不变。默认关闭，启用后会使用分析模型的配额。
- **失败恢复**：校订失败仍可阅读、下载原始结果；“仅重试校订”复用已有转写，不再次下载或请求 ASR。
- **后台运行**：关闭弹框不会中断任务。重新打开或刷新页面可恢复上次任务的状态。服务进程重启后会标记中断，保留已生成产物。
- **按需启动**：选择内置本地 FunASR 后，点击“开始转写”会先检查服务；服务未运行时，MuseDock 在后台启动自己的 Python 服务并等待模型加载完成。页面会显示启动进度；已运行的兼容服务直接复用。电脑重启后，启动 MuseDock 即可继续使用，不必另开终端启动 FunASR。
- **抖音登录**：弹框底部的“登录抖音”打开本机 Chrome。完成登录或平台验证后，点击“检查登录状态”。不会自动绕过登录、验证码或私密视频限制。

## 已有 FunASR 环境

可以直接使用现有的 **OpenAI-compatible HTTP 服务**，Base URL 示例为 `http://127.0.0.1:8000/v1`。服务应接受 `POST /v1/audio/transcriptions` 的 multipart 音频和 `response_format=verbose_json`，返回原生 `sentence_info`（毫秒）或有效的 `segments`（秒）。原生句级时间需要 `Paraformer + FSMN-VAD + CT-Punc` 与 `sentence_timestamp=True`。

不同 FunASR 包装器可能按文字长度估算时间。MuseDock 不生成这种时间轴，缺失、无效或明确标记为估算的时间戳会报错。第三方服务只返回 `segments` 时，产物记为 `provider_segments`；不声称已验证其内部时间戳来源。需要明确的原生证据时，使用本目录的独立服务：

```powershell
# 在项目根目录执行；用你已有 FunASR 环境的 Python 替换下面的占位路径。
& '<FunASR环境>\Scripts\python.exe' server/resources/funasr/server.py --port 8000
```

已有模型缓存可以通过 `MODELSCOPE_CACHE` 或 `--model-cache '<缓存目录>'` 指定。服务只读取该环境中的 FunASR 包和模型缓存，不导入任何其他业务项目。端口被占用时，请改用空闲端口，例如 `--port 18000`，并同步修改 MuseDock 全局 ASR 下方的服务地址；脚本不会关闭已有服务。

要让 MuseDock 自动启动已有环境，在全局 ASR 下方填写 **FunASR Python 路径（可选）** 和 **FunASR 模型缓存目录（可选）** 后保存。Python 路径应指向已安装上述依赖的解释器，例如 `<FunASR环境>\Scripts\python.exe`，不填写启动命令或命令行参数。模型缓存目录对应已有的 `MODELSCOPE_CACHE`；留空使用 ModelScope 默认缓存。这些本机路径只保存在本地模型配置中。

## 新用户安装

需要 Python 3.10+、FFmpeg、ffprobe；推荐使用 Python 3.11 的独立虚拟环境。下面是 CPU 环境示例：

```powershell
python -m venv .venv-funasr
.venv-funasr/Scripts/python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
.venv-funasr/Scripts/python -m pip install -r server/resources/funasr/requirements.txt
.venv-funasr/Scripts/python server/resources/funasr/server.py --port 8000
```

Linux/macOS 对应的 Python 路径为 `.venv-funasr/bin/python`。首次启动会通过 FunASR 下载 Paraformer、VAD 和标点模型；使用和分发模型时遵守各模型自己的许可。模型和 Python 环境不随 MuseDock 安装包分发。`requirements.txt` 固定了桥接服务依赖；PyTorch/torchaudio 需安装相互匹配且适合本机 CPU 或 CUDA 的版本。

本服务默认仅监听 `127.0.0.1`，本地使用无需 API Key。需要鉴权的自部署服务仍可通过供应商配置接入：启动前设置 `FUNASR_API_KEY`，并在 MuseDock 对应供应商中填写相同 API Key。输入音频仅在推理期间写入临时目录，处理后清理；返回原生句级证据，缺少 `sentence_info` 时直接报错。

## MuseDock 设置

1. 打开 **设置 → 模型配置 → 全局模型选择 → ASR 转写**，直接选择 **FunASR（本地，默认）**。新配置及此前未选择 ASR 的配置会默认使用它，无需添加供应商或填写 API Key。
2. 该选项使用 `paraformer`，默认服务地址为 `http://127.0.0.1:8000/v1`。使用其他端口时，在下拉框下方的 **FunASR 服务地址** 中修改。
3. 修改后点击 **保存模型配置**。Python 依赖仍需先安装一次；开始抖音转写时会自动启动本机服务。已有独立 Python 环境和模型缓存时，填写下方两个可选路径即可复用。模型首次加载时，如缓存缺失，FunASR 会下载模型。
4. 若要自动校订，再配置并选择一个分析模型。支持项目现有的 OpenAI Responses 或 Anthropic Messages 协议。

全局下拉框也保留已配置的供应商 ASR；已有明确选择会继续保留，需要时可手动切换到内置 FunASR。自部署且需要鉴权的 FunASR 可以继续在供应商中配置。

也可显式指定环境变量 `ASR_PROVIDER=funasr`，配合 `FUNASR_BASE_URL`、可选的 `FUNASR_API_KEY`、`ASR_MODEL=paraformer` 使用自定义服务。内置本地选项固定使用 Paraformer，不携带 API Key，也不会借用其他供应商的地址或密钥；`FUNASR_BASE_URL` 可覆盖其本地地址。分析模型仍使用项目既有配置。

### 自动启动范围与排错

- 自动启动仅适用于内置选项的 HTTP 回环地址（`127.0.0.1`、`localhost` 或 `::1`），服务地址应以 `/v1` 结尾。远程地址、HTTPS 地址和供应商 ASR 仍由各自的部署环境管理，不会在本机代为启动。
- 未填写 Python 路径时，按顺序检查应用数据根目录下的 `data/runtime/funasr`、项目的 `.venv-funasr`、当前 `VIRTUAL_ENV`，再检查系统 `python` / `python3`。只检查已有依赖，不自动安装 Python 或软件包。
- `FUNASR_PYTHON`、`MODELSCOPE_CACHE` 可以覆盖保存的两个路径；`FUNASR_DEVICE` 默认 `cpu`。内置选项自动启动时清空子进程的 `FUNASR_API_KEY`，保持本地免密使用。
- 默认最多等待 5 分钟加载模型；可以通过 `FUNASR_START_TIMEOUT_MS` 调整，最长 30 分钟。缺少环境、端口冲突、启动失败或超时都会结束当前任务并给出中文提示；修复后重新开始转写。设置 `FUNASR_AUTO_START=0` 可以恢复手动管理。
- 并发请求共用一次启动，后续任务复用已加载的模型。MuseDock 后端结束时，它自动启动的服务也会随父进程管道关闭而退出；已手动运行的服务保持独立。打开弹框或查看配置不会触发启动。

## 产物与验证边界

任务写入应用数据根目录的 `data/transcriptions/<任务ID>/`；Electron 使用自身的用户数据目录。文件包括原始 TXT/SRT/JSON、来源元数据、媒体 SHA-256、音频与每段 ASR 响应。校订版和校订记录保存在独立的 `corrections/<尝试ID>/` 中，记录每项原文、改文、理由与未变的时间码。下载前会检查文件 SHA-256。

工具当前接收单条抖音来源，支持 2 小时以内、源视频不超过 512 MiB 的视频，一次运行一个任务。音频统一为 16 kHz 单声道 WAV，小于请求上限时整段转写；较长音频按 180 秒分段，保留各段在原音频中的偏移。ASR 失败保留已收到的分段证据，但当前界面不提供失败 ASR 片段的续跑。自动校订不会修改字幕数量、编号或起止时间，也不会核听音频；用户可对照原始版审阅文字。

本工具及桥接服务均属于 MuseDock 自身代码，不依赖 Codex、外部 skill 目录或其他业务项目。
