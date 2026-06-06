import { formatTime, getDouyinAwemeId, getDouyinUrl } from '../utils/format.js';

export function ContentTable({ platform, data, onComments, onPrepareMedia }) {
  if (!data.length) return <div className="empty">暂无数据</div>;

  if (platform === 'douyin') {
    return (
      <table>
        <thead>
          <tr>
            <th>标题</th>
            <th>作者</th>
            <th>发布日期</th>
            <th>抓取日期</th>
            <th>点赞</th>
            <th>评论</th>
            <th>链接</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {data.map(item => {
            const awemeId = getDouyinAwemeId(item);
            return (
              <tr key={awemeId || item.url || item.aweme_url}>
                <td className="titleCell">{item.title || item.description || '-'}</td>
                <td>{item.author || item.nickname || item.author?.nickname || '-'}</td>
                <td>{formatTime(item.create_time)}</td>
                <td>{formatTime(item.crawled_at)}</td>
                <td>{item.likes || item.liked_count || item.statistics?.digg_count || 0}</td>
                <td>{item.comment_count || item.statistics?.comment_count || 0}</td>
                <td><a href={getDouyinUrl(item)} target="_blank" rel="noreferrer">打开</a></td>
                <td className="actionCell">
                  <button className="btn compact secondary" disabled={!awemeId} onClick={() => onComments(awemeId)}>评论</button>
                  <button className="btn compact primary" disabled={!awemeId} onClick={() => onPrepareMedia(item)}>准备 AI 素材</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th>封面</th>
          <th>标题</th>
          <th>发布日期</th>
          <th>抓取日期</th>
          <th>点赞</th>
          <th>评论</th>
          <th>收藏</th>
          <th>链接</th>
        </tr>
      </thead>
      <tbody>
        {data.map(item => (
          <tr key={item.note_id || item.note_url}>
            <td>{item.cover_url ? <img className="cover" src={item.cover_url} alt="" /> : '-'}</td>
            <td className="titleCell">{item.title || item.description || '-'}</td>
            <td>{formatTime(item.publish_time || item.create_time || item.last_update_time)}</td>
            <td>{formatTime(item.crawled_at)}</td>
            <td>{item.liked_count || 0}</td>
            <td>{item.comment_count || 0}</td>
            <td>{item.collected_count || 0}</td>
            <td><a href={item.note_url || '#'} target="_blank" rel="noreferrer">打开</a></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
