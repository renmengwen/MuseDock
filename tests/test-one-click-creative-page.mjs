import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, '../frontend-react/src/pages/OneClickCreativePage.jsx');
const appPath = path.join(__dirname, '../frontend-react/src/App.jsx');
const shellPath = path.join(__dirname, '../frontend-react/src/components/AppShell.jsx');
const stylesPath = path.join(__dirname, '../frontend-react/src/styles.css');
const persistentRoutesPath = path.join(__dirname, '../frontend-react/src/utils/persistentRoutes.js');

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
  inputLabel: textFromCodePoints([0x8f93, 0x5165, 0x89c6, 0x9891, 0x65b9, 0x5411, 0x3001, 0x6296, 0x97f3, 0x20, 0x49, 0x44, 0x20, 0x6216, 0x6296, 0x97f3, 0x94fe, 0x63a5]),
  researchToggle: textFromCodePoints([0x8054, 0x7f51, 0x83b7, 0x53d6, 0x6700, 0x65b0, 0x8d44, 0x6599]),
  assetNotice: textFromCodePoints([0x56fe, 0x7247, 0x7d20, 0x6750, 0x5c06, 0x5728, 0x4e0b, 0x4e00, 0x9636, 0x6bb5, 0x5f00, 0x653e]),
  submitButton: textFromCodePoints([0x4e00, 0x952e, 0x751f, 0x6210, 0x89c6, 0x9891]),
  creatingMessage: textFromCodePoints([0x6b63, 0x5728, 0x521b, 0x5efa, 0x521b, 0x4f5c, 0x4efb, 0x52a1, 0x2e, 0x2e, 0x2e]),
  emptyInputMessage: textFromCodePoints([0x8bf7, 0x8f93, 0x5165, 0x89c6, 0x9891, 0x65b9, 0x5411, 0x3001, 0x6296, 0x97f3, 0x20, 0x49, 0x44, 0x20, 0x6216, 0x6296, 0x97f3, 0x94fe, 0x63a5]),
  chatGreeting: textFromCodePoints([0x563f, 0xff0c, 0x4eca, 0x5929, 0x6211, 0x4eec, 0x6765, 0x505a, 0x70b9, 0x4ec0, 0x4e48, 0xff1f]),
  creativeInputPlaceholder: textFromCodePoints([0x5728, 0x8fd9, 0x91cc, 0x8f93, 0x5165, 0x4f60, 0x7684, 0x521b, 0x610f]),
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
};

assert.ok(fs.existsSync(pagePath), 'missing page frontend-react/src/pages/OneClickCreativePage.jsx');

const page = fs.readFileSync(pagePath, 'utf-8');
const app = fs.readFileSync(appPath, 'utf-8');
const shell = fs.readFileSync(shellPath, 'utf-8');
const styles = fs.readFileSync(stylesPath, 'utf-8');
const persistentRoutes = fs.readFileSync(persistentRoutesPath, 'utf-8');

for (const text of [
  zh.creativeTitle,
  zh.newTask,
  zh.taskList,
  zh.quickMode,
  zh.expertMode,
  zh.expertDeveloping,
  zh.taskDetail,
  zh.currentTask,
  zh.inputLabel,
  zh.researchToggle,
  zh.submitButton,
  zh.creatingMessage,
  zh.emptyInputMessage,
  zh.chatGreeting,
  zh.creativeInputPlaceholder,
  zh.stopAndDelete,
  zh.stoppingAndDeleting,
]) {
  assert.ok(page.includes(text), `OneClickCreativePage.jsx should include normal Chinese text: ${text}`);
}

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
  assert.ok(page.includes(text), `OneClickCreativePage.jsx should keep workflow text readable: ${text}`);
}

for (const mojibake of ['涓€閿', '鑱旂綉', '鍥剧墖', '姝ｅ湪', '璇疯緭']) {
  assert.ok(!page.includes(mojibake), `OneClickCreativePage.jsx should not contain mojibake text: ${mojibake}`);
}

for (const symbol of [
  'CreativeTaskSidebar',
  'CreativeHeroHeader',
  'CreativeModeSwitch',
  'CreativePromptComposer',
  'CreativeTaskDetail',
  'CreativeInputForm',
  'WorkflowStageList',
  'WorkflowStatusPanel',
  'WorkflowStepProgress',
  'CreativeVideoPreview',
]) {
  assert.match(page, new RegExp(`function\\s+${symbol}\\s*\\(`), `OneClickCreativePage.jsx should define ${symbol}`);
}

assert.match(page, /createCreativeWorkflow/, 'OneClickCreativePage should create creative workflows');
assert.match(page, /CreativeVideoEditor/, 'OneClickCreativePage should import and render CreativeVideoEditor');
assert.match(page, /editorOpen/, 'OneClickCreativePage should track editor open state');
assert.match(page, /getCreativeWorkflow/, 'OneClickCreativePage should poll creative workflows');
assert.match(page, /stopAndDeleteTask/, 'OneClickCreativePage should expose a stop-and-delete action for the current task');
assert.match(page, /onStopAndDelete=\{stopAndDeleteTask\}/, 'Creative task detail should receive the current task stop-and-delete handler');
assert.match(page, /onStopAndDelete\(workflowId\)/, 'Creative task detail stop button should delete the currently opened task');
assert.match(page, /disabled=\{deletingWorkflowId === workflowId\}/, 'Current task stop-and-delete button should be disabled while deleting');
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
assert.match(page, /const json = await api\.getCreativeWorkflow\(targetWorkflowId\);[\s\S]*persistTasks\(prev => upsertTask\(prev, \{/, 'Final workflow refresh should fetch the current workflow and persist the final task snapshot');
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
assert.match(finalRefreshBlock, /finalWorkflowRefreshRef\.current\s*=\s*\{[\s\S]*(closedGeneration|terminalGeneration|allowClosedGeneration|closedByStream)/, 'Final workflow refresh token should record a stream-closed generation allowance for the same terminal task');
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
assert.match(page, /CREATIVE_TASKS_STORAGE_KEY/, 'OneClickCreativePage should persist submitted creative tasks locally');
assert.match(page, /window\.localStorage\.setItem/, 'OneClickCreativePage should save submitted tasks to localStorage');
assert.match(page, /setSelectedWorkflowId\(nextWorkflowId\)/, 'Submitting should automatically enter the created task detail');
assert.match(page, /useNavigate/, 'OneClickCreativePage should use router navigation for creative tasks');
assert.match(page, /useParams/, 'OneClickCreativePage should read the workflow id from route params');
assert.match(page, /navigate\(`\/creative\/\$\{encodeURIComponent\(nextWorkflowId\)\}`/, 'Submitting should route to the created workflow detail URL');
assert.match(page, /navigate\(`\/creative\/\$\{encodeURIComponent\(task\.workflow_id\)\}`/, 'Selecting a sidebar task should route to its workflow detail URL');
assert.match(page, /navigate\('\/creative'\)/, 'Starting a new task should route back to the creative home URL');
assert.match(page, /const isDetailRoute = Boolean\(routeWorkflowId\)/, 'Creative detail mode should be derived from the route workflow id');
assert.match(page, /!\s*isDetailRoute\s*&&\s*\(/, 'Creative input composer should be hidden on task detail routes');
assert.match(page, /sidebarCollapsed/, 'OneClickCreativePage should track collapsed task sidebar state');
assert.match(page, /setSidebarCollapsed/, 'OneClickCreativePage should toggle the task sidebar');
assert.ok(page.includes('className="creativeSidebarToggle"'), 'Task sidebar collapse control should be a real button');
assert.match(page, /if \(sidebarCollapsed\) \{\s*return \(\s*<aside className="creativeTaskSidebar collapsed"/, 'Collapsed sidebar should render a minimal rail instead of compressed full sidebar content');
assert.match(page, /className="creativeCollapsedExpand"/, 'Collapsed sidebar should expose only one top-left expand button');
assert.ok(!page.includes('creativeFloatingExpand'), 'Collapsed sidebar should not render a floating expand pill over the rail');
assert.ok(page.includes('className="creativeModeThumb"'), 'Mode switch should use an animated thumb instead of button borders');
assert.ok(page.includes('data-mode={mode}'), 'Mode switch should expose mode state for thumb animation');
assert.match(shell, /to="\/settings"/, 'AppShell should expose settings entry inside the top brand card');
assert.match(shell, /<header className="header"[\s\S]*className="creativeHeaderSettings"[\s\S]*<\/header>/, 'Settings entry should live on the right side of the top brand card');
assert.doesNotMatch(page, /<form className="creativePromptComposer"[\s\S]*className="creativeHeaderSettings"[\s\S]*<\/form>/, 'Settings entry should not sit inside the input box');
assert.match(shell, /Settings2/, 'Settings entry should include a settings icon');
assert.ok(shell.includes(zh.settings), 'AppShell should render settings text in normal Chinese');
assert.doesNotMatch(page, /<Bot\s+size=\{15\}/, 'Prompt quick actions should remove the smart video pill in every mode');
assert.ok(!page.includes('智能成片'), 'Prompt quick actions should not render smart video copy');
assert.match(page, /const submitDisabled = isBusy \|\| mode === 'expert'/, 'Expert mode should contribute to submit disabled state');
assert.match(page, /disabled=\{submitDisabled\}/, 'Submit button should use the combined disabled state');
assert.match(page, /creativeExpertHint/, 'Expert mode should show a developing hint');
assert.ok(page.includes(zh.expertDeveloping), 'Expert mode developing hint should use Chinese copy');
assert.ok(!page.includes(zh.assetNotice), 'Expert mode should not show the future asset-context notice copy');
assert.doesNotMatch(page, /AssetContextNotice/, 'Expert mode should not render a second asset-context notice below the developing hint');
assert.match(page, /className=\{`creativeResearchToggle \$\{useResearch \? 'active' : ''\}`\}/, 'Research button should have an explicit inactive state');
assert.ok(page.includes('<div className="creativeExpertSlot">'), 'Expert-only notice should live in a stable reserved slot');
assert.match(page, /mode === 'expert' \? \(\s*<div className="creativeExpertSlot">/, 'Expert notice slot should only render in expert mode to avoid quick-mode empty space');
assert.match(page, /assetIds:\s*\[\]/, 'OneClickCreativePage payload should preserve empty assetIds');
assert.match(page, /disabled=\{isBusy\}/, 'OneClickCreativePage should disable submit while busy');
assert.match(page, /creativeChatShell/, 'OneClickCreativePage should use a dedicated chat shell');
assert.match(page, /creativeTaskSidebar/, 'OneClickCreativePage should render a left task sidebar');
assert.ok(page.includes('className="creativePromptComposer"'), 'OneClickCreativePage should render a central prompt composer');
assert.ok(styles.includes('.creativeChatShell'), 'styles.css should define the creative chat shell layout');
assert.ok(styles.includes('.creativeTaskSidebar'), 'styles.css should define the creative task sidebar');
assert.ok(styles.includes('.creativePromptComposer'), 'styles.css should define the creative prompt composer');
assert.ok(styles.includes('.creativeModeThumb'), 'styles.css should define the animated mode switch thumb');
assert.ok(styles.includes('transition: transform'), 'styles.css should animate mode switch movement');
assert.ok(styles.includes('.creativeChatShell.sidebarCollapsed'), 'styles.css should define collapsed sidebar layout');
assert.ok(styles.includes('.creativeTaskSidebar.collapsed'), 'styles.css should style the collapsed sidebar');
assert.match(styles, /\.creativeTaskSidebar\.collapsed\s*\{[^}]*background:\s*#fff/, 'Collapsed sidebar should share the same white background as the main container');
assert.ok(styles.includes('.creativeHeaderSettings'), 'styles.css should define the settings button in the header card');
assert.ok(styles.includes('.creativeResearchToggle:not(.active)'), 'styles.css should make default research state look off');
assert.match(styles, /\.creativeQuickActions \.creativeResearchToggle\s*\{[^}]*transition:[^}]*transform/, 'research toggle should animate between off and on states');
assert.match(styles, /\.creativeQuickActions \.creativeResearchToggle\.active\s*\{[^}]*transform:\s*translateY\(-1px\)/, 'active research toggle should have a subtle animated lift');
assert.ok(styles.includes('padding: 0 12px'), 'quick action buttons should have horizontal padding');
assert.ok(styles.includes('.creativeExpertSlot'), 'styles.css should reserve space for expert notice');
assert.ok(styles.includes('.creativeExpertSlot:not(:empty)'), 'styles.css should only reserve expert notice space when notice is visible');
assert.ok(!styles.includes('.creativeFloatingExpand'), 'styles.css should not keep a floating expand button over collapsed sidebar');
assert.ok(!page.includes('<div className="agentStatusList">'), 'WorkflowStatusPanel should not render li elements inside a div.agentStatusList');
assert.ok(page.includes('<ul className="agentStatusList">'), 'WorkflowStatusPanel should render status items inside ul.agentStatusList');
assert.doesNotMatch(page, /<WorkflowStatusPanel/, 'Creative task detail should not render the old current-task card');
assert.match(page, /creativeDetailMeta/, 'Creative task detail should show task id and status in a compact meta row');
assert.match(page, /creativeWorkflowStepper/, 'Creative task detail should render a horizontal workflow stepper');
assert.match(page, /creativeWorkflowStepConnector/, 'Creative workflow stepper should render connectors between steps');
assert.match(page, /getWorkflowVideoUrl/, 'Creative task detail should resolve rendered video URL from workflow data');
assert.match(page, /workflow\?\.stages\?\.find\(stage => stage\.id === 'render'\)\?\.result/, 'Creative task detail should read video URL from render stage result');
assert.match(page, /getWorkflowDisplayMessage/, 'Creative task detail should derive the visible status message from workflow progress');
assert.match(page, /find\(stage => \['running', 'queued', 'pending'\]\.includes\(stage\.status\)\)/, 'Creative task detail should surface the current active stage message while polling');
assert.match(page, /skipped:\s*'已跳过'/, 'Workflow progress should show skipped stages as 已跳过');
assert.match(page, /stage\.status === 'skipped'[\s\S]*return 'done'/, 'Workflow stepper should render skipped stages as non-active completed steps');
assert.match(page, /<CreativeVideoPreview videoUrl=\{videoUrl\}/, 'Creative task detail should render video preview when a video URL is available');
assert.match(page, /<video\s+className="creativeResultVideo"\s+src=\{videoUrl\}\s+controls/, 'Creative video preview should render a native controls video element');
assert.match(page, /workflow\?\.status === 'done' && videoUrl/, 'Creative video preview should render after workflow is done');
assert.match(page, /<WorkflowStepProgress workflow=\{workflow\} \/>[\s\S]*workflow\?\.status === 'done' && videoUrl/, 'Creative detail should keep the progress stepper visible when showing the completed video');
assert.match(styles, /\.creativeWorkflowStepper\s*\{[^}]*display:\s*grid/, 'workflow stepper should be a horizontal grid');
assert.ok(styles.includes('.creativeDetailMeta'), 'styles.css should define compact task meta row');
assert.ok(styles.includes('.creativeWorkflowStepConnector'), 'styles.css should define horizontal step connectors');
assert.match(styles, /\.creativeVideoStage\s*\{[^}]*min-height:\s*calc\(100vh - 340px\)/, 'completed video area should fill the task detail viewport while leaving room for progress');
assert.ok(styles.includes('.creativeResultVideo'), 'styles.css should define full-size creative result video');

assert.match(app, /OneClickCreativePage/, 'App.jsx should import and render OneClickCreativePage');
assert.match(app, /<Navigate\s+to="\/creative"\s+replace\s+\/>/, 'App.jsx index route should navigate to /creative');
assert.match(persistentRoutes, /creativeWorkflowId/, 'persistent route state should preserve creative workflow id');
assert.match(persistentRoutes, /creativeWorkflowId:\s*parts\[1\]/, 'persistent routes should parse /creative/:workflowId');

assert.ok(shell.includes('{/* <nav className="tabs">'), 'AppShell should comment out the top tab markup without deleting it');
assert.ok(shell.includes('</nav> */}'), 'AppShell should keep the top tab markup commented out');
assert.ok(!shell.includes('\n      <nav className="tabs">'), 'AppShell should not render top tabs outside the comment block');
assert.match(shell, /to="\/creative"/, 'AppShell should keep a creative nav item in the commented tab markup');
assert.ok(shell.includes(zh.creativeTitle), 'AppShell should keep creative nav text in commented tab markup');
for (const route of ['/crawl/douyin', '/records/douyin', '/media', '/hyperframes-freeform', '/settings']) {
  assert.ok(shell.includes(`to="${route}"`), `AppShell should preserve nav route: ${route}`);
}

console.log('one click creative page tests passed');
