const assert = require('assert');
const path = require('path');
const { resolveFrameRenderSource } = require('../server/services/creative-video/html-video/frameRenderSource');

const projectDir = path.resolve(__dirname, '..', 'tmp-html-video-render-source');

{
  const source = resolveFrameRenderSource({
    projectDir,
    project: { template_id: 'tpl', template_inputs: { brand: 'A' } },
    frame: {
      id: 'scene_01',
      source_mode: 'raw_html',
      html_path: 'frames/01-scene_01.html',
      duration_sec: 5,
      inputs: { tone: 'bold' },
    },
  });
  assert.equal(source.source_mode, 'raw_html');
  assert.equal(source.engine, 'hyperframes-playwright');
  assert.equal(source.duration_sec, 5);
  assert.equal(source.html_path, 'frames/01-scene_01.html');
  assert.equal(source.absolute_html_path, path.join(projectDir, 'frames', '01-scene_01.html'));
  assert.equal(source.needs_materialize, false);
}

{
  const source = resolveFrameRenderSource({
    projectDir,
    project: { template_id: 'tpl' },
    frame: {
      id: 'scene_camel',
      source_mode: 'raw_html',
      html_path: undefined,
      htmlPath: 'frames/02-scene_camel.html',
    },
  });
  assert.equal(source.source_mode, 'raw_html');
  assert.equal(source.html_path, 'frames/02-scene_camel.html');
  assert.equal(source.absolute_html_path, path.join(projectDir, 'frames', '02-scene_camel.html'));
}

assert.throws(() => resolveFrameRenderSource({
  projectDir,
  project: { template_id: 'tpl' },
  frame: {
    id: 'scene_undefined',
    source_mode: 'raw_html',
    html_path: undefined,
    htmlPath: null,
    sourcePath: undefined,
  },
}), /缺少 html_path/);

assert.throws(() => resolveFrameRenderSource({
  projectDir,
  project: { template_id: 'tpl' },
  frame: {
    id: 'scene_absolute_html_path',
    source_mode: 'raw_html',
    html_path: path.join(projectDir, '..', 'absolute-html-path.html'),
  },
}), /不能逃逸工程目录/);

assert.throws(() => resolveFrameRenderSource({
  projectDir,
  project: { template_id: 'tpl' },
  frame: {
    id: 'scene_absolute_htmlPath',
    source_mode: 'raw_html',
    htmlPath: path.join(projectDir, '..', 'absolute-htmlPath.html'),
  },
}), /不能逃逸工程目录/);

{
  const absoluteSourcePath = path.join(projectDir, 'external', 'absolute.html');
  const source = resolveFrameRenderSource({
    project: { template_id: 'tpl' },
    frame: {
      id: 'scene_abs',
      source_mode: 'raw_html',
      sourcePath: absoluteSourcePath,
    },
  });
  assert.equal(source.source_mode, 'raw_html');
  assert.equal(source.absolute_html_path, absoluteSourcePath);
}

{
  const source = resolveFrameRenderSource({
    projectDir,
    project: { template_id: 'tpl', template_inputs: { brand: 'A', headline: '旧标题' } },
    frame: {
      id: 'scene_02',
      source_mode: 'template_inputs',
      duration_sec: 4,
      inputs: { headline: '标题' },
    },
  });
  assert.equal(source.source_mode, 'template_inputs');
  assert.equal(source.template_id, 'tpl');
  assert.equal(source.variables.brand, 'A');
  assert.equal(source.variables.headline, '标题');
  assert.equal(source.needs_materialize, true);
}

assert.throws(() => resolveFrameRenderSource({
  project: {},
  frame: { id: 'relative', source_mode: 'raw_html', html_path: 'frames/relative.html' },
}), /相对路径需要 projectDir/);

assert.throws(() => resolveFrameRenderSource({
  projectDir,
  project: {},
  frame: { id: 'blank', source_mode: 'raw_html', html_path: '   ' },
}), /缺少 html_path/);

assert.throws(() => resolveFrameRenderSource({
  projectDir,
  project: {},
  frame: { id: 'bad', source_mode: 'raw_html', html_path: '../bad.html' },
}), /不能逃逸工程目录/);

console.log('html-video frame render source tests passed');
