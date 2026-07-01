import { ArrowUp, Globe2, Loader2, Shield, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { cn } from '@/lib/utils.js';

function CreativeHeroHeader() {
  return (
    <div className="grid w-full max-w-[776px] justify-items-center gap-3">
      <div className="inline-flex items-center gap-2.5 text-[#111827]">
        <h1 className="m-0 text-2xl font-bold leading-tight tracking-normal text-[#111827]">嘿，今天我们来做点什么？</h1>
      </div>
    </div>
  );
}

function CreativeModeSwitch({ mode, setMode, disabled }) {
  return (
    <div
      className="relative grid min-h-10 w-full max-w-[286px] grid-cols-2 overflow-hidden rounded-full border border-[#e5e7eb] bg-white p-0.5"
      role="tablist"
      aria-label="创作模式"
    >
      <span
        className={cn(
          'pointer-events-none absolute inset-y-0.5 left-0.5 z-0 w-[calc(50%-2px)] rounded-full bg-[#f3f4f6] shadow-[inset_0_0_0_1px_#d1d5db] transition-transform duration-200 ease-out',
          mode === 'expert' && 'translate-x-full',
        )}
        aria-hidden="true"
      />
      <Button
        type="button"
        variant="ghost"
        className={cn(
          'relative z-10 h-[34px] rounded-full bg-transparent text-[13px] text-[#111827] transition-colors hover:bg-transparent',
          mode === 'quick' && 'text-[#111827]',
        )}
        disabled={disabled}
        onClick={() => setMode('quick')}
      >
        <Zap size={15} />
        <span>快速模式</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={cn(
          'relative z-10 h-[34px] rounded-full bg-transparent text-[13px] text-[#111827] transition-colors hover:bg-transparent',
          mode === 'expert' && 'text-[#111827]',
        )}
        disabled={disabled}
        onClick={() => setMode('expert')}
      >
        <Shield size={15} />
        <span>专家模式</span>
      </Button>
    </div>
  );
}

function CreativePromptComposer({
  input,
  setInput,
  mode,
  useResearch,
  setUseResearch,
  isBusy,
  submitDisabled,
  onSubmit,
}) {
  return (
    <form
      className="grid min-h-0 w-full max-w-[776px] gap-2.5 rounded-[20px] border border-[#dfe3ea] bg-white px-3 pb-2.5 pt-[17px] shadow-[0_16px_38px_rgba(15,23,42,.07)] transition-shadow duration-200 focus-within:border-[#25f4ee]/70 focus-within:shadow-[0_18px_44px_rgba(15,23,42,.10)]"
      onSubmit={onSubmit}
    >
      <label className="sr-only" htmlFor="creative-input">
        输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接
      </label>
      <Textarea
        id="creative-input"
        value={input}
        onChange={event => setInput(event.target.value)}
        disabled={isBusy}
        className="min-h-[74px] max-h-[220px] resize-y border-0 bg-transparent px-1 py-0 text-base leading-[1.55] text-[#111827] shadow-none placeholder:text-[#a4acb8] focus-visible:ring-0"
        placeholder="粘贴文章/GitHub 链接，或输入你想生成的视频方向"
        rows={4}
      />

      <div className="flex items-center justify-between gap-3 border-t border-[#edf0f4] pt-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            className={cn(
              'h-8 rounded-full border-[#e5e7eb] bg-white px-3 text-xs font-semibold text-[#4b5563] transition hover:border-[#d1d5db] hover:bg-[#f3f4f6] hover:text-[#111827]',
              useResearch && 'border-[#111827] bg-[#f3f4f6] text-[#111827]',
            )}
            variant="outline"
            disabled={isBusy}
            onClick={() => setUseResearch(!useResearch)}
          >
            <Globe2 size={15} />
            <span>联网获取最新资料</span>
          </Button>
        </div>

        <Button
          className="size-10 rounded-full bg-[#111827] p-0 text-white shadow-[0_10px_24px_rgba(15,23,42,.18)] transition hover:-translate-y-0.5 hover:bg-[#020617] hover:shadow-[0_14px_30px_rgba(15,23,42,.22)]"
          type="submit"
          disabled={submitDisabled}
          aria-label="一键生成视频"
        >
          {isBusy ? <Loader2 size={18} className="spinIcon" /> : <ArrowUp size={19} />}
        </Button>
      </div>

      {mode === 'expert' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          专家模式正在开发中，请先使用快速模式创建任务。
        </div>
      ) : null}
      <input type="hidden" value={mode} readOnly />
    </form>
  );
}

function CreativeInputForm(props) {
  return (
    <>
      <CreativeModeSwitch mode={props.mode} setMode={props.setMode} disabled={props.isBusy} />
      <CreativePromptComposer {...props} />
    </>
  );
}

export function CreativeComposer(props) {
  return (
    <div className="grid w-full justify-items-center gap-[22px]">
      <CreativeHeroHeader />
      <CreativeInputForm {...props} />
    </div>
  );
}
