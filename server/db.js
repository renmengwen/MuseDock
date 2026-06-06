const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.MEDIACRAWLER_DB_PATH || path.join(__dirname, '../data/mediacrawler.db');

function initializeSchema(db) {
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS douyin_videos (
      aweme_id TEXT PRIMARY KEY,
      aweme_type TEXT,
      title TEXT,
      description TEXT,
      create_time INTEGER,
      user_id TEXT,
      sec_uid TEXT,
      short_user_id TEXT,
      user_unique_id TEXT,
      user_signature TEXT,
      nickname TEXT,
      avatar TEXT,
      liked_count INTEGER,
      collected_count INTEGER,
      comment_count INTEGER,
      share_count INTEGER,
      ip_location TEXT,
      aweme_url TEXT,
      cover_url TEXT,
      video_download_url TEXT,
      music_download_url TEXT,
      note_download_url TEXT,
      source_keyword TEXT,
      crawled_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS douyin_comments (
      comment_id TEXT PRIMARY KEY,
      aweme_id TEXT,
      content TEXT,
      create_time INTEGER,
      user_id TEXT,
      sec_uid TEXT,
      short_user_id TEXT,
      user_unique_id TEXT,
      user_signature TEXT,
      nickname TEXT,
      avatar TEXT,
      sub_comment_count INTEGER,
      like_count INTEGER,
      ip_location TEXT,
      parent_comment_id TEXT DEFAULT '0',
      pictures TEXT,
      crawled_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS douyin_creators (
      user_id TEXT PRIMARY KEY,
      nickname TEXT,
      gender TEXT,
      avatar TEXT,
      description TEXT,
      ip_location TEXT,
      follows INTEGER,
      fans INTEGER,
      interaction INTEGER,
      videos_count INTEGER,
      crawled_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS xhs_notes (
      note_id TEXT PRIMARY KEY,
      type TEXT,
      title TEXT,
      description TEXT,
      video_url TEXT,
      publish_time TEXT,
      last_update_time INTEGER,
      user_id TEXT,
      nickname TEXT,
      avatar TEXT,
      liked_count INTEGER,
      collected_count INTEGER,
      comment_count INTEGER,
      share_count INTEGER,
      ip_location TEXT,
      image_list TEXT,
      tag_list TEXT,
      note_url TEXT,
      source_keyword TEXT,
      x_sec_token TEXT,
      crawled_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS xhs_comments (
      comment_id TEXT PRIMARY KEY,
      note_id TEXT,
      content TEXT,
      create_time TEXT,
      user_id TEXT,
      nickname TEXT,
      avatar TEXT,
      sub_comment_count INTEGER,
      like_count INTEGER,
      ip_location TEXT,
      parent_comment_id TEXT DEFAULT '0',
      pictures TEXT,
      crawled_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS xhs_creators (
      user_id TEXT PRIMARY KEY,
      nickname TEXT,
      gender TEXT,
      avatar TEXT,
      description TEXT,
      ip_location TEXT,
      follows INTEGER,
      fans INTEGER,
      interaction INTEGER,
      tag_list TEXT,
      crawled_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
initializeSchema(db);

module.exports = db;
module.exports.initializeSchema = initializeSchema;
module.exports.DB_PATH = DB_PATH;
