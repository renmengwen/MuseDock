import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaWorkspacePath = path.join(__dirname, '../frontend-react/src/pages/MediaWorkspace.jsx');
const mediaPanelPath = path.join(__dirname, '../frontend-react/src/components/MediaPanel.jsx');
const appShellPath = path.join(__dirname, '../frontend-react/src/components/AppShell.jsx');

const workspaceSource = fs.readFileSync(mediaWorkspacePath, 'utf-8');
const panelSource = fs.readFileSync(mediaPanelPath, 'utf-8');
const appShellSource = fs.readFileSync(appShellPath, 'utf-8');

function stripJsxComments(source) {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

assert.match(workspaceSource, /function\s+goToHyperframesStudio\s*\(/, 'MediaWorkspace should expose a handler for opening the advanced video page');
assert.match(
  workspaceSource,
  /navigate\(`\/hyperframes-freeform\/\$\{encodeURIComponent\(selectedAwemeId\)\}`\)/,
  'MediaWorkspace should navigate to the advanced video page with the current aweme_id',
);
assert.match(panelSource, /onGoToHyperframesStudio/, 'MediaPanel should accept the advanced video navigation callback');
assert.match(panelSource, /打开高级成片/, 'MediaPanel should render an advanced video button');

assert.match(appShellSource, /\{\/\*[\s\S]*<NavLink[^>]*to="\/ai"[\s\S]*\*\/\}/, 'AppShell should keep the AI workspace tab code commented for later restore');
assert.doesNotMatch(stripJsxComments(appShellSource), /<NavLink[^>]*to="\/ai"/, 'AppShell should not render the AI workspace tab');
assert.match(panelSource, /\{\/\*[\s\S]*onClick=\{onGoToAiWorkspace\}[\s\S]*\*\/\}/, 'MediaPanel should keep the AI workspace entry code commented for later restore');
assert.doesNotMatch(stripJsxComments(panelSource), /onClick=\{onGoToAiWorkspace\}/, 'MediaPanel should not render the AI workspace entry');

console.log('media workspace navigation tests passed');
