const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { WhiteboardError, canonicalJson, canvasFor, sha256, HANDWRITTEN_PRESET_ID } = require('./contracts');
const store = require('./mediaStore');
const models = require('./mediaModels');
const mediaTools = require('./mediaTools');

// 客户端只提交原区域 ID、顺序与矩形。图像、时钟、保护区与多边形从当前产物派生。
function editedCandidate(annotation, binding, edits, visualStyle) {
  const elements = annotation.elements;
  if (!Array.isArray(edits) || edits.length !== elements.length || new Set(edits.map(e => e?.id)).size !== elements.length) {
    throw new WhiteboardError('INVALID_INPUT', '请保留全部区域，每个区域只能出现一次。');
  }
  const handwritten = visualStyle.id === HANDWRITTEN_PRESET_ID;
  const weights = elements.map(e => Math.max(1, e.reveal.durationMs - (handwritten ? 100 : 0)));
  const maxWeight = Math.max(...weights);
  return { schemaVersion: handwritten ? 3 : 2, visualGrouping: binding.visualGrouping,
    elements: edits.map(edit => {
      const index = elements.findIndex(e => e.id === edit?.id);
      if (index < 0) throw new WhiteboardError('INVALID_INPUT', '区域编号已变化，请重新打开编辑器。');
      const original = elements[index];
      const from = original.region; const to = edit.region;
      const canvas = annotation.canvas;
      if (!to || Object.keys(to).some(key => !['x', 'y', 'width', 'height'].includes(key))
        || ['x', 'y', 'width', 'height'].some(key => !Number.isInteger(to[key]))
        || to.x < 0 || to.y < 0 || to.width < 1 || to.height < 1
        || to.x + to.width > canvas.width || to.y + to.height > canvas.height) {
        throw new WhiteboardError('INVALID_INPUT', '落墨区域必须是画布范围内的整数矩形。');
      }
      const transform = ([x, y]) => [to.x + Math.round((x - from.x) * (to.width - 1) / Math.max(1, from.width - 1)),
        to.y + Math.round((y - from.y) * (to.height - 1) / Math.max(1, from.height - 1))];
      return { label: original.label, region: to, direction: original.reveal.direction,
        weight: weights[index] / maxWeight * 100,
        ...(original.polygon ? { polygon: original.polygon.map(transform) } : {}),
        // 保护区使用画布绝对坐标，保持其对原图墨迹的保护，不随外框移动。
        protectedRegions: original.reveal.protectedRegions || [] };
    }) };
}

async function saveAnnotation(record, artifact, payload, options, now) {
  const media = record.whiteboard.media;
  const previous = media.annotations[payload.sceneId] || media.lowCoverage?.find(e => e.sceneId === payload.sceneId);
  if (!previous || previous.identity !== payload.expectedAnnotationIdentity) {
    throw new WhiteboardError('STALE_IDENTITY', '本幕落墨编排已变化，请重新打开详情后再修改。', 409);
  }
  await store.validateBinding(record, previous, options.rootDir);
  const original = await store.readData(record, previous.annotation, options.rootDir);
  const narration = await store.validateBinding(record, media.current.full_narration, options.rootDir);
  const timing = await store.readData(record, narration.timeline, options.rootDir);
  const scene = timing.scenes.find(e => e.id === payload.sceneId);
  const lineart = await store.validateBinding(record, media.lineart[payload.sceneId], options.rootDir);
  const canvas = canvasFor(artifact.aspectRatio);
  if (!scene || original.imageSha256 !== lineart.image.sha256 || original.timingIdentity !== narration.identity
    || original.sceneDurationMs !== scene.endMs - scene.startMs || canonicalJson(original.canvas) !== canonicalJson(canvas)) {
    throw new WhiteboardError('STALE_IDENTITY', '本幕线稿或时间轴已变化，请重新编排。', 409);
  }
  const candidate = editedCandidate(original, previous, payload.elements, artifact.visualStyle);
  const annotation = models.materializeAnnotation(candidate, scene, lineart.image.sha256, narration.identity, canvas, artifact.visualStyle);
  const revision = media.overrides[`annotation_drafting:${scene.id}`] || '';
  const { inputIdentity, planningContract } = models.annotationInput({ scene,
    cues: timing.cues.filter(cue => scene.cueIds.includes(cue.id)), revision, canvas,
    imageSha256: lineart.image.sha256, timingIdentity: narration.identity, visualStyle: artifact.visualStyle,
    imageTexts: artifact.scenes.find(e => e.id === scene.id)?.imageTexts });
  const tools = options.services?.whiteboardMediaTools || mediaTools;
  const runtime = await tools.preflight({ ...options.mediaOptions, aspectRatio: artifact.aspectRatio || '16:9', visualStyle: artifact.visualStyle });
  if (sha256(runtime.recipe) !== sha256(media.recipe)) throw new WhiteboardError('RENDER_CONFIG_CHANGED', '绘制环境已变化，请重新确认制作设置。', 409);
  const attempt = { id: crypto.randomUUID(), stage: 'annotation_drafting', sceneId: scene.id, external: false,
    inputIdentity, editedFromIdentity: previous.identity, createdAt: now };
  const directory = store.workDirectory(record.workflow_id, attempt.id, options.rootDir);
  await fs.mkdir(directory, { recursive: true });
  const candidateFile = path.join(directory, 'candidate.json');
  const annotationFile = path.join(directory, 'annotation.json');
  const preview = path.join(directory, 'annotation-preview.png');
  const resultPreview = path.join(directory, 'annotation-result.png');
  await fs.writeFile(candidateFile, canonicalJson(candidate), { flag: 'wx' });
  await fs.writeFile(annotationFile, canonicalJson(annotation), { flag: 'wx' });
  let coverage;
  try {
    coverage = await tools.python('annotation-preview', { image: (await store.mediaFile(record, lineart.image, options.rootDir)).path,
      annotation, font: runtime.font, output: preview, resultOutput: resultPreview }, options.mediaOptions);
  } catch (error) {
    if (error.code !== 'ANNOTATION_COVERAGE_LOW') throw error;
    coverage = { ...error.coverage, coverageRatio: error.coverageRatio, regions: annotation.elements.length };
  }
  if (!Number.isFinite(coverage?.coverageRatio) || coverage.coverageRatio < 0 || coverage.coverageRatio > 1
    || !await fs.stat(preview).then(s => s.isFile(), () => false)
    || !await fs.stat(resultPreview).then(s => s.isFile(), () => false)) {
    throw new WhiteboardError('ANNOTATION_PREVIEW_FAILED', '落墨预览未完整生成，原编排仍保留，请重试保存。');
  }
  const files = {};
  for (const [key, source, kind, name, mime] of [
    ['candidate', candidateFile, 'annotation_candidate', '手动区域候选', 'application/json'],
    ['annotation', annotationFile, 'annotation', `${scene.title}落墨编排`, 'application/json'],
    ['preview', preview, 'annotation_preview', `${scene.title}区域预览`, 'image/png'],
    ['resultPreview', resultPreview, 'annotation_result', `${scene.title}当前落墨效果`, 'image/png'],
  ]) files[key] = await store.publishFile(record, attempt, source, { kind, name, mime, sceneId: scene.id, rootDir: options.rootDir });
  const low = coverage.coverageRatio < 0.97;
  const { candidate: _candidate, ...previews } = files;
  const binding = { sceneId: scene.id, inputIdentity, planningContract, visualGrouping: candidate.visualGrouping, ...previews, coverage };
  delete media.annotations[scene.id];
  media.lowCoverage = (media.lowCoverage || []).filter(e => e.sceneId !== scene.id);
  if (low) media.lowCoverage.push(store.bind({ kind: 'annotation_coverage_review', ...binding,
    title: scene.title, attemptId: attempt.id, lineartIdentity: lineart.identity, narrationIdentity: narration.identity, revision }));
  else media.annotations[scene.id] = store.bind({ kind: 'annotation', ...binding });
  media.attempts.push({ ...attempt, received: files, status: low ? 'failed' : 'validated', completedAt: now,
    ...(low ? { errorCode: 'ANNOTATION_COVERAGE_LOW' } : {}) });
  return timing;
}

module.exports = { editedCandidate, saveAnnotation };
