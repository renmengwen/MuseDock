# shadcn/ui 与 Tailwind 表格重构设计

## 背景

当前前端使用 React + Vite，UI 主要由普通 JSX 标签和 `styles.css` 手写样式组成。项目已有抓取页、抓取记录页、素材工作台、AI 工作台和设置页，后续界面状态会继续增加。为了统一组件结构并降低后续维护成本，引入 `shadcn/ui + Tailwind CSS` 作为基础 UI 层。

本次目标不是重做视觉风格，而是在尽量保持现有外观的前提下统一组件和代码结构，并增强抓取列表、抓取记录列表的表格能力。

## 目标

- 引入 Tailwind CSS 与 shadcn/ui 基础组件。
- 保留现有浅灰背景、红色主色、8px 圆角、工具型页面布局和顶部导航结构。
- 用统一组件替换现有常见控件，包括按钮、输入框、选择框、弹窗、开关、状态提示和表格。
- 抓取列表和抓取记录列表支持滚动时固定表头。
- 抓取列表和抓取记录列表支持列显示和隐藏配置。
- 列配置持久化到浏览器本地，下次打开仍保留用户选择。

## 非目标

- 不重做整站视觉，不改变主要页面布局。
- 不改后端接口和数据库结构。
- 不做列拖拽排序、列宽调整、服务端同步或跨设备同步。
- 不引入大型表格框架，除非后续出现排序、虚拟滚动、复杂筛选等需求。

## 组件架构

新增 `frontend-react/src/components/ui/` 作为 shadcn/ui 基础组件目录。基础组件保持接近 shadcn 默认结构，但主题变量调整为 MuseDock 当前视觉：

- 主色保留当前红色系。
- 背景继续使用浅灰页面底色。
- 表单、弹窗、按钮和表格边框保持轻量化。
- 圆角以 8px 为主，弹窗可保持略大圆角。

新增共享业务表格组件：

- `frontend-react/src/components/data-table/ConfigurableTable.jsx`
- `frontend-react/src/components/data-table/useColumnVisibility.js`

`ConfigurableTable` 只负责通用表格渲染、固定表头、列设置菜单和空状态。具体列内容由页面传入列定义，避免把业务字段耦合到通用组件里。

## 表格列定义

抓取列表和抓取记录列表改为声明式列配置。推荐结构：

```js
const columns = [
  {
    id: 'title',
    label: '标题',
    defaultVisible: true,
    className: 'min-w-[280px]',
    render: item => item.title || item.description || '-',
  },
];
```

字段说明：

- `id`：列的稳定标识，用于本地持久化。
- `label`：中文表头和列设置菜单文案。
- `defaultVisible`：首次打开时是否显示。
- `className`：可选列样式，用于最小宽度、对齐等。
- `render`：单元格渲染函数。

抓取列表和抓取记录列表按页面和平台分别提供列定义，例如抖音与小红书可以保留不同列集合。

## 固定表头

表格外层使用可滚动容器，表头使用 sticky：

- 外层容器：`overflow-auto`，设置合理的 `max-height`。
- 表头单元格：`sticky top-0 z-10 bg-muted` 或等价主题色。
- 表格宽度允许超过容器，横向滚动时保持内容可读。

固定表头只在表格容器内部生效，不改变页面整体滚动行为。

## 列显示和隐藏

表格右上角提供“列设置”按钮，使用 shadcn 的 `DropdownMenu` 或 `Popover` 搭配 checkbox 项。用户可以勾选或取消勾选列。

至少保留一列可见，避免用户隐藏所有列后出现不可恢复状态。如果本地配置损坏或列定义变化，自动回退到默认列配置。

列配置使用 `localStorage` 持久化，key 按页面和平台区分：

- `musedock:table-columns:crawl:douyin`
- `musedock:table-columns:crawl:xhs`
- `musedock:table-columns:records:douyin`
- `musedock:table-columns:records:xhs`

存储格式为可见列 id 数组：

```json
["title", "type", "author", "createdAt", "actions"]
```

## 页面迁移范围

第一阶段迁移以下位置：

- 抓取页工具栏控件。
- 抓取列表表格。
- 抓取记录页工具栏控件。
- 抓取记录列表表格。
- 登录弹窗和评论弹窗可在同阶段替换为 `Dialog`，但不改变业务流程。
- 设置页的按钮、输入框和开关可在基础组件可用后迁移。

如果第一阶段实现过程中范围需要收缩，优先保证表格能力完成，其他控件迁移可以后移。

## 状态和错误处理

所有触发接口请求的操作继续保留明确 loading 文案、按钮禁用态和完成状态。迁移组件时不得删除现有请求期间的反馈。

列配置读取失败、JSON 解析失败或字段不匹配时，静默回退默认列配置，不阻断页面加载。

## 测试和验证

实现完成后至少执行：

- 前端构建：`npm run build:frontend`
- 浏览器检查抓取页和抓取记录页。
- 验证固定表头在纵向滚动时保持可见。
- 验证列设置显示、隐藏、刷新后仍保持配置。
- 验证每个平台的空状态、loading 状态和操作按钮禁用态仍正常。

## 实施顺序

1. 安装并配置 Tailwind CSS、shadcn/ui 所需依赖和路径别名。
2. 添加基础 `ui` 组件和 `cn` 工具。
3. 建立 `ConfigurableTable` 与列可见性持久化 hook。
4. 将抓取列表和抓取记录列表迁移到配置化表格。
5. 按需迁移按钮、输入框、选择框、弹窗和开关。
6. 构建和浏览器验证。
