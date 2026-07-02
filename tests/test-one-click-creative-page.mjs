import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, '../frontend-react/src/pages/OneClickCreativePage.jsx');
const creativeDisplayPath = path.join(__dirname, '../frontend-react/src/components/creative/creativeDisplay.js');
const creativeSidebarPath = path.join(__dirname, '../frontend-react/src/components/creative/CreativeSidebar.jsx');
const creativeComposerPath = path.join(__dirname, '../frontend-react/src/components/creative/CreativeComposer.jsx');
const creativeStatusMessagePath = path.join(__dirname, '../frontend-react/src/components/creative/CreativeStatusMessage.jsx');
const creativeWorkflowStepperPath = path.join(__dirname, '../frontend-react/src/components/creative/CreativeWorkflowStepper.jsx');
const creativeProgressPanelPath = path.join(__dirname, '../frontend-react/src/components/creative/CreativeProgressPanel.jsx');
const creativeVideoPreviewPath = path.join(__dirname, '../frontend-react/src/components/creative/CreativeVideoPreview.jsx');
const creativeTaskDetailPath = path.join(__dirname, '../frontend-react/src/components/creative/CreativeTaskDetail.jsx');
const appPath = path.join(__dirname, '../frontend-react/src/App.jsx');
const shellPath = path.join(__dirname, '../frontend-react/src/components/AppShell.jsx');
const stylesPath = path.join(__dirname, '../frontend-react/src/styles.css');

function textFromCodePoints(points) {
  return String.fromCodePoint(...points);
}

const zh = {
  creativeTitle: textFromCodePoints([0x4e00, 0x952e, 0x521b, 0x4f5c]),
  newTask: textFromCodePoints([0x5f00, 0x542f, 0x65b0, 0x521b, 0x4f5c]),
  taskList: textFromCodePoints([0x521b, 0x4f5c, 0x4efb, 0x52a1]),
  quickMode: textFromCodePoints([0x5feb, 0x901f, 0x6a21, 0x5f0f]),
  expertMode: textFromCodePoints([0x4e13, 0x5bb6, 0x6a21, 0x5f0f]),
  settings: textFromCodePoints([0x8bbe, 0x7f6e]),
  expertDeveloping: textFromCodePoints([0x4e13, 0x5bb6, 0x6a21, 0x5f0f, 0x6b63, 0x5728, 0x5f00, 0x53d1, 0x4e2d]),
  taskDetail: textFromCodePoints([0x4efb, 0x52a1, 0x8be6, 0x60c5]),
  currentTask: textFromCodePoints([0x5f53, 0x524d, 0x4efb, 0x52a1]),
  inputLabel: '输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接',
  researchToggle: textFromCodePoints([0x8054, 0x7f51, 0x83b7, 0x53d6, 0x6700, 0x65b0, 0x8d44, 0x6599]),
  assetNotice: textFromCodePoints([0x56fe, 0x7247, 0x7d20, 0x6750, 0x5c06, 0x5728, 0x4e0b, 0x4e00, 0x9636, 0x6bb5, 0x5f00, 0x653e]),
  submitButton: textFromCodePoints([0x4e00, 0x952e, 0x751f, 0x6210, 0x89c6, 0x9891]),
  creatingMessage: textFromCodePoints([0x6b63, 0x5728, 0x521b, 0x5efa, 0x521b, 0x4f5c, 0x4efb, 0x52a1, 0x2e, 0x2e, 0x2e]),
  emptyInputMessage: '请输入视频方向、抖音链接、文章链接或 GitHub 仓库链接',
  chatGreeting: textFromCodePoints([0x563f, 0xff0c, 0x4eca, 0x5929, 0x6211, 0x4eec, 0x6765, 0x505a, 0x70b9, 0x4ec0, 0x4e48, 0xff1f]),
  creativeInputPlaceholder: '粘贴文章/GitHub 链接，或输入你想生成的视频方向',
  sourceStage: textFromCodePoints([0x51c6, 0x5907, 0x6765, 0x6e90, 0x8d44, 0x6599]),
  researchStage: textFromCodePoints([0x8054, 0x7f51, 0x7814, 0x7a76]),
  assetsStage: textFromCodePoints([0x7d20, 0x6750, 0x5206, 0x6790]),
  directorStage: textFromCodePoints([0x5bfc, 0x6f14, 0x6539, 0x5199]),
  briefStage: textFromCodePoints([0x6210, 0x7247, 0x7b56, 0x5212]),
  audioStage: textFromCodePoints([0x751f, 0x6210, 0x97f3, 0x9891, 0x8f68]),
  projectStage: textFromCodePoints([0x751f, 0x6210, 0x5de5, 0x7a0b]),
  checkStage: textFromCodePoints([0x6821, 0x9a8c, 0x5de5, 0x7a0b]),
  renderStage: textFromCodePoints([0x6e32, 0x67d3, 0x89c6, 0x9891]),
  inspectStage: textFromCodePoints([0x5de1, 0x68c0, 0x89c6, 0x9891]),
  waiting: textFromCodePoints([0x7b49, 0x5f85, 0x4e2d]),
  queued: textFromCodePoints([0x6392, 0x961f, 0x4e2d]),
  running: textFromCodePoints([0x8fdb, 0x884c, 0x4e2d]),
  done: textFromCodePoints([0x5df2, 0x5b8c, 0x6210]),
  skipped: textFromCodePoints([0x5df2, 0x8df3, 0x8fc7]),
  failed: textFromCodePoints([0x5931, 0x8d25]),
  stopAndDelete: textFromCodePoints([0x505c, 0x6b62, 0x5e76, 0x5220, 0x9664]),
  stoppingAndDeleting: textFromCodePoints([0x6b63, 0x5728, 0x505c, 0x6b62, 0x5e76, 0x5220, 0x9664, 0x4efb, 0x52a1, 0x2e, 0x2e, 0x2e]),
  continueEdit: textFromCodePoints([0x7ee7, 0x7eed, 0x7f16, 0x8f91]),
  viewPrompt: textFromCodePoints([0x67e5, 0x770b, 0x63d0, 0x793a, 0x8bcd]),
  promptModalTitle: textFromCodePoints([0x5f53, 0x524d, 0x4efb, 0x52a1, 0x63d0, 0x793a, 0x8bcd]),
  promptEmpty: textFromCodePoints([0x6682, 0x65e0, 0x53ef, 0x663e, 0x793a, 0x7684, 0x63d0, 0x793a, 0x8bcd]),
};

assert.ok(fs.existsSync(pagePath), 'missing page frontend-react/src/pages/OneClickCreativePage.jsx');
assert.ok(fs.existsSync(creativeDisplayPath), 'creative display helpers should be extracted');
for (const componentPath of [
  '../frontend-react/src/components/creative/CreativeSidebar.jsx',
  '../frontend-react/src/components/creative/CreativeComposer.jsx',
  '../frontend-react/src/components/creative/CreativeStatusMessage.jsx',
  '../frontend-react/src/components/creative/CreativeWorkflowStepper.jsx',
  '../frontend-react/src/components/creative/CreativeProgressPanel.jsx',
  '../frontend-react/src/components/creative/CreativeVideoPreview.jsx',
  '../frontend-react/src/components/creative/CreativeTaskDetail.jsx',
]) {
  assert.ok(fs.existsSync(path.join(__dirname, componentPath)), `${componentPath} should exist`);
}

const page = fs.readFileSync(pagePath, 'utf-8');
const creativeDisplay = fs.readFileSync(creativeDisplayPath, 'utf-8');
const creativeSidebar = fs.readFileSync(creativeSidebarPath, 'utf-8');
const creativeComposer = fs.readFileSync(creativeComposerPath, 'utf-8');
const creativeStatusMessage = fs.readFileSync(creativeStatusMessagePath, 'utf-8');
const creativeWorkflowStepper = fs.readFileSync(creativeWorkflowStepperPath, 'utf-8');
const creativeProgressPanel = fs.readFileSync(creativeProgressPanelPath, 'utf-8');
const creativeVideoPreview = fs.readFileSync(creativeVideoPreviewPath, 'utf-8');
const creativeTaskDetail = fs.readFileSync(creativeTaskDetailPath, 'utf-8');
const app = fs.readFileSync(appPath, 'utf-8');
const shell = fs.readFileSync(shellPath, 'utf-8');
const styles = fs.readFileSync(stylesPath, 'utf-8');
const creativeVideoEditorImportPattern =
  /import\s+(?:\{[\s\S]*?\bCreativeVideoEditor\b[\s\S]*?\}|CreativeVideoEditor\b|[A-Za-z_$][\w$]*\s*,\s*\{[\s\S]*?\bCreativeVideoEditor\b[\s\S]*?\})\s+from\s+['"][^'"]+['"]/;

for (const text of [
  zh.creatingMessage,
  zh.emptyInputMessage,
]) {
  assert.ok(page.includes(text), `OneClickCreativePage.jsx should include normal Chinese text: ${text}`);
}

for (const text of [
  zh.stopAndDelete,
  zh.viewPrompt,
  zh.promptModalTitle,
  zh.promptEmpty,
  '关闭提示词弹框',
  '复制提示词',
  '已复制',
  '复制失败',
  '缺少创作任务 ID，无法进入编辑器。',
  '视频标题',
  '备选标题',
]) {
  assert.ok(creativeTaskDetail.includes(text), `CreativeTaskDetail.jsx should include normal Chinese text: ${text}`);
}

for (const text of [
  zh.continueEdit,
]) {
  assert.ok(creativeVideoPreview.includes(text), `CreativeVideoPreview.jsx should include normal Chinese text: ${text}`);
}

for (const text of [
  zh.creativeTitle,
  zh.newTask,
  zh.taskList,
  '搜索创作任务',
  '输入关键词搜索任务',
  '没有匹配的任务。',
]) {
  assert.ok(creativeSidebar.includes(text), `CreativeSidebar.jsx should include normal Chinese text: ${text}`);
}

for (const text of [
  zh.quickMode,
  zh.expertMode,
  zh.expertDeveloping,
  zh.inputLabel,
  zh.researchToggle,
  zh.submitButton,
  zh.chatGreeting,
  zh.creativeInputPlaceholder,
]) {
  assert.ok(creativeComposer.includes(text), `CreativeComposer.jsx should include normal Chinese text: ${text}`);
}

assert.match(creativeComposer, /输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接/);
assert.match(creativeComposer, /粘贴文章\/GitHub 链接，或输入你想生成的视频方向/);
assert.match(page, /请输入视频方向、抖音链接、文章链接或 GitHub 仓库链接/);

assert.doesNotMatch(page, /输入视频方向、抖音 ID 或抖音链接/);
assert.doesNotMatch(page, /在这里输入你的创意/);
assert.doesNotMatch(page, /请输入视频方向、抖音 ID 或抖音链接/);

for (const text of [
  zh.sourceStage,
  zh.researchStage,
  zh.assetsStage,
  zh.directorStage,
  zh.briefStage,
  zh.audioStage,
  zh.projectStage,
  zh.checkStage,
  zh.renderStage,
  zh.inspectStage,
  zh.waiting,
  zh.queued,
  zh.running,
  zh.done,
  zh.skipped,
  zh.failed,
]) {
  assert.ok(creativeDisplay.includes(text), `creativeDisplay.js should keep workflow text readable: ${text}`);
}

for (const mojibake of ['涓€閿', '鑱旂綉', '鍥剧墖', '姝ｅ湪', '璇疯緭']) {
  assert.ok(!page.includes(mojibake), `OneClickCreativePage.jsx should not contain mojibake text: ${mojibake}`);
  assert.ok(!creativeSidebar.includes(mojibake), `CreativeSidebar.jsx should not contain mojibake text: ${mojibake}`);
  assert.ok(!creativeComposer.includes(mojibake), `CreativeComposer.jsx should not contain mojibake text: ${mojibake}`);
}

for (const symbol of [
  'OneClickCreativePage',
]) {
  assert.match(page, new RegExp(`function\\s+${symbol}\\s*\\(`), `OneClickCreativePage.jsx should define ${symbol}`);
}

for (const symbol of [
  'CreativeHeroHeader',
  'CreativeModeSwitch',
  'CreativePromptComposer',
  'CreativeInputForm',
]) {
  assert.match(creativeComposer, new RegExp(`function\\s+${symbol}\\s*\\(`), `CreativeComposer.jsx should define ${symbol}`);
}

assert.match(page, /createCreativeWorkflow/, 'OneClickCreativePage should create creative workflows');
assert.match(page, /sidebarCollapsed \? 'sidebarCollapsed grid-cols-\[76px_minmax\(0,1fr\)\]'/, 'Collapsed sidebar should add the CSS marker expected by creativeChatShell styles');
assert.match(page, /import\s+\{\s*CreativeTaskDetail\s*\}\s+from\s+['"]\.\.\/components\/creative\/CreativeTaskDetail\.jsx['"]/, 'OneClickCreativePage should import extracted CreativeTaskDetail');
assert.doesNotMatch(page, /function\s+CreativeTaskDetail\s*\(/, 'OneClickCreativePage should not define CreativeTaskDetail locally');
assert.doesNotMatch(page, /function\s+CreativeVideoPreview\s*\(/, 'OneClickCreativePage should not define CreativeVideoPreview locally');
assert.doesNotMatch(page, /function\s+WorkflowStepProgress\s*\(/, 'OneClickCreativePage should not define WorkflowStepProgress locally');
assert.doesNotMatch(page, /\bEye\b/, 'OneClickCreativePage should not import or use Eye after detail extraction');
assert.doesNotMatch(page, /\bX\b/, 'OneClickCreativePage should not import or use X after dialog extraction');
assert.ok(
  !page.includes("from '../components/creative-video-editor/CreativeVideoEditor.jsx'"),
  'OneClickCreativePage should not import CreativeVideoEditor',
);
assert.doesNotMatch(page, creativeVideoEditorImportPattern, 'OneClickCreativePage should not import CreativeVideoEditor from any path');
assert.ok(!page.includes('<CreativeVideoEditor'), 'OneClickCreativePage should not render CreativeVideoEditor');
assert.doesNotMatch(page, /editorOpen/, 'OneClickCreativePage should not track editor open state');
assert.match(page, /continueEdit/, 'OneClickCreativePage should expose a continue edit action');
assert.ok(page.includes('navigate(`/editor/${encodeURIComponent(id)}`)'), 'Continue edit should navigate to the editor route');
assert.match(
  creativeTaskDetail,
  /const\s+editableWorkflowId\s*=\s*workflowId\s*\|\|\s*workflow\?\.workflow_id\s*\|\|\s*workflow\?\.id\s*\|\|\s*''/,
  'Creative task detail should fall back to workflow IDs when the prop workflowId is missing',
);
assert.match(creativeTaskDetail, /onContinueEdit\?\.\(editableWorkflowId\)/, 'Creative task detail should continue editing with the editable workflow ID');
assert.match(page, /getCreativeWorkflow/, 'OneClickCreativePage should poll creative workflows');
assert.match(page, /stopAndDeleteTask/, 'OneClickCreativePage should expose a stop-and-delete action for the current task');
assert.match(page, /onStopAndDelete=\{stopAndDeleteTask\}/, 'Creative task detail should receive the current task stop-and-delete handler');
assert.match(page, /getWorkflowVideoUrl=\{getWorkflowVideoUrl\}/, 'Creative task detail should receive the workflow video URL resolver');
assert.match(creativeTaskDetail, /onStopAndDelete\(workflowId\)/, 'Creative task detail stop button should delete the currently opened task');
assert.match(creativeTaskDetail, /disabled=\{deletingWorkflowId === workflowId\}/, 'Current task stop-and-delete button should be disabled while deleting');
assert.match(creativeTaskDetail, /const\s+promptText\s*=\s*workflow\?\.creative_context\?\.input\?\.raw_text/, 'Creative task detail should read the original user prompt from workflow.creative_context.input.raw_text');
assert.match(creativeTaskDetail, /function\s+getWorkflowTitleInfo\(workflow\)/, 'Creative task detail should derive generated title data from the workflow scene spec');
assert.match(creativeTaskDetail, /title_candidates/, 'Creative task detail should read generated title candidates');
assert.match(creativeTaskDetail, /<CreativeTitlePanel workflow=\{workflow\} \/>[\s\S]*<CreativeWorkflowStepper workflow=\{workflow\} \/>/, 'Generated video titles should sit between the task meta row and workflow stepper');
assert.match(creativeTaskDetail, /const\s+\[promptModalOpen,\s*setPromptModalOpen\]\s*=\s*useState\(false\)/, 'Creative task detail should track whether the prompt modal is open');
assert.match(creativeTaskDetail, /className="creativePromptViewButton"/, 'Creative task detail should render a prompt viewing button beside task actions');
assert.match(creativeTaskDetail, /<Dialog\s+open=\{promptModalOpen\}\s+onOpenChange=\{setPromptModalOpen\}>/, 'Prompt modal should use shadcn Dialog state');
assert.match(creativeTaskDetail, /<DialogTrigger asChild>/, 'Prompt view button should be the shadcn Dialog trigger');
assert.match(creativeTaskDetail, /DialogClose/, 'Prompt modal should import and render DialogClose for a localized close button');
assert.match(creativeTaskDetail, /<DialogContent className="creativePromptModal" showCloseButton=\{false\}>[\s\S]*<DialogTitle>当前任务提示词<\/DialogTitle>/, 'Prompt modal should disable the default English shadcn close button and render a Chinese title');
assert.match(creativeTaskDetail, /<DialogClose asChild>[\s\S]*aria-label="关闭提示词弹框"[\s\S]*<span className="sr-only">关闭提示词弹框<\/span>/, 'Prompt modal close button should use a Chinese accessible label and sr-only text');
assert.match(creativeTaskDetail, /<pre className="creativePromptModalText">\{promptText \|\| '暂无可显示的提示词。'\}<\/pre>/, 'Prompt modal should show the original prompt with a Chinese empty state');
assert.doesNotMatch(creativeTaskDetail, /creativePromptModalOverlay/, 'CreativeTaskDetail should not render the old hand-written prompt modal overlay');
assert.doesNotMatch(creativeTaskDetail, /role="dialog"[\s\S]*aria-modal="true"/, 'CreativeTaskDetail should rely on shadcn Dialog accessibility instead of a hand-written dialog');
assert.match(page, /setInterval/, 'OneClickCreativePage should poll with setInterval');
assert.match(page, /ACTIVE_CREATIVE_TASK_STORAGE_KEY/, 'OneClickCreativePage should persist active creative task stream state');
assert.match(page, /streamCreativeWorkflowEvents/, 'OneClickCreativePage should subscribe to creative workflow event stream');
assert.match(page, /lastSeqRef/, 'OneClickCreativePage should track last received task event sequence');
assert.match(page, /activeTaskRef/, 'OneClickCreativePage should compare stream events against the active task ref');
assert.match(page, /import\s+\{[^}]*useCallback[^}]*\}\s+from ['"]react['"]/, 'OneClickCreativePage should import useCallback for stable stream callbacks');
assert.match(page, /loadActiveCreativeTask/, 'OneClickCreativePage should recover active stream state after refresh');
assert.match(page, /task_stream_closed/, 'OneClickCreativePage should stop reconnecting when stream closes normally');
assert.match(page, /streamClosedNormallyRef/, 'OneClickCreativePage should distinguish normal stream closure from errors');
assert.match(page, /since_seq/, 'OneClickCreativePage should reconnect with since_seq');
assert.match(page, /window\.setTimeout/, 'OneClickCreativePage should schedule SSE reconnects');
assert.match(page, /const\s+(fetchFinalWorkflow|refreshFinalWorkflow)\s*=\s*useCallback\(\s*async\s*\(/, 'OneClickCreativePage should define a stable final workflow refresh helper');
assert.match(page, /(fetchFinalWorkflow|refreshFinalWorkflow)\(\{[\s\S]*workflowId:[\s\S]*event\.workflow_id[\s\S]*taskId:[\s\S]*event\.task_id[\s\S]*generation:/, 'Terminal task events should trigger a guarded final workflow refresh');
assert.match(page, /task_stream_closed[\s\S]*(fetchFinalWorkflow|refreshFinalWorkflow)\(\{[\s\S]*status:[\s\S]*event\.status/, 'task_stream_closed should trigger final refresh for terminal done or failed statuses');
assert.match(page, /const json = await api\.getCreativeWorkflow\(targetWorkflowId\);[\s\S]*persistTasks\(prev => updateTask\(prev, \{/, 'Final workflow refresh should fetch the current workflow and update the final task snapshot without reordering the sidebar');
assert.match(page, /finalWorkflowRefreshRef/, 'Final workflow refresh should keep a ref token for dedupe and stale guards');
assert.match(page, /finalWorkflowRefreshRef\.current[\s\S]*(started|inFlight)[\s\S]*(settled|completed)/, 'Final workflow refresh should remember in-flight and settled identity keys to avoid duplicate fetches');
assert.match(page, /const\s+refreshKey\s*=[\s\S]*targetWorkflowId[\s\S]*expectedTaskId/, 'Final workflow refresh should dedupe by workflow and task identity');
assert.match(page, /if\s*\(finalWorkflowRefreshRef\.current\?\.key === refreshKey[\s\S]*return;/, 'Final workflow refresh should skip duplicate terminal and stream-closed refreshes for the same task');
assert.match(page, /streamGenerationRef\.current !== expectedGeneration/, 'Final workflow refresh should guard against stale stream generations');
assert.match(page, /activeTaskRef\.current\?\.workflow_id[\s\S]*targetWorkflowId[\s\S]*activeTaskRef\.current\?\.task_id[\s\S]*expectedTaskId/, 'Final workflow refresh should guard against stale active workflow and task ids');
assert.match(page, /expectedIdentityRef|finalWorkflowIdentityRef|expectedWorkflowId/, 'Final workflow refresh should preserve expected workflow/task identity independently of activeTaskRef');
assert.match(page, /finalWorkflowRefreshRef\.current\?\.key !== refreshKey/, 'Final workflow refresh should allow the same terminal token to settle after stopTaskStream clears activeTaskRef, while blocking stale tasks');
assert.match(page, /currentWorkflowRef\.current[\s\S]*targetWorkflowId/, 'Final workflow refresh should guard against stale selected or routed workflow ids');
const finalRefreshStart = page.indexOf('const fetchFinalWorkflow');
const applyTaskEventStart = page.indexOf('const applyTaskEvent', finalRefreshStart);
assert.ok(finalRefreshStart > 0 && applyTaskEventStart > finalRefreshStart, 'OneClickCreativePage should define final refresh before task event handling');
const finalRefreshBlock = page.slice(finalRefreshStart, applyTaskEventStart);
assert.doesNotMatch(finalRefreshBlock, /streamGenerationRef\.current !== expectedGeneration\s*&&\s*activeTaskRef\.current/, 'Final workflow refresh should not allow generation mismatch only because activeTaskRef was cleared');
assert.match(finalRefreshBlock, /const\s+hasClosedGeneration\s*=[\s\S]*closedGeneration\s*!==\s*null[\s\S]*closedGeneration\s*!==\s*undefined[\s\S]*Number\.isFinite\(Number\(closedGeneration\)\)/, 'Final workflow refresh should explicitly check closedGeneration before numeric conversion');
assert.doesNotMatch(finalRefreshBlock, /const\s+terminalGeneration\s*=\s*Number\.isFinite\(Number\(closedGeneration\)\)/, 'Final workflow refresh should not treat Number(null) as a valid closed generation');
assert.match(finalRefreshBlock, /const\s+activeWorkflowMatches\s*=\s*activeTaskRef\.current\?\.workflow_id\s*===\s*targetWorkflowId/, 'Final workflow refresh should detect when the active task still belongs to the target workflow');
assert.match(finalRefreshBlock, /const\s+activeTaskMatches\s*=\s*!expectedTaskId\s*\|\|\s*activeTaskRef\.current\?\.task_id\s*===\s*expectedTaskId/, 'Final workflow refresh should detect when the active task still matches the terminal task');
assert.match(finalRefreshBlock, /const\s+isSameActiveTaskGeneration\s*=\s*activeWorkflowMatches\s*&&\s*activeTaskMatches/, 'Final workflow refresh should allow the same active task to settle across abnormal SSE reconnect generations');
assert.match(finalRefreshBlock, /streamGenerationRef\.current\s*!==\s*expectedGeneration\s*&&\s*!\(isAllowedClosedGeneration\s*\|\|\s*isSameActiveTaskGeneration\)/, 'Final workflow refresh generation mismatch should allow closed-stream or same-active-task terminal fetches');
assert.doesNotMatch(finalRefreshBlock, /streamGenerationRef\.current\s*!==\s*expectedGeneration\s*&&\s*!isAllowedClosedGeneration/, 'Final workflow refresh generation mismatch should not only allow stream-closed tokens');
assert.match(finalRefreshBlock, /finalWorkflowRefreshRef\.current\s*=\s*\{[\s\S]*(closedGeneration|terminalGeneration|allowClosedGeneration|closedByStream)/, 'Final workflow refresh token should record a stream-closed generation allowance for the same terminal task');
const initialFinalRefreshTokenBlock = finalRefreshBlock.slice(0, finalRefreshBlock.indexOf('const isStaleFinalFetch'));
assert.doesNotMatch(initialFinalRefreshTokenBlock, /started:\s*true/, 'Final workflow refresh should not reserve a started token before stale guards run');
assert.doesNotMatch(initialFinalRefreshTokenBlock, /inFlight:\s*true/, 'Final workflow refresh should not reserve an in-flight token before stale guards run');
assert.match(finalRefreshBlock, /if\s*\(finalWorkflowRefreshRef\.current\?\.key === refreshKey[\s\S]*(inFlight|settled)[\s\S]*return;/, 'Final workflow refresh duplicate guard should only skip in-flight or settled terminal refreshes');
assert.doesNotMatch(finalRefreshBlock, /if\s*\(finalWorkflowRefreshRef\.current\?\.key === refreshKey[\s\S]*started[\s\S]*return;/, 'Final workflow refresh duplicate guard should not skip because of a request-before-stale reserved token');
assert.match(finalRefreshBlock, /if\s*\(isStaleFinalFetch\(\)\)\s*\{[\s\S]*(finalWorkflowRefreshRef\.current\s*=\s*null|inFlight:\s*false)[\s\S]*return;[\s\S]*\}[\s\S]*const json = await api\.getCreativeWorkflow\(targetWorkflowId\);/, 'Final workflow refresh should clear or downgrade the token when stale before the request starts');
assert.match(finalRefreshBlock, /inFlight:\s*true[\s\S]*const json = await api\.getCreativeWorkflow\(targetWorkflowId\);/, 'Final workflow refresh should mark the token in-flight when the workflow request is actually being issued');
assert.doesNotMatch(finalRefreshBlock, /Boolean\(currentWorkflowId\s*&&\s*currentWorkflowId !== targetWorkflowId\)/, 'Final workflow refresh should treat an empty current workflow context as stale instead of allowing UI writes');
assert.match(finalRefreshBlock, /if\s*\(!currentWorkflowId\)\s*return\s+!(isClosedTerminalRefresh|allowClosedGeneration|closedByStream|isAllowedClosedGeneration)/, 'Final workflow refresh should only allow an empty current workflow context for the same stream-closed terminal token');
assert.doesNotMatch(finalRefreshBlock, /setMessage\(fallbackMessage/, 'Final workflow refresh catch should not surface raw SSE terminal messages as fallback copy');
assert.match(finalRefreshBlock, /catch\s*\{[\s\S]*setMessage\('终态详情暂时未刷新，请稍后重新打开任务。'\)/, 'Final workflow refresh catch should use a fixed Chinese fallback message');
const onCloseStart = page.indexOf('onClose: () => {');
const onErrorStart = page.indexOf('onError: () => {', onCloseStart);
assert.ok(onCloseStart > 0 && onErrorStart > onCloseStart, 'OneClickCreativePage should define adjacent SSE onClose and onError handlers');
const onCloseBlock = page.slice(onCloseStart, onErrorStart);
assert.ok(onCloseBlock.includes('if (streamGenerationRef.current !== streamGeneration) return;'), 'SSE onClose should ignore stale stream generations');
assert.ok(onCloseBlock.includes('activeStreamRef.current = null;'), 'SSE onClose should clear the active stream ref');
assert.ok(onCloseBlock.includes('if (streamClosedNormallyRef.current) return;'), 'SSE onClose should not reconnect after task_stream_closed or manual stop');
assert.match(onCloseBlock, /reconnectTimerRef\.current = window\.setTimeout\(\(\) => \{[\s\S]*if \(streamGenerationRef\.current !== streamGeneration\) return;[\s\S]*subscribeTaskEvents\(nextTask\);[\s\S]*\}, 1500\);/, 'SSE onClose should reconnect the same task after abnormal EOF while preserving generation guard');
assert.match(page, /const\s+stopTaskStream\s*=\s*useCallback\(\(\{ clearStorage = false \} = \{\}\) => \{/, 'OneClickCreativePage should centralize task stream cleanup in a stable callback');
assert.match(page, /const\s+applyTaskEvent\s*=\s*useCallback\(\(event\) => \{/, 'OneClickCreativePage should apply task events through a stable callback');
const applyTaskEventStartIndex = page.indexOf('const applyTaskEvent = useCallback((event) => {');
const normalizedPage = page.replace(/\r\n/g, '\n');
const normalizedApplyTaskEventStartIndex = normalizedPage.indexOf('const applyTaskEvent = useCallback((event) => {');
const applyTaskEventEndIndex = normalizedPage.indexOf('useEffect(() => {\n    currentWorkflowRef.current', normalizedApplyTaskEventStartIndex);
assert.ok(normalizedApplyTaskEventStartIndex > 0 && applyTaskEventEndIndex > normalizedApplyTaskEventStartIndex, 'OneClickCreativePage should define applyTaskEvent before currentWorkflowRef sync effect');
const applyTaskEventBlock = normalizedPage.slice(normalizedApplyTaskEventStartIndex, applyTaskEventEndIndex);
assert.match(applyTaskEventBlock, /currentWorkflowRef\.current/, 'applyTaskEvent should read the latest workflow context from currentWorkflowRef before writing UI state');
assert.doesNotMatch(applyTaskEventBlock, /const\s+currentWorkflowId\s*=\s*routeWorkflowId\s*\|\|\s*workflowId\s*\|\|\s*selectedWorkflowId/, 'applyTaskEvent should not compute currentWorkflowId from stale route/workflow closure state');
const applyTaskEventDependencyMatch = applyTaskEventBlock.match(/\},\s*\[([^\]]*)\]\);/);
assert.ok(applyTaskEventDependencyMatch, 'applyTaskEvent should declare a dependency array');
assert.doesNotMatch(applyTaskEventDependencyMatch[1], /\b(routeWorkflowId|workflowId|selectedWorkflowId)\b/, 'applyTaskEvent dependency array should not re-add workflow route state to mask stale closures');
assert.match(page, /const\s+subscribeTaskEvents\s*=\s*useCallback\(\(nextTask,\s*\{ sinceSeq \} = \{\}\) => \{/, 'OneClickCreativePage should subscribe to task events through a stable callback');
assert.match(page, /const expectedTaskId = activeTaskRef\.current\?\.task_id/, 'OneClickCreativePage should compare event task id against active task ref');
assert.match(page, /event\.task_id && expectedTaskId && event\.task_id !== expectedTaskId/, 'OneClickCreativePage should ignore stream events from stale task ids');
assert.match(page, /activeTaskRef\.current\?\.workflow_id === nextTask\.workflow_id[\s\S]*activeTaskRef\.current\?\.task_id === nextTask\.task_id/, 'OneClickCreativePage should use activeTaskRef for duplicate subscription checks');
assert.doesNotMatch(page, /activeTask\?\.task_id === nextTask\.task_id/, 'OneClickCreativePage should not use stale activeTask state for duplicate subscription checks');
const deletedBranchStart = page.indexOf("if (event.status === 'deleted')");
const applyTaskEventEnd = page.indexOf('}, [fetchFinalWorkflow', deletedBranchStart);
assert.ok(deletedBranchStart > 0 && applyTaskEventEnd > deletedBranchStart, 'OneClickCreativePage should handle deleted stream close events');
const deletedBranchBlock = page.slice(deletedBranchStart, applyTaskEventEnd);
assert.doesNotMatch(deletedBranchBlock, /fetchFinalWorkflow|refreshFinalWorkflow/, 'Deleted stream close should not fetch a deleted workflow');
assert.match(deletedBranchBlock, /setWorkflowId\(''\)/, 'Deleted stream close should clear workflowId state');
assert.match(deletedBranchBlock, /setSelectedWorkflowId\(''\)/, 'Deleted stream close should clear selectedWorkflowId state');
assert.match(deletedBranchBlock, /navigate\('\/creative'\)/, 'Deleted stream close should navigate detail routes back to /creative');
assert.doesNotMatch(deletedBranchBlock, /if\s*\(\s*routeWorkflowId\s*\)\s*navigate\('\/creative'\)/, 'Deleted stream close navigation should not depend on a stale routeWorkflowId closure');
assert.match(page, /function selectTask\(task\) \{[\s\S]*stopTaskStream\(\{ clearStorage: true \}\)/, 'Selecting another task should stop the previous task stream');
assert.match(page, /saveActiveCreativeTask\(null\)/, 'Normal close and stop paths should clear active task stream storage');
const loadActiveStart = page.indexOf('function loadActiveCreativeTask() {');
const upsertTaskStart = page.indexOf('function upsertTask', loadActiveStart);
assert.ok(loadActiveStart > 0 && upsertTaskStart > loadActiveStart, 'OneClickCreativePage should define loadActiveCreativeTask before upsertTask');
const loadActiveBlock = page.slice(loadActiveStart, upsertTaskStart);
assert.match(loadActiveBlock, /window\.localStorage\.removeItem\(ACTIVE_CREATIVE_TASK_STORAGE_KEY\);[\s\S]*return null;/, 'loadActiveCreativeTask should delete invalid active task storage values');
assert.match(loadActiveBlock, /catch\s*\{[\s\S]*window\.localStorage\.removeItem\(ACTIVE_CREATIVE_TASK_STORAGE_KEY\);[\s\S]*return null;[\s\S]*\}/, 'loadActiveCreativeTask should delete active task storage when JSON parsing fails');
assert.match(page, /function\s+normalizeLastSeq\(value\)\s*\{[\s\S]*Number\.isFinite\(nextValue\)[\s\S]*Math\.floor\(nextValue\)[\s\S]*\}/, 'OneClickCreativePage should normalize last_seq through a shared helper');
assert.match(loadActiveBlock, /last_seq:\s*normalizeLastSeq\(parsed\.last_seq\)/, 'loadActiveCreativeTask should normalize missing or invalid last_seq to 0 without deleting otherwise valid storage');
assert.match(page, /if \(isDifferentTask\) \{[\s\S]*lastSeqRef\.current = normalizeLastSeq\(sinceSeq\)/, 'Switching task stream subscriptions should normalize lastSeq');
assert.match(page, /else if \(sinceSeq !== undefined\) \{[\s\S]*lastSeqRef\.current = normalizeLastSeq\(sinceSeq\)/, 'Reusing task stream subscriptions should normalize explicit sinceSeq');
assert.match(page, /if \(nextWorkflow\?\.status === 'done'\) \{[\s\S]*if \(activeTaskRef\.current\?\.workflow_id === workflowId\) \{[\s\S]*stopTaskStream\(\{ clearStorage: true \}\);[\s\S]*\}[\s\S]*setStatus\('done'\);[\s\S]*setMessage\('视频生成完成。'\);/, 'Polling fallback should stop only the current workflow stream before setting done UI state');
assert.match(page, /if \(nextWorkflow\?\.status === 'failed' \|\| json\?\.success === false\) \{[\s\S]*if \(activeTaskRef\.current\?\.workflow_id === workflowId\) \{[\s\S]*stopTaskStream\(\{ clearStorage: true \}\);[\s\S]*\}[\s\S]*setStatus\('failed'\);[\s\S]*setMessage\(nextMessage \|\| '视频生成失败，请查看任务详情。'\);/, 'Polling fallback should stop only the current workflow stream before setting failed UI state');
assert.match(page, /\}, \[status, workflowId, persistTasks, stopTaskStream, subscribeTaskEvents\]\);/, 'Polling effect should declare stable stream callback dependencies');
assert.match(page, /\}, \[workflowId, routeWorkflowId, selectedWorkflowId, stopTaskStream, subscribeTaskEvents\]\);/, 'Active task recovery effect should declare stream callback dependencies');
const routeLeaveStart = page.indexOf('if (!routeWorkflowId) {');
const routeLeaveEnd = page.indexOf('if (activeTaskRef.current?.workflow_id', routeLeaveStart);
assert.ok(routeLeaveStart > 0 && routeLeaveEnd > routeLeaveStart, 'OneClickCreativePage should handle leaving a creative detail route');
const routeLeaveBlock = page.slice(routeLeaveStart, routeLeaveEnd);
assert.match(routeLeaveBlock, /finalWorkflowRefreshRef\.current = null/, 'Leaving the creative detail route should clear pending final workflow refresh tokens');
const startNewTaskStart = page.indexOf('function startNewTask() {');
const selectTaskStart = page.indexOf('function selectTask', startNewTaskStart);
assert.ok(startNewTaskStart > 0 && selectTaskStart > startNewTaskStart, 'OneClickCreativePage should define startNewTask before selectTask');
const startNewTaskBlock = page.slice(startNewTaskStart, selectTaskStart);
assert.match(startNewTaskBlock, /setUseResearch\(true\)/, 'Starting a new creative task should restore the default research-enabled state');
assert.doesNotMatch(startNewTaskBlock, /setUseResearch\(false\)/, 'Starting a new creative task should not turn off research by default');
assert.match(page, /CREATIVE_TASKS_STORAGE_KEY/, 'OneClickCreativePage should persist submitted creative tasks locally');
assert.match(page, /function\s+getWorkflowGeneratedTitle\(workflow\)/, 'OneClickCreativePage should derive sidebar titles from generated scene spec titles');
assert.match(page, /getTaskDisplayTitle\(nextWorkflow,\s*nextWorkflow\?\.creative_context\?\.input\?\.raw_text,\s*prev\.find\(task => task\.workflow_id === workflowId\)\?\.title\)/, 'Task list refresh should replace the prompt-derived title once a generated main title exists');
assert.match(page, /window\.localStorage\.setItem/, 'OneClickCreativePage should save submitted tasks to localStorage');
assert.match(page, /setSelectedWorkflowId\(nextWorkflowId\)/, 'Submitting should automatically enter the created task detail');
assert.match(page, /useNavigate/, 'OneClickCreativePage should use router navigation for creative tasks');
assert.match(page, /useParams/, 'OneClickCreativePage should read the workflow id from route params');
assert.match(page, /navigate\(`\/creative\/\$\{encodeURIComponent\(nextWorkflowId\)\}`/, 'Submitting should route to the created workflow detail URL');
assert.match(page, /navigate\(`\/creative\/\$\{encodeURIComponent\(task\.workflow_id\)\}`/, 'Selecting a sidebar task should route to its workflow detail URL');
assert.match(page, /navigate\('\/creative'\)/, 'Starting a new task should route back to the creative home URL');
assert.match(page, /function updateTask\(tasks, task\) \{[\s\S]*return tasks\.map\(item => item\.workflow_id === task\.workflow_id \? \{ \.\.\.item, \.\.\.task \} : item\);[\s\S]*\}/, 'Task refreshes should update existing sidebar tasks in place so identical titles do not jump');
assert.match(page, /async function pollWorkflow\(\) \{[\s\S]*persistTasks\(prev => updateTask\(prev, \{/, 'Polling workflow refreshes should preserve the sidebar order');
assert.doesNotMatch(page, /async function pollWorkflow\(\) \{[\s\S]*persistTasks\(prev => upsertTask\(prev, \{/, 'Polling workflow refreshes should not move the selected task to the top');
assert.match(page, /const isDetailRoute = Boolean\(routeWorkflowId\)/, 'Creative detail mode should be derived from the route workflow id');
assert.match(page, /!\s*isDetailRoute\s*&&\s*\(/, 'Creative input composer should be hidden on task detail routes');
assert.match(page, /<CreativeComposer[\s\S]*setMode=\{setMode\}/, 'OneClickCreativePage should pass setMode into CreativeComposer');
assert.match(page, /sidebarCollapsed/, 'OneClickCreativePage should track collapsed task sidebar state');
assert.match(page, /setSidebarCollapsed/, 'OneClickCreativePage should toggle the task sidebar');
assert.ok(creativeSidebar.includes('className="creativeSidebarToggle"'), 'Task sidebar collapse control should be a real button');
assert.match(creativeSidebar, /<Dialog\s+open=\{searchOpen\}\s+onOpenChange=\{setSearchOpen\}>/, 'Task search should open a real dialog');
assert.match(creativeSidebar, /onClick=\{\(\) => selectSearchTask\(task\)\}/, 'Task search result should select and navigate to the task detail');
assert.match(creativeSidebar, /return sidebarCollapsed \? \(\s*<aside className="creativeTaskSidebar collapsed"/, 'Collapsed sidebar should render a minimal rail instead of compressed full sidebar content');
assert.match(creativeSidebar, /className="creativeCollapsedExpand"/, 'Collapsed sidebar should expose only one top-left expand button');
assert.ok(!page.includes('creativeFloatingExpand'), 'Collapsed sidebar should not render a floating expand pill over the rail');
assert.ok(creativeComposer.includes('className="creativeModeThumb"'), 'Mode switch should use an animated thumb instead of button borders');
assert.ok(creativeComposer.includes('data-mode={mode}'), 'Mode switch should expose mode state for thumb animation');
assert.doesNotMatch(shell, /<header className="header"/, 'AppShell should not render the removed top intro bar');
assert.doesNotMatch(shell, /creativeHeaderSettings/, 'AppShell should not keep the removed header settings action');
assert.doesNotMatch(styles, /\.header\s*\{/, 'styles.css should not keep the removed top intro bar styles');
assert.ok(!styles.includes('.creativeHeaderSettings'), 'styles.css should remove the old top header action styles');
assert.match(styles, /\.creativeChatShell\s*\{[\s\S]*min-height:\s*100vh;/, 'Creative shell should use the full viewport after removing the top intro bar');
assert.match(styles, /\.creativeChatShell\s*\{[\s\S]*height:\s*100vh;[\s\S]*overflow:\s*hidden;/, 'Creative shell should not grow when task detail content is taller than the viewport');
assert.match(page, /<section className="min-h-0 min-w-0 overflow-auto bg-white">/, 'Creative detail pane should be the scroll container');
assert.doesNotMatch(page, /<Bot\s+size=\{15\}/, 'Prompt quick actions should remove the smart video pill in every mode');
assert.ok(!page.includes('智能成片'), 'Prompt quick actions should not render smart video copy');
assert.match(page, /const submitDisabled = isBusy \|\| mode === 'expert'/, 'Expert mode should contribute to submit disabled state');
assert.match(creativeComposer, /disabled=\{submitDisabled\}/, 'Submit button should use the combined disabled state');
assert.match(creativeComposer, /creativeExpertHint/, 'Expert mode should show a developing hint');
assert.ok(page.includes(zh.expertDeveloping), 'Expert mode developing hint should use Chinese copy');
assert.ok(!page.includes(zh.assetNotice), 'Expert mode should not show the future asset-context notice copy');
assert.doesNotMatch(page, /AssetContextNotice/, 'Expert mode should not render a second asset-context notice below the developing hint');
assert.match(creativeComposer, /className=\{`creativeResearchToggle \$\{useResearch \? 'active' : ''\}`\}/, 'Research button should have an explicit inactive state');
assert.ok(creativeComposer.includes('<div className="creativeExpertSlot">'), 'Expert-only notice should live in a stable reserved slot');
assert.match(creativeComposer, /mode === 'expert' \? \(\s*<div className="creativeExpertSlot">/, 'Expert notice slot should only render in expert mode to avoid quick-mode empty space');
assert.match(page, /assetIds:\s*\[\]/, 'OneClickCreativePage payload should preserve empty assetIds');
assert.match(creativeComposer, /disabled=\{isBusy\}/, 'CreativeComposer should disable controls while busy');
assert.match(page, /creativeChatShell/, 'OneClickCreativePage should use a dedicated chat shell');
assert.match(creativeSidebar, /creativeTaskSidebar/, 'CreativeSidebar should render a left task sidebar');
assert.ok(creativeComposer.includes('className="creativePromptComposer"'), 'CreativeComposer should render a central prompt composer');
assert.ok(styles.includes('.creativeChatShell'), 'styles.css should define the creative chat shell layout');
assert.ok(styles.includes('.creativeTaskSidebar'), 'styles.css should define the creative task sidebar');
assert.match(styles, /grid-template-rows:\s*auto auto auto minmax\(0, 1fr\) auto;/, 'Task sidebar should keep settings visible while only the task list scrolls');
assert.match(styles, /\.creativeTaskSidebar\s*\{[\s\S]*overflow:\s*hidden;/, 'Task sidebar should keep its footer inside the viewport shell');
assert.ok(!styles.includes('.creativeFloatingExpand'), 'styles.css should not keep a floating expand button over collapsed sidebar');
assert.ok(!page.includes('<div className="agentStatusList">'), 'WorkflowStatusPanel should not render li elements inside a div.agentStatusList');
assert.doesNotMatch(page, /<WorkflowStatusPanel/, 'Creative task detail should not render the old current-task card');
assert.match(creativeTaskDetail, /creativeDetailMeta/, 'Creative task detail should show task id and status in a compact meta row');
assert.match(creativeWorkflowStepper, /creativeWorkflowStepper/, 'Creative task detail should render a horizontal workflow stepper');
assert.match(creativeWorkflowStepper, /creativeWorkflowStepConnector/, 'Creative workflow stepper should render connectors between steps');
assert.match(creativeWorkflowStepper, /aria-current=\{stepState === 'active' \? 'step' : undefined\}/, 'Active workflow step should be exposed and visually highlighted');
assert.match(creativeWorkflowStepper, /ACTIVE_OUTLINE_CLASS/, 'Active workflow step should use Tailwind classes for the animated outline hook');
assert.match(creativeWorkflowStepper, /before:animate-pulse/, 'Active workflow step should animate its outline with Tailwind');
assert.match(creativeWorkflowStepper, /motion-reduce:before:animate-none/, 'Active workflow step animation should respect reduced motion');
assert.match(creativeProgressPanel, /isActiveProgress/, 'Current progress panel should only animate active progress');
assert.match(creativeProgressPanel, /motion-safe:animate-pulse/, 'Current progress bar should use Tailwind for its breathing animation');
assert.match(creativeProgressPanel, /motion-reduce:animate-none/, 'Current progress bar animation should respect reduced motion');
assert.ok(styles.includes('.creativeWorkflowStepper'), 'styles.css should define workflow stepper layout');
assert.ok(creativeComposer.includes('className="flex items-center justify-between gap-3 max-[720px]:items-end"'), 'CreativeComposer should keep prompt actions on one row with Tailwind');
assert.match(creativeSidebar, /DialogContent className="w-\[min\(560px,calc\(100vw-32px\)\)\]"/, 'CreativeSidebar should size task search dialog with Tailwind');
assert.ok(!styles.includes('.creativeTaskSearchDialog'), 'styles.css should not define task search dialog layout for new shadcn Dialog UI');
assert.ok(!styles.includes('.creativePromptModalOverlay'), 'styles.css should remove the old prompt modal overlay styles after shadcn Dialog migration');
assert.ok(!styles.includes('.creativePromptModalHeader'), 'styles.css should remove the old prompt modal header styles after shadcn Dialog migration');
assert.ok(!styles.includes('.creativePromptModalClose'), 'styles.css should remove the old prompt modal close styles after shadcn Dialog migration');
assert.ok(!styles.includes('.creativeDetailCard'), 'styles.css should remove unreferenced creative detail card styles');
assert.ok(!styles.includes('.creativeStagePanel'), 'styles.css should remove unreferenced creative stage panel styles');
assert.ok(!styles.includes('.creativeAssetNotice'), 'styles.css should remove unreferenced creative asset notice styles');
assert.match(creativeTaskDetail, /getWorkflowVideoUrl/, 'Creative task detail should resolve rendered video URL from workflow data');
assert.match(page, /workflow\?\.stages\?\.find\(stage => stage\.id === 'render'\)\?\.result/, 'Creative task detail should read video URL from render stage result');
assert.match(page, /getWorkflowDisplayMessage/, 'Creative task detail should derive the visible status message from workflow progress');
assert.match(page, /find\(stage => \['running', 'queued', 'pending'\]\.includes\(stage\.status\)\)/, 'Creative task detail should surface the current active stage message while polling');
assert.match(page, /if \(storedTask\) \{[\s\S]*setStatus\('polling'\);/, 'Stored creative tasks should refresh from backend instead of freezing stale local workflow data');
assert.match(creativeDisplay, /skipped:\s*'已跳过'/, 'Workflow progress should show skipped stages as 已跳过');
assert.match(creativeDisplay, /stage\.status === 'skipped'[\s\S]*return 'done'/, 'Workflow stepper should render skipped stages as non-active completed steps');
assert.match(creativeDisplay, /stage\.status === 'running'[\s\S]*return 'active'/, 'Workflow stepper should treat only running stages as the active visual step');
assert.match(creativeDisplay, /stage\.status === 'queued' \|\| stage\.status === 'pending'[\s\S]*return 'queued'/, 'Workflow stepper should keep queued stages visually quieter than the running step');
assert.match(creativeStatusMessage, /getStatusMessageClass/, 'CreativeStatusMessage should use the shared status message class helper');
assert.match(creativeTaskDetail, /<CreativeStatusMessage\s+status=\{status\}\s+message=\{message\}\s+\/>/, 'CreativeTaskDetail should render the extracted status message component while waiting');
const videoPreviewStart = creativeTaskDetail.indexOf('<CreativeVideoPreview');
assert.ok(videoPreviewStart > 0, 'Creative task detail should render CreativeVideoPreview when a video URL is available');
const videoPreviewEnd = creativeTaskDetail.indexOf('/>', videoPreviewStart);
assert.ok(videoPreviewEnd > videoPreviewStart, 'CreativeVideoPreview JSX should be self-closing');
const videoPreviewBlock = creativeTaskDetail.slice(videoPreviewStart, videoPreviewEnd);
assert.ok(videoPreviewBlock.includes('videoUrl={videoUrl}'), 'CreativeVideoPreview should receive the rendered video URL');
assert.ok(videoPreviewBlock.includes('onEdit={continueEdit}'), 'CreativeVideoPreview should receive the continue edit handler');
assert.ok(videoPreviewBlock.includes('disabled={!editableWorkflowId}'), 'CreativeVideoPreview should disable continue edit without an editable workflow ID');
assert.match(videoPreviewBlock, /title=\{editableWorkflowId \? '继续编辑视频' : '缺少创作任务 ID，无法进入编辑器。'\}/, 'CreativeVideoPreview should receive a Chinese unavailable reason when edit ID is missing');
assert.match(creativeVideoPreview, /CreativeVideoPreview\(\{ videoUrl, onEdit, disabled, title \}\)/, 'CreativeVideoPreview should accept disabled and title props');
assert.match(creativeVideoPreview, /<Button[\s\S]*disabled=\{disabled\}[\s\S]*title=\{title\}/, 'CreativeVideoPreview should pass disabled and title to the shared shadcn Button');
assert.match(creativeVideoPreview, /<video\s+className="creativeResultVideo"\s+src=\{videoUrl\}\s+controls/, 'Creative video preview should render a native controls video element');
assert.match(creativeVideoPreview, /Button\s+className="editorToggle"/, 'Creative video preview should use the shared shadcn Button for continue edit');
assert.match(creativeTaskDetail, /workflow\?\.status === 'done' && videoUrl/, 'Creative video preview should render after workflow is done');
assert.match(creativeTaskDetail, /<CreativeWorkflowStepper workflow=\{workflow\} \/>[\s\S]*workflow\?\.status === 'done' && videoUrl/, 'Creative detail should keep the progress stepper visible when showing the completed video');
assert.ok(styles.includes('.creativeDetailMeta'), 'styles.css should define compact task meta row');
assert.ok(styles.includes('.creativeWorkflowStepConnector'), 'styles.css should define horizontal step connectors');
assert.ok(!styles.includes('@keyframes activeStepPulse'), 'Active workflow step animation should not add custom global CSS');
assert.ok(styles.includes('.creativeResultVideo'), 'styles.css should define creative result video');

assert.match(app, /OneClickCreativePage/, 'App.jsx should import and render OneClickCreativePage');
assert.match(app, /<Navigate\s+to="\/creative"\s+replace\s+\/>/, 'App.jsx index route should navigate to /creative');
assert.match(app, /path="creative"/, 'App.jsx should keep the one-click creative route');
assert.match(app, /path="creative\/:workflowId"/, 'App.jsx should keep the one-click workflow detail route');
assert.match(app, /path="editor\/:workflowId"/, 'App.jsx should keep the editor route');
assert.match(app, /path="settings"/, 'App.jsx should keep the settings route');
for (const removedRoute of ['crawl', 'records', 'media', 'ai', 'hyperframes-freeform']) {
  assert.ok(!app.includes(`path="${removedRoute}`), `App.jsx should remove ${removedRoute} route`);
}

assert.ok(!shell.includes('<nav className="tabs">'), 'AppShell should remove the old top tab markup');
assert.ok(!shell.includes('NavLink'), 'AppShell should not import or render NavLink');
for (const route of ['/crawl/douyin', '/records/douyin', '/media', '/hyperframes-freeform']) {
  assert.ok(!shell.includes(`to="${route}"`), `AppShell should remove old nav route: ${route}`);
}

console.log('one click creative page tests passed');
