const HYPERFRAMES_MODE = 'hyperframes-v1';
const WHITEBOARD_MODE = 'whiteboard-stream-v1';
const ILLUSTRATED_MODE = 'illustrated-narration-v1';

const HYPERFRAMES_STAGES = [
  ['source', '准备来源资料'], ['research', '联网研究'], ['assets', '素材分析'],
  ['agent_run', '导演改写'], ['brief', '成片策划'], ['audio', '生成音频轨'],
  ['project', '生成工程'], ['check', '校验工程'], ['render', '渲染视频'], ['inspect', '巡检视频'],
].map(([id, label]) => ({ id, label }));

const WHITEBOARD_STAGES = [
  { id: 'intake', label: '确认创作输入' },
  { id: 'content_plan', label: '整理内容与分镜' },
  { id: 'initial_approval', label: '确认内容与制作方案' },
];

const MODES = [
  {
    id: HYPERFRAMES_MODE, displayName: 'HyperFrames 动态视频', contractVersion: 1,
    description: '自动研究和组织素材，生成可继续编辑的动态视频工程。',
    stageSchema: HYPERFRAMES_STAGES, detailView: 'hyperframes',
    capabilities: { videoProduction: true, phase0Approval: false },
  },
  {
    id: WHITEBOARD_MODE, displayName: '线稿白板动画', contractVersion: 1,
    description: '确认内容与分镜后，生成完整旁白、连续落墨动画和带字幕的最终视频。',
    stageSchema: WHITEBOARD_STAGES, detailView: 'whiteboard-agent',
    capabilities: { videoProduction: true, phase0Approval: true },
  },
  {
    id: ILLUSTRATED_MODE, displayName: '旁白配图视频', contractVersion: 1,
    description: '先确认文稿与配音，再选择配图、调整轻运镜，预览并导出视频；也支持无配音制作。',
    stageSchema: require('./illustrated/contracts').STAGES, detailView: 'illustrated-narration',
    capabilities: { videoProduction: true, phase0Approval: true, optionalNarration: true },
  },

];

function getCreationMode(id = HYPERFRAMES_MODE) {
  return MODES.find(mode => mode.id === id) || null;
}

function createModeSnapshot(id = HYPERFRAMES_MODE) {
  const mode = getCreationMode(id);
  if (!mode) throw new Error('不支持的创作模式，请重新选择。');
  return {
    creationModeId: mode.id,
    creationModeContractVersion: mode.contractVersion,
    creationModeDisplayNameSnapshot: mode.displayName,
    stageSchemaSnapshot: mode.stageSchema.map(stage => ({ ...stage })),
  };
}

function readModeSnapshot(record = {}) {
  if (!record || typeof record !== 'object') record = {};
  // 旧任务仅在读取时补充兼容视图，不回写文件。
  if (!record.creationModeId) return createModeSnapshot();
  const fallback = getCreationMode(record.creationModeId);
  return {
    creationModeId: record.creationModeId,
    creationModeContractVersion: record.creationModeContractVersion,
    creationModeDisplayNameSnapshot: record.creationModeDisplayNameSnapshot || fallback?.displayName || '未知创作模式',
    stageSchemaSnapshot: record.stageSchemaSnapshot || fallback?.stageSchema || [],
  };
}

module.exports = { HYPERFRAMES_MODE, WHITEBOARD_MODE, ILLUSTRATED_MODE, HYPERFRAMES_STAGES, MODES, getCreationMode, createModeSnapshot, readModeSnapshot };
