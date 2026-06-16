const assert = require('assert/strict');

const { applyEditPatch } = require('../server/services/creative-video/html-video/editPatchService');

function baseProject() {
  return {
    template_id: 'base',
    template_inputs: { headline: '旧标题', subtitle: '旧副标题' },
    frames: [
      {
        id: 'frame_01',
        template_id: 'base',
        inputs: { headline: '帧标题' },
        duration_sec: 4,
        html_path: 'frames/frame_01.html',
      },
    ],
    audio: {
      narration_text: '旧旁白',
    },
    captions: [{ id: 'cap_1', text: '旧字幕' }],
    timeline: { tracks: [{ id: 'main', items: [{ id: 'frame_01', kind: 'frame', duration_sec: 4 }] }] },
    revisions: [],
  };
}

(async () => {
  let result = applyEditPatch(baseProject(), {
    type: 'template_inputs_patch',
    patch: { headline: '新标题' },
    author: 'test',
  });
  assert.equal(result.success, true);
  assert.equal(result.project.template_inputs.headline, '新标题');
  assert.equal(result.requires_tts, false);
  assert.equal(result.requires_render, true);
  assert.equal(result.revision.requires_render, true);

  result = applyEditPatch(baseProject(), {
    type: 'frame_inputs_patch',
    frame_id: 'frame_01',
    patch: { headline: '新帧标题' },
  });
  assert.equal(result.success, true);
  assert.equal(result.project.frames[0].inputs.headline, '新帧标题');
  assert.equal(result.requires_render, true);

  result = applyEditPatch(baseProject(), {
    type: 'narration_patch',
    text: '新旁白',
  });
  assert.equal(result.success, true);
  assert.equal(result.project.audio.narration_text, '新旁白');
  assert.equal(result.requires_tts, true);
  assert.equal(result.requires_render, true);

  result = applyEditPatch(baseProject(), {
    type: 'caption_patch',
    caption_id: 'cap_1',
    patch: { text: '新字幕' },
  });
  assert.equal(result.success, true);
  assert.equal(result.project.captions[0].text, '新字幕');
  assert.equal(result.requires_tts, false);
  assert.equal(result.requires_render, true);

  result = applyEditPatch(baseProject(), {
    type: 'duration_patch',
    frame_id: 'frame_01',
    duration_sec: 6,
  });
  assert.equal(result.success, true);
  assert.equal(result.project.frames[0].duration_sec, 6);
  assert.equal(result.project.timeline.tracks[0].items[0].duration_sec, 6);
  assert.equal(result.requires_render, true);

  result = applyEditPatch(baseProject(), {
    type: 'replace_frame_template',
    frame_id: 'frame_01',
    template_id: 'next',
    inputs: { headline: '替换后' },
  });
  assert.equal(result.success, true);
  assert.equal(result.project.frames[0].template_id, 'next');
  assert.equal(result.project.frames[0].html_path, null);
  assert.equal(result.requires_render, true);

  const unsafeHtml = applyEditPatch(baseProject(), {
    type: 'frame_inputs_patch',
    frame_id: 'frame_01',
    patch: { html: '<script>alert(1)</script>' },
  });
  assert.equal(unsafeHtml.success, false);
  assert.match(unsafeHtml.message, /不允许/);

  const unsafePath = applyEditPatch(baseProject(), {
    type: 'template_inputs_patch',
    patch: { poster_path: '../secret.png' },
  });
  assert.equal(unsafePath.success, false);
  assert.match(unsafePath.message, /路径/);

  const unknown = applyEditPatch(baseProject(), { type: 'unknown' });
  assert.equal(unknown.success, false);
  assert.match(unknown.message, /不支持/);

  console.log('html-video edit patch service tests passed');
})();
