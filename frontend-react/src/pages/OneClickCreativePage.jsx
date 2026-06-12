import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const STAGE_LABELS = {
  source: '准备来源资料',
  research: '联网研究',
  assets: '素材分析',
  agent_run: '导演改写',
  brief: '成片策划',
  audio: '生成音频轨',
  project: '生成工程',
  check: '校验工程',
  render: '渲染视频',
  inspect: '巡检视频',
};

const DEFAULT_STAGES = Object.entries(STAGE_LABELS).map(([id, label]) => ({
  id,
  label,
  status: 'waiting',
}));

const STATUS_TEXT = {
  waiting: '等待中',
  pending: '排队中',
  queued: '排队中',
  running: '进行中',
  done: '已完成',
  failed: '失败',
};

function getStatusClass(status) {
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'queued' || status === 'pending' || status === 'running') return 'pending';
  return '';
}

function getStatusMessageClass(status) {
  if (status === 'creating' || status === 'polling') return 'loading';
  if (status === 'done') return 'success';
  if (status === 'failed') return 'error';
  return 'info';
}

function getWorkflowPayload(json) {
  return json?.data || json?.workflow || json || null;
}

function getWorkflowId(json) {
  const workflow = getWorkflowPayload(json);
  return json?.workflow_id || workflow?.workflow_id || workflow?.id || '';
}

function getErrorMessage(error, fallback) {
  return error?.data?.message || error?.message || fallback;
}

function CreativeInputForm({ input, setInput, useResearch, setUseResearch, isBusy, onSubmit }) {
  return (
    <section className="agentPanel">
      <h3>一键创作</h3>
      <form className="agentOptionGroup" onSubmit={onSubmit}>
        <label>
          <span>输入视频方向、抖音 ID 或抖音链接</span>
          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            disabled={isBusy}
            placeholder="例如：做一期关于 AI 视频生产效率的知识科普，或粘贴抖音视频链接"
          />
        </label>

        <label className="switchControl">
          <input
            type="checkbox"
            checked={useResearch}
            onChange={event => setUseResearch(event.target.checked)}
            disabled={isBusy}
          />
          <span className="switchTrack"><span className="switchThumb" /></span>
          <span className="switchText">联网获取最新资料</span>
        </label>

        <div className="primaryActionGroup">
          <button className="btn primary" type="submit" disabled={isBusy}>
            {isBusy ? '创作任务处理中...' : '一键生成视频'}
          </button>
        </div>
      </form>
    </section>
  );
}

function WorkflowStatusPanel({ status, message, workflowId, workflow }) {
  const statusClass = getStatusMessageClass(status);
  const workflowStatus = workflow?.status ? (STATUS_TEXT[workflow.status] || workflow.status) : '等待输入';

  return (
    <section className="agentPanel">
      <h3>创作状态</h3>
      <div className={`status ${statusClass}`} aria-live="polite">
        {message || '填写方向或抖音来源后，即可创建视频生成任务。'}
      </div>
      <div className="agentStatusList">
        <li>
          <span>任务状态</span>
          <strong className={`stepBadge ${getStatusClass(workflow?.status)}`}>{workflowStatus}</strong>
          {workflowId ? <small>任务 ID：{workflowId}</small> : <small>尚未创建创作任务</small>}
        </li>
      </div>
    </section>
  );
}

function AssetContextNotice() {
  return (
    <section className="agentPanel">
      <h3>素材上下文</h3>
      <div className="agentOptionGroup">
        <h4>图片素材将在下一阶段开放</h4>
        <p className="mutedText">本阶段保留素材上下文结构，但暂不上传或分析图片素材；提交任务时会携带空的 assetIds 列表。</p>
      </div>
    </section>
  );
}

function WorkflowStageList({ workflow }) {
  const stages = useMemo(() => {
    const source = Array.isArray(workflow?.stages) && workflow.stages.length ? workflow.stages : DEFAULT_STAGES;
    return source.map(stage => ({
      ...stage,
      label: stage.label || STAGE_LABELS[stage.id] || stage.id || '未命名阶段',
      status: stage.status || 'waiting',
    }));
  }, [workflow]);

  return (
    <section className="agentPanel agentResultPanel">
      <h3>生成进度</h3>
      <div className="agentSteps compact">
        {stages.map(stage => (
          <div className="agentStep" key={stage.id || stage.label}>
            <span>{stage.label}</span>
            <strong className={`stepBadge ${getStatusClass(stage.status)}`}>
              {STATUS_TEXT[stage.status] || stage.status || '等待中'}
            </strong>
            {stage.message ? <small>{stage.message}</small> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function OneClickCreativePage() {
  const [input, setInput] = useState('');
  const [useResearch, setUseResearch] = useState(false);
  const [workflow, setWorkflow] = useState(null);
  const [workflowId, setWorkflowId] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const isBusy = status === 'creating' || status === 'polling';

  async function submitCreativeWorkflow(event) {
    event.preventDefault();
    if (isBusy) return;

    const trimmed = input.trim();
    if (!trimmed) {
      setStatus('failed');
      setMessage('请输入视频方向、抖音 ID 或抖音链接');
      return;
    }

    setStatus('creating');
    setMessage('正在创建创作任务...');
    setWorkflow(null);
    setWorkflowId('');

    try {
      const json = await api.createCreativeWorkflow({
        input: trimmed,
        useResearch,
        assetIds: [],
        renderOptions: {},
        workflowOptions: {},
      });
      const nextWorkflow = getWorkflowPayload(json);
      const nextWorkflowId = getWorkflowId(json);
      setWorkflow(nextWorkflow);
      if (!nextWorkflowId) {
        setStatus('failed');
        setMessage('创作任务已创建，但未返回任务 ID，请稍后在后端日志中检查。');
        return;
      }
      setWorkflowId(nextWorkflowId);
      setStatus('polling');
      setMessage(json?.message || nextWorkflow?.message || '创作任务已创建，正在生成视频...');
    } catch (error) {
      setStatus('failed');
      setMessage(getErrorMessage(error, '创建创作任务失败，请稍后重试。'));
    }
  }

  useEffect(() => {
    if (status !== 'polling' || !workflowId) return undefined;
    let cancelled = false;

    async function pollWorkflow() {
      try {
        const json = await api.getCreativeWorkflow(workflowId);
        if (cancelled) return;

        const nextWorkflow = getWorkflowPayload(json);
        setWorkflow(nextWorkflow);

        if (nextWorkflow?.status === 'done') {
          setStatus('done');
          setMessage('视频生成完成。');
          return;
        }

        if (nextWorkflow?.status === 'failed' || json?.success === false) {
          setStatus('failed');
          setMessage(nextWorkflow?.error?.message || nextWorkflow?.message || json?.message || '视频生成失败，请查看任务详情。');
          return;
        }

        setMessage(nextWorkflow?.message || json?.message || '创作任务已创建，正在生成视频...');
      } catch (error) {
        if (!cancelled) {
          setStatus('failed');
          setMessage(getErrorMessage(error, '获取创作任务状态失败，请稍后重试。'));
        }
      }
    }

    pollWorkflow();
    const timer = window.setInterval(pollWorkflow, 1800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status, workflowId]);

  return (
    <main className="container">
      <div className="workspaceIntro">
        <div>
          <h2>一键创作</h2>
          <p>输入视频方向、抖音 ID 或抖音链接，创建从资料准备到视频渲染的一键生成流程。</p>
        </div>
        <div className="settingsSummary">
          <strong>{workflowId || '等待创建'}</strong>
          <span>{workflow?.status ? (STATUS_TEXT[workflow.status] || workflow.status) : '尚未开始'}</span>
        </div>
      </div>

      <div className="agentWorkbench">
        <CreativeInputForm
          input={input}
          setInput={setInput}
          useResearch={useResearch}
          setUseResearch={setUseResearch}
          isBusy={isBusy}
          onSubmit={submitCreativeWorkflow}
        />
        <WorkflowStatusPanel status={status} message={message} workflowId={workflowId} workflow={workflow} />
        <AssetContextNotice />
        <WorkflowStageList workflow={workflow} />
      </div>
    </main>
  );
}
