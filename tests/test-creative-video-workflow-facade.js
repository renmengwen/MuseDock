const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const facade = require('../server/services/creative-video/workflowFacade');
const { computeSceneSpecSpeechHash } = require('../server/services/creative-video/sceneSpecHash');

// 单引擎收敛后：facade 只有 html-video production 一条路，不再有 rich/legacy 兜底。
(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-facade-test-'));

  // 1) html-video 一键成功：不应调用 legacy/spec 模型（scene_spec 由 voiced storyboard 复用或 html-video 内部处理）。
  let shortCircuitModelCalls = 0;
  const shortCircuitResult = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000008',
    runId: 'run_008',
    creativeContext: {
      input: { raw_text: '短路测试' },
      brief: {
        title: '短路测试',
        storyboard: {
          scenes: [{
            id: 'scene_01',
            order: 1,
            kind: 'text',
            narration_text: '旁白',
            visual_text: { headline: '标题', keywords: [], cards: [] },
          }],
        },
      },
      audio: {
        status: 'ready',
        path: path.join(tmpDir, 'short-circuit-audio.mp3'),
        scenes: [{
          scene_id: 'scene_01',
          index: 1,
          duration: 4,
          captions: [{ id: 'cap_01', start: 0, end: 4, text: '旁白' }],
        }],
      },
    },
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async ({ sceneSpec }) => {
          assert.equal(sceneSpec.title, '短路测试');
          assert.equal(sceneSpec.scenes[0].id, 'scene_01');
          assert.equal(sceneSpec.scenes[0].duration, 4);
          assert.equal(sceneSpec.scenes[0].narration_text, '旁白');
          return {
            success: true,
            render_mode: 'html-video',
            html_video_project_path: tmpDir,
            project: { frames: [{ id: 'scene_01' }] },
            scene_spec: sceneSpec,
          };
        },
      },
      aiTextModel: {
        callTextModel: async () => {
          shortCircuitModelCalls += 1;
          throw new Error('html-video 一键成功时不应调用 spec 模型');
        },
      },
    },
  });
  assert.equal(shortCircuitResult.success, true);
  assert.equal(shortCircuitResult.render_mode, 'html-video');
  assert.equal(shortCircuitModelCalls, 0);

  // 2) onProgress 事件转发给 html-video workflow。
  const facadeProgressEvents = [];
  let facadeForwardedOnProgress = false;
  const htmlVideoProgressResult = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000004_progress',
    runId: 'run_progress',
    creativeContext: { input: { raw_text: '测试进度' } },
    onProgress: event => facadeProgressEvents.push(event),
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async ({ onProgress }) => {
          facadeForwardedOnProgress = typeof onProgress === 'function';
          onProgress?.({ type: 'html_video_graph_started', stage: 'project', message: '正在生成内容图...' });
          return {
            success: true,
            message: 'html-video 成片完成。',
            render_mode: 'html-video',
            html_video_project_path: tmpDir,
            project_dir: tmpDir,
            project: { frames: [] },
            files: [],
          };
        },
      },
      aiTextModel: {
        callTextModel: async () => ({
          success: true,
          text: JSON.stringify({
            scene_spec: {
              title: '测试进度',
              aspect_ratio: '9:16',
              scenes: [{ id: 'scene_01', duration: 2, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '进度', keywords: [], cards: [] } }],
            },
          }),
        }),
      },
    },
  });
  assert.equal(htmlVideoProgressResult.success, true);
  assert.equal(facadeForwardedOnProgress, true);
  assert.ok(facadeProgressEvents.some(event => event.type === 'html_video_graph_started'));

  // 3) 已配音分镜：scene_spec 直接复用，不重新漂移，html-video 收到 10 个原始镜头。
  const voicedStoryboard = {
    title: '已配音分镜',
    storyboard: {
      scenes: Array.from({ length: 10 }, (_, index) => ({
        id: `scene_${String(index + 1).padStart(2, '0')}`,
        index: index + 1,
        duration: 1,
        headline: `第 ${index + 1} 帧`,
        narration_text: `第 ${index + 1} 段旁白`,
        captions: [{ id: `cap_${index + 1}`, start: 0, end: 1, text: `第 ${index + 1} 段字幕` }],
      })),
    },
  };
  let htmlVideoSceneSpec = null;
  let htmlVideoCreativeContext = null;
  let htmlVideoServices = null;
  let driftSceneSpecCalls = 0;
  const voicedStoryboardResult = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000004_voiced_storyboard',
    runId: 'run_voiced_storyboard',
    creativeContext: {
      input: { raw_text: '已有配音分镜，不应重新漂移' },
      brief: voicedStoryboard,
      audio: {
        status: 'ready',
        source: 'scene_tts',
        path: path.join(tmpDir, 'voiced-storyboard.wav'),
        scenes: voicedStoryboard.storyboard.scenes.map(scene => ({
          id: scene.id,
          index: scene.index,
          duration: scene.index === 1 ? 1.4 : scene.duration,
          captions: scene.index === 1
            ? [{ start: 0, end: 1.4, duration: 1.4, text: '第 1 段 TTS 字幕' }]
            : [],
        })),
      },
    },
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async ({ sceneSpec, creativeContext, services }) => {
          htmlVideoSceneSpec = sceneSpec;
          htmlVideoCreativeContext = creativeContext;
          htmlVideoServices = services;
          return {
            success: true,
            message: 'html-video 成片完成。',
            render_mode: 'html-video',
            html_video_project_path: tmpDir,
            project_dir: tmpDir,
            project: { frames: [] },
            files: [],
          };
        },
      },
      aiTextModel: {
        callTextModel: async () => {
          driftSceneSpecCalls += 1;
          throw new Error('已有配音分镜时不应重新生成 scene_spec');
        },
      },
    },
  });
  assert.equal(voicedStoryboardResult.success, true);
  assert.equal(driftSceneSpecCalls, 0);
  assert.equal(htmlVideoSceneSpec.scenes.length, 10);
  assert.deepEqual(htmlVideoSceneSpec.scenes.map(scene => scene.id), voicedStoryboard.storyboard.scenes.map(scene => scene.id));
  assert.equal(htmlVideoSceneSpec.scenes[0].narration_text, '第 1 段旁白');
  assert.deepEqual(htmlVideoSceneSpec.scenes[0].captions, [{ id: 'cap_01', start: 0, end: 1.4, text: '第 1 段 TTS 字幕' }]);
  assert.equal(htmlVideoSceneSpec.scenes[0].visual_text.headline, '第 1 帧');
  assert.equal(typeof htmlVideoServices.ttsService.synthesizeSceneNarration, 'function');
  assert.equal(htmlVideoCreativeContext.audio.source, 'scene_spec');
  assert.equal(htmlVideoCreativeContext.audio.scene_spec_hash, computeSceneSpecSpeechHash(htmlVideoSceneSpec));
  assert.equal(htmlVideoCreativeContext.audio.scene_count, 10);
  assert.deepEqual(htmlVideoCreativeContext.audio.scene_ids, htmlVideoSceneSpec.scenes.map(scene => scene.id));

  // 4) 已配音但分镜没有字幕：时长取自 TTS speech_duration_sec，字幕补齐。
  const uncaptionedStoryboard = {
    title: '无字幕分镜',
    storyboard: {
      scenes: [
        {
          id: 'scene_01',
          index: 1,
          duration_sec: 6,
          headline: '真实 TTS 更长',
          narration_text: '这是一段已经完成配音的旁白。',
        },
      ],
    },
  };
  let uncaptionedSceneSpec = null;
  const uncaptionedStoryboardResult = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000004_uncaptioned_storyboard',
    runId: 'run_uncaptioned_storyboard',
    creativeContext: {
      input: { raw_text: '已有配音但分镜没有字幕' },
      brief: uncaptionedStoryboard,
      audio: {
        status: 'ready',
        source: 'scene_tts',
        path: path.join(tmpDir, 'uncaptioned-storyboard.wav'),
        scenes: [
          {
            id: 'scene_01',
            index: 1,
            speech_duration_sec: 13.996,
            actual_duration_sec: 231.04,
            raw_duration_sec: 231.04,
            captions: [{ start: 0, end: 13.996, duration: 13.996, text: '这是一段已经完成配音的旁白。' }],
          },
        ],
      },
    },
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async ({ sceneSpec }) => {
          uncaptionedSceneSpec = sceneSpec;
          return {
            success: true,
            message: 'html-video 成片完成。',
            render_mode: 'html-video',
            html_video_project_path: tmpDir,
            project_dir: tmpDir,
            project: { frames: [] },
            files: [],
          };
        },
      },
      aiTextModel: {
        callTextModel: async () => {
          throw new Error('已有配音分镜时不应重新生成 scene_spec');
        },
      },
    },
  });
  assert.equal(uncaptionedStoryboardResult.success, true);
  assert.equal(uncaptionedSceneSpec.scenes[0].duration, 14);
  assert.notEqual(uncaptionedSceneSpec.scenes[0].duration, 231.04);
  assert.deepEqual(uncaptionedSceneSpec.scenes[0].captions, [
    {
      id: 'cap_01',
      start: 0,
      end: 14,
      text: '这是一段已经完成配音的旁白。',
    },
  ]);

  // 5) html-video 失败：直接返回失败，render_mode 仍为 html-video，不再回退 legacy。
  const failed = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000006',
    runId: 'run_006',
    creativeContext: { input: { raw_text: '测试主题' } },
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async () => ({
          success: false,
          message: 'html-video 模拟失败。',
          fallback_allowed: true,
          html_video_diagnostics: [{ code: 'render_failed', stage: 'render', user_message: '首帧渲染失败。', details: {}, fallback_allowed: true }],
        }),
      },
      aiTextModel: {
        callTextModel: async () => ({ success: true, text: JSON.stringify({ scene_spec: { title: '测试', aspect_ratio: '16:9', scenes: [{ id: 'scene_01', duration: 8, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: [] } }] } }) }),
      },
    },
  });
  assert.equal(failed.success, false);
  assert.equal(failed.render_mode, 'html-video');
  assert.ok(failed.html_video_diagnostics.some(item => item.user_message === '首帧渲染失败。'));

  console.log('creative video workflow facade tests passed');
})();
