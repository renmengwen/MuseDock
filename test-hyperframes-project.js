const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hyperframesProject = require('./server/services/hyperframesProject');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperframes-project-test-'));
  const audioPath = path.join(root, 'narration-source.wav');
  fs.writeFileSync(audioPath, 'fake wav data');

  const runData = {
    run_id: '20260609-000000-000Z-abcdef-viral_rewrite',
    aweme_id: '1234567890',
    result: {
      rewrite_script: '第一句。第二句。',
    },
    tts: {
      path: audioPath,
      duration: 3.75,
      captions: [
        { index: 1, start: 0, end: 1.25, duration: 1.25, text: '第一句。' },
        { index: 2, start: 1.25, end: 3.75, duration: 2.5, text: '第二句。' },
      ],
    },
    storyboard: {
      template: 'ai_storyboard_cards',
      style: { visual_tone: '专业', palette: ['#101216', '#fe2c55'] },
      scenes: [
        {
          index: 1,
          caption_indexes: [1, 2],
          start: 0,
          end: 3.75,
          duration: 3.75,
          headline: '核心观点',
          visual_type: 'text_card',
          layout: 'center_focus',
          background_prompt: '原创抽象背景',
          emphasis_words: ['观点'],
          captions: [
            { index: 1, start: 0, end: 1.25, text: '第一句。' },
            { index: 2, start: 1.25, end: 3.75, text: '第二句。' },
          ],
        },
        {
          index: 2,
          caption_indexes: [2],
          start: 1.25,
          end: 3.75,
          duration: 2.5,
          headline: '传统 vs Vibe Coding',
          visual_type: 'contrast_card',
          layout: 'split_compare',
          background_prompt: '原创对比背景',
          emphasis_words: ['传统', 'Vibe Coding'],
          captions: [
            { index: 2, start: 1.25, end: 3.75, text: '第二句。' },
          ],
        },
      ],
    },
  };

  const result = await hyperframesProject.createOriginalCaptionProject({
    run: runData,
    projectDir: path.join(root, 'project'),
  });

  assert.equal(result.success, true);
  assert.equal(result.template, 'ai_storyboard_cards');
  assert.ok(fs.existsSync(result.project_dir));
  assert.ok(fs.existsSync(result.index_path));
  assert.ok(fs.existsSync(path.join(result.project_dir, 'storyboard.json')));
  assert.ok(fs.existsSync(path.join(result.project_dir, 'captions.json')));
  assert.ok(fs.existsSync(path.join(result.project_dir, 'project.json')));
  assert.ok(fs.existsSync(path.join(result.project_dir, 'assets', 'narration.wav')));

  const storyboard = JSON.parse(fs.readFileSync(path.join(result.project_dir, 'storyboard.json'), 'utf-8'));
  assert.equal(storyboard.scenes[0].headline, '核心观点');
  const captions = JSON.parse(fs.readFileSync(path.join(result.project_dir, 'captions.json'), 'utf-8'));
  assert.deepStrictEqual(captions.captions, runData.tts.captions);
  assert.equal(captions.duration, 3.75);

  const html = fs.readFileSync(result.index_path, 'utf-8');
  assert.match(html, /data-composition-id="ai-storyboard-cards"/);
  assert.match(html, /window\.__timelines/);
  assert.match(html, /<audio id="narration-audio"/);
  assert.match(html, /class="scene clip/);
  assert.match(html, /tl\.fromTo\("#scene-1"/);
  assert.match(html, /tl\.fromTo\("#scene-1 \.scene-content"/);
  assert.doesNotMatch(html, /tl\.from\("#scene-1 \.emphasis span"/);
  assert.match(html, /#scene-1 \.emphasis span:nth-child\(1\)/);
  assert.match(html, /tl\.to\("#scene-1"/);
  assert.match(html, /核心观点/);
  assert.match(html, /assets\/narration.wav/);
  assert.doesNotMatch(html, /<p>第一句。 第二句。<\/p>/);
  assert.doesNotMatch(html, /video\.mp4|frame-0001|frames\//);
  assert.match(html, /class="caption-bar"/);
  assert.match(html, /class="caption-line"/);
  assert.match(html, /data-caption-index="1"/);
  assert.match(html, /data-caption-index="2"/);
  assert.match(html, /#scene-1 \.caption-line:nth-child\(1\)/);
  assert.match(html, /#scene-1 \.caption-line:nth-child\(2\)/);

  const customProjectDir = path.join(root, 'custom-project');
  const customResult = await hyperframesProject.createOriginalCaptionProject({
    run: runData,
    projectDir: customProjectDir,
    renderOptions: {
      resolution: '720x1280',
      fps: '30',
      captionSize: 'large',
      motionLevel: 'low',
      showCaptionBar: false,
      showSceneNumber: false,
      quality: 'high',
      frameStyle: 'tech_neon',
      transitionStyle: 'glitch',
      captionMode: 'kinetic',
    },
  });

  assert.equal(customResult.success, true);
  assert.equal(customResult.render_options.resolution, '720x1280');

  const indexHtml = fs.readFileSync(path.join(customProjectDir, 'index.html'), 'utf-8');
  assert.match(indexHtml, /data-width="720"/);
  assert.match(indexHtml, /data-height="1280"/);
  assert.match(indexHtml, /--caption-font-size: 40px/);
  assert.match(indexHtml, /data-frame-profile="tech_neon"/);
  assert.match(indexHtml, /class="frame-bg-layer neon-grid"/);
  assert.match(indexHtml, /class="frame-bg-layer scanline"/);
  assert.match(indexHtml, /class="scene-content scene-content--text-card"/);
  assert.match(indexHtml, /class="scene-content scene-content--contrast-card"/);
  assert.match(indexHtml, /class="transition-layer"/);
  assert.match(indexHtml, /data-transition-style="glitch"/);
  assert.match(indexHtml, /kinetic-caption/);
  assert.doesNotMatch(indexHtml, /class="caption-bar"/);
  assert.doesNotMatch(indexHtml, /class="scene-number"/);

  const projectJson = JSON.parse(fs.readFileSync(path.join(customProjectDir, 'project.json'), 'utf-8'));
  assert.equal(projectJson.render_options.quality, 'high');
  assert.equal(projectJson.render_options.motionLevel, 'low');
  assert.equal(projectJson.frame_options.frameStyle, 'tech_neon');
  assert.equal(projectJson.frame_options.captionMode, 'kinetic');

  const missingTts = await hyperframesProject.createOriginalCaptionProject({
    run: { run_id: 'missing-tts', tts: {}, storyboard: runData.storyboard },
    projectDir: path.join(root, 'missing'),
  });
  assert.equal(missingTts.success, false);
  assert.match(missingTts.message, /TTS|字幕/);

  const badStoryboard = await hyperframesProject.createOriginalCaptionProject({
    run: {
      ...runData,
      storyboard: {
        ...runData.storyboard,
        scenes: [
          {
            ...runData.storyboard.scenes[0],
            emphasis_words: ['������'],
          },
        ],
      },
    },
    projectDir: path.join(root, 'bad-storyboard'),
  });
  assert.equal(badStoryboard.success, false);
  assert.match(badStoryboard.message, /乱码|分镜/);

  const listHtml = hyperframesProject.buildIndexHtml({
    duration: 6,
    captions: [
      { index: 1, start: 0, end: 6, duration: 6, text: '以前写代码，你要先懂语法、懂框架、懂前端后端、懂报错、懂部署。' },
    ],
    storyboard: {
      template: 'ai_storyboard_cards',
      scenes: [
        {
          index: 1,
          caption_indexes: [1],
          start: 0,
          end: 6,
          duration: 6,
          headline: '从学会代码，到学会对 AI 说清楚',
          visual_type: 'text_card',
          layout: 'center_focus',
          background_prompt: '原创抽象背景',
          emphasis_words: ['语法', '框架', '前端后端', '报错', '部署'],
          captions: [
            { index: 1, start: 0, end: 6, duration: 6, text: '以前写代码，你要先懂语法、懂框架、懂前端后端、懂报错、懂部署。' },
          ],
        },
      ],
    },
  });
  assert.match(listHtml, /class="emphasis timed-cards"/);
  assert.match(listHtml, /data-card-index="0"/);
  assert.match(listHtml, /<span data-card-index="4">部署<\/span>/);
  assert.match(listHtml, /#scene-1 \.emphasis span:nth-child\(5\)/);
  assert.doesNotMatch(listHtml, /<p>以前写代码，你要先懂语法、懂框架、懂前端后端、懂报错、懂部署。<\/p>/);

  const fallbackWordHtml = hyperframesProject.buildIndexHtml({
    duration: 6,
    captions: [
      { index: 1, start: 0, end: 6, duration: 6, text: '以前写代码，你要先懂语法、框架、前端后端、报错、部署。' },
    ],
    storyboard: {
      template: 'ai_storyboard_cards',
      scenes: [
        {
          index: 1,
          caption_indexes: [1],
          start: 0,
          end: 6,
          duration: 6,
          headline: '从学会代码，到学会对 AI 说清楚',
          visual_type: 'text_card',
          layout: 'center_focus',
          background_prompt: '原创抽象背景',
          emphasis_words: [],
          captions: [
            { index: 1, start: 0, end: 6, duration: 6, text: '以前写代码，你要先懂语法、框架、前端后端、报错、部署。' },
          ],
        },
      ],
    },
  });
  assert.match(fallbackWordHtml, /<span data-card-index="0">语法<\/span>/);
  assert.match(fallbackWordHtml, /<span data-card-index="1">框架<\/span>/);
  assert.match(fallbackWordHtml, /<span data-card-index="2">前端后端<\/span>/);
  assert.match(fallbackWordHtml, /<span data-card-index="3">报错<\/span>/);
  assert.match(fallbackWordHtml, /<span data-card-index="4">部署<\/span>/);
  assert.doesNotMatch(fallbackWordHtml, /<span data-card-index="0">从学会代码，到学会对 AI 说清楚<\/span>/);
  assert.doesNotMatch(fallbackWordHtml, /<span data-card-index="0">以前写代码，你要先懂语法、框架、前端后端、报错、部署。<\/span>/);

  const weakContrastHtml = hyperframesProject.buildIndexHtml({
    duration: 4,
    captions: [
      { index: 1, start: 0, end: 4, duration: 4, text: '你会发现，一个小功能背后，其实是一整套团队协作。' },
    ],
    storyboard: {
      template: 'ai_storyboard_cards',
      scenes: [
        {
          index: 1,
          caption_indexes: [1],
          start: 0,
          end: 4,
          duration: 4,
          headline: '一人指挥 AI',
          visual_type: 'contrast_card',
          layout: 'split_compare',
          background_prompt: '原创对比背景',
          emphasis_words: ['团队协作', '需求讲清楚'],
          captions: [
            { index: 1, start: 0, end: 4, duration: 4, text: '你会发现，一个小功能背后，其实是一整套团队协作。' },
          ],
        },
      ],
    },
  });
  assert.doesNotMatch(weakContrastHtml, /<div class="compare-side compare-side--old"/);
  assert.doesNotMatch(weakContrastHtml, /<div class="compare-side compare-side--new"/);
  assert.match(weakContrastHtml, /scene-content--text-card/);
}

run().then(() => {
  console.log('hyperframes project tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
