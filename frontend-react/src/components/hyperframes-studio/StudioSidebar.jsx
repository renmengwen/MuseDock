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
  generateBrief,
  generateProject,
  checkProject,
  renderVideo,
  inspectVideo,
  selectRun,
}) {
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
