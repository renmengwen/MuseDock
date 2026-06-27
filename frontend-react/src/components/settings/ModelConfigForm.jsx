export function ModelConfigForm({ type, info, model, onChange }) {
  const m = model || { enabled: false, modelId: '', note: '' };
  return (
    <div className={`modelConfigForm ${m.enabled ? 'active' : ''}`}>
      <div className="modelConfigFormHeader">
        <label className="switchControl small">
          <input
            type="checkbox"
            checked={!!m.enabled}
            onChange={e => onChange('enabled', e.target.checked)}
          />
          <span className="switchTrack" aria-hidden="true">
            <span className="switchThumb" />
          </span>
        </label>
        <span className="modelConfigFormTitle">{info.title}</span>
      </div>
      <input
        className="modelConfigFormInput"
        value={m.modelId}
        onChange={e => onChange('modelId', e.target.value)}
        placeholder={info.placeholder}
        disabled={!m.enabled}
      />
      {type === 'tts' && m.enabled ? (
        <div className="modelConfigFormTtsRow">
          <label>
            <span>并发</span>
            <input
              type="number"
              min="1"
              max="5"
              value={m.ttsConcurrency ?? 1}
              onChange={e => onChange('ttsConcurrency', e.target.value)}
            />
          </label>
          <label>
            <span>间隔(ms)</span>
            <input
              type="number"
              min="0"
              max="10000"
              step="100"
              value={m.ttsQueueIntervalMs ?? 1800}
              onChange={e => onChange('ttsQueueIntervalMs', e.target.value)}
            />
          </label>
        </div>
      ) : null}
      {type === 'text' && m.enabled ? (
        <label className="modelConfigFormToggleRow">
          <input
            type="checkbox"
            checked={m.supportsMultimodal === true}
            onChange={e => onChange('supportsMultimodal', e.target.checked)}
          />
          <span>支持多模态输入</span>
        </label>
      ) : null}
    </div>
  );
}
