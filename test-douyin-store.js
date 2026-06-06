const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { initializeSchema } = require('./server/db');
const {
  getLocalDouyinComments,
  saveDouyinVideos,
  saveDouyinComments,
} = require('./server/services/douyinStore');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediacrawler-store-'));
const dbPath = path.join(tempDir, 'test.db');
const db = new Database(dbPath);
initializeSchema(db);

saveDouyinVideos([
  {
    aweme_id: 'v1',
    title: 'first title',
    author: 'Alice',
    likes: 12,
    comment_count: 3,
    url: 'https://www.douyin.com/video/v1',
    cover_url: 'cover',
    keyword: 'codex',
  },
], db);

saveDouyinVideos([
  {
    aweme_id: 'v1',
    title: 'updated title',
    author: 'Alice 2',
    likes: 20,
    comment_count: 5,
    url: 'https://www.douyin.com/video/v1',
    cover_url: 'cover2',
    keyword: 'codex',
  },
], db);

const video = db.prepare('SELECT * FROM douyin_videos WHERE aweme_id = ?').get('v1');
assert.equal(video.title, 'updated title');
assert.equal(video.nickname, 'Alice 2');
assert.equal(video.liked_count, 20);
assert.equal(video.comment_count, 5);
assert.equal(video.source_keyword, 'codex');

saveDouyinComments('v1', [
  {
    comment_id: 'c1',
    content: 'parent',
    create_time: 1780000000,
    user_id: 'u1',
    nickname: 'Bob',
    like_count: 8,
    ip_location: 'Shanghai',
    sub_comment_count: 1,
    replies: [
      {
        comment_id: 'r1',
        content: 'reply',
        create_time: 1780000001,
        user_id: 'u2',
        nickname: 'Carol',
        like_count: 2,
        ip_location: 'Beijing',
      },
    ],
  },
], db);

const comments = db.prepare('SELECT * FROM douyin_comments ORDER BY parent_comment_id, comment_id').all();
assert.equal(comments.length, 2);
assert.equal(comments.find(row => row.comment_id === 'c1').parent_comment_id, '0');
assert.equal(comments.find(row => row.comment_id === 'r1').parent_comment_id, 'c1');

const local = getLocalDouyinComments('v1', { max: 10 }, db);
assert.equal(local.count, 1);
assert.equal(local.data[0].comment_id, 'c1');
assert.equal(local.data[0].replies.length, 1);
assert.equal(local.data[0].replies[0].comment_id, 'r1');

db.close();
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('douyin store tests passed');
