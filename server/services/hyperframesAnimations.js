function buildSceneAnimation(scene, index, motionScale = 1, frameOptions = {}) {
  const sceneId = `#scene-${index + 1}`;
  const start = Number(scene.start || 0);
  const sceneDuration = Math.max(0.2, Number(scene.duration || 0.2));
  const enterDuration = Math.max(0.08, Math.min(0.42, sceneDuration * 0.22) * motionScale);
  const exitDuration = Math.max(0.08, Math.min(0.28, sceneDuration * 0.16) * motionScale);
  const exitStart = Math.max(start + enterDuration, start + sceneDuration - exitDuration);
  const transitionName = frameOptions.transitionStyle === 'glitch'
    ? 'glitch-wipe'
    : (frameOptions.transitionStyle === 'zoom' ? 'zoom-burst' : 'soft-wipe');
  const startsAtZero = start <= 0.001;
  const enterAutoAlpha = startsAtZero ? 1 : 0;
  const lines = [];
  const phraseBlocks = Array.isArray(scene.phrase_captions) ? scene.phrase_captions : [];
  const phraseStartById = new Map(phraseBlocks.map(block => [
    String(block?.id || '').trim(),
    Math.max(start, Number(block?.start || start)),
  ]));
  const beats = Array.isArray(scene.prepared_visual_scene?.beats) ? scene.prepared_visual_scene.beats : [];
  const beatTargets = Array.from(new Set(beats
    .map(beat => String(beat?.target || '').replace(/['"\\[\]]/g, '').trim())
    .filter(Boolean)));

  lines.push(`    tl.set(".transition-layer", { attr: { "data-transition": "${transitionName}" } }, ${start.toFixed(3)});`);
  lines.push(`    tl.fromTo(".transition-layer", { xPercent: -120, autoAlpha: 0.92 }, { xPercent: 120, autoAlpha: 0, duration: ${Math.min(0.38, enterDuration + 0.12).toFixed(3)}, ease: "power4.out" }, ${start.toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} .scene-content", { y: 42, scale: 0.96, filter: "blur(10px)" }, { y: 0, scale: 1, filter: "blur(0px)", duration: ${enterDuration.toFixed(3)}, ease: "power3.out" }, ${start.toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} h1", { y: 18, autoAlpha: ${enterAutoAlpha} }, { y: 0, autoAlpha: 1, duration: ${Math.min(0.28, enterDuration).toFixed(3)}, ease: "power2.out" }, ${(start + 0.03).toFixed(3)});`);
  if (frameOptions.captionMode === 'phrase_kinetic' && phraseBlocks.length) {
    beatTargets.forEach(target => {
      lines.push(`    tl.set("${sceneId} [data-visual-object='${target}']", { autoAlpha: 0, y: 20, scale: 0.92 }, ${start.toFixed(3)});`);
    });
  } else {
    lines.push(`    tl.fromTo("${sceneId} [data-visual-object]", { y: 20, autoAlpha: ${enterAutoAlpha}, scale: 0.92 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.28, stagger: 0.08, ease: "back.out(1.5)" }, ${(start + 0.12).toFixed(3)});`);
  }
  lines.push(`    tl.fromTo("${sceneId} .visual-connector", { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.34, stagger: 0.06, ease: "power2.out" }, ${(start + 0.24).toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} .caption-bar", { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.24, ease: "power2.out" }, ${(start + 0.12).toFixed(3)});`);
  lines.push(`    tl.set("${sceneId} .caption-line", { autoAlpha: 0 }, ${start.toFixed(3)});`);
  if (frameOptions.captionMode === 'phrase_kinetic' && phraseBlocks.length) {
    lines.push(`    tl.set("${sceneId} .caption-line", { autoAlpha: 1 }, ${start.toFixed(3)});`);
    lines.push(`    tl.set("${sceneId} .phrase-caption", { autoAlpha: 0, y: 10 }, ${start.toFixed(3)});`);
  } else {
    const captionLines = Array.isArray(scene.captions) && scene.captions.length
      ? scene.captions
      : [{ start, end: start + sceneDuration }];
    captionLines.forEach((caption, captionIndex) => {
      const captionStart = Math.max(start, Number(caption.start || start));
      const captionEnd = Math.min(start + sceneDuration, Number(caption.end || captionStart + 0.8));
      const lineSelector = `${sceneId} .caption-line:nth-child(${captionIndex + 1})`;
      lines.push(`    tl.fromTo("${lineSelector}", { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.18, ease: "power2.out" }, ${captionStart.toFixed(3)});`);
      lines.push(`    tl.to("${lineSelector}", { y: -8, autoAlpha: 0, duration: 0.16, ease: "power1.in" }, ${Math.max(captionStart + 0.18, captionEnd - 0.16).toFixed(3)});`);
      lines.push(`    tl.from("${lineSelector} span", { y: 14, autoAlpha: 0, duration: 0.16, stagger: 0.018, ease: "power2.out" }, ${(captionStart + 0.04).toFixed(3)});`);
    });
  }
  const words = Array.isArray(scene.emphasis_words) ? scene.emphasis_words.filter(Boolean) : [];
  words.forEach((_, wordIndex) => {
    const cardStart = start + Math.min(sceneDuration - 0.18, enterDuration + ((sceneDuration - enterDuration - exitDuration) * (wordIndex / Math.max(words.length, 1))));
    lines.push(`    tl.fromTo("${sceneId} .emphasis span:nth-child(${wordIndex + 1})", { x: 34, y: 14, scale: 0.82, autoAlpha: 0 }, { x: 0, y: 0, scale: 1, autoAlpha: 1, duration: 0.28, ease: "back.out(1.7)" }, ${cardStart.toFixed(3)});`);
  });
  beats.forEach(beat => {
    const target = String(beat?.target || '').replace(/['"\\[\]]/g, '').trim();
    if (!target) return;
    const selector = `${sceneId} [data-visual-object='${target}']`;
    const captionBlockId = String(beat?.caption_block_id || '').replace(/['"\\[\]]/g, '').trim();
    const phraseStart = phraseStartById.get(captionBlockId);
    const beatStart = Number.isFinite(phraseStart)
      ? phraseStart
      : start + Math.min(sceneDuration - 0.08, Math.max(0, Number(beat.at || 0)));
    const beatDuration = Math.max(0.08, Number(beat.duration || 0.28) * motionScale);
    const effect = String(beat.effect || '');
    if (captionBlockId) {
      const captionSelector = `${sceneId} [data-caption-block-id='${captionBlockId}']`;
      lines.push(`    tl.to("${captionSelector}", { autoAlpha: 1, y: 0, duration: 0.12, ease: "power2.out", onStart: function(){ document.querySelectorAll("${sceneId} .phrase-caption").forEach(function(el){ el.classList.remove("is-active"); }); var el = document.querySelector("${captionSelector}"); if (el) el.classList.add("is-active"); } }, ${beatStart.toFixed(3)});`);
    }
    if (effect === 'draw_line' || effect === 'progress_fill') {
      lines.push(`    tl.fromTo("${selector} i, ${selector}.visual-connector, ${selector}", { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: ${beatDuration.toFixed(3)}, ease: "power2.out" }, ${beatStart.toFixed(3)});`);
    } else if (effect === 'type_in' || effect === 'scan') {
      lines.push(`    tl.fromTo("${selector}", { clipPath: "inset(0 100% 0 0)", autoAlpha: 1 }, { clipPath: "inset(0 0% 0 0)", duration: ${beatDuration.toFixed(3)}, ease: "power1.out" }, ${beatStart.toFixed(3)});`);
    } else if (effect === 'pulse' || effect === 'glow_focus' || effect === 'caption_highlight' || effect === 'highlight' || effect === 'check_on') {
      lines.push(`    tl.to("${selector}", { scale: 1.06, boxShadow: "0 0 42px var(--accent)", duration: ${beatDuration.toFixed(3)}, yoyo: true, repeat: 1, ease: "sine.inOut" }, ${beatStart.toFixed(3)});`);
    } else if (effect === 'zoom_focus') {
      lines.push(`    tl.fromTo("${selector}", { scale: 0.82, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: ${beatDuration.toFixed(3)}, ease: "back.out(1.6)" }, ${beatStart.toFixed(3)});`);
    } else {
      lines.push(`    tl.fromTo("${selector}", { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: ${beatDuration.toFixed(3)}, ease: "power3.out" }, ${beatStart.toFixed(3)});`);
    }
  });
  if (frameOptions.captionMode === 'phrase_kinetic' && phraseBlocks.length) {
    const boundIds = new Set(beats.map(beat => String(beat?.caption_block_id || '').trim()).filter(Boolean));
    phraseBlocks.forEach(block => {
      if (boundIds.has(String(block.id))) return;
      const selector = `${sceneId} [data-caption-block-id='${String(block.id).replace(/['"\\[\]]/g, '').trim()}']`;
      const blockStart = Math.max(start, Number(block.start || start));
      lines.push(`    tl.to("${selector}", { autoAlpha: 1, y: 0, duration: 0.16, ease: "power2.out", onStart: function(){ document.querySelectorAll("${sceneId} .phrase-caption").forEach(function(el){ el.classList.remove("is-active"); }); var el = document.querySelector("${selector}"); if (el) el.classList.add("is-active"); } }, ${blockStart.toFixed(3)});`);
    });
  }
  lines.push(`    tl.to("${sceneId} .scene-content", { y: -16, scale: 1.02, duration: ${Math.max(0.2, sceneDuration - exitDuration).toFixed(3)}, ease: "none" }, ${start.toFixed(3)});`);

  return lines.join('\n');
}

function buildTimelineScript(scenes, duration, motionScale = 1, frameOptions = {}) {
  const safeDuration = Number(duration || 0);
  const lines = [
    '    const tl = gsap.timeline({ paused: true });',
    `    tl.to({}, { duration: ${safeDuration} }, 0);`,
    '    tl.to(".paper-grain", { backgroundPosition: "0 28px, 34px 0", duration: Math.max(8, ' + safeDuration + '), ease: "none" }, 0);',
    '    tl.to(".ink-grid", { backgroundPosition: "36px 36px", duration: Math.max(10, ' + safeDuration + '), ease: "none" }, 0);',
  ];
  scenes.forEach((scene, index) => lines.push(buildSceneAnimation(scene, index, motionScale, frameOptions)));
  return lines.join('\n');
}

module.exports = {
  buildSceneAnimation,
  buildTimelineScript,
};
