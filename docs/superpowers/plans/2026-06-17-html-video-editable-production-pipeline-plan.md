# html-video 可编辑生产链路 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将当前一键创意视频从 “AI 直接改完整 HTML + legacy 渲染” 升级为 “AI 输出结构化 JSON + html-video 行为移植 + 可编辑工程 + Playwright/Chromium/ffmpeg 导出” 的生产链路。

**Architecture:** 首版在当前项目内新增 `server/services/creative-video/html-video/`，以 CommonJS/JavaScript 移植 `D:/code3/html-video` 的 contentGraph、Project/FrameRecord、Playwright adapter、ffmpeg concat/mux 等核心行为，不把 html-video TypeScript monorepo 作为运行时依赖。`workflowFacade` 只负责调用新链路，`htmlVideoWorkflow` 负责当前 workflowId/runId/creativeContext/AI/fallback 适配，`projectOrchestrator` 保持工程生命周期语义。

**Tech Stack:** Node.js 22、CommonJS、Express、React 19、Vite、Playwright Chromium、ffmpeg、JSON Schema、YAML parser、现有 TTS/混音/visual QA/workflow 存储。

---

## 0. 实施前约束

**必须遵守**

- 修改任何文件前运行 `git branch --show-current`，只能在 `dev` 分支开发；若在 `main` 且不是发布、同步或合并 `dev` 到 `main`，立即停止。
- 用户可见文案使用中文；接口错误若包含英文底层信息，必须附带中文解释。
- 所有新增会触发请求的前端操作必须有中文 loading 文案、按钮禁用态、重复点击保护，以及成功、失败、未配置、需登录、需验证、已取消等明确结束状态。
- AI 默认只输出 `scene_spec`、`template_id`、`template_inputs`、`edit_patch` 等 JSON，不直接输出完整 HTML。
- 首版默认只支持 `engine: hyperframes` 且 `source_entry` 指向 HTML 的 production-ready 模板；Remotion 只作为 `enhancement` 数据结构和服务边界保留。
- 前端必须组件化，不能把编辑成片 UI 塞进一个大组件。
- 后端业务逻辑必须按职责拆分 service/module，不能把 registry、agent、projectStore、materializer、render adapter、ffmpeg composer、validation gate、edit patch 混进一个文件。

**参考源**

- 设计文档：`docs/superpowers/specs/2026-06-17-html-video-editable-production-pipeline-design.md`
- html-video 行为基准：
  - `D:/code3/html-video/packages/content-graph/src/index.ts`
  - `D:/code3/html-video/packages/adapter-hyperframes/src/render.ts`
  - `D:/code3/html-video/packages/core/src/project.ts`
- 当前入口：
  - `server/services/creative-video/workflowFacade.js`
  - `server/services/creativeWorkflows.js`
  - `server/routes/creativeWorkflows.js`
  - `frontend-react/src/api/client.js`
  - `frontend-react/src/hooks/useCreativeVideoEditor.js`
  - `frontend-react/src/components/creative-video-editor/*`

---

## 1. 文件结构与职责边界

### 后端新增模块

**Create**

- `server/services/creative-video/html-video/index.js`
  - 统一导出 html-video production path 的 service。
  - 只做模块聚合，不放业务逻辑。

- `server/services/creative-video/html-video/contentGraph.js`
  - [首版必做] JS 移植 contentGraph。
  - 导出 `validate(graph)`、`topoSort(graph)`、`totalDurationSec(graph)`、`DEFAULT_FRAME_DURATION_SEC`。
  - 保持 Kahn 拓扑排序：dependency edge 硬约束，sequence edge 只作为 ready 队列软排序偏好，平局保留原始 node 顺序。

- `server/services/creative-video/html-video/sceneSpecMapper.js`
  - [首版必做] 将 `scene_spec.scenes[]` 映射为 `content_graph.nodes[]`、`edges[]`、`frames[]` 初始数据。
  - 首版生成线性 sequence graph，但保留 dependency/contrast 字段。

- `server/services/creative-video/html-video/templateManifestService.js`
  - [首版必做] 读取和规范化原生 `template.html-video.yaml`。
  - 使用标准 YAML parser，不使用当前手写 YAML parser。
  - 负责 manifest 字段默认值、`__dir`、`source_entry` 路径安全校验。

- `server/services/creative-video/html-video/templateRegistry.js`
  - [首版必做] 扫描 html-video 风格模板目录，提供完整 manifest 与 AI compact index。
  - 过滤 license、engine、aspect、duration、source_entry。
  - 内部 engine 映射：`hyperframes` -> `hyperframes-playwright`；`remotion` -> `remotion-native` 预留。

- `server/services/creative-video/html-video/templateSelectorAgent.js`
  - [首版必做] 基于 `scene_spec` 与 compact index 调 AI 选择模板。
  - 只接受 JSON：`{ template_id, reason, confidence }`。
  - 不接收、不解析完整 HTML。

- `server/services/creative-video/html-video/templateInputAgent.js`
  - [首版必做] 基于 `inputs.schema`、`scene_spec`、素材上下文调 AI 填 `template_inputs`。
  - 使用 JSON Schema 校验必填字段、类型、枚举、长度、数值范围。

- `server/services/creative-video/html-video/projectSchema.js`
  - [首版必做] 定义 `HtmlVideoProject` normalize/validate/schema 版本。
  - 固定 `frames[]`、`timeline`、`assets[]`、`audio`、`overrides`、`revisions[]`、`exports[]` 字段。
  - [预留] `trim`、`speed`、`loop`、`html overrides`、`element overrides`、`transitions`、`enhancement` 字段先入 schema，不做复杂 UI。

- `server/services/creative-video/html-video/projectStore.js`
  - [首版必做] 负责工程目录与 JSON 持久化。
  - 导出 `createProjectDir()`、`saveProject()`、`loadProject()`、`addRevision()`、`addExport()`、`resolveProjectPath()`。
  - 兼容当前 `{rootDir}/{workflowId}/agent_runs/` 路径习惯，避免覆盖旧 export。

- `server/services/creative-video/html-video/projectOrchestrator.js`
  - [首版必做] 工程生命周期编排：创建 project、materialize、render frame、concat/export、revision/export 记录。
  - 不接收 `creativeContext`、AI 服务、fallback 策略等业务输入，不调用 AI。
  - 只接收 `htmlVideoWorkflow` 准备好的 `storageContext`、`projectDir`、`projectId`、template、`contentGraph`、frames、render/export options 等纯工程参数。

- `server/services/creative-video/html-video/htmlVideoWorkflow.js`
  - [首版必做] 当前项目业务适配层。
  - 编排 `templateSelectorAgent`、`templateInputAgent`、`projectOrchestrator`、`validationGate`、fallback diagnostics。
  - 负责 workflowId/runId/rootDir/creativeContext/AI 服务适配。

- `server/services/creative-video/html-video/materializer.js`
  - [首版必做] 将模板与 `template_inputs` 确定性物化为 `frames/*.html`。
  - 支持变量注入式 `window.__HV_VARS__`/`window.__HV_DURATION__`。
  - 支持兼容替换式 `{{field}}` 与 selector 映射。
  - 输出稳定 `data-hv-element-id` 与 `data-hv-bind`。

- `server/services/creative-video/html-video/hyperframesPlaywrightAdapter.js`
  - [首版必做] JS 移植 Playwright/Chromium 录制路径。
  - 负责 `recordVideo`、动画冻结、字体等待、动画时长探测、lead-in 裁剪、webm->mp4 编码。
  - 注释逐段标明对应 `D:/code3/html-video/packages/adapter-hyperframes/src/render.ts` 的关键步骤。

- `server/services/creative-video/html-video/prepareSourceHtml.js`
  - [首版必做] 从 adapter 中独立拆出，处理 `data-composition-src` 组合模板内联与 `window.__hvPlayAll()` 注册。
  - 单文件模板直接返回原路径，组合模板生成临时 prepared HTML 并提供 cleanup。

- `server/services/creative-video/html-video/frameRenderer.js`
  - [首版必做] 单帧渲染调度，统一输入 `frame.html_path`、`duration_sec`、resolution、fps、output path。
  - 只做 project frame 到 adapter 入参的调度、进度透传和 project 状态记录。
  - 不直接操作 Playwright，不拼 ffmpeg 命令，不处理字体、动画、lead-in；这些细节全部在 `hyperframesPlaywrightAdapter.js`。
  - 不包含 ffmpeg concat 逻辑。

- `server/services/creative-video/html-video/ffmpegComposer.js`
  - [首版必做] 多帧 concat 与音频 mux。
  - 单 engine/编码一致时使用 concat demuxer + `-c copy`。
  - 混合 engine 或编码参数不一致时使用 concat filter + re-encode。
  - 音频 mux 使用 `-filter_complex`、`volume`、`afade`、`amix`、AAC、`-shortest`。

- `server/services/creative-video/html-video/assetStore.js`
  - [首版必做] 校验与复制 project 内 asset，首版允许 `assets: []`。
  - 禁止绝对路径和 `..`。

- `server/services/creative-video/html-video/validationGate.js`
  - [首版必做] 生成前、中、后校验。
  - 校验 template、license、engine、source_entry、schema、assets、timeline item kind、环境依赖。
  - 返回统一 diagnostics。

- `server/services/creative-video/html-video/diagnostics.js`
  - [首版必做] 结构化诊断工厂。
  - 统一 `{ code, stage, user_message, details, fallback_allowed }`。
  - 所有 `user_message` 使用中文。

- `server/services/creative-video/html-video/editPatchService.js`
  - [首版必做] 应用自然语言编辑或表单编辑 patch。
  - 支持 `template_inputs_patch`、`frame_inputs_patch`、`narration_patch`、`caption_patch`、`duration_patch`、`replace_frame_template`。
  - 负责 revision、`requires_tts`、`requires_render` 标记。

- `server/services/creative-video/html-video/environmentDoctor.js`
  - [首版必做] 检测 Playwright Chromium 与 ffmpeg 可用性。
  - 支持 `@ffmpeg-installer/ffmpeg`、`FFMPEG_PATH`、PATH fallback。

### 后端修改模块

**Modify**

- `server/services/creative-video/workflowFacade.js`
  - 将 `tryRichTemplate()` 默认路径替换为 `htmlVideoWorkflow.generateProject()`。
  - 保留 legacy render path 作为 fallback。
  - `rerenderCreativeVideoProject()`、`applyCreativeVideoEdit()` 改为调用新 project API/service。

- `server/services/creative-video/creativeSpecAgent.js`
  - 保留 `scene_spec` 生成。
  - 拆出或新增 prompt builder 给 `templateSelectorAgent`、`templateInputAgent`、`editPatchService` 使用。
  - 删除默认生产路径中 “AI 填完整 HTML” 的调用；函数可保留给 legacy fixture，但不被新链路调用。

- `server/services/creative-video/templateRegistry.js`
  - 保留 legacy API，作为 fallback 兼容层。
  - 新链路使用 `server/services/creative-video/html-video/templateRegistry.js`。
  - 避免两个 registry 混淆，在命名和导出注释中标明 legacy 与 production registry。

- `server/services/creative-video/hyperframesTemplateRenderer.js`
  - 保留 legacy composer。
  - `assembleProjectFiles()` 不再作为默认 rich path。
  - 新链路 HTML 物化由 `html-video/materializer.js` 接管。

- `server/services/creative-video/projectWriter.js`
  - 保留 legacy 工程写入。
  - 新链路工程持久化迁移到 `html-video/projectStore.js`。

- `server/services/creative-video/renderAdapter.js`
  - 保留 `npx hyperframes render` legacy adapter。
  - 新链路新增 `hyperframesPlaywrightAdapter.js`，不复用旧 adapter 的 scrub timeline 假设。

- `server/services/creative-video/visualQaService.js`
  - 扩展检查：空白帧、低信息帧、分辨率偏差、时长偏差、字体/CSS 失效、动画未运行、首帧字体闪烁风险。

- `server/services/creativeWorkflows.js`
  - 增加 html-video project 的读写、edit、render、export、exports 服务方法。
  - `getCreativeWorkflowVideoSpec()` 优先返回 `HtmlVideoProject`，没有新工程时 fallback 到旧 `scene_spec/frame_specs`。

- `server/routes/creativeWorkflows.js`
  - 新增 html-video project API 路由。
  - 保持旧 `/video-spec`、`/rerender`、`/remix` 可用。

### 前端新增和修改模块

**Create**

- `frontend-react/src/hooks/useHtmlVideoProject.js`
  - [首版必做] 加载、保存、编辑、渲染、导出、刷新 exports。
  - 管理 loading/saving/rendering/exporting/validating 状态与中文提示。
  - 对每个请求做禁用态和重复点击保护。

- `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`
  - [首版必做] 新编辑器容器，只做布局与状态传递，不放表单细节。

- `frontend-react/src/components/creative-video-editor/ProjectStatusBar.jsx`
  - [首版必做] 展示中文状态：加载、保存、渲染、导出、失败、未配置、需验证。

- `frontend-react/src/components/creative-video-editor/TemplateInputsPanel.jsx`
  - [首版必做] 全局 `template_inputs` 表单。

- `frontend-react/src/components/creative-video-editor/FrameInputsPanel.jsx`
  - [首版必做] 单帧 inputs 表单、duration、template info。

- `frontend-react/src/components/creative-video-editor/NarrationPanel.jsx`
  - [首版必做] 旁白编辑与重新 TTS 入口。

- `frontend-react/src/components/creative-video-editor/CaptionsPanel.jsx`
  - [首版必做] 字幕编辑。

- `frontend-react/src/components/creative-video-editor/ProjectFramesList.jsx`
  - [首版必做] 基于 `project.frames` 的帧列表。

- `frontend-react/src/components/creative-video-editor/ExportsPanel.jsx`
  - [首版必做] 展示 `project.exports`。

- `frontend-react/src/components/creative-video-editor/NaturalLanguageEditBox.jsx`
  - [首版必做] 用户自然语言编辑入口，提交后后端返回 `edit_patch` 并应用。

- `frontend-react/src/components/creative-video-editor/ReservedCapabilitiesPanel.jsx`
  - [预留] 默认不创建、不展示；仅当产品确认需要可见灰态入口时再创建。
  - 首版高级能力只保留在 schema/API/service 边界中，避免让用户误以为时间线、源码编辑、元素拖拽等功能已可用。

**Modify**

- `frontend-react/src/api/client.js`
  - 增加 html-video project API 方法。

- `frontend-react/src/components/creative-video-editor/CreativeVideoEditor.jsx`
  - 作为兼容入口：优先渲染 `HtmlVideoProjectEditor`；无新工程时使用旧 scene/frame 编辑器。

- `frontend-react/src/hooks/useCreativeVideoEditor.js`
  - 保留 legacy hook。
  - 不继续扩张为新工程大 hook，新功能放进 `useHtmlVideoProject.js`。

- `frontend-react/src/pages/OneClickCreativePage.jsx`
  - “编辑成片”入口保持不变，打开新工程编辑器。

- `frontend-react/src/styles.css`
  - 拆分 class 命名并约束布局，避免一个巨型 UI 块。

### 测试新增模块

**Create**

- `tests/test-html-video-content-graph.js`
- `tests/test-html-video-scene-spec-mapper.js`
- `tests/test-html-video-template-manifest-service.js`
- `tests/test-html-video-template-registry.js`
- `tests/test-html-video-template-agents.js`
- `tests/test-html-video-project-schema.js`
- `tests/test-html-video-project-store.js`
- `tests/test-html-video-materializer.js`
- `tests/test-html-video-prepare-source-html.js`
- `tests/test-html-video-playwright-adapter-command.js`
- `tests/test-html-video-ffmpeg-composer.js`
- `tests/test-html-video-validation-gate.js`
- `tests/test-html-video-edit-patch-service.js`
- `tests/test-html-video-workflow.js`
- `tests/test-html-video-routes.js`
- `tests/test-html-video-api-client.mjs`
- `tests/test-html-video-editor-components.mjs`

---

## 2. 分阶段实施任务

### Task 1: contentGraph JS 移植与 scene_spec 映射

**状态:** [首版必做]

**目标**

提供与 `html-video/packages/content-graph/src/index.ts` 等价的 JS contentGraph 行为，并把当前 `scene_spec` 映射到工程层 `content_graph` 与 `frames[]`。

**Files**

- Create: `server/services/creative-video/html-video/contentGraph.js`
- Create: `server/services/creative-video/html-video/sceneSpecMapper.js`
- Create: `tests/test-html-video-content-graph.js`
- Create: `tests/test-html-video-scene-spec-mapper.js`
- Read: `server/services/creative-video/sceneSpecService.js`
- Read: `server/services/creative-video/specEnums.js`
- Reference: `D:/code3/html-video/packages/content-graph/src/index.ts`

**具体步骤**

- [x] 写 `contentGraph.validate()` 失败测试：空 graph、重复 node id、unknown edge from/to、自环、invalid kind、dependency cycle。
- [x] 写 `contentGraph.topoSort()` 行为测试：单节点、多 dependency、sequence tie-break、原始顺序平局、dependency cycle throw。
- [x] 写 `totalDurationSec()` 测试：缺省 duration 使用 `3` 秒，按 topoSort 顺序累加。
- [x] 参照设计文档“移植验证策略”，确保算法级对齐、行为测试迁移、渲染/ffmpeg 相关策略在后续任务中分别落地；本任务只实现 contentGraph 的算法级和行为测试迁移部分。
- [x] 实现 `contentGraph.js`，导出：

```js
module.exports = {
  DEFAULT_FRAME_DURATION_SEC: 3,
  validate,
  topoSort,
  totalDurationSec,
  getNode,
};
```

- [x] 保留错误 code 与 html-video 语义一致：`duplicate-node-id`、`edge-from-unknown-node`、`edge-to-unknown-node`、`self-edge`、`cycle`、`empty-graph`、`invalid-kind`。
- [x] 在 `topoSort()` 注释中标明：dependency edge 硬约束，sequence edge 只影响 ready 队列，原始 node 顺序保证稳定输出。
- [x] 写 `sceneSpecMapper` 测试：`scene_spec.scenes[]` 生成线性 sequence graph，保留 order/duration/kind/narration/captions/visual_text。
- [x] 实现 `sceneSpecMapper.mapSceneSpecToContentGraph(sceneSpec)`：

```js
{
  schemaVersion: 1,
  intent: 'promo',
  synopsis: sceneSpec.title,
  nodes: sceneSpec.scenes.map(...),
  edges: [{ from: 'scene_01', to: 'scene_02', kind: 'sequence' }]
}
```

- [x] 实现 `sceneSpecMapper.buildFramesFromGraph({ sceneSpec, contentGraph, templateId, templateInputs })`，首版一 scene 一 frame，`engine: 'hyperframes-playwright'`。
- [x] frame 预留字段必须包含：`transition_in/out`、`trim`、`speed`、`loop`、`enhancement`。

**测试/验证方式**

- Run: `node tests/test-html-video-content-graph.js`
- Run: `node tests/test-html-video-scene-spec-mapper.js`
- Run: `node tests/test-creative-video-scene-spec.js`

**完成标准**

- contentGraph 测试覆盖以下行为迁移用例：
  - 空 graph 返回 `empty-graph`。
  - 重复 node id 返回 `duplicate-node-id`。
  - unknown edge from/to 返回 `edge-from-unknown-node` / `edge-to-unknown-node`。
  - 自环返回 `self-edge`。
  - invalid kind 返回 `invalid-kind`。
  - dependency cycle 返回 `cycle`，并按 html-video 源实现保留涉及节点 `ref`。
  - 单节点 graph 正确输出 `[nodeId]`。
  - 多 dependency 场景按 dependency edge 约束拓扑排序。
  - ready 队列平局时由 sequence edge 软排序打破，再按原始 node 顺序稳定排序。
  - `totalDurationSec` 缺省 duration 使用 3 秒，并按 topoSort 顺序累加。
- scene_spec 能稳定映射为 content_graph 与 frames。
- 不依赖 `D:/code3/html-video` 的 TS 编译产物。

---

### Task 2: 原生 template.html-video.yaml manifest 与生产模板 registry

**状态:** [首版必做]

**目标**

读取 html-video 原生 `template.html-video.yaml`，并只把 license、engine、source_entry 合规的 production-ready 模板交给 AI。

**Files**

- Create: `server/services/creative-video/html-video/templateManifestService.js`
- Create: `server/services/creative-video/html-video/templateRegistry.js`
- Create: `tests/test-html-video-template-manifest-service.js`
- Create: `tests/test-html-video-template-registry.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Read: `server/services/creative-video/templateRegistry.js`
- Fixture: `tests/fixtures/html-video-templates/*/template.html-video.yaml`

**具体步骤**

- [x] 添加 YAML parser 依赖，例如 `yaml`，用于标准解析 `template.html-video.yaml`。
- [x] 创建 `tests/fixtures/html-video-templates/` 目录。
- [x] 在 `tests/fixtures/html-video-templates/` 下创建 fixture 模板目录：
  - `glitch_title/`
  - `bold_signal/`
  - `remotion_template/`
  - `non_commercial_template/`
  - `missing_source_entry_template/`
- [x] 写 manifest fixture：一个 `engine: hyperframes` + `source_entry: source/index.html` + `commercial_use: true` 的合规模板。
- [x] 写 fixture：一个 `engine: remotion` + `source_entry: source/entry.tsx`，默认不得进入 AI 候选。
- [x] 写 fixture：一个 `license.commercial_use: false`，默认不得进入 AI 候选。
- [x] 写 fixture：一个 `source_entry` 指向不存在文件，registry 返回 diagnostics。
- [x] 实现 `loadTemplateManifest(filePath)`，输出包含 `__dir` 的 manifest。
- [x] 实现 `normalizeTemplateManifest(raw, dir)`，固定字段：

```js
{
  id,
  name,
  engine,
  engine_version,
  source_entry,
  output: { resolution, fps, duration },
  inputs: { schema, examples },
  preview,
  license,
  assets_attribution,
  __dir,
}
```

- [x] 实现 `validateTemplateCompatibility(template, target)`，覆盖 aspect、duration、engine、source_entry、license。
- [x] 实现 `buildCompactIndex({ aspectRatio, durationSec, engines, licenseAllow, commercialOnly })`，只包含 AI 选择需要字段，不包含被 license 策略屏蔽的模板。
- [x] 实现 engine 映射函数：

```js
function mapTemplateEngineToProjectEngine(engine) {
  if (engine === 'hyperframes') return 'hyperframes-playwright';
  if (engine === 'remotion') return 'remotion-native';
  return null;
}
```

- [x] production-ready 默认规则：
  - `engine === 'hyperframes'`
  - `source_entry` 后缀为 `.html`
  - `license.commercial_use === true`
  - `source_entry` 文件存在且路径位于模板目录内
- [x] 保留 legacy `server/services/creative-video/templateRegistry.js`，不在本阶段删除。

**测试/验证方式**

- Run: `node tests/test-html-video-template-manifest-service.js`
- Run: `node tests/test-html-video-template-registry.js`
- Run: `node tests/test-creative-template-registry.js`

**完成标准**

- `template.html-video.yaml` 可被标准 parser 读取。
- AI compact index 不包含 Remotion、非 HTML source_entry、非商业授权模板。
- attribution_required 模板在 manifest 中保留 attribution metadata。

---

### Task 3: HtmlVideoProject schema、projectStore、revisions/exports

**状态:** [首版必做，timeline/trim/override/enhancement 字段为预留]

**目标**

建立稳定、可编辑、可重渲、可追踪版本的 `HtmlVideoProject` 数据模型与文件存储。

**Files**

- Create: `server/services/creative-video/html-video/projectSchema.js`
- Create: `server/services/creative-video/html-video/projectStore.js`
- Create: `server/services/creative-video/html-video/assetStore.js`
- Create: `tests/test-html-video-project-schema.js`
- Create: `tests/test-html-video-project-store.js`
- Read: `server/services/creative-video/projectWriter.js`

**具体步骤**

- [x] 写 schema normalize 测试：缺省 project 字段补齐，`schema_version` 固定为 `1`。
- [x] 写 schema validate 测试：`assets[].path` 禁止绝对路径和 `..`；`timeline.tracks[].items[].kind` 首版只接受 `frame`。
- [x] 实现 `createEmptyProject(input)`，字段包含：
  - `project_id`
  - `workflow_id`
  - `run_id`
  - `schema_version`
  - `template_id`
  - `template_inputs`
  - `content_graph`
  - `frames`
  - `timeline`
  - `assets`
  - `audio`
  - `overrides`
  - `revisions`
  - `exports`
  - `status`
- [x] `frames[]` 首版字段包含：
  - `id`
  - `scene_id`
  - `graph_node_id`
  - `order`
  - `template_id`
  - `inputs`
  - `html_path`
  - `duration_sec`
  - `engine`
  - `transition_in`
  - `transition_out`
  - `trim`
  - `speed`
  - `loop`
  - `enhancement`
- [x] `timeline` 默认三轨：`main` video、`voice` audio、`music` audio；首版导出按 `frames[].order + duration_sec` 消费。
- [x] `overrides.html.enabled` 默认 `false`；普通用户首版不开放源码编辑。
- [x] `enhancement.enabled` 默认 `false`；Remotion native 只保留字段。
- [x] 实现 `projectStore.createProjectDir({ rootDir, workflowId, runId })`，目录建议：

```text
{rootDir}/{workflowId}/agent_runs/{runId}-html-video/
  project.json
  content-graph.json
  frames/
  assets/
  exports/
  inspect/
  tts/
```

- [x] 实现 `saveProject()` 使用临时文件 + rename，避免半写入。
- [x] 实现 `addRevision(project, change)`，revision 不覆盖历史。
- [x] 实现 `addExport(project, exportInfo)`，新 export 路径唯一，同时可更新 latest alias。
- [x] 实现 `resolveProjectPath(projectDir, relativePath)`，禁止逃逸工程目录。

**测试/验证方式**

- Run: `node tests/test-html-video-project-schema.js`
- Run: `node tests/test-html-video-project-store.js`
- Run: `node tests/test-creative-video-project-writer.js`

**完成标准**

- project 可保存、加载、追加 revision/export。
- 所有路径安全检查通过。
- 预留字段存在但首版不暴露复杂编辑能力。

---

### Task 4: AI 选模板与 AI 填表 JSON 流程

**状态:** [首版必做]

**目标**

把 AI 权限限制为选择模板与填写 JSON 表单，不允许 AI 在默认生产路径直接写完整 HTML。

**Files**

- Create: `server/services/creative-video/html-video/templateSelectorAgent.js`
- Create: `server/services/creative-video/html-video/templateInputAgent.js`
- Create: `tests/test-html-video-template-agents.js`
- Modify: `server/services/creative-video/creativeSpecAgent.js`
- Read: `server/services/aiTextModel.js`
- Read: `server/services/creative-video/workflowFacade.js`

**具体步骤**

- [x] 写 selector agent 测试：AI 返回合法 JSON 且 `template_id` 存在时成功。
- [x] 写 selector agent 测试：AI 返回 Markdown、完整 HTML、未知 template_id、被过滤 template_id 时失败并返回中文 diagnostics。
- [x] 实现 `buildTemplateSelectionPrompt({ sceneSpec, compactIndex, target })`，明确要求只返回 JSON：

```json
{
  "template_id": "frame-glitch-title",
  "reason": "内容偏科技感和冲突感，适合故障风标题模板",
  "confidence": 0.86
}
```

- [x] 写 input agent 测试：根据 `inputs.schema` 填字段，缺失 required、类型错误、超长、枚举错误会失败。
- [x] 实现 `buildTemplateInputPrompt({ sceneSpec, template, creativeContext })`，明确禁止输出 HTML、CSS、JS。
- [x] 实现 `parseJsonOnlyResponse(text)`：提取并校验 JSON object；如果出现 `<html`、`<!doctype`、`<script`，直接拒绝。
- [x] 接入 JSON Schema validator。若不新增大型依赖，可先实现 schema 子集校验：`required`、`type`、`enum`、`minLength`、`maxLength`、`minimum`、`maximum`、`items`。
- [x] 在 `creativeSpecAgent.js` 保留旧 prompt builder，但标注为 legacy fallback；新链路调用新 agent。

**测试/验证方式**

- Run: `node tests/test-html-video-template-agents.js`
- Run: `node tests/test-creative-spec-agent.js`

**完成标准**

- 默认链路中不存在 “AI 生成完整 HTML”。
- 所有 AI 产物都经过 JSON parse 与 schema 校验。
- 失败结果包含中文 `user_message` 和 `fallback_allowed`。

---

### Task 5: materializer 与变量模板改造

**状态:** [首版必做]

**目标**

系统根据模板协议和 `template_inputs` 确定性生成可打开、可录制、可重渲的 HTML/frame HTML，并提供 1-2 个 production-ready 变量模板样板。

**Files**

- Create: `server/services/creative-video/html-video/materializer.js`
- Create: `tests/test-html-video-materializer.js`
- Create: `server/templates/glitch_title/source/index.html`
- Create: `server/templates/glitch_title/template.html-video.yaml`
- Create: `server/templates/bold_signal/source/index.html`
- Create: `server/templates/bold_signal/template.html-video.yaml`
- Read: `server/templates/glitch_title/source.html`
- Read: `server/templates/glitch_title/manifest.yaml`
- Read: `server/templates/bold_signal/source.html`
- Read: `server/templates/bold_signal/manifest.yaml`

**具体步骤**

- [x] 将 `glitch_title` 迁移为原生 html-video 模板目录结构：

```text
server/templates/glitch_title/
  template.html-video.yaml
  source/
    index.html
```

- [x] 将 `bold_signal` 迁移为同样结构。
- [x] 旧 `source.html` 和 `manifest.yaml` 首版只作为迁移参考和 legacy fallback 输入保留，不进入 production registry；production registry 只扫描 `template.html-video.yaml` 与 `source/index.html`。
- [x] `template.html-video.yaml` 必须包含：
  - `engine: hyperframes`
  - `engine_version`
  - `source_entry: source/index.html`
  - `output.resolution`
  - `output.fps`
  - `output.duration`
  - `inputs.schema`
  - `inputs.examples`
  - `preview`
  - `license.commercial_use: true`
  - `assets_attribution`
- [x] 模板 HTML 保留默认文案，未注入 `window.__HV_VARS__` 时可独立预览；实现细节参照设计文档“变量模板改造指南”。
- [x] 模板读取：

```js
const vars = window.__HV_VARS__ || {};
const duration = Number(window.__HV_DURATION__ || vars.duration_sec || 6);
```

- [x] 模板写入文本使用 `textContent`，不使用 `innerHTML` 写 AI 文案。
- [x] 关键元素添加：

```html
data-hv-element-id="headline" data-hv-bind="title"
```

- [x] materializer 支持变量注入式：

```html
<script>
window.__HV_VARS__ = {...};
window.__HV_DURATION__ = 6;
</script>
```

- [x] materializer 支持兼容替换式：`{{title}}`、`{{subtitle}}`、`{{duration_sec}}`。
- [x] materializer 输出 `frames/01-scene_01.html` 等相对路径，并更新 project `frames[].html_path`。
- [x] materializer 遇到 HTML override enabled 的 frame 时，不覆盖 override HTML，返回 `html_override_active` diagnostics。
- [x] materializer 对所有文本字段执行 HTML 转义或安全 JSON 注入，防止脚本注入。

**测试/验证方式**

- Run: `node tests/test-html-video-materializer.js`
- Run: `node tests/test-html-video-template-registry.js`
- 手动打开生成的 `frames/01-scene_01.html`，确认可独立显示中文默认文案和注入文案。

**完成标准**

- 至少 `glitch_title` 与 `bold_signal` 两个模板能进入 production-ready 候选。
- 生成 HTML 包含 `window.__HV_VARS__`、`window.__HV_DURATION__`、稳定元素标记。
- AI 文案不会作为 HTML 执行。

---

### Task 6: Playwright/Chromium/ffmpeg render adapter 与 prepareSourceHtml

**状态:** [首版必做]

**目标**

移植 html-video 的 Playwright 真实录制路径，替代当前默认 `npx hyperframes render` 路径，并支持 `prepareSourceHtml()`。

**Files**

- Create: `server/services/creative-video/html-video/prepareSourceHtml.js`
- Create: `server/services/creative-video/html-video/hyperframesPlaywrightAdapter.js`
- Create: `server/services/creative-video/html-video/frameRenderer.js`
- Create: `server/services/creative-video/html-video/environmentDoctor.js`
- Create: `tests/test-html-video-prepare-source-html.js`
- Create: `tests/test-html-video-playwright-adapter-command.js`
- Reference: `D:/code3/html-video/packages/adapter-hyperframes/src/render.ts`
- Read: `server/services/creative-video/renderAdapter.js`
- Read: `server/services/hyperframesRenderer.js`

**具体步骤**

- [x] 写 `prepareSourceHtml` 测试：无 `data-composition-src` 时返回原路径。
- [x] 写 `prepareSourceHtml` 测试：有 `data-composition-src` 时内联 composition HTML，注入 `window.__COMPOSITIONS__` 与 `window.__hvPlayAll()`。
- [x] 实现 prepared 临时文件 cleanup。
- [x] 参照设计文档“移植验证策略”的渲染时序对齐要求，确保 adapter 的代码注释和测试覆盖冻结动画、等待 stylesheet/fonts、释放动画、lead-in 裁剪、显式 duration 补齐等关键步骤。
- [x] 写 adapter 单元测试：mock Playwright 与 ffmpeg runner，验证 ffmpeg 参数包含：

```text
-c:v libx264
-pix_fmt yuv420p
-preset medium
-crf 20
-movflags +faststart
```

- [x] adapter 实现关键步骤，并用注释标明对应 html-video 源码段：
  - launch chromium headless
  - `recordVideo`
  - `page.addInitScript()` 冻结 CSS/SMIL 动画
  - `page.goto(file://..., waitUntil: 'domcontentloaded')`
  - 等待 stylesheet link
  - 逐个 `fonts.load()`
  - 等待 `fonts.ready`
  - 探测 CSS animation 与 GSAP finite timeline 时长
  - 调用 `window.__hvPlayAll()`
  - 调用 `window.__hvUnfreeze()`
  - 记录 `leadInMs`
  - close context 取得 webm
  - ffmpeg `-ss` 裁剪 dead lead-in
  - 显式 duration 使用 `tpad=stop_mode=clone`
  - `-t` 精准裁剪
- [x] `environmentDoctor` 检测：
  - Playwright 是否可 import
  - Chromium 是否可 launch
  - ffmpeg 可执行路径
  - 缺失时返回 `environment_not_configured` diagnostics。
- [x] adapter 错误消息必须中文，例如：`Playwright Chromium 未配置，无法渲染 html-video 模板。`
- [x] frameRenderer 接收 frame，调用 adapter 输出 `frames/01.mp4`，返回 meta：duration、fps、resolution、file size。

**测试/验证方式**

- Run: `node tests/test-html-video-prepare-source-html.js`
- Run: `node tests/test-html-video-playwright-adapter-command.js`
- 在本地有 Chromium/ffmpeg 时运行一个真实模板烟测，输出单帧 MP4。

**完成标准**

- adapter 不依赖 html-video TS monorepo。
- 显式时长帧能用 `tpad` 补齐尾帧并用 `-t` 精准裁剪。
- 缺环境时返回中文未配置状态，不让 loading 悬停。

---

### Task 7: ffmpeg concat/mux 策略

**状态:** [首版必做]

**目标**

实现多帧 MP4 拼接和 TTS/音乐混流，行为对齐 html-video core，并与当前 TTS/混音链路兼容。

**Files**

- Create: `server/services/creative-video/html-video/ffmpegComposer.js`
- Create: `tests/test-html-video-ffmpeg-composer.js`
- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`
- Read: `server/services/hyperframesRenderer.js`
- Reference: `D:/code3/html-video/packages/core/src/project.ts`

**具体步骤**

- [x] 参照设计文档“移植验证策略”的 ffmpeg 行为对齐要求，golden command 测试必须覆盖 concat demuxer、concat filter 和音频 mux 参数，避免未来修改 PTS、编码参数或 `-shortest` 行为。
- [x] 写 golden command 测试：单 engine 多帧使用 concat demuxer：

```text
ffmpeg -y -f concat -safe 0 -i frames/concat.txt -c copy exports/output.mp4
```

- [x] 写 golden command 测试：混合 engine 或编码不一致使用 concat filter：

```text
ffmpeg -y -i 01.mp4 -i 02.mp4 -filter_complex [0:v][1:v]concat=n=2:v=1:a=0[v] -map [v] -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart output.mp4
```

- [x] 写 golden command 测试：音频 mux 使用 video copy + AAC + `-shortest`：

```text
-map 0:v -map [aout] -c:v copy -c:a aac -b:a 192k -shortest
```

- [x] 实现 `concatFramesWithFfmpeg(frameMp4s, outputPath, workDir, opts)`。
- [x] 实现 `muxAudioWithFfmpeg({ videoPath, outputPath, musicPath, narrationPath, musicVolumeDb, narrationVolumeDb, fadeInSec, fadeOutSec, videoDurationSec })`。
- [x] 实现 Windows 路径写入 concat list 的引号转义，确保 ffmpeg 可读。
- [x] projectOrchestrator export 阶段：
  - 按 `frames[].order` 渲染单帧。
  - 根据 engine/encoding 判断 concat 策略。
  - concat 后复用当前 TTS manifest 或 project.audio.narration_path mux。
  - `exports/output-YYYY-MM-DD_HH-mm-ss.mp4` 不覆盖旧文件。
- [x] ffprobe 校验时长，误差超过阈值返回 diagnostics。

**测试/验证方式**

- Run: `node tests/test-html-video-ffmpeg-composer.js`
- Run: `node tests/test-creative-render-adapter.js`
- 有 ffmpeg 时运行真实 concat/mux 烟测。

**完成标准**

- 单 engine 快速 concat 不重编码。
- 混合 engine 走 concat filter 并重编码。
- 音频 mux 后输出不超过视频时长，背景音乐有默认淡出策略。

---

### Task 8: 纵向 MVP 渲染检查点

**状态:** [首版必做，必须在继续前端和完整编辑器前完成]

**目标**

不等待完整前端、自然语言编辑和多模板迁移，先用 `glitch_title` 一个 production-ready 模板验证最危险的纵向链路：mock `scene_spec` -> mock `template_inputs` -> project -> materialize -> 单帧 render -> MP4。

**Files**

- Create: `tests/test-html-video-vertical-mvp-smoke.js`
- Read: `server/templates/glitch_title/template.html-video.yaml`
- Read: `server/templates/glitch_title/source/index.html`
- Read: `server/services/creative-video/html-video/projectStore.js`
- Read: `server/services/creative-video/html-video/materializer.js`
- Read: `server/services/creative-video/html-video/hyperframesPlaywrightAdapter.js`
- Read: `server/services/creative-video/html-video/ffmpegComposer.js`

**具体步骤**

- [x] 新增 mock `scene_spec`，只包含一个 `scene_01`，duration 为 4-6 秒，文案为中文。
- [x] 新增 mock `template_inputs`，字段完全符合 `glitch_title` 的 `inputs.schema`。
- [x] 创建临时 projectDir，并通过 `projectStore` 写入 `HtmlVideoProject`。
- [x] 调用 `materializer` 生成 `frames/01-scene_01.html`。
- [x] 调用 `hyperframesPlaywrightAdapter` 渲染单帧 MP4。
- [x] 用 ffprobe 或现有 video probe 检查 MP4 存在、时长大于 0、分辨率符合模板 output。
- [x] 该测试必须和真实 Playwright/ffmpeg 一样受环境变量保护：

```js
if (process.env.RUN_HTML_VIDEO_REAL_RENDER !== '1') {
  console.log('跳过 html-video 纵向 MVP 真实渲染烟测：未设置 RUN_HTML_VIDEO_REAL_RENDER=1。');
  process.exit(0);
}
```

**测试/验证方式**

- Default Run: `node tests/test-html-video-vertical-mvp-smoke.js`
- Expected: 输出中文跳过信息并退出 0。
- Real Run: `set RUN_HTML_VIDEO_REAL_RENDER=1; node tests/test-html-video-vertical-mvp-smoke.js`
- Expected: 生成单帧 MP4，并通过时长、分辨率、非空文件校验。

**完成标准**

- 在 Task 9-15 继续铺外围模块前，至少一个 production-ready 模板的核心渲染链路已被真实验证。
- 如果该截点失败，暂停前端和编辑器开发，优先修模板、materializer、adapter 或 ffmpeg 链路。

---

### Task 9: validationGate、diagnostics、visual QA 扩展

**状态:** [首版必做]

**目标**

所有失败阶段返回结构化 diagnostics 和中文 user_message，视觉 QA 能覆盖新渲染路径的关键风险。

**Files**

- Create: `server/services/creative-video/html-video/diagnostics.js`
- Create: `server/services/creative-video/html-video/validationGate.js`
- Create: `tests/test-html-video-validation-gate.js`
- Modify: `server/services/creative-video/visualQaService.js`
- Modify: `tests/test-video-quality-report.js`

**具体步骤**

- [x] 实现 diagnostics 工厂：

```js
createDiagnostic({
  code,
  stage,
  userMessage,
  details = {},
  fallbackAllowed = false,
})
```

- [x] 所有 diagnostics 输出字段统一为：

```json
{
  "code": "unsupported_engine",
  "stage": "template_registry",
  "user_message": "该模板引擎首版暂不支持。",
  "details": {},
  "fallback_allowed": true
}
```

- [x] validationGate 增加检查：
  - `template_missing`
  - `unsupported_engine`
  - `source_entry_not_html`
  - `license_not_allowed`
  - `template_inputs_invalid`
  - `timeline_item_kind_unsupported`
  - `asset_path_invalid`
  - `playwright_not_configured`
  - `ffmpeg_not_configured`
  - `html_override_active`
- [x] `timeline.tracks[].items[].kind !== 'frame'` 首版返回 `timeline_item_kind_unsupported`，不静默忽略。
- [x] visual QA 扩展：
  - 分辨率与 project output 不一致。
  - ffprobe 时长偏差。
  - 抽帧近白/近黑/低信息占比。
  - 抽帧 contact sheet 生成失败或有效抽帧数量过少。
  - 主体/文本有效像素占比过低，疑似空画面或样式未加载。
  - 动画未运行：连续抽帧差异过低。
  - 字体/CSS 失效风险：adapter diagnostics 中有 stylesheet/font timeout。
- [x] 所有 QA 失败 message 使用中文。

**测试/验证方式**

- Run: `node tests/test-html-video-validation-gate.js`
- Run: `node tests/test-video-quality-report.js`
- Run: `node tests/test-creative-video-workflow-facade.js`

**完成标准**

- 每个失败阶段都有明确 code/stage/user_message。
- fallback 只在允许时触发，并记录原始 diagnostics。
- visual QA 可识别空白帧、低信息帧、时长/分辨率偏差。

---

### Task 10: htmlVideoWorkflow 与 workflowFacade 集成

**状态:** [首版必做]

**目标**

把新 html-video production path 接入现有一键工作流，同时保留 legacy fallback。

**Files**

- Create: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Create: `server/services/creative-video/html-video/projectOrchestrator.js`
- Create: `tests/test-html-video-workflow.js`
- Modify: `server/services/creative-video/workflowFacade.js`
- Modify: `tests/test-creative-video-workflow-facade.js`
- Read: `server/services/creative-video/ttsService.js`
- Read: `server/services/creative-video/visualQaService.js`

**具体步骤**

- [x] projectOrchestrator 实现：
  - `createProject()`
  - `materializeProject()`
  - `renderProject()`
  - `exportProject()`
  - `rerenderProject()`
  - `applyEditPatch()`
- [x] projectOrchestrator 只做工程生命周期编排，具体执行委托给职责模块：
  - `materializer.js`：负责 HTML/frame HTML 物化。
  - `frameRenderer.js` + `hyperframesPlaywrightAdapter.js`：负责单帧 render，Playwright 细节只在 adapter 中。
  - `ffmpegComposer.js`：负责多帧 concat 和音频 mux。
  - `editPatchService.js`：负责 patch 校验、应用和 revision 标记。
- [x] htmlVideoWorkflow 实现：
  - `generateProject({ workflowId, runId, creativeContext, sceneSpec, target, rootDir, services })`
  - `renderOrExport({ projectId, workflowId, rootDir, services })`
  - `applyEdit({ workflowId, payload, rootDir, services })`
  - `rerender({ workflowId, payload, rootDir, services })`
- [x] `htmlVideoWorkflow.generateProject()` 顺序：

```text
scene_spec
  -> sceneSpecMapper.mapSceneSpecToContentGraph()
  -> templateRegistry.buildCompactIndex()
  -> templateSelectorAgent.selectTemplate()
  -> validationGate.validateTemplate()
  -> templateInputAgent.fillInputs()
  -> validationGate.validateInputs()
  -> projectOrchestrator.createProject()
  -> materializer.materializeProject()
```

- [x] `workflowFacade.generateCreativeVideoProject()` 顺序改为：

```text
requestSceneSpec()
  -> htmlVideoWorkflow.generateProject()
  -> ttsService.synthesizeSceneNarration()
  -> htmlVideoWorkflow.renderOrExport()
  -> ffmpegComposer mux 或当前 hyperframesRenderer.concatAndMuxAudio 兼容层
  -> visualQaService.inspectRenderedVideo()
```

- [x] 失败 fallback 策略：
  - 开发环境默认暴露 html-video diagnostics，不静默吞掉。
  - 配置允许时 fallback 到 legacy `requestFrameSpecs()` + `hyperframesTemplateRenderer.renderHyperframesProjectFiles()`。
  - fallback 后结果记录 `render_mode: 'legacy'` 与 `html_video_diagnostics`。
- [x] 删除默认 rich path 中 `requestHtmlFill()` 调用；函数可保留但只给 legacy 测试使用。
- [x] `projectOrchestrator` 不调用 AI；AI 适配全部在 `htmlVideoWorkflow`。

**测试/验证方式**

- Run: `node tests/test-html-video-workflow.js`
- Run: `node tests/test-creative-video-workflow-facade.js`
- Run: `node tests/test-creative-workflows.js`

**完成标准**

- 新 workflow 默认尝试 html-video production path。
- legacy fallback 可配置、可诊断、可追踪。
- TTS、混音、visual QA 仍在主流程中执行。

---

### Task 11: 编辑成片 API 与后端服务接入

**状态:** [首版必做，timeline/html/elements/transition/enhance API 首版返回 501]

**目标**

提供可编辑工程读取、表单保存、自然语言编辑、重渲、导出、版本查看 API。

**Files**

- Create: `server/services/creative-video/html-video/editPatchService.js`
- Create: `tests/test-html-video-edit-patch-service.js`
- Create: `tests/test-html-video-routes.js`
- Modify: `server/services/creativeWorkflows.js`
- Modify: `server/routes/creativeWorkflows.js`
- Modify: `tests/test-creative-workflow-routes.js`

**具体步骤**

- [x] editPatchService 支持：

```js
applyTemplateInputsPatch(project, patch)
applyFrameInputsPatch(project, frameId, patch)
applyNarrationPatch(project, frameId, text)
applyCaptionPatch(project, frameId, captionPatch)
replaceFrameTemplate(project, frameId, templateId, inputs)
createRevision(project, change)
```

- [x] patch 必须经过 schema 与白名单字段校验，不允许写任意路径或 HTML。
- [x] narration patch 标记 `requires_tts: true`、`requires_render: true`。
- [x] inputs/caption/duration patch 标记 `requires_render: true`。
- [x] replace template 只允许 schema 兼容模板。
- [x] `server/services/creativeWorkflows.js` 新增方法：
  - `getHtmlVideoProject(workflowId)`
  - `patchHtmlVideoProjectInputs(workflowId, payload)`
  - `patchHtmlVideoProjectFrame(workflowId, frameId, payload)`
  - `editHtmlVideoProject(workflowId, payload)`
  - `renderHtmlVideoProject(workflowId, payload)`
  - `exportHtmlVideoProject(workflowId, payload)`
  - `listHtmlVideoProjectExports(workflowId)`
- [x] `server/routes/creativeWorkflows.js` 新增：

```text
GET    /api/creative-workflows/:workflowId/html-video-project
PATCH  /api/creative-workflows/:workflowId/html-video-project/inputs
PATCH  /api/creative-workflows/:workflowId/html-video-project/frames/:frameId
POST   /api/creative-workflows/:workflowId/html-video-project/edit
POST   /api/creative-workflows/:workflowId/html-video-project/render
POST   /api/creative-workflows/:workflowId/html-video-project/export
GET    /api/creative-workflows/:workflowId/html-video-project/exports
```

- [x] 预留但首版返回 501：

```text
PATCH  /api/creative-workflows/:workflowId/html-video-project/timeline
PATCH  /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/html
PATCH  /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/elements/:elementId
PATCH  /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/transition
POST   /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/enhance
POST   /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/unenhance
```

- [x] 所有 route 错误 message 中文化。
- [x] 旧 `/video-spec` 继续可用：有新 project 时返回桥接字段，旧工程时返回 legacy 数据。

**测试/验证方式**

- Run: `node tests/test-html-video-edit-patch-service.js`
- Run: `node tests/test-html-video-routes.js`
- Run: `node tests/test-creative-workflow-routes.js`

**完成标准**

- “编辑成片”能读取 HtmlVideoProject。
- 表单保存、自然语言编辑、重渲、导出都有 API。
- 预留 API 明确返回 501 和中文说明，不误报成功。

---

### Task 12: 前端 API client、hook 与组件化编辑器

**状态:** [首版必做，高级能力面板为预留]

**目标**

前端接入 HtmlVideoProject，并保持组件化、中文状态、禁用态和重复点击保护。

**Files**

- Create: `frontend-react/src/hooks/useHtmlVideoProject.js`
- Create: `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`
- Create: `frontend-react/src/components/creative-video-editor/ProjectStatusBar.jsx`
- Create: `frontend-react/src/components/creative-video-editor/TemplateInputsPanel.jsx`
- Create: `frontend-react/src/components/creative-video-editor/FrameInputsPanel.jsx`
- Create: `frontend-react/src/components/creative-video-editor/NarrationPanel.jsx`
- Create: `frontend-react/src/components/creative-video-editor/CaptionsPanel.jsx`
- Create: `frontend-react/src/components/creative-video-editor/ProjectFramesList.jsx`
- Create: `frontend-react/src/components/creative-video-editor/ExportsPanel.jsx`
- Create: `frontend-react/src/components/creative-video-editor/NaturalLanguageEditBox.jsx`
- 条件创建: `frontend-react/src/components/creative-video-editor/ReservedCapabilitiesPanel.jsx`
- Create: `tests/test-html-video-api-client.mjs`
- Create: `tests/test-html-video-editor-components.mjs`
- Modify: `frontend-react/src/api/client.js`
- Modify: `frontend-react/src/components/creative-video-editor/CreativeVideoEditor.jsx`
- Modify: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Modify: `frontend-react/src/styles.css`

**具体步骤**

- [x] `api.client.js` 增加：
  - `getHtmlVideoProject(workflowId)`
  - `patchHtmlVideoProjectInputs(workflowId, payload)`
  - `patchHtmlVideoProjectFrame(workflowId, frameId, payload)`
  - `editHtmlVideoProject(workflowId, payload)`
  - `renderHtmlVideoProject(workflowId, payload)`
  - `exportHtmlVideoProject(workflowId, payload)`
  - `listHtmlVideoProjectExports(workflowId)`
- [x] `useHtmlVideoProject` 状态机：

```text
idle
loading        正在加载可编辑成片工程...
ready          可编辑成片工程已加载。
saving         正在保存模板字段...
editing        正在应用编辑...
materializing  正在重新生成 HTML...
rendering      正在渲染单帧预览...
exporting      正在导出成片...
tts            正在重新生成旁白...
error          操作失败。
not_configured 渲染环境未配置。
needs_validation 工程需要验证。
```

- [x] hook 内部使用 ref 防重复请求，所有 mutating action 在进行中禁用。
- [x] `HtmlVideoProjectEditor` 只组织布局：
  - 左侧 `ProjectFramesList`
  - 中间 `FrameInputsPanel` / `TemplateInputsPanel`
  - 右侧 `NarrationPanel` / `CaptionsPanel` / `ExportsPanel`
  - 顶部 `ProjectStatusBar` 与导出/重渲按钮
- [x] `TemplateInputsPanel` 根据 schema 渲染 string/number/boolean/enum/array 的基础控件。
- [x] `FrameInputsPanel` 支持单帧 inputs、duration、模板替换入口。
- [x] `NaturalLanguageEditBox` loading 文案：`正在解析编辑意图...`，完成后根据后端返回显示 `编辑已应用，需要重新渲染。` 或失败原因。
- [x] `Export` 按钮 loading 文案：`正在导出成片...`，成功后刷新 exports，失败后展示中文错误。
- [x] 默认不创建、不展示 `ReservedCapabilitiesPanel`；只有产品明确要求可见灰态入口时，才创建该组件并受 feature flag 控制：
  - 时间线
  - 毫秒级剪辑
  - HTML 源码
  - 元素调整
  - 转场
  - Remotion enhancement
- [x] 不做 Premiere 式复杂编辑器，不做拖拽时间线，不开放 HTML 源码编辑；首版高级能力只保留 schema/API/service 口子。
- [x] `CreativeVideoEditor.jsx` 先尝试加载新工程；404 或 `NO_HTML_VIDEO_PROJECT` 时 fallback 到旧 `useCreativeVideoEditor`。

**测试/验证方式**

- Run: `node tests/test-html-video-api-client.mjs`
- Run: `node tests/test-html-video-editor-components.mjs`
- Run: `node tests/test-creative-video-editor-components.mjs`
- Run: `npm run build:frontend`

**完成标准**

- 前端新增 UI 被拆分为多个组件。
- 所有接口操作有中文 loading、禁用态、成功/失败/未配置状态。
- 旧编辑器仍可打开 legacy 工程。

---

### Task 13: 与当前 TTS、混音、visual QA、creative-video-editor 集成

**状态:** [首版必做]

**目标**

新链路接入当前项目已有 TTS、混音、视觉 QA 和编辑入口，避免另起一套重复业务系统。

**Files**

- Modify: `server/services/creative-video/ttsService.js`
- Modify: `server/services/creative-video/visualQaService.js`
- Modify: `server/services/creativeVideoRerender.js`
- Modify: `server/services/creativeWorkflows.js`
- Modify: `frontend-react/src/components/creative-video-editor/CreativeVideoEditor.jsx`
- Modify: `tests/test-creative-video-tts-service.js`
- Modify: `tests/test-creative-video-rerender.js`
- Modify: `tests/test-creative-video-editor.js`

**具体步骤**

- [x] `HtmlVideoProject.audio` 记录：
  - `tts_manifest_path`
  - `narration_path`
  - `music_path`
  - `mix.music_volume_db`
  - `mix.narration_volume_db`
  - `mix.fade_in_sec`
  - `mix.fade_out_sec`
- [x] 保留 `ttsService.synthesizeSceneNarration()`，输出 manifest 后写入 `project.audio.tts_manifest_path`。
- [x] narration patch 后调用当前 TTS 服务，只重做受影响场景或整段 manifest。
- [x] 混音阶段优先使用 `ffmpegComposer.muxAudioWithFfmpeg()`；兼容当前 `hyperframesRenderer.concatAndMuxAudio()` 返回结构。
- [x] visual QA 使用新 export 路径检查，不假设 `output.mp4` 固定文件名。
- [x] creative-video-editor 的旧 scene/frame 编辑能力保留；新工程编辑优先走 `HtmlVideoProjectEditor`。
- [x] `server/services/creativeVideoRerender.js` 标注为 legacy rerender；新工程 rerender 走 projectOrchestrator。

**测试/验证方式**

- Run: `node tests/test-creative-video-tts-service.js`
- Run: `node tests/test-creative-video-rerender.js`
- Run: `node tests/test-creative-video-editor.js`
- Run: `node tests/test-html-video-workflow.js`

**完成标准**

- TTS manifest 写入 project。
- export 后 visual QA 可检查新文件。
- 旧编辑器和旧 rerender 不被破坏。

---

### Task 14: legacy fallback 策略与迁移/废弃边界

**状态:** [首版必做]

**目标**

并行上线新链路，失败时可回滚到旧链路，同时明确旧模块保留、迁移、拆分或废弃。

**Files**

- Modify: `server/services/creative-video/workflowFacade.js`
- Modify: `server/services/creative-video/templateRegistry.js`
- Modify: `server/services/creative-video/hyperframesTemplateRenderer.js`
- Modify: `server/services/creative-video/projectWriter.js`
- Modify: `server/services/creative-video/renderAdapter.js`
- 条件修改: `docs/superpowers/specs/2026-06-17-html-video-editable-production-pipeline-design.md`，仅当实施发现设计需要修正且用户同意更新设计文档时修改

**具体步骤**

- [x] 参照设计文档“现有模块对应关系”表，处理 `creativeSpecAgent.js`、`projectWriter.js`、`hyperframesTemplateRenderer.js`、`renderAdapter.js`、`templateRegistry.js`、`visualQaService.js` 等旧模块，确保首版保留、迁移、拆分或废弃边界一致。
- [x] 配置开关：

```text
HTML_VIDEO_PRODUCTION_ENABLED=true
HTML_VIDEO_LEGACY_FALLBACK_ENABLED=true
HTML_VIDEO_REMOTION_ENHANCEMENT_ENABLED=false
```

- [x] fallback 允许触发的情况：
  - 没有 production-ready 模板。
  - AI selector/input JSON 失败且重试后仍失败。
  - Playwright/ffmpeg 未配置，并且任务允许 legacy。
  - validationGate 返回 `fallback_allowed: true`。
- [x] fallback 不允许静默触发的情况：
  - 模板 license 不允许。
  - patch 越权尝试写 HTML 或路径。
  - project schema 已损坏。
  - 用户明确要求使用 html-video production path。
- [x] 旧模块处理方式：

| 旧模块 | 首版处理 | 后续处理 |
| --- | --- | --- |
| `creativeSpecAgent.js` | 保留 scene_spec，拆 AI 选模板/填表职责 | 删除默认完整 HTML 填充 prompt |
| `templateRegistry.js` | 保留 legacy registry | 只作为旧工程 fallback |
| `hyperframesTemplateRenderer.js` | 保留 legacy composer | 新链路稳定后停止默认调用 |
| `projectWriter.js` | 保留 legacy writer | 新工程使用 projectStore |
| `renderAdapter.js` | 保留 npx hyperframes adapter | 只服务 legacy |
| `creativeVideoRerender.js` | 保留旧 rerender | 新工程使用 projectOrchestrator |
| `server/templates/*/manifest.yaml + source.html` | 保留迁移参考 | production-ready 模板迁移到 `template.html-video.yaml + source/index.html` |

- [x] workflow result 记录：
  - `render_mode: 'html-video' | 'legacy'`
  - `html_video_project_path`
  - `html_video_diagnostics`
  - `legacy_fallback_reason`

**测试/验证方式**

- Run: `node tests/test-html-video-workflow.js`
- Run: `node tests/test-creative-video-workflow-facade.js`
- 用 mock 让 html-video 失败，确认 legacy fallback 成功且 diagnostics 保留。

**完成标准**

- 新链路失败不会破坏现有可用路径。
- fallback 有明确记录，便于排查。
- 旧模块边界清晰，没有被新功能继续塞大。

---

### Task 15: 真实渲染烟测、端到端验收与文档

**状态:** [首版必做]

**目标**

跑通至少一个模板的完整链路，并把验证命令、验收标准、风险和回滚策略固化。

**Files**

- Create: `tests/test-html-video-real-render-smoke.js`
- 条件修改: `tests/run-all.js`，仅当需要在测试文件自跳过之外再显式排除真实烟测时修改
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-17-html-video-editable-production-pipeline-plan.md`，实施完成后按实际进度勾选任务

**具体步骤**

- [x] 因为 `tests/run-all.js` 会自动发现所有 `test-*.js|mjs`，真实渲染烟测文件自身必须在未开启环境变量时自跳过，避免 `npm test` 默认启动 Playwright/ffmpeg。
- [x] `test-html-video-real-render-smoke.js` 文件开头必须包含以下保护逻辑：

```js
if (process.env.RUN_HTML_VIDEO_REAL_RENDER !== '1') {
  console.log('跳过 html-video 真实渲染烟测：未设置 RUN_HTML_VIDEO_REAL_RENDER=1。');
  process.exit(0);
}
```

- [x] `tests/run-all.js` 可额外显式排除 `test-html-video-real-render-smoke.js`，但不能只依赖 run-all 排除；测试文件自跳过是硬性要求。
- [x] 真实渲染烟测通过环境变量开启：

```text
RUN_HTML_VIDEO_REAL_RENDER=1
```

- [x] 真实烟测流程：

```text
mock scene_spec
  -> mock AI 选择 glitch_title
  -> mock AI 填 template_inputs
  -> create HtmlVideoProject
  -> materialize frame HTML
  -> Playwright/Chromium record webm
  -> ffmpeg encode mp4
  -> concat/export
  -> mux TTS 或 mock narration
  -> visual QA
  -> edit title
  -> rerender
  -> new export
```

- [x] README 增加运行要求：
  - Node.js 22
  - Playwright browsers 安装方式
  - ffmpeg 路径配置
  - 如何启用/关闭 html-video production path
  - 如何开启真实渲染烟测
- [x] 验收脚本检查：
  - MP4 文件存在。
  - 时长接近预期。
  - 分辨率正确。
  - 没有空白帧。
  - 首帧没有明显字体闪烁。
  - CSS animation 或 GSAP 动画真实出现在视频中。
  - 编辑字段后生成新 export。

**测试/验证方式**

- Run: `npm test`
  - Expected: `tests/test-html-video-real-render-smoke.js` 被自动发现时输出中文跳过信息并退出 0，不启动 Playwright/ffmpeg。
- Run: `npm run build:frontend`
- Optional Run: `set RUN_HTML_VIDEO_REAL_RENDER=1; node tests/test-html-video-real-render-smoke.js`

**完成标准**

- 普通测试不要求本机具备 Playwright/ffmpeg 环境。
- 开启真实烟测时至少一个 production-ready 模板完整跑通。
- README 说明完整、中文友好。

---

## 3. API 合同

### 首版必做 API

```text
GET    /api/creative-workflows/:workflowId/html-video-project
PATCH  /api/creative-workflows/:workflowId/html-video-project/inputs
PATCH  /api/creative-workflows/:workflowId/html-video-project/frames/:frameId
POST   /api/creative-workflows/:workflowId/html-video-project/edit
POST   /api/creative-workflows/:workflowId/html-video-project/render
POST   /api/creative-workflows/:workflowId/html-video-project/export
GET    /api/creative-workflows/:workflowId/html-video-project/exports
```

### 首版返回 501 的预留 API

```text
PATCH  /api/creative-workflows/:workflowId/html-video-project/timeline
PATCH  /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/html
PATCH  /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/elements/:elementId
PATCH  /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/transition
POST   /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/enhance
POST   /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/unenhance
```

### 前端请求状态文案

| 操作 | loading 文案 | 成功文案 | 失败/特殊状态 |
| --- | --- | --- | --- |
| 加载工程 | 正在加载可编辑成片工程... | 可编辑成片工程已加载。 | 加载可编辑成片工程失败。 |
| 保存模板字段 | 正在保存模板字段... | 模板字段已保存，需要重新渲染。 | 保存模板字段失败。 |
| 保存帧字段 | 正在保存帧字段... | 帧字段已保存，需要重新渲染。 | 保存帧字段失败。 |
| 自然语言编辑 | 正在解析编辑意图... | 编辑已应用，需要重新渲染。 | 编辑失败。 |
| 重新生成 HTML | 正在重新生成 HTML... | HTML 已重新生成。 | 重新生成 HTML 失败。 |
| 渲染预览 | 正在渲染单帧预览... | 单帧预览已更新。 | 渲染环境未配置。 |
| 导出成片 | 正在导出成片... | 成片已导出。 | 导出成片失败。 |
| 重新旁白 | 正在重新生成旁白... | 旁白已更新。 | TTS 未配置或旁白生成失败。 |

---

## 4. 测试计划

### 单元测试

- `contentGraph.validate/topoSort/totalDurationSec` 行为与 html-video 语义一致。
- `scene_spec` 到 `contentGraph` 的线性映射保留 order、duration、kind、narration、captions、visual_text。
- registry 能读取原生 `template.html-video.yaml`。
- compact index 只暴露 AI 选择需要字段。
- 模板兼容性校验覆盖 aspect、duration、engine、source_entry、license。
- selector/input agent 只接受 JSON，不接受完整 HTML。
- JSON Schema 校验拦住缺失必填、超长、类型错误、枚举错误。
- materializer 生成 `window.__HV_VARS__`、`window.__HV_DURATION__`、稳定元素标记。
- prepareSourceHtml 能内联 `data-composition-src` 并注册 `window.__hvPlayAll()`。
- validationGate 能识别远程字体、缺失 preview poster、unsupported engine、timeline item kind。
- diagnostics 包含 code、stage、user_message、details、fallback_allowed。
- edit patch 正确更新 project、frame inputs、旁白、字幕。
- revisions/exports 不覆盖历史。

### 集成测试

- AI mock：`scene_spec -> template_id -> template_inputs`。
- 生成 HtmlVideoProject。
- materialize frame HTML。
- prepareSourceHtml 处理单文件模板和组合模板。
- Playwright adapter mock 输出 MP4。
- ffmpeg composer mock 拼接多帧。
- 混合 engine 或编码参数不一致时选择 concat filter + re-encode。
- 编辑 inputs 后重新生成 HTML 并新增 revision。
- 旁白 patch 后标记 `requires_tts: true`。
- workflowFacade 在 html-video 失败时按配置 fallback 到 legacy。

### 真实渲染测试

开启 `RUN_HTML_VIDEO_REAL_RENDER=1` 后至少一个模板跑通：

```text
AI mock 选择模板
  -> 填 template_inputs
  -> materialize HTML
  -> Playwright/Chromium 录制
  -> ffmpeg 输出 mp4
  -> 当前 visual QA
  -> 编辑字段
  -> 重渲新 export
```

---

## 5. 验收标准

- AI 不再返回完整 HTML 作为默认生产路径。
- AI 选模板只返回 `template_id`、`reason`、`confidence` 等 JSON。
- AI 填内容只返回 `template_inputs` JSON。
- 系统读取原生 `template.html-video.yaml`。
- 首版默认只将 `engine: hyperframes` 且 `source_entry` 为 HTML 的模板列入生产候选。
- 模板候选受 license 策略过滤，非商业授权模板不会进入 compact index。
- 系统基于 `inputs.schema` 校验 AI 填表结果。
- 系统把 `scene_spec` 映射成 `contentGraph`，再生成 `frames[]`。
- 系统生成 `HtmlVideoProject` 并保存到 workflow/run 工程目录。
- 系统能把 `template_inputs` 变成可打开的 HTML/frame HTML。
- MP4 输出支持 Playwright + Chromium + ffmpeg 路径。
- 渲染过程处理 prepareSourceHtml、字体加载、动画起点、录制时长、webm 到 mp4 转码。
- 生成后“编辑成片”能打开项目、展示字段、保存修改、重渲并生成新 export。
- 至少一个模板完整跑通“AI 选模板 -> AI 填表 -> 生成 HTML -> Playwright 录制 -> ffmpeg 输出 MP4 -> 混音 -> 编辑重渲”。
- 所有失败阶段返回结构化 diagnostics 和中文 `user_message`。
- project schema 为时间线、剪辑、源码编辑、元素拖拽、转场和 Remotion enhancement 保留字段。
- 前端编辑器组件化，不出现把全部 UI 和业务状态塞进单个组件的实现。
- 后端 html-video 链路按职责拆分，不出现单文件承载 registry、agent、store、render、ffmpeg、edit 的实现。

---

## 6. 风险与回滚/fallback 策略

| 风险 | 应对 | 回滚/fallback |
| --- | --- | --- |
| Playwright 或 Chromium 不可用 | `environmentDoctor` 启动和渲染前检测，返回中文未配置状态 | 配置允许时 fallback 到 legacy renderAdapter |
| ffmpeg 不可用 | 支持 `FFMPEG_PATH`、`@ffmpeg-installer/ffmpeg`、PATH，失败返回 `ffmpeg_not_configured` | 配置允许时 fallback；导出按钮显示“渲染环境未配置” |
| 模板未变量化 | registry 只放行 production-ready 模板 | 旧模板保留 legacy 路径，不进入 AI 候选 |
| 字体外链不稳定 | adapter 等待 stylesheet/fonts 并设置超时，QA 记录 font timeout | 后续将常用字体本地化 |
| AI 输出越权 HTML | JSON only parser 拒绝 `<html`、`<script`、`<!doctype` | 返回 `ai_output_not_json`，可重试或 fallback |
| license 误用 | registry 默认 commercial only，attribution metadata 入 export | license 不允许时不 fallback 到同模板 |
| 编辑覆盖历史 | 所有编辑生成 revision，所有导出新 export | projectStore 可回读上一 revision/export |
| 多帧拼接音画不同步 | 显式 duration、统一 fps、ffprobe 校验 | 混合 engine 改用 concat filter 重编码 |
| Remotion 误入首版候选 | registry 默认隐藏 `engine: remotion` | 只有 feature flag 可进入 enhancement 预留 |
| schema 损坏 | projectStore load 时 validate，失败返回中文 diagnostics | 保留旧 workflow result 和 legacy 数据 |

---

## 7. 自检清单

- 已覆盖 html-video 生产核心链路接入。
- 已覆盖 JS 行为移植，明确不引入 html-video TypeScript monorepo 作为运行时依赖。
- 已覆盖 contentGraph JS 移植与 scene_spec 映射。
- 已覆盖原生 `template.html-video.yaml` 注册与 license/engine/source_entry 过滤。
- 已覆盖 AI 选模板与 AI 填表 JSON 流程。
- 已覆盖 HtmlVideoProject schema、projectStore、revisions/exports。
- 已覆盖 materializer 与变量模板改造。
- 已覆盖 Playwright/Chromium/ffmpeg adapter，包括 prepareSourceHtml。
- 已覆盖 ffmpeg concat/mux 策略。
- 已覆盖 validationGate、diagnostics、visual QA 扩展。
- 已覆盖编辑成片 API 与前端接入。
- 已覆盖与 workflowFacade、TTS、混音、visualQaService、creative-video-editor 的集成。
- 已覆盖 legacy fallback 策略。
- 已覆盖测试计划和验收标准。
- 已标注首版必做与预留字段/接口。
- 已明确新增模块职责边界，避免大文件。
- 已明确前端组件拆分建议。
- 已明确旧模块保留、迁移、拆分或废弃。
- 已明确风险与回滚/fallback 策略。
- 已完成空白任务标记扫描，未发现需要替换的问题项。
