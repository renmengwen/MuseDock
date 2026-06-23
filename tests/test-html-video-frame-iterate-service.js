const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildFrameIteratePrompt,
  iterateFrameHtml,
} = require('../server/services/creative-video/html-video/htmlVideoIterateService');

(async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-video-frame-iterate-'));

  try {
    fs.mkdirSync(path.join(projectDir, 'frames'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'frames', 'frame_01.html'),
      '<!doctype html><html><body><h1>原始标题</h1></body></html>',
      'utf-8',
    );

    const project = {
      frames: [{
        id: 'frame_01',
        scene_id: 'scene_01',
        graph_node_id: 'graph_01',
        source_mode: 'raw_html',
        html_path: 'frames/frame_01.html',
        drafts: [],
      }],
      revisions: [],
    };

    const nextHtml = '<!doctype html><html><body><h1>重写标题</h1></body></html>';
    const prompt = buildFrameIteratePrompt({
      frame: project.frames[0],
      currentHtml: '<!doctype html><html><head><style>.hidden{color:red}</style></head><body><h1>摘要标题</h1><script>window.bad = true</script></body></html>',
      instruction: '修复遮挡',
      mode: 'layout_fix',
      preserveText: true,
    });
    assert.match(prompt, /编辑模式：layout_fix/);
    assert.match(prompt, /当前帧可见内容摘要：摘要标题\s+当前帧 HTML：/);

    const fakeModel = {
      async callTextModel(request) {
        assert.equal(request.messages.length, 1);
        assert.equal(request.messages[0].role, 'user');
        assert.match(request.messages[0].content, /原始标题/);
        assert.match(request.messages[0].content, /保留原有文字/);
        assert.match(request.messages[0].content, /编辑模式：visual_rewrite/);
        return {
          success: true,
          text: `这里是重写后的完整源码：\n\`\`\`html\n${nextHtml}\n\`\`\``,
        };
      },
    };

    const result = await iterateFrameHtml({
      projectDir,
      project,
      frameId: 'graph_01',
      instruction: '让画面更有冲击力',
      mode: 'visual_rewrite',
      preserveText: true,
      model: fakeModel,
    });

    assert.equal(result.success, true);
    assert.equal(result.message, '当前帧草稿已生成。');
    assert.equal(result.mode, 'visual_rewrite');
    assert.equal(result.resolved_frame_id, 'frame_01');
    assert.equal(result.draft.kind, 'ai_iterate');
    assert.equal(result.draft.summary, 'AI 当前帧重写草稿。');
    assert.equal(project.frames[0].drafts.length, 1);
    assert.equal(project.frames[0].active_draft_id, result.draft.id);
    assert.equal(fs.readFileSync(path.join(projectDir, result.draft.html_path), 'utf-8'), nextHtml);

    const badModel = {
      async callTextModel() {
        return { success: true, content: 'not html' };
      },
    };
    const badResult = await iterateFrameHtml({
      projectDir,
      project,
      frameId: 'scene_01',
      instruction: '输出坏内容',
      model: badModel,
    });
    assert.equal(badResult.success, false);
    assert.equal(badResult.code, 'AI_FRAME_HTML_INVALID');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  console.log('html-video frame iterate service tests passed');
})();
