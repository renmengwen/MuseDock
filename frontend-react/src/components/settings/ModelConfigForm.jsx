import { Switch } from './Switch.jsx';

export function ModelConfigForm({ type, info, model, onChange }) {
  const m = model || { enabled: false, modelId: '', note: '' };
  return (
    <div className={`rounded-lg border bg-white p-3 transition ${m.enabled ? 'border-[#111827]' : 'border-[#edf0f4]'}`}>
      <div className="mb-2 flex items-center gap-2">
        <Switch small checked={!!m.enabled} onChange={e => onChange('enabled', e.target.checked)} />
        <span className="text-[13px] font-semibold text-[#30343b]">{info.title}</span>
      </div>
      <input
        className="h-[34px] w-full rounded-md border border-[#d9dde5] bg-[#fafbfc] px-2 text-xs text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15 disabled:opacity-50"
        value={m.modelId}
        onChange={e => onChange('modelId', e.target.value)}
        placeholder={info.placeholder}
        disabled={!m.enabled}
      />
      {type === 'tts' && m.enabled ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="grid gap-1">
            <span className="text-[11px] text-[#69717e]">并发</span>
            <input
              type="number"
              min="1"
              max="5"
              value={m.ttsConcurrency ?? 1}
              className="h-[30px] w-full rounded-md border border-[#d9dde5] px-1.5 text-xs"
              onChange={e => onChange('ttsConcurrency', e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] text-[#69717e]">间隔(ms)</span>
            <input
              type="number"
              min="0"
              max="10000"
              step="100"
              value={m.ttsQueueIntervalMs ?? 1800}
              className="h-[30px] w-full rounded-md border border-[#d9dde5] px-1.5 text-xs"
              onChange={e => onChange('ttsQueueIntervalMs', e.target.value)}
            />
          </label>
        </div>
      ) : null}
      {type === 'tts' ? (
        <p className="mt-2 mb-0 text-[11px] font-semibold leading-5 text-[#69717e]">
          当前 TTS 功能仅支持小米 MiMo 和 MiniMax 供应商。
        </p>
      ) : null}
      {type === 'text' && m.enabled ? (
        <label className="mt-2 flex items-center gap-1.5 text-xs text-[#5f6876]">
          <input
            className="size-3.5"
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
