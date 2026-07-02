const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-video-asset-usage-'));
fs.mkdirSync(path.join(projectDir, 'frames'), { recursive: true });
fs.writeFileSync(
  path.join(projectDir, 'frames', '01.html'),
  '<!doctype html><html><body><img src="../assets/a.png"></body></html>',
  'utf8',
);
fs.writeFileSync(
  path.join(projectDir, 'frames', '02.html'),
  '<!doctype html><html><body><!-- ../assets/b.png --><script>const unused="../assets/b.png"</script><main>无图片</main></body></html>',
  'utf8',
);
fs.writeFileSync(
  path.join(projectDir, 'frames', '03.html'),
  '<!doctype html><html><body><div style="background-image:url(../assets/c.png)"></div></body></html>',
  'utf8',
);

const report = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [
      { id: 'scene_01', html_path: 'frames/01.html' },
      { id: 'scene_02', html_path: 'frames/02.html' },
      { id: 'scene_03', html_path: 'frames/03.html' },
    ],
  },
  creativeContext: {
    asset_context: {
      assets: [
        { id: 'article_01', path: 'assets/a.png', frame_src: '../assets/a.png' },
        { id: 'article_02', path: 'assets/b.png', frame_src: '../assets/b.png' },
        { id: 'article_03', path: 'assets/c.png', frame_src: '../assets/c.png' },
      ],
    },
  },
});

assert.equal(report.status, 'ready');
assert.equal(report.assets.find(asset => asset.asset_id === 'article_01').used, true);
assert.equal(report.assets.find(asset => asset.asset_id === 'article_01').usage_count, 1);
assert.deepEqual(report.assets.find(asset => asset.asset_id === 'article_01').used_in_frames, ['scene_01']);
assert.equal(report.assets.find(asset => asset.asset_id === 'article_02').used, false);
assert.equal(report.assets.find(asset => asset.asset_id === 'article_03').used, true);
assert.deepEqual(report.assets.find(asset => asset.asset_id === 'article_03').used_in_frames, ['scene_03']);
assert.deepEqual(report.used_asset_ids, ['article_01', 'article_03']);
assert.deepEqual(report.unused_asset_ids, ['article_02']);
assert.match(report.summary, /最终 HTML 使用了 2 张来源图片/);

const emptyReport = workflow.buildAssetUsageReport({
  project: { frames: [] },
  projectDir,
  creativeContext: { asset_context: { assets: [] } },
});
assert.equal(emptyReport.status, 'empty');
assert.deepEqual(emptyReport.used_asset_ids, []);
assert.deepEqual(emptyReport.unused_asset_ids, []);

console.log('html-video asset usage tests passed');
