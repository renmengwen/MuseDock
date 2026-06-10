const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hyperframesProject = require('../server/services/hyperframesProject');

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
        {
          index: 3,
          caption_indexes: [1],
          start: 0,
          end: 1.25,
          duration: 1.25,
          headline: '鑷姩鐢熸垚娴佺▼',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: '鍘熷垱娴佺▼鑳屾櫙',
          emphasis_words: ['闇€姹?', '椤甸潰'],
          visual_scene: {
            composition: 'vertical_flow',
            objects: [
              { id: 'node-1', type: 'node', text: '闇€姹?' },
              { id: 'node-2', type: 'node', text: '椤甸潰' },
              { id: 'line-1', type: 'connector', from: 'node-1', to: 'node-2' },
            ],
            motion: [{ target: 'node', effect: 'stagger_reveal', delay: 0.1 }],
            beats: [{ at: 0.2, duration: 0.4, target: 'node-1', effect: 'slide_up_reveal' }],
          },
          captions: [
            { index: 1, start: 0, end: 1.25, text: '绗竴鍙ャ€?' },
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
  assert.doesNotMatch(html, /tl\.set\("\.scene", \{ autoAlpha: 0 \}, 0\)/);
  assert.doesNotMatch(html, /tl\.set\("#scene-\d+", \{ autoAlpha: 0 \}/);
  assert.doesNotMatch(html, /tl\.set\("#scene-\d+", \{ autoAlpha: 1 \}/);
  assert.doesNotMatch(html, /tl\.fromTo\("#scene-1", \{ autoAlpha: 1 \}/);
  assert.match(html, /tl\.fromTo\("#scene-1 \.scene-content"/);
  assert.match(html, /tl\.fromTo\("#scene-1 h1", \{ y: 18, autoAlpha: 1 \}/);
  assert.match(html, /tl\.fromTo\("#scene-1 \[data-visual-object\]", \{ y: 20, autoAlpha: 1/);
  assert.match(html, /tl\.fromTo\("#scene-2 h1", \{ y: 18, autoAlpha: 0 \}/);
  assert.doesNotMatch(html, /tl\.from\("#scene-1 \.emphasis span"/);
  assert.match(html, /#scene-1 \.emphasis span:nth-child\(1\)/);
  assert.doesNotMatch(html, /tl\.to\("#scene-\d+"/);
  assert.match(html, /核心观点/);
  assert.doesNotMatch(html, /class="visual-type"/);
  assert.doesNotMatch(html, />text_card<\/div>/);
  assert.match(html, /assets\/narration.wav/);
  assert.doesNotMatch(html, /<p>第一句。 第二句。<\/p>/);
  assert.doesNotMatch(html, /video\.mp4|frame-0001|frames\//);
  assert.match(html, /class="caption-bar"/);
  assert.match(html, /class="caption-line"/);
  assert.match(html, /data-caption-index="1"/);
  assert.match(html, /data-caption-index="2"/);
  assert.match(html, /#scene-1 \.caption-line:nth-child\(1\)/);
  assert.match(html, /#scene-1 \.caption-line:nth-child\(2\)/);
  assert.match(html, /scene-content--workflow/);
  assert.match(html, /visual-node/);
  assert.match(html, /visual-connector/);
  assert.match(html, /prepared_visual_scene/);
  assert.doesNotMatch(html, /tl\.to\("#scene-\d+", \{ autoAlpha: 0/);
  assert.match(html, /autoAlpha: 1/);

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
  assert.match(indexHtml, /data-frame-profile="creative_brutalist"/);
  assert.match(indexHtml, /class="frame-bg-layer paper-grain"/);
  assert.doesNotMatch(indexHtml, /neon-grid/);
  assert.doesNotMatch(indexHtml, /radial-energy/);
  assert.match(indexHtml, /scene-content--workflow|scene-content--quote-burst|scene-content--text-card/);
  assert.match(indexHtml, /class="scene-content scene-content--dsl-layer"/);
  assert.match(indexHtml, /data-visual-object="node-1"/);
  assert.match(indexHtml, /\[data-visual-object='node-1'\]/);
  assert.match(indexHtml, /class="transition-layer"/);
  assert.match(indexHtml, /data-transition-style="glitch"/);
  assert.match(indexHtml, /kinetic-caption/);
  assert.doesNotMatch(indexHtml, /class="caption-bar"/);
  assert.doesNotMatch(indexHtml, /class="scene-number"/);

  const projectJson = JSON.parse(fs.readFileSync(path.join(customProjectDir, 'project.json'), 'utf-8'));
  assert.equal(projectJson.visual_dsl_version, 1);
  assert.equal(projectJson.render_options.quality, 'high');
  assert.equal(projectJson.render_options.motionLevel, 'low');
  assert.equal(projectJson.frame_options.frameStyle, 'creative_brutalist');
  assert.equal(projectJson.frame_options.captionMode, 'kinetic');

  const creativeHtml = hyperframesProject.buildIndexHtml({
    storyboard,
    captions,
    duration: 4,
    renderOptions: {
      frameStyle: 'creative_brutalist',
    },
  });
  assert.match(creativeHtml, /data-frame-profile="creative_brutalist"/);
  assert.match(creativeHtml, /class="frame-bg-layer paper-grain"/);
  assert.match(creativeHtml, /--frame-ink: #0F0F0F/);
  assert.match(creativeHtml, /html, body \{[^}]*background: var\(--frame-bg, #EFE9D9\)/);
  assert.match(creativeHtml, /\.scene \{[^}]*background: var\(--frame-bg\)/);
  assert.match(creativeHtml, /h1 \{[^}]*color: var\(--frame-text\)/);
  assert.match(creativeHtml, /\[data-frame-profile="creative_brutalist"\] \.caption-bar \{[^}]*background: var\(--frame-ink\)/);
  assert.match(creativeHtml, /\[data-frame-profile="creative_brutalist"\] \.scene \{[^}]*background: var\(--frame-bg\)/);
  assert.doesNotMatch(creativeHtml, /neon-grid/);
  assert.doesNotMatch(creativeHtml, /radial-energy/);

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
  assert.match(listHtml, /class="visual-layer-item"/);
  assert.match(listHtml, /data-visual-object="keyword-1"/);
  assert.match(listHtml, /data-visual-object="keyword-5"/);
  assert.match(listHtml, />部署<\/div>/);
  assert.match(listHtml, /#scene-1 \[data-visual-object\]/);
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
  assert.match(fallbackWordHtml, /data-visual-object="keyword-1"[^>]*>语法<\/div>/);
  assert.match(fallbackWordHtml, /data-visual-object="keyword-2"[^>]*>框架<\/div>/);
  assert.match(fallbackWordHtml, /data-visual-object="keyword-3"[^>]*>前端后端<\/div>/);
  assert.match(fallbackWordHtml, /data-visual-object="keyword-4"[^>]*>报错<\/div>/);
  assert.match(fallbackWordHtml, /data-visual-object="keyword-5"[^>]*>部署<\/div>/);
  assert.doesNotMatch(fallbackWordHtml, /data-visual-object="keyword-1"[^>]*>从学会代码，到学会对 AI 说清楚<\/div>/);
  assert.doesNotMatch(fallbackWordHtml, /data-visual-object="keyword-1"[^>]*>以前写代码，你要先懂语法、框架、前端后端、报错、部署。<\/div>/);

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

  const dslAwareLegacyHtml = hyperframesProject.buildIndexHtml({
    duration: 4,
    captions: [
      { index: 1, start: 0, end: 4, duration: 4, text: '用一句话讲清楚这个判断。' },
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
          headline: '先判断再行动',
          visual_type: 'quote_card',
          layout: 'burst_center',
          background_prompt: '原创抽象背景',
          emphasis_words: ['判断', '行动'],
          visual_scene: {
            composition: 'center_burst',
            objects: [
              { id: 'idea-1', type: 'keyword', text: '判断', role: 'primary', style: 'neon' },
              { id: 'idea-2', type: 'keyword', text: '行动', role: 'supporting', style: 'outline' },
            ],
            motion: [{ target: 'keyword', effect: 'stagger_reveal', delay: 0 }],
            focus: { text: '先判断', style: 'accent_pulse' },
          },
        },
      ],
    },
  });
  assert.match(dslAwareLegacyHtml, /data-visual-object="idea-1"/);
  assert.match(dslAwareLegacyHtml, /data-visual-role="primary"/);
  assert.match(dslAwareLegacyHtml, /data-composition="center_burst"/);
  assert.doesNotMatch(dslAwareLegacyHtml, /class="scene-content scene-content--quote-card"/);
}

run().then(() => {
  console.log('hyperframes project tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
