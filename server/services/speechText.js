const STAGE_DIRECTIONS = [
  '吸气',
  '深呼吸',
  '停顿',
  '稍停顿',
  '短暂停顿',
  '稍作停顿',
  '沉默片刻',
  '轻笑',
  '长叹一口气',
  '语速加快',
  '语速放慢',
];

const CJK_STAGE_DIRECTION_RE = new RegExp(`（\\s*(?:${STAGE_DIRECTIONS.join('|')})\\s*）`, 'g');
const ASCII_STAGE_DIRECTION_RE = /\[\s*(?:pause|breath|inhale|laugh|sigh)\s*\]/gi;

function stripSpeechStageDirections(value) {
  return String(value ?? '')
    .replace(CJK_STAGE_DIRECTION_RE, '')
    .replace(ASCII_STAGE_DIRECTION_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

module.exports = {
  stripSpeechStageDirections,
};
