import { useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { Status } from '../components/Status.jsx';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { getAgentResultSections, getAgentStepLabel, getRunDisplayTime } from '../utils/agentRuns.js';

function ResultSection({ section }) {
  const items = Array.isArray(section.items) ? section.items.filter(Boolean) : [];
  const text = section.text || '';

  return (
    <section className="agentResultSection">
      <h4>{section.title}</h4>
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
  const [awemeId, setAwemeId] = useState('');
  const [mediaStatus, setMediaStatus] = useState(null);
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      const left = new Date(a.created_at || a.updated_at || 0).getTime();
      const right = new Date(b.created_at || b.updated_at || 0).getTime();
      return right - left;
    });
  }, [runs]);

  const resultSections = useMemo(() => {
    return getAgentResultSections(activeRun?.result || {});
  }, [activeRun]);

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

  async function loadWorkspace() {
    const value = awemeId.trim();
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
    const value = awemeId.trim();
    if (!value) {
      setStatus({ type: 'error', message: '请输入抖音视频 aweme_id' });
      return;
    }

    setRunning(true);
    setStatus({ type: 'loading', message: '正在执行爆款拆解 Agent，正在读取素材上下文并请求文本模型...' });
    try {
      const json = await api.createDouyinAgentRun(value, 'viral_rewrite');
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
    setStatus({ type: 'success', message: `已切换到运行记录 ${run.run_id}` });
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
          <div className="agentTemplate">
            <strong>viral_rewrite</strong>
            <p>读取视频素材、转写文本和评论洞察，生成爆点拆解、受众画像、选题方向、改写脚本和标题建议。</p>
            <Button disabled={loading || running} onClick={runAgent}>
              {running ? '执行中...' : '执行模板'}
            </Button>
          </div>

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
              {resultSections.map(section => <ResultSection key={section.key} section={section} />)}
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
