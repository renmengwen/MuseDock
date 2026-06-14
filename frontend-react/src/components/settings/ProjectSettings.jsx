export function ProjectSettings({ skipValidation, onChange }) {
  return (
    <section className="settingsPanel">
      <div className="settingsPanelHeader">
        <div>
          <h3>工程设置</h3>
          <p>创作视频工程的全局行为配置。</p>
        </div>
      </div>
      <div className="projectSettingsBody">
        <label className="switchControl">
          <input
            type="checkbox"
            checked={!!skipValidation}
            onChange={e => onChange(e.target.checked)}
          />
          <span className="switchTrack" aria-hidden="true">
            <span className="switchThumb" />
          </span>
          <div className="switchLabel">
            <span className="switchText">{skipValidation ? '已启用' : '已停用'}</span>
            <span className="switchDesc">跳过质检 — 跳过工程校验和视觉质检，直接渲染视频</span>
          </div>
        </label>
      </div>
    </section>
  );
}
