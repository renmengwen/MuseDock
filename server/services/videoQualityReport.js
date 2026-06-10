const fs = require('fs');
const path = require('path');

const DEFAULT_PASS_SCORE = 70;
const HARD_DURATION_RATIO = 1.25;
const MIN_CAPTION_SYNC_RATIO = 0.5;
const CARD_LIKE_RATIO_LIMIT = 0.6;
const CONTAINER_VISUAL_OBJECT_IDS = new Set(['brand-panel', 'code-window', 'focus', 'sync-progress', 'ui-panel']);

function uniqueCount(values = []) {
  return new Set(values.filter(Boolean)).size;
}

function addIssue(issues, code, message, penalty, severity = 'warning') {
  issues.push({ code, message, penalty, severity });
}

function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function loadProjectQualityInputs(projectDir) {
  const root = path.resolve(projectDir);
  const project = readJsonIfExists(path.join(root, 'project.json'), {});
  return {
    project,
    storyboard: readJsonIfExists(path.join(root, 'storyboard.json'), {}),
    captions: readJsonIfExists(path.join(root, 'captions.json'), []),
    phraseCaptions: project.phrase_captions || project.tts_phrase_captions || [],
    html: readTextIfExists(path.join(root, 'index.html')),
  };
}

function getSceneBeats(scene) {
  if (Array.isArray(scene?.visual_scene?.beats)) return scene.visual_scene.beats;
  if (Array.isArray(scene?.prepared_visual_scene?.beats)) return scene.prepared_visual_scene.beats;
  return [];
}

function sanitizeCaptionBlockId(value) {
  return String(value || '').replace(/['"\\[\]]/g, '').trim();
}

function getSceneCaptionIndexes(scene) {
  const indexes = Array.isArray(scene?.caption_indexes)
    ? scene.caption_indexes
    : (Array.isArray(scene?.captionIndexes) ? scene.captionIndexes : []);
  return new Set(indexes.map(item => Number(item)).filter(Number.isFinite));
}

function buildScenePhraseIdSet(scene, phraseCaptions) {
  if (!Array.isArray(phraseCaptions) || !phraseCaptions.length) return new Set();
  const sceneCaptionIndexes = getSceneCaptionIndexes(scene);
  return new Set(phraseCaptions
    .filter(block => !sceneCaptionIndexes.size || sceneCaptionIndexes.has(Number(block?.caption_index)))
    .map(block => sanitizeCaptionBlockId(block?.id))
    .filter(Boolean));
}

function analyzeCaptionSync(scenes, phraseCaptions) {
  return scenes.reduce((stats, scene) => {
    const validPhraseIds = buildScenePhraseIdSet(scene, phraseCaptions);
    getSceneBeats(scene).forEach(beat => {
      const captionBlockId = sanitizeCaptionBlockId(beat?.caption_block_id);
      if (!captionBlockId) return;
      if (validPhraseIds.has(captionBlockId)) {
        stats.valid += 1;
      } else {
        stats.invalid += 1;
      }
    });
    return stats;
  }, { valid: 0, invalid: 0 });
}

function getSceneVisualObjects(scene) {
  const objects = Array.isArray(scene?.visual_scene?.objects)
    ? scene.visual_scene.objects
    : (Array.isArray(scene?.prepared_visual_scene?.objects) ? scene.prepared_visual_scene.objects : []);
  return objects
    .map((object, index) => sanitizeCaptionBlockId(object?.id || `${object?.type || 'object'}-${index + 1}`))
    .filter(id => id && !CONTAINER_VISUAL_OBJECT_IDS.has(id));
}

function analyzeVisualObjectCoverage(scenes, phraseCaptions) {
  return scenes.reduce((stats, scene) => {
    const validPhraseIds = buildScenePhraseIdSet(scene, phraseCaptions);
    const objectIds = getSceneVisualObjects(scene);
    const boundTargets = new Set(getSceneBeats(scene)
      .filter(beat => validPhraseIds.has(sanitizeCaptionBlockId(beat?.caption_block_id)))
      .map(beat => sanitizeCaptionBlockId(beat?.target))
      .filter(Boolean));
    stats.total += objectIds.length;
    objectIds.forEach(id => {
      if (boundTargets.has(id)) stats.bound += 1;
    });
    return stats;
  }, { total: 0, bound: 0 });
}

function countMatches(text = '', pattern) {
  return (String(text || '').match(pattern) || []).length;
}

function stripNonDomSections(html = '') {
  return String(html || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

function analyzeRenderedHtml(html = '') {
  const source = stripNonDomSections(html);
  const sceneContentCount = countMatches(source, /class="[^"]*\bscene-content\b/g);
  const dslLayerCount = countMatches(source, /class="[^"]*\bscene-content--dsl-layer\b[^"]*"/g);
  const textCardCount = countMatches(source, /class="[^"]*\bscene-content--(?:text-card|quote-card|contrast-card|step-card)\b[^"]*"/g);
  const visualLayerItemCount = countMatches(source, /class="[^"]*\bvisual-layer-item\b/g);
  const timedCardsCount = countMatches(source, /class="[^"]*\btimed-cards\b/g);
  const cardLikeSceneCount = Math.min(
    sceneContentCount || dslLayerCount + textCardCount,
    dslLayerCount + textCardCount
  );

  return {
    scene_content_count: sceneContentCount,
    dsl_layer_scene_count: dslLayerCount,
    text_card_scene_count: textCardCount,
    visual_layer_item_count: visualLayerItemCount,
    timed_cards_count: timedCardsCount,
    card_like_scene_count: cardLikeSceneCount,
  };
}

function getCaptionCount(captions) {
  if (Array.isArray(captions?.captions)) return captions.captions.length;
  return Array.isArray(captions) ? captions.length : 0;
}

function buildVideoQualityReport({
  project = {},
  storyboard = {},
  captions = [],
  phraseCaptions = [],
  html = '',
  targetDurationSec = 60,
  passScore = DEFAULT_PASS_SCORE,
} = {}) {
  const issues = [];
  const scenes = Array.isArray(storyboard.scenes) ? storyboard.scenes : [];
  const duration = Number(project.duration || 0);
  const target = Number(targetDurationSec || project.target_duration_sec || 60);
  const visualTypes = scenes.map(scene => scene.visual_type || scene.prepared_visual_scene?.visualType || 'text_card');
  const beatCount = scenes.reduce((sum, scene) => sum + getSceneBeats(scene).length, 0);
  const captionSync = analyzeCaptionSync(scenes, phraseCaptions);
  const beatWithCaption = captionSync.valid;
  const visualObjectCoverage = analyzeVisualObjectCoverage(scenes, phraseCaptions);
  const unboundVisualObjectCount = Math.max(0, visualObjectCoverage.total - visualObjectCoverage.bound);
  const rendered = analyzeRenderedHtml(html);

  if (duration && target && duration > target * HARD_DURATION_RATIO) {
    addIssue(
      issues,
      'duration_too_long',
      `实际 TTS 时长 ${duration.toFixed(1)} 秒，明显超过目标 ${target} 秒，请先压缩口播或重新生成脚本。`,
      40,
      'error'
    );
  }

  if (project.render_options?.captionMode !== 'phrase_kinetic') {
    addIssue(
      issues,
      'caption_mode_not_phrase',
      '字幕模式不是中文短语动效，枚举和列表内容容易整句一次性显示。',
      18
    );
  }

  if (scenes.length >= 3 && uniqueCount(visualTypes) < Math.min(3, scenes.length)) {
    addIssue(
      issues,
      'low_visual_variety',
      '连续分镜的视觉类型变化不足，成片容易呈现重复卡片轮播感。',
      16
    );
  }

  if (scenes.length && beatCount < scenes.length * 2) {
    addIssue(
      issues,
      'low_beat_coverage',
      '每个分镜的段内视觉事件不足，画面变化跟不上口播。',
      16
    );
  }

  if (beatCount && beatWithCaption / beatCount < MIN_CAPTION_SYNC_RATIO) {
    addIssue(
      issues,
      'low_caption_sync',
      '多数视觉 beat 没有绑定字幕短语，画面和口播同步关系偏弱。',
      beatWithCaption === 0 ? 36 : 24,
      beatWithCaption === 0 ? 'error' : 'warning'
    );
  }

  if (captionSync.invalid > 0) {
    addIssue(
      issues,
      'invalid_caption_sync',
      `有 ${captionSync.invalid} 个视觉 beat 引用了不存在或不属于当前分镜的短语字幕块，动画会退回默认时间并破坏口播同步。`,
      36,
      'error'
    );
  }

  if (
    project.render_options?.captionMode === 'phrase_kinetic'
    && visualObjectCoverage.total >= 4
    && visualObjectCoverage.bound / visualObjectCoverage.total < 0.8
  ) {
    addIssue(
      issues,
      'unbound_visual_objects',
      `有 ${unboundVisualObjectCount} 个视觉对象没有绑定到有效字幕 beat，列表项可能在口播前提前出现。`,
      28,
      'error'
    );
  }

  if (!Array.isArray(phraseCaptions) || phraseCaptions.length === 0) {
    addIssue(
      issues,
      'missing_phrase_captions',
      '没有生成中文短语字幕块，无法做到读到哪一块就显示哪一块。',
      20
    );
  }

  if (rendered.scene_content_count >= 3) {
    const cardLikeRatio = rendered.card_like_scene_count / rendered.scene_content_count;
    if (cardLikeRatio >= CARD_LIKE_RATIO_LIMIT || rendered.dsl_layer_scene_count >= Math.ceil(rendered.scene_content_count / 2)) {
      addIssue(
        issues,
        'card_like_layout_overuse',
        '最终渲染 HTML 中卡片/关键词标签版式占比过高，成片容易像 PPT 或关键词堆叠。',
        32,
        'error'
      );
    }
  }

  const penalty = issues.reduce((sum, issue) => sum + issue.penalty, 0);
  const score = Math.max(0, 100 - penalty);
  const hasBlockingIssue = issues.some(issue => issue.severity === 'error');

  return {
    success: true,
    pass: score >= passScore && !hasBlockingIssue,
    pass_score: passScore,
    score,
    duration,
    target_duration_sec: target,
    scene_count: scenes.length,
    visual_type_count: uniqueCount(visualTypes),
    beat_count: beatCount,
    caption_synced_beat_count: beatWithCaption,
    invalid_caption_synced_beat_count: captionSync.invalid,
    visual_object_count: visualObjectCoverage.total,
    bound_visual_object_count: visualObjectCoverage.bound,
    unbound_visual_object_count: unboundVisualObjectCount,
    phrase_caption_count: Array.isArray(phraseCaptions) ? phraseCaptions.length : 0,
    caption_count: getCaptionCount(captions),
    rendered_scene_count: rendered.scene_content_count,
    dsl_layer_scene_count: rendered.dsl_layer_scene_count,
    text_card_scene_count: rendered.text_card_scene_count,
    card_like_scene_count: rendered.card_like_scene_count,
    visual_layer_item_count: rendered.visual_layer_item_count,
    timed_cards_count: rendered.timed_cards_count,
    issues,
  };
}

module.exports = {
  analyzeRenderedHtml,
  buildVideoQualityReport,
  loadProjectQualityInputs,
};
