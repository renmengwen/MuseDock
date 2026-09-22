const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DATA_ROOT = require('../../dataRoot');

const DEFAULT_DIRECTORY = path.join(DATA_ROOT, 'data', 'api-call-logs');
const SUMMARY_FIELDS = `sequence, id, created_at, completed_at, workflow_id, category, operation,
  model, endpoint, method, http_status, transport_status, result_status, duration_ms,
  response_bytes, body_encoding, body_truncated, content_type, error, context_json, validation_json,
  request_bytes, request_body_truncated, request_body_status`;
const STATE_SQL = `CASE WHEN result_status = 'invalid' THEN 'invalid'
  WHEN transport_status IN ('error', 'incomplete') OR http_status >= 400 OR result_status = 'error' THEN 'error'
  WHEN transport_status IN ('pending', 'receiving') THEN 'pending' ELSE 'success' END`;
const stores = new Map();

function decode(row) {
  if (!row) return null;
  const { context_json, validation_json, headers_json, ...record } = row;
  return { ...record, context: JSON.parse(context_json || '{}'), validation: JSON.parse(validation_json || '[]'),
    ...(headers_json !== undefined ? { response_headers: JSON.parse(headers_json || '{}') } : {}) };
}

function createApiCallStore({ directory = DEFAULT_DIRECTORY } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const Database = require('better-sqlite3');
  const db = new Database(path.join(directory, 'records.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`CREATE TABLE IF NOT EXISTS api_calls (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT '', workflow_id TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '', operation TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
    endpoint TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT 'GET', http_status INTEGER,
    transport_status TEXT NOT NULL DEFAULT 'pending', result_status TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0, response_bytes INTEGER NOT NULL DEFAULT 0,
    body_encoding TEXT NOT NULL DEFAULT 'utf8', body_truncated INTEGER NOT NULL DEFAULT 0, content_type TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL DEFAULT '', headers_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
    context_json TEXT NOT NULL DEFAULT '{}', validation_json TEXT NOT NULL DEFAULT '[]'
  ); CREATE INDEX IF NOT EXISTS api_calls_workflow_sequence ON api_calls(workflow_id, sequence DESC);`);
  const columns = new Set(db.pragma('table_info(api_calls)').map(column => column.name));
  for (const [name, definition] of Object.entries({
    request_bytes: 'INTEGER NOT NULL DEFAULT 0',
    request_body_text: "TEXT NOT NULL DEFAULT ''",
    request_body_truncated: 'INTEGER NOT NULL DEFAULT 0',
    request_body_status: "TEXT NOT NULL DEFAULT 'unavailable'",
  })) {
    if (!columns.has(name)) db.exec(`ALTER TABLE api_calls ADD COLUMN ${name} ${definition}`);
  }
  // 本进程第一次打开存储时，上次退出前未写完的记录明确显示为不完整。
  db.prepare(`UPDATE api_calls SET transport_status = 'incomplete', error = ?
    WHERE transport_status IN ('pending', 'receiving')`).run('服务中断，未能保存完整返回；不能据此判断供应商是否已完成请求。');
  const patchable = new Set(['completed_at', 'http_status', 'transport_status', 'result_status', 'duration_ms',
    'response_bytes', 'body_encoding', 'body_truncated', 'content_type', 'body_text', 'headers_json', 'error', 'validation_json', 'model']);
  return {
    start(record) {
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO api_calls (id, created_at, workflow_id, category, operation, model, endpoint, method, context_json,
        request_bytes, request_body_text, request_body_truncated, request_body_status)
        VALUES (@id, @created_at, @workflow_id, @category, @operation, @model, @endpoint, @method, @context_json,
          @request_bytes, @request_body_text, @request_body_truncated, @request_body_status)`)
        .run({ id, created_at: new Date().toISOString(), workflow_id: '', category: '', operation: '', model: '',
          endpoint: '', method: 'GET', context_json: '{}', request_bytes: 0, request_body_text: '',
          request_body_truncated: 0, request_body_status: 'none', ...record });
      return id;
    },
    update(id, patch) {
      const entries = Object.entries(patch).filter(([key]) => patchable.has(key));
      if (!entries.length) return;
      db.prepare(`UPDATE api_calls SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`)
        .run(...entries.map(([, value]) => value ?? null), id);
    },
    list({ workflowId = '', state = '', before = 0, limit = 50 } = {}) {
      const clauses = [];
      const params = [];
      if (workflowId) { clauses.push('workflow_id = ?'); params.push(String(workflowId)); }
      if (['success', 'error', 'invalid', 'pending'].includes(state)) { clauses.push(`(${STATE_SQL}) = ?`); params.push(state); }
      if (Number(before) > 0) { clauses.push('sequence < ?'); params.push(Number(before)); }
      const count = Math.min(100, Math.max(1, Math.floor(Number(limit) || 50)));
      const rows = db.prepare(`SELECT ${SUMMARY_FIELDS}, ${STATE_SQL} AS state FROM api_calls
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY sequence DESC LIMIT ?`).all(...params, count + 1);
      return { records: rows.slice(0, count).map(decode), nextCursor: rows.length > count ? rows[count - 1].sequence : null };
    },
    get(id) { return decode(db.prepare(`SELECT *, ${STATE_SQL} AS state FROM api_calls WHERE id = ?`).get(id)); },
    close() { db.close(); },
  };
}

function getApiCallStore(directory = DEFAULT_DIRECTORY) {
  const key = path.resolve(directory);
  if (!stores.has(key)) stores.set(key, createApiCallStore({ directory: key }));
  return stores.get(key);
}

module.exports = { createApiCallStore, getApiCallStore, DEFAULT_DIRECTORY };
