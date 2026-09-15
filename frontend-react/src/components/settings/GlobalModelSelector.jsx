import { Input } from '@/components/ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { BUILTIN_FUNASR_REF, DEFAULT_FUNASR_BASE_URL } from './modelDefaults.js';

const MODEL_SELECTOR_HELP_TEXT = {
  image: '当前图片生成仅支持火山方舟 Seedream 4.0-5.0 以及 OpenAI gpt-image-2。',
  tts: '支持小米 MiMo、MiniMax 与豆包 Seed Audio。线稿白板的完整旁白使用豆包或 MiniMax 的原生字幕。',
};

export function GlobalModelSelector({ modelTypes, modelTypeInfo, providerList, activeModels, onChange,
  localAsr, onLocalAsrBaseUrlChange, disabled = false }) {
  return (
    <section className="mb-4 rounded-lg border border-[#e7e9ee] bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-lg font-bold">全局模型选择</h3>
          <p className="mt-1 text-[13px] text-[#69717e]">为每种功能选择本地模型或供应商模型。ASR 默认使用本地 FunASR。</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
        {modelTypes.map(type => {
          const info = modelTypeInfo[type];
          const current = activeModels[type];
          const value = current?.ref || (current ? `${current.providerId}/${type}` : '');
          return (
            <div className="grid content-start gap-1.5 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3" key={type}>
              <label htmlFor={`global-model-${type}`} className="text-xs font-semibold text-[#5f6876]">{info.title}</label>
              {type === 'asr' ? (
                <Select value={value} disabled={disabled} onValueChange={ref => {
                  const [providerId, modelType] = ref.split('/');
                  onChange(type, providerId, modelType);
                }}>
                  <SelectTrigger id={`global-model-${type}`} className="h-[38px] bg-white"><SelectValue placeholder="选择 ASR 转写模型" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BUILTIN_FUNASR_REF}>FunASR（本地，默认）</SelectItem>
                    {providerList.map(p => {
                      const model = p.models[type];
                      return <SelectItem key={p.id} value={`${p.id}/${type}`} disabled={!model?.enabled || !model?.modelId}>
                        {p.name || p.id} — {model?.modelId || '未配置'}
                      </SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              ) : <select
                id={`global-model-${type}`}
                className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15"
                value={value}
                disabled={disabled}
                onChange={event => {
                  const val = event.target.value;
                  if (!val) { onChange(type, '', ''); return; }
                  const [pid] = val.split('/');
                  onChange(type, pid, type);
                }}
              >
                <option value="">未选择</option>
                {providerList.map(p => {
                  const m = p.models[type];
                  const disabled = !m?.enabled || !m?.modelId;
                  return (
                    <option key={p.id} value={`${p.id}/${type}`} disabled={disabled}>
                      {p.name || p.id} — {m?.modelId || '(未配置)'}
                    </option>
                  );
                })}
              </select>}
              {type === 'asr' && value === BUILTIN_FUNASR_REF ? (
                <div className="mt-1 grid gap-2">
                  <span className="text-xs leading-5 text-[#69717e]">使用本地 Paraformer 转写，无需添加供应商或填写 API Key。</span>
                  <label className="grid gap-1.5 text-xs text-[#5f6876]" htmlFor="local-funasr-base-url">
                    FunASR 服务地址
                    <Input id="local-funasr-base-url" type="url" value={localAsr?.baseUrl ?? DEFAULT_FUNASR_BASE_URL}
                      placeholder={DEFAULT_FUNASR_BASE_URL} disabled={disabled}
                      onChange={event => onLocalAsrBaseUrlChange?.(event.target.value)} />
                  </label>
                  <span className="text-[11px] leading-5 text-[#69717e]">使用前需启动本地 FunASR 服务；默认地址可直接使用，端口不同时在这里修改。</span>
                </div>
              ) : null}
              {current ? (
                <span className="text-xs text-[#69717e]">{current.providerName} / {current.modelId}</span>
              ) : null}
              {MODEL_SELECTOR_HELP_TEXT[type] ? (
                <span className="text-[11px] font-semibold leading-5 text-[#69717e]">
                  {MODEL_SELECTOR_HELP_TEXT[type]}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
