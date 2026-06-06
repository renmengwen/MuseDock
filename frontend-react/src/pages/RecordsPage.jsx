import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { CommentModal } from '../components/CommentModal.jsx';
import { ContentTable } from '../components/ContentTable.jsx';
import { PlatformTabs } from '../components/PlatformTabs.jsx';
import { Status } from '../components/Status.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { useDouyinComments } from '../hooks/useDouyinComments.js';
import { setSelectedMediaItem } from '../state/mediaSelection.js';
import { filterByTitle } from '../utils/content.js';
import { getDouyinAwemeId } from '../utils/format.js';

export function RecordsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const platform = useMemo(() => (params.platform === 'xhs' ? 'xhs' : 'douyin'), [params.platform]);

  const [results, setResults] = useState([]);
  const [titleQuery, setTitleQuery] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const comments = useDouyinComments();
  const filteredResults = useMemo(() => filterByTitle(results, titleQuery), [results, titleQuery]);

  useEffect(() => {
    loadHistory();
  }, [platform]);

  async function loadHistory() {
    setLoading(true);
    setStatus({ type: 'loading', message: '正在加载历史记录...' });
    try {
      const json = await api.getHistory(platform);
      setResults(json.data || []);
      setTitleQuery('');
      setStatus({ type: 'success', message: `已加载 ${json.count || 0} 条历史记录` });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }

  function prepareMedia(item) {
    const awemeId = getDouyinAwemeId(item);
    if (!awemeId) return;
    setSelectedMediaItem(item, { autoPrepare: true });
    navigate(`/media/douyin/${awemeId}`);
  }

  return (
    <main className="container">
      <PlatformTabs base="records" />
      <div className="toolbar">
        <Button variant="secondary" disabled={loading} onClick={loadHistory}>
          {loading ? '加载中...' : '刷新记录'}
        </Button>
        <Input
          value={titleQuery}
          onChange={event => setTitleQuery(event.target.value)}
          placeholder="按标题搜索"
          aria-label="按标题搜索"
        />
      </div>

      <Status status={status} />
      {loading ? <div className="pageLoading">接口处理中，请稍候...</div> : null}
      <ContentTable
        platform={platform}
        data={filteredResults}
        onComments={comments.loadComments}
        onPrepareMedia={prepareMedia}
        storageKey={`musedock:table-columns:records:${platform}`}
      />

      <CommentModal
        open={comments.commentOpen}
        commentsState={comments.commentsState}
        onClose={() => comments.setCommentOpen(false)}
        onRefreshLatest={comments.refreshLatestComments}
      />
    </main>
  );
}
