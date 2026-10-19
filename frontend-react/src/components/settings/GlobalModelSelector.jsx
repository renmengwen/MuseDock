import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { BUILTIN_FIRERED_REF, DEFAULT_FIRERED_BASE_URL, BUILTIN_INDEXTTS_REF } from './modelDefaults.js';

const MODEL_SELECTOR_HELP_TEXT = {
  image: '当前图片生成仅支持火山方舟 Seedream 4.0-5.0 以及 OpenAI gpt-image-2。',
  tts: '默认 IndexTTS 2.5＋FireRed 真实声学时间戳；也支持 MiMo、MiniMax 与豆包 Seed Audio。',
};

export function GlobalModelSelector({ modelTypes, modelTypeInfo, providerList, activeModels, onChange,
  analysisStreaming = false, onAnalysisStreamingChange,
  localIndexTts, onLocalIndexTtsChange,
  localFireRed, onLocalFireRedBaseUrlChange, onLocalFireRedPythonPathChange, onLocalFireRedModelCacheChange, disabled = false }) {
  return (
    <section className="mb-4 rounded-lg border border-[#e7e9ee] bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-lg font-bold">全局模型选择</h3>
          <p className="mt-1 text-[13px] text-[#69717e]">为每种功能选择本地模型或供应商模型。ASR 默认使用本地 FireRed。</p>
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
              {['asr', 'tts'].includes(type) ? (
                <Select value={value} disabled={disabled} onValueChange={ref => {
                  const [providerId, modelType] = ref.split('/');
                  onChange(type, providerId, modelType);
                }}>
                  <SelectTrigger id={`global-model-${type}`} className="h-[38px] bg-white"><SelectValue placeholder={type === 'tts' ? '选择配音模型' : '选择 ASR 转写模型'} /></SelectTrigger>
                  <SelectContent>
                    {type === 'asr' ? <SelectItem value={BUILTIN_FIRERED_REF}>FireRed（本地，默认）</SelectItem>
                      : <SelectItem value={BUILTIN_INDEXTTS_REF}>IndexTTS 2.5＋FireRed（本地，默认）</SelectItem>}
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
              {type === 'text' ? (
                <div className="mt-2 rounded-md border border-[#e7e9ee] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="analysis-streaming" className="cursor-pointer text-sm font-medium">分析模型流式请求</label>
                    <Switch id="analysis-streaming" checked={analysisStreaming} disabled={disabled}
                      onCheckedChange={onAnalysisStreamingChange} aria-describedby="analysis-streaming-help" />
                  </div>
                  <p id="analysis-streaming-help" className="mb-0 mt-2 text-xs leading-5 text-[#69717e]">
                    开启后，所有分析模型请求都使用流式接收，包括方案生成、视觉分析和 Agent 对话。服务商需支持流式；接收失败时不会自动降级为非流式请求。默认关闭，修改后请点击“保存模型配置”，后续请求生效。
                  </p>
                </div>
              ) : null}
              {type === 'asr' && value === BUILTIN_FIRERED_REF ? (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs leading-5 text-[#69717e]">FireRed 识别与字词声学对齐，无需 API Key。</span>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" disabled={disabled}>
                        <Settings2 />本地服务设置
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[85vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>FireRed 本地服务设置</DialogTitle>
                        <DialogDescription>按需调整服务参数。修改后请点击页面上方的“保存模型配置”。</DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4">
                        <div className="grid gap-1.5">
                          <label className="text-sm font-medium" htmlFor="local-firered-base-url">FireRed 服务地址</label>
                          <Input id="local-firered-base-url" type="url" value={localFireRed?.baseUrl ?? DEFAULT_FIRERED_BASE_URL}
                            placeholder={DEFAULT_FIRERED_BASE_URL} disabled={disabled}
                            onChange={event => onLocalFireRedBaseUrlChange?.(event.target.value)} />
                          <p className="m-0 text-xs leading-5 text-muted-foreground">开始抖音转写时会检查服务，本机服务未运行则自动启动并等待模型就绪。</p>
                        </div>
                        <div className="grid gap-1.5">
                          <label className="text-sm font-medium" htmlFor="local-firered-python-path">FireRed Python 路径（可选）</label>
                          <Input id="local-firered-python-path" value={localFireRed?.pythonPath || ''}
                            placeholder="留空自动查找，或填写已有环境的 Python 路径" disabled={disabled}
                            onChange={event => onLocalFireRedPythonPathChange?.(event.target.value)} />
                          <p className="m-0 text-xs leading-5 text-muted-foreground">首次先运行 npm run setup:asr 安装独立 Python 环境与模型；Python 需为 3.11 或 3.12。已有环境可填写解释器路径。</p>
                        </div>
                        <div className="grid gap-1.5">
                          <label className="text-sm font-medium" htmlFor="local-firered-model-cache">FireRed 模型缓存目录（可选）</label>
                          <Input id="local-firered-model-cache" value={localFireRed?.modelCache || ''}
                            placeholder="已有模型时填写缓存目录，避免重新下载" disabled={disabled}
                            onChange={event => onLocalFireRedModelCacheChange?.(event.target.value)} />
                          <p className="m-0 text-xs leading-5 text-muted-foreground">留空使用 MuseDock 数据目录中的 data/models/firered；自定义目录须用 setup:asr 的 --model-cache 参数安装模型。</p>
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
              {type === 'tts' && value === BUILTIN_INDEXTTS_REF ? (
                <Dialog>
                  <DialogTrigger asChild><Button variant="outline" size="sm" disabled={disabled}><Settings2 />本地配音设置</Button></DialogTrigger>
                  <DialogContent className="max-h-[85vh] overflow-y-auto">
                    <DialogHeader><DialogTitle>IndexTTS 本地配音设置</DialogTitle>
                      <DialogDescription>使用已有的 IndexTTS 2.5 CPU 环境。修改后点击页面上方“保存模型配置”。</DialogDescription></DialogHeader>
                    <div className="grid gap-4">
                      {[['rootPath', 'IndexTTS 安装目录（包含 repo 和 .venv）'], ['pythonPath', 'Python 路径（可选，默认安装目录内 .venv）'],
                        ['referenceAudio', '参考干声音频的完整路径'], ['durationFactor', '时长系数（0.5–2，越大越慢）'],
                        ['maxTextTokens', '分段 Token 上限（20–200，默认 120）'], ['threads', 'CPU 线程数（1–16）']].map(([key, label]) => (
                        <div className="grid gap-1.5" key={key}>
                          <label className="text-sm font-medium" htmlFor={`indextts-${key}`}>{label}</label>
                          <Input id={`indextts-${key}`} value={localIndexTts?.[key] ?? ''} disabled={disabled}
                            onChange={event => onLocalIndexTtsChange?.(key, event.target.value)} />
                        </div>
                      ))}
                      <p className="text-xs leading-5 text-muted-foreground">音频生成后使用 FireRed 独立识别和 CTC 声学对齐，不是 IndexTTS 原生字幕。请先运行 npm run setup:asr；FireRed 路径与地址沿用 ASR 卡片的本地服务设置。CPU 合成可能需要数分钟，识别与正文不一致时会保留音频并停止。</p>
                    </div>
                    <DialogFooter><DialogClose asChild><Button variant="outline">关闭</Button></DialogClose></DialogFooter>
                  </DialogContent>
                </Dialog>
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
