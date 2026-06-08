import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { MediaPanel } from '../components/MediaPanel.jsx';
import { Status } from '../components/Status.jsx';
import { consumeAutoPrepareFlag, getSelectedMediaItem, setSelectedMediaItem } from '../state/mediaSelection.js';
import { getDouyinAwemeId, getDouyinUrl } from '../utils/format.js';

function buildInitialStatus(item, awemeId) {
  if (!awemeId) return null;
  return {
    success: true,
    aweme_id: awemeId,
    metadata: {
      title: item?.title || item?.description || '',
      author: { nickname: item?.author || item?.nickname || '' },
      aweme_url: item ? getDouyinUrl(item) : `https://www.douyin.com/video/${awemeId}`,
    },
    steps: {},
  };
}

export function MediaWorkspace() {
  const params = useParams();
  const navigate = useNavigate();
  const routeAwemeId = params.id || '';
  const selectedItem = useMemo(() => getSelectedMediaItem(), []);
  const initialAwemeId = routeAwemeId || getDouyinAwemeId(selectedItem);

  const [awemeIdInput, setAwemeIdInput] = useState(initialAwemeId);
  const [selectedAwemeId, setSelectedAwemeId] = useState(initialAwemeId);
  const [mediaStatus, setMediaStatus] = useState(buildInitialStatus(selectedItem, initialAwemeId));
  const [status, setStatus] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [openingTarget, setOpeningTarget] = useState('');
  const [prepareProgress, setPrepareProgress] = useState(0);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [activeTask, setActiveTask] = useState(null);

  useEffect(() => {
    if (!preparing) return undefined;
    const timer = window.setInterval(() => {
      setPrepareProgress(prev => {
        if (prev < 30) return Math.min(prev + 5, 30);
        if (prev < 68) return Math.min(prev + 3, 68);
        if (prev < 92) return Math.min(prev + 1, 92);
        return prev;
      });
    }, 1400);
    return () => window.clearInterval(timer);
  }, [preparing]);

  useEffect(() => {
    if (!transcribing) return undefined;
    const timer = window.setInterval(() => {
      setTranscribeProgress(prev => {
        if (prev < 35) return Math.min(prev + 4, 35);
        if (prev < 70) return Math.min(prev + 2, 70);
        if (prev < 90) return Math.min(prev + 1, 90);
        return prev;
      });
    }, 1600);
    return () => window.clearInterval(timer);
  }, [transcribing]);

  useEffect(() => {
    if (!activeTask?.task_id || !activeTask?.aweme_id) return undefined;
    let cancelled = false;

    async function pollTask() {
      try {
        const json = await api.getDouyinMediaTask(activeTask.aweme_id, activeTask.task_id);
        if (cancelled) return;
        const task = json.task;
        if (!task) return;

        setActiveTask(task);
        if (task.type === 'prepare') setPrepareProgress(task.progress || 0);
        if (task.type === 'transcribe') setTranscribeProgress(task.progress || 0);

        if (task.status === 'queued' || task.status === 'running') {
          setStatus({ type: 'loading', message: task.message || '正在执行媒体任务...' });
          return;
        }

        if (task.status === 'done') {
          setStatus({ type: 'success', message: task.message || '任务已完成' });
          setPreparing(false);
          setTranscribing(false);
          setActiveTask(null);
          if (task.result && task.type === 'prepare') {
            setMediaStatus({
              success: true,
              aweme_id: task.aweme_id,
              dir: task.result.dir,
              metadata: task.result.analysis_input?.video || task.result.metadata || {},
              analysis_input: task.result.analysis_input,
              frames: task.result.analysis_input?.local_assets?.frames || [],
              steps: task.result.analysis_input?.steps || task.result.steps || {},
            });
          }
          await refreshMediaStatus(task.aweme_id, { silent: true });
          if (task.type === 'prepare' && routeAwemeId !== task.aweme_id) {
            navigate(`/media/douyin/${task.aweme_id}`, { replace: true });
          }
          return;
        }

        if (task.status === 'failed') {
          setStatus({ type: 'error', message: task.message || task.error || '媒体任务执行失败' });
          setPreparing(false);
          setTranscribing(false);
          setActiveTask(null);
          await refreshMediaStatus(task.aweme_id, { silent: true }).catch(() => {});
        }
      } catch (error) {
        if (!cancelled) setStatus({ type: 'error', message: error.message });
      }
    }

    pollTask();
    const timer = window.setInterval(pollTask, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeTask?.task_id, activeTask?.aweme_id, routeAwemeId, navigate]);

  useEffect(() => {
    if (!routeAwemeId) return;
    setSelectedAwemeId(routeAwemeId);
    setAwemeIdInput(routeAwemeId);
    setMediaStatus(prev => prev?.aweme_id === routeAwemeId ? prev : buildInitialStatus(null, routeAwemeId));
    if (consumeAutoPrepareFlag()) {
      prepareMedia(false, routeAwemeId).catch(() => {});
      return;
    }
    refreshMediaStatus(routeAwemeId).catch(() => {});
  }, [routeAwemeId]);

  async function refreshMediaStatus(nextAwemeId = selectedAwemeId, options = {}) {
    if (!nextAwemeId) return;
    if (!options.silent) setStatus({ type: 'loading', message: '正在刷新素材状态...' });
    try {
      const json = await api.getDouyinMediaStatus(nextAwemeId);
      setMediaStatus(json);
      if (!options.silent) setStatus({ type: 'success', message: '素材状态已刷新' });
    } catch (error) {
      if (!options.silent) setStatus({ type: 'error', message: error.message });
    }
  }

  async function prepareMedia(force = false, explicitAwemeId = '') {
    const awemeId = explicitAwemeId || selectedAwemeId || awemeIdInput.trim();
    if (!awemeId) {
      setStatus({ type: 'error', message: '请输入抖音视频 ID' });
      return;
    }

    setSelectedAwemeId(awemeId);
    setAwemeIdInput(awemeId);
    setPreparing(true);
    setPrepareProgress(6);
    setStatus({
      type: 'loading',
      message: force
        ? '正在重新生成素材，可能需要下载视频、抽取音频和关键帧...'
        : '正在准备 AI 素材，优先复用本地缓存，必要时会下载视频、抽取音频和关键帧...',
    });
    setMediaStatus(prev => prev?.aweme_id === awemeId ? prev : buildInitialStatus(null, awemeId));

    try {
      const json = await api.startDouyinMediaPrepareTask(awemeId, force);
      setActiveTask(json.task);
      setStatus({ type: 'loading', message: json.task?.message || '已创建素材准备任务，正在等待执行...' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
      setPreparing(false);
      await refreshMediaStatus(awemeId, { silent: true }).catch(() => {});
    }
  }

  async function transcribeMedia() {
    if (!selectedAwemeId) {
      setStatus({ type: 'error', message: '请先选择或准备一个抖音视频素材' });
      return;
    }

    setTranscribing(true);
    setTranscribeProgress(8);
    setStatus({ type: 'loading', message: '正在压缩或切片音频，并请求音频转写，较长视频可能需要几分钟...' });
    try {
      const json = await api.startDouyinTranscribeTask(selectedAwemeId);
      setActiveTask(json.task);
      setStatus({ type: 'loading', message: json.task?.message || '已创建音频转写任务，正在等待执行...' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
      setTranscribing(false);
    }
  }

  async function openMediaTarget(target = 'dir') {
    if (openingTarget) return;
    if (!selectedAwemeId) {
      setStatus({ type: 'error', message: '请先选择或准备一个抖音视频素材' });
      return;
    }

    setOpeningTarget(target);
    setStatus({ type: 'loading', message: '正在打开本地资源管理器...' });
    try {
      await api.openDouyinMediaTarget(selectedAwemeId, target);
      setStatus({ type: 'success', message: '已请求打开本地资源管理器' });
    } catch (error) {
      setStatus({ type: 'error', message: `打开资源管理器失败：${error.message}` });
    } finally {
      setOpeningTarget('');
    }
  }

  function goToAiWorkspace() {
    if (!selectedAwemeId) {
      setStatus({ type: 'error', message: '请先选择或准备一个抖音视频素材' });
      return;
    }
    navigate(`/ai?aweme_id=${encodeURIComponent(selectedAwemeId)}`);
  }

  function selectAwemeId() {
    const awemeId = awemeIdInput.trim();
    if (!awemeId) {
      setStatus({ type: 'error', message: '请输入抖音视频 ID' });
      return;
    }
    setSelectedMediaItem(null);
    setSelectedAwemeId(awemeId);
    setMediaStatus(buildInitialStatus(null, awemeId));
    navigate(`/media/douyin/${awemeId}`);
  }

  return (
    <main className="container">
      <div className="workspaceIntro">
        <div>
          <h2>素材工作台</h2>
          <p>下载视频、抽音频、抽关键帧，并为后续 AI 分析准备本地素材。</p>
        </div>
        {selectedAwemeId ? <code>{selectedAwemeId}</code> : null}
      </div>

      <div className="toolbar">
        <input
          value={awemeIdInput}
          onChange={event => setAwemeIdInput(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && selectAwemeId()}
          placeholder="输入抖音视频 ID"
        />
        <button className="btn secondary" disabled={preparing || transcribing} onClick={selectAwemeId}>载入素材</button>
      </div>

      <Status status={status} />
      {preparing ? (
        <div className="progressLoading" aria-live="polite">
          <div className="progressHeader">
            <span>准备 AI 素材预计进度</span>
            <strong>{prepareProgress}%</strong>
          </div>
          <div className="progressTrack" role="progressbar" aria-valuenow={prepareProgress} aria-valuemin="0" aria-valuemax="100">
            <div className="progressFill" style={{ width: `${prepareProgress}%` }} />
          </div>
          <div className="progressHint">正在下载视频、抽取音频和关键帧，素材较大或网络较慢时可能需要几分钟。</div>
        </div>
      ) : null}
      {transcribing ? (
        <div className="progressLoading" aria-live="polite">
          <div className="progressHeader">
            <span>预计进度</span>
            <strong>{transcribeProgress}%</strong>
          </div>
          <div className="progressTrack" role="progressbar" aria-valuenow={transcribeProgress} aria-valuemin="0" aria-valuemax="100">
            <div className="progressFill" style={{ width: `${transcribeProgress}%` }} />
          </div>
          <div className="progressHint">正在处理音频并调用 MiMo ASR，压缩、切片和分段转写期间请不要重复点击。</div>
        </div>
      ) : null}

      <MediaPanel
        status={mediaStatus}
        preparing={preparing}
        transcribing={transcribing}
        onRefresh={() => refreshMediaStatus()}
        onPrepare={() => prepareMedia(false)}
        onForcePrepare={() => prepareMedia(true)}
        onTranscribe={transcribeMedia}
        onOpenTarget={openMediaTarget}
        openingTarget={openingTarget}
        onGoToAiWorkspace={goToAiWorkspace}
      />
    </main>
  );
}
