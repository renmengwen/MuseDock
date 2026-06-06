import { Button } from '@/components/ui/button.jsx';
import { ConfigurableTable } from './data-table/ConfigurableTable.jsx';
import { formatTime, getDouyinAwemeId, getDouyinUrl } from '../utils/format.js';
import { formatDuration, getContentTypeLabel } from '../utils/content.js';

function getAuthorName(item = {}) {
  if (item.author && typeof item.author === 'object') {
    return item.author.nickname || item.author.name || item.nickname || '-';
  }
  return item.author || item.nickname || '-';
}

function createDouyinColumns(onComments, onPrepareMedia) {
  return [
    { id: 'title', label: '标题', className: 'min-w-[260px] max-w-[430px] break-words', render: item => item.title || item.description || '-' },
    { id: 'type', label: '类型', className: 'min-w-[88px]', render: item => getContentTypeLabel(item, 'douyin') },
    { id: 'duration', label: '视频时长', className: 'min-w-[96px]', render: item => formatDuration(item) },
    { id: 'author', label: '作者', className: 'min-w-[120px]', render: item => getAuthorName(item) },
    { id: 'createdAt', label: '发布日期', className: 'min-w-[136px]', render: item => formatTime(item.create_time) },
    { id: 'crawledAt', label: '抓取日期', className: 'min-w-[136px]', render: item => formatTime(item.crawled_at) },
    { id: 'likes', label: '点赞', className: 'min-w-[80px]', render: item => item.likes || item.liked_count || item.statistics?.digg_count || 0 },
    { id: 'comments', label: '评论', className: 'min-w-[80px]', render: item => item.comment_count || item.statistics?.comment_count || 0 },
    { id: 'link', label: '链接', className: 'min-w-[72px]', render: item => <a href={getDouyinUrl(item)} target="_blank" rel="noreferrer">打开</a> },
    {
      id: 'actions',
      label: '操作',
      className: 'min-w-[168px]',
      render: item => {
        const awemeId = getDouyinAwemeId(item);
        return (
          <div className="actionCell">
            <Button variant="secondary" size="sm" disabled={!awemeId} onClick={() => onComments(awemeId)}>评论</Button>
            <Button size="sm" disabled={!awemeId} onClick={() => onPrepareMedia(item)}>准备 AI 素材</Button>
          </div>
        );
      },
    },
  ];
}

function createXhsColumns() {
  return [
    { id: 'cover', label: '封面', className: 'min-w-[96px]', render: item => (item.cover_url ? <img className="cover" src={item.cover_url} alt="" /> : '-') },
    { id: 'title', label: '标题', className: 'min-w-[260px] max-w-[430px] break-words', render: item => item.title || item.description || '-' },
    { id: 'type', label: '类型', className: 'min-w-[88px]', render: item => getContentTypeLabel(item, 'xhs') },
    { id: 'duration', label: '视频时长', className: 'min-w-[96px]', render: item => formatDuration(item) },
    { id: 'createdAt', label: '发布日期', className: 'min-w-[136px]', render: item => formatTime(item.publish_time || item.create_time || item.last_update_time) },
    { id: 'crawledAt', label: '抓取日期', className: 'min-w-[136px]', render: item => formatTime(item.crawled_at) },
    { id: 'likes', label: '点赞', className: 'min-w-[80px]', render: item => item.liked_count || 0 },
    { id: 'comments', label: '评论', className: 'min-w-[80px]', render: item => item.comment_count || 0 },
    { id: 'collections', label: '收藏', className: 'min-w-[80px]', render: item => item.collected_count || 0 },
    { id: 'link', label: '链接', className: 'min-w-[72px]', render: item => <a href={item.note_url || '#'} target="_blank" rel="noreferrer">打开</a> },
  ];
}

function getRowKey(platform, item, index) {
  if (platform === 'douyin') {
    return getDouyinAwemeId(item) || item.url || item.aweme_url || index;
  }
  return item.note_id || item.note_url || index;
}

export function ContentTable({ platform, data, onComments, onPrepareMedia, storageKey }) {
  const columns = platform === 'douyin'
    ? createDouyinColumns(onComments, onPrepareMedia)
    : createXhsColumns();

  return (
    <ConfigurableTable
      columns={columns}
      data={data}
      getRowKey={(item, index) => getRowKey(platform, item, index)}
      storageKey={storageKey}
      emptyText="暂无数据"
    />
  );
}
