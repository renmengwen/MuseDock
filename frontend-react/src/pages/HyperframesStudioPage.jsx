export function HyperframesStudioPage({ awemeId = '', runId = '' }) {
  return (
    <main className="container">
      <div className="workspaceIntro">
        <div>
          <h2>高级成片</h2>
          <p>高级 HyperFrames 成片工作台正在准备。</p>
        </div>
        <div className="settingsSummary">
          <strong>{awemeId || '未选择'}</strong>
          <span>{runId ? `运行 ${runId}` : '等待选择素材'}</span>
        </div>
      </div>
    </main>
  );
}
