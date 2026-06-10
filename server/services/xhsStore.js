const defaultDb = require('../db');

function toInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNote(item = {}) {
  return {
    note_id: String(item.note_id || item.id || ''),
    type: item.type || '',
    title: item.title || '',
    description: item.description || '',
    video_url: item.video_url || '',
    publish_time: item.publish_time || '',
    last_update_time: toInt(item.last_update_time),
    user_id: item.user_id || '',
    nickname: item.nickname || item.author || '',
    avatar: item.avatar || '',
    liked_count: toInt(item.liked_count),
    collected_count: toInt(item.collected_count),
    comment_count: toInt(item.comment_count),
    share_count: toInt(item.share_count),
    ip_location: item.ip_location || '',
    image_list: Array.isArray(item.image_list) ? JSON.stringify(item.image_list) : (item.image_list || ''),
    tag_list: Array.isArray(item.tag_list) ? JSON.stringify(item.tag_list) : (item.tag_list || ''),
    note_url: item.note_url || item.url || '',
    source_keyword: item.source_keyword || item.keyword || '',
    x_sec_token: item.x_sec_token || '',
  };
}

function saveXhsNotes(items = [], db = defaultDb) {
  const stmt = db.prepare(`
    INSERT INTO xhs_notes (
      note_id, type, title, description, video_url, publish_time,
      last_update_time, user_id, nickname, avatar, liked_count, collected_count,
      comment_count, share_count, ip_location, image_list, tag_list, note_url,
      source_keyword, x_sec_token, crawled_at
    ) VALUES (
      @note_id, @type, @title, @description, @video_url, @publish_time,
      @last_update_time, @user_id, @nickname, @avatar, @liked_count, @collected_count,
      @comment_count, @share_count, @ip_location, @image_list, @tag_list, @note_url,
      @source_keyword, @x_sec_token, strftime('%s','now')
    )
    ON CONFLICT(note_id) DO UPDATE SET
      type=excluded.type,
      title=excluded.title,
      description=excluded.description,
      video_url=COALESCE(NULLIF(excluded.video_url, ''), video_url),
      publish_time=COALESCE(NULLIF(excluded.publish_time, ''), publish_time),
      last_update_time=COALESCE(NULLIF(excluded.last_update_time, 0), last_update_time),
      user_id=COALESCE(NULLIF(excluded.user_id, ''), user_id),
      nickname=COALESCE(NULLIF(excluded.nickname, ''), nickname),
      avatar=COALESCE(NULLIF(excluded.avatar, ''), avatar),
      liked_count=excluded.liked_count,
      collected_count=excluded.collected_count,
      comment_count=excluded.comment_count,
      share_count=excluded.share_count,
      ip_location=COALESCE(NULLIF(excluded.ip_location, ''), ip_location),
      image_list=COALESCE(NULLIF(excluded.image_list, ''), image_list),
      tag_list=COALESCE(NULLIF(excluded.tag_list, ''), tag_list),
      note_url=COALESCE(NULLIF(excluded.note_url, ''), note_url),
      source_keyword=COALESCE(NULLIF(excluded.source_keyword, ''), source_keyword),
      x_sec_token=COALESCE(NULLIF(excluded.x_sec_token, ''), x_sec_token),
      crawled_at=strftime('%s','now')
  `);

  const rows = items.map(normalizeNote).filter(row => row.note_id);
  const tx = db.transaction((records) => {
    for (const row of records) stmt.run(row);
  });
  tx(rows);
  return { saved: rows.length };
}

module.exports = {
  normalizeNote,
  saveXhsNotes,
};
