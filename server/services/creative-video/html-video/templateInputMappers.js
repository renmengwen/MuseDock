const { buildFrameInputs, firstMetric, trustedSceneDuration } = require('./sceneSpecMapper');

function text(value, max = 80) {
  const raw = value == null ? '' : (typeof value === 'object' ? (value.label || value.name || value.title || value.text || value.value || '') : value);
  const out = String(raw).replace(/\s+/g, ' ').trim();
  return out.length > max ? out.slice(0, max).trimEnd() : out;
}

function visual(scene = {}) {
  return scene.visual_text && typeof scene.visual_text === 'object' ? scene.visual_text : {};
}

function summary(scene = {}, max = 100) {
  const captions = Array.isArray(scene.captions) ? scene.captions : [];
  return text(visual(scene).headline || scene.title || scene.narration_text || captions[0]?.text || '', max);
}

function clampDuration(scene, min, max) {
  const duration = trustedSceneDuration(scene, scene, {});
  return Math.max(min, Math.min(max, duration));
}

function parseDataPoint(item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const label = text(item.label || item.name || item.title || item.key, 40);
    const value = Number(item.value ?? item.amount ?? item.metric ?? item.count ?? item.y);
    return label && Number.isFinite(value) ? { label, value } : null;
  }
  const valueText = text(item, 80);
  const match = valueText.match(/(.+?)[：:\s]+([$￥¥]?\s*-?\d+(?:\.\d+)?%?)/);
  if (!match) return null;
  const label = text(match[1].replace(/[-–—,，]+$/, ''), 40);
  const value = Number(match[2].replace(/[$￥¥,%\s]/g, ''));
  return label && Number.isFinite(value) ? { label, value } : null;
}

function mapPentagram(scene = {}) {
  const v = visual(scene);
  const headline = firstMetric(v, 12);
  const anchor = (headline.match(/\d+/) || [''])[0].slice(0, 4);
  return {
    label: text((Array.isArray(v.keywords) && v.keywords[0]) || 'DATA', 40),
    headline,
    subtitle: summary(scene, 120),
    anchor: anchor || headline.slice(0, 4),
    duration_sec: clampDuration(scene, 3, 6),
  };
}

function mapDataChart(scene = {}) {
  const v = visual(scene);
  const source = [
    ...(Array.isArray(v.cards) ? v.cards : []),
    ...(Array.isArray(v.keywords) ? v.keywords : []),
  ];
  return {
    title: summary(scene, 100),
    subtitle: text(Array.isArray(v.keywords) ? v.keywords.join(' / ') : scene.narration_text, 200),
    data: source.map(parseDataPoint).filter(Boolean).slice(0, 12),
    duration_sec: clampDuration(scene, 5, 20),
  };
}

function mapGlitchTitle(scene = {}) {
  const v = visual(scene);
  return {
    title: text(v.headline || scene.title || (Array.isArray(v.keywords) && v.keywords[0]) || '标题', 40),
    subtitle: text((Array.isArray(v.keywords) && v.keywords[0]) || (Array.isArray(v.cards) && v.cards[0]) || '', 120),
    duration_sec: clampDuration(scene, 3, 8),
  };
}

function mapLogoOutro(scene = {}) {
  const v = visual(scene);
  const keywords = Array.isArray(v.keywords) ? v.keywords : [];
  const url = keywords.map(item => text(item, 200)).find(item => /\.[a-z]{2,}|https?:/i.test(item)) || '';
  return {
    brand_name: text(v.headline || scene.title || keywords[0] || '', 60) || '品牌',
    tagline: text((Array.isArray(v.cards) && v.cards[0]) || scene.narration_text || '', 120),
    primary_url: url,
    duration_sec: clampDuration(scene, 3, 10),
  };
}

function splitLines(value, maxLines, maxLen) {
  const src = String(value == null ? '' : value).trim();
  if (!src) return [];
  const parts = src.split(/[，,。.！!？?；;\n\/|]+/).map(item => item.trim()).filter(Boolean);
  const chunks = parts.length ? parts : [src];
  return chunks.slice(0, maxLines).map(item => text(item, maxLen)).filter(Boolean);
}

function mapBoldPoster(scene = {}) {
  const v = visual(scene);
  const cards = Array.isArray(v.cards) ? v.cards.map(item => text(item, 24)).filter(Boolean) : [];
  const headline = cards.length ? cards.slice(0, 3) : splitLines(v.headline || scene.title || '标题', 3, 24);
  return {
    kicker: text((Array.isArray(v.keywords) && v.keywords[0]) || '', 24),
    date: text((Array.isArray(v.keywords) && v.keywords[1]) || '', 24),
    figure: text((firstMetric(v, 8).match(/\d+/) || [''])[0], 4),
    headline: headline.length ? headline : [text(v.headline || '标题', 24)],
    standfirst: summary(scene, 160),
    duration_sec: clampDuration(scene, 4, 6),
  };
}

function mapTakram(scene = {}) {
  const v = visual(scene);
  return {
    eyebrow: text((Array.isArray(v.keywords) ? v.keywords.slice(0, 3).join(' · ') : '') || '', 48),
    title: text(v.headline || scene.title || '标题', 60),
    caption: text((Array.isArray(v.cards) && v.cards[0]) || scene.narration_text || '', 160),
    duration_sec: clampDuration(scene, 4, 7),
  };
}

function mapBuildMinimal(scene = {}) {
  const v = visual(scene);
  const hero = text((Array.isArray(v.keywords) && v.keywords[0]) || String(v.headline || '').trim().split(/\s+/)[0] || v.headline || '关键词', 16);
  return {
    eyebrow: text((Array.isArray(v.keywords) && v.keywords[1]) || '', 40),
    hero,
    desc: text(v.headline || scene.narration_text || (Array.isArray(v.cards) && v.cards[0]) || '', 140),
    duration_sec: clampDuration(scene, 4, 7),
  };
}

function mapElectricStudio(scene = {}) {
  const v = visual(scene);
  const cards = Array.isArray(v.cards) ? v.cards.map(item => text(item, 40)).filter(Boolean) : [];
  const quoteLines = cards.length ? cards.slice(0, 4) : splitLines(v.headline || scene.narration_text || '', 4, 40);
  return {
    quote_lines: quoteLines.length ? quoteLines : [text(v.headline || scene.narration_text || '引用', 40)],
    name: text((Array.isArray(v.keywords) && v.keywords[0]) || '', 40),
    role: text((Array.isArray(v.keywords) && v.keywords[1]) || '', 60),
    duration_sec: clampDuration(scene, 3, 6),
  };
}

function mapSceneToTemplateInputs(templateId, scene = {}, schema = {}) {
  if (templateId === 'frame-pentagram-stat') return mapPentagram(scene);
  if (templateId === 'frame-data-chart-nyt') return mapDataChart(scene);
  if (templateId === 'frame-glitch-title') return mapGlitchTitle(scene);
  if (templateId === 'frame-logo-outro') return mapLogoOutro(scene);
  if (templateId === 'frame-bold-poster') return mapBoldPoster(scene);
  if (templateId === 'frame-takram-organic') return mapTakram(scene);
  if (templateId === 'frame-build-minimal') return mapBuildMinimal(scene);
  if (templateId === 'frame-electric-studio') return mapElectricStudio(scene);
  return buildFrameInputs({
    templateInputs: {},
    templateSchema: schema,
    scene,
    sourceScene: scene,
    index: 0,
    total: 1,
  });
}

module.exports = { mapSceneToTemplateInputs };
