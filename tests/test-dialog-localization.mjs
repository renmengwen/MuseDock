import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dialogPath = path.join(__dirname, '../frontend-react/src/components/ui/dialog.jsx');

assert.ok(fs.existsSync(dialogPath), 'missing shared dialog component');

const dialog = fs.readFileSync(dialogPath, 'utf-8');

assert.doesNotMatch(
  dialog,
  /<span className="sr-only">Close<\/span>/,
  'default dialog close button should not expose English sr-only text',
);
assert.doesNotMatch(
  dialog,
  /<Button variant="outline">Close<\/Button>/,
  'DialogFooter showCloseButton should not expose English button text',
);
assert.ok(dialog.includes('关闭'), 'shared dialog close copy should use Chinese text');

console.log('dialog localization tests passed');
