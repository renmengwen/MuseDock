const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { normalizeProject } = require('../server/services/creative-video/html-video/projectSchema');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { materializeProject } = require('../server/services/creative-video/html-video/materializer');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function createTemplate(rootDir) {
  const templateDir = path.join(rootDir, 'variable_title');
  await writeFile(path.join(templateDir, 'template.html-video.yaml'), [
    'id: variable_title',
    'name: 变量标题',
    'engine: hyperframes',
    'engine_version: "1.0.0"',
    'source_entry: source/index.html',
    'output:',
    '  resolution:',
    '    width: 1920',
    '    height: 1080',
    '  fps: 30',
    '  duration: 6',
    'inputs:',
    '  schema:',
    '    title:',
    '      type: string',
    '    subtitle:',
    '      type: string',
    '    duration_sec:',
    '      type: number',
    '  examples:',
    '    - title: 默认标题',
    '      subtitle: 默认副标题',
    '      duration_sec: 6',
    'preview:',
    '  poster: preview.png',
    'license:',
    '  commercial_use: true',
    'assets_attribution: []',
    '',
  ].join('\n'));
  await writeFile(path.join(templateDir, 'source/index.html'), [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="UTF-8"><title>{{title}}</title></head>',
    '<body>',
    '<h1 data-hv-element-id="title" data-hv-bind="title">{{title}}</h1>',
    '<p data-hv-element-id="subtitle" data-hv-bind="subtitle">{{subtitle}}</p>',
    '<span data-hv-element-id="duration" data-hv-bind="duration_sec">{{duration_sec}}</span>',
    '<script>',
    'const vars = window.__HV_VARS__ || {};',
    'const duration = Number(window.__HV_DURATION__ || vars.duration_sec || 6);',
    'document.querySelector("[data-hv-bind=title]").textContent = vars.title || "默认标题";',
    '</script>',
    '</body>',
    '</html>',
  ].join('\n'));
  return templateDir;
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-materializer-'));
  const templateRoot = path.join(rootDir, 'templates');
  const projectDir = path.join(rootDir, 'project');
  await fs.mkdir(projectDir, { recursive: true });
  await createTemplate(templateRoot);

  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();

  const project = normalizeProject({
    project_id: 'project_001',
    template_id: 'variable_title',
    template_inputs: {
      title: '全局标题',
      subtitle: '全局副标题',
      duration_sec: 6,
    },
    frames: [
      {
        id: 'scene_01',
        scene_id: 'scene_01',
        order: 1,
        template_id: 'variable_title',
        duration_sec: 4,
        inputs: {
          title: '安全标题 </script><script>window.__x=1</script>',
          subtitle: '<img src=x onerror=alert(1)>',
          duration_sec: 4,
        },
        metadata: {
          visual_text: {
            headline: '第一幕',
            cards: ['卡片一'],
            keywords: ['关键词一'],
          },
        },
      },
      {
        id: 'scene_02',
        scene_id: 'scene_02',
        order: 2,
        template_id: 'variable_title',
        duration_sec: 5,
        inputs: {
          title: '不应覆盖',
          subtitle: 'override 生效',
          duration_sec: 5,
        },
      },
    ],
    overrides: {
      html: {
        enabled: true,
        frames: {
          scene_02: {
            enabled: true,
            html_path: 'frames/custom_scene_02.html',
          },
        },
      },
    },
  });

  await writeFile(path.join(projectDir, 'frames/custom_scene_02.html'), '<html><body>用户改写</body></html>');

  const result = await materializeProject({ projectDir, project, templateRegistry });

  assert.equal(result.project.frames[0].html_path, 'frames/01-scene_01.html');
  assert.equal(result.project.frames[1].html_path, 'frames/custom_scene_02.html');
  assert.ok(result.diagnostics.some(item => item.code === 'html_override_active' && item.frame_id === 'scene_02'));

  const html = await fs.readFile(path.join(projectDir, result.project.frames[0].html_path), 'utf8');
  assert.ok(html.includes('<script>window.__HV_VARS__ = '));
  assert.ok(html.includes('window.__HV_DURATION__ = 4;'));
  assert.match(html, /window\.__HV_SCENE__/);
  assert.match(html, /"headline":"第一幕"/);
  assert.ok(html.includes('data-hv-element-id="title"'));
  assert.ok(html.includes('data-hv-bind="subtitle"'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!html.includes('</script><script>window.__x=1</script>'));
  assert.match(html, /"title":"安全标题 \\u003C\/script\\u003E\\u003Cscript\\u003Ewindow.__x=1\\u003C\/script\\u003E"/);
  assert.ok(html.includes('<title>安全标题 &lt;/script&gt;&lt;script&gt;window.__x=1&lt;/script&gt;</title>'));

  const overrideHtml = await fs.readFile(path.join(projectDir, 'frames/custom_scene_02.html'), 'utf8');
  assert.equal(overrideHtml, '<html><body>用户改写</body></html>');

  console.log('html-video materializer tests passed');
})();
