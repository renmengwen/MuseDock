function getProjectFiles(files) {
  if (Array.isArray(files)) {
    return files.map((file) => (typeof file === 'string' ? file : file?.name)).filter(Boolean);
  }
  if (files && typeof files === 'object') {
    return Object.keys(files);
  }
  return [];
}

function runSafely(action) {
  if (typeof action === 'function') {
    void action().catch(() => {});
  }
}

function renderChecks(checks) {
  if (!checks) return <p className="mutedText">暂无校验结果。</p>;
  const message = checks.message || checks.summary || '';
  return (
    <div className="agentStep">
      <span>工程校验</span>
      <span className={`stepBadge ${checks.status || 'pending'}`}>{checks.status || '未校验'}</span>
      {message ? <small>{message}</small> : null}
    </div>
  );
}

export function ProjectPanel({
  freeform,
  selectedFile,
  setSelectedFile,
  fileContent,
  setFileContent,
  busyAction = '',
  canUseWorkflow = false,
  loadFile,
  saveFile,
}) {
  const busy = Boolean(busyAction);
  const files = getProjectFiles(freeform?.project?.files);
  const canUseFile = canUseWorkflow && !busy && Boolean(selectedFile);

  return (
    <section className="agentPanel agentResultPanel">
      <div className="agentResultTitleRow">
        <h3>工程文件</h3>
        <span>{selectedFile || '未选择文件'}</span>
      </div>

      {files.length ? (
        <div className="videoProjectToolbar">
          <div>
            <strong>当前文件</strong>
            <select
              value={selectedFile}
              onChange={(event) => setSelectedFile(event.target.value)}
              disabled={busy}
            >
              {files.map((file) => (
                <option key={file} value={file}>
                  {file}
                </option>
              ))}
            </select>
          </div>
          <div className="videoProjectActions">
            <button
              className="btn secondary"
              type="button"
              disabled={!canUseFile}
              onClick={() => runSafely(() => loadFile(selectedFile))}
            >
              {busyAction === 'loadFile' ? '正在加载文件...' : '加载文件'}
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={!canUseFile}
              onClick={() => runSafely(() => saveFile())}
            >
              {busyAction === 'saveFile' ? '正在保存文件...' : '保存文件'}
            </button>
          </div>
        </div>
      ) : (
        <p className="empty small">暂无工程文件，请先生成 HyperFrames 工程。</p>
      )}

      <div className="promptEditor">
        <label>
          <span>文件内容</span>
          <textarea
            value={fileContent}
            onChange={(event) => setFileContent(event.target.value)}
            placeholder="选择并加载工程文件后可在这里编辑。"
            disabled={busy || !canUseWorkflow}
          />
        </label>
      </div>

      <div className="agentSteps compact">{renderChecks(freeform?.checks)}</div>
    </section>
  );
}
