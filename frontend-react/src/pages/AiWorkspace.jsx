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
  const [ttsVoice, setTtsVoice] = useState('mimo_default');
  const [ttsStylePrompt, setTtsStylePrompt] = useState(DEFAULT_TTS_STYLE);
  const [selectedTemplate, setSelectedTemplate] = useState('viral_rewrite');

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
      const json = await api.createDouyinAgentRun(value, selectedTemplate);
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
          <h3>生成结果</h3>
          {activeRun ? (
            <>
              <div className="agentRunMeta">
                <span>{activeRun.template || 'viral_rewrite'}</span>
                <strong className={`stepBadge ${activeRun.status || 'pending'}`}>{getAgentStepLabel(activeRun.status)}</strong>
                <span>{getRunDisplayTime(activeRun.created_at || activeRun.updated_at)}</span>
              </div>
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
              {activeRun.tts?.url ? (
                <section className="agentResultSection ttsPlayback">
                  <h4>TTS 音频</h4>
                  <audio controls src={activeRun.tts.url} />
                  <div className="agentRunMeta">
                    <span>{activeRun.tts.voice || '未记录音色'}</span>
                    <span>{activeRun.tts.model?.model_id || '未记录模型'}</span>
                    <span>{getRunDisplayTime(activeRun.tts.updated_at)}</span>
                  </div>
                  {Array.isArray(activeRun.tts.captions) && activeRun.tts.captions.length > 0 ? (
                    <div className="ttsCaptionList">
                      {activeRun.tts.captions.map(caption => (
                        <div className="ttsCaptionItem" key={caption.index}>
                          <code>{formatCaptionTime(caption.start)} - {formatCaptionTime(caption.end)}</code>
                          <span>{caption.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
              {activeRun.raw_text ? (
                <section className="agentResultSection">
                  <h4>原始返回</h4>
                  <pre>{activeRun.raw_text}</pre>
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
