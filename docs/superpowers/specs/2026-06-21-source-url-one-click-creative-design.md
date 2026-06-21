# 一键创作外部 URL 来源设计

## 背景

当前一键创作入口支持三种实际输入语义：

- 抖音视频 ID。
- 可识别 `aweme_id` 的抖音链接。
- 普通文本创作方向。

如果用户输入微信公众号文章链接、普通网页文章链接或 GitHub 仓库链接，当前后端不会读取链接内容，而是把整段输入当作纯文本 brief。这样生成链路只知道“用户贴了一个 URL”，不知道文章正文、仓库 README、项目名称和关键事实。

`D:\code3\html-video` 已经有一套轻量的外部来源读取逻辑，支持：

- 网页文章读取。
- 微信公众号文章 `#js_content` 正文提取。
- GitHub 公共仓库元数据、README 和顶层目录读取。
- 统一转成 Markdown 作为 source material。

本设计把这套能力接入 `MediaCrawler-GUI` 的一键创作入口，但不改动 html-video 渲染链路。外部来源会被整理成现有 synthetic workspace 能消费的 `metadata.json`、`transcript.json`、`analysis_input.json`，后续继续复用当前 Agent、TTS 和 html-video production path。

所有用户可见文案必须使用中文。技术名词、URL、GitHub、README、html-video、OpenAI API 等可以保留英文。

## 目标

- 一键创作输入框支持公开微信公众号文章 URL、普通网页文章 URL 和公开 GitHub repo URL。
- 用户可以只粘贴 URL，也可以在 URL 前后追加创作要求。
- 后端自动识别 URL 类型，不要求用户手动选择“文章”或“GitHub”。
- 来源读取发生在 workflow 的 `source` 阶段，并通过现有 SSE 进度显示明确 loading 文案。
- 文章或 repo 内容转成 Markdown 后写入 synthetic workspace，让后续成片链路基于真实来源材料生成。
- Agent 生成必须明确基于来源材料里的具体事实、名字、数字、项目术语和主张，避免泛泛而谈。
- 保持现有抖音输入和纯文本输入行为不回退。

## 非目标

- 不支持需要登录、Cookie 或验证码的网页。
- 不支持 GitHub 私有仓库。
- 不接入 GitHub Token。
- 不 clone 仓库。
- 不读取全量源码。
- 不支持指定分支、目录或文件。
- 不把文章图片作为视频素材下载。
- 不新增独立“导入文章”页面。
- 不把外部 URL 来源和“联网获取最新资料”混成同一个概念。

## 用户触达路径

入口仍然是 `/creative` 的一键创作输入框。

用户可以输入：

```text
https://mp.weixin.qq.com/s/example
```

也可以输入：

```text
做成适合小红书口播节奏的项目解读视频：https://github.com/owner/repo
```

推荐前端标签文案：

```text
输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接
```

推荐 placeholder：

```text
粘贴文章/GitHub 链接，或输入你想生成的视频方向
```

提交按钮和禁用态沿用现有一键创作表单。不要新增平台选择器。后端根据输入自动识别来源。

## 来源识别

`creativeContext.normalizeCreativeInput()` 负责把用户输入归一化为以下模式：

```js
{
  mode: 'douyin' | 'text' | 'source_url',
  raw_text: '',
  aweme_id: '',
  douyin_url: '',
  source_url: '',
  source_hint: '',
  use_research: false,
  asset_ids: []
}
```

识别顺序：

1. 如果能提取抖音 `aweme_id`，保持现有 `mode: 'douyin'`。
2. 如果是抖音链接但提不出 ID，保持现有失败行为，提示“暂时无法从抖音链接中识别视频 ID。”
3. 如果输入里存在公开 http(s) URL，返回 `mode: 'source_url'`。
4. 其他输入返回现有 `mode: 'text'`。

`source_url` 保存第一个 URL。`source_hint` 保存移除 URL 后的用户补充要求，例如“做成适合小红书口播节奏的项目解读视频”。如果用户只输入 URL，`source_hint` 为空。

首版只处理第一个 URL。多个 URL 不报错，但只读取第一个，并在诊断信息里记录 `ignored_url_count`。

## 来源读取服务

新增服务建议命名为：

```text
server/services/sourceFetch.js
```

职责：

- `extractUrls(text, max = 3)`：从文本中提取 URL。
- `assertPublicHttpUrl(raw)`：拒绝非 http(s)、localhost、内网 IP、`.local`、`.internal` 等地址。
- `classifySourceUrl(url)`：返回 `article` 或 `github_repo`。
- `fetchSource(url, options)`：统一入口。
- `fetchArticle(url, options)`：读取网页 HTML，提取主体并转 Markdown。
- `fetchGithubRepo(url, options)`：读取 GitHub 公共仓库信息、README 和顶层目录。
- `htmlToMarkdown(html)`：轻量 HTML 转 Markdown。

返回结构：

```js
{
  success: true,
  kind: 'article' | 'github_repo',
  url: 'https://...',
  title: '来源标题',
  markdown: '# 标题\n\nSource: https://...\n\n正文...',
  truncated: false,
  metadata: {}
}
```

失败结构：

```js
{
  success: false,
  kind: 'article',
  url: 'https://...',
  message: '未能读取文章正文，请确认链接可公开访问。',
  diagnostic: {
    code: 'FETCH_FAILED'
  }
}
```

服务默认使用 `globalThis.fetch`，测试时允许注入 `fetchImpl`。

### 文章读取

文章读取逻辑参考 `D:\code3\html-video\packages\cli\src\fetch-source.ts`：

- 使用浏览器 UA 请求页面。
- 优先提取微信公众号 `#js_content`。
- 其次提取 `<article>`。
- 再其次提取 `<main>`。
- 最后 fallback 到 `<body>`。
- 去除 `script`、`style`、`noscript`、`svg`、`head`、`nav`、`footer`、`form`、`iframe`。
- 保留标题、段落、列表、链接和图片 alt/src Markdown。
- 正文默认截断到 8000 字符。

如果提取后的正文为空或少于 80 个可见字符，返回失败：

```text
未能读取文章正文，请确认链接可公开访问。
```

### GitHub repo 读取

GitHub repo 读取逻辑参考 `D:\code3\html-video\packages\cli\src\fetch-source.ts`：

- 只识别 `https://github.com/<owner>/<repo>`。
- 拒绝 `github.com/search`、`github.com/topics` 等非 repo 路径。
- 使用 GitHub REST API：
  - `GET https://api.github.com/repos/<owner>/<repo>`
  - `GET https://api.github.com/repos/<owner>/<repo>/readme`
  - `GET https://api.github.com/repos/<owner>/<repo>/contents`
- README 使用 `application/vnd.github.raw`。
- README 默认截断到 10000 字符。
- 顶层目录最多保留 40 项。

生成 Markdown 示例：

```markdown
# owner/repo

Source: https://github.com/owner/repo

> 仓库描述

- Language: JavaScript
- Stars: 1234
- License: MIT
- Homepage: https://example.com
- Topics: video, html

## Top-level structure

- packages/
- README.md
- package.json

## README

README 正文...
```

如果 GitHub API 返回 403，提示：

```text
读取 GitHub 仓库失败：GitHub API 访问受限，请稍后重试。
```

如果返回 404，提示：

```text
读取 GitHub 仓库失败：请确认仓库公开可访问。
```

## Workflow 数据流

`creativeWorkflows.prepareSource()` 扩展为：

```text
mode=text
  -> writeSyntheticTextWorkspace()

mode=source_url
  -> fetchSource(source_url)
  -> writeSyntheticSourceWorkspace()

mode=douyin
  -> prepareDouyinSource()
```

`writeSyntheticSourceWorkspace()` 写入当前媒体工作区，保持现有目录结构：

```text
data/media/douyin/<synthetic_aweme_id>/
  metadata.json
  transcript.json
  analysis_input.json
```

首版继续复用 `data/media/douyin` 和 `aweme_id` 字段，避免重构 `agentRuns`、`mediaPipeline`、html-video project store。`source_type` 和 metadata 明确标记真实来源，后续再考虑重命名目录。

`metadata.json` 示例：

```json
{
  "aweme_id": "202606211234560001",
  "source_type": "source_url",
  "source_kind": "article",
  "source_url": "https://mp.weixin.qq.com/s/example",
  "title": "文章标题",
  "description": "用户补充要求或正文开头",
  "creative_workflow_id": "202606211234560001",
  "created_at": "2026-06-21T00:00:00.000Z",
  "updated_at": "2026-06-21T00:00:00.000Z"
}
```

`transcript.json` 示例：

```json
{
  "success": true,
  "status": "done",
  "source_type": "source_url",
  "source_kind": "github_repo",
  "source_url": "https://github.com/owner/repo",
  "title": "owner/repo",
  "text": "# owner/repo\n\nSource: ...",
  "user_hint": "做成适合小红书口播节奏的项目解读视频",
  "truncated": false,
  "updated_at": "2026-06-21T00:00:00.000Z"
}
```

`analysis_input.json` 必须包含：

- `video.title`：来源标题或 URL。
- `video.description`：用户补充要求加来源摘要。
- `video.aweme_url`：为空。
- `source_material`：完整来源信息。
- `transcript.status`：`done`。
- `creative_context`：更新后的创作上下文。

## Creative Context

`source_context` 对外部来源使用：

```js
{
  status: 'ready',
  kind: 'source_url',
  summary: '来源标题或正文摘要',
  transcript: 'Markdown 正文',
  comments_summary: '',
  source_metadata: {
    kind: 'article',
    url: 'https://...',
    title: '标题',
    truncated: false
  },
  diagnostics: {
    source_type: 'source_url',
    source_kind: 'article',
    fetched_at: 'ISO',
    ignored_url_count: 0
  }
}
```

`input` 保留：

```js
{
  mode: 'source_url',
  raw_text: '用户原始输入',
  source_url: 'https://...',
  source_hint: '用户补充要求'
}
```

## Prompt Grounding

当前 html-video content graph 和 scene spec 已经会接收 `creative_context`，但外部来源接入后要强化约束：

- 来源材料是视频主题，不是装饰素材。
- 每个场景必须引用或改写来源材料里的具体事实、名字、数字、术语、项目能力或主张。
- 禁止输出可套用到任何文章或任何仓库的泛泛句子。
- 不要编造来源材料没有的精确数字、机构、版本、结论或功能。
- GitHub repo 视频应基于 README、仓库描述、语言、目录结构和 topics，不要假装读过全量源码。

建议在 `creative-video/creativeSpecAgent.js` 和 `creative-video/html-video/contentGraphAgent.js` 的 prompt 中加入来源材料约束。

## 前端交互

`OneClickCreativePage.jsx` 只做轻量更新：

- label 改成“输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接”。
- placeholder 改成“粘贴文章/GitHub 链接，或输入你想生成的视频方向”。
- 空输入提示改成“请输入视频方向、抖音链接、文章链接或 GitHub 仓库链接”。
- 默认状态改成“填写方向、抖音来源或外部资料链接后，即可创建视频生成任务。”

`source` 阶段 loading 由后端事件驱动，建议文案：

- `source_url.article`：正在读取网页文章...
- 微信公众号：正在读取微信公众号文章...
- `source_url.github_repo`：正在读取 GitHub 仓库信息...
- 成功：外部来源资料已读取并准备完成。

## 错误处理

外部来源读取失败时，workflow 在 `source` 阶段失败，并显示中文错误。

常见错误：

- 非公开 URL：链接不可访问，请确认来源公开可访问。
- 内网或本机地址：出于安全原因，不能读取本机或内网地址。
- 微信公众号正文为空：未能读取文章正文，请确认链接可公开访问。
- GitHub 404：读取 GitHub 仓库失败：请确认仓库公开可访问。
- GitHub 403：读取 GitHub 仓库失败：GitHub API 访问受限，请稍后重试。
- 请求超时：读取外部来源超时，请稍后重试。

错误不要 fallback 为纯文本 URL。否则用户会以为系统已经分析文章，但实际只拿到 URL。

## 安全边界

必须实现 SSRF 防护：

- 只允许 `http:` 和 `https:`。
- 拒绝 `localhost`、`0.0.0.0`、`::1`。
- 拒绝 `.localhost`、`.internal`、`.local`。
- 拒绝 IPv4 私有、loopback、link-local：
  - `127.0.0.0/8`
  - `10.0.0.0/8`
  - `172.16.0.0/12`
  - `192.168.0.0/16`
  - `169.254.0.0/16`
  - `0.0.0.0/8`

首版不解析 DNS 结果来二次拦截私网 IP。该限制写入代码注释，后续如开放给不可信用户再增强。

## 测试要求

必须覆盖：

- URL 提取和内网 URL 拒绝。
- 微信公众号 `#js_content` HTML fixture 提取。
- 普通 `<article>` 页面提取。
- GitHub repo URL 分类和 reserved path 拒绝。
- GitHub repo Markdown 生成。
- `normalizeCreativeInput()` 对抖音、source URL、普通文本的分类。
- `prepareSource()` 对 `source_url` 的 synthetic workspace 写盘。
- 前端文案测试。
- content graph 或 scene spec prompt 包含 source material grounding 约束。

## 验收标准

- 输入抖音 ID/链接的现有一键创作测试仍通过。
- 输入纯文本的现有一键创作测试仍通过。
- 输入微信公众号文章链接时，`source` 阶段显示读取文章，并在成功后进入后续阶段。
- 输入 GitHub repo 链接时，`analysis_input.json` 包含 repo 标题、README、顶层目录。
- 输入 `http://localhost:3000/a` 时，workflow 在 `source` 阶段失败，并显示安全错误。
- 生成的 `transcript.json` 不是 URL 字符串，而是抓取后的 Markdown source material。
- README 更新后不会再暗示小红书或外部 URL 已接入抖音素材分析链路。

