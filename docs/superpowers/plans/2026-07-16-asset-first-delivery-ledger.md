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

## 重启续接状态

- 用户于 2026-07-17 重启后恢复执行；B-07a 已完成串行集成
- 全局并发配置：`C:\Users\MOVER\.codex\config.toml` 当前为 `agents.max_threads = 20`，新任务/重启后读取
- 实际并发：第 4 个 sub-agent 创建返回 `agent thread limit reached`；当前产品层仍为主 Agent + 3 个 sub-agent
- 当前主工作区：`dev`；B-07b 最终 reviewed tree 已由提交 `218fbf9` squash 集成
- 当前顺序：Phase B 集成门已通过 → 执行 Phase C C-01～C-05
- Phase C：C-01～C-04 已完成；下一步 C-05 物化真实可见时长与统一 Usage Report；REQ-B-09/10 由 C-05 收口

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
| B-04a 暂存素材 requirement 更新接口 | `complete` | B-03 | `c63ac1b` | - |
| B-04b 上传 UI、缩略图、required 控件与 loading | `complete` | B-04a | `f9ae697` | - |
| B-05 素材面板正式协议 | `complete` | B-02、B-03 | `9a7c0e2` | - |
| B-06a GitHub 页面截图 producer | `complete` | B-01、B-02 | `32a51c5` | 双 Review PASS；真实 Chromium smoke 已在 B-07b 通过 |
| B-06b 受控 derived 素材登记 | `complete` | B-01 | `ca45e1d` | 双 Review PASS，已在 dev 重跑目标测试并释放租约 |
| B-07a requirement 分类语义 | `complete` | B-01 | `fda1c71` | 最终双 Review PASS；dev 10 项串行验证通过并释放租约 |
| B-07b Phase B 集成门禁验证 | `complete` | B-06a、B-06b、B-07a | `218fbf9` | 冻结 tree 三路 Review PASS；dev 38 组测试、前端构建与真实 GitHub Chromium smoke 通过 |
| C-01～C-05 Image Sequence、Caption 绑定、Scene 连续时间线、Usage Report | `in_progress` | B-07b | `df9a519`、`fab5167`、`6d58460`、`c5e08f0` | C-01～C-04 完成；下一步 C-05 Usage Report 与 required gate |
| D-01～D-08 Focus/Camera、统一时钟、截图 A/B 与自然图 C 级聚焦 | `queued` | C-05 | - | Phase D 计划与真实样本门 |
| E-01～E-05 Camera QA、issue code、定向 retry、checkpoint/resume | `queued` | D-08 | - | `skipValidation=false` 真实验收 |
| F-01 最终真实任务 E2E 与全量回归 | `queued` | E-05 | - | 最终双 Review |

## 当前写租约

```yaml
task_id: C-05
status: frozen_for_review
owner: unassigned
lease_released: true
code_base_commit: 7e59bce935c442ed9e61640101d83de044dc24c3
worktree: D:\code3\MuseDock-worktrees\asset-first-c05
branch: codex/asset-first-c05
candidate_commit: a2a2335fad1d0738015ac1467d64c9ac6d6646e8
invalidated_revision: ecd9f1ea9b87a3a6763eb1639653d788e701ddee
invalidated_tree: 1b24b65760c40e967eb2c8101155cbb2b1fc7cfc
frozen_revision: a2a2335fad1d0738015ac1467d64c9ac6d6646e8
frozen_tree: 711dbcc8142ea4ca437ac8141755854a480a729d
revision_valid: true
allowed_paths:
  - server/services/creative-video/html-video/assetUsagePhase.js
  - frontend-react/src/components/creative/SourceImageAssetsPanel.jsx
  - tests/test-html-video-asset-usage.js
  - tests/test-html-video-workflow.js
  - tests/test-creative-workflows.js
  - tests/test-creative-task-detail-assets.mjs
  - tests/test-html-video-runtime-asset-policy-chromium.js
forbidden_paths:
  - docs/superpowers/plans/2026-07-16-asset-first-delivery-ledger.md
  - server/services/creative-video/html-video/sceneImageSequenceDom.js
  - server/services/creative-video/html-video/htmlVideoWorkflow.js
  - server/services/creative-video/html-video/projectOrchestrator.js
  - server/services/creative-video/retryPlanner.js
  - server/services/creative-video/resumeExecutor.js
state_owners:
  - asset_usage_report.assets[].shot_usages
  - asset_usage_report.assets[].used
  - asset_usage_report.assets[].used_in_frames
  - asset_usage_report.assets[].usage_count
  - asset_usage_report.used_asset_ids
  - asset_usage_report.unused_asset_ids
  - asset_usage_report.missing_required_asset_ids
exclusive_resources:
  - C-05 Node tests run serially inside the worker worktree
  - C-05 real Chromium runs only after Node GREEN
  - frontend build runs serially
verification:
  - required path-only HTML reference 与 canonical Shot usage RED→GREEN
  - 10 组 backend/UI/workflow/QA/retry/persistence 回归通过，8.6 秒
  - 真实 Chromium 产品回归通过，79.5 秒
  - Vite 前端构建通过，仅有既有大 chunk warning
  - git diff --check 通过
review:
  spec: pending
  quality: pending
resolved_findings:
  - 显式 graph_node_id 不存在或不唯一时 fail-closed，仅缺失时允许 legacy identity
  - canonical visible_duration_sec 在后端按毫秒精度规范化
```

```yaml
task_id: C-04
status: complete
owner: unassigned
lease_released: true
code_base_commit: d4af5909b163827da6490df59c11503f86f47f73
worktree: D:\code3\MuseDock-worktrees\asset-first-c04
branch: codex/asset-first-c04
candidate_commit: 09f19e090d93f1bb1eee844e678a0c04e3b8cf4c
invalidated_revision: 042788abba88b0143d42db13f54a8b1734e88360
invalidated_tree: a89d02f6bd357cf79614efb76624e65c4bfbb6b4
frozen_revision: 09f19e090d93f1bb1eee844e678a0c04e3b8cf4c
frozen_tree: 7b7065881fa507f5ee94b8ee57db14c93e93b8ed
revision_valid: true
dev_commit: c5e08f00f855d11e13ed23be0fe2d27d171c5049
allowed_paths:
  - server/services/creative/creativeContext.js
  - server/services/creative-video/html-video/playbackClock.js
  - server/services/creative-video/html-video/sceneImageSequenceDom.js
  - server/services/creative-video/html-video/captionLayer.js
  - server/services/creative-video/html-video/framePromptBuilder.js
  - server/services/creative-video/html-video/frameHtmlAgent.js
  - server/services/creative-video/html-video/frameHtmlPhase.js
  - server/services/creative-video/html-video/frameHtmlPhaseSupport.js
  - server/services/creative-video/html-video/hyperframesPlaywrightAdapter.js
  - server/services/creative-video/html-video/prepareSourceHtml.js
  - server/services/creative-video/retryPlanner.js
  - tests/test-creative-context.js
  - tests/test-creative-workflow-retry-e2e.js
  - tests/test-creative-workflows.js
  - tests/test-html-video-playback-clock.js
  - tests/test-html-video-scene-image-sequence-dom.js
  - tests/test-html-video-caption-layer.js
  - tests/test-html-video-asset-first-prompts.js
  - tests/test-html-video-frame-html-agent.js
  - tests/test-html-video-scene-continuity.js
  - tests/test-html-video-frame-html-resume.js
  - tests/test-html-video-per-scene-routing.js
  - tests/test-html-video-playwright-adapter-command.js
  - tests/test-html-video-prepare-source-html.js
  - tests/test-creative-workflow-retry-planner.js
  - tests/test-html-video-workflow.js
  - tests/test-html-video-runtime-asset-policy-chromium.js
forbidden_paths:
  - docs/superpowers/plans/2026-07-16-asset-first-delivery-ledger.md
  - server/services/creative-video/html-video/visualPlanService.js
  - server/services/creative-video/html-video/assetUsagePhase.js
  - server/services/creative-video/html-video/projectSchema.js
  - server/services/creative-video/html-video/mixedFrameBuilder.js
  - server/services/creative-video/html-video/ffmpegComposer.js
state_owners:
  - creative_context.continuity_mode
  - frame_html.scene_image_sequence_dom
  - frame_html.scene_local_playback_clock
exclusive_resources:
  - C-04 Node tests run serially inside the worker worktree
  - C-04 real Chromium QA runs only after Node GREEN
  - no frontend build, network or real ffmpeg in the writer worktree
verification:
  - 15 组 C-04 Node 检查通过，18.7 秒
  - 真实 Chromium 产品回归通过，79.1 秒
  - dev 15 组 Node 集成验证通过，20.0 秒
  - dev 真实 Chromium 集成验证通过，78.1 秒
  - git diff --check 通过
review:
  spec: pass
  spec_reviewed_ledger_commit: 0c15404b0874358e32e1d1393c6ec3c7ef0fb4b6
  spec_reviewed_revision: 09f19e090d93f1bb1eee844e678a0c04e3b8cf4c
  quality: pass
  quality_reviewed_ledger_commit: 0c15404b0874358e32e1d1393c6ec3c7ef0fb4b6
  quality_reviewed_revision: 09f19e090d93f1bb1eee844e678a0c04e3b8cf4c
resolved_findings:
  - Shot 结束边界保留 0.35 秒可见退出过渡，完成后再隐藏并禁用交互
  - Frame checkpoint 指纹覆盖受管 Shot 实际引用素材的状态、类型、path 与 frame_src
```

```yaml
task_id: C-03
status: complete
owner: unassigned
lease_released: true
dev_commit: 6d58460f03aef36fe1afd1ab0fef380763dc8f8a
code_base_commit: 87ac80f5ef639587001311c8b0f3e137fae7d849
worktree: D:\code3\MuseDock-worktrees\asset-first-c03
branch: codex/asset-first-c03
allowed_paths:
  - server/services/creative-video/html-video/visualPlanService.js
  - server/services/creative-video/html-video/htmlVideoWorkflow.js
  - tests/test-html-video-visual-plan.js
  - tests/test-html-video-workflow.js
  - tests/test-html-video-frame-html-resume.js
  - tests/test-html-video-asset-first-prompts.js
forbidden_paths:
  - docs/superpowers/plans/2026-07-16-asset-first-delivery-ledger.md
  - server/services/creative-video/html-video/captionLayer.js
  - server/services/creative-video/html-video/framePromptBuilder.js
  - server/services/creative-video/html-video/frameHtmlPhaseSupport.js
  - server/services/creative-video/html-video/contentGraphPhase.js
  - server/services/creative-video/html-video/hyperframesPlaywrightAdapter.js
state_owners:
  - visual_plan.beats[].visual_base.shots[].caption_ids
  - visual_plan.beats[].visual_base.shots[].active_window
  - visual_plan.beats[].visual_base.shots[].minimum_visible_duration_sec
exclusive_resources:
  - C-03 Node tests run serially inside the worker worktree
  - no browser, ports, ffmpeg, network or frontend build
verification:
  - node tests/test-html-video-visual-plan.js
  - node tests/test-html-video-frame-html-resume.js
  - node tests/test-html-video-workflow.js
  - node tests/test-html-video-asset-first-prompts.js
  - node tests/test-html-video-caption-layer.js
  - node tests/test-html-video-scene-continuity.js
review:
  spec: pass
  spec_reviewed_revision: e17a51e03c5b71e81c9a9c9486bd7ff5f7336f52
  quality: pass
  quality_reviewed_revision: e17a51e03c5b71e81c9a9c9486bd7ff5f7336f52
frozen_revision: e17a51e03c5b71e81c9a9c9486bd7ff5f7336f52
frozen_tree: 7577efca3f3481e7d1e989e275168332083c40b3
revision_valid: true
resolved_findings:
  - canonical Caption Track 在 normalize 后校验 ID、时间、排序和 Scene 边界
  - Shot 容量、最终窗口 minimum 与 mode/cardinality 均在规划完成后收口
  - semantic_compare 使用并行窗口，overview/detail 与 relay/montage 使用各自预算
  - 全局字幕开关显式进入 Visual Plan，canonical 错误只保留单一根因
  - 0 Shot 收口为 diagram，1 Shot 收口为 fullscreen_relay，不写 visible_duration_sec
```

```yaml
task_id: C-02
status: complete
owner: unassigned
lease_released: true
dev_commit: fab5167e452afa0c024dbcb4301c259c2f0bd14f
code_base_commit: a0666dd12995f0ec4db94273f29646fd436cc46b
worktree: D:\code3\MuseDock-worktrees\asset-first-c02
branch: codex/asset-first-c02
allowed_paths:
  - server/services/creative-video/html-video/visualPlanService.js
  - server/services/creative-video/html-video/htmlVideoWorkflow.js
  - server/services/creative-video/html-video/contentGraphPhase.js
  - server/services/creative-video/html-video/framePromptBuilder.js
  - tests/test-html-video-visual-plan.js
  - tests/test-html-video-workflow.js
  - tests/test-html-video-per-scene-routing.js
  - tests/test-html-video-scene-continuity.js
  - tests/test-html-video-frame-html-resume.js
  - tests/test-html-video-asset-first-prompts.js
  - tests/test-html-video-frame-html-agent.js
  - tests/test-html-video-project-schema.js
  - tests/test-html-video-project-store.js
forbidden_paths:
  - docs/superpowers/plans/2026-07-16-asset-first-delivery-ledger.md
  - server/services/creative-video/html-video/contentGraphAgent.js
  - server/services/creative-video/html-video/frameHtmlPhaseSupport.js
  - server/services/creative-video/html-video/motionPrimitiveCatalog.js
state_owners:
  - visual_plan.beats[].visual_base.image_sequence
  - visual_plan.input_fingerprint
exclusive_resources:
  - C-02 Node tests run serially inside the worker worktree
  - no browser, ports, ffmpeg, network or frontend build
verification:
  - node tests/test-html-video-visual-plan.js
  - node tests/test-html-video-per-scene-routing.js
  - node tests/test-html-video-scene-continuity.js
  - node tests/test-html-video-frame-html-resume.js
  - node tests/test-html-video-asset-first-prompts.js
  - node tests/test-html-video-frame-html-agent.js
  - node tests/test-html-video-workflow.js
review:
  spec: pass
  spec_reviewed_revision: 8003202db1bf39435f62f13cc3add05c8d16ad3a
  quality: pass
  quality_reviewed_revision: 8003202db1bf39435f62f13cc3add05c8d16ad3a
frozen_revision: 8003202db1bf39435f62f13cc3add05c8d16ad3a
frozen_tree: 44005cd6851142502756057fb6087efded35867e
revision_valid: true
resolved_findings:
  - canonical Content Graph 先于 Visual Plan，routing refs 不得覆盖 graph 候选
  - 0 图保持 diagram，单图与多图统一为 1～4 Shot 的 image_sequence
  - comparison required 冲突、montage 否定与 registry 排序均使用确定性规则
  - project.assets 为 resume 正式权威，Shot 路径变化进入 Plan 与 Frame 指纹
  - full、short、retry Frame Prompt 均消费正式 registry 核对后的 Shot 顺序与 src
```

```yaml
task_id: C-01
status: complete
owner: unassigned
lease_released: true
dev_commit: df9a51941ce2c17d2c9ca87aa7dd0a4c526eba58
base_commit: 857b5515e60c5473233116329dfe79c6c23be62e
worktree_start_commit: 1fa862d8e78141ffd33951c2b83675a97c59d76b
worktree: D:\code3\MuseDock-worktrees\asset-first-c01
branch: codex/asset-first-c01
allowed_paths:
  - server/services/creative-video/html-video/contentGraphAgent.js
  - tests/test-html-video-content-graph-agent.js
  - tests/test-source-grounding-prompts.js
forbidden_paths:
  - docs/superpowers/plans/2026-07-16-asset-first-delivery-ledger.md
state_owners:
  - content_graph.nodes[].asset_refs
exclusive_resources:
  - C-01 content graph tests run serially inside the worker worktree
  - no browser, ports, ffmpeg, network or frontend build
verification:
  - node tests/test-html-video-content-graph-agent.js
  - node tests/test-source-grounding-prompts.js
  - node tests/test-html-video-workflow.js
  - node tests/run-all.js html-video-content-graph-agent source-grounding-prompts
review:
  spec: pass
  spec_reviewed_revision: c0625e81361fba2919d8f9b836c912c841fc95bb
  quality: pass
  quality_reviewed_revision: c0625e81361fba2919d8f9b836c912c841fc95bb
frozen_revision: c0625e81361fba2919d8f9b836c912c841fc95bb
frozen_tree: b3b3999efbc04198ca2358130186131a8aaa0220
revision_valid: true
resolved_findings:
  - 空素材注册表 fail-closed，不接受任何未登记 asset_id
  - formal/legacy generated 素材存在 generation.scene_id 时只允许绑定对应 node
  - usage 只接受 subject、showcase、evidence、background，允许同类候选重复但 reason 必须区分语义
  - 默认 source-grounding 测试同步多素材候选契约
```

```yaml
task_id: B-06a
status: complete
owner: unassigned
lease_released: true
dev_commit: 32a51c5
base_commit: 7a377550669a91fc9616dd4befda56cf7ad1a985
worktree: D:\code3\MuseDock-worktrees\asset-first-b06a
branch: codex/asset-first-b06a
allowed_paths:
  - server/services/creative/pageCaptureAssets.js
  - server/services/creative/creativeSourcePrep.js
  - tests/test-page-capture-assets.js
forbidden_paths:
  - docs/superpowers/plans/2026-07-16-asset-first-delivery-ledger.md
  - server/services/creative/derivedVisualAssets.js
state_owners:
  - asset_context.assets.page_capture
exclusive_resources:
  - B-06a fake Playwright tests run serially inside the worker worktree
  - no real Chromium, ports, ffmpeg or frontend build
previous_invalidated_revision: git-index-tree-v1:7a377550669a91fc9616dd4befda56cf7ad1a985:f76f3afdf92619def2791ae2515c89ab81d006ff
invalidated_revision: git-index-tree-v1:7a377550669a91fc9616dd4befda56cf7ad1a985:faad0ec07e46ef2ffa9d8978633492f7a418d1ba
previous_frozen_revision: git-index-tree-v1:7a377550669a91fc9616dd4befda56cf7ad1a985:bfb0c1354d2cb79e80d9e8fc94c1f7e607fec9f5
frozen_revision: git-index-tree-v1:7a377550669a91fc9616dd4befda56cf7ad1a985:8cfbf2540fca08f978c13e8e51ae4ebb2285841d
revision_valid: true
changed_paths:
  - server/services/creative/pageCaptureAssets.js
  - server/services/creative/creativeSourcePrep.js
  - tests/test-page-capture-assets.js
verification:
  - node tests/test-page-capture-assets.js
  - node tests/test-creative-workflows.js
review:
  spec: pass
  spec_reviewed_ledger_commit: d45ccb1
  spec_reviewed_revision: git-index-tree-v1:7a377550669a91fc9616dd4befda56cf7ad1a985:8cfbf2540fca08f978c13e8e51ae4ebb2285841d
  quality: pass
  quality_reviewer: /root
  quality_reviewed_ledger_commit: d45ccb1
  quality_reviewed_revision: git-index-tree-v1:7a377550669a91fc9616dd4befda56cf7ad1a985:8cfbf2540fca08f978c13e8e51ae4ebb2285841d
resolved_findings:
  - source prep 捕获同步 throw、rejected Promise 与缺方法
  - 首跳 allowlist 限制默认 HTTPS 端口、credentials、lookalike，并证明 route 先于 goto
  - 截图前有界等待 load，超时仍 finally 清理
  - 默认 writer 覆盖 rename 临时文件清理与 symlink/junction 越界；Buffer 不重复复制
  - document 与允许静态资源使用 route.fetch({ maxRedirects: 0 })；所有首跳 3xx 在下一跳前 abort
  - fake 按 Playwright 1.60 单次 route 回调建模，并证明 redirect 下一跳未请求
  - 删除 route.fetch，使用 Node https 流式限制单响应 2 MiB 与单 capture 8 MiB
  - 拒绝远端 image/font、压缩编码与非法 Content-Length，阻断 service worker 并清理超时/超限请求
```

```yaml
task_id: B-06b
status: complete
owner: unassigned
lease_released: true
dev_commit: ca45e1d
base_commit: 037f6cda728f6448d6d5211b30ceb47d98cee30b
worktree: D:\code3\MuseDock-worktrees\asset-first-b06b
branch: codex/asset-first-b06b
allowed_paths:
  - server/services/creative/derivedVisualAssets.js
  - tests/test-derived-visual-assets.js
state_owners:
  - asset_context.assets.derived_registration
exclusive_resources:
  - B-06b filesystem tests use independent temp directories
previous_invalidated_revision: git-index-tree-v1:037f6cda728f6448d6d5211b30ceb47d98cee30b:79231ef01d2203892330dffff4c46dd0bc2e3217
invalidated_revision: git-index-tree-v1:037f6cda728f6448d6d5211b30ceb47d98cee30b:404ad1819de7fb935655272b179e50788dfa8abf
frozen_revision: git-index-tree-v1:037f6cda728f6448d6d5211b30ceb47d98cee30b:0675e733e7b9105927ec0ac4fad0f6aa3824c122
revision_valid: true
changed_paths:
  - server/services/creative/derivedVisualAssets.js
  - tests/test-derived-visual-assets.js
verification:
  - node tests/test-derived-visual-assets.js
  - node tests/test-visual-asset-contract.js
review:
  spec: pass
  spec_reviewed_ledger_commit: 2a171da
  spec_reviewed_revision: git-index-tree-v1:037f6cda728f6448d6d5211b30ceb47d98cee30b:0675e733e7b9105927ec0ac4fad0f6aa3824c122
  quality: pass
  quality_reviewer: /root
  quality_reviewed_ledger_commit: 2a171da
  quality_reviewed_revision: git-index-tree-v1:037f6cda728f6448d6d5211b30ceb47d98cee30b:0675e733e7b9105927ec0ac4fad0f6aa3824c122
resolved_findings:
  - 子素材必须验证与扩展名一致的真实 PNG、JPEG 或 WebP 文件签名
  - 同 ID、同 parent 只有 child path、origin_detail 与 derivation 全部一致时才幂等，否则必须冲突
  - derivation 必须深拷贝，嵌套输入与返回资产不得共享引用
  - 测试必须锁住 assets root、parent 与 child 的静态 junction/symlink 逃逸防护；平台不支持时明确 skip
  - 幂等比较对正式 path、bytes 原始类型和值严格一致
  - JSON-like 递归验证只接受 plain data 并保留 -0，测试临时根与链接在 finally 中安全清理
```

```yaml
task_id: B-07a
status: complete
owner: unassigned
lease_released: true
dev_commit: fda1c71
base_commit: 037f6cda728f6448d6d5211b30ceb47d98cee30b
worktree: D:\code3\MuseDock-worktrees\asset-first-b07a
branch: codex/asset-first-b07a
allowed_paths:
  - server/services/creative/visualAssetContract.js
  - server/services/creative/generatedImagePlanner.js
  - server/services/creative-video/html-video/assetUsagePhase.js
  - server/services/creative-video/html-video/contentGraphAgent.js
  - server/services/creative-video/html-video/frameHtmlInspection.js
  - server/services/creative-video/html-video/framePromptBuilder.js
  - server/services/creative-video/html-video/generatedImagePhase.js
  - server/services/creative-video/html-video/htmlVideoWorkflow.js
  - tests/test-visual-asset-contract.js
  - tests/test-generated-image-planner.js
  - tests/test-generated-image-phase.js
  - tests/test-generated-image-persist.js
  - tests/test-html-video-asset-usage.js
  - tests/test-html-video-content-graph-agent.js
  - tests/test-html-video-frame-html-agent.js
  - tests/test-html-video-workflow.js
  - tests/test-html-video-project-store.js
state_owners:
  - asset_usage.required_classification
exclusive_resources:
  - B-07a usage/workflow tests run serially inside the worker worktree
  - no browser, ports, ffmpeg or network
previous_invalidated_revision: git-index-tree-v1:037f6cda728f6448d6d5211b30ceb47d98cee30b:4d7d001234085aab9fd92b2612cdff0248083943
invalidated_revision: git-index-tree-v1:037f6cda728f6448d6d5211b30ceb47d98cee30b:d2a84d2926eb1a9250a8de6d22301d957acb4a26
invalidated_review_revision: git-index-tree-v1:037f6cda728f6448d6d5211b30ceb47d98cee30b:4817900a2d68a60083eb02eed9d8f7f9cad8068a
previous_invalidated_review_revision: git-index-tree-v1:037f6cda728f6448d6d5211b30ceb47d98cee30b:0e3a886ef9d38910dfe4de4924748d3f1b8dda91
frozen_revision: git-index-tree-v1:037f6cda728f6448d6d5211b30ceb47d98cee30b:654d1063be9431cf55c8eacce9c0a1b9e3ad07e1
revision_valid: true
changed_paths:
  - server/services/creative/visualAssetContract.js
  - server/services/creative/generatedImagePlanner.js
  - server/services/creative-video/html-video/assetUsagePhase.js
  - server/services/creative-video/html-video/contentGraphAgent.js
  - server/services/creative-video/html-video/frameHtmlInspection.js
  - server/services/creative-video/html-video/framePromptBuilder.js
  - server/services/creative-video/html-video/generatedImagePhase.js
  - server/services/creative-video/html-video/htmlVideoWorkflow.js
  - tests/test-visual-asset-contract.js
  - tests/test-generated-image-planner.js
  - tests/test-generated-image-phase.js
  - tests/test-generated-image-persist.js
  - tests/test-html-video-asset-usage.js
  - tests/test-html-video-content-graph-agent.js
  - tests/test-html-video-frame-html-agent.js
  - tests/test-html-video-workflow.js
workspace_state:
  staged_tree: 654d1063be9431cf55c8eacce9c0a1b9e3ad07e1
  unstaged_paths: 0
  untracked_paths: 0
  diff_check: pass
  final_tests: ten_target_suites_pass
verification:
  - node tests/test-visual-asset-contract.js
  - node tests/test-generated-image-planner.js
  - node tests/test-generated-image-phase.js
  - node tests/test-html-video-content-graph-agent.js
  - node tests/test-html-video-frame-html-agent.js
  - node tests/test-html-video-asset-usage.js
  - node tests/test-html-video-workflow.js
  - node tests/test-html-video-project-store.js
  - node tests/test-generated-image-persist.js
  - node tests/test-creative-workflow-retry-planner.js
review:
  spec: pass
  quality: pass
integration:
  branch: dev
  commit: fda1c71
  verification: ten_target_suites_pass
resolved_findings:
  - evidence/source/citation/proof 必须按 evidence_class 而非 origin 判定，direct_source/derived_source 允许
  - stock_search 分类必须 formal origin 优先，不能误入真实来源区
  - frame 早期门必须检查本帧全部 required refs
  - generated hydrate 同 ID 必须把 project 正式字段补回旧 context
  - 同 ID project 非字符串正式字段不得覆盖 context 有效 required/origin
  - formal origin 必须压过同 ID runtime 中冲突的 legacy source，hydrate 不得抛来源冲突
  - 生图后的早期 project.json 持久化必须写入完整正式视觉素材字段
  - 帧级 HTML 素材校验必须与 requirement 单一真值一致，测试不得在视觉 QA 阶段晚注入 graph refs
  - formal-first 生成素材身份必须覆盖 Content Graph、Prompt、Frame 检查、生成图恢复与 workflow 复用
  - 同 ID 的 creativeContext/project 素材必须补齐正式字段，不能因旧 context 先到而丢失 required
  - asset_usage_report.assets 必须保留统一视觉素材正式字段
  - AI 生成素材识别必须 formal origin 优先、legacy source 仅回退
  - 完整 workflow 必须证明 preferred、optional 与缺 requirement 的 legacy 素材未引用时不阻断
```

三个 worktree 的文件与状态所有权不重叠，可以并行写；Coordinator 仍串行冻结、Review 和集成。B-06a 真实 Chromium smoke 与 Phase B 全量门留到 B-07b。

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
| REQ-B-01 | `verified` | 创作输入区暂存上传、缩略图和 preferred/required 控件 | B-04a、B-04b |
| REQ-B-02 | `verified` | 创建任务时认领上传素材 | B-03 |
| REQ-B-03 | `verified` | 任务创建后立即可查看已认领素材 | B-03 |
| REQ-B-04 | `verified` | 文章图、GitHub/README 图、允许的页面截图、AI 生图、Pexels/search 和衍生图统一进入 `asset_context.assets` | B-02、B-06a、B-06b |
| REQ-B-05 | `verified` | 运行中持续追加素材与中文诊断 | B-02、B-06a、B-06b |
| REQ-B-06 | `verified` | `origin/origin_detail/requirement/evidence_class` 分维协议 | B-01 |
| REQ-B-07 | `verified` | direct source、synthetic、stock/search 的证据边界 | B-01、B-02 |
| REQ-B-08 | `verified` | 任何可引用图片必须先登记 | B-06a、B-06b、B-07 |
| REQ-B-09 | `pending` | required 素材无真实可见 Shot 时阻断 | B-07a、B-07b、C-04、C-05 |
| REQ-B-10 | `pending` | Asset Usage Report 与素材面板一致 | B-05、C-05 |

### C. 多图编排

| ID | 状态 | 要求 | 覆盖 Task |
|---|---|---|---|
| REQ-C-01 | `verified` | 一个 Scene 使用 `1～4` 个 Shot | C-02 |
| REQ-C-02 | `verified` | 单图统一为一个 Shot 的 Image Sequence | C-02 |
| REQ-C-03 | `verified` | 四种主要 Sequence Mode | C-02 |
| REQ-C-04 | `verified` | Shot Role、Caption IDs、最短可见时间 | C-02、C-03 |
| REQ-C-05 | `verified` | Caption 时间派生入场、保持、退出和重叠 | C-03、C-04 |
| REQ-C-06 | `verified` | 同 Scene 使用连续 HTML 时间线 | C-04 |
| REQ-C-07 | `verified` | Scene 内不经过独立 Beat MP4 裸切 | C-04 |
| REQ-C-08 | `verified` | 跨 Scene 转场保持独立 | C-04 |
| REQ-C-09 | `verified` | 多图不是强制数量指标 | C-02 |
| REQ-C-10 | `verified` | AI 生图补视觉角色，Pexels/search 不为凑数 | C-01、C-02 |

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
| Phase B Task 4A 暂存 requirement 更新 | `c63ac1b`；冻结 revision `git-index-tree-v1:a8b8220:12383438760a1e56c2329d77e129ca9a02f5e0dc`；upload service 与 route 测试在 `dev` 串行通过；规格 Review PASS；代码质量 Review PASS；旧 revision `dd1744aa…` 已失效 |
| Phase B Task 4B 上传 UI | `f9ae697`；冻结 revision `git-index-tree-v1:6bab504:675f1ca41a4d72eb2fcef69c385f5cde6da72b94`；两组前端源码测试与 `npm run build:frontend` 在 `dev` 串行通过；规格 Review PASS；代码质量 Review PASS；既有 >500kB chunk warning 保留 |
| Phase B Task 5 素材面板正式协议 | `9a7c0e2`；冻结 revision `git-index-tree-v1:16a01ad:f0391bc76966782f6476958de97c23cadda83565`；素材面板测试与 `npm run build:frontend` 在 `dev` 串行通过；规格 Review PASS；代码质量 Review PASS；既有 >500kB chunk warning 保留 |
| Phase B Task 6A 页面截图复审 | revision `faad0ec…` 规格 PASS、质量 CHANGES_REQUESTED；目标测试通过但 Playwright 1.60 redirect 运行时契约证明 fake 假阳性，旧 revision 已失效 |
| Phase B Task 6A redirect 修复 Candidate | revision `eb725288cf30de67c36b3c17b060dc7400062efd`；document 与三类静态资源 3xx 首跳 fail-closed 测试通过；独立规格复审 PASS；非独立质量审计发现 route.fetch 无界缓冲，Candidate 不得集成 |
| Phase B Task 6A 页面截图完成 | `32a51c5`；冻结 revision `8cfbf2540fca08f978c13e8e51ae4ebb2285841d`；Node 流式单响应/总预算、redirect、Content-Length、encoding、单终态与资源清理通过；规格 Review PASS；代码质量 Review PASS；dev 两组测试通过；真实 Chromium smoke 待 B-07b |
| Phase B Task 6B derived 修复 Candidate | revision `bf9475b98d8f338c409ee76a60265ec019843815`；真实 PNG/JPEG/WebP 签名、严格幂等、derivation 深拷贝与三类 junction 逃逸测试通过；等待新 revision 双复审 |
| Phase B Task 6B derived 完成 | `ca45e1d`；冻结 revision `0675e733e7b9105927ec0ac4fad0f6aa3824c122`；真实签名、严格幂等、plain JSON-like、junction 逃逸与安全清理通过；规格 Review PASS；代码质量 Review PASS；dev 两组测试通过 |
| Phase B Task 7A requirement 修复 Candidate | revision `d2a84d2926eb1a9250a8de6d22301d957acb4a26`；usage/workflow/generated persist/generated phase/project store 五组测试通过；等待双复审 |
| Phase B Task 7A 根因修复工作树 | B-07a Agent 中止前保留 15 个未暂存允许路径，`341 insertions/63 deletions`，`git diff --check` 无 whitespace error；未收到最终测试或新 revision，不得按完成处理 |
| Phase B Task 7A requirement 语义完成 | `fda1c71`；冻结 revision `654d1063be9431cf55c8eacce9c0a1b9e3ad07e1`；16 条允许路径；formal identity/evidence/stock/hydrate、全部 required refs、合法枚举合并与早期 project 正式字段持久化已覆盖；规格 Review PASS；代码质量 Review PASS；dev 10 项串行验证通过 |
| Phase B Task 7B 集成门完成 | `218fbf9`；最终冻结 revision `9589958ba933261b292cc89b6589440fe5540d62`、tree `9634192c39763f50a0bdf9e8fc58951e76e1a003`；规格 Review PASS、普通代码质量 Review PASS、本地真实 Chrome QA PASS；dev 38 组 Node 测试与 `npm run build:frontend` 通过，仅保留既有 >500kB chunk warning；真实 GitHub `https://github.com/openai/codex` 页面截图 smoke 通过，Chrome `150.0.7871.124`、Playwright `1.60.0`、PNG `1440x900`/`72497` bytes，Node 仅转发 1 个 document 与 19 个 stylesheet，临时目录无残留；REQ-B-08 verified，REQ-B-09/10 继续 pending |
| Phase C 只读实现前审计 | 基线 `857dee2`；content graph、visual plan、scene continuity、asset usage、workflow 五组测试通过；C-01～C-05 Task Packet 已准备，B-07b 写门已解除 |
| Phase C Task 1 多素材候选契约 | `df9a519`；冻结 revision `c0625e81361fba2919d8f9b836c912c841fc95bb`、tree `b3b3999efbc04198ca2358130186131a8aaa0220`；Content Graph 每 scene 只保留已登记、可用、保序去重后最多 4 张候选，不强制凑满；空注册表、generated scene identity、usage 四值和 evidence 边界 fail-closed；规格 Review PASS、代码质量 Review PASS；dev 13 组直接测试与默认 runner 2 组通过；Image Sequence/Shot requirements 继续 pending，留给 C-02 |
| Phase C Task 2 Image Sequence 规划 | `fab5167`；冻结 revision `8003202db1bf39435f62f13cc3add05c8d16ad3a`、tree `44005cd6851142502756057fb6087efded35867e`；workflow 改为 canonical Graph 后构建 v2 Visual Plan；0 图 diagram、单图和多图统一为 1～4 Shot image_sequence；四种 mode、required 冲突、正式 Shot src、canonical/expanded graph 所有权与 resume 指纹均确定性处理；full/short/retry Prompt 使用 registry 核对后的 Shot 顺序且不发明 timing；规格 Review PASS、代码质量 Review PASS；dev 22 组测试通过；Caption IDs/真实时间窗/visible duration 继续 pending |
| Phase C Task 3 Shot 字幕与计划时间窗 | `6d58460`；冻结 revision `e17a51e03c5b71e81c9a9c9486bd7ff5f7336f52`、tree `7577efca3f3481e7d1e989e275168332083c40b3`；复用 canonical Caption Track 为 Shot 写入 scene-local `caption_ids`、`active_window` 和 `minimum_visible_duration_sec`；按 mode 派生窗口，optional/preferred 确定性减图，required 冲突在 Frame HTML 前中文阻断；全局字幕开关、normalize 后 ID 冲突、尾部窄窗、无字幕 compare/overview/异质 minimum 与 0/1 Shot 收口均覆盖；不写 `visible_duration_sec`/enter/hold/exit/camera；规格 Review PASS、代码质量 Review PASS，质量审计 2400 个组合不变量无问题；dev 17 组测试通过 |
| Phase C Task 4 Scene 连续 Image Sequence | `c5e08f0`；冻结 revision `09f19e090d93f1bb1eee844e678a0c04e3b8cf4c`、tree `7b7065881fa507f5ee94b8ee57db14c93e93b8ed`；同 Scene Shot/Caption/Beat 共用 scene-local Playback Clock，一个 Scene 一个 HTML/MP4，跨 Scene 保持独立；受管 Shot DOM、素材注册表、退出淡化、默认 scene_html、定向 retry/checkpoint/fingerprint 与浏览器播放门闭合；规格 Review PASS、代码质量 Review PASS；Candidate 15 组 Node 18.7 秒与真实 Chromium 79.1 秒通过；dev 15 组 Node 20.0 秒与真实 Chromium 78.1 秒通过；REQ-C-05～08 verified，真实 visible_duration_sec/Usage Report 留给 C-05 |

后续业务代码提交不修改本 Ledger；Coordinator 在取得最终代码 SHA 后独立追加：Requirement、代码提交、验证命令、冻结 revision 对应的双 Review 结论和剩余风险。完整日志、diff、搜索输出和 Agent 对话不进入 Ledger。
