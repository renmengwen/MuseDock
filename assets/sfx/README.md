# MuseDock 自动音效素材库

这里存放 MuseDock `html-video` 自动音效增强使用的本地短音效。生成视频时，后端只允许 AI 从 `library.json` 里的白名单 `id` 选择音效；导出时再由 ffmpeg 把启用事件混入最终音轨，不会把音效写进 HTML `<audio>`。

运行方式：

- 设置中心的“自动音效增强”默认开启；关闭“生成旁白音频”时不会编排音效。
- 编排成功后，用到的素材会复制到当前工程的 `audio/sfx/`，事件写入 `project.audio.sfx.events`，并镜像到 `audio/sfx-events.json`。
- 二次编辑器只支持删除/禁用单条音效；重新导出后生效，导出链路仍沿用当前项目行为。
- 素材库、单个素材或混音失败时，视频生成应降级为无音效成片。

来源与授权：

- 素材来源：[Mixkit Free Sound Effects](https://mixkit.co/free-sound-effects/)
- 授权说明：[Mixkit License](https://mixkit.co/license/)
- 当前素材按 Mixkit 页面标注的 Sound Effects Free License 使用；后续公开发布仓库前，应重新确认 Mixkit 最新授权条款是否仍允许随项目分发原始素材文件。

使用约定：

- `library.json` 是唯一索引，AI 只能引用其中的 `id`。
- `file` 必须指向本目录内的相对路径，不能使用外链、绝对路径或逃逸路径。
- 新增素材时必须记录 `source_url`、`license_url`、`commercial_allowed`、`attribution_required`。
- 新增素材后同步跑 `node tests/test-html-video-sfx-library.js`。
- 不要整站镜像素材库，只提交项目生成视频所需的精选短音效。
