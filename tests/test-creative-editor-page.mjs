import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const editorPagePath = path.join(__dirname, '../frontend-react/src/pages/CreativeEditorPage.jsx');
const oneClickPagePath = path.join(__dirname, '../frontend-react/src/pages/OneClickCreativePage.jsx');
const appPath = path.join(__dirname, '../frontend-react/src/App.jsx');

assert.ok(fs.existsSync(editorPagePath), 'missing page frontend-react/src/pages/CreativeEditorPage.jsx');

const editorPage = fs.readFileSync(editorPagePath, 'utf-8');
const oneClickPage = fs.readFileSync(oneClickPagePath, 'utf-8');
const app = fs.readFileSync(appPath, 'utf-8');
const creativeVideoEditorImportPattern =
  /import\s+(?:\{[\s\S]*?\bCreativeVideoEditor\b[\s\S]*?\}|CreativeVideoEditor\b|[A-Za-z_$][\w$]*\s*,\s*\{[\s\S]*?\bCreativeVideoEditor\b[\s\S]*?\})\s+from\s+['"][^'"]+['"]/;
const routeTags = app.match(/<Route\b(?:(?!\/>)[\s\S])*?\/>/g) || [];
const editorRoute = routeTags.find(routeTag =>
  /\bpath=["']\/?editor\/:workflowId["']/.test(routeTag) &&
  /\belement=\{\s*<CreativeEditorPage\s*\/>\s*\}/.test(routeTag)
);

assert.match(editorPage, /export\s+function\s+CreativeEditorPage\s*\(\s*\)/, 'CreativeEditorPage should export a page component');
assert.match(editorPage, /useParams\(\)/, 'CreativeEditorPage should read workflowId from route params');
assert.match(editorPage, /api\.getCreativeWorkflow\(workflowId\)/, 'CreativeEditorPage should load the creative workflow by workflowId');
assert.ok(editorPage.includes('正在加载编辑任务'), 'CreativeEditorPage should show Chinese loading text');
assert.ok(editorPage.includes('缺少创作任务 ID。'), 'CreativeEditorPage should show Chinese missing id text');
assert.ok(editorPage.includes('未找到创作任务。'), 'CreativeEditorPage should show Chinese not found text');
assert.ok(editorPage.includes('<CreativeVideoEditor'), 'CreativeEditorPage should render CreativeVideoEditor');
assert.ok(editorPage.includes('workflowId={workflowId}'), 'CreativeEditorPage should pass workflowId to CreativeVideoEditor');
assert.ok(editorPage.includes('api={api}'), 'CreativeEditorPage should pass api to CreativeVideoEditor');
assert.ok(editorPage.includes('onRendered={loadWorkflow}'), 'CreativeEditorPage should reload the workflow after rendering');
assert.ok(
  editorPage.includes('navigate(`/creative/${encodeURIComponent(workflowId)}`)'),
  'CreativeEditorPage should navigate back to the creative detail route',
);
assert.doesNotMatch(editorPage, /\blocation\s*\??\.\s*state\b/, 'CreativeEditorPage should not depend on location state');
assert.doesNotMatch(editorPage, /\buseLocation\s*\(\s*\)\s*\??\.\s*state\b/, 'CreativeEditorPage should not read state from useLocation()');
assert.doesNotMatch(editorPage, /\{\s*state\s*\}\s*=\s*useLocation\s*\(/, 'CreativeEditorPage should not destructure state from useLocation()');
assert.doesNotMatch(editorPage, /\buseLocation\s*\(/, 'CreativeEditorPage should not call useLocation');
assert.doesNotMatch(
  editorPage,
  /import\s+\{[\s\S]*\buseLocation\b[\s\S]*\}\s+from\s+['"]react-router-dom['"]/,
  'CreativeEditorPage should not import useLocation from react-router-dom',
);

assert.ok(
  app.includes("import { CreativeEditorPage } from './pages/CreativeEditorPage.jsx';"),
  'App.jsx should import CreativeEditorPage',
);
assert.ok(
  editorRoute,
  'App.jsx should register the editor workflow route',
);

assert.ok(
  !oneClickPage.includes("from '../components/creative-video-editor/CreativeVideoEditor.jsx'"),
  'OneClickCreativePage should not import CreativeVideoEditor',
);
assert.doesNotMatch(oneClickPage, creativeVideoEditorImportPattern, 'OneClickCreativePage should not import CreativeVideoEditor from any path');
assert.ok(!oneClickPage.includes('<CreativeVideoEditor'), 'OneClickCreativePage should not render CreativeVideoEditor');
assert.ok(
  oneClickPage.includes('navigate(`/editor/${encodeURIComponent(workflowId)}`)'),
  'OneClickCreativePage should navigate to the editor route',
);

console.log('creative editor page tests passed');
