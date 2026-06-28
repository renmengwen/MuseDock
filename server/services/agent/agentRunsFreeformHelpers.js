const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mediaPipeline = require('../mediaPipeline');
const narrationBudget = require('../storyboard/storyboardNarrationBudget');
const narrationQuality = require('../creative-video/narrationQuality');

// ponytail: 两个纯小助手与 agentRuns 各持一份，避免为它们改全局调用点
function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function getAgentRunsDir(awemeId, rootDir) {
  return path.join(mediaPipeline.getMediaDir(awemeId, rootDir), 'agent_runs');
}

async function removePathBestEffort(targetPath) {
  if (!targetPath) return;
  try {
    await fsp.rm(targetPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup should not mask the main generation result.
  }
}

function getAgentRunsRootDir(awemeId, rootDir) {
  return path.resolve(getAgentRunsDir(awemeId, rootDir));
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function validateFreeformTempProjectDir({ tempDir, finalDir, awemeId, rootDir, tempRunId, operationId }) {
  const tempPath = path.resolve(String(tempDir || ''));
  const finalPath = path.resolve(String(finalDir || ''));
  if (!tempPath || tempPath === finalPath) {
    throw new Error('HyperFrames 临时工程目录不安全：不能使用正式工程目录。');
  }

  const agentRunsRoot = getAgentRunsRootDir(awemeId, rootDir);
  if (!isPathInside(agentRunsRoot, tempPath)) {
    throw new Error('HyperFrames 临时工程目录不安全：目录不在当前运行目录内。');
  }

  const baseName = path.basename(tempPath);
  if (!baseName.includes(String(tempRunId || '')) || !baseName.includes(String(operationId || ''))) {
    throw new Error('HyperFrames 临时工程目录不安全：目录不属于当前生成任务。');
  }

  return tempPath;
}

async function cleanupFreeformTempProjectDir(context) {
  let tempPath;
  try {
    tempPath = validateFreeformTempProjectDir(context);
  } catch {
    return false;
  }
  await removePathBestEffort(tempPath);
  return true;
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function publishFreeformProjectDirectory({ tempDir, finalDir, operationId, awemeId, rootDir, tempRunId }) {
  const safeTempDir = validateFreeformTempProjectDir({ tempDir, finalDir, awemeId, rootDir, tempRunId, operationId });
  const backupDir = `${finalDir}.backup-${operationId || crypto.randomBytes(3).toString('hex')}`;
  let hasBackup = false;
  await fsp.mkdir(path.dirname(finalDir), { recursive: true });

  try {
    await fsp.rm(backupDir, { recursive: true, force: true });
    if (await pathExists(finalDir)) {
      await fsp.rename(finalDir, backupDir);
      hasBackup = true;
    }
    await fsp.rename(safeTempDir, finalDir);
    if (hasBackup) await removePathBestEffort(backupDir);
  } catch (error) {
    if (!error || error.code !== 'EXDEV') {
      try {
        if (!(await pathExists(finalDir)) && hasBackup && await pathExists(backupDir)) {
          await fsp.rename(backupDir, finalDir);
          hasBackup = false;
        }
      } catch {
        // Restore is best-effort; the thrown publish error below remains the actionable failure.
      }
      throw new Error(`HyperFrames 工程发布失败：${error?.message || '无法替换正式工程目录'}`);
    }

    try {
      await fsp.cp(safeTempDir, finalDir, { recursive: true });
      await cleanupFreeformTempProjectDir({ tempDir: safeTempDir, finalDir, awemeId, rootDir, tempRunId, operationId });
      if (hasBackup) await removePathBestEffort(backupDir);
    } catch (copyError) {
      try {
        await removePathBestEffort(finalDir);
        if (hasBackup && await pathExists(backupDir)) {
          await fsp.rename(backupDir, finalDir);
          hasBackup = false;
        }
      } catch {
        // Restore is best-effort; report the original copy failure clearly.
      }
      throw new Error(`HyperFrames 工程发布失败：${copyError.message || '无法复制正式工程目录'}`);
    }
  }
}

function mapFreeformProjectFilesToDir(files = [], projectDir) {
  return Array.isArray(files)
    ? files.map(file => ({
      ...file,
      path: file?.name ? path.join(projectDir, file.name) : file?.path,
    }))
    : [];
}

function normalizeFreeformNarrationScenes(brief = {}) {
  const storyboard = brief?.storyboard;
  const rawScenes = Array.isArray(storyboard?.scenes)
    ? storyboard.scenes
    : (Array.isArray(storyboard) ? storyboard : []);
  const scenes = rawScenes
    .map((scene, index) => ({
      ...scene,
      index: Number(scene?.index || index + 1),
      narration_text: String(
        scene?.narration_text
        || scene?.narration
        || scene?.voiceover
        || scene?.script
        || '',
      ).trim(),
    }))
    .filter(scene => scene.narration_text);

  if (scenes.length) return scenes;
  const narration = String(brief?.narration || '').trim();
  return narration ? [{ index: 1, narration_text: narration }] : [];
}

function resolveFreeformTargetDurationSec(brief = {}, run = {}, options = {}) {
  return firstPositiveNumber(
    options.targetDurationSec,
    options.target_duration_sec,
    brief.target_duration_sec,
    brief.targetDurationSec,
    run?.result?.video_brief?.target_duration_sec,
    run?.result?.videoBrief?.targetDurationSec,
    60,
  );
}

function freeformStoryboardPlanForBudget(brief = {}, scenes = [], targetDurationSec = 60) {
  const totalChars = scenes.reduce((sum, scene) => (
    sum + narrationBudget.countNarrationChars(scene?.narration_text || '')
  ), 0);
  const target = firstPositiveNumber(targetDurationSec, 60);
  return {
    target_duration_sec: target,
    scenes: scenes.map((scene, index) => {
      const sceneTarget = firstPositiveNumber(
        scene?.target_duration_sec,
        scene?.targetDurationSec,
        totalChars ? (target * narrationBudget.countNarrationChars(scene?.narration_text || '') / totalChars) : 0,
        target / Math.max(1, scenes.length),
      );
      return {
        ...scene,
        index: Number(scene?.index || index + 1),
        target_duration_sec: sceneTarget,
      };
    }),
  };
}

function replaceFreeformBriefScenes(brief = {}, scenes = [], narrationBudgetReport = null) {
  const sceneByIndex = new Map(scenes.map((scene, index) => [Number(scene.index || index + 1), scene]));
  const applyScene = (scene, index) => {
    const replacement = sceneByIndex.get(Number(scene?.index || index + 1));
    if (!replacement) return scene;
    const nextScene = { ...scene, narration_text: replacement.narration_text };
    if (replacement.captions != null) nextScene.captions = replacement.captions;
    if (replacement.target_duration_sec != null) nextScene.target_duration_sec = replacement.target_duration_sec;
    if (replacement.targetDurationSec != null) nextScene.targetDurationSec = replacement.targetDurationSec;
    return nextScene;
  };
  const storyboard = brief?.storyboard;
  const nextBrief = { ...brief, narration_budget: narrationBudgetReport };
  if (Array.isArray(storyboard?.scenes)) {
    nextBrief.storyboard = { ...storyboard, scenes: storyboard.scenes.map(applyScene) };
    return nextBrief;
  }
  if (Array.isArray(storyboard)) {
    nextBrief.storyboard = storyboard.map(applyScene);
    return nextBrief;
  }
  if (scenes[0]?.narration_text) nextBrief.narration = scenes[0].narration_text;
  return nextBrief;
}

function fitFreeformNarrationToBudget(brief = {}, scenes = [], targetDurationSec = 60) {
  const plan = freeformStoryboardPlanForBudget(brief, scenes, targetDurationSec);
  const budget = narrationBudget.buildNarrationBudget(plan);
  if (budget.status !== 'too_long') {
    return { scenes, brief: replaceFreeformBriefScenes(brief, scenes, budget), budget, changed: false };
  }
  const target = firstPositiveNumber(targetDurationSec, 60);
  const maxChars = Math.floor(target * narrationBudget.DEFAULT_CHARS_PER_SECOND);
  const totalChars = scenes.reduce((sum, scene) => (
    sum + narrationBudget.countNarrationChars(scene?.narration_text || '')
  ), 0);

  if (totalChars <= maxChars) {
    const retimedScenes = scenes.map(scene => {
      const next = { ...scene };
      delete next.target_duration_sec;
      delete next.targetDurationSec;
      return next;
    });
    const retimedPlan = freeformStoryboardPlanForBudget(brief, retimedScenes, target);
    const nextScenes = scenes.map((scene, index) => ({
      ...scene,
      target_duration_sec: retimedPlan.scenes[index]?.target_duration_sec || scene.target_duration_sec,
    }));
    const nextPlan = freeformStoryboardPlanForBudget(brief, nextScenes, target);
    const nextBudget = narrationBudget.buildNarrationBudget(nextPlan);
    return {
      scenes: nextScenes,
      brief: replaceFreeformBriefScenes(brief, nextScenes, nextBudget),
      budget: nextBudget,
      changed: false,
    };
  }

  return {
    scenes,
    brief: replaceFreeformBriefScenes(brief, scenes, budget),
    budget,
    changed: false,
    needsCompression: true,
  };
}

function buildFreeformNarrationCompressionMessages({ scenes = [], budget = {}, transcriptText = '', targetDurationSec = 60 } = {}) {
  return [
    {
      role: 'system',
      content: [
        '你是短视频旁白压缩 Agent。',
        '你的任务是把过长分镜旁白压缩到目标时长内，同时保留完整语义。',
        '只能返回 JSON 对象，不要 Markdown、解释或额外文本。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '请压缩以下 storyboard 旁白。',
        '',
        `目标总时长：${targetDurationSec} 秒。`,
        `建议总字数上限：${budget.max_recommended_chars || Math.floor(Number(targetDurationSec || 60) * narrationBudget.DEFAULT_CHARS_PER_SECOND)} 字。`,
        '',
        '当前预算：',
        JSON.stringify(budget, null, 2),
        '',
        '当前 scenes：',
        JSON.stringify(scenes.map(scene => ({
          index: scene.index,
          headline: scene.headline || '',
          duration_sec: scene.duration_sec || scene.target_duration_sec || '',
          narration_text: scene.narration_text || '',
        })), null, 2),
        '',
        '来源材料 transcript：',
        String(transcriptText || '').slice(0, 12000) || '（无）',
        '',
        '输出要求：',
        '1. 返回所有需要替换的 scenes，格式：{"scenes":[{"index":1,"narration_text":"压缩后的完整旁白"}]}。',
        '2. 每段 narration_text 必须是完整中文口播，不能出现半句、残词、文件名截断或只有铺垫没有落点。',
        '3. 不要只按字符截断；必须改写压缩，保留主要信息和观点。',
        '4. 不要写镜头说明、音效、停顿或语速指令。',
      ].join('\n'),
    },
  ];
}

function buildFreeformNarrationRepairMessages({ scenes = [], issues = [], transcriptText = '', targetDurationSec = 60 } = {}) {
  return [
    {
      role: 'system',
      content: [
        '你是短视频旁白修复 Agent。',
        '你的任务是修复被质量门标记为半句、悬空或结尾不完整的旁白。',
        '只能返回 JSON 对象，不要 Markdown、解释或额外文本。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '请修复以下 storyboard 中的问题旁白。',
        '',
        `目标总时长：${targetDurationSec} 秒。`,
        '',
        '问题：',
        JSON.stringify(issues, null, 2),
        '',
        '当前 scenes：',
        JSON.stringify(scenes.map(scene => ({
          index: scene.index,
          headline: scene.headline || '',
          narration_text: scene.narration_text || '',
        })), null, 2),
        '',
        '来源材料 transcript：',
        String(transcriptText || '').slice(0, 12000) || '（无）',
        '',
        '输出要求：',
        '1. 只返回需要替换的 scenes，格式：{"scenes":[{"index":2,"narration_text":"修复后的完整旁白"}]}。',
        '2. 不要删除信息，不要写镜头说明，不要写语气/停顿指令。',
        '3. 修复后的 narration_text 必须是完整、可直接配音的中文口播。',
        '4. 优先根据 transcript 补齐语义落点；如果原句是对照铺垫，必须补出“今天/现在/未来”的后半句。',
      ].join('\n'),
    },
  ];
}

function extractRepairScenes(parsed = {}) {
  if (Array.isArray(parsed.scenes)) return parsed.scenes;
  if (Array.isArray(parsed.storyboard?.scenes)) return parsed.storyboard.scenes;
  return [];
}

function applyFreeformNarrationRepairs(scenes = [], repairs = []) {
  const byIndex = new Map((Array.isArray(repairs) ? repairs : [])
    .map(scene => [Number(scene?.index), String(scene?.narration_text || '').trim()])
    .filter(([index, text]) => Number.isFinite(index) && index > 0 && text));
  if (!byIndex.size) return { scenes, changed: false };
  return {
    changed: true,
    scenes: scenes.map((scene, index) => {
      const sceneIndex = Number(scene.index || index + 1);
      const narrationText = byIndex.get(sceneIndex);
      if (!narrationText) return scene;
      return {
        ...scene,
        narration_text: narrationText,
        captions: Array.isArray(scene.captions) && scene.captions.length
          ? scene.captions.map((caption, captionIndex) => (captionIndex === 0 ? { ...caption, text: narrationText } : caption))
          : scene.captions,
      };
    }),
  };
}

async function compressFreeformNarrationWithModel({ modelService, freeformAgent, scenes, budget, transcriptText, targetDurationSec } = {}) {
  const messages = buildFreeformNarrationCompressionMessages({ scenes, budget, transcriptText, targetDurationSec });
  const response = await modelService.callTextModel({ messages });
  if (!response || response.success === false) {
    return { success: false, message: response?.message || '旁白压缩失败。' };
  }
  const parsed = freeformAgent.parseFreeformBriefResponse(response.text || response.content || '');
  if (!parsed.success) return parsed;
  const applied = applyFreeformNarrationRepairs(scenes, extractRepairScenes(parsed.brief));
  if (!applied.changed) return { success: false, message: '旁白压缩结果缺少可用 scenes。' };
  const validation = narrationQuality.validateNarrationScenes(applied.scenes);
  if (!validation.ok) return { success: false, message: validation.message, issues: validation.issues };
  const nextPlan = freeformStoryboardPlanForBudget({}, applied.scenes, targetDurationSec);
  const nextBudget = narrationBudget.buildNarrationBudget(nextPlan);
  if (nextBudget.status === 'too_long') {
    return {
      success: false,
      message: `压缩后的旁白仍超过目标时长：预计 ${nextBudget.estimated_total_duration_sec} 秒，目标 ${nextBudget.target_duration_sec} 秒。`,
      budget: nextBudget,
    };
  }
  return { success: true, scenes: applied.scenes, budget: nextBudget };
}

async function repairFreeformNarrationWithModel({ modelService, freeformAgent, scenes, issues, transcriptText, targetDurationSec } = {}) {
  const messages = buildFreeformNarrationRepairMessages({ scenes, issues, transcriptText, targetDurationSec });
  const response = await modelService.callTextModel({ messages });
  if (!response || response.success === false) {
    return { success: false, message: response?.message || '旁白修复失败。' };
  }
  const parsed = freeformAgent.parseFreeformBriefResponse(response.text || response.content || '');
  if (!parsed.success) return parsed;
  const applied = applyFreeformNarrationRepairs(scenes, extractRepairScenes(parsed.brief));
  if (!applied.changed) return { success: false, message: '旁白修复结果缺少可用 scenes。' };
  const validation = narrationQuality.validateNarrationScenes(applied.scenes);
  if (!validation.ok) return { success: false, message: validation.message, issues: validation.issues };
  return { success: true, scenes: applied.scenes };
}

module.exports = {
  normalizeFreeformNarrationScenes,
  resolveFreeformTargetDurationSec,
  freeformStoryboardPlanForBudget,
  replaceFreeformBriefScenes,
  fitFreeformNarrationToBudget,
  buildFreeformNarrationCompressionMessages,
  buildFreeformNarrationRepairMessages,
  extractRepairScenes,
  applyFreeformNarrationRepairs,
  compressFreeformNarrationWithModel,
  repairFreeformNarrationWithModel,
  removePathBestEffort,
  isPathInside,
  pathExists,
  getAgentRunsRootDir,
  validateFreeformTempProjectDir,
  cleanupFreeformTempProjectDir,
  publishFreeformProjectDirectory,
  mapFreeformProjectFilesToDir,
};
