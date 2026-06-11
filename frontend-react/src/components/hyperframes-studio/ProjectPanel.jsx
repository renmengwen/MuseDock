import { useState } from 'react';

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
  const [loadedFileName, setLoadedFileName] = useState('');
  const busy = Boolean(busyAction);
  const files = getProjectFiles(freeform?.project?.files);
  const canUseFile = canUseWorkflow && !busy && Boolean(selectedFile);
  const currentFileLoaded = Boolean(selectedFile) && selectedFile === loadedFileName;
  const canSaveFile = canUseFile && currentFileLoaded;
  const handleFileChange = (event) => {
    const nextFile = event.target.value;
    setSelectedFile(nextFile);
    setLoadedFileName('');
    setFileContent('');
    runSafely(async () => {
      await loadFile(nextFile);
      setLoadedFileName(nextFile);
    });
  };
  const handleLoadFile = () => {
    setLoadedFileName('');
    runSafely(async () => {
      await loadFile(selectedFile);
      setLoadedFileName(selectedFile);
    });
  };

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
              onChange={handleFileChange}
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
              onClick={handleLoadFile}
            >
              {busyAction === 'loadFile' ? '正在加载文件...' : '加载文件'}
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={!canSaveFile}
              onClick={() => runSafely(() => saveFile())}
            >
              {busyAction === 'saveFile' ? '正在保存文件...' : currentFileLoaded ? '保存文件' : '请先加载当前文件'}
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
