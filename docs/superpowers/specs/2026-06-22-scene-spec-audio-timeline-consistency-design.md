# scene_spec、音频与时间轴一致性设计

## 背景

最新一次一键创作运行暴露了最终视频的核心一致性问题：语音、底部字幕和画面文字分别来自不同阶段的产物。

以 workflow `20260621170402265124` 为例：

- 语音来自 `brief.storyboard` / `hyperframes_freeform.audio`，共 7 段。
- 底部字幕来自 html-video 阶段生成的 `scene_spec.scenes`，共 10 段。
- 画面节点来自 `content_graph.nodes`，共 11 个。

渲染阶段又优先复用了已有 TTS 文件，导致 7 段旧语音被混入 10 段新字幕和 11 帧画面工程。问题不是播放器读取错误，也不是字幕层显示错误，而是生成链路缺少一个“最终成片脚本”的唯一权威来源。

当前项目尚未上线，不需要为旧 run 做复杂兼容。因此本设计直接采用长期正确改法：以 `scene_spec.scenes[]` 作为最终成片的唯一权威源，并通过 hash、绑定关系和渲染门禁保证所有派生产物一致。

## 目标

- 将 `scene_spec.scenes[]` 定为最终成片的唯一权威脚本源。
- 所有最终渲染用的 frame、caption、TTS 音频、时间轴都必须能追溯到同一个 `scene_spec_hash`。
- 旧 `brief.storyboard` 只作为导演策划或初稿来源，不能直接作为最终 html-video 音频来源。
- `content_graph` 只做视觉规划和 frame 辅助信息，不允许重新定义最终脚本的 scene 数量、顺序和 id。
- 当 `scene_spec` 的旁白、字幕或顺序变化时，旧 TTS 必须自动失效。
- 渲染前阻断或自动修复音频、字幕、画面数量不一致的问题，避免继续产出错位 MP4。
- 旧历史 run 可以在下一次渲染时强制重新生成 TTS / frame，不做完整兼容迁移。

## 非目标

- 不把当前项目整体切换为 `D:\code3\html-video` 的 `content_graph` 权威模型。
- 不完整迁移 `html-video` studio 的 soundtrack UI。
- 不要求旧历史 run 直接无损打开并保持旧音频可复用。
- 不在本次设计中重做前端编辑器 UI。
- 不解决 TTS 模型本身读音、停顿、情绪和语速质量问题。
- 不引入独立字幕文件格式导出，例如 `.srt`、`.ass`。

## 核心原则

### scene_spec 是唯一权威源

最终成片阶段以 `scene_spec.scenes[]` 为唯一脚本源：

```text
scene_spec.scenes[]
  -> scene_spec_hash
  -> frames[]
  -> captions
  -> TTS audio
  -> render project
  -> final MP4
```

`brief.storyboard` 可以用于生成 `scene_spec`，但不能在 `scene_spec` 已生成后继续作为最终音频脚本。

`content_graph` 可以从 `scene_spec` 派生，也可以由 AI 提供视觉增强信息，但不得改变 scene 数量、scene 顺序、scene id、旁白文本和字幕文本。

### 所有可复用产物必须带 hash

任何会被后续渲染复用的音频产物都必须声明自己对应的 `scene_spec_hash`。缺失 hash 的音频视为 legacy 音频，只能用于预览或历史展示，不能自动混入最终成片。

### 不静默降级为错位视频

当系统发现 `audio`、`frames`、`content_graph` 与当前 `scene_spec` 不一致时，不能继续渲染错位视频。可自动修复的场景应触发重新生成；不可自动修复时返回中文错误。

## scene_spec_hash

新增服务：

```text
server/services/creative-video/sceneSpecHash.js
```

导出：

```js
computeSceneSpecSpeechHash(sceneSpec)
getSceneSpecSpeechSignature(sceneSpec)
audioMatchesSceneSpec(audio, sceneSpec)
```

hash 只覆盖影响语音和字幕的字段：

```js
{
  version: 1,
  scenes: sceneSpec.scenes.map(scene => ({
    id: scene.id,
    order: scene.order,
    narration_text: scene.narration_text,
    captions: scene.captions
  }))
}
```

不纳入 hash 的字段：

- `visual_text`
- `template_id`
- `inputs`
- `metadata.graph_node`
- `frame_intent`
- 视觉样式、颜色、动效和模板字段

这样只改画面样式时可以复用 TTS；只要改旁白、字幕或顺序，TTS 必须失效。

hash 使用稳定 JSON 序列化和 SHA-256，输出短 hash 或完整 hex 均可，但必须在测试中保证同一输入稳定。

## 音频产物协议

最终 html-video 阶段生成或复用的音频必须带有以下字段：

```js
{
  source: 'scene_spec',
  scene_spec_hash: '...',
  scene_count: 10,
  scene_ids: ['scene_01', 'scene_02'],
  narration_path: '...',
  captions: [],
  duration: 123.4,
  updated_at: '...'
}
```

旧字段如 `path`、`file_name`、`url` 可以保留，但复用判断必须以 `scene_spec_hash` 为准。

### 复用规则

允许复用已有音频的条件：

- 音频文件路径存在。
- 音频状态为 `ready`、`done` 或 `rendered`。
- `audio.source === 'scene_spec'`。
- `audio.scene_spec_hash === computeSceneSpecSpeechHash(sceneSpec)`。
- `audio.scene_count === sceneSpec.scenes.length`。
- `audio.scene_ids` 与当前 scene id 顺序一致。

任一条件不满足，旧音频不能用于最终渲染。

### 重新生成规则

当音频不匹配但当前 workflow 支持 TTS 时，html-video workflow 自动按当前 `scene_spec` 重新生成旁白，并更新 audio manifest。

当当前操作无法自动 TTS 时，返回中文错误：

```text
当前音频与字幕脚本不一致，请重新生成旁白后再渲染。
```

自动 TTS 的状态文案：

```text
检测到脚本已变化，正在按当前字幕重新生成旁白...
```

## content_graph 绑定规则

默认策略：从 `scene_spec` 派生 `content_graph`。

```text
scene_spec.scenes[]
  -> mapSceneSpecToContentGraph(sceneSpec)
  -> content_graph.nodes[]
```

如果继续使用 AI 生成 `content_graph`，必须通过新增校验：

```js
validateGraphMatchesSceneSpec(graph, sceneSpec)
```

校验规则：

- `graph.nodes.length === sceneSpec.scenes.length`
- `graph.nodes[i].id === sceneSpec.scenes[i].id`，或 `graph.nodes[i].scene_id === sceneSpec.scenes[i].id`
- 不允许新增 scene，例如 `scene_11`
- 不允许缺失 scene，例如少了 `scene_03`
- 不允许改变 scene 顺序
- node 只能提供 `label`、`text`、`data`、`visual_hint`、`frameIntent` 等视觉辅助字段
- node 不能覆盖 `narration_text`、`captions`、`duration` 等脚本字段

校验失败时首版策略采用回退：

```text
AI content_graph 不匹配 scene_spec，已回退为 scene_spec 派生图。
```

如果后续需要严格阻断，可以在开发配置中开启 hard fail。

## frame 构建规则

`buildFramesFromGraph()` 和 `buildRawHtmlFrameProject()` 必须显式绑定 scene：

```js
const sceneId = node.scene_id || node.id;
const scene = scenesById.get(sceneId);
```

找不到 scene 时直接失败，不允许生成空旁白、空字幕的额外 frame。

frame 建议保存：

```js
{
  id: scene.id,
  scene_id: scene.id,
  graph_node_id: node.id,
  order: index + 1,
  duration_sec: scene.duration || node.durationSec,
  narration_text: scene.narration_text,
  captions: scene.captions,
  metadata: {
    graph_node: node,
    scene_snapshot: {
      id: scene.id,
      narration_text: scene.narration_text,
      captions: scene.captions
    }
  }
}
```

`metadata.graph_node` 可用于画面设计和调试，但不能成为旁白和字幕的来源。

## 渲染前一致性门禁

新增校验服务或扩展现有 html-video validation：

```js
validateSceneSpecTimelineConsistency({ sceneSpec, project, audio })
```

检查项：

- `sceneSpec.scenes.length > 0`
- `project.frames.length === sceneSpec.scenes.length`
- 每个 `frame.scene_id` 都存在于 `sceneSpec.scenes`
- 每个 frame 的 `narration_text` 与对应 scene 一致
- 每个 frame 的 `captions` 与对应 scene 一致
- 如果存在 audio，必须通过 `audioMatchesSceneSpec(audio, sceneSpec)`
- 不允许存在没有 scene 的 frame
- 不允许存在重复 `scene_id`

校验结果统一返回诊断：

```js
{
  ok: false,
  diagnostics: [
    {
      code: 'audio_scene_spec_hash_mismatch',
      severity: 'error',
      message: '当前音频与字幕脚本不一致，请重新生成旁白后再渲染。'
    }
  ]
}
```

## 旧 run 策略

项目未上线，不做复杂数据迁移。

旧 run 判定：

- `audio.scene_spec_hash` 缺失
- `project.scene_spec_hash` 缺失
- frame 缺少 `scene_id`
- `content_graph.nodes.length !== scene_spec.scenes.length`

处理策略：

- 查看历史结果时可以继续展示旧文件。
- 一旦用户点击重新渲染、编辑后渲染或继续生成，必须走新校验。
- 缺少 hash 的旧音频不复用，按当前 `scene_spec` 重新生成。
- 不尝试把旧 7 段 audio 自动对齐到新 10 段字幕。

## 数据流

```text
brief.storyboard
  -> scene_spec.scenes
  -> computeSceneSpecSpeechHash
  -> content_graph(scene_spec 派生或 AI graph 校验后使用)
  -> frames(scene_id 绑定)
  -> TTS(scene_spec_hash 绑定)
  -> validateSceneSpecTimelineConsistency
  -> render frames
  -> concat MP4
  -> mux audio
  -> final MP4
```

## 错误与 loading 文案

所有用户可见文案使用中文。

- 正在校验脚本、字幕和音频一致性...
- 检测到脚本已变化，正在按当前字幕重新生成旁白...
- 当前音频与字幕脚本不一致，请重新生成旁白后再渲染。
- 画面帧与字幕脚本不一致，已回退为字幕脚本生成画面结构。
- 画面帧与字幕脚本不一致，无法继续渲染。
- 旁白已按当前字幕重新生成。

## 测试计划

### sceneSpecHash

- 同一 `scene_spec` 多次计算 hash 一致。
- 修改 `narration_text` 后 hash 变化。
- 修改 `captions[].text` 后 hash 变化。
- 修改 scene 顺序后 hash 变化。
- 修改 `visual_text` 后 hash 不变。
- 修改模板字段后 hash 不变。

### audioMatchesSceneSpec

- hash、scene_count、scene_ids 一致时允许复用。
- 缺少 hash 时不允许复用。
- hash 不同不允许复用。
- scene_count 不同不允许复用。
- scene_ids 顺序不同不允许复用。

### content_graph 绑定

- 10 个 scene + 10 个同 id node 校验通过。
- 10 个 scene + 11 个 node 校验失败并回退。
- 10 个 scene + 9 个 node 校验失败并回退。
- node id 顺序与 scene 顺序不同校验失败。
- node 带 `scene_id` 且顺序一致时通过。

### frame 构建

- frame 的 `narration_text` 和 `captions` 来自对应 scene。
- graph 多一个节点时不能生成空字幕 frame。
- graph 缺少 scene 时不能继续生成完整工程。

### workflow 集成

- 旧 7 段 audio + 新 10 段 `scene_spec` 时必须重新 TTS，不能复用旧 wav。
- `scene_spec_hash` 一致时 rerender 允许复用 TTS。
- 编辑字幕后 rerender 必须让旧 TTS 失效。
- 只改视觉模板或 frame style 后 rerender 可复用 TTS。

## 实施边界

本设计应作为一次架构收口完成，不拆成“先临时禁用复用、后补 hash”的半成品路径。最小可接受交付标准：

- `scene_spec_hash` 已落盘。
- 最终音频复用必须通过 hash 校验。
- AI `content_graph` 不得改变 scene 数量和顺序。
- 渲染前一致性门禁能阻断旧 7 段音频混入新 10 段字幕。
- 对应测试覆盖关键错位案例。

如果时间不足，可以暂不做旁白长度反推 frame duration；但不能省略 hash、graph 绑定和渲染门禁。
