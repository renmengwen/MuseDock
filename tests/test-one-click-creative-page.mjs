import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, '../frontend-react/src/pages/OneClickCreativePage.jsx');
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
  taskDetail: textFromCodePoints([0x4efb, 0x52a1, 0x8be6, 0x60c5]),
  currentTask: textFromCodePoints([0x5f53, 0x524d, 0x4efb, 0x52a1]),
  inputLabel: textFromCodePoints([0x8f93, 0x5165, 0x89c6, 0x9891, 0x65b9, 0x5411, 0x3001, 0x6296, 0x97f3, 0x20, 0x49, 0x44, 0x20, 0x6216, 0x6296, 0x97f3, 0x94fe, 0x63a5]),
  researchToggle: textFromCodePoints([0x8054, 0x7f51, 0x83b7, 0x53d6, 0x6700, 0x65b0, 0x8d44, 0x6599]),
  assetNotice: textFromCodePoints([0x56fe, 0x7247, 0x7d20, 0x6750, 0x5c06, 0x5728, 0x4e0b, 0x4e00, 0x9636, 0x6bb5, 0x5f00, 0x653e]),
  submitButton: textFromCodePoints([0x4e00, 0x952e, 0x751f, 0x6210, 0x89c6, 0x9891]),
  creatingMessage: textFromCodePoints([0x6b63, 0x5728, 0x521b, 0x5efa, 0x521b, 0x4f5c, 0x4efb, 0x52a1, 0x2e, 0x2e, 0x2e]),
  emptyInputMessage: textFromCodePoints([0x8bf7, 0x8f93, 0x5165, 0x89c6, 0x9891, 0x65b9, 0x5411, 0x3001, 0x6296, 0x97f3, 0x20, 0x49, 0x44, 0x20, 0x6216, 0x6296, 0x97f3, 0x94fe, 0x63a5]),
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
  failed: textFromCodePoints([0x5931, 0x8d25]),
};

assert.ok(fs.existsSync(pagePath), 'missing page frontend-react/src/pages/OneClickCreativePage.jsx');

const page = fs.readFileSync(pagePath, 'utf-8');
const app = fs.readFileSync(appPath, 'utf-8');
const shell = fs.readFileSync(shellPath, 'utf-8');
const styles = fs.readFileSync(stylesPath, 'utf-8');

for (const text of [
  zh.creativeTitle,
  zh.newTask,
  zh.taskList,
  zh.quickMode,
  zh.expertMode,
  zh.taskDetail,
  zh.currentTask,
  zh.inputLabel,
  zh.researchToggle,
  zh.assetNotice,
  zh.submitButton,
  zh.creatingMessage,
  zh.emptyInputMessage,
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
  'AssetContextNotice',
]) {
  assert.match(page, new RegExp(`function\\s+${symbol}\\s*\\(`), `OneClickCreativePage.jsx should define ${symbol}`);
}

assert.match(page, /createCreativeWorkflow/, 'OneClickCreativePage should create creative workflows');
assert.match(page, /getCreativeWorkflow/, 'OneClickCreativePage should poll creative workflows');
assert.match(page, /setInterval/, 'OneClickCreativePage should poll with setInterval');
assert.match(page, /CREATIVE_TASKS_STORAGE_KEY/, 'OneClickCreativePage should persist submitted creative tasks locally');
assert.match(page, /window\.localStorage\.setItem/, 'OneClickCreativePage should save submitted tasks to localStorage');
assert.match(page, /setSelectedWorkflowId\(nextWorkflowId\)/, 'Submitting should automatically enter the created task detail');
assert.match(page, /sidebarCollapsed/, 'OneClickCreativePage should track collapsed task sidebar state');
assert.match(page, /setSidebarCollapsed/, 'OneClickCreativePage should toggle the task sidebar');
assert.ok(page.includes('className="creativeSidebarToggle"'), 'Task sidebar collapse control should be a real button');
assert.ok(page.includes('className="creativeModeThumb"'), 'Mode switch should use an animated thumb instead of button borders');
assert.ok(page.includes('data-mode={mode}'), 'Mode switch should expose mode state for thumb animation');
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
assert.ok(!page.includes('<div className="agentStatusList">'), 'WorkflowStatusPanel should not render li elements inside a div.agentStatusList');
assert.ok(page.includes('<ul className="agentStatusList">'), 'WorkflowStatusPanel should render status items inside ul.agentStatusList');

assert.match(app, /OneClickCreativePage/, 'App.jsx should import and render OneClickCreativePage');
assert.match(app, /<Navigate\s+to="\/creative"\s+replace\s+\/>/, 'App.jsx index route should navigate to /creative');

assert.match(shell, /to="\/creative"/, 'AppShell should include a creative nav item');
assert.ok(shell.includes(zh.creativeTitle), 'AppShell should render the new creative nav text in normal Chinese');
for (const route of ['/crawl/douyin', '/records/douyin', '/media', '/hyperframes-freeform', '/settings']) {
  assert.ok(shell.includes(`to="${route}"`), `AppShell should preserve nav route: ${route}`);
}

console.log('one click creative page tests passed');
