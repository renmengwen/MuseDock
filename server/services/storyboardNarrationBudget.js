const DEFAULT_CHARS_PER_SECOND = 4.5;
const DEFAULT_TOTAL_TOLERANCE = 1.15;
const DEFAULT_SCENE_TOLERANCE = 1.25;

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function countNarrationChars(text) {
  if (text === undefined || text === null) return 0;
  return Array.from(String(text).replace(/\s+/g, '').trim()).length;
}

function estimateNarrationDuration(text, charsPerSecond = DEFAULT_CHARS_PER_SECOND) {
  return round(countNarrationChars(text) / safeNumber(charsPerSecond, DEFAULT_CHARS_PER_SECOND));
}

function getSceneStatus(estimatedDurationSec, targetDurationSec, sceneTolerance) {
  const target = safeNumber(targetDurationSec, 0);
  if (!target) return 'ok';
  if (estimatedDurationSec > target * sceneTolerance) return 'too_long';
  if (estimatedDurationSec > target) return 'warning';
  return 'ok';
}

function buildNarrationBudget(storyboardPlan = {}, options = {}) {
  const charsPerSecond = safeNumber(options.charsPerSecond, DEFAULT_CHARS_PER_SECOND);
  const totalTolerance = safeNumber(options.totalTolerance, DEFAULT_TOTAL_TOLERANCE);
  const sceneTolerance = safeNumber(options.sceneTolerance, DEFAULT_SCENE_TOLERANCE);
  const targetDurationSec = safeNumber(storyboardPlan.target_duration_sec, 60);
  const scenes = Array.isArray(storyboardPlan.scenes) ? storyboardPlan.scenes : [];

  const sceneBudgets = scenes.map((scene, index) => {
    const target = safeNumber(scene?.target_duration_sec, 0);
    const estimatedDurationSec = estimateNarrationDuration(scene?.narration_text || '', charsPerSecond);
    return {
      index: Number(scene?.index || index + 1),
      target_duration_sec: round(target),
      narration_char_count: countNarrationChars(scene?.narration_text || ''),
      max_recommended_chars: target ? Math.floor(target * charsPerSecond) : 0,
      estimated_duration_sec: estimatedDurationSec,
      over_budget_sec: round(Math.max(0, estimatedDurationSec - target)),
      status: getSceneStatus(estimatedDurationSec, target, sceneTolerance),
    };
  });

  const totalNarrationChars = sceneBudgets.reduce((sum, scene) => sum + scene.narration_char_count, 0);
  const estimatedTotalDurationSec = round(totalNarrationChars / charsPerSecond);
  const totalStatus = estimatedTotalDurationSec > targetDurationSec * totalTolerance
    ? 'too_long'
    : estimatedTotalDurationSec > targetDurationSec
      ? 'warning'
      : 'ok';
  const hasTooLongScene = sceneBudgets.some(scene => scene.status === 'too_long');
  const hasWarningScene = sceneBudgets.some(scene => scene.status === 'warning');

  return {
    status: hasTooLongScene || totalStatus === 'too_long'
      ? 'too_long'
      : hasWarningScene || totalStatus === 'warning'
        ? 'warning'
        : 'ok',
    target_duration_sec: round(targetDurationSec),
    chars_per_second: charsPerSecond,
    total_tolerance: totalTolerance,
    scene_tolerance: sceneTolerance,
    total_narration_chars: totalNarrationChars,
    max_recommended_chars: Math.floor(targetDurationSec * charsPerSecond),
    estimated_total_duration_sec: estimatedTotalDurationSec,
    over_budget_sec: round(Math.max(0, estimatedTotalDurationSec - targetDurationSec)),
    scenes: sceneBudgets,
  };
}

module.exports = {
  DEFAULT_CHARS_PER_SECOND,
  countNarrationChars,
  estimateNarrationDuration,
  buildNarrationBudget,
};
