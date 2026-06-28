# HTML-Video 画布单页化（Step A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 html-video 二次编辑页从 7 个 tab 收成「画布单页」——画布常驻，字段面板搬进画布右侧栏，源码/草稿/布局检查/AI修改/导出记录改成工具栏按钮+弹框，并把「保存草稿→渲染→接受」三步合并成一个「保存修改」。

**Architecture:** 纯前端重构，后端零改动。复用全部现有面板组件（`FrameInputsPanel` / `ExportsPanel` / `HtmlVideoSourcePanel` 等），只改它们的挂载位置（tab → 右侧栏 / `ui/dialog.jsx` 弹框）。新增一个纯函数 helper 抽出「保存草稿后解析草稿 id」逻辑（画布里现在是内联的），hook 用它把 `saveFrameHtmlDraft` + `acceptFrameDraft` 串成 `saveAndAcceptFrameEdit`。布局检查（前后端删除）属于 Step B，本计划不动。

**Tech Stack:** React (hooks), Radix Dialog (`@/components/ui/dialog`), 纯 `.mjs` 结构化测试（`node tests/run-all.js`）。

---

## File Structure

**新增：**
- `frontend-react/src/components/creative-video-editor/draftResultPayload.mjs` — 纯函数 `resolveSavedDraftId(result, frameId)`，从保存草稿的 API 返回里解析出 `active_draft_id`。画布与 hook 共用，避免重复内联逻辑。
- `tests/test-html-video-draft-result-payload.mjs` — 上面纯函数的单元测试。

**修改：**
- `frontend-react/src/hooks/useHtmlVideoProject.js` — 新增 `saveAndAcceptFrameEdit(frameId, payload)`，并在返回对象里暴露。
- `frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx` — 「保存为草稿/渲染草稿」两个按钮 → 一个「保存修改」（调 `saveAndAcceptFrameEdit`，去掉自动预览渲染）；右侧栏在 inspector 下挂全部字段面板（默认折叠）；内联草稿 id 解析改用 `resolveSavedDraftId`。
- `frontend-react/src/components/creative-video-editor/HtmlVideoElementInspector.jsx` — 「保存为草稿」按钮文案 → 「保存修改」，回调改为 `onSaveEdit`。
- `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx` — 删左侧 `ProjectFramesList`；删 `activeTab` tab 栏；画布常驻；源码/草稿/布局检查/AI修改/导出记录 改成工具栏按钮 + `Dialog` 弹框。
- `tests/test-html-video-editor-components.mjs` — 更新断言以表达新结构（这是本次重构的「规格」，每个 UI 任务先改它再改组件）。

**约束（每个任务都要守）：** 面板组件不得直接调 API（现有测试 line 270-276 会校验）；字幕面板仍走 `frame_patch`；时长仍走 `buildFrameSavePayload`。这些逻辑原样保留，只搬位置。

---

## Task 1: 抽出 `resolveSavedDraftId` 纯函数 + 测试

**Files:**
- Create: `frontend-react/src/components/creative-video-editor/draftResultPayload.mjs`
- Test: `tests/test-html-video-draft-result-payload.mjs`

- [ ] **Step 1: 写失败测试**

`tests/test-html-video-draft-result-payload.mjs`:

```js
import assert from 'node:assert/strict';

const { resolveSavedDraftId } = await import('../frontend-react/src/components/creative-video-editor/draftResultPayload.mjs');

// 从 html_video_project.frames[].active_draft_id 解析
assert.equal(
  resolveSavedDraftId({ html_video_project: { frames: [{ id: 'frame_01', active_draft_id: 'draft_a' }] } }, 'frame_01'),
  'draft_a',
);
// scene_id 也能匹配
assert.equal(
  resolveSavedDraftId({ project: { frames: [{ scene_id: 'scene_02', active_draft_id: 'draft_b' }] } }, 'scene_02'),
  'draft_b',
);
// 嵌套 data.project
assert.equal(
  resolveSavedDraftId({ data: { project: { frames: [{ id: 'frame_03', active_draft_id: 'draft_c' }] } } }, 'frame_03'),
  'draft_c',
);
// 回退到顶层 draft_id / draft.id
assert.equal(resolveSavedDraftId({ draft_id: 'draft_d' }, 'frame_x'), 'draft_d');
assert.equal(resolveSavedDraftId({ draft: { id: 'draft_e' } }, 'frame_x'), 'draft_e');
// 找不到返回空串
assert.equal(resolveSavedDraftId(null, 'frame_x'), '');
assert.equal(resolveSavedDraftId({ html_video_project: { frames: [] } }, 'frame_x'), '');

console.log('html-video draft result payload tests passed');
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/test-html-video-draft-result-payload.mjs`
Expected: FAIL — `Cannot find module .../draftResultPayload.mjs`

- [ ] **Step 3: 写实现**

`frontend-react/src/components/creative-video-editor/draftResultPayload.mjs`:

```js
// 从「保存帧源码草稿」API 返回里解析出刚生成的草稿 id。
// 兼容 html_video_project / project / data.project / data 四种返回形态，
// 再回退到顶层 draft_id / draft.id。找不到返回空串。
export function resolveSavedDraftId(result, frameId) {
  if (!result) return '';
  const project = result.html_video_project || result.project || result.data?.project || result.data;
  const frames = Array.isArray(project?.frames) ? project.frames : [];
  const target = String(frameId || '');
  const frame = frames.find(item => String(item?.id || item?.scene_id || '') === target);
  return frame?.active_draft_id || result.draft_id || result.draft?.id || '';
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node tests/test-html-video-draft-result-payload.mjs`
Expected: PASS — `html-video draft result payload tests passed`

- [ ] **Step 5: 提交**

```bash
git add frontend-react/src/components/creative-video-editor/draftResultPayload.mjs tests/test-html-video-draft-result-payload.mjs
git commit -m "feat: extract resolveSavedDraftId helper for html-video draft save"
```

---

## Task 2: hook 新增 `saveAndAcceptFrameEdit`

**Files:**
- Modify: `frontend-react/src/hooks/useHtmlVideoProject.js`（在 `saveFrameHtmlDraft`/`acceptFrameDraft` 定义之后，约 line 253；以及返回对象约 line 499）
- Test: `tests/test-html-video-editor-components.mjs`（追加结构断言）

- [ ] **Step 1: 先加失败的结构断言**

在 `tests/test-html-video-editor-components.mjs` 的 hook 表面断言块（`hookSurface` 数组，约 line 92-108）里追加一项 `'saveAndAcceptFrameEdit'`，并在文件末尾（`console.log` 之前）追加：

```js
assert.ok(hook.includes('saveAndAcceptFrameEdit'), 'hook should expose saveAndAcceptFrameEdit');
assert.ok(hook.includes('resolveSavedDraftId'), 'hook should resolve the saved draft id before accepting');
assert.ok(hook.includes('保存修改失败'), 'hook should expose a combined save-and-accept failure message');
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/run-all.js html-video-editor-components`
Expected: FAIL — `hook should expose saveAndAcceptFrameEdit`

- [ ] **Step 3: 实现 hook 方法**

在 `useHtmlVideoProject.js` 顶部 import 区加：

```js
import { resolveSavedDraftId } from '../components/creative-video-editor/draftResultPayload.mjs';
```

在 `acceptFrameDraft` 的 `useCallback` 之后插入：

```js
  const saveAndAcceptFrameEdit = useCallback(async (frameId, payload) => {
    // 画布所见即所得：存草稿 + 立即接受，对用户合并成「保存修改」一步。
    const saved = await saveFrameHtmlDraft(frameId, payload);
    if (!saved || saved.success === false) return saved;
    const draftId = resolveSavedDraftId(saved, frameId);
    if (!draftId) {
      setFailure(new Error('保存修改失败：未获取到草稿 id。'), '保存修改失败。');
      return null;
    }
    return acceptFrameDraft(frameId, draftId);
  }, [saveFrameHtmlDraft, acceptFrameDraft, setFailure]);
```

在返回对象里（`saveFrameHtmlDraft,` 一行附近）加：

```js
    saveAndAcceptFrameEdit,
```

- [ ] **Step 4: 运行确认通过**

Run: `node tests/run-all.js html-video-editor-components`
Expected: PASS — `html video editor component tests passed`

- [ ] **Step 5: 提交**

```bash
git add frontend-react/src/hooks/useHtmlVideoProject.js tests/test-html-video-editor-components.mjs
git commit -m "feat: add saveAndAcceptFrameEdit combining draft save + accept"
```

---

## Task 3: 画布「保存修改」单按钮 + 右侧栏挂字段面板

**Files:**
- Modify: `frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx`
- Modify: `frontend-react/src/components/creative-video-editor/HtmlVideoElementInspector.jsx`
- Test: `tests/test-html-video-editor-components.mjs`

- [ ] **Step 1: 先加失败断言**

在 `tests/test-html-video-editor-components.mjs` 末尾追加：

```js
const canvasEditor = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx', 'utf-8');
assert.ok(canvasEditor.includes('保存修改'), 'canvas should expose a single 保存修改 action');
assert.ok(canvasEditor.includes('saveAndAcceptFrameEdit'), 'canvas 保存修改 should call saveAndAcceptFrameEdit');
assert.doesNotMatch(canvasEditor, /保存为草稿/, 'canvas should no longer expose separate 保存为草稿');
assert.ok(canvasEditor.includes('FrameInputsPanel'), 'canvas right rail should mount frame fields');
assert.ok(canvasEditor.includes('CaptionsPanel'), 'canvas right rail should mount captions');
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/run-all.js html-video-editor-components`
Expected: FAIL — `canvas should expose a single 保存修改 action`

- [ ] **Step 3: 改 inspector 按钮文案与回调**

`HtmlVideoElementInspector.jsx`：把 props `onSaveDraft` / `onRenderDraft` / `activeDraftId` 改为单个 `onSaveEdit`，按钮区（约 line 56-62）替换为：

```jsx
          <div className="creative-video-editor-inline-actions">
            <button type="button" disabled={disabled || saving} onClick={onResetPosition}>重置位置</button>
            <button type="button" disabled={disabled || saving} onClick={onSaveEdit}>
              {saving ? '正在保存...' : '保存修改'}
            </button>
          </div>
```

并把函数签名第 1 行的解构参数 `onSaveDraft, onRenderDraft, activeDraftId` 替换为 `onSaveEdit`。

- [ ] **Step 4: 改画布 saveDraft → saveEdit，挂字段面板**

`HtmlVideoCanvasEditor.jsx`：

顶部 import 区加：

```jsx
import { FrameInputsPanel } from './FrameInputsPanel.jsx';
import { TemplateInputsPanel } from './TemplateInputsPanel.jsx';
import { NarrationPanel } from './NarrationPanel.jsx';
import { CaptionsPanel } from './CaptionsPanel.jsx';
import { resolveSavedDraftId } from './draftResultPayload.mjs';
```

把 `saveDraft` 函数（约 line 516-557）整体替换为 `saveEdit`（去掉自动预览渲染，改调 hook 合并方法）：

```jsx
  async function saveEdit() {
    if (saving) return null;
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !frameId) return null;
    setSaving(true);
    setPreviewError('');
    const label = elementInfo?.text || elementInfo?.label || '';
    try {
      const result = await editor.saveAndAcceptFrameEdit(frameId, {
        html: serializeDocument(doc),
        mode: 'draft',
        summary: createDraftSummary(label),
      });
      if (!result || result.success === false) {
        setPreviewError('保存修改失败，请稍后重试。');
        return null;
      }
      return result;
    } catch (_) {
      setPreviewError('保存修改失败，请稍后重试。');
      return null;
    } finally {
      setSaving(false);
    }
  }
```

删除 `renderDraft` 函数（约 line 559-562，不再需要）。

工具栏按钮区（约 line 578-583）替换为：

```jsx
            <div className="creative-video-editor-inline-actions">
              <button type="button" disabled={disabled} onClick={replay}>重新播放</button>
              <button type="button" disabled={disabled} onClick={jumpToEnd}>跳到结尾并编辑</button>
              <button type="button" disabled={disabled || saving || !elementInfo} onClick={saveEdit}>{saving ? '正在保存...' : '保存修改'}</button>
            </div>
```

inspector 调用（约 line 602-612）替换为：

```jsx
        <div className="html-video-canvas-side">
          <HtmlVideoElementInspector
            elementInfo={elementInfo}
            editingReady={editingReady}
            disabled={disabled}
            saving={saving}
            onTextChange={updateSelectedText}
            onResetPosition={resetSelectedPosition}
            onSaveEdit={saveEdit}
          />
          <details className="html-video-canvas-fields">
            <summary>帧字段 / 旁白 / 字幕</summary>
            <FrameInputsPanel frame={frame} disabled={disabled} onSave={editor.saveFrame} onRenderPreview={() => {}} />
            <NarrationPanel narration={editor.project?.narration} disabled={disabled} onSave={editor.saveTemplateInputs} onRegenerate={editor.regenerateNarration} />
            <CaptionsPanel captions={frame?.captions || []} selectedFrameId={frameId} disabled={disabled} onSave={editor.saveFrame} />
            <TemplateInputsPanel schema={editor.project?.template_schema || editor.project?.input_schema || {}} values={editor.project?.inputs || {}} disabled={disabled} onSave={editor.saveTemplateInputs} />
          </details>
        </div>
```

> 注：`<details>` 默认折叠（不写 `open`），常用路径保持清爽；`onRenderPreview` 传空函数因为画布已是所见即所得，不再单独渲染预览。

- [ ] **Step 5: 运行确认通过**

Run: `node tests/run-all.js html-video-editor-components`
Expected: PASS — `html video editor component tests passed`

- [ ] **Step 6: 提交**

```bash
git add frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx frontend-react/src/components/creative-video-editor/HtmlVideoElementInspector.jsx tests/test-html-video-editor-components.mjs
git commit -m "feat: collapse canvas edit into single 保存修改 + inline field panels"
```

---

## Task 4: 主编辑器单页化——删帧列表、tab 改按钮+弹框

**Files:**
- Modify: `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`
- Test: `tests/test-html-video-editor-components.mjs`

- [ ] **Step 1: 改写结构断言（红）**

在 `tests/test-html-video-editor-components.mjs` 中做以下替换：

删除/替换旧 tab 断言（约 line 129-136、170-174、256-260）。把 line 131-136 那段替换为：

```js
// 画布单页化：无 tab 栏，画布常驻，其余面板进弹框
assert.doesNotMatch(editor, /role="tablist"/, 'editor should no longer use a tab bar');
assert.doesNotMatch(editor, /useState\(['"]canvas['"]\)/, 'editor should not track an active tab');
assert.ok(editor.includes('HtmlVideoCanvasEditor'), 'editor should always render the canvas');
assert.ok(editor.includes("from '@/components/ui/dialog'") || editor.includes('ui/dialog'), 'editor should use the shared dialog for secondary panels');
for (const dialogButton of ['源码', '草稿', '布局检查', 'AI 修改', '导出记录']) {
  assert.ok(editor.includes(dialogButton), `editor should expose ${dialogButton} as a dialog button`);
}
assert.doesNotMatch(editor, /ProjectFramesList/, 'editor should drop the left frames list (bottom strip covers selection)');
```

把 line 116-127 的 `componentName` 循环里 `'ProjectFramesList'` 删掉（不再组合它）。同理删除 line 256-260 中对 `ProjectFramesList` / `frames=\{frames\}` 的断言（约 line 258）。

> 这些面板仍被组合（只是进了弹框），所以 line 170-173 对 `HtmlVideoSourcePanel`/`HtmlVideoDraftPanel`/`HtmlVideoQualityPanel`/`HtmlVideoAiEditPanel` 的存在断言保留不动。

- [ ] **Step 2: 运行确认失败**

Run: `node tests/run-all.js html-video-editor-components`
Expected: FAIL — `editor should no longer use a tab bar`

- [ ] **Step 3: 重写 HtmlVideoProjectEditor.jsx**

完整替换为：

```jsx
import { useState } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ExportsPanel } from './ExportsPanel.jsx';
import { HtmlVideoAiEditPanel } from './HtmlVideoAiEditPanel.jsx';
import { HtmlVideoCanvasEditor } from './HtmlVideoCanvasEditor.jsx';
import { HtmlVideoDraftPanel } from './HtmlVideoDraftPanel.jsx';
import { HtmlVideoQualityPanel } from './HtmlVideoQualityPanel.jsx';
import { HtmlVideoSourcePanel } from './HtmlVideoSourcePanel.jsx';
import { NaturalLanguageEditBox } from './NaturalLanguageEditBox.jsx';
import { ProjectStatusBar } from './ProjectStatusBar.jsx';

function PanelDialog({ label, title, children }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button">{label}</button>
      </DialogTrigger>
      <DialogContent className="html-video-panel-dialog">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function HtmlVideoProjectEditor({ editor, onExported }) {
  const disabled = editor.disabled;
  const frames = Array.isArray(editor.frames) ? editor.frames : [];
  const selectedFrame = frames.find(frame => (
    frame.id === editor.selectedFrameId || frame.scene_id === editor.selectedFrameId
  )) || editor.selectedFrame || null;

  async function handleExport(payload) {
    const result = await editor.exportProject(payload);
    if (result) onExported?.(result);
  }

  return (
    <section className="creative-video-editor html-video-project-editor">
      <ProjectStatusBar status={editor.status} message={editor.message} dirtyRequiresRender={editor.dirtyRequiresRender} />
      <div className="creative-video-editor-toolbar">
        <button type="button" disabled={disabled} onClick={editor.load}>重新加载</button>
        <button type="button" disabled={disabled} onClick={() => editor.materializeProject({})}>
          {editor.status === 'materializing' ? '正在重新生成 HTML...' : '重新生成 HTML'}
        </button>
        <PanelDialog label="源码" title="帧源码">
          <HtmlVideoSourcePanel
            frame={selectedFrame}
            html={editor.frameHtml}
            disabled={disabled}
            onLoad={editor.loadFrameHtml}
            onSaveDraft={editor.saveFrameHtmlDraft}
            onRenderDraft={(frameId, draftId) => editor.renderFramePreview(frameId, { draft_id: draftId })}
          />
        </PanelDialog>
        <PanelDialog label="草稿" title="草稿">
          <HtmlVideoDraftPanel
            frame={selectedFrame}
            disabled={disabled}
            onRender={(frameId, draftId) => editor.renderFramePreview(frameId, { draft_id: draftId })}
            onAccept={editor.acceptFrameDraft}
            onDiscard={editor.discardFrameDraft}
          />
        </PanelDialog>
        <PanelDialog label="布局检查" title="布局检查">
          <HtmlVideoQualityPanel
            frame={selectedFrame}
            layoutQa={editor.layoutQa}
            disabled={disabled}
            onInspectFrame={editor.inspectLayout}
            onFixFrame={(frameId) => editor.iterateFrame(frameId, {
              mode: 'layout_fix', preserve_text: true, run_layout_qa: true, render_preview: true,
              instruction: '修复当前帧文字错位、越界或遮挡问题，保留现有文案和整体风格。',
            })}
          />
        </PanelDialog>
        <PanelDialog label="AI 修改" title="AI 修改">
          <HtmlVideoAiEditPanel
            frame={selectedFrame}
            editPlan={editor.editPlan}
            disabled={disabled}
            onIterateFrame={editor.iterateFrame}
            onCreatePlan={editor.createEditPlan}
            onRunPlan={editor.runEditPlan}
            onAcceptPlan={editor.acceptEditPlan}
            onDiscardPlan={editor.discardEditPlan}
          />
        </PanelDialog>
        <PanelDialog label="导出记录" title="导出记录">
          <ExportsPanel
            exportsList={editor.exportsList}
            disabled={disabled}
            exporting={editor.status === 'exporting'}
            onExport={handleExport}
            onRefresh={editor.refreshExports}
            getExportPlaybackUrl={editor.getExportPlaybackUrl}
          />
        </PanelDialog>
        <button type="button" disabled={disabled} onClick={() => handleExport({})}>
          {editor.status === 'exporting' ? '正在导出成片...' : '导出成片'}
        </button>
      </div>
      <NaturalLanguageEditBox
        disabled={disabled}
        editing={editor.status === 'editing'}
        onSubmit={editor.applyNaturalLanguageEdit}
      />
      <div className="html-video-project-layout html-video-project-canvas-layout">
        <HtmlVideoCanvasEditor editor={editor} />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node tests/run-all.js html-video-editor-components`
Expected: PASS — `html video editor component tests passed`

- [ ] **Step 5: 跑一遍相关测试套件确认无回归**

Run: `node tests/run-all.js html-video`
Expected: 全绿（含 `test-html-video-routes` / `test-html-video-api-client` 等）

- [ ] **Step 6: 提交**

```bash
git add frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx tests/test-html-video-editor-components.mjs
git commit -m "feat: collapse html-video editor to single canvas page with dialog panels"
```

---

## Task 5: 人工验收（构建 + 真实任务走查）

**Files:** 无（验证步骤）

- [ ] **Step 1: 前端能构建**

Run: `npm run build:frontend`
Expected: 构建成功，无 import 报错（重点确认 `@/components/ui/dialog` 路径别名在 vite 下解析正常）。

- [ ] **Step 2: 真实任务走查**

启动 `npm run dev`，打开任务 `20260627024202801501` 的二次编辑页，确认：
- 左侧无帧列表，底部缩略条能切帧；
- 拖动第 4 个镜头元素 → 点「保存修改」→ 提示成功（无需再去草稿 tab）；
- 点「导出成片」→ 点「导出记录」弹框 → 新记录可播放（验证 Step A 与之前的导出文件 bug 修复叠加生效）。

- [ ] **Step 3: 无新增提交**（纯验收）

---

## Self-Review

**1. Spec coverage（对照用户 6 点诉求中属于 Step A 的部分）：**
- ① 去掉左侧帧列表 → Task 4（删 `ProjectFramesList`）✓
- ② 只留一个 tab，源码→按钮+弹框 → Task 4（`PanelDialog` 包源码/草稿/布局检查/AI/导出）✓
- ③ 存草稿+渲染+接受→保存修改 → Task 2 + Task 3 ✓
- ④ 字段搬进画布右侧 → Task 3（`<details>` 折叠挂 4 个字段面板）✓
- ⑥ 导出列表按钮+弹框 → Task 4（导出记录 `PanelDialog`）✓
- ⑤ 删布局检查前后端 → **Step B，不在本计划**（本计划仍把布局检查放进弹框过渡）

**2. Placeholder 扫描：** 各步均有完整代码/命令/预期输出；`onRenderPreview={() => {}}` 是刻意空实现并已注释说明，非占位。

**3. 类型一致性：** `resolveSavedDraftId(result, frameId)` 在 Task 1 定义、Task 2 hook 与 Task 3 画布按同签名调用；inspector 的 `onSaveDraft`→`onSaveEdit` 改名在组件定义（Task 3 Step 3）与画布调用（Step 4）两处一致；`saveAndAcceptFrameEdit` 在 hook 定义、返回对象、画布调用三处名字一致。

**4. 已知风险：** `HtmlVideoProjectEditor` 用 `@/components/ui/dialog`（Tailwind 体系），而 creative-video-editor 其余组件用普通 CSS class——弹框样式可能与面板内联样式不完全统一，Task 5 Step 1 的构建 + Step 2 走查覆盖此风险；若样式割裂明显，可在 Step B 一并收口。

---

## Execution Handoff

计划已保存到 `docs/superpowers/plans/2026-06-27-html-video-canvas-single-page.md`。两种执行方式：

1. **Subagent-Driven（推荐）** — 每个 Task 派一个全新 subagent 实现，任务之间我来 review，迭代快。
2. **Inline 执行** — 在当前会话里用 executing-plans 批量执行，带检查点。

选哪个？
