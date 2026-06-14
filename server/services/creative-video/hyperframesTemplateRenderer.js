const fs = require('fs');
const path = require('path');
const sceneSpecService = require('./sceneSpecService');
const frameSpecService = require('./frameSpecService');
const templateRegistry = require('./templateRegistry');

const GSAP_LOCAL_PATH = path.resolve(__dirname, '../../../node_modules/gsap/dist/gsap.min.js');
let gsapBundleCache = null;

function getGsapBundle() {
  if (gsapBundleCache !== null) return gsapBundleCache;
  try {
    gsapBundleCache = fs.readFileSync(GSAP_LOCAL_PATH, 'utf8');
  } catch {
    gsapBundleCache = '';
  }
  return gsapBundleCache;
}

const ASPECT_RATIOS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function roundTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.round(number * 100) / 100;
}

function dimensionsFor(aspectRatio) {
  return ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['16:9'];
}

function totalDuration(sceneSpec) {
  return roundTime((sceneSpec.scenes || []).reduce((sum, scene) => sum + Number(scene.duration || 0), 0));
}

function sceneById(sceneSpec) {
  return new Map((sceneSpec.scenes || []).map(scene => [scene.id, scene]));
}

function buildCaptionHtml(sceneSpec) {
  return (sceneSpec.scenes || []).flatMap(scene => (
    (scene.captions || []).map(caption => {
      const duration = Math.max(0, roundTime(Number(caption.end || 0) - Number(caption.start || 0)));
      return `<div class="caption-line clip" data-caption-id="${escapeHtml(caption.id)}" data-scene-id="${escapeHtml(scene.id)}" data-start="${roundTime(scene.start + caption.start)}" data-duration="${duration}">${escapeHtml(caption.text)}</div>`;
    })
  )).join('\n');
}

function safeDomId(value, index) {
  const safe = String(value || '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `frame_${index + 1}_${safe || 'clip'}`;
}

function buildFrameHtmlAndCss(sceneSpec, frameSpecs) {
  const scenes = sceneById(sceneSpec);
  const css = new Set();
  const html = [];
  const timeline = [];

  frameSpecs.frames.forEach((frame, index) => {
    const template = templateRegistry.getTemplate(frame.template);
    const scene = scenes.get(frame.scene_id);
    const domId = safeDomId(frame.id, index);
    const renderFrame = { ...frame, id: domId };
    const rendered = template.renderFrame(renderFrame, scene);
    const frameHtml = rendered.html
      .replace('class="creative-frame ', 'class="creative-frame clip ')
      .replace(/<section\b/, `<section data-start="${roundTime(frame.start)}" data-duration="${roundTime(frame.duration)}"`);
    css.add(rendered.css);
    html.push(frameHtml);
    const selector = `#${domId}`;
    timeline.push(
      `tl.set("${selector}", { autoAlpha: 0 }, 0);`,
      `tl.set("${selector}", { autoAlpha: 1 }, ${roundTime(frame.start)});`,
      templateRegistry
        .getMotionSnippet(frame.motion || template.defaultMotion, selector, roundTime(frame.start))
        .replace(/^gsap\./, 'tl.'),
      `tl.set("${selector}", { autoAlpha: 0 }, ${roundTime(frame.start + frame.duration)});`
    );
  });

  return {
    html: html.join('\n'),
    css: Array.from(css).join('\n'),
    timeline: timeline.join('\n'),
  };
}

function buildIndexHtml({ sceneSpec, frameSpecs }) {
  const dimensions = dimensionsFor(sceneSpec.aspect_ratio);
  const duration = totalDuration(sceneSpec);
  const fragments = buildFrameHtmlAndCss(sceneSpec, frameSpecs);
  const captionsHtml = buildCaptionHtml(sceneSpec);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(sceneSpec.title || '创意视频')}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box}
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#020617;color:#fff}
    body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .composition{position:relative;width:${dimensions.width}px;height:${dimensions.height}px;overflow:hidden;background:#020617}
    .clip{position:absolute;opacity:0;visibility:hidden;will-change:opacity,transform}
    .caption-line{left:9%;right:9%;bottom:7%;z-index:20;padding:16px 24px;border-radius:14px;background:rgba(2,6,23,.72);color:#fff;font-size:34px;line-height:1.25;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.28)}
${fragments.css}
  </style>
</head>
<body>
  <main class="composition" id="stage" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${dimensions.width}" data-height="${dimensions.height}">
${fragments.html}
${captionsHtml}
  </main>
  <script src="./gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
${fragments.timeline}
    document.querySelectorAll(".caption-line.clip").forEach((caption) => {
      const start = Number(caption.dataset.start || 0);
      const duration = Number(caption.dataset.duration || 0);
      tl.set(caption, { autoAlpha: 0 }, 0);
      tl.set(caption, { autoAlpha: 1 }, start);
      tl.fromTo(caption, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.18, ease: "power1.out" }, start);
      tl.to(caption, { opacity: 0, y: -12, duration: 0.18, ease: "power1.in" }, start + duration);
      tl.set(caption, { autoAlpha: 0 }, start + duration + 0.18);
    });
    tl.to("#stage", { opacity: 1, duration: 0.001 }, ${duration});
    window.__timelines["main"] = tl;
  </script>
  <script type="application/json" id="creative-video-source">${escapeJsonForHtml({ scene_spec: sceneSpec, frame_specs: frameSpecs })}</script>
</body>
</html>`;
}

function buildDesignMd(sceneSpec, frameSpecs) {
  return `# ${sceneSpec.title || '创意视频'}

- 宽高比: ${sceneSpec.aspect_ratio}
- 总时长: ${totalDuration(sceneSpec)}s
- 场景数: ${(sceneSpec.scenes || []).length}
- 帧数: ${(frameSpecs.frames || []).length}

${(sceneSpec.scenes || []).map(scene => `## ${scene.id}
- 类型: ${scene.kind}
- 开始: ${scene.start}s
- 时长: ${scene.duration}s
- 旁白: ${scene.narration_text || '无'}`).join('\n\n')}
`;
}

function renderHyperframesProjectFiles({ sceneSpec, frameSpecs } = {}) {
  const normalizedSceneSpec = sceneSpecService.normalizeSceneSpec(sceneSpec);
  const sceneValidation = sceneSpecService.validateSceneSpec(normalizedSceneSpec);
  if (!sceneValidation.success) {
    return {
      success: false,
      message: `scene_spec 校验失败：${sceneValidation.errors.join('；')}`,
      diagnostics: sceneValidation.errors,
      files: {},
    };
  }

  const normalizedFrameSpecs = frameSpecService.normalizeFrameSpecs(frameSpecs, sceneValidation.scene_spec);
  const frameValidation = frameSpecService.validateFrameSpecs(normalizedFrameSpecs, sceneValidation.scene_spec);
  if (!frameValidation.success) {
    return {
      success: false,
      message: `frame_specs 校验失败：${frameValidation.errors.join('；')}`,
      diagnostics: frameValidation.errors,
      files: {},
    };
  }
  const incompatibleTemplates = frameValidation.frame_specs.frames
    .map(frame => ({ frame, template: templateRegistry.getTemplate(frame.template) }))
    .filter(item => !item.template.supportedKinds.includes(item.frame.kind))
    .map(item => `frame ${item.frame.id} 的模板 ${item.frame.template} 不支持 kind ${item.frame.kind}`);
  if (incompatibleTemplates.length > 0) {
    return {
      success: false,
      message: `模板兼容性校验失败：${incompatibleTemplates.join('；')}`,
      diagnostics: incompatibleTemplates,
      files: {},
    };
  }

  const dimensions = dimensionsFor(sceneValidation.scene_spec.aspect_ratio);
  const duration = totalDuration(sceneValidation.scene_spec);
  const indexHtml = buildIndexHtml({
    sceneSpec: sceneValidation.scene_spec,
    frameSpecs: frameValidation.frame_specs,
  });
  const meta = {
    title: sceneValidation.scene_spec.title,
    aspect_ratio: sceneValidation.scene_spec.aspect_ratio,
    width: dimensions.width,
    height: dimensions.height,
    duration_sec: duration,
    scene_count: sceneValidation.scene_spec.scenes.length,
    frame_count: frameValidation.frame_specs.frames.length,
    renderer: 'html-video-lite-template',
  };
  const hyperframes = {
    composition: 'main',
    width: dimensions.width,
    height: dimensions.height,
    duration,
    fps: 30,
    timeline: 'main',
    clips: frameValidation.frame_specs.frames.map(frame => ({
      id: frame.id,
      scene_id: frame.scene_id,
      start: frame.start,
      duration: frame.duration,
      template: frame.template,
    })),
  };

  return {
    success: true,
    message: 'HyperFrames 工程文件已生成。',
    scene_spec: sceneValidation.scene_spec,
    frame_specs: frameValidation.frame_specs,
    files: {
      'index.html': indexHtml,
      'gsap.min.js': getGsapBundle(),
      'meta.json': JSON.stringify(meta, null, 2),
      'hyperframes.json': JSON.stringify(hyperframes, null, 2),
      'scene_spec.json': JSON.stringify(sceneValidation.scene_spec, null, 2),
      'frame_specs.json': JSON.stringify(frameValidation.frame_specs, null, 2),
      'design.md': buildDesignMd(sceneValidation.scene_spec, frameValidation.frame_specs),
    },
    diagnostics: [],
  };
}

module.exports = {
  renderHyperframesProjectFiles,
  buildIndexHtml,
};
