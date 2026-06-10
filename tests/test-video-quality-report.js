const assert = require('assert');
const report = require('../server/services/videoQualityReport');

const result = report.buildVideoQualityReport({
  project: {
    duration: 95.52,
    render_options: { captionMode: 'standard' },
  },
  storyboard: {
    scenes: [
      { visual_type: 'text_card', visual_scene: { beats: [] } },
      { visual_type: 'text_card', visual_scene: { beats: [] } },
      { visual_type: 'text_card', visual_scene: { beats: [] } },
    ],
  },
  captions: [{ index: 1, text: '输入是什么，输出是什么，规则是什么。' }],
  phraseCaptions: [],
  targetDurationSec: 60,
});

assert.equal(result.success, true);
assert.ok(result.score < 70);
assert.ok(result.issues.some(issue => issue.code === 'duration_too_long'));
assert.ok(result.issues.some(issue => issue.code === 'caption_mode_not_phrase'));
assert.ok(result.issues.some(issue => issue.code === 'low_visual_variety'));
assert.ok(result.issues.some(issue => issue.message.includes('中文')));

const overTargetOnly = report.buildVideoQualityReport({
  project: {
    duration: 95.52,
    render_options: { captionMode: 'phrase_kinetic' },
  },
  storyboard: {
    scenes: [
      { visual_type: 'workflow', visual_scene: { beats: [{ caption_block_id: 'cap-1-p1' }, { caption_block_id: 'cap-1-p2' }] } },
      { visual_type: 'code_panel', visual_scene: { beats: [{ caption_block_id: 'cap-2-p1' }, { caption_block_id: 'cap-2-p2' }] } },
      { visual_type: 'timeline', visual_scene: { beats: [{ caption_block_id: 'cap-3-p1' }, { caption_block_id: 'cap-3-p2' }] } },
    ],
  },
  captions: [{ index: 1, text: '输入是什么，输出是什么。' }],
  phraseCaptions: [
    { id: 'cap-1-p1', caption_index: 1 },
    { id: 'cap-1-p2', caption_index: 1 },
    { id: 'cap-2-p1', caption_index: 2 },
    { id: 'cap-2-p2', caption_index: 2 },
    { id: 'cap-3-p1', caption_index: 3 },
    { id: 'cap-3-p2', caption_index: 3 },
  ],
  targetDurationSec: 60,
});

assert.equal(overTargetOnly.pass, false);
assert.ok(overTargetOnly.score < 70);
assert.ok(overTargetOnly.issues.some(issue => issue.code === 'duration_too_long' && issue.penalty >= 35));

const unsyncedBeats = report.buildVideoQualityReport({
  project: {
    duration: 62,
    render_options: { captionMode: 'phrase_kinetic' },
  },
  storyboard: {
    scenes: [
      { visual_type: 'workflow', visual_scene: { beats: [{ caption_block_id: '' }, { caption_block_id: '' }] } },
      { visual_type: 'code_panel', visual_scene: { beats: [{ caption_block_id: '' }, { caption_block_id: '' }] } },
      { visual_type: 'timeline', visual_scene: { beats: [{ caption_block_id: '' }, { caption_block_id: '' }] } },
    ],
  },
  captions: [{ index: 1, text: '读到哪一块，就显示哪一块。' }],
  phraseCaptions: [{ id: 'cap-1-p1' }, { id: 'cap-2-p1' }, { id: 'cap-3-p1' }],
  targetDurationSec: 60,
});

assert.equal(unsyncedBeats.pass, false);
assert.ok(unsyncedBeats.issues.some(issue => issue.code === 'low_caption_sync' && issue.severity === 'error'));

const invalidCaptionBlockIds = report.buildVideoQualityReport({
  project: {
    duration: 62,
    render_options: { captionMode: 'phrase_kinetic' },
  },
  storyboard: {
    scenes: [
      { visual_type: 'workflow', caption_indexes: [1], visual_scene: { beats: [{ caption_block_id: 'cap-999-p1' }, { caption_block_id: 'cap-1-p2' }] } },
      { visual_type: 'code_panel', caption_indexes: [2], visual_scene: { beats: [{ caption_block_id: 'cap-1-p1' }, { caption_block_id: 'cap-2-p2' }] } },
      { visual_type: 'timeline', caption_indexes: [3], visual_scene: { beats: [{ caption_block_id: 'cap-3-p1' }, { caption_block_id: 'cap-3-p2' }] } },
    ],
  },
  captions: [{ index: 1, text: '错误 id 和跨场景 id 都不能算同步。' }],
  phraseCaptions: [
    { id: 'cap-1-p1', caption_index: 1 },
    { id: 'cap-1-p2', caption_index: 1 },
    { id: 'cap-2-p1', caption_index: 2 },
    { id: 'cap-2-p2', caption_index: 2 },
    { id: 'cap-3-p1', caption_index: 3 },
    { id: 'cap-3-p2', caption_index: 3 },
  ],
  targetDurationSec: 60,
});

assert.equal(invalidCaptionBlockIds.pass, false);
assert.equal(invalidCaptionBlockIds.caption_synced_beat_count, 4);
assert.ok(invalidCaptionBlockIds.issues.some(issue => issue.code === 'invalid_caption_sync' && issue.severity === 'error'));

const unboundVisualObjects = report.buildVideoQualityReport({
  project: {
    duration: 62,
    render_options: { captionMode: 'phrase_kinetic' },
  },
  storyboard: {
    scenes: [
      {
        visual_type: 'workflow',
        caption_indexes: [1],
        visual_scene: {
          objects: [
            { id: 'step-1', type: 'step', text: '第一步' },
            { id: 'step-2', type: 'step', text: '第二步' },
            { id: 'step-3', type: 'step', text: '第三步' },
          ],
          beats: [{ target: 'step-1', caption_block_id: 'cap-1-p1' }],
        },
      },
      {
        visual_type: 'code_panel',
        caption_indexes: [2],
        visual_scene: {
          objects: [
            { id: 'code-1', type: 'code', text: 'npm run dev' },
            { id: 'terminal-1', type: 'terminal', text: 'ready' },
          ],
          beats: [{ target: 'code-1', caption_block_id: 'cap-2-p1' }],
        },
      },
      {
        visual_type: 'timeline',
        caption_indexes: [3],
        visual_scene: {
          objects: [
            { id: 'milestone-1', type: 'milestone', text: '开始' },
            { id: 'milestone-2', type: 'milestone', text: '完成' },
          ],
          beats: [{ target: 'milestone-1', caption_block_id: 'cap-3-p1' }],
        },
      },
    ],
  },
  captions: [{ index: 1, text: '未绑定对象会提前出现。' }],
  phraseCaptions: [
    { id: 'cap-1-p1', caption_index: 1 },
    { id: 'cap-2-p1', caption_index: 2 },
    { id: 'cap-3-p1', caption_index: 3 },
  ],
  targetDurationSec: 60,
});

assert.equal(unboundVisualObjects.pass, false);
assert.ok(unboundVisualObjects.unbound_visual_object_count >= 4);
assert.ok(unboundVisualObjects.issues.some(issue => issue.code === 'unbound_visual_objects' && issue.severity === 'error'));

const cardLikeHtml = report.buildVideoQualityReport({
  project: {
    duration: 62,
    render_options: { captionMode: 'phrase_kinetic' },
  },
  storyboard: {
    scenes: [
      { visual_type: 'workflow', visual_scene: { beats: [{ caption_block_id: 'cap-1-p1' }, { caption_block_id: 'cap-1-p2' }] } },
      { visual_type: 'code_panel', visual_scene: { beats: [{ caption_block_id: 'cap-2-p1' }, { caption_block_id: 'cap-2-p2' }] } },
      { visual_type: 'timeline', visual_scene: { beats: [{ caption_block_id: 'cap-3-p1' }, { caption_block_id: 'cap-3-p2' }] } },
      { visual_type: 'concept_map', visual_scene: { beats: [{ caption_block_id: 'cap-4-p1' }, { caption_block_id: 'cap-4-p2' }] } },
    ],
  },
  html: [
    '<section><div class="scene-content scene-content--dsl-layer"><div class="visual-layer-item">A</div></div></section>',
    '<section><div class="scene-content scene-content--dsl-layer"><div class="visual-layer-item">B</div></div></section>',
    '<section><div class="scene-content scene-content--text-card"><div class="timed-cards">C</div></div></section>',
    '<section><div class="scene-content scene-content--dsl-layer"><div class="visual-layer-item">D</div></div></section>',
  ].join('\n'),
  captions: [{ index: 1, text: '声明的 visual_type 很丰富，但实际 DOM 仍然是卡片堆叠。' }],
  phraseCaptions: [
    { id: 'cap-1-p1' },
    { id: 'cap-1-p2' },
    { id: 'cap-2-p1' },
    { id: 'cap-2-p2' },
    { id: 'cap-3-p1' },
    { id: 'cap-3-p2' },
    { id: 'cap-4-p1' },
    { id: 'cap-4-p2' },
  ],
  targetDurationSec: 60,
});

assert.equal(cardLikeHtml.pass, false);
assert.ok(cardLikeHtml.issues.some(issue => issue.code === 'card_like_layout_overuse' && issue.severity === 'error'));
assert.ok(cardLikeHtml.card_like_scene_count >= 3);

const cssOnlyCardLikeClasses = report.buildVideoQualityReport({
  project: {
    duration: 62,
    render_options: { captionMode: 'phrase_kinetic' },
  },
  storyboard: {
    scenes: [
      { visual_type: 'workflow', visual_scene: { beats: [{ caption_block_id: 'cap-1-p1' }, { caption_block_id: 'cap-1-p2' }] } },
      { visual_type: 'code_panel', visual_scene: { beats: [{ caption_block_id: 'cap-2-p1' }, { caption_block_id: 'cap-2-p2' }] } },
      { visual_type: 'timeline', visual_scene: { beats: [{ caption_block_id: 'cap-3-p1' }, { caption_block_id: 'cap-3-p2' }] } },
    ],
  },
  html: [
    '<style>.scene-content--text-card,.scene-content--dsl-layer,.timed-cards{color:red}</style>',
    '<section><div class="scene-content scene-content--workflow"></div></section>',
    '<section><div class="scene-content scene-content--code-panel"></div></section>',
    '<section><div class="scene-content scene-content--timeline-sync"></div></section>',
  ].join('\n'),
  captions: [{ index: 1, text: 'CSS 里的 class 不应被当成实际 DOM。' }],
  phraseCaptions: [
    { id: 'cap-1-p1' },
    { id: 'cap-1-p2' },
    { id: 'cap-2-p1' },
    { id: 'cap-2-p2' },
    { id: 'cap-3-p1' },
    { id: 'cap-3-p2' },
  ],
  targetDurationSec: 60,
});

assert.equal(cssOnlyCardLikeClasses.pass, true);
assert.equal(cssOnlyCardLikeClasses.card_like_scene_count, 0);

const good = report.buildVideoQualityReport({
  project: {
    duration: 62,
    render_options: { captionMode: 'phrase_kinetic' },
  },
  storyboard: {
    scenes: [
      { visual_type: 'workflow', visual_scene: { beats: [{ caption_block_id: 'cap-1-p1' }, { caption_block_id: 'cap-1-p2' }] } },
      { visual_type: 'code_panel', visual_scene: { beats: [{ caption_block_id: 'cap-2-p1' }, { caption_block_id: 'cap-2-p2' }] } },
      { visual_type: 'timeline', visual_scene: { beats: [{ caption_block_id: 'cap-3-p1' }, { caption_block_id: 'cap-3-p2' }] } },
    ],
  },
  captions: [{ index: 1, text: '输入是什么，输出是什么。' }],
  phraseCaptions: [
    { id: 'cap-1-p1', caption_index: 1 },
    { id: 'cap-1-p2', caption_index: 1 },
    { id: 'cap-2-p1', caption_index: 2 },
    { id: 'cap-2-p2', caption_index: 2 },
    { id: 'cap-3-p1', caption_index: 3 },
    { id: 'cap-3-p2', caption_index: 3 },
  ],
  targetDurationSec: 60,
});

assert.ok(good.score >= 85);
assert.equal(good.pass, true);
assert.equal(good.issues.length, 0);
assert.equal(typeof report.loadProjectQualityInputs, 'function');

console.log('video quality report tests passed');
