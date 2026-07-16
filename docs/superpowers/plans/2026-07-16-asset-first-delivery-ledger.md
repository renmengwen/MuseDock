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

## Goal 开始时保留的工作区改动

以下文件不属于本 Goal 已提交基线，执行过程中不得回滚、覆盖、顺手格式化或纳入无关提交：

- `server/services/creative-video/html-video/layoutQaService.js`
- `server/services/creative-video/retryPlanner.js`
- `tests/test-creative-workflow-retry-planner.js`
- `tests/test-html-video-layout-qa-service.js`
- `tests/fixtures/html-video-layout-qa/text-container-sibling.html`

若后续任务必须修改同一文件，先审计现有 diff，证明能够保留并兼容这些改动；无法安全合并时才视为用户阻塞。

## 当前执行状态

| Phase | 状态 | 说明 |
|---|---|---|
| A. 实时代码与需求覆盖审计 | `complete` | 三个独立新上下文只读 Agent 已返回压缩 Handoff；现有基线测试通过 |
| B. 统一视觉素材 | `in_progress` | Task 1 统一资产契约与幂等合并已通过双 Review；继续接入现有 producer |
| C. 多图编排与 Scene 连续时间线 | `pending` | 依赖统一素材协议 |
| D. 焦点、摄影机与字幕同步 | `pending` | 依赖 Image Sequence Plan 和 Caption 绑定 |
| E. QA、定向修复与恢复 | `pending` | 依赖 Camera Plan 和渲染产物 |
| F. 最终真实任务端到端验收 | `pending` | 依赖 B～E 全部完成 |

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

## 需求覆盖矩阵

### B. 统一视觉素材

- [ ] 创作输入区暂存上传、缩略图和 preferred/required 控件
- [ ] 创建任务时认领上传素材
- [ ] 任务创建后立即可查看已认领素材
- [ ] 文章图、GitHub/README 图、允许的页面截图、AI 生图、Pexels/search 和衍生图统一进入 `asset_context.assets`
- [ ] 运行中持续追加素材与中文诊断
- [ ] `origin/origin_detail/requirement/evidence_class` 分维协议
- [ ] direct source、synthetic、stock/search 的证据边界
- [ ] 任何可引用图片必须先登记
- [ ] required 素材无真实可见 Shot 时阻断
- [ ] Asset Usage Report 与素材面板一致

### C. 多图编排

- [ ] 一个 Scene 使用 `1～4` 个 Shot
- [ ] 单图统一为一个 Shot 的 Image Sequence
- [ ] 四种主要 Sequence Mode
- [ ] Shot Role、Caption IDs、最短可见时间
- [ ] Caption 时间派生入场、保持、退出和重叠
- [ ] 同 Scene 使用连续 HTML 时间线
- [ ] Scene 内不经过独立 Beat MP4 裸切
- [ ] 跨 Scene 转场保持独立
- [ ] 多图不是强制数量指标
- [ ] AI 生图补视觉角色，Pexels/search 不为凑数

### D. 焦点与摄影机

- [ ] 图片级 `focus_regions`
- [ ] Scene/Shot 级 `focus_cues`
- [ ] DOM/manual、OCR/验证、AI-only、歧义失败的信任等级
- [ ] 语义准确与几何准确分开
- [ ] A/B 自动聚焦，C 低倍率宽松聚焦，D 不聚焦
- [ ] cover/contain 和双层截图坐标映射
- [ ] 安全目标中心、zoom 限幅、位移 clamp 和黑边防护
- [ ] Caption Cue 同时驱动摄影机和字幕关键词高亮
- [ ] 同一 Region 连续 Cue 合并并避免抖动
- [ ] 每张最终使用图片最多分析一次

### E. QA、修复与恢复

- [ ] 数据契约、引用完整性和 required 门
- [ ] 摄影机数学测试
- [ ] Scene 预览渲染测试
- [ ] 白屏、黑边、裸硬切、字幕遮挡和过度放大检查
- [ ] 错误焦点与焦点可信度验收
- [ ] 自动修复后 blocking 问题真正阻断
- [ ] 定向重试只失效受影响范围
- [ ] Checkpoint 复用包含真实输入、Prompt 和契约版本
- [ ] 重启后只恢复失败 Scene/Shot
- [ ] `skipValidation=false` 进入完整视觉 QA

### F. 最终验收

- [ ] 覆盖截图、UI、终端、图表、照片、AI 图、相似目标和负样本
- [ ] 运行真实端到端任务
- [ ] 核对 `project.json`、`asset_usage_report`、Scene 产物和 `visual-report.json`
- [ ] 相关单测、前端构建和后端验证通过
- [ ] 规格 Review 无未解决问题
- [ ] 代码质量 Review 无未解决问题
- [ ] 最终工作区只保留 Goal 开始前已有的用户改动

## 证据记录

| 内容 | 证据 |
|---|---|
| overlay P0 完成基线 | `3a23622` 及其前置 P0 提交 |
| Delivery Loop 设计纠正 | `7512979` |
| Phase A 审计与 Phase B 计划 | `b48fcf6` |
| Phase B Task 1 统一资产契约 | `tests/test-visual-asset-contract.js` 与 `tests/test-creative-context.js` 通过；规格 Review PASS；代码质量 Review PASS |

后续每个任务完成后追加：需求、提交、验证命令、Review 结论和剩余风险；不记录完整日志或 Agent 对话。
