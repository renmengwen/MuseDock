function getExportLabel(item, index) {
  return item?.path || item?.url || item?.file || `导出 ${index + 1}`;
}

export function ExportsPanel({ exportsList = [], disabled, exporting, onExport, onRefresh }) {
  return (
    <section className="creative-video-editor-panel html-video-exports">
      <div className="creative-video-editor-panel-header">
        <h3>导出记录</h3>
        <div className="creative-video-editor-inline-actions">
          <button type="button" disabled={disabled} onClick={onRefresh}>刷新</button>
          <button type="button" disabled={disabled} onClick={() => onExport({})}>
            {exporting ? '正在导出成片...' : '导出成片'}
          </button>
        </div>
      </div>
      {exportsList.length ? exportsList.map((item, index) => (
        <div className="creative-video-editor-export-item" key={item.id || item.path || index}>
          <strong>{getExportLabel(item, index)}</strong>
          <span>{item.created_at || item.status || '已生成'}</span>
        </div>
      )) : <p>暂无导出记录</p>}
    </section>
  );
}
