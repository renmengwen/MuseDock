const express = require('express');
const storedCookies = require('../state/cookies');

const router = express.Router();

function analyzeCookies(str) {
  if (!str || !str.trim()) return { count: 0, format: 'none', names: [] };
  const trimmed = str.trim();
  let format = 'unknown';
  let names = [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    format = 'JSON';
    try {
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        const lastBracket = trimmed.lastIndexOf(']');
        if (lastBracket > 0 && trimmed[0] === '[') {
          parsed = JSON.parse(trimmed.substring(0, lastBracket + 1));
        } else {
          throw e;
        }
      }
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      names = arr.filter(c => c.name).map(c => ({
        name: c.name,
        domain: c.domain || '(unspecified)',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        hasExpiration: !!(c.expirationDate || c.expires),
      }));
    } catch (e) {
      format = 'JSON(parse failed)';
    }
  } else if (trimmed.includes('=')) {
    format = 'standard(name=value)';
    names = trimmed.split(';').map(p => {
      const idx = p.indexOf('=');
      return idx > -1
        ? { name: p.substring(0, idx).trim(), domain: 'default', secure: false, httpOnly: false, hasExpiration: false }
        : null;
    }).filter(Boolean);
  }

  return { count: names.length, format, names };
}

router.get('/cookies', (req, res) => {
  const dy = analyzeCookies(storedCookies.douyin);
  const xh = analyzeCookies(storedCookies.xhs);
  res.json({
    douyin: dy,
    xhs: xh,
    hasDouyinCookie: storedCookies.douyin.length > 0,
  });
});

module.exports = router;
