# html-video 画幅契约与尺寸校验设计

## 背景

最新一次一键创作在 `project` 阶段失败：

```text
HTML 画幅尺寸不符合目标 1920x1080。css:.corner-frame span 使用 140x140。
```

失败任务为：

```text
D:\code3\MediaCrawler-GUI\data\creative-workflows\20260626050524422759.json
```

`project.json` checkpoint 显示失败发生在 `frame_html` 子阶段，`scene_01` 生成 HTML 后未写入 `frames`，后续 `validate_project`、单帧渲染、合成和巡检都没有执行。

当前根因不是生成 HTML 真的把视频画幅改成了 `140x140`，而是 `server/services/creative-video/html-video/frameHtmlAgent.js` 的静态尺寸校验把 `.corner-frame span` 当成了根画布。现有逻辑通过 selector 名称猜测 root canvas：

```js
return /[.#-](app|root|stage|scene|frame|canvas|screen|page|video|container)\b/.test(normalized);
```

因此任何普通装饰类名只要包含 `-frame`，并且 CSS 中声明了 `width/height`，都会被纳入画幅校验。例如：

```css
.corner-frame span {
  width: 140px;
  height: 140px;
}
```

这类元素是角标装饰，不是视频根画布。当前规则误伤后会触发 `frame_html_invalid`，并阻断整条工程生成链路。

参考工程 `D:\code3\html-video` 的稳定边界更清晰：

- 渲染输出尺寸由 render config 决定，Playwright 使用 `viewport: { width, height }` 和 `recordVideo.size`。
- 模板用明确根节点表达画布，例如 `#root data-width="1920" data-height="1080"`。
- 普通装饰元素、卡片、logo、角标的 CSS 尺寸不参与画幅判断。

本设计目标是把 MediaCrawler-GUI 的 html-video 画幅判断从“猜 CSS selector”升级为明确契约和浏览器实测。

## 目标

- `project.output.resolution` 是视频输出画幅的唯一权威来源。
- 生成的 raw HTML 必须有明确画布契约，不再靠 `.frame`、`.scene`、`.video` 等类名猜测根节点。
- 尺寸校验必须能拦截真正的横竖屏交换、viewport 错误、根画布错误和滚动溢出。
- 尺寸校验不得因为 `.corner-frame span`、`.logo-frame`、`.device-frame`、`.card-frame` 等普通元素失败。
- `frame_html` 生成阶段和 `validationGate` 项目校验阶段复用同一套画幅契约逻辑。
- 失败诊断要指向真实问题，例如 viewport 错、`data-hv-canvas` 错、浏览器实测滚动溢出，而不是普通 CSS 装饰元素尺寸。
- 对齐 `D:\code3\html-video` 的核心思路，但不把参考工程作为运行时依赖。

## 非目标

- 不引入 CSS parser。
- 不解析完整 CSS cascade。
- 不新增第三方依赖。
- 不改变最终视频输出尺寸来源。
- 不重写 html-video 渲染、合成、编辑器或模板系统。
- 不通过关闭尺寸校验绕过错误。
- 不要求历史失败任务自动迁移；修复后用户可从失败处重试或重新运行。

## 画幅契约

### 权威尺寸

视频目标尺寸来自：

```text
project.output.resolution
templateRenderTarget.resolution
target.resolution
```

在当前一键创作链路中，最终应归一到：

```js
{ width: 1920, height: 1080 }
```

或其他用户选择的目标分辨率。

HTML 内部声明不能覆盖该权威尺寸，只能被用来校验是否和权威尺寸一致。

### HTML 根画布声明

生成后的 HTML 必须具备一个明确根画布。推荐优先使用 `body`：

```html
<body data-hv-canvas data-width="1920" data-height="1080">
```

也允许 `html-video` 风格根节点：

```html
<div id="root" data-hv-canvas data-width="1920" data-height="1080">
```

为兼容参考工程模板，也接受：

```html
<div id="root" data-composition-id="main" data-width="1920" data-height="1080">
```

以及多 composition 子节点：

```html
<div data-composition-id="scene" data-width="1920" data-height="1080"></div>
```

但校验时应优先检查顶层根画布，不应把任意深层 composition 或普通元素误认为全局画布。

### 基础样式

规范化后的 HTML 应确保：

```css
html, body {
  margin: 0;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
}
```

具体实现可以通过注入一段系统样式实现，不要求直接改写用户原始 CSS rule。

### 明确不参与画幅校验的内容

以下 selector 或元素尺寸不参与画幅校验：

```css
.corner-frame span
.logo-frame
.device-frame
.card-frame
.frame-card
.mini-frame
.browser-frame
```

原则是：普通 CSS selector 名称不能作为根画布证据。只有明确 contract 属性、viewport、`html/body`、已知根节点可以作为画幅依据。

## 推荐架构

新增集中模块：

```text
server/services/creative-video/html-video/frameCanvasContract.js
```

职责：

- 解析目标 resolution。
- 规范化 HTML 画布声明。
- 静态校验 viewport、`html/body` 和明确根画布属性。
- 生成可读诊断。
- 可选执行 Playwright 浏览器实测。

建议导出：

```js
normalizeHtmlCanvasContract(html, target)
validateHtmlCanvasContract(html, target)
measureHtmlCanvasWithBrowser(htmlPath, target, options)
```

其中：

- `normalizeHtmlCanvasContract` 只做确定性、安全的补齐。
- `validateHtmlCanvasContract` 不启动浏览器，适合生成阶段快速失败。
- `measureHtmlCanvasWithBrowser` 用现有 Playwright 依赖做最终布局实测，适合写入临时 HTML 后执行。

## 生成阶段流程

当前流程：

```text
模型生成 HTML
-> extractHtmlDocument
-> validateGeneratedHtml
-> 成功后写入 project frames
```

建议改为：

```text
模型生成 HTML
-> extractHtmlDocument
-> normalizeHtmlCanvasContract
-> validateHtmlCanvasContract
-> 写入 frames/scene_xx.html
-> measureHtmlCanvasWithBrowser
-> validateHtmlContentQuality
-> 成功后写入 frame metadata/checkpoint
```

这样做的好处：

- HTML 即使浏览器实测失败，也能落盘，便于诊断和重试。
- 静态 contract 错误和浏览器布局错误可以分开诊断。
- `.corner-frame span` 不会再阻断生成。

如果担心落盘失败 HTML 污染正式 frames，可以先写：

```text
frames/.draft/scene_01.html
```

实测通过后再移动或复制到正式 `frames/scene_01.html`。这是更稳的方案，但实现略多；首版也可以写正式文件并通过 checkpoint 标记失败状态。

## 项目校验阶段流程

`server/services/creative-video/html-video/validationGate.js` 当前复用 `validateHtmlTargetResolution()`。

改造后应改为：

```text
读取 raw_html
-> validateHtmlCanvasContract
-> 必要时 measureHtmlCanvasWithBrowser
-> collectMissingTextKeys
```

诊断 code 保持兼容：

```text
raw_html_resolution_mismatch
```

但 details 应更准确：

```json
{
  "expected": { "width": 1920, "height": 1080 },
  "actual": { "width": 140, "height": 140, "source": "data-hv-canvas" }
}
```

或：

```json
{
  "expected": { "width": 1920, "height": 1080 },
  "actual": { "scrollWidth": 2050, "scrollHeight": 1080, "source": "browser_measure" }
}
```

## 浏览器实测规则

用 Playwright 在目标 viewport 下打开 HTML：

```js
viewport: { width, height }
deviceScaleFactor: 1
```

检查：

- `window.innerWidth === width`
- `window.innerHeight === height`
- `document.scrollingElement.scrollWidth <= width + tolerance`
- `document.scrollingElement.scrollHeight <= height + tolerance`
- `[data-hv-canvas]` 存在
- `[data-hv-canvas]` 的 `data-width/data-height` 等于目标尺寸
- 如果根画布是普通元素，其 `getBoundingClientRect()` 接近目标尺寸
- 如果根画布是 `body`，以 viewport 和 scroll size 为准，不依赖 `body.getBoundingClientRect()` 的浏览器差异

建议 tolerance：

```js
const TOLERANCE_PX = 2;
```

浏览器实测不应把页面内小元素尺寸当作画幅。它只检查 viewport、scrolling area 和明确根画布。

## Prompt 调整

`frameHtmlAgent` 的完整 prompt 和 retry prompt 应加入明确要求：

```text
HTML 必须包含明确根画布：
<body data-hv-canvas data-width="1920" data-height="1080">
或
<div id="root" data-hv-canvas data-width="1920" data-height="1080">

project.output.resolution 是最终视频尺寸；不要通过普通元素类名声明画幅。
普通装饰元素可以使用自己的 width/height，但不能替代根画布。
```

短 prompt 也要包含同样要求，避免 fallback 路径缺失 contract。

## 修改点

### 新增

```text
server/services/creative-video/html-video/frameCanvasContract.js
```

负责画幅契约的 normalize、静态校验和浏览器实测。

### 修改

```text
server/services/creative-video/html-video/frameHtmlAgent.js
```

- 移除或废弃 `extractCssRootDimensions()` 对普通 CSS selector 的扫描。
- `validateGeneratedHtml()` 改用 `validateHtmlCanvasContract()`。
- prompt 增加 `data-hv-canvas/data-width/data-height` 要求。
- `generateFrameHtml()` 在校验前先 normalize。

```text
server/services/creative-video/html-video/validationGate.js
```

- raw_html 尺寸校验改用 `validateHtmlCanvasContract()`。
- 如调用链允许，增加浏览器实测。

```text
server/services/creative-video/html-video/htmlVideoWorkflow.js
```

- 如采用“先写 draft 再浏览器实测”，在 frame_html 子阶段插入 draft 写入和实测。
- 失败 checkpoint 保留 `frame_id`、`diagnostic_code` 和 HTML 路径，便于失败恢复。

```text
server/services/creative-video/html-video/frameFallbackBuilder.js
server/services/creative-video/html-video/rawHtmlFrameBuilder.js
```

- 输出 fallback/raw HTML 时补齐 `data-hv-canvas/data-width/data-height`。

### 测试

```text
tests/test-html-video-frame-html-agent.js
tests/test-html-video-validation-gate.js
```

必要时新增：

```text
tests/test-html-video-frame-canvas-contract.js
```

## 测试用例

### `.corner-frame span` 不应失败

输入：

```html
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=1920,height=1080,initial-scale=1.0">
  <style>
    html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
    .corner-frame span{width:140px;height:140px}
  </style>
</head>
<body data-hv-canvas data-width="1920" data-height="1080">
  <div class="corner-frame"><span></span></div>
</body>
</html>
```

期望：

```text
validateHtmlCanvasContract success=true
```

### 横竖屏交换仍应失败

目标：

```json
{ "width": 1080, "height": 1920 }
```

HTML：

```html
<meta name="viewport" content="width=1920,height=1080">
<body data-hv-canvas data-width="1920" data-height="1080"></body>
```

期望：

```text
success=false
message 包含 1080x1920 和 1920x1080
```

### 根画布 contract 错误应失败

HTML：

```html
<meta name="viewport" content="width=1920,height=1080">
<body data-hv-canvas data-width="140" data-height="140"></body>
```

期望：

```text
success=false
actual.source=data-hv-canvas
```

### `html-video` 风格根节点应通过

HTML：

```html
<meta name="viewport" content="width=1920,height=1080">
<body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080"></div>
</body>
```

期望：

```text
success=true
```

### 浏览器滚动溢出应失败

HTML：

```html
<body data-hv-canvas data-width="1920" data-height="1080">
  <div style="position:absolute;left:1900px;width:300px;height:100px"></div>
</body>
```

期望：

```text
measureHtmlCanvasWithBrowser success=false
actual.source=browser_measure
actual.scrollWidth > 1920
```

## 风险与取舍

### 风险：normalize 改变页面布局

给 `body` 增加属性基本不会影响布局；注入 `html,body` 基础样式可能影响模型故意设置的 body 尺寸。

取舍：视频画幅必须稳定，`margin:0`、固定目标宽高、`overflow:hidden` 是 html-video 成片的基础约束。若某帧需要内部缩放，应在根画布内部实现，不应改变 body 画幅。

### 风险：浏览器实测增加耗时

每帧多一次 Playwright 打开页面会增加生成耗时。

取舍：浏览器实测只在 frame_html 生成成功后执行，且相比 AI 生成和视频渲染成本较小。若后续性能不足，可以只在静态 contract 弱信号或最终 validation gate 中启用。

### 风险：历史 HTML 没有 `data-hv-canvas`

旧项目或手写 raw_html 可能没有根画布属性。

取舍：normalize 可以补齐 `body data-hv-canvas`；validation gate 对旧项目可先 warning 后修复，新增生成链路必须严格要求。

## 验收标准

- 最新失败样例中的 `.corner-frame span{width:140px;height:140px}` 不再触发画幅错误。
- 目标横屏/竖屏交换仍会失败，并给出明确诊断。
- `raw_html_resolution_mismatch` 不再引用普通装饰 selector。
- 生成出的 HTML 包含 `data-hv-canvas` 和 `data-width/data-height`。
- `D:\code3\html-video` 风格的 `#root data-width/data-height` 可以通过 contract 校验。
- 相关测试通过：

```text
node tests/test-html-video-frame-html-agent.js
node tests/test-html-video-validation-gate.js
```

如新增独立测试：

```text
node tests/test-html-video-frame-canvas-contract.js
```

## 后续实施建议

建议按以下顺序实现：

1. 新增 `frameCanvasContract.js` 和单元测试。
2. `frameHtmlAgent` 接入 normalize 和静态 contract validation。
3. `validationGate` 复用同一 contract validation。
4. fallback/raw builder 补齐 `data-hv-canvas`。
5. 接入 Playwright 浏览器实测。
6. 调整 prompt 和 retry prompt。

第一阶段可以先完成 1-4，解决当前误判和 contract 统一问题；第二阶段再补浏览器实测，避免一次改动跨太多执行路径。
