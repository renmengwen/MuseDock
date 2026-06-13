const sceneSpec = require('./sceneSpec');

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildIndexHtml(spec) {
  const width = spec.aspect_ratio === '9:16' ? 1080 : 1920;
  const height = spec.aspect_ratio === '9:16' ? 1920 : 1080;
  const totalDuration = spec.scenes.reduce((sum, s) => sum + s.duration, 0);

  const scenesHtml = spec.scenes.map(scene => {
    const captionsHtml = (scene.captions || []).map(cap =>
      `      <div class="caption" data-caption-id="${escapeHtml(cap.id)}" data-start="${cap.start}" data-end="${cap.end}">${escapeHtml(cap.text)}</div>`
    ).join('\n');

    const keywordsHtml = (scene.visual_text?.keywords || []).map(kw =>
      `        <span class="keyword">${escapeHtml(kw)}</span>`
    ).join('\n');

    const cardsHtml = (scene.visual_text?.cards || []).map(card =>
      `        <div class="card">${escapeHtml(card)}</div>`
    ).join('\n');

    return `    <div class="scene" data-scene-id="${escapeHtml(scene.id)}" data-start="${scene.start}" data-duration="${scene.duration}">
      <h2 class="headline">${escapeHtml(scene.visual_text?.headline || '')}</h2>
${captionsHtml}
${keywordsHtml}
${cardsHtml}
    </div>`;
  }).join('\n');

  const timelineScenes = spec.scenes.map(scene => {
    const captionEntries = (scene.captions || []).map(cap =>
      `      { id: '${escapeHtml(cap.id)}', start: ${cap.start}, end: ${cap.end} }`
    ).join(',\n');

    return `    { id: '${escapeHtml(scene.id)}', start: ${scene.start}, end: ${scene.start + scene.duration}, captions: [\n${captionEntries}\n    ] }`;
  }).join(',\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(spec.title)}</title>
</head>
<body>
  <div class="composition" data-composition-id="main" data-duration="${totalDuration}" data-width="${width}" data-height="${height}">
${scenesHtml}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = tl;
    var tl = {
      composition: "main",
      duration: ${totalDuration},
      scenes: [
${timelineScenes}
      ]
    };
  </script>
</body>
</html>`;
}

function composeHyperframesProjectFiles(input) {
  const normalized = sceneSpec.normalizeSceneSpec(input);
  const validation = sceneSpec.validateSceneSpec(normalized);

  if (!validation.success) {
    return {
      success: false,
      message: validation.errors.join('; '),
      files: {},
      diagnostics: validation.errors,
    };
  }

  const indexHtml = buildIndexHtml(normalized);

  const metaJson = JSON.stringify({
    title: normalized.title,
    aspect_ratio: normalized.aspect_ratio,
    scene_count: normalized.scenes.length,
    total_duration: normalized.scenes.reduce((sum, s) => sum + s.duration, 0),
    version: normalized.version,
  }, null, 2);

  const hyperframesJson = JSON.stringify({
    composition: 'main',
    scenes: normalized.scenes.map(s => ({
      id: s.id,
      start: s.start,
      duration: s.duration,
    })),
  }, null, 2);

  const sceneSpecJson = JSON.stringify(normalized, null, 2);

  const designMd = `# ${normalized.title}

- 宽高比: ${normalized.aspect_ratio}
- 场景数: ${normalized.scenes.length}
- 总时长: ${normalized.scenes.reduce((sum, s) => sum + s.duration, 0)}s

${normalized.scenes.map(s => `## ${s.id}\n- 时长: ${s.duration}s\n- 旁白: ${s.narration_text || '无'}`).join('\n\n')}
`;

  return {
    success: true,
    scene_spec: normalized,
    files: {
      'index.html': indexHtml,
      'meta.json': metaJson,
      'hyperframes.json': hyperframesJson,
      'design.md': designMd,
      'scene_spec.json': sceneSpecJson,
    },
    diagnostics: [],
  };
}

module.exports = {
  composeHyperframesProjectFiles,
  buildIndexHtml,
};
