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
      const json = await api.prepareDouyinMedia(awemeId, force);
      setMediaStatus({
        success: true,
        aweme_id: awemeId,
        dir: json.dir,
        metadata: json.analysis_input?.video || json.metadata || {},
        analysis_input: json.analysis_input,
        frames: json.analysis_input?.local_assets?.frames || [],
        steps: json.analysis_input?.steps || json.steps || {},
      });
      setPrepareProgress(100);
      setStatus({ type: 'success', message: force ? '素材已重新生成' : '素材准备完成，已复用可用缓存' });
      if (routeAwemeId !== awemeId) navigate(`/media/douyin/${awemeId}`, { replace: true });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
      await refreshMediaStatus(awemeId, { silent: true }).catch(() => {});
    } finally {
      setPreparing(false);
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
      const json = await api.transcribeDouyinMedia(selectedAwemeId);
      setTranscribeProgress(100);
      setMediaStatus(prev => {
        const nextSteps = {
          ...(prev?.steps || {}),
          transcript: {
            status: json.status || (json.success ? 'done' : 'failed'),
            path: json.transcript_path || prev?.steps?.transcript?.path || '',
            message: json.message || '',
          },
        };
        return {
          ...(prev || buildInitialStatus(null, selectedAwemeId)),
          transcript: json,
          steps: nextSteps,
        };
      });
      setStatus({
        type: json.configured === false ? 'info' : (json.success ? 'success' : 'error'),
        message: json.message || '转写接口已返回',
      });
      await refreshMediaStatus(selectedAwemeId, { silent: true });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
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
