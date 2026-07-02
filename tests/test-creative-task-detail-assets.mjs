import assert from 'assert/strict';
import fs from 'fs';

const source = fs.readFileSync('frontend-react/src/components/creative/CreativeTaskDetail.jsx', 'utf8');

assert.match(source, /SourceImageAssetsPanel/);
assert.match(source, /来源图片素材/);
assert.match(source, /image_analysis/);
assert.match(source, /asset_usage_report/);
assert.match(source, /最终未引用/);
assert.match(source, /hasUsageReport/);
assert.match(source, /未生成/);
assert.match(source, /assetContext\?\.image_analysis\?\.status \|\| assetContext\?\.status/);
assert.match(source, /SourceImageThumbnail/);
assert.match(source, /<img[\s\S]*src=\{src\}/);
assert.match(source, /查看图片列表/);
assert.match(source, /\/api\/creative-workflows\/\$\{encodeURIComponent\(workflowId\)\}\/assets\/\$\{encodeURIComponent\(assetId\)\}\/file/);
assert.match(source, /w-\[min\(1080px,calc\(100vw-32px\)\)\]/);
assert.match(source, /sharedAnalysisMessage/);

console.log('creative task detail assets ui tests passed');
