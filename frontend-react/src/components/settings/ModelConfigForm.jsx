import { Switch } from './Switch.jsx';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function ModelConfigForm({ type, info, model, onChange }) {
  const m = model || { enabled: false, modelId: '', note: '' };
  const isDoubao = m.modelId?.trim() === 'seed-audio-1.0';
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
      {type === 'asr' && m.enabled ? (
        <div className="mt-2 grid gap-2">
          <label className="grid gap-1.5">
            <span className="text-xs text-[#5f6876]">ASR 接口</span>
            <Select value={m.backend || 'mimo'} onValueChange={value => onChange('backend', value)}>
              <SelectTrigger aria-label="ASR 接口"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mimo">MiMo ASR</SelectItem>
                <SelectItem value="funasr">FunASR（本地或自部署）</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {m.backend === 'funasr' ? (
            <p className="m-0 text-xs leading-5 text-[#69717e]">普通本地使用可直接在全局 ASR 中选择内置 FunASR。这里用于配置自部署或需要鉴权的 FunASR 服务：模型 ID 填 paraformer，Base URL 填服务地址，API Key 按该服务要求填写。</p>
          ) : null}
        </div>
      ) : null}
      {type === 'tts' && m.enabled ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {isDoubao ? <div className="col-span-2 grid gap-2">
            <p className="m-0 text-xs leading-5 text-[#69717e]">豆包 Seed Audio 使用新版语音控制台 API Key；Base URL 填 https://openspeech.bytedance.com。单次完整旁白最多 120 秒，声音由下面的描述控制。</p>
            <label className="grid gap-1"><span className="text-xs">音色与整体表演描述</span>
              <Textarea aria-label="豆包音色与整体表演描述" maxLength={600} value={m.doubao?.voiceDirection ?? ''}
                placeholder="一位声音温暖、清晰自然的成年旁白，用交流的口吻讲述。"
                onChange={e => onChange('doubao', { ...m.doubao, voiceDirection: e.target.value })} />
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[['speechRate', '语速', -50, 100], ['loudnessRate', '音量', -50, 100], ['pitchRate', '音高', -12, 12]].map(([key, label, min, max]) => (
                <label key={key} className="grid gap-1"><span className="text-xs">{label}（{min}～{max}）</span>
                  <Input aria-label={`豆包${label}`} type="number" min={min} max={max} value={m.doubao?.[key] ?? 0}
                    onChange={e => onChange('doubao', { ...m.doubao, [key]: e.target.value })} />
                </label>
              ))}
            </div>
          </div> : <label className="col-span-2 grid gap-1">
            <span className="text-[11px] text-[#69717e]">voice_id（仅 MiniMax 支持，其他供应商会忽略）</span>
            <input
              value={m.voiceId ?? ''}
              className="h-[30px] w-full rounded-md border border-[#d9dde5] px-1.5 text-xs"
              onChange={e => onChange('voiceId', e.target.value)}
              placeholder="Chinese_deep_voiced_male_nv1"
            />
          </label>}
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
