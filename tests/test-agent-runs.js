const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const agentRuns = require('../server/services/agentRuns');
const agentsRouter = require('../server/routes/agents');
const mediaPipeline = require('../server/services/mediaPipeline');

async function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function requestJson(server, method, pathName, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        text += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-test-'));
  const awemeId = '1234567890';
  const paths = mediaPipeline.getMediaPaths(awemeId, rootDir);
  const validVideoBrief = {
    target_duration_sec: 60,
    target_word_count: 220,
    tone: '知识科普',
    hook: '开场钩子',
    beats: [
      { purpose: 'hook', summary: '开场', duration_sec: 5, visual_intent: '关键词爆点' },
    ],
  };
  const illegalAwemeId = '..\\agent-runs-escape';
  const escapedDir = path.resolve(rootDir, '..', 'agent-runs-escape');
  const escapedRunsDir = path.join(escapedDir, 'agent_runs');
  const escapedRunPath = path.join(escapedRunsDir, '20260607-000000-000Z-abcdef-viral_rewrite.json');

  await writeJson(path.join(escapedDir, 'metadata.json'), {
    aweme_id: 'escape',
    title: '不应读取的素材',
  });
  await writeJson(path.join(escapedDir, 'analysis_input.json'), {
    aweme_id: 'escape',
    video: { title: '不应读取的素材', author: {}, statistics: {} },
    steps: {},
  });
  await writeJson(path.join(escapedDir, 'transcript.json'), {
    success: true,
    status: 'done',
    text: '不应进入模型调用的转写文本',
  });
  await writeJson(escapedRunPath, {
    success: true,
    run_id: '20260607-000000-000Z-abcdef-viral_rewrite',
    template: 'viral_rewrite',
    result: { summary: '不应读回' },
  });
  const escapedRunCountBefore = fs.readdirSync(escapedRunsDir).length;

  let illegalCreateModelCalled = false;
  const illegalCreate = await agentRuns.createDouyinAgentRun(illegalAwemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async () => {
        illegalCreateModelCalled = true;
        return { success: true, text: '{}' };
      },
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(illegalCreate.success, false);
  assert.strictEqual(illegalCreate.status, 'failed');
  assert.match(illegalCreate.message, /非法|无效/);
  assert.strictEqual(illegalCreateModelCalled, false);
  assert.strictEqual(fs.readdirSync(escapedRunsDir).length, escapedRunCountBefore);

  const illegalList = await agentRuns.listDouyinAgentRuns(illegalAwemeId, { rootDir });
  assert.strictEqual(illegalList.success, false);
  assert.match(illegalList.message, /非法|无效/);

  const illegalGet = await agentRuns.getDouyinAgentRun(illegalAwemeId, '20260607-000000-000Z-abcdef-viral_rewrite', { rootDir });
  assert.strictEqual(illegalGet.success, false);
  assert.match(illegalGet.message, /非法|无效/);

  const missing = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: { callTextModel: async () => ({ success: true, text: '{}' }) },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(missing.success, false);
  assert.strictEqual(missing.status, 'failed');
  assert.match(missing.message, /未找到该视频素材/);
  assert.strictEqual(fs.existsSync(path.join(paths.dir, 'agent_runs')), false);

  await writeJson(paths.metadata, {
    aweme_id: awemeId,
    title: '测试视频',
    author: { nickname: 'Tester' },
    statistics: { digg_count: 10, comment_count: 2 },
    aweme_url: `https://www.douyin.com/video/${awemeId}`,
  });
  fs.mkdirSync(paths.framesDir, { recursive: true });
  fs.writeFileSync(path.join(paths.framesDir, 'frame-0001.jpg'), 'fake');
  await writeJson(paths.analysisInput, {
    aweme_id: awemeId,
    video: {
      title: '测试视频',
      author: { nickname: 'Tester' },
      statistics: { digg_count: 10, comment_count: 2 },
      aweme_url: `https://www.douyin.com/video/${awemeId}`,
    },
    local_assets: { frames: [path.join(paths.framesDir, 'frame-0001.jpg')] },
    transcript: { status: 'done', path: paths.transcript },
    steps: {},
  });

  const noTranscript = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: { callTextModel: async () => ({ success: true, text: '{}' }) },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(noTranscript.success, false);
  assert.strictEqual(noTranscript.status, 'failed');
  assert.match(noTranscript.message, /未找到转写文本/);
  assert.ok(fs.existsSync(noTranscript.path));

  await writeJson(paths.transcript, {
    success: true,
    status: 'done',
    text: '这是一个关于本地创作工作流的视频。',
  });

  const generated = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        assert.match(messages[0].content, /只输出 JSON/);
        assert.match(messages[0].content, /summary, viral_points, audience, comment_insights, topics, rewrite_script, titles/);
        assert.match(messages[1].content, /测试视频/);
        assert.match(messages[1].content, /本地创作工作流/);
        assert.match(messages[1].content, /这个工具提升效率/);
        return {
          success: true,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          text: JSON.stringify({
            summary: '摘要',
            viral_points: ['开头明确'],
            audience: '创作者',
            comment_insights: ['评论关注效率'],
            topics: ['本地素材管理'],
            rewrite_script: '输入是什么，输出是什么，规则是什么。',
            titles: ['标题一'],
            video_brief: validVideoBrief,
            spoken_blocks: [
              { id: 'b1', text: '输入是什么', purpose: 'define_input', visual_hint: 'field_highlight' },
              { id: 'b2', text: '输出是什么', purpose: 'define_output', visual_hint: 'field_highlight' },
            ],
          }),
        };
      },
    },
    getLocalComments: () => ({
      success: true,
      count: 1,
      data: [
        { content: '这个工具提升效率', like_count: 9, replies: [{ content: '同意', like_count: 1 }] },
      ],
    }),
  });

  assert.strictEqual(generated.success, true);
  assert.strictEqual(generated.status, 'done');
  assert.strictEqual(generated.result.summary, '摘要');
  assert.strictEqual(generated.result.rewrite_script, '输入是什么，输出是什么，规则是什么。');
  assert.deepStrictEqual(generated.result.spoken_blocks.map(item => item.text), [
    '输入是什么',
    '输出是什么',
  ]);
  assert.strictEqual(generated.input_summary.comment_count, 1);
  assert.strictEqual(generated.input_summary.has_transcript, true);
  assert.ok(generated.run_id.endsWith('-viral_rewrite'));
  assert.ok(fs.existsSync(generated.path));

  const storyboardPlanRun = await agentRuns.createDouyinStoryboardPlanRun(awemeId, {
    rootDir,
    promptOptions: { targetDurationSec: 42 },
    storyboardPlanAgent: {
      createStoryboardPlan: async ({ transcriptText, commentsText, promptOptions }) => {
        assert.match(transcriptText, /本地创作工作流/);
        assert.match(commentsText, /提升效率/);
        assert.equal(promptOptions.targetDurationSec, 42);
        return {
          success: true,
          message: '导演分镜规划已生成。',
          model: { provider: 'mock', model_id: 'plan-test' },
          messages: [{ role: 'system', content: 'plan system' }],
          raw_output: '{"storyboard_plan":{"scenes":[]}}',
          parse: { success: true, error: '' },
          raw: { storyboard_plan: { scenes: [] } },
          storyboard_plan: {
            status: 'planned',
            message: '导演分镜规划已生成。',
            target_duration_sec: 42,
            scenes: [
              {
                index: 1,
                target_duration_sec: 2,
                narration_text: '第一幕旁白',
                headline: '第一幕',
                visual_intent: '展示输入',
                visual_type_hint: 'text_card',
              },
            ],
          },
        };
      },
    },
    getLocalComments: () => ({
      success: true,
      count: 1,
      data: [
        { content: '这个工具提升效率', like_count: 9 },
      ],
    }),
  });
  assert.equal(storyboardPlanRun.success, true);
  assert.equal(storyboardPlanRun.storyboard_plan.status, 'planned');
  assert.equal(storyboardPlanRun.workflow.next_action, 'synthesize_scene_tts');

  const sceneTtsRun = await agentRuns.synthesizeDouyinRunSceneTts(awemeId, storyboardPlanRun.run_id, {
    rootDir,
    voice: 'Mia',
    stylePrompt: 'warm',
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes, outputDir, runId, voice, stylePrompt, format }) => {
        assert.deepStrictEqual(scenes.map(scene => scene.narration_text), ['第一幕旁白']);
        assert.ok(outputDir.endsWith('agent_runs'));
        assert.equal(runId, storyboardPlanRun.run_id);
        assert.equal(voice, 'Mia');
        assert.equal(stylePrompt, 'warm');
        assert.equal(format, 'wav');
        return {
          success: true,
          message: '分段配音已生成。',
          scene_tts: {
            status: 'done',
            voice,
            style_prompt: stylePrompt,
            format,
            path: path.join(outputDir, `${runId}-tts.wav`),
            file_name: `${runId}-tts.wav`,
            duration: 2,
            scenes: [
              {
                index: 1,
                duration: 2,
                actual_duration_sec: 2,
                path: path.join(outputDir, 'scene-001.wav'),
                file_name: 'scene-001.wav',
                captions: [
                  { index: 1, start: 0, end: 2, duration: 2, text: '第一幕旁白' },
                ],
                phrase_captions: [
                  { id: 'cap-1-p1', caption_index: 1, phrase_index: 1, start: 0, end: 2, duration: 2, text: '第一幕旁白' },
                ],
              },
            ],
            model: { provider: 'mock', model_id: 'tts-test' },
            message: '分段配音已生成。',
          },
        };
      },
    },
  });
  assert.equal(sceneTtsRun.success, true);
  assert.equal(sceneTtsRun.scene_tts.timed_storyboard_plan.status, 'timed');
  assert.equal(sceneTtsRun.workflow.next_action, 'generate_visual_storyboard');

  const visualStoryboardRun = await agentRuns.createDouyinRunVisualStoryboard(awemeId, storyboardPlanRun.run_id, {
    rootDir,
    storyboardAgent: {
      createStoryboard: async ({ rewriteScript, captions, phraseCaptions, videoBrief }) => {
        assert.equal(rewriteScript, '第一幕旁白');
        assert.deepStrictEqual(captions.map(caption => caption.text), ['第一幕旁白']);
        assert.deepStrictEqual(phraseCaptions.map(caption => caption.text), ['第一幕旁白']);
        assert.equal(videoBrief.target_duration_sec, 42);
        return {
          success: true,
          message: 'AI 分镜已生成。',
          model: { provider: 'mock', model_id: 'storyboard-test' },
          raw: {
            scenes: [
              {
                caption_indexes: [1],
                headline: '第一幕',
                visual_type: 'text_card',
                layout: 'center_focus',
                background_prompt: '简洁背景',
                emphasis_words: [],
              },
            ],
          },
          storyboard: {
            status: 'done',
            template: 'ai_storyboard_cards',
            scenes: [
              { index: 1, caption_indexes: [1], start: 0, end: 2, duration: 2, headline: '第一幕' },
            ],
          },
          config_snapshot: { source: 'default' },
          messages: [{ role: 'system', content: 'storyboard system' }],
          raw_output: '{"template":"ai_storyboard_cards"}',
          parse: { success: true, error: '' },
          schema_validation: { success: true, errors: [] },
        };
      },
    },
  });
  assert.equal(visualStoryboardRun.success, true);
  assert.equal(visualStoryboardRun.workflow.next_action, 'generate_video_project');

  const generatedWithOverride = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    agentConfigOverride: {
      systemPrompt: '临时系统',
      userPromptTemplate: '标题：{{videoTitle}}\n转写：{{transcriptText}}\n{{promptOptionsText}}',
      modelOptions: { temperature: 0.6, stream: false, maxRetries: 2 },
    },
    aiTextModel: {
      callTextModel: async ({ messages, temperature, stream, maxRetries }) => {
        assert.equal(temperature, 0.6);
        assert.equal(stream, false);
        assert.equal(maxRetries, 2);
        assert.equal(messages[0].content, '临时系统');
        assert.match(messages[1].content, /测试视频/);
        return {
          success: true,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          text: JSON.stringify({
            summary: '覆盖摘要',
            viral_points: ['临时 prompt'],
            audience: '创作者',
            comment_insights: [],
            topics: ['配置'],
            rewrite_script: '覆盖脚本',
            titles: ['覆盖标题'],
            video_brief: validVideoBrief,
          }),
        };
      },
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.equal(generatedWithOverride.agent_config_snapshot.source, 'request');
  assert.equal(generatedWithOverride.agent_config_snapshot.systemPrompt, '临时系统');
  assert.ok(Array.isArray(generatedWithOverride.messages));
  assert.equal(generatedWithOverride.messages[0].content, '临时系统');
  assert.match(generatedWithOverride.messages[1].content, /测试视频/);
  assert.equal(generatedWithOverride.raw_output.includes('"summary"'), true);
  assert.deepEqual(generatedWithOverride.parse, { success: true, error: '' });
  assert.deepEqual(generatedWithOverride.schema_validation, { success: true, errors: [] });

  const invalidShapeRun = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        model: { provider: 'OpenAI', model_id: 'gpt-test' },
        text: JSON.stringify({
          summary: 123,
          viral_points: '不是数组',
        }),
      }),
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.equal(invalidShapeRun.success, true);
  assert.equal(invalidShapeRun.parse.success, true);
  assert.equal(invalidShapeRun.schema_validation.success, false);
  assert.ok(invalidShapeRun.schema_validation.errors.some(item => item.includes('summary')));
  assert.ok(invalidShapeRun.schema_validation.errors.some(item => item.includes('rewrite_script')));

  const invalidOverrideRun = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    agentConfigOverride: {
      systemPrompt: '',
      userPromptTemplate: '标题：{{videoTitle}}',
      modelOptions: { temperature: 'bad' },
    },
    aiTextModel: {
      callTextModel: async () => {
        throw new Error('不应调用模型');
      },
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.equal(invalidOverrideRun.success, false);
  assert.match(invalidOverrideRun.message, /system prompt|temperature/);

  const runWithPromptOptions = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    promptOptions: {
      goal: '涨粉',
      audience: '健身新手',
      rewriteStyle: '强情绪开头',
      forbidden: '不要医疗承诺',
    },
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        assert.match(messages[1].content, /涨粉/);
        assert.match(messages[1].content, /健身新手/);
        assert.match(messages[1].content, /不要医疗承诺/);
        return {
          success: true,
          text: JSON.stringify({
            summary: '摘要',
            viral_points: ['冲突'],
            audience: '健身新手',
            comment_insights: [],
            topics: ['选题'],
            rewrite_script: '脚本',
            titles: ['标题'],
            video_brief: validVideoBrief,
          }),
          model: { provider: 'mock' },
        };
      },
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.equal(runWithPromptOptions.success, true);
  assert.equal(runWithPromptOptions.prompt_options.goal, '涨粉');
  assert.equal(runWithPromptOptions.prompt_options.audience, '健身新手');
  assert.equal(runWithPromptOptions.prompt_options.rewriteStyle, '强情绪开头');

  const listed = await agentRuns.listDouyinAgentRuns(awemeId, { rootDir });
  assert.strictEqual(listed.success, true);
  assert.strictEqual(listed.count, 7);
  assert.strictEqual(listed.data.length, 7);
  assert.strictEqual(listed.data[0].run_id, runWithPromptOptions.run_id);

  const detail = await agentRuns.getDouyinAgentRun(awemeId, generated.run_id, { rootDir });
  assert.strictEqual(detail.success, true);
  assert.strictEqual(detail.aweme_id, awemeId);
  assert.strictEqual(detail.run_id, generated.run_id);
  assert.strictEqual(detail.data.result.rewrite_script, '输入是什么，输出是什么，规则是什么。');

  const ttsInputs = [];
  const segmentDurations = [1.25];
  const ttsResult = await agentRuns.synthesizeDouyinRunTts(awemeId, generated.run_id, {
    rootDir,
    voice: 'Mia',
    stylePrompt: 'warm natural delivery',
    ttsModel: {
      callTtsModel: async options => {
        ttsInputs.push(options);
        return {
          success: true,
          status: 'done',
          message: 'TTS ok',
          audioBuffer: Buffer.from(`fake wav data ${ttsInputs.length}`),
          format: 'wav',
          voice: options.voice,
          model: { provider: 'mimo', model_id: 'mimo-v2.5-tts' },
        };
      },
    },
    readAudioDuration: async () => segmentDurations.shift(),
    concatenateAudio: async ({ targetPath }) => {
      fs.writeFileSync(targetPath, 'combined wav data');
      return { success: true, path: targetPath };
    },
  });
  assert.strictEqual(ttsResult.success, true);
  assert.deepStrictEqual(ttsInputs.map(item => item.text), ['输入是什么，输出是什么，规则是什么。']);
  assert.strictEqual(ttsInputs[0].voice, 'Mia');
  assert.strictEqual(ttsInputs[0].stylePrompt, 'warm natural delivery');
  assert.strictEqual(ttsResult.tts.voice, 'Mia');
  assert.strictEqual(ttsResult.tts.format, 'wav');
  assert.ok(ttsResult.tts.url.includes(`/api/agents/douyin/${awemeId}/runs/${generated.run_id}/tts/`));
  assert.strictEqual(fs.readFileSync(ttsResult.tts.path, 'utf-8'), 'combined wav data');
  assert.deepStrictEqual(ttsResult.tts.captions, [
    { index: 1, start: 0, end: 1.25, duration: 1.25, text: '输入是什么，输出是什么，规则是什么。' },
  ]);
  assert.ok(Array.isArray(ttsResult.tts.phrase_captions));
  assert.ok(ttsResult.tts.phrase_captions.length > ttsResult.tts.captions.length);
  assert.ok(ttsResult.tts.phrase_captions[0].id.startsWith('cap-'));
  assert.strictEqual(ttsResult.tts.duration, 1.25);
  assert.strictEqual(ttsResult.tts.segments.length, 1);
  assert.ok(fs.existsSync(ttsResult.tts.segments[0].path));

  const detailAfterTts = await agentRuns.getDouyinAgentRun(awemeId, generated.run_id, { rootDir });
  assert.strictEqual(detailAfterTts.data.tts.voice, 'Mia');
  assert.strictEqual(detailAfterTts.data.tts.status, 'done');

  assert.deepStrictEqual(detailAfterTts.data.tts.captions, ttsResult.tts.captions);

  const tooLongRunPath = path.join(paths.dir, 'agent_runs', 'too-long-run.json');
  await writeJson(tooLongRunPath, {
    success: true,
    run_id: 'too-long-run',
    template: 'viral_rewrite',
    result: {
      rewrite_script: '这是一段明显超出目标时长的口播。'.repeat(140),
      video_brief: { ...validVideoBrief, target_duration_sec: 60 },
    },
  });
  let tooLongTtsCalled = false;
  const tooLongTtsResult = await agentRuns.synthesizeDouyinRunTts(awemeId, 'too-long-run', {
    rootDir,
    ttsModel: {
      callTtsModel: async () => {
        tooLongTtsCalled = true;
        return { success: true, audioBuffer: Buffer.from('too long') };
      },
    },
  });
  assert.strictEqual(tooLongTtsResult.success, false);
  assert.strictEqual(tooLongTtsCalled, false);
  assert.match(tooLongTtsResult.message, /目标时长|压缩|过长/);

  const legacyRunWithoutPhraseCaptions = JSON.parse(fs.readFileSync(generated.path, 'utf-8'));
  delete legacyRunWithoutPhraseCaptions.tts.phrase_captions;
  await writeJson(generated.path, legacyRunWithoutPhraseCaptions);

  const storyboardResult = await agentRuns.createDouyinRunStoryboard(awemeId, generated.run_id, {
    rootDir,
    storyboardOptions: {
      visualStyle: '商业质感',
      pacing: '快节奏',
      forbidden: '不要真人',
    },
    storyboardConfigOverride: {
      systemPrompt: '临时分镜系统',
      userPromptTemplate: '脚本：{{rewriteScript}}\n字幕：{{captionIndexesJson}}',
      useFrameProfile: false,
      modelOptions: { temperature: 0.8, stream: false, maxRetries: 2 },
    },
    frameProfileId: 'creative_brutalist',
    storyboardAgent: {
      createStoryboard: async ({ rewriteScript, captions, phraseCaptions, storyboardOptions, editableConfig, frameProfileId }) => {
        assert.equal(rewriteScript, generated.result.rewrite_script);
        assert.ok(captions.length > 0);
        assert.ok(phraseCaptions.length > captions.length);
        assert.equal(storyboardOptions.visualStyle, '商业质感');
        assert.equal(storyboardOptions.forbidden, '不要真人');
        assert.equal(editableConfig.source, 'request');
        assert.equal(editableConfig.systemPrompt, '临时分镜系统');
        assert.equal(frameProfileId, 'creative_brutalist');
        return {
          success: true,
          message: 'AI 分镜已生成。',
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          config_snapshot: {
            source: editableConfig.source,
            systemPrompt: editableConfig.systemPrompt,
            userPromptTemplate: editableConfig.userPromptTemplate,
            useFrameProfile: editableConfig.useFrameProfile,
            modelOptions: editableConfig.modelOptions,
          },
          messages: [{ role: 'system', content: editableConfig.systemPrompt }],
          raw_output: '{"template":"ai_storyboard_cards"}',
          parse: { success: true, error: '' },
          schema_validation: { success: true, errors: [] },
          raw: {
            scenes: [
              {
                caption_indexes: [1],
                headline: '核心观点',
                start: 999,
                end: 1000,
              },
            ],
          },
          storyboard: {
            status: 'done',
            template: 'ai_storyboard_cards',
            scenes: [
              {
                index: 1,
                caption_indexes: [1],
                start: 0,
                end: 1.25,
                duration: 1.25,
                headline: '核心观点',
                captions,
              },
            ],
          },
        };
      },
    },
  });
  assert.equal(storyboardResult.success, true);
  assert.equal(storyboardResult.storyboard_options.visualStyle, '商业质感');
  assert.equal(storyboardResult.storyboard_options.pacing, '快节奏');
  assert.equal(storyboardResult.storyboard.scenes[0].start, 0);
  assert.equal(storyboardResult.storyboard_raw.scenes[0].start, 999);
  assert.equal(storyboardResult.storyboard_config_snapshot.source, 'request');
  assert.equal(storyboardResult.storyboard_messages[0].content, '临时分镜系统');
  assert.equal(storyboardResult.storyboard_parse.success, true);
  assert.equal(storyboardResult.storyboard_schema_validation.success, true);

  const invalidStoryboardSchemaResult = await agentRuns.createDouyinRunStoryboard(awemeId, generated.run_id, {
    rootDir,
    storyboardAgent: {
      createStoryboard: async ({ captions }) => ({
        success: true,
        message: 'AI 分镜已生成。',
        model: { provider: 'OpenAI', model_id: 'gpt-test' },
        config_snapshot: { source: 'default' },
        messages: [],
        raw_output: '{"template":"ai_storyboard_cards","scenes":[{"caption_indexes":[999]}]}',
        parse: { success: true, error: '' },
        schema_validation: {
          success: false,
          errors: ['分镜 1 引用了不存在的字幕 999。', '分镜 1 标题不能为空。'],
        },
        raw: { template: 'ai_storyboard_cards', scenes: [{ caption_indexes: [999] }] },
        storyboard: {
          status: 'done',
          template: 'ai_storyboard_cards',
          scenes: [
            {
              index: 1,
              caption_indexes: [1],
              start: 0,
              end: 1.25,
              duration: 1.25,
              headline: 'fallback',
              captions,
            },
          ],
        },
      }),
    },
  });
  assert.equal(invalidStoryboardSchemaResult.success, true);
  assert.equal(invalidStoryboardSchemaResult.storyboard.status, 'done');
  assert.equal(invalidStoryboardSchemaResult.storyboard_schema_validation.success, false);
  assert.ok(invalidStoryboardSchemaResult.storyboard_schema_validation.errors.some(item => item.includes('不存在')));

  const invalidStoryboardUpdate = await agentRuns.updateDouyinRunStoryboard(awemeId, generated.run_id, {
    template: 'ai_storyboard_cards',
    scenes: [
      {
        caption_indexes: [1],
        headline: '重复一',
        visual_type: 'text_card',
        layout: 'center_focus',
        background_prompt: '原创背景',
        emphasis_words: [],
      },
      {
        caption_indexes: [1],
        headline: '重复二',
        visual_type: 'text_card',
        layout: 'center_focus',
        background_prompt: '原创背景',
        emphasis_words: [],
      },
    ],
  }, { rootDir });
  assert.equal(invalidStoryboardUpdate.success, false);
  assert.match(invalidStoryboardUpdate.message, /分镜校验失败/);
  assert.ok(invalidStoryboardUpdate.storyboard_schema_validation.errors.some(item => item.includes('重复')));

  const savedStoryboardUpdate = await agentRuns.updateDouyinRunStoryboard(awemeId, generated.run_id, {
    template: 'ai_storyboard_cards',
    scenes: [
      {
        caption_indexes: [1],
        headline: '编辑后的标题',
        visual_type: 'quote_card',
        layout: 'split_emphasis',
        background_prompt: '编辑后的原创背景',
        emphasis_words: ['编辑'],
        start: 999,
      },
    ],
  }, { rootDir });
  assert.equal(savedStoryboardUpdate.success, true);
  assert.equal(savedStoryboardUpdate.storyboard.scenes[0].headline, '编辑后的标题');
  assert.equal(savedStoryboardUpdate.storyboard.scenes[0].start, 0);
  assert.equal(savedStoryboardUpdate.storyboard_schema_validation.success, true);

  const projectResult = await agentRuns.createDouyinRunHyperframesProject(awemeId, generated.run_id, {
    rootDir,
    renderOptions: {
      resolution: '720x1280',
      fps: '60',
      captionSize: 'large',
      motionLevel: 'low',
      showCaptionBar: false,
      showSceneNumber: false,
      quality: 'high',
    },
    hyperframesProject: {
      createOriginalCaptionProject: async ({ run, projectDir, renderOptions }) => {
        assert.equal(run.run_id, generated.run_id);
        assert.ok(run.tts.captions.length > 0);
        assert.ok(run.storyboard.scenes.length > 0);
        assert.equal(renderOptions.resolution, '720x1280');
        assert.equal(renderOptions.fps, '60');
        assert.equal(renderOptions.showCaptionBar, false);
        fs.mkdirSync(projectDir, { recursive: true });
        const indexPath = path.join(projectDir, 'index.html');
        fs.writeFileSync(indexPath, '<html>project</html>');
        return {
          success: true,
          template: 'ai_storyboard_cards',
          project_dir: projectDir,
          index_path: indexPath,
          duration: 1.25,
          render_options: renderOptions,
          message: '视频工程已生成。',
        };
      },
    },
  });
  assert.equal(projectResult.success, true);
  assert.equal(projectResult.video.status, 'project_ready');
  assert.equal(projectResult.video.template, 'ai_storyboard_cards');
  assert.equal(projectResult.video.render_options.resolution, '720x1280');
  assert.equal(projectResult.video.render_options.quality, 'high');
  assert.ok(projectResult.video.project_dir.includes(`${generated.run_id}-hyperframes`));

  const failedQualityRunId = `${generated.run_id}-quality-failed`;
  const failedQualityPath = path.join(rootDir, awemeId, 'agent_runs', `${failedQualityRunId}.json`);
  await writeJson(failedQualityPath, {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: failedQualityRunId,
    video: {
      status: 'project_ready',
      project_dir: projectResult.video.project_dir,
      render_options: projectResult.video.render_options,
      video_quality_report: {
        pass: false,
        score: 68,
        issues: [{ code: 'card_like_layout_overuse', severity: 'error', message: '卡片化过高' }],
      },
    },
  });
  let blockedRenderCalled = false;
  const blockedRender = await agentRuns.renderDouyinRunHyperframesVideo(awemeId, failedQualityRunId, {
    rootDir,
    hyperframesRenderer: {
      renderHyperframesProject: async () => {
        blockedRenderCalled = true;
        return { success: true };
      },
    },
  });
  assert.equal(blockedRender.success, false);
  assert.equal(blockedRenderCalled, false);
  assert.match(blockedRender.message, /质量|卡片化|未通过/);

  const diskFailedProjectDir = path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}-disk-failed-hyperframes`);
  fs.mkdirSync(diskFailedProjectDir, { recursive: true });
  fs.writeFileSync(path.join(diskFailedProjectDir, 'project.json'), JSON.stringify({
    video_quality_report: {
      pass: false,
      score: 68,
      issues: [{ code: 'card_like_layout_overuse', severity: 'error', message: '磁盘工程质量未通过' }],
    },
  }, null, 2));
  const diskFailedRunId = `${generated.run_id}-disk-quality-failed`;
  const diskFailedPath = path.join(rootDir, awemeId, 'agent_runs', `${diskFailedRunId}.json`);
  await writeJson(diskFailedPath, {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: diskFailedRunId,
    video: {
      status: 'project_ready',
      project_dir: diskFailedProjectDir,
      project_json_path: path.join(diskFailedProjectDir, 'project.json'),
      render_options: projectResult.video.render_options,
    },
  });
  let diskBlockedRenderCalled = false;
  const diskBlockedRender = await agentRuns.renderDouyinRunHyperframesVideo(awemeId, diskFailedRunId, {
    rootDir,
    hyperframesRenderer: {
      renderHyperframesProject: async () => {
        diskBlockedRenderCalled = true;
        return { success: true };
      },
    },
  });
  assert.equal(diskBlockedRender.success, false);
  assert.equal(diskBlockedRenderCalled, false);
  assert.match(diskBlockedRender.message, /磁盘工程质量未通过|质量|未通过/);

  const stalePassProjectDir = path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}-stale-pass-hyperframes`);
  fs.mkdirSync(stalePassProjectDir, { recursive: true });
  fs.writeFileSync(path.join(stalePassProjectDir, 'project.json'), JSON.stringify({
    video_quality_report: {
      pass: false,
      score: 62,
      issues: [{ code: 'invalid_caption_sync', severity: 'error', message: 'disk project quality failed' }],
    },
  }, null, 2));
  const stalePassRunId = `${generated.run_id}-stale-pass-quality`;
  const stalePassPath = path.join(rootDir, awemeId, 'agent_runs', `${stalePassRunId}.json`);
  await writeJson(stalePassPath, {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: stalePassRunId,
    video: {
      status: 'project_ready',
      project_dir: stalePassProjectDir,
      project_json_path: path.join(stalePassProjectDir, 'project.json'),
      render_options: projectResult.video.render_options,
      video_quality_report: {
        pass: true,
        score: 100,
        issues: [],
      },
    },
  });
  let stalePassRenderCalled = false;
  const stalePassBlockedRender = await agentRuns.renderDouyinRunHyperframesVideo(awemeId, stalePassRunId, {
    rootDir,
    hyperframesRenderer: {
      renderHyperframesProject: async () => {
        stalePassRenderCalled = true;
        return { success: true };
      },
    },
  });
  assert.equal(stalePassBlockedRender.success, false);
  assert.equal(stalePassRenderCalled, false);
  assert.match(stalePassBlockedRender.message, /disk project quality failed|璐ㄩ噺|鏈€氳繃/);

  const renderResult = await agentRuns.renderDouyinRunHyperframesVideo(awemeId, generated.run_id, {
    rootDir,
    hyperframesRenderer: {
      renderHyperframesProject: async ({ projectDir, renderOptions }) => {
        assert.equal(renderOptions.fps, '60');
        assert.equal(renderOptions.quality, 'high');
        const outputPath = path.join(projectDir, 'output.mp4');
        fs.writeFileSync(outputPath, 'fake mp4');
        return { success: true, output_path: outputPath, message: '视频渲染完成。' };
      },
    },
  });
  assert.equal(renderResult.success, true);
  assert.equal(renderResult.video.status, 'rendered');
  assert.equal(renderResult.video.render_options.fps, '60');
  assert.equal(renderResult.video.render_options.quality, 'high');
  assert.ok(renderResult.video.output_url.includes(`/api/agents/douyin/${awemeId}/runs/${generated.run_id}/hyperframes/files/output.mp4`));
  assert.equal(fs.readFileSync(renderResult.video.output_path, 'utf-8'), 'fake mp4');

  const detailAfterVideo = await agentRuns.getDouyinAgentRun(awemeId, generated.run_id, { rootDir });
  assert.equal(detailAfterVideo.data.video.status, 'rendered');

  const savedAfterRenderedVideo = await agentRuns.updateDouyinRunStoryboard(awemeId, generated.run_id, {
    template: 'ai_storyboard_cards',
    scenes: [
      {
        caption_indexes: [1],
        headline: '再次编辑',
        visual_type: 'text_card',
        layout: 'center_focus',
        background_prompt: '再次编辑背景',
        emphasis_words: [],
      },
    ],
  }, { rootDir });
  assert.equal(savedAfterRenderedVideo.success, true);
  const detailAfterStoryboardEdit = await agentRuns.getDouyinAgentRun(awemeId, generated.run_id, { rootDir });
  assert.equal(detailAfterStoryboardEdit.data.video, null);

  const renderingGuardResult = await agentRuns.renderDouyinRunHyperframesVideo(awemeId, generated.run_id, {
    rootDir,
    hyperframesRenderer: {
      renderHyperframesProject: async ({ projectDir }) => {
        const detailWhileRendering = await agentRuns.getDouyinAgentRun(awemeId, generated.run_id, { rootDir });
        assert.equal(detailWhileRendering.data.video.status, 'rendering');
        assert.match(detailWhileRendering.data.video.message, /渲染/);

        let projectServiceCalled = false;
        const recreateWhileRendering = await agentRuns.createDouyinRunHyperframesProject(awemeId, generated.run_id, {
          rootDir,
          hyperframesProject: {
            createOriginalCaptionProject: async () => {
              projectServiceCalled = true;
              return { success: true };
            },
          },
        });
        assert.equal(recreateWhileRendering.success, false);
        assert.equal(recreateWhileRendering.video.status, 'rendering');
        assert.match(recreateWhileRendering.message, /渲染中/);
        assert.equal(projectServiceCalled, false);

        const outputPath = path.join(projectDir, 'output.mp4');
        fs.writeFileSync(outputPath, 'fake mp4 after guarded render');
        return { success: true, output_path: outputPath, message: '视频渲染完成。' };
      },
    },
  });
  assert.equal(renderingGuardResult.success, true);
  assert.equal(renderingGuardResult.video.status, 'rendered');

  const missingDetail = await agentRuns.getDouyinAgentRun(awemeId, 'missing-run', { rootDir });
  assert.strictEqual(missingDetail.success, false);
  assert.strictEqual(missingDetail.aweme_id, awemeId);
  assert.strictEqual(missingDetail.run_id, 'missing-run');
  assert.match(missingDetail.message, /未找到该 Agent 运行记录/);

  const traversalDetail = await agentRuns.getDouyinAgentRun(awemeId, '../metadata', { rootDir });
  assert.strictEqual(traversalDetail.success, false);
  assert.match(traversalDetail.message, /非法|未找到/);

  let failedModelCalled = false;
  const failedModel = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async () => {
        failedModelCalled = true;
        return {
          success: false,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          message: '模型超时',
          raw_response: { error: { message: 'timeout detail' } },
        };
      },
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(failedModelCalled, true);
  assert.strictEqual(failedModel.success, false);
  assert.strictEqual(failedModel.status, 'failed');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(failedModel, 'raw_response'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(failedModel.path, 'utf-8')), 'raw_response'), false);

  const longText = `${'长转写'.repeat(3000)}TAIL_SHOULD_NOT_APPEAR`;
  await writeJson(paths.transcript, {
    success: true,
    status: 'done',
    text: longText,
  });

  const longRun = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        assert.match(messages[1].content, /8000/);
        assert.doesNotMatch(messages[1].content, /TAIL_SHOULD_NOT_APPEAR/);
        return {
          success: true,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          text: JSON.stringify({ summary: '长转写摘要', video_brief: validVideoBrief }),
        };
      },
    },
    getLocalComments: () => ({
      success: true,
      count: 80,
      data: Array.from({ length: 80 }, (_, index) => ({
        content: `评论${index}`,
        like_count: index,
        replies: Array.from({ length: 6 }, (__, replyIndex) => ({ content: `回复${index}-${replyIndex}` })),
      })),
    }),
  });
  assert.strictEqual(longRun.success, true);
  assert.strictEqual(longRun.input_summary.transcript_truncated, true);
  assert.ok(longRun.run_id.endsWith('-viral_rewrite'));
  assert.match(longRun.run_id, /-\d{3}Z-[a-f0-9]{6}-viral_rewrite$/);

  const sameTimeRuns = await Promise.all(Array.from({ length: 5 }, () => agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        model: { provider: 'OpenAI', model_id: 'gpt-test' },
        text: JSON.stringify({ summary: '并发摘要', video_brief: validVideoBrief }),
      }),
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  })));
  assert.strictEqual(new Set(sameTimeRuns.map(item => item.run_id)).size, sameTimeRuns.length);
  assert.strictEqual(new Set(sameTimeRuns.map(item => item.path)).size, sameTimeRuns.length);

  await writeJson(paths.transcript, {
    success: true,
    status: 'done',
    text: '这是一个关于本地创作工作流的视频。',
  });

  const raw = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        model: { provider: 'OpenAI', model_id: 'gpt-test' },
        text: '普通文本结果',
      }),
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(raw.success, true);
  assert.strictEqual(raw.status, 'done');
  assert.strictEqual(raw.raw_text, '普通文本结果');
  assert.strictEqual(raw.result.summary, '');
  assert.match(raw.message, /未能解析为结构化结果/);
  assert.strictEqual(raw.steps.find(step => step.id === 'comments').message, '暂无本地评论缓存');
  assert.equal(raw.parse.success, false);
  assert.match(raw.parse.error, /JSON/);
  assert.equal(raw.schema_validation.success, false);
  assert.ok(raw.raw_output);

  fs.rmSync(paths.transcript, { force: true });
  const commentInsights = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'comment_insights',
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        assert.match(messages[0].content, /summary, pain_points, questions, sentiment, content_opportunities, reply_suggestions/);
        assert.match(messages[1].content, /评论洞察/);
        assert.match(messages[1].content, /太需要教程了/);
        return {
          success: true,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          text: JSON.stringify({
            summary: '评论集中关注教程和配置',
            pain_points: ['API 配置门槛高'],
            questions: ['是否支持导出？'],
            sentiment: '期待但担心门槛',
            content_opportunities: ['做一条配置教程'],
            reply_suggestions: ['感谢反馈，我们会补充教程'],
          }),
        };
      },
    },
    getLocalComments: () => ({
      success: true,
      count: 2,
      data: [
        { content: '太需要教程了', like_count: 12 },
        { content: 'API 怎么配置？', like_count: 5 },
      ],
    }),
  });
  assert.strictEqual(commentInsights.success, true);
  assert.strictEqual(commentInsights.template, 'comment_insights');
  assert.strictEqual(commentInsights.result.summary, '评论集中关注教程和配置');
  assert.deepStrictEqual(commentInsights.result.pain_points, ['API 配置门槛高']);
  assert.strictEqual(commentInsights.input_summary.has_transcript, false);
  assert.strictEqual(commentInsights.input_summary.comment_count, 2);
  assert.ok(commentInsights.run_id.endsWith('-comment_insights'));

  let emptyCommentModelCalled = false;
  const emptyCommentInsights = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'comment_insights',
    aiTextModel: {
      callTextModel: async () => {
        emptyCommentModelCalled = true;
        return { success: true, text: '{}' };
      },
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(emptyCommentInsights.success, false);
  assert.strictEqual(emptyCommentInsights.status, 'failed');
  assert.match(emptyCommentInsights.message, /评论缓存/);
  assert.strictEqual(emptyCommentModelCalled, false);

  const originalCreateDouyinAgentRun = agentRuns.createDouyinAgentRun;
  const originalCreateDouyinStoryboardPlanRun = agentRuns.createDouyinStoryboardPlanRun;
  const originalSynthesizeDouyinRunTts = agentRuns.synthesizeDouyinRunTts;
  const originalSynthesizeDouyinRunSceneTts = agentRuns.synthesizeDouyinRunSceneTts;
  const originalCreateDouyinRunStoryboard = agentRuns.createDouyinRunStoryboard;
  const originalCreateDouyinRunVisualStoryboard = agentRuns.createDouyinRunVisualStoryboard;
  const originalCreateDouyinRunHyperframesProject = agentRuns.createDouyinRunHyperframesProject;
  const originalRenderDouyinRunHyperframesVideo = agentRuns.renderDouyinRunHyperframesVideo;
  const originalGetDouyinAgentRun = agentRuns.getDouyinAgentRun;
  const originalDecideNextAction = agentRuns.decideNextAction;
  agentRuns.createDouyinAgentRun = async () => ({
    success: false,
    status: 'failed',
    aweme_id: awemeId,
    run_id: 'failed-run',
    steps: [{ id: 'generate', status: 'failed' }],
    message: '模型调用失败',
  });
  agentRuns.synthesizeDouyinRunTts = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    message: 'TTS ok',
    tts: {
      status: 'done',
      voice: 'Mia',
      url: `/api/agents/douyin/${awemeId}/runs/ok-run/tts/ok-run-tts.wav`,
    },
  });
  agentRuns.createDouyinStoryboardPlanRun = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'plan-run',
    message: '导演分镜规划已生成。',
    storyboard_plan: { status: 'planned', scenes: [{ index: 1, narration_text: '第一幕旁白' }] },
    workflow: { next_action: 'synthesize_scene_tts' },
  });
  agentRuns.synthesizeDouyinRunSceneTts = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    message: '分段配音已生成。',
    scene_tts: { status: 'done', timed_storyboard_plan: { status: 'timed', captions: [{ index: 1 }] } },
    workflow: { next_action: 'generate_visual_storyboard' },
  });
  agentRuns.createDouyinRunStoryboard = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    message: 'AI 分镜已生成。',
    storyboard: { status: 'done', scenes: [{ index: 1, caption_indexes: [1], start: 0, end: 1 }] },
  });
  agentRuns.createDouyinRunVisualStoryboard = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    message: '视觉分镜已生成。',
    storyboard: { status: 'done', scenes: [{ index: 1, caption_indexes: [1], start: 0, end: 1 }] },
    workflow: { next_action: 'generate_video_project' },
  });
  agentRuns.createDouyinRunHyperframesProject = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    message: '视频工程已生成。',
    video: { status: 'project_ready', template: 'ai_storyboard_cards' },
  });
  agentRuns.renderDouyinRunHyperframesVideo = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    message: '视频渲染完成。',
    video: { status: 'rendered', output_url: `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes/files/output.mp4` },
  });
  agentRuns.getDouyinAgentRun = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    data: { storyboard_plan: { status: 'planned', scenes: [{ index: 1 }] } },
  });
  agentRuns.decideNextAction = () => ({ next_action: 'synthesize_scene_tts' });
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentsRouter);
  const server = await listen(app);
  try {
    const templatesResponse = await requestJson(server, 'GET', '/api/agents/templates');
    assert.strictEqual(templatesResponse.statusCode, 200);
    assert.strictEqual(templatesResponse.body.success, true);
    assert.ok(templatesResponse.body.data.some(item => item.id === 'viral_rewrite'));

    const templateDetailResponse = await requestJson(server, 'GET', '/api/agents/templates/viral_rewrite');
    assert.strictEqual(templateDetailResponse.statusCode, 200);
    assert.strictEqual(templateDetailResponse.body.success, true);
    assert.strictEqual(templateDetailResponse.body.data.id, 'viral_rewrite');

    const saveTemplateResponse = await requestJson(server, 'PUT', '/api/agents/templates/viral_rewrite', {
      systemPrompt: '接口系统',
      userPromptTemplate: '接口标题：{{videoTitle}}',
      modelOptions: { temperature: 0.2, stream: false, maxRetries: 2 },
    });
    assert.strictEqual(saveTemplateResponse.statusCode, 200);
    assert.strictEqual(saveTemplateResponse.body.success, true);
    assert.match(saveTemplateResponse.body.message, /已保存|保存/);

    const deleteTemplateResponse = await requestJson(server, 'DELETE', '/api/agents/templates/viral_rewrite/override');
    assert.strictEqual(deleteTemplateResponse.statusCode, 200);
    assert.strictEqual(deleteTemplateResponse.body.success, true);
    assert.match(deleteTemplateResponse.body.message, /恢复默认/);

    const storyboardTemplateResponse = await requestJson(server, 'GET', '/api/agents/storyboard-template');
    assert.strictEqual(storyboardTemplateResponse.statusCode, 200);
    assert.strictEqual(storyboardTemplateResponse.body.success, true);
    assert.ok(storyboardTemplateResponse.body.data.systemPrompt.includes('MuseDock'));

    const saveStoryboardTemplateResponse = await requestJson(server, 'PUT', '/api/agents/storyboard-template', {
      systemPrompt: '分镜接口系统',
      userPromptTemplate: '脚本：{{rewriteScript}}',
      useFrameProfile: false,
      modelOptions: { temperature: 0.3, stream: true, maxRetries: 1 },
    });
    assert.strictEqual(saveStoryboardTemplateResponse.statusCode, 200);
    assert.strictEqual(saveStoryboardTemplateResponse.body.success, true);
    assert.match(saveStoryboardTemplateResponse.body.message, /已保存|保存/);

    const deleteStoryboardTemplateResponse = await requestJson(server, 'DELETE', '/api/agents/storyboard-template/override');
    assert.strictEqual(deleteStoryboardTemplateResponse.statusCode, 200);
    assert.strictEqual(deleteStoryboardTemplateResponse.body.success, true);
    assert.match(deleteStoryboardTemplateResponse.body.message, /恢复默认/);

    const previewResponse = await requestJson(server, 'POST', '/api/agents/messages/preview', {
      config: {
        systemPrompt: '预览系统',
        userPromptTemplate: '标题：{{videoTitle}}',
      },
      values: { videoTitle: '预览标题' },
    });
    assert.strictEqual(previewResponse.statusCode, 200);
    assert.strictEqual(previewResponse.body.success, true);
    assert.deepStrictEqual(previewResponse.body.messages, [
      { role: 'system', content: '预览系统' },
      { role: 'user', content: '标题：预览标题' },
    ]);
    assert.match(previewResponse.body.message, /messages/);

    const storyboardPreviewResponse = await requestJson(server, 'POST', '/api/agents/storyboard-messages/preview', {
      config: {
        systemPrompt: '分镜预览系统',
        userPromptTemplate: '脚本：{{rewriteScript}}\n字幕：{{captionIndexesJson}}\n文档：{{frameProfileBrief}}\n参数：{{storyboardOptionsText}}',
        useFrameProfile: true,
      },
      values: {
        rewriteScript: '分镜示例脚本',
        captionIndexesJson: '[{"index":0,"text":"示例字幕"}]',
        frameProfileBrief: '示例 Frame Profile',
        storyboardOptionsText: '示例分镜参数',
      },
    });
    assert.strictEqual(storyboardPreviewResponse.statusCode, 200);
    assert.strictEqual(storyboardPreviewResponse.body.success, true);
    assert.deepStrictEqual(storyboardPreviewResponse.body.messages, [
      { role: 'system', content: '分镜预览系统' },
      { role: 'user', content: '脚本：分镜示例脚本\n字幕：[{"index":0,"text":"示例字幕"}]\n文档：示例 Frame Profile\n参数：示例分镜参数' },
    ]);

    const response = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs`, {
      template: 'viral_rewrite',
      agentConfigOverride: {
        systemPrompt: '路由临时系统',
        userPromptTemplate: '路由临时标题：{{videoTitle}}',
      },
    });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.status, 'failed');
    assert.deepStrictEqual(response.body.steps, [{ id: 'generate', status: 'failed' }]);

    const storyboardPlanResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/storyboard-plan-runs`, {
      promptOptions: { targetDurationSec: 42 },
    });
    assert.strictEqual(storyboardPlanResponse.statusCode, 200);
    assert.strictEqual(storyboardPlanResponse.body.success, true);
    assert.strictEqual(storyboardPlanResponse.body.workflow.next_action, 'synthesize_scene_tts');

    const nextActionResponse = await requestJson(server, 'GET', `/api/agents/douyin/${awemeId}/runs/ok-run/next-action`);
    assert.strictEqual(nextActionResponse.statusCode, 200);
    assert.strictEqual(nextActionResponse.body.success, true);
    assert.strictEqual(nextActionResponse.body.workflow.next_action, 'synthesize_scene_tts');

    const ttsResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/tts`, {
      voice: 'Mia',
      stylePrompt: 'warm delivery',
    });
    assert.strictEqual(ttsResponse.statusCode, 200);
    assert.strictEqual(ttsResponse.body.success, true);
    assert.strictEqual(ttsResponse.body.tts.voice, 'Mia');

    const sceneTtsResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/scene-tts`, {
      voice: 'Mia',
      stylePrompt: 'warm delivery',
    });
    assert.strictEqual(sceneTtsResponse.statusCode, 200);
    assert.strictEqual(sceneTtsResponse.body.success, true);
    assert.strictEqual(sceneTtsResponse.body.workflow.next_action, 'generate_visual_storyboard');

    const visualStoryboardResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/visual-storyboard`, {});
    assert.strictEqual(visualStoryboardResponse.statusCode, 200);
    assert.strictEqual(visualStoryboardResponse.body.success, true);
    assert.strictEqual(visualStoryboardResponse.body.workflow.next_action, 'generate_video_project');

    const storyboardResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/storyboard`, {});
    assert.strictEqual(storyboardResponse.statusCode, 200);
    assert.strictEqual(storyboardResponse.body.success, true);
    assert.strictEqual(storyboardResponse.body.storyboard.status, 'done');

    const originalUpdateDouyinRunStoryboard = agentRuns.updateDouyinRunStoryboard;
    agentRuns.updateDouyinRunStoryboard = async () => ({
      success: true,
      aweme_id: awemeId,
      run_id: 'ok-run',
      message: '分镜已保存，请重新生成视频工程。',
      storyboard: { status: 'done', scenes: [{ index: 1, caption_indexes: [1], start: 0, end: 1 }] },
      storyboard_schema_validation: { success: true, errors: [] },
    });
    const saveStoryboardResponse = await requestJson(server, 'PUT', `/api/agents/douyin/${awemeId}/runs/ok-run/storyboard`, {
      storyboard: { scenes: [{ caption_indexes: [1], headline: '保存' }] },
    });
    agentRuns.updateDouyinRunStoryboard = originalUpdateDouyinRunStoryboard;
    assert.strictEqual(saveStoryboardResponse.statusCode, 200);
    assert.strictEqual(saveStoryboardResponse.body.success, true);
    assert.match(saveStoryboardResponse.body.message, /分镜已保存/);

    const projectResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes/project`, {});
    assert.strictEqual(projectResponse.statusCode, 200);
    assert.strictEqual(projectResponse.body.success, true);
    assert.strictEqual(projectResponse.body.video.status, 'project_ready');

    const renderResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes/render`, {});
    assert.strictEqual(renderResponse.statusCode, 200);
    assert.strictEqual(renderResponse.body.success, true);
    assert.strictEqual(renderResponse.body.video.status, 'rendered');
  } finally {
    agentRuns.createDouyinAgentRun = originalCreateDouyinAgentRun;
    agentRuns.createDouyinStoryboardPlanRun = originalCreateDouyinStoryboardPlanRun;
    agentRuns.synthesizeDouyinRunTts = originalSynthesizeDouyinRunTts;
    agentRuns.synthesizeDouyinRunSceneTts = originalSynthesizeDouyinRunSceneTts;
    agentRuns.createDouyinRunStoryboard = originalCreateDouyinRunStoryboard;
    agentRuns.createDouyinRunVisualStoryboard = originalCreateDouyinRunVisualStoryboard;
    agentRuns.createDouyinRunHyperframesProject = originalCreateDouyinRunHyperframesProject;
    agentRuns.renderDouyinRunHyperframesVideo = originalRenderDouyinRunHyperframesVideo;
    agentRuns.getDouyinAgentRun = originalGetDouyinAgentRun;
    agentRuns.decideNextAction = originalDecideNextAction;
    await new Promise(resolve => server.close(resolve));
  }
}

run().then(() => {
  console.log('agent run tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
