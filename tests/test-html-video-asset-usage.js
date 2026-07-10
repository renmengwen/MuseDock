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
fs.writeFileSync(
  path.join(projectDir, 'frames', '04.html'),
  '<!doctype html><html><body><img src="https://cdn.example.com/assets/generated-image-01.jpg"></body></html>',
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
assert.match(report.summary, /最终 HTML 使用了 2 张视觉素材/);

const requiredReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [
      { id: 'scene_01', scene_id: 'scene_01', html_path: 'frames/01.html' },
      { id: 'scene_02', scene_id: 'scene_02', html_path: 'frames/02.html' },
    ],
    assets: [{ id: 'gen_scene_02', source: 'generated', path: 'assets/b.png', frame_src: '../assets/b.png' }],
    content_graph: {
      nodes: [
        { id: 'scene_01', asset_refs: [{ asset_id: 'article_01', usage: 'showcase' }] },
        { id: 'scene_02', asset_refs: [{ asset_id: 'gen_scene_02', usage: 'subject' }] },
      ],
    },
  },
  creativeContext: {
    asset_context: {
      assets: [
        { id: 'article_01', source: 'article', path: 'assets/a.png', frame_src: '../assets/a.png' },
      ],
    },
  },
});
assert.deepEqual(requiredReport.required_asset_ids, ['article_01', 'gen_scene_02']);
assert.deepEqual(requiredReport.missing_required_asset_ids, ['gen_scene_02']);
assert.deepEqual(requiredReport.assets.find(asset => asset.asset_id === 'article_01').expected_in_frames, ['scene_01']);
assert.equal(requiredReport.assets.find(asset => asset.asset_id === 'gen_scene_02').source, 'generated');
assert.match(requiredReport.summary, /必用视觉素材未进入/);

const generatedRequiredReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{ id: 'scene_04', scene_id: 'scene_04', html_path: 'frames/02.html' }],
    assets: [{ id: 'gen_scene_04', source: 'generated', path: 'assets/b.png', frame_src: '../assets/b.png', generation: { scene_id: 'scene_04' } }],
    content_graph: { nodes: [{ id: 'scene_04' }] },
  },
  creativeContext: { asset_context: { assets: [] } },
});
assert.deepEqual(generatedRequiredReport.required_asset_ids, ['gen_scene_04']);
assert.deepEqual(generatedRequiredReport.missing_required_asset_ids, ['gen_scene_04']);
assert.deepEqual(generatedRequiredReport.assets[0].usage, ['generated']);

const remoteSuffixReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{ id: 'scene_remote', scene_id: 'scene_remote', html_path: 'frames/04.html' }],
    assets: [{
      id: 'gen_remote',
      source: 'generated',
      path: 'assets/generated-image-01.jpg',
      frame_src: '../assets/generated-image-01.jpg',
      generation: { scene_id: 'scene_remote' },
    }],
  },
  creativeContext: { asset_context: { assets: [] } },
});
assert.deepEqual(remoteSuffixReport.used_asset_ids, []);
assert.deepEqual(remoteSuffixReport.missing_required_asset_ids, ['gen_remote']);

const emptyReport = workflow.buildAssetUsageReport({
  project: { frames: [] },
  projectDir,
  creativeContext: { asset_context: { assets: [] } },
});
assert.equal(emptyReport.status, 'empty');
assert.deepEqual(emptyReport.used_asset_ids, []);
assert.deepEqual(emptyReport.unused_asset_ids, []);
assert.deepEqual(emptyReport.missing_required_asset_ids, []);

console.log('html-video asset usage tests passed');
