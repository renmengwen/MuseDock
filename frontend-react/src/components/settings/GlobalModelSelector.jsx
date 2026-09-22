import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { BUILTIN_FUNASR_REF, DEFAULT_FUNASR_BASE_URL } from './modelDefaults.js';

const MODEL_SELECTOR_HELP_TEXT = {
  image: '当前图片生成仅支持火山方舟 Seedream 4.0-5.0 以及 OpenAI gpt-image-2。',
  tts: '支持小米 MiMo、MiniMax 与豆包 Seed Audio。线稿白板的完整旁白使用豆包或 MiniMax 的原生字幕。',
};

export function GlobalModelSelector({ modelTypes, modelTypeInfo, providerList, activeModels, onChange,
  localAsr, onLocalAsrBaseUrlChange, onLocalAsrPythonPathChange, onLocalAsrModelCacheChange, disabled = false }) {
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
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs leading-5 text-[#69717e]">本地 Paraformer 转写，无需 API Key。</span>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" disabled={disabled}>
                        <Settings2 />本地服务设置
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[85vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>FunASR 本地服务设置</DialogTitle>
                        <DialogDescription>按需调整服务参数。修改后请点击页面上方的“保存模型配置”。</DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4">
                        <div className="grid gap-1.5">
                          <label className="text-sm font-medium" htmlFor="local-funasr-base-url">FunASR 服务地址</label>
                          <Input id="local-funasr-base-url" type="url" value={localAsr?.baseUrl ?? DEFAULT_FUNASR_BASE_URL}
                            placeholder={DEFAULT_FUNASR_BASE_URL} disabled={disabled}
                            onChange={event => onLocalAsrBaseUrlChange?.(event.target.value)} />
                          <p className="m-0 text-xs leading-5 text-muted-foreground">开始抖音转写时会检查服务，本机服务未运行则自动启动并等待模型就绪。</p>
                        </div>
                        <div className="grid gap-1.5">
                          <label className="text-sm font-medium" htmlFor="local-funasr-python-path">FunASR Python 路径（可选）</label>
                          <Input id="local-funasr-python-path" value={localAsr?.pythonPath || ''}
                            placeholder="留空自动查找，或填写已有环境的 Python 路径" disabled={disabled}
                            onChange={event => onLocalAsrPythonPathChange?.(event.target.value)} />
                          <p className="m-0 text-xs leading-5 text-muted-foreground">需先安装 FunASR 依赖；已有独立环境时填写其中的 python.exe，保存后重启电脑也无需手动启动服务。</p>
                        </div>
                        <div className="grid gap-1.5">
                          <label className="text-sm font-medium" htmlFor="local-funasr-model-cache">FunASR 模型缓存目录（可选）</label>
                          <Input id="local-funasr-model-cache" value={localAsr?.modelCache || ''}
                            placeholder="已有模型时填写缓存目录，避免重新下载" disabled={disabled}
                            onChange={event => onLocalAsrModelCacheChange?.(event.target.value)} />
                          <p className="m-0 text-xs leading-5 text-muted-foreground">留空使用 ModelScope 默认缓存；远程地址及供应商服务由其部署环境负责启动。</p>
                        </div>
                      </div>
                      <DialogFooter>
                        <DialogClose asChild><Button variant="outline">关闭</Button></DialogClose>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
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
