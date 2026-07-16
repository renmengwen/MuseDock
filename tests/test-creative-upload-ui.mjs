import assert from 'node:assert/strict';
import fs from 'node:fs';

const client = fs.readFileSync('frontend-react/src/api/client.js', 'utf8');
const composer = fs.readFileSync('frontend-react/src/components/creative/CreativeComposer.jsx', 'utf8');
const page = fs.readFileSync('frontend-react/src/pages/OneClickCreativePage.jsx', 'utf8');

assert.match(client, /uploadCreativeVisualAsset\(file, requirement = 'preferred'\)[\s\S]*requestJson\('\/api\/creative-workflows\/assets\/uploads'[\s\S]*method: 'POST'[\s\S]*'Content-Type': file\.type[\s\S]*'X-File-Name': encodeURIComponent\(file\.name\)[\s\S]*'X-Asset-Requirement': requirement[\s\S]*body: file/);
assert.match(client, /updateCreativeVisualAssetRequirement\(uploadId, requirement\)[\s\S]*encodeURIComponent\(uploadId\)[\s\S]*method: 'PATCH'[\s\S]*'Content-Type': 'application\/json'[\s\S]*JSON\.stringify\(\{ requirement \}\)/);
assert.match(client, /deleteCreativeVisualAsset\(uploadId\)[\s\S]*encodeURIComponent\(uploadId\)[\s\S]*method: 'DELETE'/);

assert.match(composer, /type="file"/);
assert.match(composer, /multiple/);
assert.match(composer, /accept="image\/png,image\/jpeg,image\/webp"/);
assert.match(composer, /type="checkbox"/);
assert.match(composer, /必须使用/);
assert.match(composer, /删除图片/);
assert.match(composer, /alt=\{`\$\{asset\.fileName\} 缩略图`\}/);

const loadingStart = composer.indexOf('<div className="mt-1 text-xs text-fg-3"');
const loadingEnd = composer.indexOf('</div>', loadingStart);
assert.ok(loadingStart > 0 && loadingEnd > loadingStart, '应定义单图请求状态 live region');
const loadingBlock = composer.slice(loadingStart, loadingEnd);
assert.match(loadingBlock, /role=\{asset\.error \? 'alert' : 'status'\}/, '错误使用 alert，正常请求状态使用 status');
assert.match(loadingBlock, /aria-live="polite"/, '单图请求状态应礼貌播报');
for (const text of ['正在上传图片…', '正在更新使用约束…', '正在删除图片…']) {
  assert.ok(loadingBlock.includes(text), `live region 缺少状态：${text}`);
}

const checkboxMarker = composer.indexOf('type="checkbox"');
const checkboxStart = composer.lastIndexOf('<input', checkboxMarker);
const checkboxEnd = composer.indexOf('/>', checkboxMarker);
const checkboxBlock = composer.slice(checkboxStart, checkboxEnd);
assert.match(checkboxBlock, /disabled=\{isBusy \|\| asset\.status !== 'ready'\}/, 'requirement checkbox 仅 ready 可用');

const deleteMarker = composer.indexOf('aria-label={`删除图片');
const deleteButtonStart = composer.lastIndexOf('<Button', deleteMarker);
const deleteButtonEnd = composer.indexOf('</Button>', deleteMarker);
const deleteButtonBlock = composer.slice(deleteButtonStart, deleteButtonEnd);
assert.match(deleteButtonBlock, /disabled=\{isBusy \|\| !\['ready', 'failed'\]\.includes\(asset\.status\)\}/, '删除按钮应允许 ready 和无 ID 的 failed 本地删除');

for (const status of ['uploading', 'ready', 'failed', 'updating_requirement', 'deleting']) {
  assert.ok(page.includes(`'${status}'`), `缺少单图状态 ${status}`);
}

assert.match(page, /const \[uploadedAssets, setUploadedAssets\] = useState\(\[\]\)/);
assert.match(page, /uploadedAssetsRef = useRef\(\[\]\)/);
assert.match(page, /URL\.createObjectURL\(file\)/);
assert.match(page, /clientId/);
assert.match(page, /updateUploadedAssets\(assets => assets\.map\(asset => asset\.clientId === clientId/);

const uploadStart = page.indexOf('async function uploadCreativeAsset');
const selectStart = page.indexOf('function selectCreativeAssets', uploadStart);
assert.ok(uploadStart > 0 && selectStart > uploadStart, '应定义单图上传处理器');
const uploadBlock = page.slice(uploadStart, selectStart);
assert.match(uploadBlock, /if \(!uploadId\) \{[\s\S]*throw new Error\('上传成功响应未返回暂存 ID，请删除后重新上传。'\);[\s\S]*\}/, '空 upload_id 必须进入 failed，不能伪装 ready');
assert.match(uploadBlock, /status: 'failed'/);

const requirementStart = page.indexOf('async function updateCreativeAssetRequirement');
const deleteStart = page.indexOf('async function deleteCreativeAsset', requirementStart);
assert.ok(requirementStart > 0 && deleteStart > requirementStart, '应定义使用约束更新与删除处理器');
const requirementBlock = page.slice(requirementStart, deleteStart);
assert.match(requirementBlock, /asset\.status !== 'ready'/, 'PATCH 只能从 ready 发起');
assert.match(requirementBlock, /status: 'updating_requirement'/);
assert.match(requirementBlock, /api\.updateCreativeVisualAssetRequirement/);
assert.match(requirementBlock, /response\?\.asset\?\.requirement \|\| nextRequirement/, 'PATCH 成功后使用服务端确认值');
assert.match(requirementBlock, /requirement: previousRequirement[\s\S]*status: 'ready'/, 'PATCH 失败应恢复旧值和 ready');

const deleteEnd = page.indexOf('async function submitCreativeWorkflow', deleteStart);
assert.ok(deleteEnd > deleteStart, '删除处理器应位于提交处理器之前');
const deleteBlock = page.slice(deleteStart, deleteEnd);
assert.match(deleteBlock, /asset\.status === 'failed' && !asset\.upload_id/);
assert.match(deleteBlock, /status: 'deleting'/);
assert.match(deleteBlock, /api\.deleteCreativeVisualAsset/);
assert.match(deleteBlock, /status: 'ready'/, 'DELETE 失败应恢复 ready');
assert.match(deleteBlock, /URL\.revokeObjectURL/);

assert.match(page, /const hasPendingAssetRequest = uploadedAssets\.some\(asset => \['uploading', 'updating_requirement', 'deleting'\]\.includes\(asset\.status\)\)/);
assert.match(page, /const submitDisabled = isBusy \|\| !input\.trim\(\) \|\| hasPendingAssetRequest/);
assert.match(page, /if \(isBusy \|\| !trimmed \|\| uploadedAssetsRef\.current\.some\(asset => \['uploading', 'updating_requirement', 'deleting'\]\.includes\(asset\.status\)\)\) \{/);
assert.match(page, /assetIds: uploadedAssetsRef\.current[\s\S]*filter\(asset => asset\.status === 'ready' && asset\.upload_id\)[\s\S]*map\(asset => asset\.upload_id\)/);
assert.match(page, /function startNewTask\(\)[\s\S]*clearUploadedAssets\(\{ deleteStaged: true \}\)/, '开始新任务应清理未认领暂存图');

const submitStart = page.indexOf('async function submitCreativeWorkflow');
const submitEnd = page.indexOf('useEffect(() => {', submitStart);
assert.ok(submitStart > 0 && submitEnd > submitStart, '应截取完整创建任务处理器');
const submitBlock = page.slice(submitStart, submitEnd);
const nextWorkflowIdIndex = submitBlock.indexOf('const nextWorkflowId = getWorkflowId(json)');
const missingWorkflowIdStart = submitBlock.indexOf('if (!nextWorkflowId) {', nextWorkflowIdIndex);
const missingWorkflowIdReturn = submitBlock.indexOf('return;', missingWorkflowIdStart);
const missingWorkflowIdClose = submitBlock.indexOf('\n      }', missingWorkflowIdReturn);
assert.ok(nextWorkflowIdIndex >= 0 && missingWorkflowIdStart > nextWorkflowIdIndex, '应先解析并检查 workflow ID');
assert.ok(missingWorkflowIdReturn > missingWorkflowIdStart && missingWorkflowIdClose > missingWorkflowIdReturn, '应精确定位缺失 workflow ID 分支的 return 和闭合括号');
const missingWorkflowIdBlock = submitBlock.slice(missingWorkflowIdStart, missingWorkflowIdClose + '\n      }'.length);
assert.match(missingWorkflowIdBlock, /return;/, '缺失 workflow ID 分支必须在清理前返回');
assert.doesNotMatch(missingWorkflowIdBlock, /clearUploadedAssets/, '缺失 workflow ID 时不得清理素材');
const normalClearIndex = submitBlock.indexOf('clearUploadedAssets({ deleteStaged: false })', missingWorkflowIdClose + 1);
assert.ok(normalClearIndex > missingWorkflowIdClose, '正常有效 workflow ID 的清理必须位于缺失 ID 分支闭合之后');

const invalidMissingWorkflowIdBlock = missingWorkflowIdBlock.replace(
  'return;',
  'clearUploadedAssets({ deleteStaged: false });\n        return;',
);
assert.throws(
  () => assert.doesNotMatch(invalidMissingWorkflowIdBlock, /clearUploadedAssets/),
  { name: 'AssertionError' },
  'mutation fixture 应证明断言能抓到缺失 workflow ID 分支的过早清理',
);

const catchStart = submitBlock.lastIndexOf('} catch (error) {');
const catchBlock = submitBlock.slice(catchStart);
assert.match(catchBlock, /const persistedWorkflowId = String\(error\?\.data\?\.workflow_id \|\| ''\)\.trim\(\)/, 'catch 应识别已经持久化的 workflow');
const persistedBranchMatch = catchBlock.match(/if \(persistedWorkflowId\) \{([\s\S]*?)\n\s*\}/);
assert.ok(persistedBranchMatch, 'catch 应包含已持久化 workflow 分支');
assert.match(persistedBranchMatch[1], /clearUploadedAssets\(\{ deleteStaged: false \}\)/, '已认领素材只清本地状态，不能 DELETE');
assert.match(persistedBranchMatch[1], /任务已创建，但后台启动失败/);
assert.match(persistedBranchMatch[1], /persistedWorkflowId/, '错误文案应包含可定位 workflow ID');
const ordinaryFailureBranch = catchBlock.slice(catchBlock.indexOf(persistedBranchMatch[0]) + persistedBranchMatch[0].length);
assert.doesNotMatch(ordinaryFailureBranch, /clearUploadedAssets/, '没有 workflow ID 的网络、校验或认领失败应保留素材重试');

assert.match(page, /uploadedAssetsRef\.current\.forEach\(asset => URL\.revokeObjectURL\(asset\.previewUrl\)\)/, '卸载应从 ref 清理最新预览 URL');
assert.match(page, /useEffect\(\(\) => \(\) => \{[\s\S]*uploadedAssetsRef\.current[\s\S]*URL\.revokeObjectURL/, '卸载清理应使用 ref 而非旧 state 闭包');

console.log('creative upload ui tests passed');
