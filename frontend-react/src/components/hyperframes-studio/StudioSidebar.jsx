import { useState } from 'react';

const TTS_VOICES = [
  { value: '', label: '使用导演策划' },
  { value: 'mimo_default', label: '默认音色' },
  { value: '冰糖', label: '冰糖' },
  { value: '茉莉', label: '茉莉' },
  { value: '苏打', label: '苏打' },
  { value: '白桃', label: '白桃' },
  { value: 'Mia', label: 'Mia' },
  { value: 'Chloe', label: 'Chloe' },
  { value: 'Milo', label: 'Milo' },
  { value: 'Dean', label: 'Dean' },
];

const AUDIO_STYLE_PLACEHOLDER = '留空时使用导演策划自动生成的音频导演提示。可覆盖为：紧张、深呼吸、吸气、语速加快、带一点笑意、（长叹一口气）';

function getRunId(run) {
  return run?.run_id || run?.runId || '';
}

function getRunLabel(run) {
  const runId = getRunId(run);
  const status = run?.status || run?.workflow_status || '未知状态';
  return runId ? `${runId} · ${status}` : '未命名运行记录';
}

function runSafely(action) {
  if (typeof action === 'function') {
    void action().catch(() => {});
  }
}

export function StudioSidebar({
  awemeId,
  setAwemeId,
  runId,
  setRunId,
  runs = [],
  busyAction = '',
  canUseWorkflow = false,
  refreshRuns,
  createFreeformRun,
  generateBrief,
  generateAudio,
  generateProject,
  checkProject,
  renderVideo,
  inspectVideo,
  selectRun,
}) {
  const [ttsVoice, setTtsVoice] = useState('');
  const [audioStylePrompt, setAudioStylePrompt] = useState('');
  const busy = Boolean(busyAction);
  const canReadRuns = Boolean(String(awemeId || '').trim()) && !busy;
  const canRunWorkflow = canUseWorkflow && !busy;
  const handleRunChange = (event) => {
    const nextRunId = event.target.value;
    const nextRun = runs.find((run) => getRunId(run) === nextRunId);
    if (nextRun && typeof selectRun === 'function') {
      selectRun(nextRun);
      return;
    }
    setRunId(nextRunId);
  };

  return (
    <aside className="agentPanel">
      <h3>素材与控制</h3>

      <div className="agentOptionGroup">
        <label>
          <span>抖音 aweme_id</span>
          <input
            value={awemeId}
            onChange={(event) => setAwemeId(event.target.value)}
            placeholder="请输入 aweme_id"
            disabled={busy}
          />
        </label>
        <button
          className="btn secondary"
          type="button"
          disabled={!canReadRuns}
          onClick={() => runSafely(() => refreshRuns())}
        >
          {busyAction === 'refreshRuns' ? '正在读取运行记录...' : '读取运行记录'}
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={!canReadRuns}
          onClick={() => runSafely(() => createFreeformRun())}
        >
          {busyAction === 'createFreeformRun' ? '正在新建成片记录...' : '新建成片记录'}
        </button>
      </div>

      <div className="agentOptionGroup">
        <label>
          <span>运行记录</span>
          <select value={runId} onChange={handleRunChange} disabled={busy}>
            <option value="">请选择运行记录</option>
            {runs.map((run) => {
              const optionRunId = getRunId(run);
              return (
                <option key={optionRunId || getRunLabel(run)} value={optionRunId}>
                  {getRunLabel(run)}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <div className="agentOptionGroup primaryActionGroup">
        <button
          className="btn primary"
          type="button"
          disabled={!canRunWorkflow}
          onClick={() => runSafely(() => generateBrief())}
        >
          {busyAction === 'generateBrief' ? '正在生成导演策划...' : '生成导演策划'}
        </button>
        <label>
          <span>音频导演</span>
          <select
            value={ttsVoice}
            onChange={(event) => setTtsVoice(event.target.value)}
            disabled={busy}
            aria-label="高级成片音色"
          >
            {TTS_VOICES.map((voice) => (
              <option key={voice.value} value={voice.value}>{voice.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>情绪、口吻与停顿</span>
          <textarea
            value={audioStylePrompt}
            onChange={(event) => setAudioStylePrompt(event.target.value)}
            disabled={busy}
            placeholder={AUDIO_STYLE_PLACEHOLDER}
          />
        </label>
        <button
          className="btn primary"
          type="button"
          disabled={!canRunWorkflow}
          onClick={() => runSafely(() => generateAudio({
            voice: ttsVoice || undefined,
            stylePrompt: audioStylePrompt.trim() || undefined,
          }))}
        >
          {busyAction === 'generateAudio' ? '正在生成音频轨...' : '生成音频轨'}
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={!canRunWorkflow}
          onClick={() => runSafely(() => generateProject())}
        >
          {busyAction === 'generateProject' ? '正在生成工程...' : '生成 HyperFrames 工程'}
        </button>
        <button
          className="btn secondary"
          type="button"
          disabled={!canRunWorkflow}
          onClick={() => runSafely(() => checkProject())}
        >
          {busyAction === 'checkProject' ? '正在校验工程...' : '校验工程'}
        </button>
        <button
          className="btn secondary"
          type="button"
          disabled={!canRunWorkflow}
          onClick={() => runSafely(() => renderVideo())}
        >
          {busyAction === 'renderVideo' ? '正在渲染视频...' : '渲染视频'}
        </button>
        <button
          className="btn secondary"
          type="button"
          disabled={!canRunWorkflow}
          onClick={() => runSafely(() => inspectVideo())}
        >
          {busyAction === 'inspectVideo' ? '正在抽帧质检...' : '抽帧质检'}
        </button>
      </div>
    </aside>
  );
}
