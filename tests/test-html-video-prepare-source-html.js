const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const { injectRenderCsp, prepareSourceHtml } = require('../server/services/creative-video/html-video/prepareSourceHtml');

(async () => {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-video-prepare-'));
  try {
    for (const html of [
      '\uFEFF \t\r\n\f<!doctype html><!-- prolog --><HtMl lang="zh"><HeAd\tdata-x="a>b"></HeAd><body></body></HtMl>',
      '<!declaration data-x="a>b"><html><head/></html>',
      '<html/>',
      '<html data-x="backslash\\"><head></head></html>',
      '<!-- <head>fake</head> --><html data-description="<head>"><body></body></html>',
      '<html><head-x></head-x><head></head><body></body></html>',
      '<html><head:foo></head:foo><head></head><body></body></html>',
    ]) {
      const secured = injectRenderCsp(html);
      assert.equal((secured.match(/Content-Security-Policy/g) || []).length, 1);
    }
    for (const html of [
      '<header></header>',
      '<head-x></head-x>',
      '<head:foo></head:foo>',
      '<!-- unclosed <head>',
      '<!doctype html',
      '<html data-x="unclosed><body></body></html>',
      '<html><head data-x="unclosed></head></html>',
      '<html><head-x data-x="unclosed></html>',
    ]) {
      assert.throws(() => injectRenderCsp(html), /无法安全注入|缺少可安全注入|head 之前/);
    }

    const singlePath = path.join(workDir, 'single.html');
    await fsp.writeFile(singlePath, '<html><body><h1>单文件模板</h1></body></html>', 'utf8');

    const single = await prepareSourceHtml(singlePath, { projectDir: workDir });
    assert.notEqual(single.loadPath, singlePath);
    assert.equal(typeof single.cleanup, 'function');
    const securedSingle = await fsp.readFile(single.loadPath, 'utf8');
    assert.match(securedSingle, /<head>\s*<meta http-equiv="Content-Security-Policy"/i);
    assert.match(securedSingle, /default-src 'none'/);
    assert.match(securedSingle, /img-src file:/);
    assert.doesNotMatch(securedSingle, /img-src[^;]*(?:data:|blob:)/);
    await single.cleanup();
    assert.equal(fs.existsSync(single.loadPath), false);

    const weakCspPath = path.join(workDir, 'weak-csp.html');
    await fsp.writeFile(weakCspPath, '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><title>x</title></head><body></body></html>', 'utf8');
    const weakCsp = await prepareSourceHtml(weakCspPath, { projectDir: workDir });
    const hardened = await fsp.readFile(weakCsp.loadPath, 'utf8');
    assert.equal((hardened.match(/Content-Security-Policy/g) || []).length, 1, '已有 CSP 必须替换为唯一强策略');
    assert.doesNotMatch(hardened, /default-src \*/);
    await weakCsp.cleanup();

    const unsafePrefixPath = path.join(workDir, 'unsafe-prefix.html');
    await fsp.writeFile(unsafePrefixPath, '<script src="before-head.js"></script><html><head></head><body></body></html>', 'utf8');
    await assert.rejects(() => prepareSourceHtml(unsafePrefixPath, { projectDir: workDir }), /head 之前包含资源节点/);

    const outsideDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-video-prepare-outside-'));
    try {
      const outsideSource = path.join(outsideDir, 'outside.html');
      await fsp.writeFile(outsideSource, '<html><head></head><body>secret</body></html>', 'utf8');
      await assert.rejects(() => prepareSourceHtml(outsideSource, { projectDir: workDir }), /工程目录/);
      const escapedComposition = path.join(workDir, 'escaped-composition.html');
      await fsp.writeFile(escapedComposition, `<html><head></head><body><div data-composition-src="../${path.basename(outsideDir)}/outside.html"></div></body></html>`, 'utf8');
      await assert.rejects(() => prepareSourceHtml(escapedComposition, { projectDir: workDir }), /composition/);
      const junction = path.join(workDir, 'outside-junction');
      try {
        await fsp.symlink(outsideDir, junction, process.platform === 'win32' ? 'junction' : 'dir');
        const junctionComposition = path.join(workDir, 'junction-composition.html');
        await fsp.writeFile(junctionComposition, '<html><head></head><body><div data-composition-src="outside-junction/outside.html"></div></body></html>', 'utf8');
        await assert.rejects(() => prepareSourceHtml(junctionComposition, { projectDir: workDir }), /composition/);
      } catch (error) {
        if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
        console.log(`skip junction prepare test: ${error.code}`);
      }
    } finally {
      await fsp.rm(outsideDir, { recursive: true, force: true });
    }

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

    const prepared = await prepareSourceHtml(sourcePath, { projectDir: workDir });
    assert.notEqual(prepared.loadPath, sourcePath);
    assert.ok(fs.existsSync(prepared.loadPath), '应写入临时 HTML');

    const inlined = await fsp.readFile(prepared.loadPath, 'utf8');
    assert.ok(inlined.includes('window.__COMPOSITIONS__'), '应注入 composition map');
    assert.ok(inlined.includes('compositions/intro.html'), '应保留 composition src key');
    assert.ok(inlined.includes('组合片段'), '应内联 composition HTML');
    assert.ok(inlined.includes('window.__hvPlayAll = function'), '应注入统一播放入口');
    assert.match(inlined, /!window\.__mpAdapterControlled\s*&&\s*!window\.__hvPlayed/, 'adapter 受控模式不得触发 250ms auto play');
    assert.ok(inlined.includes('window.__timelines=window.__timelines||{}'), '应初始化 timeline registry');
    assert.match(inlined, /<head>\s*<meta http-equiv="Content-Security-Policy"/i, 'CSP 必须是 head 首个有效节点');
    assert.doesNotMatch(inlined, /data:video\/mp4/, '空视频占位不得产生 data 资源请求');

    assert.equal(typeof prepared.cleanup, 'function');
    await prepared.cleanup();
    assert.equal(fs.existsSync(prepared.loadPath), false, 'cleanup 应删除临时 HTML');

    console.log('html-video prepare source html tests passed');
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
})();
