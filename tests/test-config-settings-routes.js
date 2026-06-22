const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

const routePath = path.join(__dirname, '../server/routes/config.js');
const source = fs.readFileSync(routePath, 'utf-8');

assert.match(source, /require\(['"]\.\.\/services\/appSettings['"]\)/, 'config route should require appSettings');
assert.match(source, /require\(['"]\.\.\/services\/creative-video\/html-video\/templateRegistry['"]\)/, 'config route should require html-video template registry');
assert.match(source, /async function getAppSettingsRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define getAppSettingsRoute');
assert.match(source, /async function saveAppSettingsRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define saveAppSettingsRoute');
assert.match(source, /async function getConfigTemplatesRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define getConfigTemplatesRoute');
assert.match(source, /router\.get\(['"]\/app-settings['"]\s*,\s*getAppSettingsRoute\s*\)/, 'config route should mount GET /app-settings');
assert.match(source, /router\.post\(['"]\/app-settings['"]\s*,\s*saveAppSettingsRoute\s*\)/, 'config route should mount POST /app-settings');
assert.match(source, /router\.get\(['"]\/templates['"]\s*,\s*getConfigTemplatesRoute\s*\)/, 'config route should mount GET /templates');

async function listen(app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function requestJson(server, method, pathname, body) {
  const address = server.address();
  const response = await fetch(`http://${address.address}:${address.port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function runIntegrationTests() {
  const appSettings = require('../server/services/appSettings');
  const templateRegistry = require('../server/services/creative-video/html-video/templateRegistry');
  const originals = {
    getPublicConfig: appSettings.getPublicConfig,
    saveConfig: appSettings.saveConfig,
    getCreativeDefaults: appSettings.getCreativeDefaults,
    scanTemplateManifests: templateRegistry.scanTemplateManifests,
    validateTemplateCompatibility: templateRegistry.validateTemplateCompatibility,
  };
  const savedPayloads = [];
  const compatibilityCalls = [];
  let scannedRootDir = '';

  appSettings.getPublicConfig = async () => ({
    version: 1,
    creativeDefaults: { aspectRatio: '16:9' },
    system: { skipValidation: false },
  });
  appSettings.saveConfig = async payload => {
    savedPayloads.push(payload);
    return {
      version: 1,
      creativeDefaults: { aspectRatio: payload.creativeDefaults.aspectRatio },
      system: { skipValidation: payload.system.skipValidation },
    };
  };
  appSettings.getCreativeDefaults = async () => ({ aspectRatio: '16:9' });
  templateRegistry.scanTemplateManifests = rootDir => {
    scannedRootDir = rootDir;
    return [
      {
        id: 'wide-news',
        name: '横版资讯',
        description: '横版视频模板',
        category: 'news',
        tags: ['news', 'wide'],
        engine: 'hyperframes',
        output: { aspect: '16:9', duration_sec: 30 },
        source_entry: 'index.html',
        license: { name: 'MIT', commercial_use: true },
      },
      {
        id: 'vertical-news',
        name: '竖版资讯',
        engine: 'hyperframes',
        output: { aspect: '9:16', duration_sec: 60 },
        source_entry: 'index.html',
        license: { name: 'MIT', commercial_use: true },
      },
    ];
  };
  templateRegistry.validateTemplateCompatibility = (manifest, options) => {
    compatibilityCalls.push({ id: manifest.id, options });
    if (manifest.id === 'wide-news') {
      return { ok: true, reasons: [] };
    }
    return {
      ok: false,
      reasons: [{ field: 'aspect', code: 'unsupported-aspect', message: '模板不支持目标画幅' }],
    };
  };

  delete require.cache[require.resolve('../server/routes/config')];
  const router = require('../server/routes/config');
  const app = express();
  app.use(express.json());
  app.use('/api/config', router);
  const server = await listen(app);

  try {
    const getSettings = await requestJson(server, 'GET', '/api/config/app-settings');
    assert.strictEqual(getSettings.status, 200);
    assert.deepStrictEqual(getSettings.body, {
      success: true,
      data: {
        version: 1,
        creativeDefaults: { aspectRatio: '16:9' },
        system: { skipValidation: false },
      },
    });

    const settingsPayload = {
      creativeDefaults: { aspectRatio: '1:1' },
      system: { skipValidation: true },
    };
    const saveSettings = await requestJson(server, 'POST', '/api/config/app-settings', settingsPayload);
    assert.strictEqual(saveSettings.status, 200);
    assert.deepStrictEqual(savedPayloads, [settingsPayload]);
    assert.deepStrictEqual(saveSettings.body, {
      success: true,
      data: {
        version: 1,
        creativeDefaults: { aspectRatio: '1:1' },
        system: { skipValidation: true },
      },
    });

    const templates = await requestJson(server, 'GET', '/api/config/templates');
    assert.strictEqual(templates.status, 200);
    assert.strictEqual(scannedRootDir, templateRegistry.DEFAULT_ROOT_DIR);
    assert.deepStrictEqual(compatibilityCalls, [
      { id: 'wide-news', options: { aspectRatio: '16:9' } },
      { id: 'vertical-news', options: { aspectRatio: '16:9' } },
    ]);
    assert.deepStrictEqual(templates.body, {
      success: true,
      data: [
        {
          id: 'wide-news',
          name: '横版资讯',
          description: '横版视频模板',
          category: 'news',
          tags: ['news', 'wide'],
          engine: 'hyperframes',
          mapped_engine: 'hyperframes-playwright',
          aspect_ratio: '16:9',
          duration_sec: 30,
          source_entry: 'index.html',
          license: { name: 'MIT', commercial_use: true },
          compatible: true,
          compatibility_reasons: [],
        },
        {
          id: 'vertical-news',
          name: '竖版资讯',
          description: '',
          category: '',
          tags: [],
          engine: 'hyperframes',
          mapped_engine: 'hyperframes-playwright',
          aspect_ratio: '9:16',
          duration_sec: 60,
          source_entry: 'index.html',
          license: { name: 'MIT', commercial_use: true },
          compatible: false,
          compatibility_reasons: [{ field: 'aspect', code: 'unsupported-aspect', message: '模板不支持目标画幅' }],
        },
      ],
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    appSettings.getPublicConfig = originals.getPublicConfig;
    appSettings.saveConfig = originals.saveConfig;
    appSettings.getCreativeDefaults = originals.getCreativeDefaults;
    templateRegistry.scanTemplateManifests = originals.scanTemplateManifests;
    templateRegistry.validateTemplateCompatibility = originals.validateTemplateCompatibility;
    delete require.cache[require.resolve('../server/routes/config')];
  }
}

runIntegrationTests().then(() => {
  console.log('config settings route tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
