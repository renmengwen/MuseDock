import { formatTime } from '../utils/format.js';

export function CommentModal({ open, commentsState, onClose, onRefreshLatest }) {
  if (!open) return null;

  const comments = commentsState.data || [];

  return (
    <div className="modalOverlay">
      <div className="modal wide">
        <div className="mediaHeader">
          <h3>评论</h3>
          <button className="btn compact primary" disabled={commentsState.loading} onClick={onRefreshLatest}>
            {commentsState.loading ? '获取中...' : '获取最新评论'}
          </button>
        </div>
        <p className="hint">{commentsState.hint}</p>
        <div className="commentList">
          {comments.length === 0 ? <div className="empty small">暂无评论</div> : null}
          {comments.map(comment => (
            <div className="commentItem" key={comment.comment_id}>
              <div><b>{comment.nickname || '-'}</b>: {comment.content}</div>
              <div className="commentMeta">
                发布日期 {formatTime(comment.create_time)} · 点赞 {comment.like_count || 0} · 回复 {comment.sub_comment_count || 0}
                {comment.ip_location ? ` · ${comment.ip_location}` : ''}
              </div>
              {comment.replies?.length ? (
                <div className="replyList">
                  {comment.replies.map(reply => (
                    <div className="commentItem reply" key={reply.comment_id}>
                      <div><b>{reply.nickname || '-'}</b>: {reply.content}</div>
                      <div className="commentMeta">
                        回复日期 {formatTime(reply.create_time)} · 点赞 {reply.like_count || 0}
                        {reply.ip_location ? ` · ${reply.ip_location}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {commentsState.loading ? (
          <div className="modalLoadingOverlay">
            <div className="loadingSpinner" />
            <div>{commentsState.loadingText || '正在加载，请稍候...'}</div>
          </div>
        ) : null}
        <button className="btn secondary" onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}
