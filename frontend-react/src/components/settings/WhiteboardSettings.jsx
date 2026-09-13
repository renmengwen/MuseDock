import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import concurrencySpec from '../../../../server/resources/whiteboard/concurrency-settings.json';

const FIELDS = [
  { key: 'imageConcurrency', label: '生图并发数', description: '同时调用图片模型，生成不同幕的线稿图片。' },
  { key: 'annotationConcurrency', label: '落墨编排并发数', description: '同时分析不同幕的图片，划分绘制区域并安排落墨顺序。' },
  { key: 'renderConcurrency', label: '单幕渲染并发数', description: '同时将不同幕的线稿与标注渲染为动画视频。' },
];
const DEFAULTS = Object.fromEntries(Object.entries(concurrencySpec).map(([key, spec]) => [key, spec.default]));

export function WhiteboardSettings({ appSettings, disabled, saving, onChange, onSave }) {
  const settings = { ...DEFAULTS, ...appSettings?.whiteboard };
  const invalid = key => !Number.isInteger(settings[key])
    || settings[key] < concurrencySpec[key].min || settings[key] > concurrencySpec[key].max;
  const invalidFields = FIELDS.filter(field => invalid(field.key));

  function update(key, value) {
    onChange({ ...appSettings, whiteboard: { ...settings, [key]: value === '' ? '' : Number(value) } });
  }

  return <section aria-labelledby="whiteboard-settings-title" className="grid gap-5">
    <form className="grid gap-5" onSubmit={event => {
      event.preventDefault();
      if (!disabled && !saving && appSettings && !invalidFields.length) onSave({ whiteboard: settings });
    }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="whiteboard-settings-title" className="m-0 text-lg font-bold">白板动画设置</h3>
          <p className="mb-0 mt-1 text-[13px] leading-6 text-[#69717e]">分别设置生图、落墨编排和单幕视频渲染的并发数。三个阶段按制作流程依次执行。</p>
        </div>
        <Button type="submit" disabled={disabled || saving || !appSettings || invalidFields.length > 0} className="shrink-0">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saving ? '正在保存白板设置...' : '保存白板设置'}
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {FIELDS.map(({ key, label, description }) => {
          const spec = concurrencySpec[key];
          return <div key={key} className="grid content-start gap-3 rounded-lg border border-[#e7e9ee] bg-[#fafbfc] p-4">
            <label htmlFor={`whiteboard-${key}`} className="text-sm font-semibold text-[#30343b]">{label}</label>
            <p className="m-0 min-h-12 text-xs leading-6 text-[#69717e]">{description}</p>
            <div className="flex items-center gap-2">
              <Input id={`whiteboard-${key}`} type="number" inputMode="numeric" min={spec.min} max={spec.max} step={1} required
                value={settings[key]} disabled={disabled || saving || !appSettings} aria-invalid={invalid(key)}
                aria-describedby={`whiteboard-${key}-help`} className="max-w-28 bg-white"
                onChange={event => update(key, event.target.value)} />
              <span className="text-xs text-[#69717e]">幕同时处理</span>
            </div>
            <p id={`whiteboard-${key}-help`} className={`m-0 text-xs leading-6 ${invalid(key) ? 'text-danger' : 'text-[#69717e]'}`}>
              {invalid(key) ? `请输入 ${spec.min}–${spec.max} 之间的整数。` : `${spec.min}–${spec.max} 幕；默认 ${spec.default} 幕，设为 1 表示串行。`}
            </p>
          </div>;
        })}
      </div>
      <div className="grid gap-2 rounded-lg border border-[#e7e9ee] bg-[#f6f7f9] p-4 text-[13px] leading-6 text-[#5f6876]">
        <p className="m-0">例如：只有一个十幕任务时，把生图并发数设为 10，就能同时生成十张图；把单幕渲染并发数设为 3，则先渲染三幕，每完成一幕再补下一幕。</p>
        <p className="m-0">保存后立即调整后续调度，已开始的请求和渲染会正常完成。已完成素材继续复用，单幕内部仍按既定顺序绘制。</p>
        <p className="m-0">同时制作多个任务时，各任务分别共用这三项上限。图片和分析模型使用“模型配置”中的当前选择。</p>
      </div>
    </form>
  </section>;
}
