# Tech Minimal Product

面向 MuseDock 本地控制台的产品级设计系统。目标是把首页、一键创作任务详情、二次编辑器和设置中心统一成“科技感 + 简约”的工作台界面，而不是营销页或装饰型大屏。

## 来源

- `frontend-react/src/App.jsx`：路由结构，确认首页指向 `/creative`。
- `frontend-react/src/components/AppShell.jsx`：路由容器（空壳，无全局顶栏）。全局导航由创作侧栏承担（侧栏即导航），设置入口固定在侧栏底部。
- `frontend-react/src/pages/OneClickCreativePage.jsx`：首页与任务详情的真实信息流。
- `frontend-react/src/components/creative/CreativeComposer.jsx`：首页输入区和模式切换。
- `frontend-react/src/components/creative/CreativeSidebar.jsx`：任务侧栏和任务历史。
- `frontend-react/src/components/creative/CreativeTaskDetail.jsx`：任务详情、步骤、进度、恢复建议和视频预览。
- `frontend-react/src/pages/CreativeEditorPage.jsx`：二次编辑页面状态与返回逻辑。
- `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`：HTML 视频编辑器工具栏、自然语言编辑和画布入口。
- `frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx`：画布、元素检查器、帧条和字段面板。
- `frontend-react/src/pages/SettingsPage.jsx` 及 `frontend-react/src/components/settings/*`：设置中心四个分区、模型配置、系统诊断和创作默认值。
- `frontend-react/src/styles.css`：当前颜色、密度、圆角、状态和旧页面样式。

## 设计原则

- 先做工具台，不做营销首屏。首页必须直接可输入、可创建任务。
- 系统底色回到原版浅灰白，首页和设置中心避免大面积深色背景。
- 普通主操作使用深墨色和中性灰；红色只用于删除、失败、不可恢复等警示语义，青色只作为细微 focus/status 信号。
- 通用卡片圆角不超过 8px；首页主输入器保留原版较大的圆角输入框，按钮和表单保持紧凑。
- 信息层级靠布局、边框、留白和字重解决，避免大面积渐变和装饰图形。
- 所有用户可见文案默认中文，技术字段和产品名可保留英文。

## 文件索引

- `tokens/colors_and_type.css`：颜色、字体、语义色、间距和阴影 token。
- `brand/voice-and-tone.md`：文案语气和状态提示规范。
- `brand/style-notes.md`：页面布局、组件、状态和动效规则。

## 落地状态（2026-07）

- token 已接入实现：`frontend-react/src/styles.css` 顶部 `@import` 本系统的 `tokens/colors_and_type.css`，并在 `frontend-react/tailwind.config.js` 注册了语义色类（`ink`、`ink-strong`、`signal`、`page`、`surface-1/2`、`surface-hover`、`fg-1/2/3`、`line-1/2`、`warn`、`danger`、`success`）与 `font-sans`/`font-mono`。新代码颜色一律走这些 token 类或 CSS 变量，不再新增任意值 hex。
- `styles.css` 中 shadcn 的 HSL 变量层是本系统 token 的换算副本（Tailwind 透明度修饰符要求裸 HSL），每行注释标明来源 token；改色先改 token，再同步该处。
- 主操作色为深墨 `--accent-primary`（#111827），按压/hover 加深用 `--accent-primary-strong`（#020617）。界面不使用蓝色作为操作色、链接色或选中态。
- 确认类交互统一使用 `frontend-react/src/components/ui/confirm-dialog.jsx`（Radix Dialog，具备焦点陷阱与 ESC 关闭），不使用 `window.confirm`/`window.alert` 或手写 fixed 弹层。

## 待确认

- 这套系统默认用于产品后台和工作台，不覆盖外部官网或宣传页。
- 当前未引入新字体文件；先使用系统字体栈，后续如果需要品牌识别度再补字体资产。
- mockup 中的数值、任务名和缩略图均是展示数据，落地时应绑定现有接口数据。
