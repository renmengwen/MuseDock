import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { CommentModal } from '../components/CommentModal.jsx';
import { ContentTable } from '../components/ContentTable.jsx';
import { LoginModal } from '../components/LoginModal.jsx';
import { PlatformTabs } from '../components/PlatformTabs.jsx';
import { Status } from '../components/Status.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Select } from '@/components/ui/select.jsx';
import { useDouyinComments } from '../hooks/useDouyinComments.js';
import { useDouyinLogin } from '../hooks/useDouyinLogin.js';
import { setSelectedMediaItem } from '../state/mediaSelection.js';
import { getCommentCacheFromResponse, updateCommentCacheForAweme } from '../utils/commentCache.js';
import { filterByTitle, withCrawlTimestamp } from '../utils/content.js';
import { getDouyinAwemeId } from '../utils/format.js';
import { shouldAutoPrepareMedia } from '../utils/mediaStatus.js';

const CRAWL_MODES = [
  { value: 'keyword', label: '根据关键词抓取' },
  { value: 'aweme', label: '根据指定ID抓取' },
  { value: 'creator', label: '根据作者主页抓取' },
];

const MODE_PLACEHOLDER = {
  keyword: '输入搜索关键词',
  aweme: '输入抖音视频 ID 或视频链接，多个可用逗号/空格分隔',
  creator: '输入作者 sec_uid 或作者主页链接',
};

export function CrawlPage() {
  const params = useParams();
  const navigate = useNavigate();
  const platform = useMemo(() => (params.platform === 'xhs' ? 'xhs' : 'douyin'), [params.platform]);

  const [crawlMode, setCrawlMode] = useState('keyword');
  const [inputValue, setInputValue] = useState('codex');
  const [max, setMax] = useState(20);
  const [results, setResults] = useState([]);
  const [titleQuery, setTitleQuery] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const login = useDouyinLogin();
  const comments = useDouyinComments();
  const canRunCrawl = inputValue.trim().length > 0 && !loading;
  const filteredResults = useMemo(() => filterByTitle(results, titleQuery), [results, titleQuery]);

  useEffect(() => {
    setTitleQuery('');
  }, [platform]);

  useEffect(() => {
    if (platform === 'xhs' && crawlMode !== 'keyword') {
      setCrawlMode('keyword');
      setInputValue('');
      setStatus({ type: 'info', message: '小红书当前先支持关键词抓取' });
    }
  }, [platform, crawlMode]);

  function handleModeChange(event) {
    setCrawlMode(event.target.value);
    setInputValue('');
    setStatus(null);
  }

  function getActionLabel() {
    if (loading) return '抓取中...';
    if (crawlMode === 'aweme') return '指定ID抓取';
    if (crawlMode === 'creator') return '作者主页抓取';
    return '搜索抓取';
  }

  async function runCrawl() {
    const value = inputValue.trim();
    if (!value) {
      setStatus({ type: 'error', message: crawlMode === 'keyword' ? '请输入搜索关键词' : '请输入抓取目标' });
      return;
    }

    setLoading(true);
    setStatus({ type: 'loading', message: `正在抓取 ${value}...` });
    try {
      let json;
      if (platform === 'douyin' && crawlMode === 'aweme') {
        json = await api.crawlDouyinAweme(value);
      } else if (platform === 'douyin' && crawlMode === 'creator') {
        json = await api.crawlDouyinCreator(value, max);
      } else {
        json = platform === 'douyin'
          ? await api.searchDouyin(value, max)
          : await api.searchXhs(value, max);
      }

      if (json.needLogin) {
        setResults([]);
        setTitleQuery('');
        setStatus({ type: 'info', message: json.message || '需要先登录' });
        return;
      }
      if (json.needVerify) {
        setResults(json.data || []);
        setTitleQuery('');
        setStatus({ type: 'info', message: json.message || '需要完成验证码' });
        return;
      }

      const data = withCrawlTimestamp(json.data || []);
      setResults(data);
      setTitleQuery('');
      setStatus({
        type: data.length ? 'success' : 'error',
        message: data.length ? `抓取完成，共 ${data.length} 条` : `未获取到数据（耗时 ${json.elapsed || '?'}）`,
      });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
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
      <PlatformTabs base="crawl" />
      <div className="toolbar">
        <Input
          value={inputValue}
          onChange={event => setInputValue(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && runCrawl()}
          placeholder={MODE_PLACEHOLDER[crawlMode]}
        />
        <Input
          className="countInput"
          type="number"
          min="1"
          max="100"
          value={max}
          onChange={event => setMax(event.target.value)}
        />
        <Select
          value={crawlMode}
          onChange={handleModeChange}
          disabled={loading || platform === 'xhs'}
        >
          {CRAWL_MODES.map(mode => (
            <option key={mode.value} value={mode.value}>{mode.label}</option>
          ))}
        </Select>
        <Button disabled={!canRunCrawl} onClick={runCrawl}>{getActionLabel()}</Button>
        {platform === 'douyin' ? <Button variant="login" onClick={login.startLogin}>扫码登录</Button> : null}
      </div>

      <div className="toolbar">
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
        storageKey={`musedock:table-columns:crawl:${platform}`}
      />

      <LoginModal open={login.loginOpen} state={login.loginState} onClose={() => login.setLoginOpen(false)} />
      <CommentModal
        open={comments.commentOpen}
        commentsState={comments.commentsState}
        onClose={() => comments.setCommentOpen(false)}
        onRefreshLatest={refreshLatestComments}
      />
    </main>
  );
}
