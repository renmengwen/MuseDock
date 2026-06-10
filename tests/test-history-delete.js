const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { initializeSchema } = require('../server/db');
const { deleteHistoryItems } = require('../server/services/historyCleanup');
const { saveDouyinVideos, saveDouyinComments } = require('../server/services/douyinStore');
const { listCrawlKeywords, saveCrawlKeyword } = require('../server/services/crawlKeywords');

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediacrawler-history-delete-'));
  const db = new Database(path.join(tempDir, 'test.db'));
  const mediaRoot = path.join(tempDir, 'media', 'douyin');
  initializeSchema(db);

  saveDouyinVideos([
    {
      aweme_id: '123456',
      title: '待删除视频',
      author: 'Alice',
      keyword: 'codex',
    },
    {
      aweme_id: '654321',
      title: '保留视频',
      author: 'Bob',
      keyword: 'keep',
    },
  ], db);
  saveDouyinComments('123456', [{ comment_id: 'c1', content: 'comment' }], db);
  saveDouyinComments('654321', [{ comment_id: 'c2', content: 'comment' }], db);
  saveCrawlKeyword('douyin', 'codex', db);
  saveCrawlKeyword('douyin', 'keep', db);

  const mediaDir = path.join(mediaRoot, '123456');
  fs.mkdirSync(path.join(mediaDir, 'frames'), { recursive: true });
  fs.mkdirSync(path.join(mediaDir, 'agent_runs'), { recursive: true });
  fs.writeFileSync(path.join(mediaDir, 'video.mp4'), 'video');
  fs.writeFileSync(path.join(mediaDir, 'audio.mp3'), 'audio');
  fs.writeFileSync(path.join(mediaDir, 'transcript.json'), '{}');
  fs.writeFileSync(path.join(mediaDir, 'frames', 'frame-0001.jpg'), 'frame');
  fs.writeFileSync(path.join(mediaDir, 'agent_runs', 'run.json'), '{}');

  const result = await deleteHistoryItems('douyin', ['123456'], { db, mediaRoot });

  assert.equal(result.success, true);
  assert.deepEqual(result.deleted_ids, ['123456']);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM douyin_videos WHERE aweme_id = ?').get('123456').count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM douyin_comments WHERE aweme_id = ?').get('123456').count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM douyin_videos WHERE aweme_id = ?').get('654321').count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM douyin_comments WHERE aweme_id = ?').get('654321').count, 1);
  assert.equal(fs.existsSync(mediaDir), false);
  assert.deepEqual(listCrawlKeywords('douyin', db).map(row => row.keyword), ['keep']);

  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

run()
  .then(() => console.log('history delete tests passed'))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
