# html-video 完整二次编辑体系设计

## 背景

最新生成视频暴露了 html-video 成片链路的一个核心缺口：成片虽然能成功渲染，但单帧 HTML 内部可能出现文字错位、元素遮挡、装饰层压住正文等版式问题。当前发现的两个具体问题是：

- `scene_04`：`15s` 附近橙色卡片里的 `年薪报价 / 冲到新高位` 超出卡片底部，视觉上和 `600万` 的 `万` 叠在一起。
- `scene_06`：`32s` 附近右侧 `几十亿`、`上百亿` 估值标签绝对定位在正文区域上方，遮挡标题和正文。

这类问题不是 ffmpeg 拼接、字幕层或 TTS 时间轴问题，而是 raw HTML 帧的布局问题。当前 MediaCrawler-GUI 已有 html-video 工程、帧级预览和导出接口，但二次编辑能力还停留在结构化字段编辑，不能系统性解决“某一帧 HTML/CSS 需要重写或调整”的问题。

`D:\code3\html-video` 参考项目已经形成了更完整的二次编辑方向：

- 支持指定帧 raw HTML 的读写。
- 支持聚焦某一帧进行 single-frame iterate，AI 只重写当前帧。
- 支持全片 edit menu，把“改风格 / 改内容 / 改时长”拆成不同阶段。
- 支持逐帧 HTML 作为工程源数据，导出时按帧渲染并合成。

本设计目标是把 MediaCrawler-GUI 的 html-video 编辑从“字段补丁 + 重新导出”升级为完整二次编辑体系，后续可交给子代理按设计和实施计划分阶段实现。

## 目标

- 支持完整帧级二次编辑：源码查看、源码保存、AI 单帧重写、单帧预览、接受、回滚、导出。
- 支持完整全片级二次编辑：改风格、改内容、改时长、重排节奏、按已有内容重新生成多帧。
- 支持草稿机制：AI 或源码编辑先生成 draft，用户确认后才替换当前帧。
- 支持 DOM 布局质检：在单帧预览和导出前检查文字越界、文字重叠、装饰层遮挡正文等问题。
- 保留现有结构化编辑能力：标题、旁白、字幕、时长、template inputs、frame inputs 继续走安全的 edit patch。
- 明确 AI 权限边界：AI 可以生成完整帧 HTML，但只能写入 draft 或指定帧，不直接覆盖工程任意文件。
- 明确安全边界：所有 HTML 路径必须限制在 html-video project 目录内，所有读写操作必须记录 revision。
- 对齐 `D:\code3\html-video` 的核心流程，但不直接搬迁整个 studio/CLI。
- 给后续子代理留下足够细的设计信息，降低实现时反复追问和返工。

## 非目标

- 不在本期做 Premiere 式复杂 NLE。
- 不在本期做自由拖拽式元素编辑器。元素级编辑 API 会设计边界，但 UI 首版不实现拖拽。
- 不要求本期接入 Remotion native enhancement。保留接口空间，但不作为首批验收项。
- 不把 `D:\code3\html-video` 整仓库作为运行时依赖。
- 不让自然语言编辑直接写项目 JSON 任意字段。
- 不允许用户提交逃逸工程目录的 `html_path`、asset path、export path。

## 当前能力与缺口

### 已有能力

当前 MediaCrawler-GUI 已有以下接口和前端入口：

- 读取 html-video project：`GET /api/creative-workflows/:workflow_id/html-video-project`
- 保存项目 template inputs：`PATCH /html-video-project/inputs`
- 保存帧字段：`PATCH /html-video-project/frames/:frame_id`
- 自然语言编辑转 edit patch：`POST /html-video-project/edit`
- materialize：`POST /html-video-project/render`，`mode=materialize`
- 单帧预览：`POST /html-video-project/render`，`mode=frame`
- 导出成片：`POST /html-video-project/export`
- 导出列表和导出文件读取

当前结构化编辑由 `server/services/creative-video/html-video/editPatchService.js` 处理，支持：

- `template_inputs_patch`
- `frame_inputs_patch`
- `frame_patch`
- `narration_patch`
- `caption_patch`
- `duration_patch`
- `replace_frame_template`

当前 raw HTML 文案同步由 `rawHtmlTextPatch.js` 处理，只能根据 `data-text-key` 替换文本内容，不能改 CSS、class、布局或 z-index。

### 关键缺口

- `frames/:frame_id/html`、`frames/:frame_id/elements/:element_id`、`transition`、`enhance`、`unenhance` 路由当前是 reserved，返回 501。
- 前端没有 Source Tab，用户无法查看或保存当前帧 HTML。
- AI 自然语言编辑只能输出有限 `edit_patch`，不能输出“重写当前帧完整 HTML”。
- 没有 draft/accept/revert 机制，无法安全试错。
- 单帧预览只渲染 project 当前帧，不能预览尚未接受的 draft。
- 视觉 QA 只检查空白帧、低信息量、低运动和重复帧，不检查 DOM 布局遮挡。
- 全片级 post-generation edit menu 没有接入，用户说“换风格 / 改内容 / 调节奏”时无法稳定路由到正确编辑模式。

## 参考项目能力映射

来自 `D:\code3\html-video` 的可参考能力：

| 参考能力 | 参考位置 | MediaCrawler-GUI 设计落点 |
| --- | --- | --- |
| 指定帧 raw HTML GET/PUT | `packages/cli/src/studio-server.ts` 的 `/frames/:nodeId/raw-html` | 新增 `GET/PUT /creative-workflows/:workflow_id/html-video-project/frames/:frame_id/html` |
| `writeFrameHtml(projectId,nodeId,html)` | `packages/core/src/project.ts` | 新增 `frameHtmlEditService.writeFrameHtml()`，适配当前 project schema |
| single-frame iterate | `studio-server.ts` 中 `focusFrameId` 写回当前帧 | 新增 `POST /frames/:frame_id/iterate`，写入 draft |
| post-generation edit menu | `detectPhase` 的 `restyle / iterate-content / iterate-format` | 新增 `POST /html-video-project/plan-edit` 或并入 `edit`，返回明确 edit mode |
| restyle only | 保留 graph text，逐帧重新生成视觉 | 新增 `full_project_restyle` 模式 |
| 多帧 regenerate | content graph + 每帧 HTML 输出 | 新增 `full_project_regenerate_content` 模式 |
| source editor 保存 | SPIKE-REPORT 建议 Source Tab + PUT raw-html | 前端新增 Source Tab |

## 设计方案选择

### 方案 A：只开放 raw HTML 保存接口

优点：

- 改动少。
- 能手动修复当前错位帧。

缺点：

- 没有 AI 单帧重写。
- 没有草稿和回滚。
- 没有全片 edit menu。
- 后续仍会不断围绕源码保存补临时功能。

结论：不采用。它只能解决当前事故，不是完整二次编辑体系。

### 方案 B：帧级编辑完整化，全片级编辑后置

优点：

- 能解决当前问题。
- 能建立 Source、AI 单帧重写、草稿、预览、接受、回滚闭环。

缺点：

- 用户后续的“换整体风格 / 改内容 / 调节奏”仍需要再设计。
- 和 `D:\code3\html-video` 的完整编辑流仍有差距。

结论：适合作为分期执行的第一阶段，但不是本设计的最终范围。

### 方案 C：完整二次编辑体系一步到位

优点：

- 一次建立帧级和全片级编辑模型。
- 子代理可以按统一架构分阶段实现，不会先做临时接口再迁移。
- 后续错位修复、风格重做、内容重排、节奏调整都走同一套工作流。

缺点：

- 设计和测试范围大。
- 需要清晰拆任务，避免一次 PR 过大。

结论：采用。实施时仍按阶段拆，但设计一次定完整边界。

## 总体架构

完整二次编辑体系分为六层：

```text
前端编辑器
  -> html-video 编辑 API
  -> 编辑服务层
  -> draft/revision/project 存储
  -> materialize/render/export
  -> DOM layout QA + video QA
```

### 前端编辑器

核心页面仍使用现有 `HtmlVideoProjectEditor`，但扩展为多 Tab：

- `概览`：工程状态、导出状态、最近 revision、质检状态。
- `帧`：帧列表、帧字段、字幕、旁白、时长、单帧预览。
- `源码`：当前帧 HTML 源码查看、编辑、保存草稿。
- `AI 修改`：当前帧 AI 重写、全片编辑菜单、自然语言指令。
- `质检`：当前帧 DOM QA、全片 visual QA、可跳转到问题帧。
- `导出`：导出记录、导出按钮、播放链接。

### 编辑 API

新增 API 分三类：

- 帧源码 API：读取、保存草稿、接受草稿、回滚。
- AI 编辑 API：单帧 iterate、全片 edit plan、全片 restyle/content/format 执行。
- QA API：单帧 DOM QA、全片 DOM QA、导出前 QA。

### 编辑服务层

新增服务建议：

- `frameHtmlEditService.js`：负责帧 HTML 读写、草稿、接受、回滚、路径校验。
- `htmlVideoDraftService.js`：负责 draft 文件命名、draft metadata、过期清理。
- `htmlVideoIterateService.js`：负责 AI 单帧重写和全片编辑模式。
- `layoutQaService.js`：负责 Playwright DOM bbox 检查。
- `htmlVideoEditModeService.js`：负责自然语言编辑意图分类，区分 frame/layout/style/content/format。

不建议把这些全部塞进 `editPatchService.js`。`editPatchService.js` 继续只做结构化 JSON patch。

### 存储层

继续使用当前 html-video project 目录，不新增数据库。

建议 project 结构扩展：

```json
{
  "frames": [
    {
      "id": "scene_06",
      "source_mode": "raw_html",
      "html_path": "frames/06-scene_06.html",
      "drafts": [
        {
          "id": "draft_20260623_001",
          "kind": "ai_iterate",
          "html_path": "frames/.drafts/scene_06/draft_20260623_001.html",
          "created_at": "2026-06-23T14:00:00.000Z",
          "instruction": "修复估值标签遮挡正文",
          "status": "ready",
          "layout_qa": {
            "success": true,
            "issues": []
          },
          "preview_path": "inspect/previews/scene_06-draft_20260623_001.mp4"
        }
      ],
      "active_draft_id": "draft_20260623_001"
    }
  ],
  "edit_sessions": [
    {
      "id": "edit_20260623_001",
      "scope": "frame",
      "frame_id": "scene_06",
      "mode": "layout_fix",
      "instruction": "修复遮挡",
      "status": "draft_ready",
      "draft_id": "draft_20260623_001"
    }
  ],
  "layout_qa_reports": []
}
```

字段说明：

- `drafts` 记录挂在 frame 下，便于前端展示当前帧草稿历史。
- `active_draft_id` 只表示当前选中的待接受草稿，不影响正式导出，除非导出 API 显式传 `include_active_drafts=true`。默认导出只用已接受的正式帧。
- `edit_sessions` 记录一次自然语言编辑动作的生命周期。
- `layout_qa_reports` 保存全片 DOM 质检结果，便于问题定位。

## API 设计

### 读取当前帧 HTML

```http
GET /api/creative-workflows/:workflow_id/html-video-project/frames/:frame_id/html
```

成功响应：

```json
{
  "success": true,
  "workflow_id": "workflow_123",
  "frame_id": "scene_06",
  "html": "<!doctype html>...",
  "html_path": "frames/06-scene_06.html",
  "source_mode": "raw_html",
  "revision": "rev_001"
}
```

失败响应：

- `NO_HTML_VIDEO_PROJECT`：没有 html-video 工程。
- `FRAME_NOT_FOUND`：找不到帧。
- `FRAME_HTML_NOT_AVAILABLE`：不是 raw_html 或缺少 `html_path`。
- `FRAME_HTML_PATH_INVALID`：路径为空、绝对路径或逃逸工程目录。
- `FRAME_HTML_READ_FAILED`：文件读取失败。

### 保存当前帧 HTML 为草稿

```http
PUT /api/creative-workflows/:workflow_id/html-video-project/frames/:frame_id/html
```

请求：

```json
{
  "html": "<!doctype html>...",
  "mode": "draft",
  "summary": "修复 scene_06 估值标签遮挡正文"
}
```

默认 `mode` 为 `draft`，不直接覆盖正式帧。

成功响应：

```json
{
  "success": true,
  "workflow_id": "workflow_123",
  "frame_id": "scene_06",
  "draft": {
    "id": "draft_20260623_001",
    "html_path": "frames/.drafts/scene_06/draft_20260623_001.html",
    "status": "ready"
  },
  "requires_render": true,
  "message": "帧源码草稿已保存，可渲染单帧预览。"
}
```

校验规则：

- `html` 必须包含 `<!doctype html>` 或 `<html`，并包含 `</html>`。
- `html` 不允许为空。
- 不允许写入外部 URL 的 script/link 作为新依赖。首版可以只 warning，不阻塞；如果出现 `http://` 或 `https://` 的 `<script src>`，返回 `FRAME_HTML_EXTERNAL_SCRIPT_BLOCKED`。
- 写入前需要用现有 caption layer 逻辑确保受管字幕层不会重复污染。
- 写入草稿后必须记录 revision，`requires_render=true`。

### 直接覆盖当前帧 HTML

直接覆盖只允许内部服务或高级用户显式传：

```json
{
  "html": "<!doctype html>...",
  "mode": "replace",
  "summary": "接受手动源码修改"
}
```

限制：

- 前端 Source Tab 的“保存”默认保存草稿。
- “接受草稿”再覆盖正式帧。
- `mode=replace` 可留给调试入口，不作为普通按钮首选。

### 接受草稿

```http
POST /api/creative-workflows/:workflow_id/html-video-project/frames/:frame_id/drafts/:draft_id/accept
```

行为：

- 校验 draft 属于该 frame。
- 将 draft HTML 覆盖到 frame 正式 `html_path`。
- 清空 `active_draft_id`。
- 标记 frame 需要重新渲染。
- 保存 revision。

响应：

```json
{
  "success": true,
  "frame_id": "scene_06",
  "accepted_draft_id": "draft_20260623_001",
  "requires_render": true,
  "message": "草稿已接受，需要重新导出成片。"
}
```

### 放弃草稿

```http
POST /api/creative-workflows/:workflow_id/html-video-project/frames/:frame_id/drafts/:draft_id/discard
```

行为：

- draft 文件可以保留但状态改为 `discarded`，首版不强制删除文件。
- 如果是 `active_draft_id`，清空 active。
- 保存 revision。

### 渲染单帧预览

扩展现有接口：

```http
POST /api/creative-workflows/:workflow_id/html-video-project/render
```

请求：

```json
{
  "mode": "frame",
  "frame_id": "scene_06",
  "draft_id": "draft_20260623_001",
  "run_layout_qa": true
}
```

规则：

- 不传 `draft_id`：渲染正式帧。
- 传 `draft_id`：渲染 draft HTML，不覆盖正式帧。
- `run_layout_qa=true` 时，渲染前或渲染后跑 DOM QA。
- 预览输出路径建议：`inspect/previews/scene_06-draft_20260623_001.mp4`。

响应增加：

```json
{
  "success": true,
  "preview_frame_id": "scene_06",
  "preview_path": "inspect/previews/scene_06-draft_20260623_001.mp4",
  "layout_qa": {
    "success": true,
    "issues": []
  }
}
```

### AI 单帧重写

```http
POST /api/creative-workflows/:workflow_id/html-video-project/frames/:frame_id/iterate
```

请求：

```json
{
  "instruction": "修复右侧几十亿、上百亿标签遮挡正文的问题，保留现有文案和橙色卡片风格。",
  "mode": "layout_fix",
  "preserve_text": true,
  "run_layout_qa": true,
  "render_preview": true
}
```

`mode` 可选值：

- `layout_fix`：修复错位、遮挡、越界。
- `visual_rewrite`：当前帧视觉重写，但保留内容。
- `content_rewrite`：当前帧内容和视觉都可重写。
- `style_match`：让当前帧匹配其他帧风格。

响应：

```json
{
  "success": true,
  "frame_id": "scene_06",
  "edit_session": {
    "id": "edit_20260623_001",
    "mode": "layout_fix",
    "status": "draft_ready"
  },
  "draft": {
    "id": "draft_20260623_001",
    "html_path": "frames/.drafts/scene_06/draft_20260623_001.html"
  },
  "layout_qa": {
    "success": true,
    "issues": []
  },
  "preview_path": "inspect/previews/scene_06-draft_20260623_001.mp4",
  "message": "当前帧草稿已生成。"
}
```

AI prompt 约束：

- 输出必须是完整 HTML 文档。
- 如果 `preserve_text=true`，必须保留当前帧可见中文文案，不得改写标题、正文、数字、标签含义。
- 必须保留 `data-text-key="headline"`、`data-text-key="subtitle"`、`data-text-key="body"`，已有其他 `data-text-key` 尽量保留。
- 不允许引入外网资源。
- 不允许让正文、标题、数字标签互相遮挡。
- 绝对定位元素必须有明确不遮挡文本的布局空间。
- 底部字幕安全区必须保留，不能遮挡 `.hv-caption-layer`。

### 全片编辑意图规划

```http
POST /api/creative-workflows/:workflow_id/html-video-project/edit-plan
```

请求：

```json
{
  "instruction": "整体换成更高级的财经杂志风，文案不变。",
  "selected_frame_id": "scene_06"
}
```

响应：

```json
{
  "success": true,
  "plan": {
    "id": "edit_plan_20260623_001",
    "scope": "project",
    "mode": "restyle",
    "requires_confirmation": true,
    "summary": "保留现有 content graph 和文案，重新生成所有帧视觉。",
    "affected_frames": ["scene_01", "scene_02", "scene_03", "scene_04", "scene_05", "scene_06", "scene_07"]
  },
  "choices": [
    {
      "mode": "restyle",
      "label": "只改风格",
      "description": "保留文字和结构，重写视觉。"
    },
    {
      "mode": "iterate_content",
      "label": "改内容",
      "description": "重新规划每帧内容和文案。"
    },
    {
      "mode": "iterate_format",
      "label": "调节奏",
      "description": "调整帧数、时长和节奏。"
    }
  ]
}
```

规则：

- 模糊指令必须返回 choices，不直接执行。
- 明确指令可以返回单一 plan，但仍要求前端确认。
- 如果用户选中了某帧且指令明显是“这帧”，优先 `scope=frame`。
- 如果指令包含“整体 / 全片 / 每一帧 / 风格统一”，优先 `scope=project`。

### 执行全片编辑计划

```http
POST /api/creative-workflows/:workflow_id/html-video-project/edit-plan/:plan_id/run
```

请求：

```json
{
  "mode": "restyle",
  "confirm": true,
  "render_previews": false,
  "run_layout_qa": true
}
```

`mode` 行为：

- `restyle`：保留 content graph、旁白、字幕和关键文案，逐帧重写视觉 HTML。
- `iterate_content`：重新生成 content graph 和帧 HTML，可能改变标题、正文、帧数。
- `iterate_format`：调整帧时长、节奏和部分视觉，不改变核心内容事实。

执行结果：

- 所有受影响帧生成 draft。
- 默认不直接覆盖正式帧。
- 前端显示批量草稿列表，允许逐帧查看、批量接受、批量放弃。

## 前端设计

### 页面结构

`HtmlVideoProjectEditor` 建议拆分为：

- `HtmlVideoProjectShell`
- `HtmlVideoFrameList`
- `HtmlVideoFramePreview`
- `HtmlVideoFrameFieldsPanel`
- `HtmlVideoSourcePanel`
- `HtmlVideoAiEditPanel`
- `HtmlVideoDraftPanel`
- `HtmlVideoQualityPanel`
- `HtmlVideoExportPanel`

首版可以保留文件名，但内部组件要拆，避免继续扩大单文件复杂度。

### 帧列表

每帧显示：

- 帧号：`04/07`
- `frame.id`
- 时长
- 是否 raw_html
- 是否有 active draft
- 最近 layout QA 状态
- 是否需要重新导出

状态文案：

- `已同步`
- `有草稿`
- `预览已生成`
- `布局需检查`
- `需要重新导出`

### 帧预览

预览区域支持：

- 正式帧预览。
- active draft 预览。
- 一键渲染当前帧。
- 显示预览生成时间和 QA 状态。

按钮：

- `渲染当前帧`
- `渲染草稿`
- `接受草稿`
- `放弃草稿`

请求期间必须显示 loading：

- `正在渲染当前帧预览...`
- `正在渲染草稿预览...`
- `正在接受草稿...`
- `正在放弃草稿...`

### Source Tab

Source Tab 功能：

- 加载当前帧 HTML。
- 显示只读/编辑模式。
- 保存为草稿。
- 对草稿运行布局质检。
- 渲染草稿预览。

按钮：

- `加载源码`
- `保存为草稿`
- `运行布局检查`
- `渲染草稿`

错误状态：

- `当前帧不是 raw_html，暂不支持源码编辑。`
- `源码为空，无法保存。`
- `源码不是完整 HTML 文档。`
- `保存源码草稿失败：...`

编辑器技术选择：

- 首版可以使用 `<textarea>`，不引入 CodeMirror。
- 后续如果需要语法高亮，再参考 `D:\code3\html-video` 的 SourceEditor 方向。
- 不为了首版新增重型编辑器依赖。

### AI 修改 Tab

分两块：

#### 当前帧 AI 修改

字段：

- 指令 textarea。
- 模式选择：`修复布局`、`重写视觉`、`改写内容`、`匹配风格`。
- Checkbox：`保留当前文案`。
- Checkbox：`生成后自动运行布局检查`。
- Checkbox：`生成后自动渲染预览`。

按钮：

- `生成当前帧草稿`

Loading：

- `正在重写当前帧 HTML...`
- `正在检查当前帧布局...`
- `正在渲染当前帧预览...`

#### 全片 AI 修改

字段：

- 指令 textarea。
- `生成编辑计划` 按钮。
- 计划确认卡片。
- 执行按钮：`执行全片编辑计划`。

计划卡片显示：

- 范围：当前帧 / 全片
- 模式：改风格 / 改内容 / 调节奏
- 影响帧列表
- 是否会改变文案
- 是否会改变帧数

执行后显示批量 draft：

- 每帧 draft 状态
- 每帧 layout QA 状态
- `批量接受全部通过质检的草稿`
- `放弃全部草稿`

### 质检 Tab

显示两类报告：

- DOM Layout QA：HTML 层面的文字越界和遮挡。
- Video QA：现有空白帧、低信息量、低运动、重复帧等。

DOM QA issue 示例：

```json
{
  "code": "text_overlap",
  "severity": "error",
  "frame_id": "scene_06",
  "time_sec": 5.2,
  "a": ".launch-zone",
  "b": ".body-copy",
  "intersection_area": 19808,
  "message": "装饰视觉区域遮挡正文。"
}
```

前端展示：

- 问题帧
- 问题类型
- 具体元素
- 建议操作：`用 AI 修复当前帧`、`打开源码`

## DOM 布局质检设计

### 质检服务

新增 `server/services/creative-video/html-video/layoutQaService.js`。

输入：

```js
{
  projectDir,
  frame,
  htmlPath,
  resolution: { width: 1920, height: 1080 },
  durationSec,
  sampleTimesSec: [0.8, 1.8, 0.65 * duration, duration - 0.3]
}
```

输出：

```js
{
  success: false,
  issues: [],
  metrics: {
    sampled_times_sec: [],
    checked_elements: 42
  }
}
```

### 采样时刻

默认采样：

- `0.8s`
- `1.8s`
- `duration * 0.65`
- `duration - 0.3s`

边界：

- 小于 `1.2s` 的帧，只采样 `duration * 0.5`。
- 采样时间必须落在 `[0, duration]`。
- 去重后最多 5 个采样点。

### 检查元素

候选文本元素：

- `[data-text-key]`
- `[data-role]`
- `.headline`
- `.body-copy`
- `.card-title`
- `.big-number`
- `.valuation`
- `.caption`
- `h1,h2,h3,p,li,span,div` 中 innerText 非空且可见的元素

排除：

- `.hv-caption-layer` 单独检查字幕安全区，不参与普通正文遮挡误报。
- `script/style/meta/link`
- `opacity:0` 且无动画后仍不可见的元素。
- 面积小于 `8px * 8px` 的装饰点。

### 问题类型

- `text_out_of_viewport`：文本 bbox 超出 viewport 超过 8px。
- `text_out_of_container`：文本 bbox 超出最近语义容器超过 12px。语义容器包括 `.card`、`article`、`section[data-role]`。
- `text_overlap`：两个文本元素重叠面积超过较小元素面积 8%。
- `decorative_overlay_text`：`aria-hidden`、`.launch-zone`、`.stamp` 等装饰区域覆盖 `headline/body/subtitle`，且 z-index 更高或 DOM 后绘制。
- `caption_safe_area_blocked`：非字幕元素侵入底部字幕安全区且面积明显。
- `font_too_large_for_container`：单个文本元素高度超过容器高度 80%，且发生裁切或越界。

### 严重级别

- `error`：遮挡 headline/body/subtitle，或文本明显越界。
- `warning`：装饰元素接近正文但重叠较小。
- `info`：轻微越界，不影响阅读。

导出策略：

- 首版不阻塞导出，只显示 warning 和 error。
- 设置项后续可增加 `layoutQa.blockOnError`。
- AI 单帧 iterate 后，如果 `run_layout_qa=true` 且有 error，响应仍返回草稿，但 message 写明 `草稿已生成，但布局检查未通过。`

## AI 编辑设计

### 单帧 AI 重写 prompt 输入

不要把过长 HTML 无脑塞给模型。参考 `D:\code3\html-video`，构造摘要：

- 当前 frame id、order、duration。
- 当前 headline/body/subtitle。
- 当前可见数据点。
- 当前色板、字体、主要布局描述。
- 当前 layout QA issues。
- 用户 instruction。
- 是否 preserve text。

如果 HTML 小于阈值，例如 `12000` 字符，可以附上压缩后的 HTML 片段。超过阈值只附摘要。

### 单帧 AI 输出

只接受一个 fenced 或纯文本完整 HTML 文档。解析逻辑：

- 优先提取 ```html 代码块。
- 没有代码块时，如果文本包含完整 `<!doctype html>` 和 `</html>`，直接使用。
- 否则返回 `AI_FRAME_HTML_INVALID`。

### 全片 AI 编辑模式

全片编辑必须先 plan，再 run。

`edit-plan` 负责分类：

- `frame_layout_fix`
- `frame_visual_rewrite`
- `project_restyle`
- `project_iterate_content`
- `project_iterate_format`

`run` 执行：

- `project_restyle`：读取现有 content graph 或从 project.frames metadata 重建 frame contexts，逐帧生成 draft HTML。
- `project_iterate_content`：重新生成 scene/content graph，再逐帧生成 draft HTML。
- `project_iterate_format`：调整 duration/timeline，再必要时重写帧 HTML。

### AI 不可做的事

- 直接修改 `project.json` 任意字段。
- 直接覆盖正式帧，必须生成 draft。
- 引入外网 JS/CSS。
- 删除字幕层管理逻辑。
- 生成没有 `data-text-key` 锚点的 raw HTML。

## 服务职责

### `frameHtmlEditService.js`

职责：

- `readFrameHtml({ projectDir, project, frameId })`
- `saveFrameHtmlDraft({ projectDir, project, frameId, html, summary })`
- `replaceFrameHtml({ projectDir, project, frameId, html, summary })`
- `acceptFrameDraft({ projectDir, project, frameId, draftId })`
- `discardFrameDraft({ projectDir, project, frameId, draftId })`
- `resolveFrameHtmlPath()`
- `assertInsideProject()`

不负责：

- 调 AI。
- 渲染 mp4。
- DOM QA。

### `htmlVideoDraftService.js`

职责：

- 生成 draft id。
- 生成 draft path。
- 写 draft metadata。
- 查找 draft。
- 更新 draft status。

建议 draft path：

```text
frames/.drafts/<frame_id>/<draft_id>.html
```

`frame_id` 需要 sanitize，只允许 `[A-Za-z0-9_-]`，其他字符转 `_`。

### `htmlVideoIterateService.js`

职责：

- 单帧 AI iterate。
- 全片 edit plan。
- 全片 edit plan run。
- 调用 `frameHtmlAgent` 或新 prompt builder。
- 调用 `frameHtmlEditService` 保存 draft。

不负责：

- 直接覆盖正式帧。
- 导出成片。

### `layoutQaService.js`

职责：

- 用 Playwright 打开 frame HTML。
- 注入时间控制或等待动画采样。
- 收集元素 bbox。
- 生成 layout issues。

首版可以使用 real-time wait，不必实现复杂 timeline seek。即：

- `page.goto(file://...)`
- `page.waitForTimeout(sampleTime * 1000)`
- 采样 bbox。

后续如果动画稳定性不足，再引入 `window.__hvPlayAll` 或 CSS animation seeking。

### `projectOrchestrator.js` 扩展

现有 `renderHtmlVideoFramePreview` 增加参数：

- `draftId`
- `htmlPathOverride`
- `runLayoutQa`

实现上不要永久修改 frame。渲染 draft 时构造临时 frame：

```js
const renderFrame = draftId
  ? { ...targetFrame, html_path: draft.html_path }
  : targetFrame;
```

## 路由设计

新增路由建议放在 `server/routes/creativeWorkflows.js`，调用 service，不在 route 里写业务逻辑。

新增：

- `GET /:workflow_id/html-video-project/frames/:frame_id/html`
- `PUT /:workflow_id/html-video-project/frames/:frame_id/html`
- `POST /:workflow_id/html-video-project/frames/:frame_id/drafts/:draft_id/accept`
- `POST /:workflow_id/html-video-project/frames/:frame_id/drafts/:draft_id/discard`
- `POST /:workflow_id/html-video-project/frames/:frame_id/iterate`
- `POST /:workflow_id/html-video-project/layout-qa`
- `POST /:workflow_id/html-video-project/frames/:frame_id/layout-qa`
- `POST /:workflow_id/html-video-project/edit-plan`
- `POST /:workflow_id/html-video-project/edit-plan/:plan_id/run`

保留但暂不实现：

- `PATCH /frames/:frame_id/elements/:element_id`
- `PATCH /frames/:frame_id/transition`
- `POST /frames/:frame_id/enhance`
- `POST /frames/:frame_id/unenhance`

这些路由不再统一 reserved，而是返回更明确的 `NOT_IMPLEMENTED` 和中文说明。

## 数据迁移与兼容

现有 project 没有 `drafts`、`edit_sessions`、`layout_qa_reports`。兼容策略：

- `normalizeProject()` 保持旧项目可读。
- `frame.drafts` 缺失时按 `[]`。
- `project.edit_sessions` 缺失时按 `[]`。
- `project.layout_qa_reports` 缺失时按 `[]`。
- 不需要迁移历史 project 文件。

现有 `raw_html` 帧继续可渲染。

`materializeProject()` 对 raw_html 仍保留现有行为：保留 HTML 文件，补充受管字幕层。

## 安全设计

### 路径安全

所有文件路径必须：

- 从 projectDir resolve。
- 禁止绝对路径。
- 禁止 `..`。
- 校验 `path.relative(projectDir, target)` 不以 `..` 开头且不是绝对路径。

### HTML 安全

首版允许用户编辑 HTML，因为这是本地创作工具，但仍需限制：

- 禁止外部 `<script src="http...">`。
- 外部图片和字体首版 warning，不阻塞。
- 禁止 `<iframe>`，除非后续明确允许。
- 禁止 `<object>`、`<embed>`。
- 保存前检查完整 HTML。

### AI 安全

AI 输出只写入 draft。

AI 输出 HTML 需要过：

- 完整 HTML 校验。
- 禁止外部脚本校验。
- 必要 `data-text-key` 校验。
- DOM layout QA。

## 错误处理与中文文案

所有用户可见文案必须中文。

关键错误：

- `未找到 html-video 工程。`
- `未找到帧 scene_06。`
- `当前帧不是 raw_html，暂不支持源码编辑。`
- `源码不是完整 HTML 文档。`
- `源码包含外部脚本，已拒绝保存。`
- `草稿已生成，但布局检查未通过。`
- `当前编辑计划会影响 7 个帧，请确认后继续。`
- `全片编辑计划执行失败，已保留原工程。`

Loading 文案：

- `正在加载当前帧源码...`
- `正在保存帧源码草稿...`
- `正在重写当前帧 HTML...`
- `正在生成全片编辑计划...`
- `正在执行全片编辑计划...`
- `正在运行布局检查...`
- `正在渲染草稿预览...`
- `正在接受草稿...`
- `正在导出成片...`

## 测试设计

### 后端单元测试

新增测试文件建议：

- `tests/test-html-video-frame-html-edit-service.js`
- `tests/test-html-video-draft-service.js`
- `tests/test-html-video-layout-qa-service.js`
- `tests/test-html-video-frame-iterate-service.js`
- `tests/test-html-video-edit-plan-service.js`

覆盖：

- 读取 raw_html 帧源码成功。
- 非 raw_html 帧读取源码失败。
- 逃逸路径被拒绝。
- 保存完整 HTML 为 draft 成功。
- 不完整 HTML 保存失败。
- 外部 script 保存失败。
- 接受 draft 覆盖正式 frame html。
- 放弃 draft 不影响正式 frame html。
- 渲染 draft preview 时不修改正式 frame。
- layout QA 能发现 `.launch-zone` 覆盖 `.body-copy`。
- layout QA 能发现 `.card-title` 超出 `.card`。
- AI iterate 输出非法 HTML 时失败。
- AI iterate 成功时生成 draft，不覆盖正式帧。
- edit plan 能把“整体换风格，文案不变”分类为 `project_restyle`。
- edit plan 能把“这一帧标签遮挡了，修一下”分类为 `frame_layout_fix`。

### 路由测试

扩展 `tests/test-html-video-routes.js`：

- `GET /frames/:frame_id/html`
- `PUT /frames/:frame_id/html`
- `POST /drafts/:draft_id/accept`
- `POST /drafts/:draft_id/discard`
- `POST /frames/:frame_id/iterate`
- `POST /layout-qa`
- `POST /edit-plan`
- `POST /edit-plan/:plan_id/run`

路由测试可用 fake service，验证 route 参数、payload 和响应形状。

### 前端测试

现有前端测试偏轻量，建议新增：

- `tests/test-html-video-editor-source-panel.mjs`
- `tests/test-html-video-editor-ai-edit-panel.mjs`
- `tests/test-html-video-editor-draft-flow.mjs`

覆盖：

- Source Tab 加载源码。
- 保存源码草稿按钮在 loading 时禁用。
- 当前帧非 raw_html 时显示中文不可编辑状态。
- AI 当前帧修改提交正确 payload。
- 有 active draft 时显示接受/放弃按钮。
- layout QA issue 能跳转到问题帧。

### 集成验收

用当前问题构造两个 fixtures：

- `fixture-overflow-card-title.html`
- `fixture-overlay-valuation.html`

验收：

- layout QA 对 fixture 返回 error。
- 修复版 fixture 返回 success。
- AI iterate 的 fake model 返回修复 HTML 后，draft 生成成功。
- draft preview 使用 draft HTML，不污染正式 HTML。

## 分阶段实施建议

虽然目标是完整体系，但实施要分阶段，避免一次性大 PR。

### Phase 1：帧源码读写与 draft

交付：

- `frameHtmlEditService`
- `htmlVideoDraftService`
- 帧 HTML GET/PUT
- accept/discard
- Source Tab
- 后端和前端测试

验收：

- 可以打开 `scene_06` HTML。
- 可以保存源码草稿。
- 可以接受草稿并导出成片。
- 正式帧在接受前不被覆盖。

### Phase 2：DOM layout QA

交付：

- `layoutQaService`
- 单帧 layout QA API
- 全片 layout QA API
- 预览接口支持 `run_layout_qa`
- 质检 Tab

验收：

- 能自动发现 `scene_04` 的 `.card-title` 越界。
- 能自动发现 `scene_06` 的 `.launch-zone` 遮挡正文。

### Phase 3：AI 单帧重写

交付：

- `htmlVideoIterateService.iterateFrame`
- `POST /frames/:frame_id/iterate`
- AI 修改当前帧 UI
- fake model 测试

验收：

- 用户输入“修复当前帧遮挡”，系统生成 draft。
- draft 可预览、接受、放弃。
- AI 输出非法 HTML 时不污染工程。

### Phase 4：全片 edit plan

交付：

- `htmlVideoEditModeService`
- `POST /edit-plan`
- 计划确认 UI
- 模糊指令 choices

验收：

- “整体换风格，文案不变”生成 `project_restyle` 计划。
- “把内容改成讲融资”生成 `project_iterate_content` 计划。
- “每帧短一点”生成 `project_iterate_format` 计划。

### Phase 5：执行全片编辑计划

交付：

- `runEditPlan`
- 批量 draft 生成。
- 批量 layout QA。
- 批量接受/放弃。

验收：

- restyle 生成所有帧 draft，正式帧不被覆盖。
- 批量接受后可导出新成片。
- 失败时保留原工程。

### Phase 6：导出前质量门

交付：

- 导出前可选 layout QA。
- 设置项：只提示 / error 阻塞。
- 导出面板显示 QA 摘要。

验收：

- 有 error 时默认提示但不阻塞。
- 开启阻塞后，有 error 不能导出。

## 现有问题的目标工作流

### 修复 `scene_04`

1. 用户选择 `scene_04`。
2. 打开 `AI 修改`。
3. 输入：`修复“年薪报价冲到新高位”跑出橙色卡片的问题，保留 600 万主视觉和现有文案。`
4. 选择 `修复布局`，勾选 `保留当前文案`。
5. 系统生成 draft。
6. 系统运行 layout QA。
7. 用户渲染草稿预览。
8. 用户接受草稿。
9. 用户导出成片。

### 修复 `scene_06`

1. 用户选择 `scene_06`。
2. 系统在质检 Tab 显示 `.launch-zone` 遮挡 `.headline/.body-copy`。
3. 用户点击 `用 AI 修复当前帧`。
4. 系统生成 draft，把估值标签移动到右侧预留列或正文下方安全区域。
5. layout QA 通过。
6. 用户预览并接受。

## 风险与缓解

### AI 重写不稳定

风险：AI 可能输出空 HTML、跑题、改文案、引入新遮挡。

缓解：

- 输出只进 draft。
- preserve_text 模式下做文本对比。
- 完整 HTML 校验。
- layout QA。
- 用户接受前不覆盖正式帧。

### Source 编辑破坏工程

风险：用户手动改坏 HTML。

缓解：

- 默认保存为 draft。
- 单帧预览先验证。
- 接受前显示 QA。
- revision 可回滚。

### 全片编辑耗时

风险：一次 restyle 七帧或更多，生成和 QA 都慢。

缓解：

- edit plan 先确认。
- 执行时逐帧进度。
- 失败帧单独标记，不影响已生成 draft。
- 支持只接受通过 QA 的 draft。

### DOM QA 误报

风险：创意排版可能故意重叠。

缓解：

- 首版只 warning，不阻塞。
- error 主要聚焦 `headline/body/subtitle`。
- UI 支持忽略单个 issue，后续可记录 allowlist。

## 子代理实施注意事项

- 不要先实现拖拽元素编辑。先完成 Source/draft/QA/AI iterate。
- 不要把 HTML 写入逻辑塞进 route。
- 不要把 AI iterate 塞进 `editPatchService`。
- 不要让 `mode=materialize` 覆盖 raw_html draft。
- 不要绕过 projectDir 路径校验。
- 不要默认导出 active draft，必须接受后才参与正式导出。
- 不要在首版引入 CodeMirror，除非实施计划明确批准。
- 所有用户可见文案必须中文。
- PowerShell 读取中文文件必须 `Get-Content -Encoding UTF8`。
- 开始实现前必须先写实施计划，并按 TDD 为每个服务写失败测试。

## 开放问题

本设计已做默认取舍，实施前只需确认以下点：

- Source Tab 首版是否接受 `<textarea>`。本设计默认接受。
- DOM QA 首版是否阻塞导出。本设计默认不阻塞，只提示。
- `mode=replace` 是否开放给前端。本设计默认不作为普通按钮，只用于内部或高级调试。
- 全片 restyle 是否允许改变帧数。本设计默认不允许；改变帧数属于 `iterate_content` 或 `iterate_format`。

## 验收标准

完整体系落地后，需要满足：

- 用户可以读取任意 raw_html 帧源码。
- 用户可以保存源码草稿，正式帧不被覆盖。
- 用户可以渲染草稿预览。
- 用户可以接受或放弃草稿。
- 用户可以让 AI 只重写当前帧。
- 用户可以生成全片编辑计划，并确认后执行。
- 系统能对当前两个已知问题输出 DOM layout QA issue。
- 导出成片默认只使用已接受的正式帧。
- 所有编辑操作都有 revision。
- 所有请求期间有明确 loading 文案，完成后有明确成功/失败状态。
