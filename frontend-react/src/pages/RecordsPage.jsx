import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { CommentModal } from '../components/CommentModal.jsx';
import { SelectableContentTable } from '../components/ContentTable.jsx';
import { PlatformTabs } from '../components/PlatformTabs.jsx';
import { Status } from '../components/Status.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.jsx';
import { useDouyinComments } from '../hooks/useDouyinComments.js';
import { setSelectedMediaItem } from '../state/mediaSelection.js';
import { getCommentCacheFromResponse, updateCommentCacheForAweme } from '../utils/commentCache.js';
import { filterByTitle } from '../utils/content.js';
import { getDouyinAwemeId } from '../utils/format.js';
import { shouldAutoPrepareMedia } from '../utils/mediaStatus.js';

const ALL_KEYWORDS_VALUE = '__all_keywords__';

export function RecordsPage({ routePlatform = '' } = {}) {
  const params = useParams();
  const navigate = useNavigate();
  const platform = useMemo(() => ((routePlatform || params.platform) === 'xhs' ? 'xhs' : 'douyin'), [routePlatform, params.platform]);

  const [results, setResults] = useState([]);
  const [titleQuery, setTitleQuery] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [deletingIds, setDeletingIds] = useState([]);
  const [keywordOptions, setKeywordOptions] = useState([]);
  const [selectedKeyword, setSelectedKeyword] = useState('');
  const comments = useDouyinComments();
  const filteredResults = useMemo(() => filterByTitle(results, titleQuery), [results, titleQuery]);
  const visibleIds = useMemo(() => filteredResults
    .map(item => (platform === 'douyin' ? getDouyinAwemeId(item) : item.note_id))
    .filter(Boolean), [filteredResults, platform]);
  const selectedVisibleIds = useMemo(() => selectedIds.filter(id => visibleIds.includes(id)), [selectedIds, visibleIds]);
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length;
  const partiallyVisibleSelected = selectedVisibleIds.length > 0 && selectedVisibleIds.length < visibleIds.length;

  useEffect(() => {
    setSelectedKeyword('');
    loadKeywords();
    loadHistory('');
  }, [platform]);

  async function loadKeywords() {
    try {
      const json = await api.getCrawlKeywords(platform);
      setKeywordOptions(json.data || []);
    } catch {
      setKeywordOptions([]);
    }
  }

  async function loadHistory(keyword = selectedKeyword) {
    setLoading(true);
    setStatus({ type: 'loading', message: keyword ? `正在加载关键词“${keyword}”的历史记录...` : '正在加载历史记录...' });
    try {
      const json = await api.getHistory(platform, keyword);
      setResults(json.data || []);
      setSelectedIds([]);
      setTitleQuery('');
      setStatus({ type: 'success', message: `已加载 ${json.count || 0} 条历史记录` });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }

  function handleKeywordChange(keyword) {
    setSelectedKeyword(keyword);
    loadHistory(keyword);
  }

  function handleSelectRow(id, checked) {
    if (!id) return;
    setSelectedIds(current => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter(item => item !== id);
    });
  }

  function toggleSelectVisible() {
    setSelectedIds(current => {
      const visibleSet = new Set(visibleIds);
      if (visibleIds.length > 0 && visibleIds.every(id => current.includes(id))) {
        return current.filter(id => !visibleSet.has(id));
      }
      return [...new Set([...current, ...visibleIds])];
    });
  }

  function handleSelectAllVisible(checked) {
    setSelectedIds(current => {
      const visibleSet = new Set(visibleIds);
      if (!checked) return current.filter(id => !visibleSet.has(id));
      return [...new Set([...current, ...visibleIds])];
    });
  }

  async function deleteRecords(ids) {
    const targetIds = [...new Set((ids || []).filter(Boolean))];
    if (!targetIds.length || deletingIds.length > 0) return;
    const confirmed = window.confirm(`确定删除 ${targetIds.length} 条抓取记录以及生成的所有本地内容吗？此操作不可恢复。`);
    if (!confirmed) return;

    setDeletingIds(targetIds);
    setStatus({ type: 'loading', message: `正在删除 ${targetIds.length} 条抓取记录及本地产物...` });
    try {
      const json = await api.deleteHistory(platform, targetIds);
      const deleted = json.deleted_ids || targetIds;
      setResults(current => current.filter(item => {
        const id = platform === 'douyin' ? getDouyinAwemeId(item) : item.note_id;
        return !deleted.includes(id);
      }));
      setSelectedIds(current => current.filter(id => !deleted.includes(id)));
      setStatus({ type: 'success', message: json.message || `已删除 ${deleted.length} 条抓取记录及本地产物` });
      await loadKeywords();
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setDeletingIds([]);
    }
  }

  function prepareMedia(item) {
    const awemeId = getDouyinAwemeId(item);
    if (!awemeId) return;
    setSelectedMediaItem(item, { autoPrepare: shouldAutoPrepareMedia(item) });
    navigate(`/media/douyin/${awemeId}`);
  }

  async function refreshLatestComments() {
    const json = await comments.refreshLatestComments();
    const awemeId = comments.commentsState.awemeId;
    setResults(current => updateCommentCacheForAweme(
      current,
      awemeId,
      getCommentCacheFromResponse(json),
    ));
  }

  return (
    <main className="container">
      <PlatformTabs base="records" />
      <div className="toolbar">
        <Button variant="secondary" disabled={loading} onClick={() => loadHistory()}>
          {loading ? '加载中...' : '刷新记录'}
        </Button>
        <Select
          value={selectedKeyword || ALL_KEYWORDS_VALUE}
          onValueChange={value => handleKeywordChange(value === ALL_KEYWORDS_VALUE ? '' : value)}
          disabled={loading || deletingIds.length > 0}
        >
          <SelectTrigger className="modeSelect" aria-label="按关键词筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_KEYWORDS_VALUE}>全部关键词</SelectItem>
            {keywordOptions.map(item => (
              <SelectItem key={item.keyword} value={item.keyword}>{item.keyword}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="secondary" disabled={!visibleIds.length || deletingIds.length > 0} onClick={toggleSelectVisible}>
          {visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length ? '取消本页选择' : '选择本页'}
        </Button>
        <Button disabled={!selectedIds.length || deletingIds.length > 0} onClick={() => deleteRecords(selectedIds)}>
          {deletingIds.length > 0 ? '删除中...' : `批量删除${selectedIds.length ? `（${selectedIds.length}）` : ''}`}
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
      <SelectableContentTable
        platform={platform}
        data={filteredResults}
        onComments={comments.loadComments}
        onPrepareMedia={prepareMedia}
        onDelete={deleteRecords}
        selectedIds={selectedIds}
        onSelectRow={handleSelectRow}
        deletingIds={deletingIds}
        onSelectAll={handleSelectAllVisible}
        allSelected={allVisibleSelected}
        partiallySelected={partiallyVisibleSelected}
        selectionDisabled={!visibleIds.length || deletingIds.length > 0}
        storageKey={`musedock:table-columns:records:${platform}`}
      />

      <CommentModal
        open={comments.commentOpen}
        commentsState={comments.commentsState}
        onClose={() => comments.setCommentOpen(false)}
        onRefreshLatest={refreshLatestComments}
      />
    </main>
  );
}
