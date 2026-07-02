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
      className="creativeModeSwitch"
      data-mode={mode}
      role="tablist"
      aria-label="创作模式"
    >
      <span
        className="creativeModeThumb"
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
      className="creativePromptComposer"
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

      <div className="creativePromptActions">
        <div className="creativeQuickActions">
          <Button
            type="button"
            className={`creativeResearchToggle ${useResearch ? 'active' : ''}`}
            variant="outline"
            disabled={isBusy}
            onClick={() => setUseResearch(!useResearch)}
          >
            <Globe2 size={15} />
            <span>联网获取最新资料</span>
          </Button>
        </div>

        <Button
          className="creativeSubmitButton"
          type="submit"
          disabled={submitDisabled}
          aria-label="一键生成视频"
        >
          {isBusy ? <Loader2 size={18} className="spinIcon" /> : <ArrowUp size={19} />}
        </Button>
      </div>

      {mode === 'expert' ? (
        <div className="creativeExpertSlot">
          <div className="creativeExpertHint">
            专家模式正在开发中，请先使用快速模式创建任务。
          </div>
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
