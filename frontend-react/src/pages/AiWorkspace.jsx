import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { Status } from '../components/Status.jsx';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { getAgentResultSections, getAgentStepLabel, getRunDisplayTime } from '../utils/agentRuns.js';
import { getAwemeIdFromSearch } from '../utils/workspaceParams.js';

const AGENT_TEMPLATES = [
  {
    id: 'viral_rewrite',
    label: '爆款拆解 + 改写脚本',
    description: '读取视频素材、转写文本和评论洞察，生成爆点拆解、受众画像、选题方向、改写脚本和标题建议。',
    actionLabel: '执行爆款拆解',
  },
  {
    id: 'comment_insights',
    label: '评论洞察',
    description: '读取本地评论缓存，提炼用户痛点、高频问题、情绪倾向、内容机会和回复建议。',
    actionLabel: '执行评论洞察',
  },
];

const TTS_VOICES = [
  { value: 'mimo_default', label: '默认音色' },
  { value: '冰糖', label: '冰糖' },
  { value: '茉莉', label: '茉莉' },
  { value: '苏打', label: '苏打' },
  { value: '白桦', label: '白桦' },
  { value: 'Mia', label: 'Mia' },
  { value: 'Chloe', label: 'Chloe' },
  { value: 'Milo', label: 'Milo' },
  { value: 'Dean', label: 'Dean' },
];

const DEFAULT_TTS_STYLE = '请使用自然、清晰、适合短视频口播的语气。';

function getTemplateMeta(templateId) {
  return AGENT_TEMPLATES.find(template => template.id === templateId) || AGENT_TEMPLATES[0];
}

function formatCaptionTime(value) {
  const total = Number(value || 0);
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  const millis = Math.round((total - Math.floor(total)) * 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(2, '0')}`;
}

function ResultSection({ section, ttsControls = null }) {
  const items = Array.isArray(section.items) ? section.items.filter(Boolean) : [];
  const text = section.text || '';

  return (
    <section className="agentResultSection">
      <div className="agentResultSectionHeader">
        <h4>{section.title}</h4>
        {ttsControls}
      </div>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => <li key={`${section.key}-${index}`}>{item}</li>)}
        </ul>
      ) : (
        <p>{text || '暂无内容'}</p>
      )}
    </section>
  );
}

function StepStatus({ label, done, detail }) {
  return (
    <li>
      <span>{label}</span>
      <strong className={`stepBadge ${done ? 'done' : 'pending'}`}>{done ? '已完成' : '待准备'}</strong>
      {detail ? <small>{detail}</small> : null}
    </li>
  );
}

export function AiWorkspace() {
  const location = useLocation();
  const initialAwemeId = useMemo(() => getAwemeIdFromSearch(location.search), [location.search]);
  const [awemeId, setAwemeId] = useState(initialAwemeId);
  const [mediaStatus, setMediaStatus] = useState(null);
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [ttsRunning, setTtsRunning] = useState(false);
  const [storyboardRunning, setStoryboardRunning] = useState(false);
  const [videoGenerating, setVideoGenerating] = useState(false);
  const [videoRendering, setVideoRendering] = useState(false);
  const [ttsVoice, setTtsVoice] = useState('mimo_default');
  const [ttsStylePrompt, setTtsStylePrompt] = useState(DEFAULT_TTS_STYLE);
  const [selectedTemplate, setSelectedTemplate] = useState('viral_rewrite');
  const [promptOptions, setPromptOptions] = useState({
    goal: '',
    audience: '',
    accountPositioning: '',
    rewriteStyle: '',
    focus: '',
    replyTone: '',
    forbidden: '',
    extraRequirements: '',
  });
  const [resultTab, setResultTab] = useState('workflow');

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      const left = new Date(a.created_at || a.updated_at || 0).getTime();
      const right = new Date(b.created_at || b.updated_at || 0).getTime();
      return right - left;
    });
  }, [runs]);

  const resultSections = useMemo(() => {
    return getAgentResultSections(activeRun?.result || {}, activeRun?.template || selectedTemplate);
  }, [activeRun, selectedTemplate]);

  const agentSteps = useMemo(() => {
    return activeRun?.steps && typeof activeRun.steps === 'object'
      ? Object.entries(activeRun.steps)
      : [];
  }, [activeRun]);

  const transcriptReady = mediaStatus?.steps?.transcript?.status === 'done' || mediaStatus?.transcript?.status === 'done';
  const videoReady = mediaStatus?.steps?.video?.status === 'done';
  const audioReady = mediaStatus?.steps?.audio?.status === 'done';
  const mediaReady = videoReady && audioReady;
  const selectedAwemeId = mediaStatus?.aweme_id || awemeId.trim();
  const hasRewriteScript = !!(activeRun?.result?.rewrite_script && activeRun.result.rewrite_script.trim());
  const hasTtsCaptions = Array.isArray(activeRun?.tts?.captions) && activeRun.tts.captions.length > 0;
  const hasStoryboardScenes = Array.isArray(activeRun?.storyboard?.scenes) && activeRun.storyboard.scenes.length > 0;

  useEffect(() => {
    if (!activeRun) return;
    if (activeRun.video?.output_url || activeRun.video?.project_dir || hasStoryboardScenes) {
      setResultTab('video');
      return;
    }
    if (activeRun.tts?.url || hasRewriteScript) {
      setResultTab('tts');
      return;
    }
    setResultTab('result');
  }, [activeRun?.run_id, activeRun?.tts?.url, activeRun?.video?.project_dir, activeRun?.video?.output_url, hasRewriteScript, hasStoryboardScenes]);

  useEffect(() => {
    const nextAwemeId = getAwemeIdFromSearch(location.search);
    if (!nextAwemeId) return;
    setAwemeId(nextAwemeId);
    loadWorkspace(nextAwemeId).catch(() => {});
  }, [location.search]);

  async function loadWorkspace(explicitAwemeId = '') {
    const value = (explicitAwemeId || awemeId).trim();
    if (!value) {
      setStatus({ type: 'error', message: '请输入抖音视频 aweme_id' });
      return;
    }

    setLoading(true);
    setStatus({ type: 'loading', message: '正在读取素材状态和历史 Agent 运行记录...' });
    try {
      const [mediaJson, runsJson] = await Promise.all([
        api.getDouyinMediaStatus(value),
        api.listDouyinAgentRuns(value),
      ]);
      const runList = runsJson.data || [];
      setMediaStatus(mediaJson);
      setRuns(runList);
      setActiveRun(runList[0] || null);
      setStatus({ type: 'success', message: `已加载素材 ${value}` });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function runAgent() {
    const value = selectedAwemeId.trim();
    if (!value) {
      setStatus({ type: 'error', message: '请输入抖音视频 aweme_id' });
      return;
    }

    setRunning(true);
    const templateMeta = getTemplateMeta(selectedTemplate);
    setStatus({ type: 'loading', message: `正在执行${templateMeta.label}，正在读取素材上下文并请求文本模型...` });
    try {
      const json = await api.createDouyinAgentRun(value, selectedTemplate, promptOptions);
      setActiveRun(json.run || json);
      const runsJson = await api.listDouyinAgentRuns(value);
      const runList = runsJson.data || [];
      setRuns(runList);
      if (runList.length > 0) setActiveRun(runList[0]);
      setStatus({
        type: json.success ? 'success' : 'error',
        message: json.message || (json.success ? 'Agent 执行完成' : 'Agent 执行失败'),
      });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setRunning(false);
    }
  }

  function updatePromptOption(key, value) {
    setPromptOptions(prev => ({ ...prev, [key]: value }));
  }

  function selectRun(run) {
    setActiveRun(run);
    if (run.template) setSelectedTemplate(run.template);
    setStatus({ type: 'success', message: `已切换到运行记录 ${run.run_id}` });
  }

  async function synthesizeTts() {
    const value = selectedAwemeId.trim();
    if (!value || !activeRun?.run_id) {
      setStatus({ type: 'error', message: '请先选择一条包含改写脚本的运行记录。' });
      return;
    }
    if (!hasRewriteScript) {
      setStatus({ type: 'error', message: '当前运行结果没有可用于 TTS 合成的改写脚本。' });
      return;
    }

    setTtsRunning(true);
    setStatus({ type: 'loading', message: '正在请求 TTS 模型合成语音...' });
    try {
      const json = await api.synthesizeDouyinRunTts(value, activeRun.run_id, {
        voice: ttsVoice,
        stylePrompt: ttsStylePrompt,
      });
      setActiveRun(prev => prev ? { ...prev, tts: json.tts, updated_at: new Date().toISOString() } : prev);
      setRuns(prev => prev.map(run => (
        run.run_id === activeRun.run_id ? { ...run, tts: json.tts, updated_at: new Date().toISOString() } : run
      )));
      setStatus({
        type: json.success ? 'success' : 'error',
        message: json.message || (json.success ? 'TTS 语音合成完成' : 'TTS 语音合成失败'),
      });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setTtsRunning(false);
    }
  }

  async function createStoryboard() {
    const value = selectedAwemeId.trim();
    if (!value || !activeRun?.run_id) {
      setStatus({ type: 'error', message: '请先选择一条已完成 TTS 合成的运行记录。' });
      return;
    }
    if (!hasTtsCaptions) {
      setStatus({ type: 'error', message: '请先完成 TTS 合成并生成字幕时间轴。' });
      return;
    }

    setStoryboardRunning(true);
    setStatus({ type: 'loading', message: '正在生成 AI 分镜...' });
    try {
      const json = await api.createDouyinRunStoryboard(value, activeRun.run_id);
      setActiveRun(prev => prev ? {
        ...prev,
        storyboard_raw: json.storyboard_raw,
        storyboard: json.storyboard,
        storyboard_model: json.storyboard_model,
        updated_at: new Date().toISOString(),
      } : prev);
      setRuns(prev => prev.map(run => (
        run.run_id === activeRun.run_id ? {
          ...run,
          storyboard_raw: json.storyboard_raw,
          storyboard: json.storyboard,
          storyboard_model: json.storyboard_model,
          updated_at: new Date().toISOString(),
        } : run
      )));
      setStatus({
        type: json.success ? 'success' : 'error',
        message: json.message || (json.success ? 'AI 分镜已生成。' : 'AI 分镜生成失败。'),
      });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setStoryboardRunning(false);
    }
  }

  async function createVideoProject() {
    const value = selectedAwemeId.trim();
    if (!value || !activeRun?.run_id) {
      setStatus({ type: 'error', message: '请先选择一条已生成 AI 分镜的运行记录。' });
      return;
    }
    if (!hasStoryboardScenes) {
      setStatus({ type: 'error', message: '请先生成 AI 分镜。' });
      return;
    }

    setVideoGenerating(true);
    setStatus({ type: 'loading', message: '正在生成 HyperFrames 视频工程...' });
    try {
      const json = await api.createDouyinRunHyperframesProject(value, activeRun.run_id);
      setActiveRun(prev => prev ? { ...prev, video: json.video, updated_at: new Date().toISOString() } : prev);
      setRuns(prev => prev.map(run => (
        run.run_id === activeRun.run_id ? { ...run, video: json.video, updated_at: new Date().toISOString() } : run
      )));
      setStatus({
        type: json.success ? 'success' : 'error',
        message: json.message || (json.success ? '视频工程已生成。' : '视频工程生成失败。'),
      });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setVideoGenerating(false);
    }
  }

  async function renderVideo() {
    const value = selectedAwemeId.trim();
    if (!value || !activeRun?.run_id) {
      setStatus({ type: 'error', message: '请先选择一条已生成视频工程的运行记录。' });
      return;
    }
    if (!activeRun.video?.project_dir) {
      setStatus({ type: 'error', message: '请先生成视频工程。' });
      return;
    }

    setVideoRendering(true);
    setStatus({ type: 'loading', message: '正在调用 HyperFrames 渲染 MP4...' });
    try {
      const json = await api.renderDouyinRunHyperframesVideo(value, activeRun.run_id);
      setActiveRun(prev => prev ? { ...prev, video: json.video, updated_at: new Date().toISOString() } : prev);
      setRuns(prev => prev.map(run => (
        run.run_id === activeRun.run_id ? { ...run, video: json.video, updated_at: new Date().toISOString() } : run
      )));
      setStatus({
        type: json.success ? 'success' : 'error',
        message: json.message || (json.success ? '视频渲染完成。' : '视频渲染失败。'),
      });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setVideoRendering(false);
    }
  }

  return (
    <main className="container">
      <div className="workspaceIntro">
        <div>
          <h2>AI 任务流工作台</h2>
          <p>输入抖音视频 aweme_id，读取素材状态和历史运行记录，然后执行爆款拆解与改写 Agent。</p>
        </div>
        {selectedAwemeId ? <code>{selectedAwemeId}</code> : null}
      </div>

      <div className="toolbar">
        <Input
          value={awemeId}
          onChange={event => setAwemeId(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && !loading && loadWorkspace()}
          placeholder="输入抖音视频 aweme_id"
          disabled={loading || running}
        />
        <Button variant="secondary" disabled={loading || running} onClick={loadWorkspace}>加载工作台</Button>
        <Button disabled={loading || running} onClick={runAgent}>执行爆款拆解</Button>
      </div>

      <Status status={status} />
      {loading ? <div className="pageLoading">正在加载素材状态和历史 Agent 运行记录...</div> : null}

      <section className="agentWorkbench">
        <div className="agentPanel">
          <h3>任务模板</h3>
          {AGENT_TEMPLATES.map(template => (
            <div className={`agentTemplate ${selectedTemplate === template.id ? 'active' : ''}`} key={template.id}>
              <strong>{template.label}</strong>
              <p>{template.description}</p>
              <Button
                variant={selectedTemplate === template.id ? 'default' : 'secondary'}
                disabled={loading || running}
                onClick={() => setSelectedTemplate(template.id)}
              >
                {selectedTemplate === template.id ? '已选择' : '选择模板'}
              </Button>
            </div>
          ))}
          <div className="agentOptionGroup">
            <h4>创作 brief</h4>
            <Input
              value={promptOptions.goal}
              onChange={event => updatePromptOption('goal', event.target.value)}
              placeholder="创作目标，例如：涨粉、引流、带货"
              disabled={loading || running}
            />
            <Input
              value={promptOptions.audience}
              onChange={event => updatePromptOption('audience', event.target.value)}
              placeholder="目标受众，例如：健身新手、本地商家老板"
              disabled={loading || running}
            />
            <Input
              value={promptOptions.accountPositioning}
              onChange={event => updatePromptOption('accountPositioning', event.target.value)}
              placeholder="账号定位，例如：短视频获客顾问"
              disabled={loading || running}
            />
            <Input
              value={promptOptions.rewriteStyle}
              onChange={event => updatePromptOption('rewriteStyle', event.target.value)}
              placeholder="改写风格，例如：专业可信，开头有冲突感"
              disabled={loading || running}
            />
            <Input
              value={promptOptions.focus}
              onChange={event => updatePromptOption('focus', event.target.value)}
              placeholder="关注重点，例如：突出省时、低门槛、真实案例"
              disabled={loading || running}
            />
            <Input
              value={promptOptions.replyTone}
              onChange={event => updatePromptOption('replyTone', event.target.value)}
              placeholder="运营回复语气，例如：真诚、克制、专业"
              disabled={loading || running}
            />
            <Input
              value={promptOptions.forbidden}
              onChange={event => updatePromptOption('forbidden', event.target.value)}
              placeholder="禁用内容，例如：不要夸大效果"
              disabled={loading || running}
            />
            <textarea
              value={promptOptions.extraRequirements}
              onChange={event => updatePromptOption('extraRequirements', event.target.value)}
              placeholder="额外要求，例如：适合 60 秒口播"
              disabled={loading || running}
              maxLength={500}
            />
          </div>
          <Button disabled={loading || running} onClick={runAgent}>
            {running ? '执行中...' : getTemplateMeta(selectedTemplate).actionLabel}
          </Button>

          <h3>素材状态</h3>
          <ul className="agentStatusList">
            <StepStatus label="视频和音频" done={mediaReady} detail="Agent 需要视频和音频素材都已准备完成" />
            <StepStatus label="音频转写" done={transcriptReady} detail="建议先完成转写，结果会更稳定" />
          </ul>
        </div>

        <div className="agentPanel">
          <h3>执行步骤</h3>
          <div className="agentSteps">
            {agentSteps.length > 0 ? agentSteps.map(([key, step]) => (
              <div className="agentStep" key={key}>
                <span>{step?.label || key}</span>
                <strong className={`stepBadge ${step?.status || 'pending'}`}>{getAgentStepLabel(step?.status)}</strong>
                {step?.message ? <small>{step.message}</small> : null}
              </div>
            )) : <p className="mutedText">暂无执行步骤</p>}
          </div>

          <h3>历史运行</h3>
          <div className="agentRunList">
            {sortedRuns.length > 0 ? sortedRuns.map(run => (
              <button
                type="button"
                key={run.run_id}
                className={`agentRunItem ${activeRun?.run_id === run.run_id ? 'active' : ''}`}
                onClick={() => selectRun(run)}
              >
                <strong>{run.template || 'viral_rewrite'}</strong>
                <span>{getRunDisplayTime(run.created_at || run.updated_at)}</span>
              </button>
            )) : <p className="mutedText">暂无历史运行</p>}
          </div>
        </div>

        <div className="agentPanel agentResultPanel">
          <div className="agentResultTitleRow">
            <h3>生成结果</h3>
            {activeRun ? <span>{activeRun.run_id}</span> : null}
          </div>
          {activeRun ? (
            <>
              <div className="agentRunMeta">
                <span>{activeRun.template || 'viral_rewrite'}</span>
                <strong className={`stepBadge ${activeRun.status || 'pending'}`}>{getAgentStepLabel(activeRun.status)}</strong>
                <span>{getRunDisplayTime(activeRun.created_at || activeRun.updated_at)}</span>
              </div>
              <div className="agentResultTabs" role="tablist" aria-label="生成结果视图">
                {[
                  ['workflow', '流程'],
                  ['result', '文案'],
                  ['tts', '配音'],
                  ['video', '成片'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`agentResultTab ${resultTab === id ? 'active' : ''}`}
                    onClick={() => setResultTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {resultTab === 'workflow' ? (
                <section className="agentResultSection compactWorkflow">
                  <h4>执行步骤</h4>
                  <div className="agentSteps compact">
                    {agentSteps.length > 0 ? agentSteps.map(([key, step]) => (
                      <div className="agentStep" key={key}>
                        <span>{step?.label || key}</span>
                        <strong className={`stepBadge ${step?.status || 'pending'}`}>{getAgentStepLabel(step?.status)}</strong>
                        {step?.message ? <small>{step.message}</small> : null}
                      </div>
                    )) : <p className="mutedText">暂无执行步骤</p>}
                  </div>
                </section>
              ) : null}

              {resultTab === 'result' ? (
                <>
                  {resultSections.map(section => (
                    <ResultSection
                      key={section.key}
                      section={section}
                      ttsControls={section.key === 'rewrite_script' && hasRewriteScript ? (
                        <div className="ttsInlineControls">
                          <select
                            value={ttsVoice}
                            onChange={event => setTtsVoice(event.target.value)}
                            disabled={ttsRunning}
                            aria-label="TTS 音色"
                          >
                            {TTS_VOICES.map(voice => (
                              <option key={voice.value} value={voice.value}>{voice.label}</option>
                            ))}
                          </select>
                          <Input
                            value={ttsStylePrompt}
                            onChange={event => setTtsStylePrompt(event.target.value)}
                            disabled={ttsRunning}
                            placeholder="输入语气、情绪、节奏或音频标签"
                          />
                          <Button size="sm" disabled={ttsRunning} onClick={synthesizeTts}>
                            {ttsRunning ? '合成中...' : 'TTS 合成'}
                          </Button>
                        </div>
                      ) : null}
                    />
                  ))}
                  {activeRun.raw_text ? (
                    <section className="agentResultSection">
                      <h4>原始返回</h4>
                      <pre>{activeRun.raw_text}</pre>
                    </section>
                  ) : null}
                </>
              ) : null}

              {resultTab === 'tts' ? (
                <section className="agentResultSection ttsPlayback">
                  <h4>TTS 音频</h4>
                  {hasRewriteScript ? (
                    <div className="ttsInlineControls standalone">
                      <select
                        value={ttsVoice}
                        onChange={event => setTtsVoice(event.target.value)}
                        disabled={ttsRunning}
                        aria-label="TTS 音色"
                      >
                        {TTS_VOICES.map(voice => (
                          <option key={voice.value} value={voice.value}>{voice.label}</option>
                        ))}
                      </select>
                      <Input
                        value={ttsStylePrompt}
                        onChange={event => setTtsStylePrompt(event.target.value)}
                        disabled={ttsRunning}
                        placeholder="输入语气、情绪、节奏或音频标签"
                      />
                      <Button size="sm" disabled={ttsRunning} onClick={synthesizeTts}>
                        {ttsRunning ? '合成中...' : 'TTS 合成'}
                      </Button>
                    </div>
                  ) : <p className="mutedText">当前运行记录没有可用于 TTS 的改写脚本。</p>}
                  {activeRun.tts?.url ? (
                    <>
                      <audio controls src={activeRun.tts.url} />
                      <div className="agentRunMeta">
                        <span>{activeRun.tts.voice || '未记录音色'}</span>
                        <span>{activeRun.tts.model?.model_id || '未记录模型'}</span>
                        <span>{getRunDisplayTime(activeRun.tts.updated_at)}</span>
                      </div>
                      {hasTtsCaptions ? (
                        <div className="ttsCaptionList">
                          {activeRun.tts.captions.map(caption => (
                            <div className="ttsCaptionItem" key={caption.index}>
                              <code>{formatCaptionTime(caption.start)} - {formatCaptionTime(caption.end)}</code>
                              <span>{caption.text}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </section>
              ) : null}

              {resultTab === 'video' ? (
                <section className="agentResultSection ttsPlayback">
                  <h4>AI 分镜与成片</h4>
                  <div className="videoProjectPanel">
                    <div className="videoProjectActions">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={storyboardRunning || videoGenerating || videoRendering || !hasTtsCaptions}
                        onClick={createStoryboard}
                      >
                        {storyboardRunning ? '生成中...' : '生成 AI 分镜'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={storyboardRunning || videoGenerating || videoRendering || !hasStoryboardScenes}
                        onClick={createVideoProject}
                      >
                        {videoGenerating ? '生成中...' : '生成视频工程'}
                      </Button>
                      <Button
                        size="sm"
                        disabled={storyboardRunning || videoGenerating || videoRendering || !activeRun.video?.project_dir}
                        onClick={renderVideo}
                      >
                        {videoRendering ? '渲染中...' : '渲染 MP4'}
                      </Button>
                    </div>
                    {!hasTtsCaptions ? <p className="mutedText">请先在“配音”页签完成 TTS 合成并生成字幕时间轴。</p> : null}
                    {hasStoryboardScenes ? (
                      <div className="storyboardList">
                        {activeRun.storyboard.scenes.map(scene => (
                          <div className="storyboardItem" key={scene.index}>
                            <div>
                              <strong>分镜 {String(scene.index).padStart(2, '0')}</strong>
                              <code>{formatCaptionTime(scene.start)} - {formatCaptionTime(scene.end)}</code>
                            </div>
                            <p>{scene.headline}</p>
                            <span>字幕 {scene.caption_indexes?.join(', ') || '-'}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {activeRun.video ? (
                      <div className="videoProjectMeta">
                        <span>{activeRun.video.message || '视频状态已更新。'}</span>
                        {activeRun.video.project_dir ? <code>{activeRun.video.project_dir}</code> : null}
                        {activeRun.video.output_url ? (
                          <video controls src={activeRun.video.output_url} />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <p className="mutedText">请选择历史运行，或先执行一次爆款拆解 Agent。</p>
          )}
        </div>
      </section>
    </main>
  );
}
