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
  assert.match(html, /tl\.fromTo\("#scene-1 \.visual-field"/);
  assert.match(html, /tl\.from\("#scene-1 \.emphasis span"/);
  assert.match(html, /tl\.to\("#scene-1"/);
  assert.match(html, /核心观点/);
  assert.match(html, /assets\/narration.wav/);
  assert.doesNotMatch(html, /video\.mp4|frame-0001|frames\//);

  const missingTts = await hyperframesProject.createOriginalCaptionProject({
    run: { run_id: 'missing-tts', tts: {}, storyboard: runData.storyboard },
    projectDir: path.join(root, 'missing'),
  });
  assert.equal(missingTts.success, false);
  assert.match(missingTts.message, /TTS|字幕/);
}

run().then(() => {
  console.log('hyperframes project tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
