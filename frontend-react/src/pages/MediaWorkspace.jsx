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

  async function refreshMediaStatus(nextAwemeId = selectedAwemeId) {
    if (!nextAwemeId) return;
    setStatus({ type: 'loading', message: '正在刷新素材状态...' });
    try {
      const json = await api.getDouyinMediaStatus(nextAwemeId);
      setMediaStatus(json);
      setStatus({ type: 'success', message: '素材状态已刷新' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
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
    setStatus({
      type: 'loading',
      message: force ? '正在重新生成素材...' : '正在准备素材，优先复用本地缓存...',
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
        steps: json.steps || {},
      });
      setStatus({ type: 'success', message: force ? '素材已重新生成' : '素材准备完成，已复用可用缓存' });
      if (routeAwemeId !== awemeId) navigate(`/media/douyin/${awemeId}`, { replace: true });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
      await refreshMediaStatus(awemeId).catch(() => {});
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
    setStatus({ type: 'loading', message: '正在请求音频转写...' });
    try {
      const json = await api.transcribeDouyinMedia(selectedAwemeId);
      setStatus({
        type: json.configured === false ? 'info' : (json.success ? 'success' : 'error'),
        message: json.message || '转写接口已返回',
      });
      await refreshMediaStatus(selectedAwemeId);
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setTranscribing(false);
    }
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
      {(preparing || transcribing) ? <div className="pageLoading">接口处理中，请稍候...</div> : null}

      <MediaPanel
        status={mediaStatus}
        preparing={preparing}
        transcribing={transcribing}
        onRefresh={() => refreshMediaStatus()}
        onPrepare={() => prepareMedia(false)}
        onForcePrepare={() => prepareMedia(true)}
        onTranscribe={transcribeMedia}
      />
    </main>
  );
}
