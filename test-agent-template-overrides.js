const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const overrides = require('./server/services/agentTemplateOverrides');

(async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-template-overrides-'));

  const list = await overrides.listTaskAgentConfigs({ rootDir });
  assert.ok(list.data.some(item => item.id === 'viral_rewrite'));
  assert.equal(list.data.find(item => item.id === 'viral_rewrite').source, 'default');

  const detail = await overrides.getTaskAgentConfig('viral_rewrite', { rootDir });
  assert.equal(detail.success, true);
  assert.equal(detail.data.id, 'viral_rewrite');
  assert.ok(detail.data.systemPrompt.includes('MuseDock'));

  const invalid = await overrides.saveTaskAgentConfig('viral_rewrite', {
    systemPrompt: '',
    userPromptTemplate: 'hello',
    modelOptions: { temperature: 0.4, stream: true, maxRetries: 1 },
  }, { rootDir });
  assert.equal(invalid.success, false);
  assert.match(invalid.message, /system prompt/);

  const saved = await overrides.saveTaskAgentConfig('viral_rewrite', {
    systemPrompt: '系统：只输出 JSON。',
    userPromptTemplate: '标题：{{videoTitle}}\n正文：{{transcriptText}}',
    resultSchema: { summary: 'string' },
    modelOptions: { temperature: 0.2, stream: false, maxRetries: 2 },
  }, { rootDir });
  assert.equal(saved.success, true);
  assert.equal(saved.data.source, 'override');
  assert.equal(saved.data.modelOptions.temperature, 0.2);

  const mergedRequest = await overrides.resolveTaskAgentConfig('viral_rewrite', {
    agentConfigOverride: {
      systemPrompt: '临时系统',
      userPromptTemplate: '临时 {{videoTitle}}',
      modelOptions: { temperature: 0.7 },
    },
    rootDir,
  });
  assert.equal(mergedRequest.source, 'request');
  assert.equal(mergedRequest.systemPrompt, '临时系统');
  assert.equal(mergedRequest.modelOptions.temperature, 0.7);
  assert.equal(mergedRequest.modelOptions.stream, false);

  const messages = overrides.buildMessagesFromTemplate({
    systemPrompt: '系统',
    userPromptTemplate: '标题：{{videoTitle}}\n未知：{{missing}}\n{{promptOptionsText}}',
  }, {
    videoTitle: '测试标题',
    promptOptionsText: '补充 brief',
  });
  assert.deepEqual(messages, [
    { role: 'system', content: '系统' },
    { role: 'user', content: '标题：测试标题\n未知：\n补充 brief' },
  ]);

  const cleared = await overrides.clearTaskAgentOverride('viral_rewrite', { rootDir });
  assert.equal(cleared.success, true);
  const afterClear = await overrides.getTaskAgentConfig('viral_rewrite', { rootDir });
  assert.equal(afterClear.data.source, 'default');

  const storyboard = await overrides.getStoryboardAgentConfig({ rootDir });
  assert.equal(storyboard.success, true);
  assert.equal(storyboard.data.source, 'default');
  assert.ok(storyboard.data.systemPrompt.includes('MuseDock'));

  const savedStoryboard = await overrides.saveStoryboardAgentConfig({
    systemPrompt: '分镜系统',
    userPromptTemplate: '脚本：{{rewriteScript}}\n字幕：{{captionIndexesJson}}',
    useFrameProfile: false,
    modelOptions: { temperature: 0.3, stream: true, maxRetries: 1 },
  }, { rootDir });
  assert.equal(savedStoryboard.success, true);
  assert.equal(savedStoryboard.data.source, 'override');
  assert.equal(savedStoryboard.data.useFrameProfile, false);

  console.log('agent template override tests passed');
})();
