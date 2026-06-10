const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { initializeSchema } = require('../server/db');
const { listCrawlKeywords, saveCrawlKeyword } = require('../server/services/crawlKeywords');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediacrawler-keywords-'));
const db = new Database(path.join(tempDir, 'test.db'));
initializeSchema(db);

saveCrawlKeyword('douyin', ' codex ', db);
saveCrawlKeyword('douyin', 'codex', db);
saveCrawlKeyword('douyin', '', db);
saveCrawlKeyword('xhs', '小红书选题', db);

assert.deepEqual(listCrawlKeywords('douyin', db).map(row => row.keyword), ['codex']);
assert.deepEqual(listCrawlKeywords('xhs', db).map(row => row.keyword), ['小红书选题']);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM crawl_keywords').get().count, 2);

db.close();
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('crawl keyword tests passed');
