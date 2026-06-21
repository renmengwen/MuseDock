import { ArrowUp, Globe2, Loader2, Shield, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';

function CreativeHeroHeader() {
  return (
    <div className="creativeHeroHeader">
      <div className="creativeHeroTitle">
        <Sparkles size={30} />
        <h1>嘿，今天我们来做点什么？</h1>
      </div>
    </div>
  );
}

function CreativeModeSwitch({ mode, setMode, disabled }) {
  return (
    <div className="creativeModeSwitch" role="tablist" aria-label="创作模式" data-mode={mode}>
      <span className="creativeModeThumb" aria-hidden="true" />
      <Button
        type="button"
        variant="ghost"
        className={mode === 'quick' ? 'active' : ''}
        disabled={disabled}
        onClick={() => setMode('quick')}
      >
        <Zap size={15} />
        <span>快速模式</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={mode === 'expert' ? 'active' : ''}
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
    <form className="creativePromptComposer" onSubmit={onSubmit}>
      <label className="creativePromptLabel" htmlFor="creative-input">
        输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接
      </label>
      <Textarea
        id="creative-input"
        value={input}
        onChange={event => setInput(event.target.value)}
        disabled={isBusy}
        placeholder="粘贴文章/GitHub 链接，或输入你想生成的视频方向"
        rows={4}
      />

      <div className="creativeComposerFooter">
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

        <Button className="creativeSubmitButton" type="submit" disabled={submitDisabled} aria-label="一键生成视频">
          {isBusy ? <Loader2 size={18} className="spinIcon" /> : <ArrowUp size={19} />}
        </Button>
      </div>

      {mode === 'expert' ? (
        <div className="creativeExpertSlot">
          <div className="creativeExpertHint">专家模式正在开发中，请先使用快速模式创建任务。</div>
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
    <>
      <CreativeHeroHeader />
      <CreativeInputForm {...props} />
    </>
  );
}
