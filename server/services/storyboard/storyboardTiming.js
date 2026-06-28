function roundTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function getSceneDuration(sceneTts) {
  const explicit = Number(
    sceneTts?.speech_duration_sec
    ?? sceneTts?.duration
    ?? sceneTts?.actual_duration_sec
  );
  if (Number.isFinite(explicit) && explicit >= 0) return roundTime(explicit);

  const captions = Array.isArray(sceneTts?.captions) ? sceneTts.captions : [];
  const lastEnd = captions.reduce((max, caption) => Math.max(max, Number(caption?.end || 0)), 0);
  return roundTime(lastEnd);
}

function fail(message, storyboardPlan = {}) {
  return {
    status: 'failed',
    target_duration_sec: roundTime(storyboardPlan.target_duration_sec),
    duration: 0,
    scenes: [],
    captions: [],
    phrase_captions: [],
    message,
    updated_at: new Date().toISOString(),
  };
}

function buildTimedStoryboardPlan({ storyboardPlan, sceneTts } = {}) {
  const storyboardScenes = Array.isArray(storyboardPlan?.scenes) ? storyboardPlan.scenes : [];
  const ttsScenes = Array.isArray(sceneTts?.scenes) ? sceneTts.scenes : [];

  if (!storyboardScenes.length) {
    return fail('分镜规划为空，无法生成分镜时间轴。', storyboardPlan || {});
  }
  if (!ttsScenes.length) {
    return fail('分段配音结果为空，无法生成分镜时间轴。', storyboardPlan || {});
  }

  const ttsSceneMap = new Map(ttsScenes.map(scene => [Number(scene?.index), scene]));
  const scenes = [];
  const captions = [];
  const phraseCaptions = [];
  let cursor = 0;
  let globalCaptionIndex = 1;

  for (const storyboardScene of storyboardScenes) {
    const sceneIndex = Number(storyboardScene?.index || scenes.length + 1);
    const matchedTtsScene = ttsSceneMap.get(sceneIndex);
    if (!matchedTtsScene) {
      return fail(`第 ${sceneIndex} 幕缺少分段配音结果，无法生成分镜时间轴。`, storyboardPlan || {});
    }

    const sceneStart = roundTime(cursor);
    const sceneDuration = getSceneDuration(matchedTtsScene);
    const sceneEnd = roundTime(sceneStart + sceneDuration);
    const localCaptions = Array.isArray(matchedTtsScene.captions) ? matchedTtsScene.captions : [];
    const localCaptionMap = new Map();
    const captionIndexes = [];

    for (const localCaption of localCaptions) {
      const localIndex = Number(localCaption?.index || localCaptionMap.size + 1);
      const captionStart = roundTime(sceneStart + Number(localCaption?.start || 0));
      const captionEnd = roundTime(sceneStart + Number(localCaption?.end ?? localCaption?.duration ?? 0));
      const captionDuration = roundTime(Number(localCaption?.duration ?? (captionEnd - captionStart)));
      const globalCaption = {
        ...localCaption,
        index: globalCaptionIndex,
        scene_index: sceneIndex,
        start: captionStart,
        end: captionEnd,
        duration: captionDuration,
      };

      localCaptionMap.set(localIndex, globalCaptionIndex);
      captionIndexes.push(globalCaptionIndex);
      captions.push(globalCaption);
      globalCaptionIndex += 1;
    }

    const localPhraseCaptions = Array.isArray(matchedTtsScene.phrase_captions)
      ? matchedTtsScene.phrase_captions
      : [];
    for (const phraseCaption of localPhraseCaptions) {
      const localCaptionIndex = Number(phraseCaption?.caption_index || 1);
      const mappedCaptionIndex = localCaptionMap.get(localCaptionIndex);
      if (!mappedCaptionIndex) continue;

      const phraseIndex = Number(phraseCaption?.phrase_index || 1);
      const phraseStart = roundTime(sceneStart + Number(phraseCaption?.start || 0));
      const phraseEnd = roundTime(sceneStart + Number(phraseCaption?.end ?? phraseCaption?.duration ?? 0));
      phraseCaptions.push({
        ...phraseCaption,
        id: `cap-${mappedCaptionIndex}-p${phraseIndex}`,
        caption_index: mappedCaptionIndex,
        phrase_index: phraseIndex,
        scene_index: sceneIndex,
        start: phraseStart,
        end: phraseEnd,
        duration: roundTime(Number(phraseCaption?.duration ?? (phraseEnd - phraseStart))),
      });
    }

    scenes.push({
      ...storyboardScene,
      index: sceneIndex,
      caption_indexes: captionIndexes,
      start: sceneStart,
      end: sceneEnd,
      duration: sceneDuration,
      actual_duration_sec: sceneDuration,
    });
    cursor = sceneEnd;
  }

  return {
    status: 'timed',
    target_duration_sec: roundTime(storyboardPlan?.target_duration_sec),
    duration: roundTime(cursor),
    scenes,
    captions,
    phrase_captions: phraseCaptions,
    message: '分镜时间轴已生成。',
    updated_at: new Date().toISOString(),
  };
}

module.exports = {
  buildTimedStoryboardPlan,
  roundTime,
};
