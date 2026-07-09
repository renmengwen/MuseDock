const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appSettings = require('../server/services/appSettings');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-settings-test-'));
  const configPath = path.join(root, 'config', 'app-settings.json');
  const aiConfigPath = path.join(root, 'config', 'ai-models.json');

  const defaults = await appSettings.getPublicConfig({ configPath, aiConfigPath });
  assert.strictEqual(defaults.version, 1);
  assert.deepStrictEqual(defaults.creativeDefaults, {
    aspectRatio: '9:16',
    targetDurationSec: 60,
    templateByAspectRatio: {
      '9:16': 'news_signal_vertical',
      '16:9': 'bold_signal',
      '1:1': '',
      '4:5': '',
    },
    lockTemplate: false,
    useResearch: true,
    generateAudio: true,
    autoSfxEnabled: true,
    generateCaptions: true,
    emotionalVoice: false,
    sourceImageAnalysisEnabled: false,
    extractDouyinFrames: false,
    visualStrategy: 'hf_first',
    frameHtmlConcurrency: 1,
  });
  assert.strictEqual(defaults.creativeDefaults.templateByAspectRatio['9:16'], 'news_signal_vertical');
  assert.strictEqual(defaults.creativeDefaults.useResearch, true);
  assert.deepStrictEqual(defaults.system, { skipValidation: false, pexelsApiKey: '' });
  assert.strictEqual(await appSettings.hasConfig({ configPath }), false);

  const saved = await appSettings.saveConfig({
    version: 99,
    creativeDefaults: {
      aspectRatio: '3:2',
      targetDurationSec: 999,
      templateByAspectRatio: {
        '9:16': ' vertical-template ',
        '16:9': 123,
        '1:1': 'square-template',
        '4:5': ' portrait-template ',
        '3:2': 'ignored-template',
      },
      lockTemplate: true,
      useResearch: false,
      generateAudio: false,
      autoSfxEnabled: false,
      generateCaptions: false,
      emotionalVoice: true,
      sourceImageAnalysisEnabled: true,
      extractDouyinFrames: true,
      visualStrategy: 'asset_first',
      frameHtmlConcurrency: 99,
    },
    system: {
      skipValidation: true,
      pexelsApiKey: ' pexels-test-key ',
    },
  }, { configPath, aiConfigPath });

  assert.strictEqual(saved.version, 1);
  assert.deepStrictEqual(saved.creativeDefaults, {
    aspectRatio: '9:16',
    targetDurationSec: 180,
    templateByAspectRatio: {
      '9:16': 'vertical-template',
      '16:9': '',
      '1:1': 'square-template',
      '4:5': 'portrait-template',
    },
    lockTemplate: true,
    useResearch: false,
    generateAudio: false,
    autoSfxEnabled: false,
    generateCaptions: false,
    emotionalVoice: true,
    sourceImageAnalysisEnabled: true,
    extractDouyinFrames: true,
    visualStrategy: 'asset_first',
    frameHtmlConcurrency: 5,
  });
  assert.deepStrictEqual(saved.system, { skipValidation: true, pexelsApiKey: 'pexels-test-key' });
  assert.equal(await appSettings.getPexelsApiKey({ configPath, aiConfigPath }), 'pexels-test-key');
  assert.deepStrictEqual(readJson(configPath), saved);
  assert.strictEqual(await appSettings.hasConfig({ configPath }), true);

  await fs.promises.writeFile(configPath, JSON.stringify({
    version: 1,
    creativeDefaults: {},
    system: { skipValidation: false, pexelsApiKey: 'pexels-app-key' },
  }, null, 2), 'utf-8');

  const effectiveFromAppSettings = await appSettings.getEffectiveSystemSettings({ configPath, aiConfigPath });
  assert.deepStrictEqual(effectiveFromAppSettings, {
    skipValidation: false,
    pexelsApiKey: 'pexels-app-key',
    source: 'app-settings',
  });

  await fs.promises.unlink(configPath);
  await fs.promises.mkdir(path.dirname(aiConfigPath), { recursive: true });
  await fs.promises.writeFile(aiConfigPath, JSON.stringify({ skipValidation: true }, null, 2), 'utf-8');
  const effectiveFromLegacy = await appSettings.getEffectiveSystemSettings({ configPath, aiConfigPath });
  assert.deepStrictEqual(effectiveFromLegacy, {
    skipValidation: true,
    source: 'legacy-ai-models',
  });

  const firstSaved = await appSettings.saveConfig({
    creativeDefaults: {},
  }, { configPath, aiConfigPath });
  assert.deepStrictEqual(firstSaved.system, { skipValidation: true, pexelsApiKey: '' });

  const effectiveAfterFirstSave = await appSettings.getEffectiveSystemSettings({ configPath, aiConfigPath });
  assert.deepStrictEqual(effectiveAfterFirstSave, {
    skipValidation: true,
    pexelsApiKey: '',
    source: 'app-settings',
  });

  await fs.promises.writeFile(configPath, '{ bad json', 'utf-8');
  const afterCorruptRead = await appSettings.getPublicConfig({ configPath, aiConfigPath });
  assert.deepStrictEqual(afterCorruptRead, appSettings.DEFAULT_CONFIG);
  assert.strictEqual(fs.readFileSync(configPath, 'utf-8'), '{ bad json');

  assert.equal(appSettings.normalizeCreativeDefaults({}).generateAudio, true);
  assert.equal(appSettings.normalizeCreativeDefaults({}).generateCaptions, true);
  assert.equal(appSettings.normalizeCreativeDefaults({}).emotionalVoice, false);
  assert.equal(appSettings.normalizeCreativeDefaults({}).sourceImageAnalysisEnabled, false);
  assert.equal(appSettings.normalizeCreativeDefaults({}).extractDouyinFrames, false);
  assert.equal(appSettings.normalizeCreativeDefaults({}).visualStrategy, 'hf_first');
  assert.equal(appSettings.normalizeCreativeDefaults({ visualStrategy: 'asset_first' }).visualStrategy, 'asset_first');
  assert.equal(appSettings.normalizeCreativeDefaults({ visualStrategy: 'banana' }).visualStrategy, 'hf_first');
  assert.equal(appSettings.normalizeCreativeDefaults({}).frameHtmlConcurrency, 1);
  assert.equal(appSettings.normalizeCreativeDefaults({ generateAudio: false }).generateAudio, false);
  assert.equal(appSettings.normalizeCreativeDefaults({ generateCaptions: false }).generateCaptions, false);
  assert.equal(appSettings.normalizeCreativeDefaults({ emotionalVoice: true }).emotionalVoice, true);
  assert.equal(appSettings.normalizeCreativeDefaults({ sourceImageAnalysisEnabled: true }).sourceImageAnalysisEnabled, true);
  assert.equal(appSettings.normalizeCreativeDefaults({ sourceImageAnalysisEnabled: 'true' }).sourceImageAnalysisEnabled, false);
  assert.equal(appSettings.normalizeCreativeDefaults({ extractDouyinFrames: true }).extractDouyinFrames, true);
  assert.equal(appSettings.normalizeCreativeDefaults({ extractDouyinFrames: 'true' }).extractDouyinFrames, false);
  assert.equal(appSettings.normalizeCreativeDefaults({ frameHtmlConcurrency: 0 }).frameHtmlConcurrency, 1);
  assert.equal(appSettings.normalizeCreativeDefaults({ frameHtmlConcurrency: 3.6 }).frameHtmlConcurrency, 4);
  assert.equal(appSettings.normalizeCreativeDefaults({ frameHtmlConcurrency: 9 }).frameHtmlConcurrency, 5);
  assert.equal(appSettings.normalizeCreativeDefaults({}).autoSfxEnabled, true);
  assert.equal(appSettings.normalizeCreativeDefaults({ autoSfxEnabled: false }).autoSfxEnabled, false);
  assert.equal(appSettings.normalizeCreativeDefaults({ autoSfxEnabled: 'false' }).autoSfxEnabled, true);
}

run().then(() => {
  console.log('app settings tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
