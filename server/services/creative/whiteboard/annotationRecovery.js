const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const { WhiteboardError, sha256, canonicalJson, canvasFor, HANDWRITTEN_PRESET_ID } = require('./contracts');
const store = require('./mediaStore');
const mediaTools = require('./mediaTools');
const models = require('./mediaModels');

function recoverableAnnotationAttempts(media) {
  if (media.stage !== 'annotation_drafting' || media.current.annotation_drafting) return [];
  const latest = new Map();
  for (const attempt of media.attempts) {
    if (attempt.stage === 'annotation_drafting') latest.set(attempt.sceneId, attempt);
  }
  return [...latest.values()].filter(attempt => attempt.status === 'failed' && attempt.received?.candidate
    && !media.annotations[attempt.sceneId] && !media.lowCoverage?.some(entry => entry.sceneId === attempt.sceneId));
}

// 只使用已登记且校验过的候选恢复本地预览；不调用模型，不代替人工接受。
async function recoverAnnotationPreviews(record, artifact, options, now, sceneId) {
  const media = record.whiteboard.media;
  const attempts = recoverableAnnotationAttempts(media).filter(attempt => !sceneId || attempt.sceneId === sceneId);
  if (!attempts.length) throw new WhiteboardError('ACTION_NOT_ALLOWED', '没有可恢复的落墨预览，请刷新任务后检查当前分镜。', 409);
  const tools = options.services?.whiteboardMediaTools || mediaTools;
  const runtime = await tools.preflight({ ...options.mediaOptions, aspectRatio: artifact.aspectRatio || '16:9', visualStyle: artifact.visualStyle });
  if (sha256(runtime.recipe) !== sha256(media.recipe)) {
    throw new WhiteboardError('RENDER_CONFIG_CHANGED', '绘制环境已变化，无法按原版本恢复预览，请重新确认制作设置。', 409);
  }
  const narration = await store.validateBinding(record, media.current.full_narration, options.rootDir);
  const timing = await store.readData(record, narration.timeline, options.rootDir);
  const canvas = canvasFor(artifact.aspectRatio);
  const prepared = [];
  // 先核对所有输入，禁止把旧候选套到已经修改的线稿或时间线上。
  for (const previous of attempts) {
    const scene = timing.scenes.find(item => item.id === previous.sceneId);
    if (!scene) throw new WhiteboardError('STALE_IDENTITY', '原落墨候选对应的分镜已变化，请重新编排。', 409);
    const lineart = await store.validateBinding(record, media.lineart[scene.id], options.rootDir);
    const revision = media.overrides[`annotation_drafting:${scene.id}`] || '';
    const input = { scene, cues: timing.cues.filter(cue => scene.cueIds.includes(cue.id)), revision, canvas,
      imageSha256: lineart.image.sha256, timingIdentity: narration.identity, visualStyle: artifact.visualStyle,
      imageTexts: artifact.scenes.find(item => item.id === scene.id)?.imageTexts };
    const contracts = artifact.visualStyle.id === HANDWRITTEN_PRESET_ID ? [models.HANDWRITTEN_ANNOTATION_CONTRACT]
      : [models.ANNOTATION_PLANNING_CONTRACT, models.LEGACY_ANNOTATION_PLANNING_CONTRACT];
    const matching = contracts
      .map(contract => models.annotationInput(input, contract)).find(value => value.inputIdentity === previous.inputIdentity);
    if (!matching) {
      throw new WhiteboardError('STALE_IDENTITY', `${scene.title} 的线稿、时间线或编排要求已变化，请重新编排该幕。`, 409);
    }
    const saved = await store.mediaFile(record, previous.received.candidate, options.rootDir);
    if (saved.artifact.kind !== 'annotation_candidate' || saved.artifact.sceneId !== scene.id || saved.artifact.attemptId !== previous.id) {
      throw new WhiteboardError('ARTIFACT_INVALID', '已保存的编排候选与当前分镜不匹配，无法恢复预览。', 409);
    }
    const candidate = await store.readData(record, previous.received.candidate, options.rootDir);
    const annotation = models.materializeAnnotation(candidate, scene, lineart.image.sha256, narration.identity, canvas, artifact.visualStyle);
    prepared.push({ previous, scene, lineart, revision, ...matching, candidate, candidateFile: saved.path, annotation });
  }
  for (const entry of prepared) {
    const { previous, scene, lineart, revision, inputIdentity, planningContract, candidate, candidateFile, annotation } = entry;
    const attempt = { id: crypto.randomUUID(), stage: 'annotation_drafting', sceneId: scene.id,
      external: false, inputIdentity, recoveredFromAttemptId: previous.id, createdAt: now };
    const directory = store.workDirectory(record.workflow_id, attempt.id, options.rootDir);
    await fsp.mkdir(directory, { recursive: true });
    const annotationFile = path.join(directory, 'annotation.json');
    const preview = path.join(directory, 'annotation-preview.png');
    const resultPreview = path.join(directory, 'annotation-result.png');
    await fsp.writeFile(annotationFile, canonicalJson(annotation), { flag: 'wx' });
    let coverage;
    try {
      coverage = await tools.python('annotation-preview', {
        image: (await store.mediaFile(record, lineart.image, options.rootDir)).path, annotation,
        font: runtime.font, output: preview, resultOutput: resultPreview,
      }, options.mediaOptions);
    } catch (error) {
      if (error.code !== 'ANNOTATION_COVERAGE_LOW') throw error;
      coverage = { ...error.coverage, coverageRatio: error.coverageRatio, regions: annotation.elements.length };
    }
    if (!Number.isFinite(coverage?.coverageRatio) || coverage.coverageRatio < 0 || coverage.coverageRatio > 1
      || !await fsp.stat(preview).then(stat => stat.isFile(), () => false)
      || !await fsp.stat(resultPreview).then(stat => stat.isFile(), () => false)) {
      throw new WhiteboardError('ANNOTATION_PREVIEW_FAILED', `${scene.title} 的预览未能完整恢复，请重新编排该幕。`);
    }
    // 新恢复版本使用独立目录，保留失败尝试及其原始文件；发布与任务写入共用工作流锁。
    const files = {};
    for (const [key, source, kind, name, mime] of [
      ['candidate', candidateFile, 'annotation_candidate', '区域候选', 'application/json'],
      ['annotation', annotationFile, 'annotation', `${scene.title}落墨编排`, 'application/json'],
      ['preview', preview, 'annotation_preview', `${scene.title}区域预览`, 'image/png'],
      ['resultPreview', resultPreview, 'annotation_result', `${scene.title}当前落墨效果`, 'image/png'],
    ]) {
      files[key] = await store.publishFile(record, attempt, source, { kind, name, sceneId: scene.id, mime, rootDir: options.rootDir });
    }
    const low = coverage.coverageRatio < 0.97;
    const { candidate: _candidateFile, ...previews } = files;
    const binding = { sceneId: scene.id, inputIdentity, planningContract,
      visualGrouping: candidate.visualGrouping, ...previews, coverage };
    if (low) (media.lowCoverage ||= []).push(store.bind({ kind: 'annotation_coverage_review', ...binding,
      title: scene.title, attemptId: attempt.id, lineartIdentity: lineart.identity, narrationIdentity: narration.identity, revision }));
    else media.annotations[scene.id] = store.bind({ kind: 'annotation', ...binding });
    media.attempts.push({ ...attempt, received: files, status: low ? 'failed' : 'validated', completedAt: now,
      ...(low ? { errorCode: 'ANNOTATION_COVERAGE_LOW' } : {}) });
  }
  return prepared.length;
}

module.exports = { recoverableAnnotationAttempts, recoverAnnotationPreviews };
