const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const freeformProject = require('../server/services/hyperframes/hyperframesFreeformProject');

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-freeform-project-'));
  const awemeId = '1234567890';
  const runId = '20260611-test-storyboard_plan';

  const projectDir = freeformProject.getFreeformProjectDir(awemeId, runId, rootDir);
  assert.ok(projectDir.endsWith(`${runId}-hyperframes-freeform`));
  assert.throws(() => freeformProject.getFreeformProjectDir(awemeId, '../evil', rootDir), /非法/);
  assert.throws(() => freeformProject.getFreeformProjectDir(awemeId, '..\\evil', rootDir), /非法/);

  const created = await freeformProject.createFreeformProject({
    awemeId,
    runId,
    rootDir,
    files: {
      'index.html': '<html><body>ok</body></html>',
      'design.md': '# Design',
      'hyperframes.json': '{}',
      'frame_specs.json': '{"frames":[]}',
      'package.json': '{"private":true}',
    },
  });

  assert.equal(created.success, true);
  assert.equal(fs.existsSync(path.join(projectDir, 'index.html')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'design.md')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'frame_specs.json')), true);
  assert.deepEqual(created.files.map(file => file.name).sort(), ['design.md', 'frame_specs.json', 'gsap.min.js', 'hyperframes.json', 'index.html', 'package.json']);

  const repaired = await freeformProject.createFreeformProject({
    awemeId,
    runId: `${runId}-repair`,
    rootDir,
    files: {
      'index.html': '<!doctype html><html><body><div id="stage" data-composition-id="main" style="font-family: Microsoft YaHei, PingFang SC, SFMono-Regular, sans-serif"></div></body></html>',
      'meta.json': '{"duration_sec":66}',
    },
  });
  const repairedHtml = fs.readFileSync(path.join(repaired.projectDir, 'index.html'), 'utf-8');
  assert.match(repairedHtml, /data-composition-id="main"/);
  assert.match(repairedHtml, /data-duration="66"/);
  assert.match(repairedHtml, /data-width="1080"/);
  assert.match(repairedHtml, /data-height="1920"/);
  assert.match(repairedHtml, /<div id="stage"[^>]*data-start="0"/);
  assert.doesNotMatch(repairedHtml, /<div id="stage"[^>]*data-track-index=/);
  assert.doesNotMatch(repairedHtml, /Microsoft YaHei|PingFang SC|SFMono-Regular|inter|jetbrains-mono/);
  assert.match(repairedHtml, /font-family: sans-serif, sans-serif, monospace, sans-serif/);

  const timelineRepaired = await freeformProject.createFreeformProject({
    awemeId,
    runId: `${runId}-timeline-repair`,
    rootDir,
    files: {
      'index.html': '<!doctype html><html><head></head><body><main id="root" data-composition-id="main"></main><script>function tick(){let t=((performance.now()/1000)%90);requestAnimationFrame(tick)}tick();</script></body></html>',
      'hyperframes.json': '{"duration":90,"width":1080,"height":1920}',
    },
  });
  const timelineHtml = fs.readFileSync(path.join(timelineRepaired.projectDir, 'index.html'), 'utf-8');
  assert.match(timelineHtml, /data-composition-id="main"/);
  assert.match(timelineHtml, /data-duration="90"/);
  assert.match(timelineHtml, /data-width="1080"/);
  assert.match(timelineHtml, /data-height="1920"/);
  assert.match(timelineHtml, /<main id="root"[^>]*data-start="0"/);
  assert.doesNotMatch(timelineHtml, /<main id="root"[^>]*data-track-index=/);
  assert.match(timelineHtml, /window\.__timelines/);
  assert.match(timelineHtml, /gsap\.timeline/);
  assert.doesNotMatch(timelineHtml, /performance\.now|requestAnimationFrame/);

  const lintRepaired = await freeformProject.createFreeformProject({
    awemeId,
    runId: `${runId}-lint-repair`,
    rootDir,
    files: {
      'index.html': [
        '<!doctype html><html lang="zh-CN" data-composition-variables=\'[{"id":"title","type":"text"}]\'>',
        '<head><style>html,body{font-family:noto-sans, open-sans, jetbrains-mono, sans-serif}[data-composition-id="main"]{color:white}</style></head>',
        '<body><div id="main" data-composition-id="main" data-duration="10">',
        '<section id="s1" class="scene" data-start="0" data-duration="5"></section>',
        '<section id="s2" class="scene" data-start="5" data-duration="5"></section>',
        '</div>',
        '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>',
        '<script>var tl = gsap.timeline(); gsap.to(".scan",{duration:6,repeat:-1}); tl.from(".scene",{y:10,opacity:0});</script>',
        '</body></html>',
      ].join(''),
      'hyperframes.json': '{"duration":10,"width":1920,"height":1080}',
    },
  });
  const lintHtml = fs.readFileSync(path.join(lintRepaired.projectDir, 'index.html'), 'utf-8');
  assert.doesNotMatch(lintHtml, /data-composition-variables/);
  assert.match(lintHtml, /<section id="s1" class="scene clip"/);
  assert.match(lintHtml, /<section id="s2" class="scene clip"/);
  assert.doesNotMatch(lintHtml, /repeat\s*:\s*-1|cdnjs\.cloudflare|var tl = gsap\.timeline\(\);/);
  assert.doesNotMatch(lintHtml, /font-family:[^;]*(noto-sans|open-sans|jetbrains-mono)/);
  assert.match(lintHtml, /window\.__timelines\["main"\] = tl/);
  assert.match(lintHtml, /tl\.set\("#s1", \{ autoAlpha: 1 \}, 0\)/);
  assert.match(lintHtml, /tl\.set\("#s1", \{ autoAlpha: 0 \}, 5\)/);
  assert.match(lintHtml, /tl\.set\("#s2", \{ autoAlpha: 1 \}, 5\)/);

  const floatBoundaryRepaired = await freeformProject.createFreeformProject({
    awemeId,
    runId: `${runId}-float-boundary-repair`,
    rootDir,
    files: {
      'index.html': [
        '<!doctype html><html><body><main id="main" data-composition-id="main" data-duration="10" data-track-index="0">',
        '<section id="s1" data-start="0" data-duration="55.440000000000005" data-track-index="0"></section>',
        '<section id="s2" data-start="55.44" data-duration="4" data-track-index="0"></section>',
        '</main></body></html>',
      ].join(''),
      'hyperframes.json': '{"duration":60,"width":1080,"height":1920}',
    },
  });
  const floatBoundaryHtml = fs.readFileSync(path.join(floatBoundaryRepaired.projectDir, 'index.html'), 'utf-8');
  assert.match(floatBoundaryHtml, /<main id="main"[^>]*data-start="0"/);
  assert.doesNotMatch(floatBoundaryHtml, /<main id="main"[^>]*data-track-index=/);
  assert.match(floatBoundaryHtml, /<section id="s1"[^>]*data-duration="55.44"/);
  assert.match(floatBoundaryHtml, /<section id="s2"[^>]*data-start="55.44"/);

  const emphasisOverflowRepaired = await freeformProject.createFreeformProject({
    awemeId,
    runId: `${runId}-emphasis-overflow-repair`,
    rootDir,
    files: {
      'index.html': [
        '<!doctype html><html><head><style>',
        '.hero-lock{min-height:360px;overflow:hidden;position:relative}',
        '.glitch-word{position:absolute;font-size:138px;font-weight:1000}',
        '</style></head><body><main id="main" data-composition-id="main" data-duration="8">',
        '<section id="s1" data-start="0" data-duration="8"><div class="hero-lock"><div class="glitch-word">卡住了</div></div></section>',
        '<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.from(".glitch-word",{scale:2.4,opacity:0,duration:.22},2.5);window.__timelines["main"]=tl;</script>',
        '</main></body></html>',
      ].join(''),
      'hyperframes.json': '{"duration":8,"width":1080,"height":1920}',
    },
  });
  const emphasisOverflowHtml = fs.readFileSync(path.join(emphasisOverflowRepaired.projectDir, 'index.html'), 'utf-8');
  assert.match(emphasisOverflowHtml, /<div class="hero-lock"[^>]*data-layout-allow-overflow/);

  const htmlRootProject = await freeformProject.createFreeformProject({
    awemeId,
    runId: `${runId}-html-root-stage`,
    rootDir,
    files: {
      'index.html': [
        '<!doctype html>',
        '<html lang="zh-CN" data-composition-id="main" data-start="0" data-duration="12" data-width="1080" data-height="1920">',
        '<head></head>',
        '<body><div class="stage" id="stage"><section id="s1" data-start="0" data-duration="12"></section></div></body>',
        '</html>',
      ].join(''),
      'hyperframes.json': '{"duration":12,"width":1080,"height":1920}',
    },
  });
  const htmlRoot = fs.readFileSync(path.join(htmlRootProject.projectDir, 'index.html'), 'utf-8');
  assert.doesNotMatch(htmlRoot, /<html[^>]*data-composition-id=/);
  assert.match(htmlRoot, /<div class="stage" id="stage"[^>]*data-composition-id="main"/);
  assert.match(htmlRoot, /<div class="stage" id="stage"[^>]*data-width="1080"/);
  assert.match(htmlRoot, /<div class="stage" id="stage"[^>]*data-height="1920"/);
  assert.match(htmlRoot, /<div class="stage" id="stage"[^>]*data-start="0"/);
  assert.doesNotMatch(htmlRoot, /<div class="stage" id="stage"[^>]*data-track-index=/);

  const animated = await freeformProject.createFreeformProject({
    awemeId,
    runId: `${runId}-registered-animation`,
    rootDir,
    files: {
      'index.html': [
        '<!doctype html><html><head></head><body>',
        '<main id="main" data-composition-id="main" data-duration="8">',
        '<section id="hero" class="scene" data-start="0" data-duration="4">',
        '<h1 class="hero-title">主题标题</h1>',
        '<span class="hero-keyword">关键词</span>',
        '</section>',
        '</main>',
        '<script>',
        'window.__timelines = window.__timelines || {};',
        'const tl = gsap.timeline({ paused: true });',
        'tl.from(".hero-title", { y: 44, autoAlpha: 0, duration: 0.6 }, 0);',
        'tl.fromTo(".hero-keyword", { scale: 0.7, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.4 }, 0.4);',
        'window.__timelines["main"] = tl;',
        '</script>',
        '</body></html>',
      ].join(''),
      'hyperframes.json': '{"duration":8,"width":1920,"height":1080}',
    },
  });
  const animatedHtml = fs.readFileSync(path.join(animated.projectDir, 'index.html'), 'utf-8');
  assert.match(animatedHtml, /window\.__timelines\["main"\] = tl/);
  assert.match(animatedHtml, /tl\.from\("\.hero-title"/);
  assert.match(animatedHtml, /tl\.fromTo\("\.hero-keyword"/);
  assert.match(animatedHtml, /<script src="\.\/gsap\.min\.js"><\/script>/);

  const clipVisibilityRepaired = await freeformProject.createFreeformProject({
    awemeId,
    runId: `${runId}-clip-visibility-repair`,
    rootDir,
    files: {
      'index.html': [
        '<!doctype html><html><head></head><body>',
        '<main id="main" data-composition-id="main" data-duration="38">',
        '<div id="scene1" class="scene" data-start="0" data-duration="11.36"></div>',
        '<div id="scene2" class="scene clip" data-start="11.36" data-duration="2.72" data-track-index="1">',
        '  <div id="error-text">上不了网</div>',
        '</div>',
        '<div id="scene3" class="scene clip" data-start="14.08" data-duration="12.64" data-track-index="2">',
        '  <div id="block1">Twitter</div>',
        '</div>',
        '</main>',
        '<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>',
        '<script>',
        'window.__timelines = window.__timelines || {};',
        'const tl = gsap.timeline({ paused: true });',
        'tl.set("#scene1", { visibility: "visible", opacity: 1 }, 0);',
        'tl.from("#agent1", { y: 60, opacity: 0, duration: 0.6 }, 0);',
        'tl.set("#scene1", { visibility: "hidden" }, 11.36);',
        'tl.set("#scene2", { visibility: "visible", opacity: 1 }, 11.36);',
        'tl.from("#error-text", { y: 60, opacity: 0, duration: 0.8 }, 11.36);',
        'tl.set("#scene2", { visibility: "hidden" }, 14.08);',
        'tl.set("#scene3", { visibility: "visible", opacity: 1 }, 14.08);',
        'tl.from("#block1", { x: -100, opacity: 0, duration: 0.5 }, 14.08);',
        'tl.set("#scene3", { visibility: "hidden" }, 26.72);',
        'window.__timelines["main"] = tl;',
        '</script>',
        '</body></html>',
      ].join('\n'),
      'hyperframes.json': '{"duration":38,"width":1080,"height":1920}',
    },
  });
  const clipVisHtml = fs.readFileSync(path.join(clipVisibilityRepaired.projectDir, 'index.html'), 'utf-8');
  // Clip elements should have clip class
  assert.match(clipVisHtml, /<div id="scene2" class="scene clip"/);
  assert.match(clipVisHtml, /<div id="scene3" class="scene clip"/);
  // Visibility set calls on clip elements should be removed (including opacity, since framework uses autoAlpha)
  assert.doesNotMatch(clipVisHtml, /\.set\("#scene1"/);
  assert.doesNotMatch(clipVisHtml, /\.set\("#scene2"/);
  assert.doesNotMatch(clipVisHtml, /\.set\("#scene3"/);
  // Child element animations should be preserved
  assert.match(clipVisHtml, /tl\.from\("#agent1"/);
  assert.match(clipVisHtml, /tl\.from\("#error-text"/);
  assert.match(clipVisHtml, /tl\.from\("#block1"/);
  // Registered timeline should be preserved
  assert.match(clipVisHtml, /window\.__timelines\["main"\] = tl/);

  const audioSourcePath = path.join(rootDir, 'freeform-narration.wav');
  fs.writeFileSync(audioSourcePath, 'fake narration audio');
  const withAudio = await freeformProject.createFreeformProject({
    awemeId,
    runId: `${runId}-audio`,
    rootDir,
    audio: {
      path: audioSourcePath,
      duration: 4.25,
      captions: [{ index: 1, start: 0, end: 4.25, text: '旁白' }],
    },
    files: {
      'index.html': '<!doctype html><html><body><main id="main" data-composition-id="main"></main></body></html>',
      'hyperframes.json': '{"width":1080,"height":1920}',
    },
  });
  const audioHtml = fs.readFileSync(path.join(withAudio.projectDir, 'index.html'), 'utf-8');
  assert.equal(fs.readFileSync(path.join(withAudio.projectDir, 'assets', 'narration.wav'), 'utf-8'), 'fake narration audio');
  assert.match(audioHtml, /<audio id="narration-audio"[^>]*data-duration="4.25"[^>]*src="assets\/narration\.wav"/);
  assert.match(audioHtml, /<audio id="narration-audio"[^>]*data-track-index="99"/);
  assert.doesNotMatch(audioHtml, /<audio id="narration-audio"[^>]*class="clip"/);
  assert.doesNotMatch(audioHtml, /#narration-audio/);

  const withGeneratedApiAudio = await freeformProject.createFreeformProject({
    awemeId,
    runId: `${runId}-generated-api-audio`,
    rootDir,
    audio: {
      path: audioSourcePath,
      url: '/api/agents/douyin/1234567890/runs/run-1/tts/run-1-tts.wav',
      duration: 6,
      captions: [{ index: 1, start: 0, end: 6, text: '鏃佺櫧' }],
    },
    files: {
      'index.html': [
        '<!doctype html><html><body>',
        '<main id="main" data-composition-id="main" data-start="0" data-duration="10" data-track-index="0">',
        '<audio id="voiceover" data-start="0" data-track-index="10" data-volume="1" src="/api/agents/douyin/1234567890/runs/run-1/tts/run-1-tts.wav"></audio>',
        '</main>',
        '</body></html>',
      ].join(''),
      'hyperframes.json': '{"width":1080,"height":1920}',
    },
  });
  const generatedApiAudioHtml = fs.readFileSync(path.join(withGeneratedApiAudio.projectDir, 'index.html'), 'utf-8');
  assert.equal(fs.readFileSync(path.join(withGeneratedApiAudio.projectDir, 'assets', 'narration.wav'), 'utf-8'), 'fake narration audio');
  assert.equal((generatedApiAudioHtml.match(/<audio\b/gi) || []).length, 1);
  assert.match(generatedApiAudioHtml, /<main id="main"[^>]*data-start="0"/);
  assert.doesNotMatch(generatedApiAudioHtml, /<main id="main"[^>]*data-track-index=/);
  assert.match(generatedApiAudioHtml, /<audio id="narration-audio"[^>]*data-start="0"[^>]*data-duration="6"[^>]*data-track-index="99"[^>]*src="assets\/narration\.wav"/);
  assert.doesNotMatch(generatedApiAudioHtml, /\/api\/agents\/douyin\/1234567890\/runs\/run-1\/tts\/run-1-tts\.wav/);

  const file = await freeformProject.readFreeformFile({ projectDir, fileName: 'design.md' });
  assert.equal(file.success, true);
  assert.equal(file.content, '# Design');

  const saved = await freeformProject.writeFreeformFile({
    projectDir,
    fileName: 'design.md',
    content: '# Updated',
  });
  assert.equal(saved.success, true);
  assert.equal(fs.readFileSync(path.join(projectDir, 'design.md'), 'utf-8'), '# Updated');

  assert.equal(freeformProject.resolveFreeformFile(projectDir, 'output.mp4'), path.join(projectDir, 'output.mp4'));
  await assert.rejects(
    () => freeformProject.writeFreeformFile({ projectDir, fileName: 'output.mp4', content: 'x' }),
    /不支持|文本/,
  );
  fs.writeFileSync(path.join(projectDir, 'contact_sheet.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  await assert.rejects(
    () => freeformProject.readFreeformFile({ projectDir, fileName: 'contact_sheet.jpg' }),
    /不支持|文本/,
  );

  assert.throws(() => freeformProject.resolveFreeformFile(projectDir, '../secret.txt'), /非法/);
  assert.throws(() => freeformProject.resolveFreeformFile(projectDir, '..\\secret.txt'), /非法/);
  assert.throws(() => freeformProject.resolveFreeformFile(projectDir, 'index.html/child'), /非法|不支持/);
  assert.throws(() => freeformProject.resolveFreeformFile(projectDir, 'assets/index.html'), /非法|不支持/);
  assert.throws(() => freeformProject.resolveFreeformFile(projectDir, 'unknown.txt'), /不支持/);
}

run().then(() => {
  console.log('hyperframes freeform project tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
