const assert = require('assert');

const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { supportsTemplateInputs } = require('../server/services/creative-video/html-video/templateCapability');
const { mapSceneToTemplateInputs } = require('../server/services/creative-video/html-video/templateInputMappers');
const { validateTemplateInputs } = require('../server/services/creative-video/html-video/templateInputAgent');

const registry = createTemplateRegistry();
registry.scanTemplates();

const pentagram = registry.getTemplate('frame-pentagram-stat');
const dataChart = registry.getTemplate('frame-data-chart-nyt');
assert.equal(supportsTemplateInputs(pentagram), true);
assert.equal(supportsTemplateInputs(dataChart), true);

const metricScene = {
  id: 'metric',
  kind: 'data',
  duration_sec: 4,
  narration_text: '转化率达到 88.6%，明显高于上周。',
  visual_text: {
    headline: '转化率达到 88.6%',
    keywords: ['核心指标', '88.6%'],
    cards: ['转化率 88.6%'],
  },
};
const pentagramInputs = mapSceneToTemplateInputs('frame-pentagram-stat', metricScene, pentagram.inputs.schema);
assert.equal(validateTemplateInputs(pentagramInputs, pentagram).success, true);
assert.equal(pentagramInputs.headline, '88.6%');

const chartScene = {
  id: 'chart',
  kind: 'data',
  duration_sec: 8,
  narration_text: '三个渠道都在增长。',
  visual_text: {
    headline: '渠道增长对比',
    keywords: ['2026 Q2'],
    cards: ['搜索 12', '推荐 34', '私域 56'],
  },
};
const chartInputs = mapSceneToTemplateInputs('frame-data-chart-nyt', chartScene, dataChart.inputs.schema);
assert.equal(validateTemplateInputs(chartInputs, dataChart).success, true);
assert.equal(chartInputs.data.length, 3);

const badChartScene = {
  id: 'bad-chart',
  kind: 'data',
  duration_sec: 8,
  visual_text: {
    headline: '只有一个点',
    cards: ['搜索 12'],
  },
};
const badInputs = mapSceneToTemplateInputs('frame-data-chart-nyt', badChartScene, dataChart.inputs.schema);
const badValidation = validateTemplateInputs(badInputs, dataChart);
assert.equal(badValidation.success, false);
assert.ok(badValidation.diagnostics.some(item => item.includes('数量不能少于 2')));

const glitch = registry.getTemplate('frame-glitch-title');
assert.equal(supportsTemplateInputs(glitch), true);
const textScene = {
  id: 'text',
  kind: 'text',
  duration_sec: 4,
  narration_text: '发布全新引擎。',
  visual_text: { headline: '全新引擎发布', keywords: ['2026 发布'] },
};
const glitchInputs = mapSceneToTemplateInputs('frame-glitch-title', textScene, glitch.inputs.schema);
assert.equal(validateTemplateInputs(glitchInputs, glitch).success, true);
assert.equal(glitchInputs.title, '全新引擎发布');

const logo = registry.getTemplate('frame-logo-outro');
assert.equal(supportsTemplateInputs(logo), true);
const ctaScene = {
  id: 'cta',
  kind: 'cta',
  duration_sec: 5,
  narration_text: '现在就试试。',
  visual_text: { headline: 'MuseDock', cards: ['本地优先的创作台'], keywords: ['musedock.app'] },
};
const logoInputs = mapSceneToTemplateInputs('frame-logo-outro', ctaScene, logo.inputs.schema);
assert.equal(validateTemplateInputs(logoInputs, logo).success, true);
assert.equal(logoInputs.brand_name, 'MuseDock');
assert.equal(logoInputs.primary_url, 'musedock.app');

const boldPoster = registry.getTemplate('frame-bold-poster');
assert.equal(supportsTemplateInputs(boldPoster), true);
const posterInputs = mapSceneToTemplateInputs('frame-bold-poster', {
  id: 'poster', kind: 'cta', duration_sec: 5,
  visual_text: { headline: '大声表达', cards: ['大声', '表达', '要持久'], keywords: ['宣言', 'Vol.04'] },
}, boldPoster.inputs.schema);
assert.equal(validateTemplateInputs(posterInputs, boldPoster).success, true);
assert.ok(Array.isArray(posterInputs.headline) && posterInputs.headline.length >= 1);

const takram = registry.getTemplate('frame-takram-organic');
assert.equal(supportsTemplateInputs(takram), true);
const takramInputs = mapSceneToTemplateInputs('frame-takram-organic', {
  id: 'takram', kind: 'steps', duration_sec: 5,
  visual_text: { headline: '系统如何演化', cards: ['八个上下文节点汇聚成核心'], keywords: ['上下文', '记忆'] },
}, takram.inputs.schema);
assert.equal(validateTemplateInputs(takramInputs, takram).success, true);
assert.equal(takramInputs.title, '系统如何演化');

const buildMinimal = registry.getTemplate('frame-build-minimal');
assert.equal(supportsTemplateInputs(buildMinimal), true);
const buildInputs = mapSceneToTemplateInputs('frame-build-minimal', {
  id: 'build', kind: 'text', duration_sec: 5,
  visual_text: { headline: '进化', keywords: ['进化', '关于成长'] },
}, buildMinimal.inputs.schema);
assert.equal(validateTemplateInputs(buildInputs, buildMinimal).success, true);
assert.equal(buildInputs.hero, '进化');

const electric = registry.getTemplate('frame-electric-studio');
assert.equal(supportsTemplateInputs(electric), true);
const electricInputs = mapSceneToTemplateInputs('frame-electric-studio', {
  id: 'electric', kind: 'quote', duration_sec: 4,
  visual_text: { headline: '保持专注', cards: ['保持专注', '持续迭代'] },
}, electric.inputs.schema);
assert.equal(validateTemplateInputs(electricInputs, electric).success, true);
assert.ok(Array.isArray(electricInputs.quote_lines) && electricInputs.quote_lines.length >= 1);

console.log('html-video template inputs source tests passed');
