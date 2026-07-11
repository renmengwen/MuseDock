const assert = require('assert');

const { ensureMotionOverlay } = require('../server/services/creative-video/html-video/frameHtmlPhase');

// 缺失 overlay：注入片段 + 填 slot + 设置主题 token 变量
{
  const beat = {
    id: 'scene_04_b1', scene_id: 'scene_04',
    visual_text: { headline: 'UX 的整体视角' },
    narration_text: 'UX 关注用户为什么来',
    motion_overlay: {
      preset: 'key_marker', placement: 'lower_third', max_items: 1,
      avoid_caption_bottom_px: 140,
      theme_tokens: { accent: '#1A73E8', foreground: '#0B0B0B', surface: 'rgba(255,255,255,.9)', background: '#F6F5F2' },
    },
  };
  const html = '<html><head></head><body><div class="hero">base</div></body></html>';
  const result = ensureMotionOverlay(html, beat, { visualStrategy: 'asset_first' });
  assert.strictEqual(result.injected, true);
  assert.ok(result.html.includes('data-mp-overlay="key_marker"'));
  assert.ok(result.html.includes('UX 的整体视角'), 'slot 必须填 beat 的 headline');
  assert.ok(result.html.includes('--mp-accent:#1A73E8'), '必须写入主题 token CSS 变量');
}
// R7：slot 填充必须 htmlEscape
{
  const beat = {
    id: 'x', scene_id: 'x',
    visual_text: { headline: 'A < B & C' },
    motion_overlay: { preset: 'key_marker', placement: 'lower_third', max_items: 1, avoid_caption_bottom_px: 140 },
  };
  const result = ensureMotionOverlay('<html><body></body></html>', beat, { visualStrategy: 'asset_first' });
  assert.ok(result.html.includes('A &lt; B &amp; C'), 'slot 文案必须经 htmlEscape');
  assert.ok(!result.html.includes('A < B & C'), '未转义原文不得出现在 HTML 中');
}
// 已有 overlay：原样返回
{
  const html = '<html><body><div data-mp-overlay="concept_card"></div></body></html>';
  const result = ensureMotionOverlay(html, { motion_overlay: { preset: 'concept_card' } }, { visualStrategy: 'asset_first' });
  assert.strictEqual(result.injected, false);
  assert.strictEqual(result.html, html);
}
// 硬约束 A：hf_first 不注入
{
  const html = '<html><body></body></html>';
  const result = ensureMotionOverlay(html, { motion_overlay: { preset: 'key_marker' } }, { visualStrategy: 'hf_first' });
  assert.strictEqual(result.injected, false);
  assert.strictEqual(result.html, html);
}
console.log('ensure motion overlay tests passed');
