const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

const routePath = path.join(__dirname, '../server/routes/config.js');
const source = fs.readFileSync(routePath, 'utf-8');

assert.match(source, /require\(['"]\.\.\/services\/appSettings['"]\)/, 'config route should require appSettings');
assert.match(source, /async function getAppSettingsRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define getAppSettingsRoute');
assert.match(source, /async function saveAppSettingsRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define saveAppSettingsRoute');
assert.match(source, /async function getConfigSystemHealthRoute\s*\(\s*req\s*,\s*res\s*\)/, 'config route should define getConfigSystemHealthRoute');
assert.match(source, /router\.get\(['"]\/app-settings['"]\s*,\s*getAppSettingsRoute\s*\)/, 'config route should mount GET /app-settings');
assert.match(source, /router\.post\(['"]\/app-settings['"]\s*,\s*saveAppSettingsRoute\s*\)/, 'config route should mount POST /app-settings');
assert.match(source, /router\.get\(['"]\/system-health['"]\s*,\s*getConfigSystemHealthRoute\s*\)/, 'config route should mount GET /system-health');

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
  const systemMaintenance = require('../server/services/systemMaintenance');
  const originals = {
    getPublicConfig: appSettings.getPublicConfig,
    saveConfig: appSettings.saveConfig,
    getCreativeDefaults: appSettings.getCreativeDefaults,
    getSystemHealth: systemMaintenance.getSystemHealth,
  };
  const savedPayloads = [];
  const healthCalls = [];

  appSettings.getPublicConfig = async () => ({
    version: 1,
    creativeDefaults: { aspectRatio: '16:9' },
    system: { skipValidation: false, pexelsApiKey: 'pexels-route-key' },
  });
  appSettings.saveConfig = async payload => {
    savedPayloads.push(payload);
    return {
      version: 1,
      creativeDefaults: { aspectRatio: payload.creativeDefaults.aspectRatio },
      system: { skipValidation: payload.system.skipValidation, pexelsApiKey: payload.system.pexelsApiKey || '' },
    };
  };
  appSettings.getCreativeDefaults = async () => ({ aspectRatio: '16:9' });
  systemMaintenance.getSystemHealth = async options => {
    healthCalls.push(options);
    return { environment: { ok: true }, models: {}, storage: {} };
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
        system: { skipValidation: false, pexelsApiKey: 'pexels-route-key' },
      },
    });

    const settingsPayload = {
      creativeDefaults: { aspectRatio: '1:1' },
      system: { skipValidation: true, pexelsApiKey: 'pexels-save-key' },
    };
    const saveSettings = await requestJson(server, 'POST', '/api/config/app-settings', settingsPayload);
    assert.strictEqual(saveSettings.status, 200);
    assert.deepStrictEqual(savedPayloads, [settingsPayload]);
    assert.deepStrictEqual(saveSettings.body, {
      success: true,
      data: {
        version: 1,
        creativeDefaults: { aspectRatio: '1:1' },
        system: { skipValidation: true, pexelsApiKey: 'pexels-save-key' },
      },
    });

    const health = await requestJson(server, 'GET', '/api/config/system-health?refresh=1');
    assert.strictEqual(health.status, 200);
    assert.deepStrictEqual(healthCalls, [{ refresh: true }]);
    assert.deepStrictEqual(health.body, {
      success: true,
      data: { environment: { ok: true }, models: {}, storage: {} },
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    appSettings.getPublicConfig = originals.getPublicConfig;
    appSettings.saveConfig = originals.saveConfig;
    appSettings.getCreativeDefaults = originals.getCreativeDefaults;
    systemMaintenance.getSystemHealth = originals.getSystemHealth;
    delete require.cache[require.resolve('../server/routes/config')];
  }
}

runIntegrationTests().then(() => {
  console.log('config settings route tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
