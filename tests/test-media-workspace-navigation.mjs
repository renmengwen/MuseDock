import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaWorkspacePath = path.join(__dirname, '../frontend-react/src/pages/MediaWorkspace.jsx');
const mediaPanelPath = path.join(__dirname, '../frontend-react/src/components/MediaPanel.jsx');

const workspaceSource = fs.readFileSync(mediaWorkspacePath, 'utf-8');
const panelSource = fs.readFileSync(mediaPanelPath, 'utf-8');

assert.match(workspaceSource, /function\s+goToHyperframesStudio\s*\(/, 'MediaWorkspace should expose a handler for opening the advanced video page');
assert.match(
  workspaceSource,
  /navigate\(`\/hyperframes-freeform\/\$\{encodeURIComponent\(selectedAwemeId\)\}`\)/,
  'MediaWorkspace should navigate to the advanced video page with the current aweme_id',
);
assert.match(panelSource, /onGoToHyperframesStudio/, 'MediaPanel should accept the advanced video navigation callback');
assert.match(panelSource, /打开高级成片/, 'MediaPanel should render an advanced video button');

console.log('media workspace navigation tests passed');
