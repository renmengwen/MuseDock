import assert from 'assert/strict';
import fs from 'fs';

// 来源图片素材 UI 已从 CreativeTaskDetail 拆分为独立的 SourceImageAssetsPanel：
// detail 只断言组合关系，面板能力断言针对面板源码
const detail = fs.readFileSync('frontend-react/src/components/creative/CreativeTaskDetail.jsx', 'utf8');
const panel = fs.readFileSync('frontend-react/src/components/creative/SourceImageAssetsPanel.jsx', 'utf8');

assert.match(detail, /SourceImageAssetsPanel/);
assert.match(detail, /<SourceImageAssetsPanel/);

assert.match(panel, /来源图片素材/);
assert.match(panel, /image_analysis/);
assert.match(panel, /asset_usage_report/);
assert.match(panel, /最终未引用/);
assert.match(panel, /hasUsageReport/);
assert.match(panel, /未生成/);
assert.match(panel, /assetContext\?\.image_analysis\?\.status \|\| assetContext\?\.status/);
assert.match(panel, /SourceImageThumbnail/);
assert.match(panel, /<img[\s\S]*src=\{src\}/);
assert.match(panel, /查看图片列表/);
assert.match(panel, /\/api\/creative-workflows\/\$\{encodeURIComponent\(workflowId\)\}\/assets\/\$\{encodeURIComponent\(assetId\)\}\/file/);
assert.match(panel, /w-\[min\(1080px,calc\(100vw-32px\)\)\]/);
assert.match(panel, /sharedAnalysisMessage/);

console.log('creative task detail assets ui tests passed');
