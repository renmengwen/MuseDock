import assert from 'assert/strict';
import fs from 'fs';

const source = fs.readFileSync('frontend-react/src/components/creative/CreativeTaskDetail.jsx', 'utf8');

assert.match(source, /SourceImageAssetsPanel/);
assert.match(source, /来源图片素材/);
assert.match(source, /image_analysis/);
assert.match(source, /asset_usage_report/);
assert.match(source, /最终未引用/);
assert.match(source, /assetContext\?\.image_analysis\?\.status \|\| assetContext\?\.status/);

console.log('creative task detail assets ui tests passed');
