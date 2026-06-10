const assert = require('assert');
const storyboardAgent = require('../server/services/storyboardAgent');

async function run() {
  const messages = storyboardAgent.buildStoryboardMessages({
    rewriteScript: 'test script',
    captions: [{ index: 1, start: 0, end: 2, duration: 2, text: 'first line' }],
    phraseCaptions: [
      { id: 'cap-1-p1', caption_index: 1, text: '输入是什么', start: 0, end: 1 },
      { id: 'cap-1-p2', caption_index: 1, text: '输出是什么', start: 1, end: 2 },
    ],
    videoBrief: {
      target_duration_sec: 60,
      target_word_count: 220,
      tone: '知识科普',
      hook: '先拆误解',
      beats: [
        { purpose: 'hook', summary: '开场问题', duration_sec: 5, visual_intent: '强对比' },
      ],
    },
    storyboardOptions: {
      visualStyle: 'business style',
      pacing: 'fast',
      captionStyle: 'large captions',
      backgroundDirection: 'abstract data background',
      primaryColor: '#fe2c55',
      forbidden: 'no real people, no original video frames',
      extraRequirements: 'short headlines',
    },
  });

  assert.match(messages[0].content, /HyperFrames/);
  assert.match(messages[0].content, /DOM\/CSS\/GSAP/);
  assert.match(messages[0].content, /不是图片生成模型/);
  assert.match(messages[1].content, /AI_STORYBOARD_TARGET=hyperframes/);
  assert.match(messages[1].content, /AI_STORYBOARD_COVER_ALL_CAPTIONS=true/);
  assert.match(messages[1].content, /visual_scene/);
  assert.match(messages[1].content, /visual_scene\.beats/);
  assert.match(messages[1].content, /caption_sync/);
  assert.match(messages[1].content, /短语字幕块/);
  assert.match(messages[1].content, /cap-1-p1/);
  assert.match(messages[1].content, /caption_block_id/);
  assert.match(messages[1].content, /formula_build/);
  assert.match(messages[1].content, /process_flow/);
  assert.match(messages[1].content, /code_walkthrough/);
  assert.match(messages[1].content, /timeline_sync/);
  assert.match(messages[1].content, /checklist_pipeline/);
  assert.match(messages[1].content, /逐步构建/);
  assert.match(messages[1].content, /workflow/);
  assert.match(messages[1].content, /code_panel/);
  assert.match(messages[1].content, /ui_mockup/);
  assert.match(messages[1].content, /split_compare/);
  assert.match(messages[1].content, /concept_map/);
  assert.match(messages[1].content, /timeline/);
  assert.match(messages[1].content, /quote_burst/);
  assert.match(messages[1].content, /自动选择 visual_type/);
  assert.match(messages[1].content, /视频结构 brief/);
  assert.match(messages[1].content, /target_duration_sec/);
  assert.match(messages[1].content, /开场问题/);
  assert.match(messages[1].content, /headline[\s\S]*完整字幕/);
  assert.match(messages[1].content, /emphasis_words[\s\S]*短语卡片/);
  assert.match(messages[1].content, /contrast_card[\s\S]*真实对比/);
  assert.match(messages[1].content, /A vs B/);
  assert.match(messages[1].content, /Frame Profile：creative_brutalist/);
  assert.doesNotMatch(messages[1].content, /tech_neon/);
  assert.match(messages[1].content, /完整 Frame\.md 参考/);
  assert.match(messages[1].content, /Creative Mode/);
  assert.match(messages[1].content, /warm cream canvas/);
  assert.match(messages[1].content, /4px ink/);
  assert.match(messages[1].content, /hard offset shadows/);
  assert.match(messages[1].content, /Motion is out of scope/);
  assert.match(messages[1].content, /text_card.*核心观点/);
  assert.match(messages[1].content, /contrast_card.*对比/);
  assert.match(messages[1].content, /AI 必须根据每个 scene 的语义任务自动抉择 visual_type/);
  assert.match(messages[1].content, /不要按固定优先级选择 visual_type/);
  assert.doesNotMatch(messages[1].content, /visual_type 优先/);
  assert.match(messages[1].content, /no blur/);
  assert.match(messages[1].content, /rounded: "0"/);
  assert.match(messages[1].content, /DOM\/CSS\/GSAP/);
  assert.match(messages[1].content, /Frame\.md 只能作为视觉设计参考/);
  assert.match(messages[1].content, /business style/);
  assert.match(messages[1].content, /abstract data background/);
  assert.match(messages[1].content, /no real people/);
  assert.match(messages[1].content, /"index": 1/);
  assert.match(messages[1].content, /"text": "first line"/);
  assert.doesNotMatch(messages[1].content, /"start"/);
  assert.doesNotMatch(messages[1].content, /"end"/);
  assert.doesNotMatch(messages[1].content, /"duration"/);
  assert.match(messages[0].content, /start/);

  const dirtyBriefText = storyboardAgent.formatVideoBriefForPrompt({
    target_duration_sec: 'abc',
    target_word_count: 'bad',
    tone: 123,
    hook: null,
    beats: [null, 'x', { purpose: 12, summary: null, duration_sec: 'bad', visual_intent: 34 }],
  });
  assert.doesNotMatch(dirtyBriefText, /NaN/);
  assert.doesNotMatch(dirtyBriefText, /null/);
  assert.match(dirtyBriefText, /目标时长 target_duration_sec：60 秒/);
  assert.match(dirtyBriefText, /目标字数 target_word_count：220 字/);
  assert.match(dirtyBriefText, /"purpose": "12"/);
  assert.match(dirtyBriefText, /"visual_intent": "34"/);

  const editableStoryboard = storyboardAgent.getEditableStoryboardTemplate();
  assert.ok(editableStoryboard.systemPrompt.includes('MuseDock'));
  assert.ok(editableStoryboard.userPromptTemplate.includes('{{rewriteScript}}'));
  assert.equal(editableStoryboard.useFrameProfile, true);
  assert.equal(editableStoryboard.modelOptions.temperature, 0.35);
  assert.equal(editableStoryboard.modelOptions.maxRetries, 3);

  const customResult = await storyboardAgent.createStoryboard({
    rewriteScript: '第一句。第二句。',
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '第一句。' },
      { index: 2, start: 1, end: 2, duration: 1, text: '第二句。' },
    ],
    editableConfig: {
      source: 'request',
      systemPrompt: '自定义分镜系统',
      userPromptTemplate: '脚本：{{rewriteScript}}\n字幕：{{captionIndexesJson}}',
      useFrameProfile: false,
      modelOptions: { temperature: 0.9, stream: false, maxRetries: 2 },
    },
    aiTextModel: {
      async callTextModel(payload) {
        assert.equal(payload.messages[0].content, '自定义分镜系统');
        assert.equal(payload.temperature, 0.9);
        assert.equal(payload.stream, false);
        return {
          success: true,
          text: JSON.stringify({
            template: 'ai_storyboard_cards',
            scenes: [
              {
                caption_indexes: [1],
                headline: '开头',
                visual_type: 'text_card',
                layout: 'center_focus',
                background_prompt: '抽象背景',
                emphasis_words: ['开头'],
              },
            ],
          }),
          model: { model_id: 'fake' },
        };
      },
    },
  });
  assert.equal(customResult.config_snapshot.source, 'request');
  assert.equal(customResult.messages[0].content, '自定义分镜系统');
  assert.equal(customResult.raw_output.includes('ai_storyboard_cards'), true);
  assert.equal(customResult.parse.success, true);

  const calls = [];
  const result = await storyboardAgent.createStoryboard({
    rewriteScript: 'first line. second line.',
    captions: [
      { index: 1, start: 0, end: 1.25, duration: 1.25, text: 'first line.' },
      { index: 2, start: 1.25, end: 3.75, duration: 2.5, text: 'second line.' },
    ],
    videoBrief: {
      target_duration_sec: 60,
      target_word_count: 220,
      tone: '教程感',
      hook: '一句话解释',
      beats: [{ purpose: 'explain', summary: '定义', duration_sec: 8, visual_intent: '概念图' }],
    },
    aiTextModel: {
      callTextModel: async options => {
        calls.push(options);
        assert.equal(options.stream, true);
        assert.equal(options.maxRetries, 3);
        assert.equal(options.fallbackToNonStreamOnGatewayTimeout, true);
        return {
          success: true,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          text: JSON.stringify({
            template: 'ai_storyboard_cards',
            style: { visual_tone: 'professional' },
            scenes: [
              {
                caption_indexes: [1, 2],
                headline: 'Core idea',
                visual_type: 'text_card',
                layout: 'center_focus',
                background_prompt: 'original abstract background',
                emphasis_words: ['idea'],
                start: 999,
              },
            ],
          }),
        };
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.storyboard.status, 'done');
  assert.equal(result.storyboard.scenes[0].start, 0);
  assert.equal(result.storyboard.scenes[0].end, 3.75);
  assert.equal(result.raw.scenes.length, 1);
  assert.match(calls[0].messages[0].content, /start/);
  assert.match(calls[0].messages[1].content, /AI_STORYBOARD_TARGET=hyperframes/);
  assert.match(calls[0].messages[1].content, /AI_STORYBOARD_COVER_ALL_CAPTIONS=true/);
  assert.match(calls[0].messages[1].content, /Frame Profile：creative_brutalist/);
  assert.match(calls[0].messages[1].content, /教程感/);
  assert.match(calls[0].messages[1].content, /概念图/);

  const malformed = await storyboardAgent.createStoryboard({
    rewriteScript: 'first line. second line.',
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: 'first line.' },
      { index: 2, start: 1, end: 2, duration: 1, text: 'second line.' },
    ],
    aiTextModel: {
      callTextModel: async () => ({ success: true, text: 'not json' }),
    },
  });
  assert.equal(malformed.success, true);
  assert.equal(malformed.storyboard.scenes.length, 2);
  assert.equal(malformed.raw_parse_failed, true);

  const invalidRawScene = await storyboardAgent.createStoryboard({
    rewriteScript: 'first line. second line.',
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: 'first line.' },
      { index: 2, start: 1, end: 2, duration: 1, text: 'second line.' },
    ],
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        text: JSON.stringify({
          template: 'ai_storyboard_cards',
          scenes: [{ caption_indexes: [999] }],
        }),
      }),
    },
  });
  assert.equal(invalidRawScene.success, true);
  assert.equal(invalidRawScene.storyboard.status, 'done');
  assert.equal(invalidRawScene.schema_validation.success, false);
  assert.ok(invalidRawScene.schema_validation.errors.some(item => item.includes('不存在')));
}

run().then(() => {
  console.log('storyboard agent tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
