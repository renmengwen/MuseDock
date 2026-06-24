const assert = require('assert/strict');

const { buildTimedStoryboardPlan, roundTime } = require('../server/services/storyboardTiming');

(() => {
  assert.equal(roundTime(1.23456), 1.235);

  const storyboardPlan = {
    status: 'planned',
    target_duration_sec: 4,
    scenes: [
      {
        index: 1,
        target_duration_sec: 1.5,
        narration_text: '第一段。',
        headline: '第一幕',
      },
      {
        index: 2,
        target_duration_sec: 2.5,
        narration_text: '第二段。',
        headline: '第二幕',
      },
    ],
  };

  const sceneTts = {
    status: 'done',
    scenes: [
      {
        index: 1,
        duration: 1.2,
        actual_duration_sec: 1.2,
        captions: [
          { index: 1, start: 0, end: 1.2, duration: 1.2, text: '第一段。' },
        ],
        phrase_captions: [
          { id: 'local-1', caption_index: 1, phrase_index: 1, start: 0, end: 1.2, duration: 1.2, text: '第一段' },
        ],
      },
      {
        index: 2,
        duration: 2.5,
        actual_duration_sec: 2.5,
        captions: [
          { index: 1, start: 0, end: 2.5, duration: 2.5, text: '第二段。' },
        ],
        phrase_captions: [
          { id: 'local-2', caption_index: 1, phrase_index: 1, start: 0, end: 2.5, duration: 2.5, text: '第二段' },
        ],
      },
    ],
  };

  const timed = buildTimedStoryboardPlan({ storyboardPlan, sceneTts });

  assert.equal(timed.status, 'timed');
  assert.equal(timed.duration, 3.7);
  assert.deepEqual(timed.scenes.map(scene => scene.caption_indexes), [[1], [2]]);
  assert.equal(timed.scenes[0].start, 0);
  assert.equal(timed.scenes[0].end, 1.2);
  assert.equal(timed.scenes[1].start, 1.2);
  assert.equal(timed.scenes[1].end, 3.7);
  assert.equal(timed.captions[1].index, 2);
  assert.equal(timed.captions[1].start, 1.2);
  assert.equal(timed.phrase_captions[1].id, 'cap-2-p1');
  assert.equal(timed.phrase_captions[1].caption_index, 2);

  const qualityTimed = buildTimedStoryboardPlan({
    storyboardPlan: {
      status: 'planned',
      target_duration_sec: 14,
      scenes: [
        {
          index: 1,
          target_duration_sec: 9,
          narration_text: '测试旁白。',
          headline: '干净音频时长',
        },
      ],
    },
    sceneTts: {
      status: 'done',
      scenes: [
        {
          index: 1,
          speech_duration_sec: 13.996,
          duration: 231.04,
          actual_duration_sec: 231.04,
          captions: [
            { index: 1, start: 0, end: 13.996, duration: 13.996, text: '测试旁白。' },
          ],
          phrase_captions: [],
        },
      ],
    },
  });

  assert.equal(qualityTimed.status, 'timed');
  assert.equal(qualityTimed.duration, 13.996);
  assert.equal(qualityTimed.scenes[0].duration, 13.996);
  assert.equal(qualityTimed.scenes[0].actual_duration_sec, 13.996);

  console.log('storyboard timing tests passed');
})();
