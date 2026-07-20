import assert from 'assert/strict';
import fs from 'fs';

// 来源图片素材 UI 已从 CreativeTaskDetail 拆分为独立的 SourceImageAssetsPanel：
// detail 只断言组合关系，面板能力断言针对面板源码
const detail = fs.readFileSync('frontend-react/src/components/creative/CreativeTaskDetail.jsx', 'utf8');
const panel = fs.readFileSync('frontend-react/src/components/creative/SourceImageAssetsPanel.jsx', 'utf8');
const source = `${detail}\n${panel}`;

function functionBody(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `缺少函数 ${name}`);
  const openingParen = text.indexOf('(', start);
  let parenthesisDepth = 0;
  let closingParen = -1;
  for (let index = openingParen; index < text.length; index += 1) {
    if (text[index] === '(') parenthesisDepth += 1;
    if (text[index] === ')') parenthesisDepth -= 1;
    if (parenthesisDepth === 0) {
      closingParen = index;
      break;
    }
  }
  assert.ok(closingParen >= 0, `函数 ${name} 参数未闭合`);
  const openingBrace = text.indexOf('{', closingParen);
  let depth = 0;
  for (let index = openingBrace; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  assert.fail(`函数 ${name} 未闭合`);
}

function assertBefore(text, first, second) {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  assert.ok(firstIndex >= 0, `缺少 ${first}`);
  assert.ok(secondIndex >= 0, `缺少 ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} 必须先于 ${second}`);
}

const DUPLICATE_GUARD_PATTERN = /if\s*\(\s*!id\s*\|\|\s*seen\.has\(id\)\s*\)\s*(?:\{\s*)?return\s*;/;

function assertFormalOriginPrecedence(text) {
  assertBefore(text, 'asset?.origin', 'inferAssetSource');
  const originReturn = text.match(/if\s*\(\s*origin\s*\)\s*(?:\{\s*)?return\s+origin\s*;/);
  assert.ok(originReturn, 'formal origin 必须直接返回');
  assert.ok(originReturn.index < text.indexOf('inferAssetSource'), 'formal origin 返回必须先于 legacy source');
}

function assertMergeSemantics(text) {
  const duplicateGuard = text.match(DUPLICATE_GUARD_PATTERN);
  assert.ok(duplicateGuard, 'duplicate guard 必须在 seen.has(id) 命中时 return');
  const mergedPushIndex = text.indexOf('merged.push');
  assert.ok(mergedPushIndex >= 0, '缺少 merged.push');
  assert.ok(duplicateGuard.index < mergedPushIndex, 'duplicate guard 必须先于 merged.push');
  assertBefore(text, 'assets.forEach', 'usageAssets.forEach');
  const usageLoopStart = text.indexOf('usageAssets.forEach');
  const usageLoopEnd = text.indexOf('return merged', usageLoopStart);
  assert.ok(usageLoopEnd > usageLoopStart, 'usage loop 必须位于 return merged 前');
  assert.match(text.slice(usageLoopStart, usageLoopEnd), /pushAsset\s*\(/);
}

const inferAssetOriginBody = functionBody(panel, 'inferAssetOrigin');
const inferAssetTabKeyBody = functionBody(panel, 'inferAssetTabKey');
const sourceLabelBody = functionBody(panel, 'sourceLabel');
const protocolLabelBody = functionBody(panel, 'protocolLabel');
const mergeVisualAssetsBody = functionBody(panel, 'mergeVisualAssets');
const assetCardBody = functionBody(panel, 'SourceImageAssetCard');

assert.match(detail, /SourceImageAssetsPanel/);
assert.match(detail, /<SourceImageAssetsPanel/);
assert.doesNotMatch(detail, /!\s*isDone\s*\?\s*<SourceImageAssetsPanel/);
assert.match(source, /视觉路由/);
assert.match(source, /画面帧/);
assert.match(source, /风格/);

assert.match(panel, /视觉素材/);
assert.match(panel, /AI 生图/);
assert.match(panel, /mergeVisualAssets/);
assert.match(panel, /image_analysis/);
assert.match(panel, /asset_usage_report/);
assert.match(panel, /最终未引用/);
assert.match(panel, /hasUsageReport/);
assert.match(panel, /未生成/);
assert.match(panel, /assetContext\?\.image_analysis\?\.status \|\| assetContext\?\.status/);
assert.match(panel, /SourceImageThumbnail/);
assert.match(panel, /<img[\s\S]*src=\{src\}/);
assert.match(panel, /查看视觉素材/);
assert.match(panel, /\/api\/creative-workflows\/\$\{encodeURIComponent\(workflowId\)\}\/assets\/\$\{encodeURIComponent\(assetId\)\}\/file/);
assert.match(panel, /w-\[min\(1080px,calc\(100vw-32px\)\)\]/);
assert.match(panel, /sharedAnalysisMessage/);

for (const label of [
  '用户上传',
  '来源提取',
  '页面截图',
  'AI 生图',
  '图库补图',
  '衍生素材',
  '必须使用',
  '优先使用',
  '可选',
  '来源证据',
  '用户提供',
  'AI 合成',
  '情境素材',
  '来源派生',
  '父素材',
]) {
  assert.match(panel, new RegExp(label));
}
assert.match(panel, /asset\?\.origin/);
assert.match(panel, /asset\?\.requirement/);
assert.match(panel, /asset\?\.evidence_class/);
assert.match(panel, /asset\?\.source/);
for (const [sourceKey, origin] of Object.entries({
  upload: 'user_upload',
  article: 'source_extract',
  github: 'source_extract',
  readme: 'source_extract',
  github_readme: 'source_extract',
  generated: 'ai_generated',
  ai_generated: 'ai_generated',
  pexels: 'stock_search',
  search: 'stock_search',
})) {
  assert.match(panel, new RegExp(`${sourceKey}:\\s*['"]${origin}['"]`));
}
assert.match(panel, /startsWith\(['"]gen_['"]\)/);
assert.match(panel, /startsWith\(['"]search_['"]\)/);
assert.match(panel, /asset\?\.media_type\s*\|\|\s*asset\?\.type/);
assert.match(panel, /parent_asset_id/);
assert.match(panel, /ai_generated:\s*['"]AI 生图['"]/);
assert.match(panel, /synthetic:\s*['"]AI 合成['"]/);
assert.match(panel, /<TabsList className="(?=[^"]*\bh-auto\b)(?=[^"]*\bmax-w-full\b)(?=[^"]*\bflex-wrap\b)(?=[^"]*\bjustify-start\b)[^"]*">/);

assertFormalOriginPrecedence(inferAssetOriginBody);
assertBefore(inferAssetTabKeyBody, "return 'video'", 'inferAssetOrigin');
assert.match(sourceLabelBody, /ORIGIN_LABEL_TEXT\[origin\]\s*\|\|\s*['"]视觉素材['"]/);
assert.match(protocolLabelBody, /\|\|\s*['"]['"]/);
assertMergeSemantics(mergeVisualAssetsBody);
assert.match(assetCardBody, /const parentAssetId = firstText\(asset\.parent_asset_id\)/);
assert.match(assetCardBody, /parentAssetId[\s\S]*break-all[\s\S]*父素材：\{parentAssetId\}/);
assert.match(assetCardBody, /const shotUsages = Array\.isArray\(usage\?\.shot_usages\)/);
assert.match(assetCardBody, /usage\.shot_usages/);
assert.match(assetCardBody, /场景：\{shotUsage\.scene_id\}/);
assert.match(assetCardBody, /镜头：\{shotUsage\.shot_id\}/);
assert.match(assetCardBody, /字幕：/);
assert.match(assetCardBody, /可见时长：\{shotUsage\.visible_duration_sec\} 秒/);
assert.doesNotMatch(assetCardBody, /end_sec\s*-\s*[^\n]*start_sec/, '前端不得重新计算 canonical 可见时长');

assert.throws(() => assertFormalOriginPrecedence(
  'const source = inferAssetSource(asset); const origin = asset?.origin; if (origin) return origin;',
), { name: 'AssertionError' });
assert.throws(() => assertBefore(
  "const origin = inferAssetOrigin(asset); if (type === 'video') return 'video';",
  "return 'video'",
  'inferAssetOrigin',
), { name: 'AssertionError' });

const withoutDuplicateReturn = mergeVisualAssetsBody.replace(DUPLICATE_GUARD_PATTERN, '');
assert.notEqual(withoutDuplicateReturn, mergeVisualAssetsBody);
assert.throws(() => assertMergeSemantics(withoutDuplicateReturn), { name: 'AssertionError' });

const swappedLoops = mergeVisualAssetsBody
  .replace('assets.forEach', '__usage_loop__')
  .replace('usageAssets.forEach', 'assets.forEach')
  .replace('__usage_loop__', 'usageAssets.forEach');
assert.notEqual(swappedLoops, mergeVisualAssetsBody);
assert.throws(() => assertMergeSemantics(swappedLoops), { name: 'AssertionError' });

const usageLoopStart = mergeVisualAssetsBody.indexOf('usageAssets.forEach');
const usageLoopEnd = mergeVisualAssetsBody.indexOf('return merged', usageLoopStart);
const usageLoop = mergeVisualAssetsBody.slice(usageLoopStart, usageLoopEnd);
const usageLoopWithoutPush = usageLoop.replace(/pushAsset\s*\(/, 'skipAsset(');
assert.notEqual(usageLoopWithoutPush, usageLoop);
const withoutUsagePush = `${mergeVisualAssetsBody.slice(0, usageLoopStart)}${usageLoopWithoutPush}${mergeVisualAssetsBody.slice(usageLoopEnd)}`;
assert.throws(() => assertMergeSemantics(withoutUsagePush), { name: 'AssertionError' });

console.log('creative task detail assets ui tests passed');
