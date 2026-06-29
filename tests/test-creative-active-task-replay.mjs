import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(__dirname, '..', 'frontend-react', 'src', 'pages', 'OneClickCreativePage.jsx'), 'utf8');
const normalizedPage = page.replace(/\r\n/g, '\n');

const recoveryStart = normalizedPage.indexOf('const stored = loadActiveCreativeTask();');
const recoveryEnd = normalizedPage.indexOf('useEffect(() => {\n    if (status !== \'polling\'', recoveryStart);
assert.ok(recoveryStart > 0 && recoveryEnd > recoveryStart, 'OneClickCreativePage should recover an active task stream after refresh');

const recoveryBlock = normalizedPage.slice(recoveryStart, recoveryEnd);
assert.match(
  recoveryBlock,
  /subscribeTaskEvents\(\s*\{ workflow_id: stored\.workflow_id, task_id: stored\.task_id \},\s*\{ sinceSeq: 0 \},\s*\)/,
  'Refreshing a running creative task should replay task events so detailed progress is restored',
);
assert.doesNotMatch(
  recoveryBlock,
  /sinceSeq:\s*normalizeLastSeq\(stored\.last_seq\)/,
  'Refresh recovery should not skip historical progress events by resuming from stored last_seq',
);

console.log('creative active task replay tests passed');
