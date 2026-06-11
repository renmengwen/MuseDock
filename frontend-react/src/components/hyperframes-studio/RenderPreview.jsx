export function RenderPreview({ freeform }) {
  const outputUrl = freeform?.render?.output_url;
  const contactSheetUrl = freeform?.visual_inspect?.contact_sheet_url;

  return (
    <section className="agentPanel">
      <h3>渲染预览</h3>

      {outputUrl ? (
        <div className="videoProjectMeta">
          <video src={outputUrl} controls />
          <a className="btn secondary" href={outputUrl} download>
            下载视频
          </a>
        </div>
      ) : (
        <p className="empty small">暂无渲染视频，请先渲染工程。</p>
      )}

      {contactSheetUrl ? (
        <div className="framesStrip">
          <div className="framesHeader">
            <strong>抽帧质检</strong>
            <a href={contactSheetUrl} target="_blank" rel="noreferrer">
              打开质检图
            </a>
          </div>
          <img className="cover" src={contactSheetUrl} alt="抽帧质检联系表" />
        </div>
      ) : (
        <p className="empty small">暂无抽帧质检结果。</p>
      )}
    </section>
  );
}
