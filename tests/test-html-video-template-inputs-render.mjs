if (process.env.RUN_HTML_VIDEO_REAL_RENDER !== '1') {
  console.log('跳过 html-video 模板变量真实渲染 smoke：未设置 RUN_HTML_VIDEO_REAL_RENDER=1。');
  process.exit(0);
}

import assert from 'assert';
import { createRequire } from 'module';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { materializeProject } = require('../server/services/creative-video/html-video/materializer');

const registry = createTemplateRegistry();
registry.scanTemplates();

const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-template-inputs-render-'));
const project = {
  project_id: 'template-inputs-render-smoke',
  template_id: null,
  template_inputs: {},
  output: { width: 1920, height: 1080, fps: 30, duration: 8 },
  frames: [
    {
      id: 'pentagram',
      scene_id: 'pentagram',
      source_mode: 'template_inputs',
      template_id: 'frame-pentagram-stat',
      duration_sec: 4,
      inputs: {
        label: '测试标签',
        headline: '123.4',
        subtitle: '测试副标题已进入 DOM',
        anchor: '123',
        duration_sec: 4,
      },
    },
    {
      id: 'chart',
      scene_id: 'chart',
      source_mode: 'template_inputs',
      template_id: 'frame-data-chart-nyt',
      duration_sec: 4,
      inputs: {
        title: '测试图表标题',
        subtitle: '测试数据来源',
        data: [
          { label: '甲项', value: 10 },
          { label: '乙项', value: 24 },
        ],
        duration_sec: 4,
      },
    },
  ],
};

const materialized = await materializeProject({ projectDir, project, templateRegistry: registry });
assert.ok(materialized.diagnostics.some(item => item.frame_id === 'pentagram' && item.code === 'materialized'));
assert.ok(materialized.diagnostics.some(item => item.frame_id === 'chart' && item.code === 'materialized'));

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  const pentagram = materialized.project.frames.find(frame => frame.id === 'pentagram');
  await page.goto(pathToFileURL(path.join(projectDir, pentagram.html_path)).href);
  await page.waitForLoadState('load');
  assert.equal(await page.locator('[data-hv-bind="headline"]').innerText(), '123.4');

  const chart = materialized.project.frames.find(frame => frame.id === 'chart');
  await page.goto(pathToFileURL(path.join(projectDir, chart.html_path)).href);
  await page.waitForLoadState('load');
  assert.equal(await page.locator('[data-hv-bind="title"]').innerText(), '测试图表标题');
  const bodyText = await page.locator('body').innerText();
  assert.match(bodyText, /甲项/);
  assert.match(bodyText, /10/);

  await page.close();
} finally {
  await browser.close();
}

console.log('html-video template inputs render smoke passed');
