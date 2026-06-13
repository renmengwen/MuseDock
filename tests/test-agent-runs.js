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

async function requestText(server, method, pathName, body) {
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
          body: text,
          headers: res.headers,
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
  assert.equal(storyboardPlanRun.storyboard_plan.narration_budget.status, 'ok');
  assert.equal(storyboardPlanRun.workflow.next_action, 'synthesize_scene_tts');

  const longStoryboardPlanRunId = '20260607-020202-000Z-long-storyboard_plan';
  await writeJson(path.join(paths.dir, 'agent_runs', `${longStoryboardPlanRunId}.json`), {
    success: true,
    run_id: longStoryboardPlanRunId,
    template: 'storyboard_plan',
    aweme_id: awemeId,
    status: 'done',
    storyboard_plan: {
      status: 'planned',
      target_duration_sec: 4,
      scenes: [
        {
          index: 1,
          target_duration_sec: 2,
          narration_text: '第一句先讲背景。第二句继续解释细节。第三句给出行动建议。',
          headline: '压缩测试',
          visual_intent: '测试压缩',
          visual_type_hint: 'text_card',
        },
      ],
    },
  });
  const compressedPlan = await agentRuns.compressDouyinRunSceneNarration(awemeId, longStoryboardPlanRunId, { rootDir });
  assert.equal(compressedPlan.success, true);
  assert.equal(compressedPlan.storyboard_plan.narration_budget.status, 'ok');
  assert.ok(compressedPlan.storyboard_plan.scenes[0].narration_text.length <= 9);
  assert.equal(compressedPlan.workflow.next_action, 'synthesize_scene_tts');

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

  const savedWorkflowStoryboard = {
    template: 'ai_storyboard_cards',
    scenes: [
      {
        caption_indexes: [1],
        headline: '保存后继续',
        visual_type: 'text_card',
        layout: 'center_focus',
        background_prompt: '原创抽象背景',
        emphasis_words: ['保存'],
      },
    ],
  };
  const savedWorkflowResult = await agentRuns.updateDouyinRunStoryboard(awemeId, storyboardPlanRun.run_id, savedWorkflowStoryboard, {
    rootDir,
  });
  assert.equal(savedWorkflowResult.success, true);
  assert.equal(savedWorkflowResult.workflow.next_action, 'generate_video_project');
  const savedWorkflowRun = JSON.parse(fs.readFileSync(path.join(paths.dir, 'agent_runs', `${storyboardPlanRun.run_id}.json`), 'utf-8'));
  assert.equal(savedWorkflowRun.workflow.next_action, 'generate_video_project');

  const staleValidationRunId = '20260607-010101-000Z-stale-storyboard_plan';
  await writeJson(path.join(paths.dir, 'agent_runs', `${staleValidationRunId}.json`), {
    success: true,
    run_id: staleValidationRunId,
    template: 'storyboard_plan',
    aweme_id: awemeId,
    status: 'done',
    tts: {
      captions: [{ index: 1, start: 0, end: 1, duration: 1, text: '下期交付真实项目。' }],
    },
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '关注交付',
          visual_type: 'brand_close',
          layout: 'center_focus',
          background_prompt: '原创收束背景',
          emphasis_words: ['关注', '交付'],
          visual_scene: {
            composition: 'brand_close',
            objects: [{ id: 'cta', type: 'badge', text: '关注' }],
            motion: [{ target: 'cta', effect: 'pulse' }],
            beats: [{ target: 'cta', effect: 'slide_up_reveal', caption_block_id: 'cap-1-p1' }],
          },
        },
      ],
    },
    storyboard_schema_validation: {
      success: false,
      errors: ['分镜 1 画面类型不受支持。'],
    },
    workflow: {
      stage: 'needs_storyboard_repair',
      next_action: 'repair_visual_storyboard',
      message: '分镜结构校验失败，需要修复视觉分镜。',
    },
  });
  const healedDetail = await agentRuns.getDouyinAgentRun(awemeId, staleValidationRunId, { rootDir });
  assert.equal(healedDetail.data.storyboard_schema_validation.success, true);
  assert.deepEqual(healedDetail.data.storyboard_schema_validation.errors, []);
  assert.equal(healedDetail.data.storyboard.scenes[0].visual_type, 'quote_burst');
  assert.equal(healedDetail.data.workflow.next_action, 'generate_video_project');
  const healedList = await agentRuns.listDouyinAgentRuns(awemeId, { rootDir });
  const healedListedRun = healedList.data.find(item => item.run_id === staleValidationRunId);
  assert.equal(healedListedRun.storyboard_schema_validation.success, true);
  assert.equal(healedListedRun.workflow.next_action, 'generate_video_project');

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
  assert.strictEqual(listed.count, 9);
  assert.strictEqual(listed.data.length, 9);
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

  const initialFreeform = await agentRuns.getDouyinRunHyperframesFreeformState(awemeId, generated.run_id, { rootDir });
  assert.equal(initialFreeform.success, true);
  assert.equal(initialFreeform.hyperframes_freeform.mode, 'builtin_skill_context');
  assert.equal(initialFreeform.hyperframes_freeform.status, 'idle');
  assert.equal(initialFreeform.hyperframes_freeform.brief.status, 'idle');
  assert.equal(initialFreeform.hyperframes_freeform.audio.status, 'idle');
  assert.equal(initialFreeform.hyperframes_freeform.project.status, 'idle');
  assert.equal(initialFreeform.hyperframes_freeform.checks.status, 'idle');
  assert.equal(initialFreeform.hyperframes_freeform.render.status, 'idle');
  assert.equal(initialFreeform.hyperframes_freeform.visual_inspect.status, 'idle');

  const emptyFreeformRun = await agentRuns.createDouyinHyperframesFreeformRun(awemeId, { rootDir });
  assert.equal(emptyFreeformRun.success, true);
  assert.equal(emptyFreeformRun.template, 'hyperframes_freeform');
  assert.equal(emptyFreeformRun.status, 'ready');
  assert.ok(emptyFreeformRun.run_id.endsWith('-hyperframes_freeform'));
  assert.equal(emptyFreeformRun.hyperframes_freeform.status, 'idle');
  assert.ok(fs.existsSync(path.join(rootDir, awemeId, 'agent_runs', `${emptyFreeformRun.run_id}.json`)));

  const noBriefRunId = `${generated.run_id}-no-brief`;
  await writeJson(path.join(rootDir, awemeId, 'agent_runs', `${noBriefRunId}.json`), {
    ...JSON.parse(fs.readFileSync(generated.path, 'utf-8')),
    run_id: noBriefRunId,
    hyperframes_freeform: undefined,
  });
  let noBriefModelCalled = false;
  let noBriefProjectCalled = false;
  const noBriefProject = await agentRuns.generateDouyinRunHyperframesFreeformProject(awemeId, noBriefRunId, {
    rootDir,
    useSceneSpec: false,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
    },
    aiTextModel: {
      callTextModel: async () => {
        noBriefModelCalled = true;
        return { success: true, text: '{}' };
      },
    },
    hyperframesFreeformProject: {
      createFreeformProject: async () => {
        noBriefProjectCalled = true;
        return { success: true };
      },
    },
  });
  assert.equal(noBriefProject.success, false);
  assert.equal(noBriefModelCalled, false);
  assert.equal(noBriefProjectCalled, false);
  assert.equal(noBriefProject.hyperframes_freeform.project.status, 'failed');
  assert.match(noBriefProject.hyperframes_freeform.project.message, /导演策划/);

  const briefContextThrowRunId = `${generated.run_id}-brief-context-throw`;
  await writeJson(path.join(rootDir, awemeId, 'agent_runs', `${briefContextThrowRunId}.json`), {
    ...JSON.parse(fs.readFileSync(generated.path, 'utf-8')),
    run_id: briefContextThrowRunId,
    hyperframes_freeform: undefined,
  });
  const briefContextThrow = await agentRuns.generateDouyinRunHyperframesFreeformBrief(awemeId, briefContextThrowRunId, {
    rootDir,
    skillContext: {
      loadHyperframesSkillContext: async () => {
        throw new Error('context exploded');
      },
    },
  });
  assert.equal(briefContextThrow.success, false);
  assert.equal(briefContextThrow.hyperframes_freeform.status, 'failed');
  assert.equal(briefContextThrow.hyperframes_freeform.brief.status, 'failed');
  assert.match(briefContextThrow.hyperframes_freeform.brief.message, /上下文|skill/i);

  const briefBuildThrowRunId = `${generated.run_id}-brief-build-throw`;
  await writeJson(path.join(rootDir, awemeId, 'agent_runs', `${briefBuildThrowRunId}.json`), {
    ...JSON.parse(fs.readFileSync(generated.path, 'utf-8')),
    run_id: briefBuildThrowRunId,
    hyperframes_freeform: undefined,
  });
  const briefBuildThrow = await agentRuns.generateDouyinRunHyperframesFreeformBrief(awemeId, briefBuildThrowRunId, {
    rootDir,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
    },
    hyperframesFreeformAgent: {
      buildFreeformBriefMessages: () => {
        throw new Error('build exploded');
      },
      parseFreeformBriefResponse: () => ({ success: true, brief: {} }),
    },
  });
  assert.equal(briefBuildThrow.success, false);
  assert.equal(briefBuildThrow.hyperframes_freeform.status, 'failed');
  assert.equal(briefBuildThrow.hyperframes_freeform.brief.status, 'failed');
  assert.match(briefBuildThrow.message, /导演策划生成失败/);

  const staleBriefRunId = `${generated.run_id}-stale-brief`;
  const staleBriefPath = path.join(rootDir, awemeId, 'agent_runs', `${staleBriefRunId}.json`);
  await writeJson(staleBriefPath, {
    ...JSON.parse(fs.readFileSync(generated.path, 'utf-8')),
    run_id: staleBriefRunId,
    hyperframes_freeform: undefined,
  });
  const staleBrief = await agentRuns.generateDouyinRunHyperframesFreeformBrief(awemeId, staleBriefRunId, {
    rootDir,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
    },
    aiTextModel: {
      callTextModel: async () => {
        const run = JSON.parse(fs.readFileSync(staleBriefPath, 'utf-8'));
        run.hyperframes_freeform.brief.operation_id = 'newer-brief-operation';
        run.hyperframes_freeform.brief.message = '较新的导演策划任务正在处理';
        await writeJson(staleBriefPath, run);
        return {
          success: true,
          text: JSON.stringify({
            title: '旧请求',
            summary: '旧请求 brief',
            design_md: '# Old',
            narration: '旧旁白',
            storyboard: [],
          }),
        };
      },
    },
  });
  assert.equal(staleBrief.success, false);
  assert.match(staleBrief.message, /忽略旧结果/);
  const staleBriefDisk = JSON.parse(fs.readFileSync(staleBriefPath, 'utf-8'));
  assert.equal(staleBriefDisk.hyperframes_freeform.brief.operation_id, 'newer-brief-operation');
  assert.notEqual(staleBriefDisk.hyperframes_freeform.brief.summary, '旧请求 brief');

  const staleBriefContextRunId = `${generated.run_id}-stale-brief-context`;
  const staleBriefContextPath = path.join(rootDir, awemeId, 'agent_runs', `${staleBriefContextRunId}.json`);
  await writeJson(staleBriefContextPath, {
    ...JSON.parse(fs.readFileSync(generated.path, 'utf-8')),
    run_id: staleBriefContextRunId,
    hyperframes_freeform: undefined,
  });
  const staleBriefContext = await agentRuns.generateDouyinRunHyperframesFreeformBrief(awemeId, staleBriefContextRunId, {
    rootDir,
    skillContext: {
      loadHyperframesSkillContext: async () => {
        const run = JSON.parse(fs.readFileSync(staleBriefContextPath, 'utf-8'));
        assert.equal(run.hyperframes_freeform.brief.status, 'generating');
        assert.ok(run.hyperframes_freeform.brief.operation_id);
        run.hyperframes_freeform.status = 'ready';
        run.hyperframes_freeform.brief.status = 'ready';
        run.hyperframes_freeform.brief.operation_id = 'newer-context-operation';
        run.hyperframes_freeform.brief.summary = '较新的导演策划';
        run.hyperframes_freeform.brief.data = {
          title: '较新请求',
          summary: '较新的导演策划',
          storyboard: [{ headline: 'newer' }],
        };
        run.hyperframes_freeform.brief.message = '较新的导演策划已完成';
        await writeJson(staleBriefContextPath, run);
        throw new Error('old context failed');
      },
    },
  });
  assert.equal(staleBriefContext.success, false);
  assert.match(staleBriefContext.message, /忽略旧结果/);
  const staleBriefContextDisk = JSON.parse(fs.readFileSync(staleBriefContextPath, 'utf-8'));
  assert.equal(staleBriefContextDisk.hyperframes_freeform.status, 'ready');
  assert.equal(staleBriefContextDisk.hyperframes_freeform.brief.status, 'ready');
  assert.equal(staleBriefContextDisk.hyperframes_freeform.brief.operation_id, 'newer-context-operation');
  assert.equal(staleBriefContextDisk.hyperframes_freeform.brief.summary, '较新的导演策划');
  assert.equal(staleBriefContextDisk.hyperframes_freeform.brief.message, '较新的导演策划已完成');

  const freeformBrief = await agentRuns.generateDouyinRunHyperframesFreeformBrief(awemeId, generated.run_id, {
    rootDir,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
    },
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        assert.match(messages[1].content, /skill context/);
        return {
          success: true,
          text: JSON.stringify({
            title: '高级测试片',
            summary: '自由工程 brief',
            design_md: '# Design',
            narration: '旁白',
            audio_direction: {
              voice: 'Mia',
              style_prompt: '紧张，深呼吸，语速加快，适当加入（长叹一口气）。',
            },
            storyboard: [],
          }),
        };
      },
    },
  });
  assert.equal(freeformBrief.success, true);
  assert.equal(freeformBrief.hyperframes_freeform.brief.status, 'ready');
  assert.match(freeformBrief.hyperframes_freeform.brief.summary, /自由工程 brief/);

  const freeformAutoAudio = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(awemeId, generated.run_id, {
    rootDir,
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes, voice, stylePrompt }) => {
        assert.deepStrictEqual(scenes.map(scene => scene.narration_text), ['旁白']);
        assert.equal(voice, 'Mia');
        assert.equal(stylePrompt, '紧张，深呼吸，语速加快，适当加入（长叹一口气）。');
        const audioPath = path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}-tts.wav`);
        fs.writeFileSync(audioPath, 'auto freeform narration audio');
        return {
          success: true,
          message: '高级成片音频已生成。',
          scene_tts: {
            status: 'done',
            voice,
            style_prompt: stylePrompt,
            format: 'wav',
            path: audioPath,
            file_name: path.basename(audioPath),
            scenes: [
              {
                index: 1,
                narration_text: '旁白',
                duration: 1.5,
                captions: [{ index: 1, start: 0, end: 1.5, duration: 1.5, text: '旁白' }],
                phrase_captions: [],
              },
            ],
            model: { provider: 'mock' },
            updated_at: '2026-06-12T00:00:00.000Z',
          },
        };
      },
    },
  });
  assert.equal(freeformAutoAudio.success, true);
  assert.equal(freeformAutoAudio.hyperframes_freeform.audio.voice, 'Mia');
  assert.equal(freeformAutoAudio.hyperframes_freeform.audio.style_prompt, '紧张，深呼吸，语速加快，适当加入（长叹一口气）。');

  const freeformAudio = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(awemeId, generated.run_id, {
    rootDir,
    voice: 'Mia',
    stylePrompt: 'warm delivery',
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes, outputDir, runId, voice, stylePrompt }) => {
        assert.equal(runId, generated.run_id);
        assert.equal(voice, 'Mia');
        assert.equal(stylePrompt, 'warm delivery');
        assert.deepStrictEqual(scenes.map(scene => scene.narration_text), ['旁白']);
        const audioPath = path.join(outputDir, `${runId}-tts.wav`);
        fs.writeFileSync(audioPath, 'freeform narration audio');
        return {
          success: true,
          message: '高级成片音频已生成。',
          scene_tts: {
            status: 'done',
            voice,
            style_prompt: stylePrompt,
            format: 'wav',
            path: audioPath,
            file_name: path.basename(audioPath),
            scenes: [
              {
                index: 1,
                narration_text: '旁白',
                duration: 1.5,
                captions: [{ index: 1, start: 0, end: 1.5, duration: 1.5, text: '旁白' }],
                phrase_captions: [],
              },
            ],
            model: { provider: 'mock' },
            updated_at: '2026-06-12T00:00:00.000Z',
          },
        };
      },
    },
  });
  assert.equal(freeformAudio.success, true);
  assert.equal(freeformAudio.hyperframes_freeform.audio.status, 'ready');
  assert.equal(freeformAudio.hyperframes_freeform.audio.voice, 'Mia');
  assert.equal(freeformAudio.hyperframes_freeform.audio.duration, 1.5);
  assert.equal(freeformAudio.hyperframes_freeform.audio.captions[0].text, '旁白');
  assert.ok(fs.existsSync(freeformAudio.hyperframes_freeform.audio.path));

  const loggedBriefFailureRunId = `${generated.run_id}-logged-brief-failure`;
  const loggedBriefEvents = [];
  await writeJson(path.join(rootDir, awemeId, 'agent_runs', `${loggedBriefFailureRunId}.json`), {
    ...JSON.parse(fs.readFileSync(generated.path, 'utf-8')),
    run_id: loggedBriefFailureRunId,
    hyperframes_freeform: undefined,
  });
  const loggedBriefFailure = await agentRuns.generateDouyinRunHyperframesFreeformBrief(awemeId, loggedBriefFailureRunId, {
    rootDir,
    logger: {
      info: event => loggedBriefEvents.push({ level: 'info', event }),
      warn: event => loggedBriefEvents.push({ level: 'warn', event }),
      error: event => loggedBriefEvents.push({ level: 'error', event }),
    },
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
    },
    aiTextModel: {
      callTextModel: async () => ({
        success: false,
        message: 'terminated',
      }),
    },
  });
  assert.equal(loggedBriefFailure.success, false);
  assert.ok(loggedBriefEvents.some(entry => entry.event.stage === 'started'));
  assert.ok(loggedBriefEvents.some(entry => entry.level === 'warn' && entry.event.stage === 'model_failed'));
  assert.ok(loggedBriefEvents.some(entry => entry.level === 'warn' && entry.event.stage === 'failed'));
  assert.ok(loggedBriefEvents.every(entry => entry.event.event === 'hyperframes_freeform_brief'));
  assert.ok(loggedBriefEvents.every(entry => entry.event.aweme_id === awemeId));
  assert.ok(loggedBriefEvents.every(entry => entry.event.run_id === loggedBriefFailureRunId));
  assert.ok(loggedBriefEvents.some(entry => entry.event.message === 'terminated'));
  assert.ok(loggedBriefEvents.some(entry => typeof entry.event.elapsed_ms === 'number'));

  const shallowMergeCheck = await agentRuns.updateRunHyperframesFreeform(awemeId, generated.run_id, {
    brief: { status: 'generating' },
  }, { rootDir });
  assert.equal(shallowMergeCheck.success, true);
  assert.equal(shallowMergeCheck.data.hyperframes_freeform.brief.status, 'generating');
  assert.equal(shallowMergeCheck.data.hyperframes_freeform.brief.data.summary, '自由工程 brief');
  const deepMergeCheck = await agentRuns.updateRunHyperframesFreeform(awemeId, generated.run_id, {
    brief: { data: { title: '更新标题' } },
  }, { rootDir });
  assert.equal(deepMergeCheck.success, true);
  assert.equal(deepMergeCheck.data.hyperframes_freeform.brief.data.title, '更新标题');
  assert.equal(deepMergeCheck.data.hyperframes_freeform.brief.data.summary, '自由工程 brief');
  assert.deepEqual(deepMergeCheck.data.hyperframes_freeform.brief.data.storyboard, []);
  const pollutedBefore = {}.polluted;
  const pollutionCheck = await agentRuns.updateRunHyperframesFreeform(awemeId, generated.run_id, JSON.parse('{"brief":{"data":{"__proto__":{"polluted":"yes"},"constructor":{"polluted":"yes"},"prototype":{"polluted":"yes"},"summary":"防污染"}}}'), { rootDir });
  assert.equal(pollutionCheck.success, true);
  assert.equal({}.polluted, pollutedBefore);
  assert.equal(pollutionCheck.data.hyperframes_freeform.brief.data.__proto__.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(pollutionCheck.data.hyperframes_freeform.brief.data, 'constructor'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(pollutionCheck.data.hyperframes_freeform.brief.data, 'prototype'), false);
  assert.equal(pollutionCheck.data.hyperframes_freeform.brief.data.summary, '防污染');
  assert.deepEqual(pollutionCheck.data.hyperframes_freeform.brief.data.storyboard, []);
  await agentRuns.updateRunHyperframesFreeform(awemeId, generated.run_id, {
    brief: { status: 'ready', data: { title: '高级测试片', summary: '自由工程 brief' } },
  }, { rootDir });

  const projectCreateThrowRunId = `${generated.run_id}-project-create-throw`;
  await writeJson(path.join(rootDir, awemeId, 'agent_runs', `${projectCreateThrowRunId}.json`), {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: projectCreateThrowRunId,
  });
  const projectCreateThrow = await agentRuns.generateDouyinRunHyperframesFreeformProject(awemeId, projectCreateThrowRunId, {
    rootDir,
    useSceneSpec: false,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
    },
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        text: JSON.stringify({
          summary: '工程生成',
          files: { 'index.html': '<html></html>' },
        }),
      }),
    },
    hyperframesFreeformProject: {
      createFreeformProject: async () => {
        throw new Error('create exploded');
      },
    },
  });
  assert.equal(projectCreateThrow.success, false);
  assert.equal(projectCreateThrow.hyperframes_freeform.status, 'failed');
  assert.equal(projectCreateThrow.hyperframes_freeform.project.status, 'failed');
  assert.match(projectCreateThrow.hyperframes_freeform.project.message, /工程|写入|生成/);

  const projectParseThrowRunId = `${generated.run_id}-project-parse-throw`;
  await writeJson(path.join(rootDir, awemeId, 'agent_runs', `${projectParseThrowRunId}.json`), {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: projectParseThrowRunId,
  });
  const projectParseThrow = await agentRuns.generateDouyinRunHyperframesFreeformProject(awemeId, projectParseThrowRunId, {
    rootDir,
    useSceneSpec: false,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
    },
    aiTextModel: {
      callTextModel: async () => ({ success: true, text: '{}' }),
    },
    hyperframesFreeformAgent: {
      buildFreeformProjectMessages: () => [{ role: 'user', content: 'project' }],
      parseFreeformProjectResponse: () => {
        throw new Error('parse exploded');
      },
    },
  });
  assert.equal(projectParseThrow.success, false);
  assert.equal(projectParseThrow.hyperframes_freeform.status, 'failed');
  assert.equal(projectParseThrow.hyperframes_freeform.project.status, 'failed');
  assert.match(projectParseThrow.message, /解析失败|工程生成失败/);

  const snapshotThrowRunId = `${generated.run_id}-snapshot-throw`;
  await writeJson(path.join(rootDir, awemeId, 'agent_runs', `${snapshotThrowRunId}.json`), {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: snapshotThrowRunId,
  });
  const snapshotThrow = await agentRuns.generateDouyinRunHyperframesFreeformProject(awemeId, snapshotThrowRunId, {
    rootDir,
    useSceneSpec: false,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: 'skill-source' }),
      copySkillSnapshot: async () => {
        throw new Error('snapshot exploded');
      },
    },
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        text: JSON.stringify({
          summary: '工程生成',
          files: { 'index.html': '<html></html>' },
        }),
      }),
    },
  });
  assert.equal(snapshotThrow.success, true);
  assert.equal(snapshotThrow.hyperframes_freeform.status, 'ready');
  assert.equal(snapshotThrow.hyperframes_freeform.project.status, 'ready');
  assert.match(snapshotThrow.message, /快照|skill/i);

  const staleProjectRunId = `${generated.run_id}-stale-project`;
  const staleProjectRunPath = path.join(rootDir, awemeId, 'agent_runs', `${staleProjectRunId}.json`);
  const staleProjectDir = path.join(rootDir, awemeId, 'agent_runs', `${staleProjectRunId}-hyperframes-freeform`);
  await writeJson(staleProjectRunPath, {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: staleProjectRunId,
  });
  fs.mkdirSync(staleProjectDir, { recursive: true });
  fs.writeFileSync(path.join(staleProjectDir, 'index.html'), 'new', 'utf-8');
  let staleProjectTempRunId = '';
  const staleProject = await agentRuns.generateDouyinRunHyperframesFreeformProject(awemeId, staleProjectRunId, {
    rootDir,
    useSceneSpec: false,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
    },
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        text: JSON.stringify({
          summary: '旧工程',
          files: { 'index.html': 'old' },
        }),
      }),
    },
    hyperframesFreeformProject: {
      createFreeformProject: async ({ runId }) => {
        staleProjectTempRunId = runId;
        assert.notEqual(runId, staleProjectRunId);
        const tempDir = path.join(rootDir, awemeId, 'agent_runs', `${runId}-hyperframes-freeform`);
        fs.mkdirSync(tempDir, { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'index.html'), 'old', 'utf-8');
        const run = JSON.parse(fs.readFileSync(staleProjectRunPath, 'utf-8'));
        run.hyperframes_freeform.status = 'ready';
        run.hyperframes_freeform.project.status = 'ready';
        run.hyperframes_freeform.project.operation_id = 'newer-project-operation';
        run.hyperframes_freeform.project.index_path = path.join(staleProjectDir, 'index.html');
        run.hyperframes_freeform.project.message = '较新的工程已生成';
        run.hyperframes_freeform.project_dir = staleProjectDir;
        await writeJson(staleProjectRunPath, run);
        return {
          success: true,
          projectDir: tempDir,
          files: [{ name: 'index.html', path: path.join(tempDir, 'index.html') }],
          message: '旧工程已写入临时目录',
        };
      },
    },
  });
  assert.equal(staleProject.success, false);
  assert.match(staleProject.message, /忽略旧结果/);
  assert.match(staleProjectTempRunId, new RegExp(`^${generated.run_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-stale-project-project-`));
  assert.equal(fs.readFileSync(path.join(staleProjectDir, 'index.html'), 'utf-8'), 'new');
  assert.equal(fs.existsSync(path.join(rootDir, awemeId, 'agent_runs', `${staleProjectTempRunId}-hyperframes-freeform`)), false);

  const publishFailRunId = `${generated.run_id}-publish-fail`;
  const publishFailRunPath = path.join(rootDir, awemeId, 'agent_runs', `${publishFailRunId}.json`);
  const publishFailDir = path.join(rootDir, awemeId, 'agent_runs', `${publishFailRunId}-hyperframes-freeform`);
  await writeJson(publishFailRunPath, {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: publishFailRunId,
    hyperframes_freeform: {
      ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')).hyperframes_freeform,
      project_dir: publishFailDir,
      project: {
        status: 'ready',
        index_path: path.join(publishFailDir, 'index.html'),
        files: [{ name: 'index.html', path: path.join(publishFailDir, 'index.html') }],
        message: '上一版工程可用',
      },
    },
  });
  fs.mkdirSync(publishFailDir, { recursive: true });
  fs.writeFileSync(path.join(publishFailDir, 'index.html'), 'old-working', 'utf-8');
  const publishFail = await agentRuns.generateDouyinRunHyperframesFreeformProject(awemeId, publishFailRunId, {
    rootDir,
    useSceneSpec: false,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
    },
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        text: JSON.stringify({
          summary: '新工程',
          files: { 'index.html': 'new-broken' },
        }),
      }),
    },
    hyperframesFreeformProject: {
      createFreeformProject: async ({ runId }) => {
        const tempDir = path.join(rootDir, awemeId, 'agent_runs', `${runId}-hyperframes-freeform`);
        fs.mkdirSync(tempDir, { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'index.html'), 'new-broken', 'utf-8');
        fs.rmSync(tempDir, { recursive: true, force: true });
        return {
          success: true,
          projectDir: tempDir,
          files: [{ name: 'index.html', path: path.join(tempDir, 'index.html') }],
          message: '新工程临时目录已损坏',
        };
      },
    },
  });
  assert.equal(publishFail.success, false);
  assert.match(publishFail.message, /发布失败/);
  assert.equal(fs.readFileSync(path.join(publishFailDir, 'index.html'), 'utf-8'), 'old-working');
  const publishFailDisk = JSON.parse(fs.readFileSync(publishFailRunPath, 'utf-8'));
  assert.equal(publishFailDisk.hyperframes_freeform.status, 'failed');
  assert.equal(publishFailDisk.hyperframes_freeform.project.status, 'failed');
  assert.equal(publishFailDisk.hyperframes_freeform.project_dir, publishFailDir);
  assert.equal(publishFailDisk.hyperframes_freeform.project.index_path, path.join(publishFailDir, 'index.html'));

  const unsafeTempRunId = `${generated.run_id}-unsafe-temp`;
  const unsafeTempRunPath = path.join(rootDir, awemeId, 'agent_runs', `${unsafeTempRunId}.json`);
  const unsafeTempDir = path.join(rootDir, awemeId, 'agent_runs', `${unsafeTempRunId}-hyperframes-freeform`);
  await writeJson(unsafeTempRunPath, {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: unsafeTempRunId,
    hyperframes_freeform: {
      ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')).hyperframes_freeform,
      project_dir: unsafeTempDir,
      project: {
        status: 'ready',
        index_path: path.join(unsafeTempDir, 'index.html'),
        files: [{ name: 'index.html', path: path.join(unsafeTempDir, 'index.html') }],
        message: '上一版工程可用',
      },
    },
  });
  fs.mkdirSync(unsafeTempDir, { recursive: true });
  fs.writeFileSync(path.join(unsafeTempDir, 'index.html'), 'old-safe', 'utf-8');
  const unsafeTempResult = await agentRuns.generateDouyinRunHyperframesFreeformProject(awemeId, unsafeTempRunId, {
    rootDir,
    useSceneSpec: false,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
    },
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        text: JSON.stringify({
          summary: '错误临时目录',
          files: { 'index.html': 'should-not-delete-final' },
        }),
      }),
    },
    hyperframesFreeformProject: {
      createFreeformProject: async () => {
        const run = JSON.parse(fs.readFileSync(unsafeTempRunPath, 'utf-8'));
        run.hyperframes_freeform.project.operation_id = 'newer-unsafe-temp-operation';
        run.hyperframes_freeform.project.message = '较新的工程仍然可用';
        await writeJson(unsafeTempRunPath, run);
        return {
          success: true,
          projectDir: unsafeTempDir,
          files: [{ name: 'index.html', path: path.join(unsafeTempDir, 'index.html') }],
          message: '错误返回正式目录',
        };
      },
    },
  });
  assert.equal(unsafeTempResult.success, false);
  assert.match(unsafeTempResult.message, /忽略旧结果|临时目录/);
  assert.equal(fs.readFileSync(path.join(unsafeTempDir, 'index.html'), 'utf-8'), 'old-safe');

  const freeformProject = await agentRuns.generateDouyinRunHyperframesFreeformProject(awemeId, generated.run_id, {
    rootDir,
    useSceneSpec: false,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
      copySkillSnapshot: async () => ({ success: true }),
    },
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        text: JSON.stringify({
          summary: '工程生成',
          files: {
            'index.html': '<html></html>',
            'design.md': '# Design',
            'hyperframes.json': '{}',
            'package.json': '{"private":true}',
          },
        }),
      }),
    },
  });
  assert.equal(freeformProject.success, true);
  assert.equal(freeformProject.hyperframes_freeform.project.status, 'ready');
  const freeformProjectDir = path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}-hyperframes-freeform`);
  assert.ok(fs.existsSync(path.join(freeformProjectDir, 'index.html')));
  assert.equal(fs.readFileSync(path.join(freeformProjectDir, 'assets', 'narration.wav'), 'utf-8'), 'freeform narration audio');
  assert.match(fs.readFileSync(path.join(freeformProjectDir, 'index.html'), 'utf-8'), /<audio[^>]+id="narration-audio"[^>]+src="assets\/narration\.wav"/);

  const freeformIndexPath = agentRuns.resolveDouyinRunHyperframesFreeformFile(awemeId, generated.run_id, 'index.html', { rootDir });
  assert.ok(freeformIndexPath.endsWith('index.html'));

  assert.throws(
    () => agentRuns.resolveDouyinRunHyperframesFreeformFile(awemeId, generated.run_id, '../secret.txt', { rootDir }),
    /非法|不支持/,
  );

  const saveFreeformDesign = await agentRuns.saveDouyinRunHyperframesFreeformFile(
    awemeId,
    generated.run_id,
    'design.md',
    '# Edited',
    { rootDir },
  );
  assert.equal(saveFreeformDesign.success, true);
  assert.equal(
    fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}-hyperframes-freeform`, 'design.md'), 'utf-8'),
    '# Edited',
  );

  const freeformCheck = await agentRuns.checkDouyinRunHyperframesFreeformProject(awemeId, generated.run_id, {
    rootDir,
    hyperframesFreeformQuality: {
      checkFreeformProject: async ({ projectDir }) => {
        assert.ok(projectDir.endsWith(`${generated.run_id}-hyperframes-freeform`));
        return { success: true, lint: 'passed', validate: 'passed', inspect: 'passed', message: '检查通过' };
      },
    },
  });
  assert.equal(freeformCheck.success, true);
  assert.equal(freeformCheck.hyperframes_freeform.checks.status, 'passed');

  const freeformCheckThrowRunId = `${generated.run_id}-freeform-check-throw`;
  await writeJson(path.join(rootDir, awemeId, 'agent_runs', `${freeformCheckThrowRunId}.json`), {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: freeformCheckThrowRunId,
  });
  const freeformCheckThrow = await agentRuns.checkDouyinRunHyperframesFreeformProject(awemeId, freeformCheckThrowRunId, {
    rootDir,
    hyperframesFreeformQuality: {
      checkFreeformProject: async () => {
        throw new Error('check exploded');
      },
    },
  });
  assert.equal(freeformCheckThrow.success, false);
  assert.equal(freeformCheckThrow.hyperframes_freeform.checks.status, 'failed');
  assert.match(freeformCheckThrow.hyperframes_freeform.checks.message, /check exploded|校验失败/);

  const freeformRender = await agentRuns.renderDouyinRunHyperframesFreeformVideo(awemeId, generated.run_id, {
    rootDir,
    hyperframesRenderer: {
      renderHyperframesProject: async ({ projectDir }) => {
        const outputPath = path.join(projectDir, 'output.mp4');
        fs.writeFileSync(outputPath, 'fake freeform mp4');
        return { success: true, output_path: outputPath, message: '渲染完成' };
      },
    },
  });
  assert.equal(freeformRender.success, true);
  assert.equal(freeformRender.hyperframes_freeform.render.status, 'rendered');
  assert.match(freeformRender.hyperframes_freeform.render.output_url, /hyperframes-freeform\/files\/output\.mp4/);

  const freeformRenderThrowRunId = `${generated.run_id}-freeform-render-throw`;
  await writeJson(path.join(rootDir, awemeId, 'agent_runs', `${freeformRenderThrowRunId}.json`), {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: freeformRenderThrowRunId,
  });
  const freeformRenderThrow = await agentRuns.renderDouyinRunHyperframesFreeformVideo(awemeId, freeformRenderThrowRunId, {
    rootDir,
    hyperframesRenderer: {
      renderHyperframesProject: async () => {
        throw new Error('render exploded');
      },
    },
  });
  assert.equal(freeformRenderThrow.success, false);
  assert.equal(freeformRenderThrow.hyperframes_freeform.render.status, 'failed');
  assert.match(freeformRenderThrow.hyperframes_freeform.render.message, /render exploded|渲染失败/);

  const freeformRenderStaleRunId = `${generated.run_id}-freeform-render-stale`;
  const freeformRenderStalePath = path.join(rootDir, awemeId, 'agent_runs', `${freeformRenderStaleRunId}.json`);
  const freeformRenderStaleProjectDir = path.join(rootDir, awemeId, 'agent_runs', `${freeformRenderStaleRunId}-hyperframes-freeform`);
  fs.mkdirSync(freeformRenderStaleProjectDir, { recursive: true });
  await writeJson(freeformRenderStalePath, {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: freeformRenderStaleRunId,
    hyperframes_freeform: {
      ...freeformRender.hyperframes_freeform,
      project_dir: freeformRenderStaleProjectDir,
      render: {
        ...freeformRender.hyperframes_freeform.render,
        operation_id: '',
        status: 'idle',
        output_path: '',
        output_url: '',
        message: '',
      },
    },
  });
  const staleRenderResult = await agentRuns.renderDouyinRunHyperframesFreeformVideo(awemeId, freeformRenderStaleRunId, {
    rootDir,
    hyperframesRenderer: {
      renderHyperframesProject: async ({ projectDir }) => {
        const staleRun = JSON.parse(fs.readFileSync(freeformRenderStalePath, 'utf-8'));
        staleRun.hyperframes_freeform.render.operation_id = 'newer-render-operation';
        staleRun.hyperframes_freeform.render.status = 'rendered';
        staleRun.hyperframes_freeform.render.output_path = path.join(projectDir, 'new-output.mp4');
        staleRun.hyperframes_freeform.render.output_url = '/new-output.mp4';
        staleRun.hyperframes_freeform.render.message = '较新的渲染已完成';
        await writeJson(freeformRenderStalePath, staleRun);
        return {
          success: true,
          output_path: path.join(projectDir, 'old-output.mp4'),
          message: '旧渲染完成',
        };
      },
    },
  });
  assert.equal(staleRenderResult.success, true);
  assert.equal(staleRenderResult.hyperframes_freeform.render.operation_id, 'newer-render-operation');
  assert.equal(staleRenderResult.hyperframes_freeform.render.status, 'rendered');
  assert.equal(staleRenderResult.hyperframes_freeform.render.output_path, path.join(freeformRenderStaleProjectDir, 'new-output.mp4'));
  assert.equal(staleRenderResult.hyperframes_freeform.render.output_url, '/new-output.mp4');
  const staleRenderDisk = JSON.parse(fs.readFileSync(freeformRenderStalePath, 'utf-8'));
  assert.equal(staleRenderDisk.hyperframes_freeform.render.operation_id, 'newer-render-operation');
  assert.equal(staleRenderDisk.hyperframes_freeform.render.output_path, path.join(freeformRenderStaleProjectDir, 'new-output.mp4'));
  assert.notEqual(staleRenderDisk.hyperframes_freeform.render.output_path, path.join(freeformRenderStaleProjectDir, 'old-output.mp4'));

  const freeformInspect = await agentRuns.inspectDouyinRunHyperframesFreeformVideo(awemeId, generated.run_id, {
    rootDir,
    hyperframesFreeformQuality: {
      inspectRenderedVideo: async ({ projectDir }) => {
        const sheetPath = path.join(projectDir, 'inspect', 'contact_sheet.jpg');
        fs.mkdirSync(path.dirname(sheetPath), { recursive: true });
        fs.writeFileSync(sheetPath, 'fake sheet');
        return { success: true, contact_sheet_path: sheetPath, report: { success: true, issues: [] }, message: '抽帧完成' };
      },
    },
  });
  assert.equal(freeformInspect.success, true);
  assert.equal(freeformInspect.hyperframes_freeform.visual_inspect.status, 'passed');
  const freeformContactSheetRootPath = path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}-hyperframes-freeform`, 'contact_sheet.jpg');
  assert.equal(freeformInspect.hyperframes_freeform.visual_inspect.contact_sheet_path, freeformContactSheetRootPath);
  assert.equal(fs.existsSync(freeformContactSheetRootPath), true);
  assert.equal(fs.readFileSync(freeformContactSheetRootPath, 'utf-8'), 'fake sheet');
  assert.match(freeformInspect.hyperframes_freeform.visual_inspect.contact_sheet_url, /hyperframes-freeform\/files\/contact_sheet\.jpg/);

  const freeformInspectRenderChangedRunId = `${generated.run_id}-freeform-inspect-render-changed`;
  const freeformInspectRenderChangedPath = path.join(rootDir, awemeId, 'agent_runs', `${freeformInspectRenderChangedRunId}.json`);
  const freeformInspectRenderChangedProjectDir = path.join(rootDir, awemeId, 'agent_runs', `${freeformInspectRenderChangedRunId}-hyperframes-freeform`);
  fs.mkdirSync(freeformInspectRenderChangedProjectDir, { recursive: true });
  const oldInspectOutputPath = path.join(freeformInspectRenderChangedProjectDir, 'old-output.mp4');
  const newInspectOutputPath = path.join(freeformInspectRenderChangedProjectDir, 'new-output.mp4');
  fs.writeFileSync(oldInspectOutputPath, 'old freeform mp4');
  fs.writeFileSync(newInspectOutputPath, 'new freeform mp4');
  await writeJson(freeformInspectRenderChangedPath, {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: freeformInspectRenderChangedRunId,
    hyperframes_freeform: {
      ...freeformInspect.hyperframes_freeform,
      project_dir: freeformInspectRenderChangedProjectDir,
      render: {
        ...freeformInspect.hyperframes_freeform.render,
        operation_id: '',
        status: 'rendered',
        output_path: oldInspectOutputPath,
        output_url: '/old-output.mp4',
      },
      visual_inspect: {
        ...freeformInspect.hyperframes_freeform.visual_inspect,
        operation_id: '',
        status: 'idle',
        output_path: '',
        contact_sheet_path: '',
        contact_sheet_url: '',
        message: '',
      },
    },
  });
  const staleInspectResult = await agentRuns.inspectDouyinRunHyperframesFreeformVideo(awemeId, freeformInspectRenderChangedRunId, {
    rootDir,
    hyperframesFreeformQuality: {
      inspectRenderedVideo: async ({ projectDir }) => {
        const staleRun = JSON.parse(fs.readFileSync(freeformInspectRenderChangedPath, 'utf-8'));
        staleRun.hyperframes_freeform.render.operation_id = 'newer-render-during-inspect';
        staleRun.hyperframes_freeform.render.status = 'rendered';
        staleRun.hyperframes_freeform.render.output_path = newInspectOutputPath;
        staleRun.hyperframes_freeform.render.output_url = '/new-output.mp4';
        staleRun.hyperframes_freeform.visual_inspect.status = 'idle';
        staleRun.hyperframes_freeform.visual_inspect.output_path = '';
        staleRun.hyperframes_freeform.visual_inspect.contact_sheet_path = '';
        staleRun.hyperframes_freeform.visual_inspect.contact_sheet_url = '';
        staleRun.hyperframes_freeform.visual_inspect.message = '等待新视频质检';
        await writeJson(freeformInspectRenderChangedPath, staleRun);
        const sheetPath = path.join(projectDir, 'inspect-old', 'contact_sheet.jpg');
        fs.mkdirSync(path.dirname(sheetPath), { recursive: true });
        fs.writeFileSync(sheetPath, 'old sheet');
        return { success: true, contact_sheet_path: sheetPath, report: { success: true, issues: [] }, message: '旧视频抽帧完成' };
      },
    },
  });
  assert.equal(staleInspectResult.success, false);
  assert.notEqual(staleInspectResult.hyperframes_freeform.visual_inspect.status, 'passed');
  assert.notEqual(staleInspectResult.hyperframes_freeform.visual_inspect.output_path, oldInspectOutputPath);
  assert.equal(staleInspectResult.hyperframes_freeform.visual_inspect.contact_sheet_url, '');
  const staleInspectDisk = JSON.parse(fs.readFileSync(freeformInspectRenderChangedPath, 'utf-8'));
  assert.equal(staleInspectDisk.hyperframes_freeform.render.output_path, newInspectOutputPath);
  assert.notEqual(staleInspectDisk.hyperframes_freeform.visual_inspect.status, 'passed');
  assert.notEqual(staleInspectDisk.hyperframes_freeform.visual_inspect.output_path, oldInspectOutputPath);
  assert.equal(staleInspectDisk.hyperframes_freeform.visual_inspect.contact_sheet_url, '');

  const freeformInspectSheetRaceRunId = `${generated.run_id}-freeform-inspect-sheet-race`;
  const freeformInspectSheetRacePath = path.join(rootDir, awemeId, 'agent_runs', `${freeformInspectSheetRaceRunId}.json`);
  const freeformInspectSheetRaceProjectDir = path.join(rootDir, awemeId, 'agent_runs', `${freeformInspectSheetRaceRunId}-hyperframes-freeform`);
  fs.mkdirSync(freeformInspectSheetRaceProjectDir, { recursive: true });
  const sheetRaceOldOutputPath = path.join(freeformInspectSheetRaceProjectDir, 'old-output.mp4');
  const sheetRaceNewOutputPath = path.join(freeformInspectSheetRaceProjectDir, 'new-output.mp4');
  const sheetRaceRootContactSheetPath = path.join(freeformInspectSheetRaceProjectDir, 'contact_sheet.jpg');
  fs.writeFileSync(sheetRaceOldOutputPath, 'old freeform mp4');
  fs.writeFileSync(sheetRaceNewOutputPath, 'new freeform mp4');
  fs.writeFileSync(sheetRaceRootContactSheetPath, 'new sheet');
  await writeJson(freeformInspectSheetRacePath, {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: freeformInspectSheetRaceRunId,
    hyperframes_freeform: {
      ...freeformInspect.hyperframes_freeform,
      project_dir: freeformInspectSheetRaceProjectDir,
      render: {
        ...freeformInspect.hyperframes_freeform.render,
        operation_id: '',
        status: 'rendered',
        output_path: sheetRaceOldOutputPath,
        output_url: '/old-output.mp4',
      },
      visual_inspect: {
        ...freeformInspect.hyperframes_freeform.visual_inspect,
        operation_id: '',
        status: 'idle',
        output_path: '',
        contact_sheet_path: '',
        contact_sheet_url: '',
        message: '',
      },
    },
  });
  const sheetRaceResult = await agentRuns.inspectDouyinRunHyperframesFreeformVideo(awemeId, freeformInspectSheetRaceRunId, {
    rootDir,
    hyperframesFreeformQuality: {
      inspectRenderedVideo: async ({ projectDir }) => {
        const staleRun = JSON.parse(fs.readFileSync(freeformInspectSheetRacePath, 'utf-8'));
        staleRun.hyperframes_freeform.render.operation_id = 'newer-render-before-old-inspect-finished';
        staleRun.hyperframes_freeform.render.status = 'rendered';
        staleRun.hyperframes_freeform.render.output_path = sheetRaceNewOutputPath;
        staleRun.hyperframes_freeform.render.output_url = '/new-output.mp4';
        staleRun.hyperframes_freeform.visual_inspect.operation_id = 'newer-inspect-operation';
        staleRun.hyperframes_freeform.visual_inspect.status = 'passed';
        staleRun.hyperframes_freeform.visual_inspect.output_path = sheetRaceNewOutputPath;
        staleRun.hyperframes_freeform.visual_inspect.contact_sheet_path = sheetRaceRootContactSheetPath;
        staleRun.hyperframes_freeform.visual_inspect.contact_sheet_url = '/new-contact-sheet.jpg';
        staleRun.hyperframes_freeform.visual_inspect.message = '新视频质检通过';
        await writeJson(freeformInspectSheetRacePath, staleRun);
        const oldSheetPath = path.join(projectDir, 'inspect-old-race', 'contact_sheet.jpg');
        fs.mkdirSync(path.dirname(oldSheetPath), { recursive: true });
        fs.writeFileSync(oldSheetPath, 'old sheet');
        return { success: true, contact_sheet_path: oldSheetPath, report: { success: true, issues: [] }, message: '旧视频抽帧完成' };
      },
    },
  });
  assert.equal(sheetRaceResult.success, true);
  assert.equal(fs.readFileSync(sheetRaceRootContactSheetPath, 'utf-8'), 'new sheet');
  assert.equal(sheetRaceResult.hyperframes_freeform.visual_inspect.status, 'passed');
  assert.equal(sheetRaceResult.hyperframes_freeform.visual_inspect.output_path, sheetRaceNewOutputPath);
  assert.equal(sheetRaceResult.hyperframes_freeform.visual_inspect.contact_sheet_path, sheetRaceRootContactSheetPath);
  assert.equal(sheetRaceResult.hyperframes_freeform.visual_inspect.contact_sheet_url, '/new-contact-sheet.jpg');
  const sheetRaceDisk = JSON.parse(fs.readFileSync(freeformInspectSheetRacePath, 'utf-8'));
  assert.equal(sheetRaceDisk.hyperframes_freeform.render.output_path, sheetRaceNewOutputPath);
  assert.equal(sheetRaceDisk.hyperframes_freeform.visual_inspect.status, 'passed');
  assert.equal(sheetRaceDisk.hyperframes_freeform.visual_inspect.output_path, sheetRaceNewOutputPath);
  assert.equal(sheetRaceDisk.hyperframes_freeform.visual_inspect.contact_sheet_url, '/new-contact-sheet.jpg');
  assert.equal(fs.readFileSync(sheetRaceRootContactSheetPath, 'utf-8'), 'new sheet');

  const freeformInspectPublishFailRunId = `${generated.run_id}-freeform-inspect-publish-fail`;
  const freeformInspectPublishFailProjectDir = path.join(rootDir, awemeId, 'agent_runs', `${freeformInspectPublishFailRunId}-hyperframes-freeform`);
  fs.mkdirSync(freeformInspectPublishFailProjectDir, { recursive: true });
  const freeformInspectPublishFailOutputPath = path.join(freeformInspectPublishFailProjectDir, 'output.mp4');
  const freeformInspectPublishFailSheetPath = path.join(freeformInspectPublishFailProjectDir, 'inspect', 'contact_sheet.jpg');
  fs.writeFileSync(freeformInspectPublishFailOutputPath, 'fake freeform mp4');
  fs.mkdirSync(path.dirname(freeformInspectPublishFailSheetPath), { recursive: true });
  fs.writeFileSync(freeformInspectPublishFailSheetPath, 'candidate sheet');
  await writeJson(path.join(rootDir, awemeId, 'agent_runs', `${freeformInspectPublishFailRunId}.json`), {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: freeformInspectPublishFailRunId,
    hyperframes_freeform: {
      ...freeformInspect.hyperframes_freeform,
      project_dir: freeformInspectPublishFailProjectDir,
      render: {
        ...freeformInspect.hyperframes_freeform.render,
        output_path: freeformInspectPublishFailOutputPath,
      },
      visual_inspect: {
        ...freeformInspect.hyperframes_freeform.visual_inspect,
        contact_sheet_path: '/stale/contact_sheet.jpg',
        contact_sheet_url: '/stale/contact_sheet.jpg',
      },
    },
  });
  const originalCopyFile = fs.promises.copyFile;
  let copyFilePatched = false;
  let freeformInspectPublishFail;
  try {
    fs.promises.copyFile = async (source, target) => {
      if (source === freeformInspectPublishFailSheetPath && target === path.join(freeformInspectPublishFailProjectDir, 'contact_sheet.jpg')) {
        copyFilePatched = true;
        throw new Error('copy failed during publish');
      }
      return originalCopyFile(source, target);
    };
    freeformInspectPublishFail = await agentRuns.inspectDouyinRunHyperframesFreeformVideo(awemeId, freeformInspectPublishFailRunId, {
      rootDir,
      hyperframesFreeformQuality: {
        inspectRenderedVideo: async () => ({
          success: true,
          contact_sheet_path: freeformInspectPublishFailSheetPath,
          report: { success: true, issues: [] },
          message: '抽帧完成',
        }),
      },
    });
  } finally {
    fs.promises.copyFile = originalCopyFile;
  }
  assert.equal(copyFilePatched, true);
  assert.equal(freeformInspectPublishFail.success, false);
  assert.match(freeformInspectPublishFail.message, /联系表预览文件准备失败|copy failed during publish/);
  assert.equal(freeformInspectPublishFail.hyperframes_freeform.visual_inspect.status, 'failed');
  assert.equal(freeformInspectPublishFail.hyperframes_freeform.visual_inspect.contact_sheet_path, '');
  assert.equal(freeformInspectPublishFail.hyperframes_freeform.visual_inspect.contact_sheet_url, '');
  const freeformInspectPublishFailDisk = JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${freeformInspectPublishFailRunId}.json`), 'utf-8'));
  assert.equal(freeformInspectPublishFailDisk.hyperframes_freeform.visual_inspect.status, 'failed');
  assert.equal(freeformInspectPublishFailDisk.hyperframes_freeform.visual_inspect.contact_sheet_path, '');
  assert.equal(freeformInspectPublishFailDisk.hyperframes_freeform.visual_inspect.contact_sheet_url, '');

  const freeformInspectMissingSheetRunId = `${generated.run_id}-freeform-inspect-missing-sheet`;
  const freeformInspectMissingSheetProjectDir = path.join(rootDir, awemeId, 'agent_runs', `${freeformInspectMissingSheetRunId}-hyperframes-freeform`);
  fs.mkdirSync(freeformInspectMissingSheetProjectDir, { recursive: true });
  const freeformInspectMissingSheetOutputPath = path.join(freeformInspectMissingSheetProjectDir, 'output.mp4');
  fs.writeFileSync(freeformInspectMissingSheetOutputPath, 'fake freeform mp4');
  await writeJson(path.join(rootDir, awemeId, 'agent_runs', `${freeformInspectMissingSheetRunId}.json`), {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: freeformInspectMissingSheetRunId,
    hyperframes_freeform: {
      ...freeformInspect.hyperframes_freeform,
      project_dir: freeformInspectMissingSheetProjectDir,
      visual_inspect: {
        ...freeformInspect.hyperframes_freeform.visual_inspect,
        contact_sheet_path: '/stale/contact_sheet.jpg',
        contact_sheet_url: '/stale/contact_sheet.jpg',
      },
      render: {
        ...freeformInspect.hyperframes_freeform.render,
        output_path: freeformInspectMissingSheetOutputPath,
      },
    },
  });
  const freeformInspectMissingSheet = await agentRuns.inspectDouyinRunHyperframesFreeformVideo(awemeId, freeformInspectMissingSheetRunId, {
    rootDir,
    hyperframesFreeformQuality: {
      inspectRenderedVideo: async () => ({
        success: true,
        report: { success: true, issues: [] },
        message: '抽帧完成',
      }),
    },
  });
  assert.equal(freeformInspectMissingSheet.success, false);
  assert.equal(freeformInspectMissingSheet.hyperframes_freeform.visual_inspect.status, 'failed');
  assert.match(freeformInspectMissingSheet.hyperframes_freeform.visual_inspect.message, /联系表文件不存在/);
  assert.equal(freeformInspectMissingSheet.hyperframes_freeform.visual_inspect.contact_sheet_path, '');
  assert.equal(freeformInspectMissingSheet.hyperframes_freeform.visual_inspect.contact_sheet_url, '');

  const freeformInspectMissingOutputRunId = `${generated.run_id}-freeform-inspect-missing-output`;
  const freeformInspectMissingOutputProjectDir = path.join(rootDir, awemeId, 'agent_runs', `${freeformInspectMissingOutputRunId}-hyperframes-freeform`);
  await writeJson(path.join(rootDir, awemeId, 'agent_runs', `${freeformInspectMissingOutputRunId}.json`), {
    ...JSON.parse(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}.json`), 'utf-8')),
    run_id: freeformInspectMissingOutputRunId,
    hyperframes_freeform: {
      ...freeformInspect.hyperframes_freeform,
      project_dir: freeformInspectMissingOutputProjectDir,
      render: {
        ...freeformInspect.hyperframes_freeform.render,
        output_path: '',
      },
    },
  });
  fs.mkdirSync(freeformInspectMissingOutputProjectDir, { recursive: true });
  let freeformInspectMissingOutputCalled = false;
  const freeformInspectMissingOutput = await agentRuns.inspectDouyinRunHyperframesFreeformVideo(awemeId, freeformInspectMissingOutputRunId, {
    rootDir,
    hyperframesFreeformQuality: {
      inspectRenderedVideo: async () => {
        freeformInspectMissingOutputCalled = true;
        return { success: true };
      },
    },
  });
  assert.equal(freeformInspectMissingOutput.success, false);
  assert.equal(freeformInspectMissingOutputCalled, false);
  assert.equal(freeformInspectMissingOutput.hyperframes_freeform.visual_inspect.status, 'failed');

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
  const originalCreateDouyinHyperframesFreeformRun = agentRuns.createDouyinHyperframesFreeformRun;
  const originalSynthesizeDouyinRunTts = agentRuns.synthesizeDouyinRunTts;
  const originalSynthesizeDouyinRunSceneTts = agentRuns.synthesizeDouyinRunSceneTts;
  const originalCreateDouyinRunStoryboard = agentRuns.createDouyinRunStoryboard;
  const originalCreateDouyinRunVisualStoryboard = agentRuns.createDouyinRunVisualStoryboard;
  const originalCreateDouyinRunHyperframesProject = agentRuns.createDouyinRunHyperframesProject;
  const originalRenderDouyinRunHyperframesVideo = agentRuns.renderDouyinRunHyperframesVideo;
  const originalGenerateDouyinRunHyperframesFreeformBrief = agentRuns.generateDouyinRunHyperframesFreeformBrief;
  const originalSynthesizeDouyinRunHyperframesFreeformAudio = agentRuns.synthesizeDouyinRunHyperframesFreeformAudio;
  const originalGenerateDouyinRunHyperframesFreeformProject = agentRuns.generateDouyinRunHyperframesFreeformProject;
  const originalCheckDouyinRunHyperframesFreeformProject = agentRuns.checkDouyinRunHyperframesFreeformProject;
  const originalRenderDouyinRunHyperframesFreeformVideo = agentRuns.renderDouyinRunHyperframesFreeformVideo;
  const originalInspectDouyinRunHyperframesFreeformVideo = agentRuns.inspectDouyinRunHyperframesFreeformVideo;
  const originalResolveDouyinRunHyperframesFreeformFile = agentRuns.resolveDouyinRunHyperframesFreeformFile;
  const originalSaveDouyinRunHyperframesFreeformFile = agentRuns.saveDouyinRunHyperframesFreeformFile;
  const originalGetDouyinAgentRun = agentRuns.getDouyinAgentRun;
  const originalDecideNextAction = agentRuns.decideNextAction;
  const originalCompressDouyinRunSceneNarration = agentRuns.compressDouyinRunSceneNarration;
  const creativeContextForRoute = {
    input: { mode: 'text', raw_text: '本地创作方向', use_research: false, asset_ids: [] },
    source_context: { status: 'ready', kind: 'text', summary: '本地创作方向' },
    research_context: { status: 'disabled', sources: [] },
    asset_context: { status: 'disabled', assets: [] },
  };
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
  agentRuns.createDouyinHyperframesFreeformRun = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'freeform-run',
    template: 'hyperframes_freeform',
    status: 'ready',
    hyperframes_freeform: { status: 'idle' },
    message: '已新建高级成片记录，可以开始生成导演策划。',
  });
  agentRuns.synthesizeDouyinRunSceneTts = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    message: '分段配音已生成。',
    scene_tts: { status: 'done', timed_storyboard_plan: { status: 'timed', captions: [{ index: 1 }] } },
    workflow: { next_action: 'generate_visual_storyboard' },
  });
  agentRuns.compressDouyinRunSceneNarration = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    message: '超时口播已自动压缩，请继续生成分段配音。',
    storyboard_plan: {
      status: 'planned',
      narration_budget: { status: 'ok' },
      scenes: [{ index: 1, narration_text: '压缩后' }],
    },
    workflow: { next_action: 'synthesize_scene_tts' },
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
  agentRuns.generateDouyinRunHyperframesFreeformBrief = async (routeAwemeId, routeRunId, options = {}) => {
    assert.strictEqual(routeAwemeId, awemeId);
    assert.strictEqual(routeRunId, 'ok-run');
    assert.strictEqual(options.briefOptions.tone, 'route brief');
    assert.deepStrictEqual(options.briefOptions.creative_context, creativeContextForRoute);
    return {
      success: true,
      aweme_id: routeAwemeId,
      run_id: routeRunId,
      message: '自由工程导演策划已生成。',
      hyperframes_freeform: { brief: { status: 'ready' } },
    };
  };
  agentRuns.synthesizeDouyinRunHyperframesFreeformAudio = async (routeAwemeId, routeRunId, options = {}) => {
    assert.strictEqual(routeAwemeId, awemeId);
    assert.strictEqual(routeRunId, 'ok-run');
    assert.strictEqual(options.voice, 'Mia');
    assert.strictEqual(options.stylePrompt, 'route audio');
    return {
      success: true,
      aweme_id: routeAwemeId,
      run_id: routeRunId,
      message: '高级成片音频已生成。',
      hyperframes_freeform: { audio: { status: 'ready', voice: 'Mia' } },
    };
  };
  agentRuns.generateDouyinRunHyperframesFreeformProject = async (routeAwemeId, routeRunId, options = {}) => {
    assert.strictEqual(routeAwemeId, awemeId);
    assert.strictEqual(routeRunId, 'ok-run');
    assert.strictEqual(options.projectOptions.theme, 'route project');
    assert.deepStrictEqual(options.projectOptions.creative_context, creativeContextForRoute);
    return {
      success: true,
      aweme_id: routeAwemeId,
      run_id: routeRunId,
      message: '自由工程已生成。',
      hyperframes_freeform: { project: { status: 'ready' } },
    };
  };
  agentRuns.checkDouyinRunHyperframesFreeformProject = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    message: '自由工程校验通过。',
    hyperframes_freeform: { checks: { status: 'passed' } },
  });
  agentRuns.renderDouyinRunHyperframesFreeformVideo = async (routeAwemeId, routeRunId, options = {}) => {
    assert.strictEqual(routeAwemeId, awemeId);
    assert.strictEqual(routeRunId, 'ok-run');
    assert.deepStrictEqual(options.renderOptions, { fps: 30 });
    return {
      success: true,
      aweme_id: routeAwemeId,
      run_id: routeRunId,
      message: '自由视频渲染完成。',
      hyperframes_freeform: { render: { status: 'rendered' } },
    };
  };
  agentRuns.inspectDouyinRunHyperframesFreeformVideo = async () => ({
    success: true,
    aweme_id: awemeId,
    run_id: 'ok-run',
    message: '自由视频巡检通过。',
    hyperframes_freeform: { visual_inspect: { status: 'passed' } },
  });
  agentRuns.resolveDouyinRunHyperframesFreeformFile = (routeAwemeId, routeRunId, fileName) => {
    assert.strictEqual(routeAwemeId, awemeId);
    assert.strictEqual(routeRunId, 'ok-run');
    assert.strictEqual(fileName, 'index.html');
    const projectDir = path.join(rootDir, awemeId, 'agent_runs', 'ok-run-hyperframes-freeform');
    fs.mkdirSync(projectDir, { recursive: true });
    const filePath = path.join(projectDir, 'index.html');
    fs.writeFileSync(filePath, '<html>route freeform</html>', 'utf-8');
    return filePath;
  };
  agentRuns.saveDouyinRunHyperframesFreeformFile = async (routeAwemeId, routeRunId, fileName, body) => {
    assert.strictEqual(routeAwemeId, awemeId);
    assert.strictEqual(routeRunId, 'ok-run');
    assert.strictEqual(fileName, 'index.html');
    assert.strictEqual(body.content, '<html>saved route freeform</html>');
    const filePath = path.join(rootDir, awemeId, 'agent_runs', 'ok-run-hyperframes-freeform', 'index.html');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body.content, 'utf-8');
    return { success: true, aweme_id: routeAwemeId, run_id: routeRunId, name: fileName, path: filePath };
  };
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

    const freeformRunResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/hyperframes-freeform-runs`, {});
    assert.strictEqual(freeformRunResponse.statusCode, 200);
    assert.strictEqual(freeformRunResponse.body.success, true);
    assert.strictEqual(freeformRunResponse.body.template, 'hyperframes_freeform');

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

    const compressNarrationResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/compress-narration`, {});
    assert.strictEqual(compressNarrationResponse.statusCode, 200);
    assert.strictEqual(compressNarrationResponse.body.success, true);
    assert.strictEqual(compressNarrationResponse.body.storyboard_plan.narration_budget.status, 'ok');
    assert.strictEqual(compressNarrationResponse.body.workflow.next_action, 'synthesize_scene_tts');

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

    const freeformBriefResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes-freeform/brief`, {
      tone: 'route brief',
      creative_context: creativeContextForRoute,
    });
    assert.strictEqual(freeformBriefResponse.statusCode, 200);
    assert.strictEqual(freeformBriefResponse.body.success, true);
    assert.strictEqual(freeformBriefResponse.body.hyperframes_freeform.brief.status, 'ready');

    const freeformAudioResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes-freeform/audio`, {
      voice: 'Mia',
      stylePrompt: 'route audio',
    });
    assert.strictEqual(freeformAudioResponse.statusCode, 200);
    assert.strictEqual(freeformAudioResponse.body.success, true);
    assert.strictEqual(freeformAudioResponse.body.hyperframes_freeform.audio.status, 'ready');

    const freeformProjectResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes-freeform/project`, {
      theme: 'route project',
      creative_context: creativeContextForRoute,
    });
    assert.strictEqual(freeformProjectResponse.statusCode, 200);
    assert.strictEqual(freeformProjectResponse.body.success, true);
    assert.strictEqual(freeformProjectResponse.body.hyperframes_freeform.project.status, 'ready');

    const freeformCheckResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes-freeform/check`, {});
    assert.strictEqual(freeformCheckResponse.statusCode, 200);
    assert.strictEqual(freeformCheckResponse.body.success, true);
    assert.strictEqual(freeformCheckResponse.body.hyperframes_freeform.checks.status, 'passed');

    const freeformRenderResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes-freeform/render`, {
      fps: 30,
    });
    assert.strictEqual(freeformRenderResponse.statusCode, 200);
    assert.strictEqual(freeformRenderResponse.body.success, true);
    assert.strictEqual(freeformRenderResponse.body.hyperframes_freeform.render.status, 'rendered');

    const freeformInspectResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes-freeform/inspect`, {});
    assert.strictEqual(freeformInspectResponse.statusCode, 200);
    assert.strictEqual(freeformInspectResponse.body.success, true);
    assert.strictEqual(freeformInspectResponse.body.hyperframes_freeform.visual_inspect.status, 'passed');

    const freeformFileResponse = await requestText(server, 'GET', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes-freeform/files/index.html`);
    assert.strictEqual(freeformFileResponse.statusCode, 200);
    assert.strictEqual(freeformFileResponse.body, '<html>route freeform</html>');

    const saveFreeformFileResponse = await requestJson(server, 'PUT', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes-freeform/files/index.html`, {
      content: '<html>saved route freeform</html>',
    });
    assert.strictEqual(saveFreeformFileResponse.statusCode, 200);
    assert.strictEqual(saveFreeformFileResponse.body.success, true);
    assert.strictEqual(
      fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', 'ok-run-hyperframes-freeform', 'index.html'), 'utf-8'),
      '<html>saved route freeform</html>',
    );
  } finally {
    agentRuns.createDouyinAgentRun = originalCreateDouyinAgentRun;
    agentRuns.createDouyinStoryboardPlanRun = originalCreateDouyinStoryboardPlanRun;
    agentRuns.createDouyinHyperframesFreeformRun = originalCreateDouyinHyperframesFreeformRun;
    agentRuns.synthesizeDouyinRunTts = originalSynthesizeDouyinRunTts;
    agentRuns.synthesizeDouyinRunSceneTts = originalSynthesizeDouyinRunSceneTts;
    agentRuns.createDouyinRunStoryboard = originalCreateDouyinRunStoryboard;
    agentRuns.createDouyinRunVisualStoryboard = originalCreateDouyinRunVisualStoryboard;
    agentRuns.createDouyinRunHyperframesProject = originalCreateDouyinRunHyperframesProject;
    agentRuns.renderDouyinRunHyperframesVideo = originalRenderDouyinRunHyperframesVideo;
    agentRuns.generateDouyinRunHyperframesFreeformBrief = originalGenerateDouyinRunHyperframesFreeformBrief;
    agentRuns.synthesizeDouyinRunHyperframesFreeformAudio = originalSynthesizeDouyinRunHyperframesFreeformAudio;
    agentRuns.generateDouyinRunHyperframesFreeformProject = originalGenerateDouyinRunHyperframesFreeformProject;
    agentRuns.checkDouyinRunHyperframesFreeformProject = originalCheckDouyinRunHyperframesFreeformProject;
    agentRuns.renderDouyinRunHyperframesFreeformVideo = originalRenderDouyinRunHyperframesFreeformVideo;
    agentRuns.inspectDouyinRunHyperframesFreeformVideo = originalInspectDouyinRunHyperframesFreeformVideo;
    agentRuns.resolveDouyinRunHyperframesFreeformFile = originalResolveDouyinRunHyperframesFreeformFile;
    agentRuns.saveDouyinRunHyperframesFreeformFile = originalSaveDouyinRunHyperframesFreeformFile;
    agentRuns.getDouyinAgentRun = originalGetDouyinAgentRun;
    agentRuns.decideNextAction = originalDecideNextAction;
    agentRuns.compressDouyinRunSceneNarration = originalCompressDouyinRunSceneNarration;
    await new Promise(resolve => server.close(resolve));
  }
}

run().then(() => {
  console.log('agent run tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
