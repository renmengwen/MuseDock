const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { syncRawHtmlFrameTextPatch } = require('../server/services/creative-video/html-video/rawHtmlTextPatch');

(async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-video-raw-text-'));
  fs.mkdirSync(path.join(projectDir, 'frames'), { recursive: true });
  const htmlPath = path.join(projectDir, 'frames', '01-scene_01.html');
  fs.writeFileSync(htmlPath, [
    '<!doctype html><html><body>',
    '<h1 data-text-key="headline"><span>旧标题</span></h1>',
    '<div data-text-key="keywords"><span>旧关键词</span></div>',
    '<div data-text-key="cards"><span>旧卡片</span></div>',
    '</body></html>',
  ].join(''), 'utf-8');

  const result = await syncRawHtmlFrameTextPatch({
    projectDir,
    project: {
      frames: [{
        id: 'scene_01',
        source_mode: 'raw_html',
        html_path: 'frames/01-scene_01.html',
      }],
    },
    editPatch: {
      type: 'frame_patch',
      frame_id: 'scene_01',
      metadata_patch: {
        visual_text: {
          headline: '新标题',
          keywords: ['关键词一', '关键词二'],
          cards: ['卡片一', '卡片二'],
        },
      },
    },
  });

  assert.equal(result.updated, true);
  assert.deepEqual(result.updated_keys.sort(), ['cards', 'headline', 'keywords']);
  const html = fs.readFileSync(htmlPath, 'utf-8');
  assert.match(html, /data-text-key="headline">新标题<\/h1>/);
  assert.match(html, /data-text-key="keywords">关键词一 \/ 关键词二<\/div>/);
  assert.match(html, /data-text-key="cards">卡片一 \/ 卡片二<\/div>/);
  assert.doesNotMatch(html, /旧标题|旧关键词|旧卡片/);

  console.log('html-video raw html text patch tests passed');
})();
