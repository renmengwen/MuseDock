const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRuns = require('../server/services/agentRuns');

(async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-incomplete-'));
  const awemeId = '20260626024518995316';
  const runId = 'run-incomplete-narration';
  const runDir = path.join(rootDir, awemeId, 'agent_runs');
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(path.join(runDir, `${runId}.json`), JSON.stringify({
    success: true,
    run_id: runId,
    template: 'hyperframes_freeform',
    aweme_id: awemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 60 } },
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: '旁白完整性测试',
          storyboard: {
            scenes: [
              { index: 1, narration_text: '写Card、Popover或Modal时，你可能遇到过这种情况：明明有' },
              { index: 2, narration_text: '问题不在 border 本身，而在语义不匹配。' },
            ],
          },
        },
      },
    },
  }, null, 2));

  let ttsCalled = false;
  const result = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(awemeId, runId, {
    rootDir,
    aiTextModel: {
      callTextModel: async () => ({ success: false, message: '修复失败' }),
    },
    sceneTtsService: {
      synthesizeSceneTts: async () => {
        ttsCalled = true;
        return { success: true };
      },
    },
  });

  assert.equal(result.success, false);
  assert.equal(ttsCalled, false);
  assert.match(result.message, /旁白不完整|半句/);

  const persisted = JSON.parse(fs.readFileSync(path.join(runDir, `${runId}.json`), 'utf8'));
  assert.equal(persisted.hyperframes_freeform.audio.status, 'failed');
  assert.match(persisted.hyperframes_freeform.audio.message, /旁白不完整|半句/);

  const conditionalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-conditional-fragment-'));
  const conditionalAwemeId = '20260626061707994797';
  const conditionalRunId = 'run-conditional-fragment';
  const conditionalRunDir = path.join(conditionalRoot, conditionalAwemeId, 'agent_runs');
  fs.mkdirSync(conditionalRunDir, { recursive: true });
  fs.writeFileSync(path.join(conditionalRunDir, `${conditionalRunId}.json`), JSON.stringify({
    success: true,
    run_id: conditionalRunId,
    template: 'hyperframes_freeform',
    aweme_id: conditionalAwemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 60 } },
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: '条件句残片测试',
          storyboard: {
            scenes: [
              { index: 1, narration_text: '如果你正在启动新项目。' },
              { index: 2, narration_text: 'npm 完全够用，关键是团队统一。' },
            ],
          },
        },
      },
    },
  }, null, 2));

  let conditionalTtsCalled = false;
  const conditionalResult = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(conditionalAwemeId, conditionalRunId, {
    rootDir: conditionalRoot,
    aiTextModel: {
      callTextModel: async () => ({ success: false, message: '修复失败' }),
    },
    sceneTtsService: {
      synthesizeSceneTts: async () => {
        conditionalTtsCalled = true;
        return { success: true };
      },
    },
  });

  assert.equal(conditionalResult.success, false);
  assert.equal(conditionalTtsCalled, false);
  assert.match(conditionalResult.message, /旁白不完整|半句/);

  const finalContrastRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-final-contrast-fragment-'));
  const finalContrastAwemeId = '20260626123937322103';
  const finalContrastRunId = 'run-final-contrast-fragment';
  const finalContrastRunDir = path.join(finalContrastRoot, finalContrastAwemeId, 'agent_runs');
  fs.mkdirSync(finalContrastRunDir, { recursive: true });
  fs.writeFileSync(path.join(finalContrastRoot, finalContrastAwemeId, 'transcript.json'), JSON.stringify({
    success: true,
    text: [
      '十年前。',
      '学习 Webpack 是前端进阶的必经之路。',
      '而今天。',
      '学习 Vite、理解现代构建工具的发展方向，可能会成为新的必修课。',
    ].join('\n\n'),
  }, null, 2));
  fs.writeFileSync(path.join(finalContrastRunDir, `${finalContrastRunId}.json`), JSON.stringify({
    success: true,
    run_id: finalContrastRunId,
    template: 'hyperframes_freeform',
    aweme_id: finalContrastAwemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 60 } },
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: '结尾对照句测试',
          storyboard: {
            scenes: [
              { index: 1, narration_text: 'Vite 正在成为新项目的默认选择。' },
              { index: 2, narration_text: '十年前，Webpack是前端进阶的必经之路。' },
            ],
          },
        },
      },
    },
  }, null, 2));

  let finalContrastCaptured = null;
  let finalContrastRepairCalls = 0;
  const finalContrastResult = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(finalContrastAwemeId, finalContrastRunId, {
    rootDir: finalContrastRoot,
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        finalContrastRepairCalls += 1;
        assert.match(messages.map(item => item.content).join('\n'), /旁白修复|十年前，Webpack是前端进阶的必经之路/);
        return {
          success: true,
          text: JSON.stringify({
            scenes: [
              {
                index: 2,
                narration_text: '十年前，Webpack是前端进阶的必经之路；而今天，Vite 正在成为新的必修课。',
              },
            ],
          }),
        };
      },
    },
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes }) => {
        finalContrastCaptured = scenes;
        return {
          success: true,
          scene_tts: {
            status: 'done',
            duration: 8,
            scenes: scenes.map(scene => ({
              index: scene.index,
              duration: 4,
              speech_duration_sec: 4,
              narration_text: scene.narration_text,
              captions: [{ start: 0, end: 4, text: scene.narration_text }],
            })),
          },
        };
      },
    },
  });

  assert.equal(finalContrastResult.success, true);
  assert.equal(finalContrastRepairCalls, 1);
  assert.equal(finalContrastCaptured[1].narration_text, '十年前，Webpack是前端进阶的必经之路；而今天，Vite 正在成为新的必修课。');
  const finalContrastPersisted = JSON.parse(fs.readFileSync(path.join(finalContrastRunDir, `${finalContrastRunId}.json`), 'utf8'));
  assert.equal(
    finalContrastPersisted.hyperframes_freeform.brief.data.storyboard.scenes[1].narration_text,
    '十年前，Webpack是前端进阶的必经之路；而今天，Vite 正在成为新的必修课。',
  );

  const overBudgetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-over-budget-'));
  const overBudgetAwemeId = '20260626145315505694';
  const overBudgetRunId = 'run-over-budget';
  const overBudgetRunDir = path.join(overBudgetRoot, overBudgetAwemeId, 'agent_runs');
  fs.mkdirSync(overBudgetRunDir, { recursive: true });
  const overBudgetScenes = [
    {
      index: 1,
      duration_sec: 6,
      narration_text: 'Claude Code 之父自己的 CLAUDE.md就两行。一行是提 PR 自动合并，一行是提 PR 发审批频道。没了。',
    },
    {
      index: 2,
      duration_sec: 7,
      narration_text: '我看到这个的时候第一反应是，我那几千 token 的 CLAUDE.md 是不是全白写了。',
    },
    {
      index: 3,
      duration_sec: 9,
      narration_text: '他的原话是，当系统提示你的配置已经几千 token 时，直接删掉重写。用最少的东西把模型拉回正轨，跑偏了再一点点加。你会发现每换一代模型，需要加的越来越少。',
    },
    {
      index: 4,
      duration_sec: 8,
      narration_text: '这跟大部分人的本能完全相反。我们拿到新工具的第一件事就是堆配置、堆规则、堆脚手架，生怕漏了什么。但他说这是过度工程化。',
    },
    {
      index: 5,
      duration_sec: 9,
      narration_text: '他们团队真正的规则写在代码库里，全队每周共建。看到队友犯了可避免的错，直接让 Claude 在 PR 上把规则加进去。不是一个人闷头写一份巨长的个人配置，而是让规则长在协作里。',
    },
    {
      index: 6,
      duration_sec: 7,
      narration_text: '同样的逻辑也解释了为什么 Claude Code 坚持做 CLI 不做 GUI。因为模型进步太快，做不出一个半年后还不过时的界面。CLI 反而是最轻的壳，模型能力变了，壳不用换。',
    },
    {
      index: 7,
      duration_sec: 8,
      narration_text: '还有个细节让我印象很深。他说自己查一个内存泄漏，做 heap dump、开 DevTools、翻代码翻了半天没搞定。队友直接把问题丢给 Claude Code，它自己写了个小工具分析 heap dump，比他更快找到了泄漏点。',
    },
    {
      index: 8,
      duration_sec: 6,
      narration_text: '造这个工具的人，用这个工具的方式比我们还轻。一句话总结他的哲学就是，模型在飞涨，人的最优策略不是堆配置堆工具，是做减法、保持轻，把判断让给越来越强的模型，然后不断推翻自己过时的使用习惯。',
    },
  ];
  fs.writeFileSync(path.join(overBudgetRunDir, `${overBudgetRunId}.json`), JSON.stringify({
    success: true,
    run_id: overBudgetRunId,
    template: 'hyperframes_freeform',
    aweme_id: overBudgetAwemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 60 } },
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: '超预算旁白测试',
          target_duration_sec: 60,
          storyboard: { scenes: overBudgetScenes },
        },
      },
    },
  }, null, 2));

  let overBudgetRepairCalls = 0;
  let overBudgetCaptured = null;
  const overBudgetResult = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(overBudgetAwemeId, overBudgetRunId, {
    rootDir: overBudgetRoot,
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        overBudgetRepairCalls += 1;
        assert.match(messages.map(item => item.content).join('\n'), /压缩|目标总时长：60 秒/);
        return {
          success: true,
          text: JSON.stringify({
            scenes: [
              { index: 1, narration_text: 'Claude Code 之父的 CLAUDE.md 只有两条规则：提 PR 自动合并，提 PR 发审批频道。' },
              { index: 2, narration_text: '我第一反应是：我那几千 token 的配置，是不是写重了。' },
              { index: 3, narration_text: '他的建议很狠：配置堆到几千 token，就删掉重写，用最少规则把模型拉回正轨。' },
              { index: 4, narration_text: '这和我们的本能相反。我们总想先堆规则，但那往往只是过度工程。' },
              { index: 5, narration_text: '他们真正的规则长在代码库里，由团队每周共建，而不是一个人闷头写巨长配置。' },
              { index: 6, narration_text: 'Claude Code 坚持 CLI 也是同一套逻辑：模型变化太快，壳越轻越不容易过时。' },
              { index: 7, narration_text: '连排查内存泄漏，他也承认队友把问题丢给 Claude Code 后，工具自己写分析脚本更快。' },
              { index: 8, narration_text: '所以重点不是堆配置，而是保持轻，让更强的模型接管更多判断。' },
            ],
          }),
        };
      },
    },
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes }) => {
        overBudgetCaptured = scenes;
        return {
          success: true,
          scene_tts: {
            status: 'done',
            duration: 40,
            scenes: scenes.map(scene => ({
              index: scene.index,
              duration: 5,
              speech_duration_sec: 5,
              narration_text: scene.narration_text,
              captions: [{ start: 0, end: 5, text: scene.narration_text }],
            })),
          },
        };
      },
    },
  });

  assert.equal(overBudgetResult.success, true);
  assert.equal(overBudgetRepairCalls, 1);
  assert.equal(overBudgetCaptured[0].narration_text, 'Claude Code 之父的 CLAUDE.md 只有两条规则：提 PR 自动合并，提 PR 发审批频道。');
  assert.equal(overBudgetCaptured[1].narration_text, '我第一反应是：我那几千 token 的配置，是不是写重了。');
  assert.notEqual(overBudgetCaptured[0].narration_text, 'ClaudeCode之父自己的CLAUDE.m。');
  assert.notEqual(overBudgetCaptured[1].narration_text, '我看到这个的时候第一反应是。');

  console.log('agent runs incomplete narration tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
