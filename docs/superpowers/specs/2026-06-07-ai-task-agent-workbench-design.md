# AI 工作台任务流 Agent 设计

## 背景

MuseDock 已经跑通抖音抓取、评论缓存、素材准备、关键帧抽取和 ASR 转写。当前断点在 AI 工作台：`frontend-react/src/pages/AiWorkspace.jsx` 仍是占位页，`analysis_input.json` 已具备素材上下文雏形，但还没有把本地素材转化为可复用的创作产物。

第一版 AI 工作台采用“任务流 Agent”，不是开放式聊天机器人。用户选择明确任务，Agent 按固定步骤调用本地能力和文本模型，生成结构化结果并保存。

## 目标

- 提供第一个可用 Agent 模板：爆款拆解 + 改写脚本。
- 串联已有素材、转写、评论缓存和文本模型配置。
- 在界面中展示 Agent 执行步骤、当前状态、失败原因和最终结果。
- 将每次生成结果持久化到素材目录，支持回看、复制和重新生成。

## 非目标

- 不做开放式自由聊天 Agent。
- 不自动重新抓取抖音数据。
- 不自动触发素材准备或 ASR 转写，只提示用户去素材工作台处理缺失项。
- 不接入图像生成、视频生成或多模态视觉理解。
- 不在第一版实现全局任务队列；Agent 调用仍通过单次请求完成。

## 用户流程

1. 用户进入 AI 工作台。
2. 选择一个抖音素材，来源可以是抓取记录、素材工作台跳转或手动输入 `aweme_id`。
3. 选择任务模板“爆款拆解 + 改写脚本”。
4. 点击“开始执行”。
5. Agent 执行固定步骤：
   - 检查素材状态。
   - 读取 `analysis_input.json`。
   - 读取 `transcript.json`。
   - 读取本地评论缓存。
   - 构建模型上下文。
   - 调用设置页中的 `text` 模型。
   - 保存 Agent 运行结果。
6. 前端展示步骤状态和结构化结果。

## Agent 模板

### 爆款拆解 + 改写脚本

输入：
- 视频元数据：标题、作者、统计数据、链接。
- 转写文本：优先读取 `transcript.text`。
- 评论摘要：从本地评论缓存聚合，不要求必须存在。
- 素材状态：视频、音频、关键帧、转写状态。

输出：
- 内容摘要。
- 爆点拆解。
- 受众画像。
- 评论洞察。
- 可复用选题。
- 改写脚本。
- 标题建议。

评论为空时，Agent 仍可执行，但结果中应明确标注“未读取到本地评论缓存，评论洞察基于视频内容推断”。

## 后端设计

新增 `server/services/aiTextModel.js`：
- 读取 `aiModelConfig.getRuntimeConfig('text')`。
- 校验 `enabled`、`apiKey`、`baseUrl`、`modelId`。
- 调用 OpenAI-compatible `POST /chat/completions`。
- 返回统一结果：`success`、`message`、`text`、`raw_response`。

新增 `server/services/agentRuns.js`：
- 根据 `aweme_id` 定位素材目录。
- 读取素材状态、`analysis_input.json`、`transcript.json` 和本地评论。
- 构造“爆款拆解 + 改写脚本”的 prompt。
- 调用 `aiTextModel`。
- 解析模型输出为结构化 JSON；解析失败时保留原始文本。
- 将结果写入 `data/media/douyin/<aweme_id>/agent_runs/<run_id>.json`。

新增 `server/routes/agents.js`：
- `POST /api/agents/douyin/:aweme_id/runs`
  - 请求体：`{ template: 'viral_rewrite' }`
  - 返回本次执行结果。
- `GET /api/agents/douyin/:aweme_id/runs`
  - 返回该素材的历史 Agent 运行记录。
- `GET /api/agents/douyin/:aweme_id/runs/:run_id`
  - 返回单次运行详情。

## 前端设计

改造 `frontend-react/src/pages/AiWorkspace.jsx`：
- 顶部：素材选择区，支持输入 `aweme_id` 并加载状态。
- 左侧：任务模板列表，第一版只有“爆款拆解 + 改写脚本”。
- 中间：Agent 执行步骤面板。
- 右侧：结果面板，按模块展示摘要、爆点、评论洞察、脚本和标题。
- 底部或侧栏：历史运行记录。

新增 API 客户端方法：
- `createDouyinAgentRun(awemeId, template)`
- `listDouyinAgentRuns(awemeId)`
- `getDouyinAgentRun(awemeId, runId)`

执行期间必须显示明确 loading 文案，例如“正在读取素材上下文...”“正在请求文本模型生成分析...”。按钮在执行期间禁用，避免重复触发。

## 数据结构

Agent 运行结果文件：

```json
{
  "run_id": "20260607-153012-viral_rewrite",
  "template": "viral_rewrite",
  "aweme_id": "1234567890",
  "status": "done",
  "model": {
    "provider": "OpenAI",
    "model_id": "gpt-4o-mini"
  },
  "steps": [
    { "id": "status", "label": "检查素材状态", "status": "done" },
    { "id": "transcript", "label": "读取转写文本", "status": "done" },
    { "id": "comments", "label": "读取评论缓存", "status": "done" },
    { "id": "generate", "label": "生成分析结果", "status": "done" }
  ],
  "input_summary": {
    "has_transcript": true,
    "comment_count": 120,
    "frame_count": 8
  },
  "result": {
    "summary": "",
    "viral_points": [],
    "audience": "",
    "comment_insights": [],
    "topics": [],
    "rewrite_script": "",
    "titles": []
  },
  "raw_text": "",
  "message": "生成完成",
  "created_at": "2026-06-07T15:30:12.000Z"
}
```

## 错误处理

- 未找到素材：提示“未找到该视频素材，请先进入素材工作台准备 AI 素材”。
- 未转写：提示“未找到转写文本，请先完成 ASR 转写”。
- 文本模型未配置：提示“文本模型未配置，请到设置页启用并填写 API Key、Base URL 和模型 ID”。
- 评论缺失：不阻断执行，只在结果中说明评论洞察依据不足。
- 模型调用失败：保存失败状态和错误信息，前端允许重新执行。
- 模型返回非 JSON：保存 `raw_text` 并显示“模型返回未能解析为结构化结果”。

## 测试

新增后端测试：
- 文本模型配置缺失时返回未配置。
- Agent 在缺少素材时返回明确错误。
- Agent 在缺少评论时仍可生成。
- Agent 运行结果写入 `agent_runs` 目录。
- 模型返回结构化 JSON 时能正确解析。
- 模型返回普通文本时保留 `raw_text`。

前端验证：
- AI 工作台加载空状态。
- 输入已存在 `aweme_id` 后可加载素材状态。
- 执行期间按钮禁用并展示 loading。
- 成功后展示结构化结果。
- 失败后展示中文错误信息。

## 后续扩展

- 增加评论洞察 Agent。
- 增加小红书改写 Agent。
- 将素材准备、ASR、Agent 运行统一接入任务队列。
- 增加结果导出为 Markdown、JSON 或文档。
- 在 Agent 模板稳定后，再加入轻量对话入口。
