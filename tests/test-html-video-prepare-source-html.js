const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const { prepareSourceHtml } = require('../server/services/creative-video/html-video/prepareSourceHtml');

(async () => {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-video-prepare-'));
  try {
    const singlePath = path.join(workDir, 'single.html');
    await fsp.writeFile(singlePath, '<html><body><h1>单文件模板</h1></body></html>', 'utf8');

    const single = await prepareSourceHtml(singlePath);
    assert.equal(single.loadPath, singlePath);
    assert.equal(single.cleanup, undefined);

    const compositionsDir = path.join(workDir, 'compositions');
    await fsp.mkdir(compositionsDir);
    const compositionPath = path.join(compositionsDir, 'intro.html');
    await fsp.writeFile(
      compositionPath,
      [
        '<template>',
        '  <section class="scene">组合片段</section>',
        '  <script>window.__timelines.intro = { play: function () {} };<\/script>',
        '</template>',
      ].join('\n'),
      'utf8',
    );

    const sourcePath = path.join(workDir, 'index.html');
    await fsp.writeFile(
      sourcePath,
      [
        '<html><head><title>入口</title></head><body>',
        '<div id="slot" data-composition-src="compositions/intro.html"></div>',
        '</body></html>',
      ].join('\n'),
      'utf8',
    );

    const prepared = await prepareSourceHtml(sourcePath);
    assert.notEqual(prepared.loadPath, sourcePath);
    assert.ok(fs.existsSync(prepared.loadPath), '应写入临时 HTML');

    const inlined = await fsp.readFile(prepared.loadPath, 'utf8');
    assert.ok(inlined.includes('window.__COMPOSITIONS__'), '应注入 composition map');
    assert.ok(inlined.includes('compositions/intro.html'), '应保留 composition src key');
    assert.ok(inlined.includes('组合片段'), '应内联 composition HTML');
    assert.ok(inlined.includes('window.__hvPlayAll = function'), '应注入统一播放入口');
    assert.ok(inlined.includes('window.__timelines=window.__timelines||{}'), '应初始化 timeline registry');

    assert.equal(typeof prepared.cleanup, 'function');
    await prepared.cleanup();
    assert.equal(fs.existsSync(prepared.loadPath), false, 'cleanup 应删除临时 HTML');

    console.log('html-video prepare source html tests passed');
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
})();
