export const WHITEBOARD_MODE = 'whiteboard-stream-v1';
export const HYPERFRAMES_MODE = 'hyperframes-v1';

export function createWhiteboardDraft() {
  return {
    inputMode: 'topic', contents: { topic: '', text: '', srt: '' }, rewritePolicy: 'preserve',
    targetDurationSeconds: 60, narrationLanguage: 'zh-CN', visualStylePreset: 'warm-paper-minimal-v1',
    aspectRatio: '16:9',
    productionPlan: { bgmMode: 'disabled', handDisplayMode: 'show', agentApprovalEnabled: false, imageGenerationMode: 'per_scene', burnSubtitles: true, narrationMode: 'enabled' },
  };
}

export function validateWhiteboardDraft(draft) {
  if (!['16:9', '9:16'].includes(draft.aspectRatio || '16:9')) return '请选择横屏 16:9 或竖屏 9:16。';
  const text = (draft.contents[draft.inputMode] || '').trim();
  if (!text) return '请输入创作内容。';
  if (text.length > 50000) return '创作内容不能超过 50000 个字符。';
  if (draft.inputMode !== 'srt') {
    const seconds = Number(draft.targetDurationSeconds);
    if (!Number.isInteger(seconds) || seconds < 15 || seconds > 600) return '目标时长需为 15–600 秒的整数。';
    return '';
  }
  let lastEnd = 0;
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
  if (blocks.length > 400) return 'SRT 最多支持 400 条字幕，请拆分后再创建。';
  for (const [index, block] of blocks.entries()) {
    const lines = block.split('\n');
    const match = /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3}) --> (\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/.exec(lines[1] || '');
    if (Number(lines[0]) !== index + 1 || !match || !lines.slice(2).join('\n').trim()) return `第 ${index + 1} 条 SRT 格式无效，请检查序号、时间码和字幕正文。`;
    const ms = offset => (Number(match[offset]) * 3600 + Number(match[offset + 1]) * 60 + Number(match[offset + 2])) * 1000 + Number(match[offset + 3]);
    if (ms(5) <= ms(1) || ms(1) < lastEnd) return `第 ${index + 1} 条字幕时间倒序或重叠。`;
    lastEnd = ms(5);
  }
  return '';
}

export function buildWhiteboardPayload(draft) {
  return {
    creationModeId: WHITEBOARD_MODE,
    input: {
      inputMode: draft.inputMode, content: draft.contents[draft.inputMode].trim(),
      narrationLanguage: draft.narrationLanguage, visualStylePreset: draft.visualStylePreset,
      aspectRatio: draft.aspectRatio || '16:9',
      ...(draft.inputMode === 'srt' ? {} : {
        rewritePolicy: draft.inputMode === 'topic' ? 'generate' : draft.rewritePolicy,
        targetDurationSeconds: Number(draft.targetDurationSeconds),
      }),
    },
    productionPlan: { ...draft.productionPlan },
  };
}

export function isWhiteboardPaused(status) {
  return ['waiting_approval', 'phase0_complete', 'unknown_external_outcome'].includes(status);
}
