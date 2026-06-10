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
  const lines = [];

  lines.push(`    tl.set(".transition-layer", { attr: { "data-transition": "${transitionName}" } }, ${start.toFixed(3)});`);
  lines.push(`    tl.fromTo(".transition-layer", { xPercent: -120, autoAlpha: 0.92 }, { xPercent: 120, autoAlpha: 0, duration: ${Math.min(0.38, enterDuration + 0.12).toFixed(3)}, ease: "power4.out" }, ${start.toFixed(3)});`);
  lines.push(`    tl.set("${sceneId}", { autoAlpha: 0 }, ${Math.max(0, start - 0.001).toFixed(3)});`);
  lines.push(`    tl.set("${sceneId}", { autoAlpha: 1 }, ${start.toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} .scene-content", { y: 42, scale: 0.96, filter: "blur(10px)" }, { y: 0, scale: 1, filter: "blur(0px)", duration: ${enterDuration.toFixed(3)}, ease: "power3.out" }, ${start.toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} h1", { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: ${Math.min(0.28, enterDuration).toFixed(3)}, ease: "power2.out" }, ${(start + 0.03).toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} [data-visual-object]", { y: 20, autoAlpha: 0, scale: 0.92 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.28, stagger: 0.08, ease: "back.out(1.5)" }, ${(start + 0.12).toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} .visual-connector", { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.34, stagger: 0.06, ease: "power2.out" }, ${(start + 0.24).toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} .caption-bar", { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.24, ease: "power2.out" }, ${(start + 0.12).toFixed(3)});`);
  lines.push(`    tl.set("${sceneId} .caption-line", { autoAlpha: 0 }, ${start.toFixed(3)});`);
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
  const words = Array.isArray(scene.emphasis_words) ? scene.emphasis_words.filter(Boolean) : [];
  words.forEach((_, wordIndex) => {
    const cardStart = start + Math.min(sceneDuration - 0.18, enterDuration + ((sceneDuration - enterDuration - exitDuration) * (wordIndex / Math.max(words.length, 1))));
    lines.push(`    tl.fromTo("${sceneId} .emphasis span:nth-child(${wordIndex + 1})", { x: 34, y: 14, scale: 0.82, autoAlpha: 0 }, { x: 0, y: 0, scale: 1, autoAlpha: 1, duration: 0.28, ease: "back.out(1.7)" }, ${cardStart.toFixed(3)});`);
  });
  lines.push(`    tl.to("${sceneId} .scene-content", { y: -16, scale: 1.02, duration: ${Math.max(0.2, sceneDuration - exitDuration).toFixed(3)}, ease: "none" }, ${start.toFixed(3)});`);
  lines.push(`    tl.to("${sceneId}", { autoAlpha: 0, duration: ${exitDuration.toFixed(3)}, ease: "power1.in" }, ${exitStart.toFixed(3)});`);

  return lines.join('\n');
}

function buildTimelineScript(scenes, duration, motionScale = 1, frameOptions = {}) {
  const safeDuration = Number(duration || 0);
  const lines = [
    '    const tl = gsap.timeline({ paused: true });',
    '    tl.set(".scene", { autoAlpha: 0 }, 0);',
    `    tl.to({}, { duration: ${safeDuration} }, 0);`,
    '    tl.to(".neon-grid", { backgroundPosition: "140px 220px", duration: Math.max(8, ' + safeDuration + '), ease: "none" }, 0);',
    '    tl.to(".radial-energy", { rotate: 16, scale: 1.08, duration: Math.max(8, ' + safeDuration + '), ease: "sine.inOut" }, 0);',
  ];
  scenes.forEach((scene, index) => lines.push(buildSceneAnimation(scene, index, motionScale, frameOptions)));
  return lines.join('\n');
}

module.exports = {
  buildSceneAnimation,
  buildTimelineScript,
};
