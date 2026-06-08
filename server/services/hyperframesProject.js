const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');

const TEMPLATE_AI_STORYBOARD_CARDS = 'ai_storyboard_cards';

const RENDER_DEFAULTS = {
  resolution: '1080x1920',
  fps: '30',
  captionSize: 'medium',
  motionLevel: 'medium',
  showCaptionBar: true,
  showSceneNumber: true,
  quality: 'standard',
};

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeRenderOptions(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    resolution: pickAllowed(source.resolution, ['1080x1920', '720x1280'], RENDER_DEFAULTS.resolution),
    fps: pickAllowed(String(source.fps || ''), ['24', '30', '60'], RENDER_DEFAULTS.fps),
    captionSize: pickAllowed(source.captionSize, ['small', 'medium', 'large'], RENDER_DEFAULTS.captionSize),
    motionLevel: pickAllowed(source.motionLevel, ['low', 'medium', 'high'], RENDER_DEFAULTS.motionLevel),
    showCaptionBar: normalizeBoolean(source.showCaptionBar, RENDER_DEFAULTS.showCaptionBar),
    showSceneNumber: normalizeBoolean(source.showSceneNumber, RENDER_DEFAULTS.showSceneNumber),
    quality: pickAllowed(source.quality, ['standard', 'high'], RENDER_DEFAULTS.quality),
  };
}

function getRenderSize(options) {
  return options.resolution === '720x1280'
    ? { width: 720, height: 1280 }
    : { width: 1080, height: 1920 };
}

function getCaptionFontSize(options) {
  if (options.captionSize === 'small') return 28;
  if (options.captionSize === 'large') return 40;
  return 34;
}

function getMotionScale(options) {
  if (options.motionLevel === 'low') return 0.55;
  if (options.motionLevel === 'high') return 1.25;
  return 1;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeCaption(caption, index) {
  const start = Number(caption?.start || 0);
  const end = Number(caption?.end || 0);
  return {
    index: Number(caption?.index || index + 1),
    start,
    end,
    duration: Number(caption?.duration || end - start),
    text: typeof caption?.text === 'string' ? caption.text : '',
  };
}

function getSceneTone(scene, index, storyboard) {
  const palette = Array.isArray(storyboard?.style?.palette) && storyboard.style.palette.length
    ? storyboard.style.palette
    : ['#101216', '#fe2c55', '#25f4ee', '#ffd166'];
  return {
    bg: palette[0] || '#101216',
    accent: palette[(index % Math.max(palette.length - 1, 1)) + 1] || '#fe2c55',
    secondary: palette[(index + 2) % palette.length] || '#25f4ee',
  };
}

function scaleDuration(value, motionScale) {
  return Math.max(0.08, Number(value || 0) * motionScale);
}

function buildTimelineScript(scenes, duration, motionScale = 1) {
  const lines = [
    '    const tl = gsap.timeline({ paused: true });',
    `    tl.to({}, { duration: ${duration} }, 0);`,
  ];

  scenes.forEach((scene, index) => {
    const sceneId = `#scene-${index + 1}`;
    const start = Number(scene.start || 0);
    const sceneDuration = Math.max(0.2, Number(scene.duration || 0.2));
    const enterDuration = scaleDuration(Math.min(0.45, sceneDuration * 0.28), motionScale);
    const exitDuration = scaleDuration(Math.min(0.32, Math.max(0.12, sceneDuration * 0.18)), motionScale);
    const exitStart = Math.max(start + enterDuration, start + sceneDuration - exitDuration);
    lines.push(`    tl.fromTo("${sceneId}", { autoAlpha: 0 }, { autoAlpha: 1, duration: ${enterDuration.toFixed(3)}, ease: "power2.out" }, ${start.toFixed(3)});`);
    lines.push(`    tl.fromTo("${sceneId} .visual-field", { y: 56, scale: 0.96, filter: "blur(10px)" }, { y: 0, scale: 1, filter: "blur(0px)", duration: ${enterDuration.toFixed(3)}, ease: "power3.out" }, ${start.toFixed(3)});`);
    lines.push(`    tl.fromTo("${sceneId} h1", { y: 28, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: ${Math.min(0.38, enterDuration).toFixed(3)}, ease: "back.out(1.45)" }, ${(start + 0.08).toFixed(3)});`);
    lines.push(`    tl.from("${sceneId} .emphasis span", { y: 18, scale: 0.72, autoAlpha: 0, duration: 0.22, stagger: 0.055, ease: "back.out(1.8)" }, ${(start + enterDuration * 0.65).toFixed(3)});`);
    lines.push(`    tl.fromTo("${sceneId} .caption-bar", { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.24, ease: "power2.out" }, ${(start + 0.12).toFixed(3)});`);
    lines.push(`    tl.to("${sceneId} .visual-field", { y: -18, scale: 1.025, duration: ${Math.max(0.2, sceneDuration - exitDuration).toFixed(3)}, ease: "none" }, ${start.toFixed(3)});`);
    lines.push(`    tl.to("${sceneId}", { autoAlpha: 0, duration: ${exitDuration.toFixed(3)}, ease: "power1.in" }, ${exitStart.toFixed(3)});`);
  });

  return lines.join('\n');
}

function buildIndexHtml({ storyboard, captions, duration, renderOptions = {} }) {
  const options = normalizeRenderOptions(renderOptions);
  const size = getRenderSize(options);
  const captionFontSize = getCaptionFontSize(options);
  const motionScale = getMotionScale(options);
  const sceneHtml = storyboard.scenes.map((scene, index) => {
    const tone = getSceneTone(scene, index, storyboard);
    const captionText = Array.isArray(scene.captions)
      ? scene.captions.map(caption => caption.text).filter(Boolean).join(' ')
      : '';
    const words = Array.isArray(scene.emphasis_words) ? scene.emphasis_words : [];
    const wordHtml = words.length
      ? words.map(word => `<span>${escapeHtml(word)}</span>`).join('')
      : `<span>${escapeHtml(scene.headline || captionText)}</span>`;
    return [
      `<section id="scene-${index + 1}" class="scene clip ${escapeHtml(scene.layout)}" data-start="${scene.start}" data-duration="${scene.duration}" data-track-index="${index + 1}" style="--bg:${tone.bg};--accent:${tone.accent};--secondary:${tone.secondary};">`,
      options.showSceneNumber ? `  <div class="scene-number">${String(scene.index || index + 1).padStart(2, '0')}</div>` : '',
      '  <div class="visual-field">',
      `    <div class="visual-type">${escapeHtml(scene.visual_type || 'text_card')}</div>`,
      `    <h1>${escapeHtml(scene.headline)}</h1>`,
      `    <p>${escapeHtml(captionText)}</p>`,
      `    <div class="emphasis">${wordHtml}</div>`,
      '  </div>',
      options.showCaptionBar ? `  <div class="caption-bar">${escapeHtml(captionText)}</div>` : '',
      '</section>',
    ].filter(line => line !== '').join('\n');
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <title>MuseDock AI 分镜成片</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #0f1115; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    #stage { position: relative; width: ${size.width}px; height: ${size.height}px; overflow: hidden; background: #0f1115; --caption-font-size: ${captionFontSize}px; }
    .scene { position: absolute; inset: 0; display: grid; place-items: center; padding: 120px 82px 220px; box-sizing: border-box; background:
      linear-gradient(150deg, color-mix(in srgb, var(--accent) 22%, transparent), transparent 28%),
      radial-gradient(circle at 78% 18%, color-mix(in srgb, var(--secondary) 24%, transparent), transparent 30%),
      linear-gradient(180deg, var(--bg), #050608 76%); }
    .scene::before { content: ""; position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px); background-size: 54px 54px; mask-image: linear-gradient(to bottom, transparent, #000 18%, #000 82%, transparent); transform: scale(1.06); }
    .scene-number { position: absolute; top: 78px; left: 78px; color: var(--accent); font-size: 36px; font-weight: 800; letter-spacing: 0; }
    .visual-field { position: relative; width: 100%; min-height: 780px; display: flex; flex-direction: column; justify-content: center; gap: 34px; border-left: 10px solid var(--accent); padding: 54px 48px; background: rgba(255,255,255,.09); box-shadow: 0 30px 90px rgba(0,0,0,.28); backdrop-filter: blur(16px); }
    .visual-type { width: max-content; max-width: 100%; padding: 9px 14px; border-radius: 8px; background: color-mix(in srgb, var(--accent) 28%, rgba(255,255,255,.1)); color: #fff; font-size: 24px; font-weight: 700; }
    h1 { margin: 0; color: #fff; font-size: 68px; line-height: 1.18; font-weight: 900; letter-spacing: 0; }
    p { margin: 0; color: rgba(255,255,255,.78); font-size: 36px; line-height: 1.55; font-weight: 650; letter-spacing: 0; }
    .emphasis { display: flex; flex-wrap: wrap; gap: 12px; }
    .emphasis span { padding: 9px 14px; border: 1px solid color-mix(in srgb, var(--accent) 72%, #fff); border-radius: 8px; color: var(--accent); font-size: 28px; font-weight: 800; }
    .caption-bar { position: absolute; left: 64px; right: 64px; bottom: 94px; padding: 24px 28px; border-radius: 8px; background: rgba(0,0,0,.58); color: #fff; font-size: var(--caption-font-size); line-height: 1.42; text-align: center; }
  </style>
</head>
<body>
  <div id="stage" data-composition-id="ai-storyboard-cards" data-start="0" data-duration="${duration}" data-width="${size.width}" data-height="${size.height}">
    <audio id="narration-audio" data-start="0" data-duration="${duration}" data-track-index="0" src="assets/narration.wav"></audio>
${sceneHtml}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
${buildTimelineScript(storyboard.scenes, duration, motionScale)}
    window.__timelines['ai-storyboard-cards'] = tl;
  </script>
</body>
</html>
`;
}

async function createOriginalCaptionProject({ run, projectDir, renderOptions = {} } = {}) {
  const normalizedRenderOptions = normalizeRenderOptions(renderOptions || run?.video?.render_options || {});
  const captions = Array.isArray(run?.tts?.captions)
    ? run.tts.captions.map(normalizeCaption).filter(item => item.text && item.end > item.start)
    : [];
  const audioPath = typeof run?.tts?.path === 'string' ? run.tts.path : '';
  const scenes = Array.isArray(run?.storyboard?.scenes) ? run.storyboard.scenes : [];

  if (!audioPath || captions.length === 0) {
    return {
      success: false,
      message: '生成视频工程失败：请先完成 TTS 合成并生成字幕时间轴。',
    };
  }
  if (!scenes.length) {
    return {
      success: false,
      message: '生成视频工程失败：请先生成 AI 分镜。',
    };
  }
  if (!fs.existsSync(audioPath)) {
    return {
      success: false,
      message: '生成视频工程失败：未找到 TTS 音频文件。',
    };
  }

  const duration = Number(run.tts.duration || captions[captions.length - 1].end || 0);
  const storyboard = {
    ...run.storyboard,
    template: run.storyboard.template || TEMPLATE_AI_STORYBOARD_CARDS,
    scenes,
  };
  const assetsDir = path.join(projectDir, 'assets');
  await fsp.rm(projectDir, { recursive: true, force: true });
  await fsp.mkdir(assetsDir, { recursive: true });
  await fsp.copyFile(audioPath, path.join(assetsDir, 'narration.wav'));

  const storyboardPath = path.join(projectDir, 'storyboard.json');
  const captionsPath = path.join(projectDir, 'captions.json');
  const projectJsonPath = path.join(projectDir, 'project.json');
  const indexPath = path.join(projectDir, 'index.html');

  await fsp.writeFile(storyboardPath, JSON.stringify(storyboard, null, 2), 'utf-8');
  await fsp.writeFile(captionsPath, JSON.stringify({ duration, captions }, null, 2), 'utf-8');
  await fsp.writeFile(projectJsonPath, JSON.stringify({
    template: TEMPLATE_AI_STORYBOARD_CARDS,
    run_id: run.run_id || '',
    aweme_id: run.aweme_id || '',
    duration,
    render_options: normalizedRenderOptions,
    created_at: new Date().toISOString(),
  }, null, 2), 'utf-8');
  await fsp.writeFile(indexPath, buildIndexHtml({ storyboard, captions, duration, renderOptions: normalizedRenderOptions }), 'utf-8');

  return {
    success: true,
    template: TEMPLATE_AI_STORYBOARD_CARDS,
    project_dir: projectDir,
    index_path: indexPath,
    storyboard_path: storyboardPath,
    captions_path: captionsPath,
    project_json_path: projectJsonPath,
    duration,
    render_options: normalizedRenderOptions,
    message: '视频工程已生成。',
  };
}

module.exports = {
  TEMPLATE_AI_STORYBOARD_CARDS,
  createOriginalCaptionProject,
  buildIndexHtml,
  normalizeRenderOptions,
};
