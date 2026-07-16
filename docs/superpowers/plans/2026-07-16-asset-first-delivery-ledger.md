# asset-first 图片摄影机超大任务 Delivery Ledger

> 总目标：完整实现 [`2026-07-16-asset-first-image-camera-focus-summary.md`](./2026-07-16-asset-first-image-camera-focus-summary.md) 中所有尚未落地的目标，并完成测试、双 Review、中文提交和最终端到端验收。
>
> 执行方式：[`2026-07-16-asset-first-agent-loop-design.md`](../specs/2026-07-16-asset-first-agent-loop-design.md)

## 固定边界

- 分支：`dev`
- overlay P0：已完成，不重复实现或回滚
- 工作方式：阶段内部自动继续，不等待用户确认
- 修改方式：单写者；只读审计和 Review 可并行
- 验证方式：新行为必须先看到相关测试失败，再最小实现到通过
- Review：每个任务完成后执行规格 Review 和代码质量 Review
- 提交：每个独立任务通过验证和 Review 后使用中文提交
- 停止：只有总目标完成或出现真实用户授权阻塞

## Goal 基线与用户改动清单

- Goal ID：`asset-first-camera`
- 持久 Goal 绑定时间：2026-07-16
- 不可变恢复基线：`769d178e6328a85141a8e9dd4bba6744fb96c7d7`
- 基线分支：`dev`
- 基线工作区：clean

Goal 早期记录的五个用户改动已经由 `da95a40` 保留并进入当前基线，不再是未提交脏改动：

- `server/services/creative-video/html-video/layoutQaService.js`
- `server/services/creative-video/retryPlanner.js`
- `tests/test-creative-workflow-retry-planner.js`
- `tests/test-html-video-layout-qa-service.js`
- `tests/fixtures/html-video-layout-qa/text-container-sibling.html`

后续任务修改这些文件时必须保留 `da95a40` 的布局误报修复与单次忽略恢复语义。每个 Task 开始时重新记录现场 `git status --short`；新出现的用户改动不由本清单自动覆盖。

## 范围分类

| 范围 | 状态 | 说明 |
|---|---|---|
| overlay P0 | `already_done` | 作为不可回归基线；不重新实现 motion primitive 或恢复自由 overlay |
| 统一素材、多图连续编排、截图 A/B 级可靠聚焦、Camera QA/恢复 | `in_scope` | summary 第一阶段与完整交付链 |
| 自然图片 C 级低倍率宽松聚焦 | `in_scope` | summary 第二阶段；依赖第一阶段和真实样本基线，D 级始终不聚焦 |
| 任意图片像素级准确承诺、逐 beat 新增 LLM 调用、多目标复杂跟踪 | `deferred` | summary 明确暂不进入；不得作为隐含完成条件 |
| 为少量场景新增沉重 OCR/CV/Agent Runtime/数据库/消息队列 | `rejected` | 优先复用 DOM、人工 fixture、现有 Chromium 与原生能力 |

## Phase 依赖视图

| Phase | 依赖与范围 |
|---|---|
| A. 实时代码与需求覆盖审计 | 基线审计与覆盖矩阵 |
| B. 统一视觉素材 | A 完成后执行 |
| C. 多图编排与 Scene 连续时间线 | 依赖 B |
| D. 焦点、摄影机与字幕同步 | 依赖 C 的 Image Sequence Plan 和 Caption 绑定 |
| E. QA、定向修复与恢复 | 依赖 D 的 Camera Plan 和渲染产物 |
| F. 最终真实任务端到端验收 | 依赖 B～E 全部完成 |

本表只表达静态依赖，不记录状态。当前执行状态只以下方 Task 行和 Requirement 行为准。

## Task DAG 与唯一状态

| Task | 状态 | 依赖 | 代码提交 | 下一门 |
|---|---|---|---|---|
| A-01 实时代码与需求覆盖审计 | `complete` | - | `b48fcf6` | - |
| B-01 统一视觉素材契约 | `complete` | A-01 | `9abb219` | - |
| B-02 现有 producer 统一接入 | `complete` | B-01 | `b3b4fe2` | - |
| B-03 上传暂存与任务认领 | `complete` | B-01 | `769d178` | - |
| B-04a 暂存素材 requirement 更新接口 | `frozen_for_review` | B-03 | - | 修复后新 Candidate 已冻结；等待双复审 |
| B-04b 上传 UI、缩略图、required 控件与 loading | `queued` | B-04a | - | TDD、双 Review、中文提交 |
| B-05 素材面板正式协议 | `queued` | B-02、B-03 | - | B-04b 后串行实现 |
| B-06 页面截图与衍生素材 producer | `queued` | B-01、B-02 | - | B-05 后串行实现 |
| B-07 requirement 语义与 Phase B 门禁 | `queued` | B-04b、B-05、B-06 | - | Phase B 全量验证 |
| C-01～C-05 Image Sequence、Caption 绑定、Scene 连续时间线、Usage Report | `queued` | B-07 | - | Phase C 计划与逐任务门 |
| D-01～D-08 Focus/Camera、统一时钟、截图 A/B 与自然图 C 级聚焦 | `queued` | C-05 | - | Phase D 计划与真实样本门 |
| E-01～E-05 Camera QA、issue code、定向 retry、checkpoint/resume | `queued` | D-08 | - | `skipValidation=false` 真实验收 |
| F-01 最终真实任务 E2E 与全量回归 | `queued` | E-05 | - | 最终双 Review |

## 当前写租约

```yaml
task_id: B-04a
status: frozen_for_review
owner: /root/context_control_audit
base_commit: a8b8220ae6de3b8423d9c185f68e8ff411afc8c3
worktree: D:\code3\MuseDock-worktrees\asset-first-b04a
branch: codex/asset-first-b04a
allowed_paths:
  - server/services/creative/visualAssetUploads.js
  - server/routes/creativeWorkflows.js
  - tests/test-creative-workflow-upload-assets.js
  - tests/test-creative-workflow-routes.js
forbidden_paths:
  - docs/superpowers/plans/2026-07-16-asset-first-delivery-ledger.md
state_owners:
  - staged_visual_asset.requirement
exclusive_resources:
  - B-04a upload service and route tests run serially inside the worker worktree
invalidated_revision: git-index-tree-v1:a8b8220ae6de3b8423d9c185f68e8ff411afc8c3:dd1744aa64223f810ab254eadd09fe2dba4c6165
frozen_revision: git-index-tree-v1:a8b8220ae6de3b8423d9c185f68e8ff411afc8c3:12383438760a1e56c2329d77e129ca9a02f5e0dc
revision_valid: true
changed_paths:
  - server/services/creative/visualAssetUploads.js
  - server/routes/creativeWorkflows.js
  - tests/test-creative-workflow-upload-assets.js
  - tests/test-creative-workflow-routes.js
verification:
  - node tests/test-creative-workflow-upload-assets.js
  - NODE_PATH=D:\code3\MuseDock\node_modules node tests/test-creative-workflow-routes.js
review:
  spec: pending_re_review
  quality: pending_re_review
resolved_findings:
  - PATCH 缺少、null 或空 requirement 返回中文 400 且 manifest 不变
  - route 测试恢复严格 JSON 解析
  - route 测试覆盖持久化失败的中文 500 与请重试提示
```

Worker 禁止修改本 Ledger。发现需要修改租约外路径时返回 `scope_expansion_required`。进入 `frozen_for_review` 前由 Coordinator 校验并写入 `git-index-tree-v1` revision，形成独立 Ledger 控制提交；Reviewer 只接受该 Ledger commit。

## Phase A 审计分工

| Agent | 上下文 | 写权限 | 输出 |
|---|---|---|---|
| `audit_assets_v2` | 只含统一素材审计包 | 无 | 不超过 180 行 Handoff |
| `audit_sequence_v2` | 只含多图 Scene 审计包 | 无 | 不超过 180 行 Handoff |
| `audit_focus_qa_v2` | 只含焦点、摄影机和 QA 审计包 | 无 | 不超过 180 行 Handoff |

所有审计 Agent 使用独立新上下文，不继承主线程完整历史。Coordinator 汇总后生成按依赖拆分的实施计划并立即开始执行，不把计划完成作为停止点。

## Phase A 审计结论

### 统一素材

- 当前已有文章/GitHub README 图片、Pexels、AI 生图、工程物化、HTML 引用检查、usage report 和素材面板单链。
- 缺少上传暂存与任务认领、页面截图、衍生素材、正式统一资产协议和用户 requirement。
- `creativeSourcePrep.prepareSourceAssetContext()` 会覆盖既有 `asset_context`，因此必须先实现幂等合并再接上传。
- 当前 `requiredAssetRefsById()` 把全部生成图和 content graph 引用当作 required，与新规格冲突。
- 当前 usage report 只证明路径出现在 HTML，不能证明 Shot 具有正数可见时长。

### 多图 Scene

- `scene_html` 单 Scene 单 HTML/MP4 底座已存在，但生产默认仍是 `beat_mp4`。
- content graph Prompt 和归一化都把图片硬截断到一张。
- visual plan 在 content graph 之前生成，看不到来源图最终选择。
- 尚无 `image_sequence`、四种 `sequence_mode`、Shot、Caption IDs 或 visible duration。
- Caption 时间、Scene HTML 时钟、Playwright 和 ffmpeg 串联底座可复用，不需重写渲染引擎。

### 焦点、摄影机与 QA

- 当前 `focus_regions/focus_cues/camera plan` 基本未实现；storyboard `zoom_focus` 没有进入当前 asset-first 链。
- HTML/CSS/GSAP/Chromium 已能承载动画，缺少可信度、数学、统一时钟和 QA。
- 字幕时钟在页面加载时启动，beat 时钟在正式录制点启动；接 camera 前必须统一时间原点。
- 现有 checkpoint 输入指纹包含完整 `visual_beat`，最终 Camera Plan 放入其中即可复用失效机制。
- 布局 QA、retry 和 resume 底座可复用；新增 camera issue code 和定向映射即可。

### 已通过的基线测试

- `node tests/test-creative-workflows.js`
- `node tests/test-html-video-asset-usage.js`
- `node tests/test-generated-image-phase.js`
- `node tests/test-generated-image-persist.js`
- `node tests/test-creative-task-detail-assets.mjs`
- `node tests/test-source-image-analysis.js`
- 三个审计 Agent 额外运行的 source、content graph、visual plan、scene continuity、layout QA、validation gate、retry 和 checkpoint 测试均通过。

## Requirement 唯一状态表

Requirement 行与 Task 行是 Ledger 内唯一可写状态。实施计划只描述步骤，Phase 视图只描述依赖。

### B. 统一视觉素材

| ID | 状态 | 要求 | 覆盖 Task |
|---|---|---|---|
| REQ-B-01 | `pending` | 创作输入区暂存上传、缩略图和 preferred/required 控件 | B-04a、B-04b |
| REQ-B-02 | `verified` | 创建任务时认领上传素材 | B-03 |
| REQ-B-03 | `verified` | 任务创建后立即可查看已认领素材 | B-03 |
| REQ-B-04 | `pending` | 文章图、GitHub/README 图、允许的页面截图、AI 生图、Pexels/search 和衍生图统一进入 `asset_context.assets` | B-02、B-06 |
| REQ-B-05 | `pending` | 运行中持续追加素材与中文诊断 | B-02、B-06 |
| REQ-B-06 | `verified` | `origin/origin_detail/requirement/evidence_class` 分维协议 | B-01 |
| REQ-B-07 | `verified` | direct source、synthetic、stock/search 的证据边界 | B-01、B-02 |
| REQ-B-08 | `pending` | 任何可引用图片必须先登记 | B-06、B-07 |
| REQ-B-09 | `pending` | required 素材无真实可见 Shot 时阻断 | B-07、C-04 |
| REQ-B-10 | `pending` | Asset Usage Report 与素材面板一致 | B-05、C-04 |

### C. 多图编排

| ID | 状态 | 要求 | 覆盖 Task |
|---|---|---|---|
| REQ-C-01 | `pending` | 一个 Scene 使用 `1～4` 个 Shot | C-01 |
| REQ-C-02 | `pending` | 单图统一为一个 Shot 的 Image Sequence | C-01 |
| REQ-C-03 | `pending` | 四种主要 Sequence Mode | C-01、C-03 |
| REQ-C-04 | `pending` | Shot Role、Caption IDs、最短可见时间 | C-01、C-02 |
| REQ-C-05 | `pending` | Caption 时间派生入场、保持、退出和重叠 | C-02、C-03 |
| REQ-C-06 | `pending` | 同 Scene 使用连续 HTML 时间线 | C-03 |
| REQ-C-07 | `pending` | Scene 内不经过独立 Beat MP4 裸切 | C-03 |
| REQ-C-08 | `pending` | 跨 Scene 转场保持独立 | C-03 |
| REQ-C-09 | `pending` | 多图不是强制数量指标 | C-02 |
| REQ-C-10 | `pending` | AI 生图补视觉角色，Pexels/search 不为凑数 | C-02 |

### D. 焦点与摄影机

| ID | 状态 | 要求 | 覆盖 Task |
|---|---|---|---|
| REQ-D-01 | `pending` | 图片级 `focus_regions` | D-01、D-03 |
| REQ-D-02 | `pending` | Scene/Shot 级 `focus_cues` | D-04 |
| REQ-D-03 | `pending` | DOM/manual、OCR/验证、AI-only、歧义失败的信任等级 | D-01、D-03 |
| REQ-D-04 | `pending` | 语义准确与几何准确分开 | D-01、D-03 |
| REQ-D-05 | `pending` | A/B 自动聚焦，C 低倍率宽松聚焦，D 不聚焦 | D-07、D-08 |
| REQ-D-06 | `pending` | cover/contain 和双层截图坐标映射 | D-02 |
| REQ-D-07 | `pending` | 安全目标中心、zoom 限幅、位移 clamp 和黑边防护 | D-02 |
| REQ-D-08 | `pending` | Caption Cue 同时驱动摄影机和字幕关键词高亮 | D-05 |
| REQ-D-09 | `pending` | 同一 Region 连续 Cue 合并并避免抖动 | D-04 |
| REQ-D-10 | `pending` | 每张最终使用图片最多分析一次 | D-03、D-06 |

### E. QA、修复与恢复

| ID | 状态 | 要求 | 覆盖 Task |
|---|---|---|---|
| REQ-E-01 | `pending` | 数据契约、引用完整性和 required 门 | E-01 |
| REQ-E-02 | `pending` | 摄影机数学测试 | D-02、E-01 |
| REQ-E-03 | `pending` | Scene 预览渲染测试 | E-02 |
| REQ-E-04 | `pending` | 白屏、黑边、裸硬切、字幕遮挡和过度放大检查 | E-02 |
| REQ-E-05 | `pending` | 错误焦点与焦点可信度验收 | E-02 |
| REQ-E-06 | `pending` | 自动修复后 blocking 问题真正阻断 | E-02、E-03 |
| REQ-E-07 | `pending` | 定向重试只失效受影响范围 | E-03 |
| REQ-E-08 | `pending` | Checkpoint 复用包含真实输入、Prompt 和契约版本 | D-06、E-04 |
| REQ-E-09 | `pending` | 重启后只恢复失败 Scene/Shot | E-04 |
| REQ-E-10 | `pending` | `skipValidation=false` 进入完整视觉 QA | E-05 |

### F. 最终验收

| ID | 状态 | 要求 | 覆盖 Task |
|---|---|---|---|
| REQ-F-01 | `pending` | 覆盖截图、UI、终端、图表、照片、AI 图、相似目标和负样本 | F-01 |
| REQ-F-02 | `pending` | 运行真实端到端任务 | F-01 |
| REQ-F-03 | `pending` | 核对 `project.json`、`asset_usage_report`、Scene 产物和 `visual-report.json` | F-01 |
| REQ-F-04 | `pending` | 相关单测、前端构建和后端验证通过 | F-01 |
| REQ-F-05 | `pending` | 规格 Review 无未解决问题 | F-01 |
| REQ-F-06 | `pending` | 代码质量 Review 无未解决问题 | F-01 |
| REQ-F-07 | `pending` | 最终工作区只保留 Goal 开始前已有的用户改动 | F-01 |

## 证据记录

| 内容 | 证据 |
|---|---|
| overlay P0 完成基线 | `3a23622` 及其前置 P0 提交 |
| Delivery Loop 设计纠正 | `7512979` |
| Phase A 审计与 Phase B 计划 | `b48fcf6` |
| Phase B Task 1 统一资产契约 | `9abb219`；`tests/test-visual-asset-contract.js` 与 `tests/test-creative-context.js` 通过；规格 Review PASS；代码质量 Review PASS |
| Phase B Task 2 现有 producer 统一接入 | `b3b4fe2`；source/generated/workflow/usage/project-store 共七组测试通过；规格 Review PASS；代码质量 Review PASS |
| Phase B Task 3 上传暂存与任务认领 | `769d178`；真实 PNG/JPEG/WebP、HTTP 413、Douyin 路径、原子回滚、TTL/配额测试通过；规格 Review PASS；代码质量 Review PASS |

后续业务代码提交不修改本 Ledger；Coordinator 在取得最终代码 SHA 后独立追加：Requirement、代码提交、验证命令、冻结 revision 对应的双 Review 结论和剩余风险。完整日志、diff、搜索输出和 Agent 对话不进入 Ledger。
