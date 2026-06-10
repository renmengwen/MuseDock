const defaultDb = require('../db');

function normalizePlatform(platform) {
  return platform === 'xhs' ? 'xhs' : 'douyin';
}

function normalizeKeyword(keyword) {
  return String(keyword || '').trim();
}

function saveCrawlKeyword(platform, keyword, db = defaultDb) {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) return { saved: 0 };
  db.prepare(`
    INSERT INTO crawl_keywords (platform, keyword, crawled_at)
    VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(platform, keyword) DO UPDATE SET
      crawled_at=strftime('%s','now')
  `).run(normalizePlatform(platform), normalizedKeyword);
  return { saved: 1, keyword: normalizedKeyword };
}

function listCrawlKeywords(platform, db = defaultDb) {
  return db.prepare(`
    SELECT platform, keyword, crawled_at
    FROM crawl_keywords
    WHERE platform = ?
    ORDER BY crawled_at DESC, keyword ASC
  `).all(normalizePlatform(platform));
}

module.exports = {
  listCrawlKeywords,
  saveCrawlKeyword,
};
