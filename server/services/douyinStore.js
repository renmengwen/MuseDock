const defaultDb = require('../db');

function toInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeVideo(item = {}) {
  const statistics = item.statistics || {};
  const author = item.author && typeof item.author === 'object'
    ? item.author
    : { nickname: item.author || item.nickname || '' };

  return {
    aweme_id: String(item.aweme_id || item.id || ''),
    aweme_type: item.aweme_type || '',
    title: item.title || item.description || '',
    description: item.description || item.title || '',
    create_time: item.create_time || 0,
    user_id: author.uid || item.user_id || '',
    sec_uid: author.sec_uid || item.sec_uid || '',
    short_user_id: author.short_id || item.short_user_id || '',
    user_unique_id: author.unique_id || item.user_unique_id || '',
    user_signature: author.signature || item.user_signature || '',
    nickname: author.nickname || item.author || item.nickname || '',
    avatar: author.avatar || item.avatar || '',
    liked_count: toInt(item.liked_count ?? item.likes ?? statistics.digg_count),
    collected_count: toInt(item.collected_count ?? statistics.collect_count),
    comment_count: toInt(item.comment_count ?? statistics.comment_count),
    share_count: toInt(item.share_count ?? statistics.share_count),
    ip_location: item.ip_location || '',
    aweme_url: item.aweme_url || item.url || (item.aweme_id ? `https://www.douyin.com/video/${item.aweme_id}` : ''),
    cover_url: item.cover_url || '',
    video_download_url: item.video_download_url || '',
    music_download_url: item.music_download_url || '',
    note_download_url: Array.isArray(item.note_download_url) ? item.note_download_url.join(',') : (item.note_download_url || ''),
    source_keyword: item.source_keyword || item.keyword || '',
  };
}

function saveDouyinVideos(items = [], db = defaultDb) {
  const stmt = db.prepare(`
    INSERT INTO douyin_videos (
      aweme_id, aweme_type, title, description, create_time,
      user_id, sec_uid, short_user_id, user_unique_id, user_signature,
      nickname, avatar, liked_count, collected_count, comment_count, share_count,
      ip_location, aweme_url, cover_url, video_download_url, music_download_url,
      note_download_url, source_keyword, crawled_at
    ) VALUES (
      @aweme_id, @aweme_type, @title, @description, @create_time,
      @user_id, @sec_uid, @short_user_id, @user_unique_id, @user_signature,
      @nickname, @avatar, @liked_count, @collected_count, @comment_count, @share_count,
      @ip_location, @aweme_url, @cover_url, @video_download_url, @music_download_url,
      @note_download_url, @source_keyword, strftime('%s','now')
    )
    ON CONFLICT(aweme_id) DO UPDATE SET
      aweme_type=excluded.aweme_type,
      title=excluded.title,
      description=excluded.description,
      create_time=excluded.create_time,
      user_id=excluded.user_id,
      sec_uid=excluded.sec_uid,
      short_user_id=excluded.short_user_id,
      user_unique_id=excluded.user_unique_id,
      user_signature=excluded.user_signature,
      nickname=excluded.nickname,
      avatar=excluded.avatar,
      liked_count=excluded.liked_count,
      collected_count=excluded.collected_count,
      comment_count=excluded.comment_count,
      share_count=excluded.share_count,
      ip_location=excluded.ip_location,
      aweme_url=excluded.aweme_url,
      cover_url=excluded.cover_url,
      video_download_url=COALESCE(NULLIF(excluded.video_download_url, ''), video_download_url),
      music_download_url=COALESCE(NULLIF(excluded.music_download_url, ''), music_download_url),
      note_download_url=COALESCE(NULLIF(excluded.note_download_url, ''), note_download_url),
      source_keyword=COALESCE(NULLIF(excluded.source_keyword, ''), source_keyword),
      crawled_at=strftime('%s','now')
  `);

  const rows = items.map(normalizeVideo).filter(row => row.aweme_id);
  const tx = db.transaction((records) => {
    for (const row of records) stmt.run(row);
  });
  tx(rows);
  return { saved: rows.length };
}

function normalizeComment(awemeId, item = {}, parentCommentId = '0') {
  return {
    comment_id: String(item.comment_id || item.cid || ''),
    aweme_id: String(awemeId || item.aweme_id || ''),
    content: item.content || item.text || '',
    create_time: item.create_time || 0,
    user_id: item.user_id || item.user?.uid || '',
    sec_uid: item.sec_uid || item.user?.sec_uid || '',
    short_user_id: item.short_user_id || item.user?.short_id || '',
    user_unique_id: item.user_unique_id || item.user?.unique_id || '',
    user_signature: item.user_signature || item.user?.signature || '',
    nickname: item.nickname || item.user?.nickname || '',
    avatar: item.avatar || '',
    sub_comment_count: toInt(item.sub_comment_count ?? item.reply_comment_total),
    like_count: toInt(item.like_count ?? item.digg_count),
    ip_location: item.ip_location || item.ip_label || '',
    parent_comment_id: String(parentCommentId || '0'),
    pictures: Array.isArray(item.pictures) ? JSON.stringify(item.pictures) : (item.pictures || ''),
  };
}

function flattenComments(awemeId, comments = []) {
  const rows = [];
  for (const comment of comments) {
    const parent = normalizeComment(awemeId, comment, '0');
    if (parent.comment_id) rows.push(parent);
    for (const reply of comment.replies || []) {
      const child = normalizeComment(awemeId, reply, parent.comment_id);
      if (child.comment_id) rows.push(child);
    }
  }
  return rows;
}

function saveDouyinComments(awemeId, comments = [], db = defaultDb) {
  const stmt = db.prepare(`
    INSERT INTO douyin_comments (
      comment_id, aweme_id, content, create_time,
      user_id, sec_uid, short_user_id, user_unique_id, user_signature,
      nickname, avatar, sub_comment_count, like_count, ip_location,
      parent_comment_id, pictures, crawled_at
    ) VALUES (
      @comment_id, @aweme_id, @content, @create_time,
      @user_id, @sec_uid, @short_user_id, @user_unique_id, @user_signature,
      @nickname, @avatar, @sub_comment_count, @like_count, @ip_location,
      @parent_comment_id, @pictures, strftime('%s','now')
    )
    ON CONFLICT(comment_id) DO UPDATE SET
      aweme_id=excluded.aweme_id,
      content=excluded.content,
      create_time=excluded.create_time,
      user_id=excluded.user_id,
      sec_uid=excluded.sec_uid,
      short_user_id=excluded.short_user_id,
      user_unique_id=excluded.user_unique_id,
      user_signature=excluded.user_signature,
      nickname=excluded.nickname,
      avatar=excluded.avatar,
      sub_comment_count=excluded.sub_comment_count,
      like_count=excluded.like_count,
      ip_location=excluded.ip_location,
      parent_comment_id=excluded.parent_comment_id,
      pictures=excluded.pictures,
      crawled_at=strftime('%s','now')
  `);

  const rows = flattenComments(awemeId, comments);
  const tx = db.transaction((records) => {
    for (const row of records) stmt.run(row);
  });
  tx(rows);
  return { saved: rows.length };
}

function mapCommentRow(row) {
  return {
    comment_id: row.comment_id,
    content: row.content || '',
    create_time: row.create_time || 0,
    user_id: row.user_id || '',
    sec_uid: row.sec_uid || '',
    nickname: row.nickname || '',
    avatar: row.avatar || '',
    sub_comment_count: row.sub_comment_count || 0,
    like_count: row.like_count || 0,
    ip_location: row.ip_location || '',
    parent_comment_id: row.parent_comment_id || '0',
    pictures: row.pictures || '',
    replies: [],
  };
}

function getLocalDouyinComments(awemeId, options = {}, db = defaultDb) {
  const max = Math.min(Math.max(parseInt(options.max || 50, 10), 1), 200);
  const maxReplies = Math.min(Math.max(parseInt(options.maxReplies || 20, 10), 0), 100);
  const parents = db.prepare(`
    SELECT * FROM douyin_comments
    WHERE aweme_id = ? AND parent_comment_id = '0'
    ORDER BY crawled_at DESC, create_time DESC
    LIMIT ?
  `).all(String(awemeId), max);

  const repliesStmt = db.prepare(`
    SELECT * FROM douyin_comments
    WHERE aweme_id = ? AND parent_comment_id = ?
    ORDER BY create_time ASC
    LIMIT ?
  `);

  const data = parents.map(parent => {
    const item = mapCommentRow(parent);
    item.replies = repliesStmt
      .all(String(awemeId), parent.comment_id, maxReplies)
      .map(mapCommentRow);
    return item;
  });

  return {
    success: true,
    source: 'local',
    aweme_id: String(awemeId),
    count: data.length,
    data,
    message: data.length ? `已加载本地缓存评论 ${data.length} 条` : '暂无本地评论缓存',
  };
}

module.exports = {
  getLocalDouyinComments,
  normalizeVideo,
  saveDouyinVideos,
  saveDouyinComments,
};
