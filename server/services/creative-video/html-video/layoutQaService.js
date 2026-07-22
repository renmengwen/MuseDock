const fs = require('fs/promises');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

const DEFAULT_RESOLUTION = { width: 1920, height: 1080 };
const CAMERA_SAFE_BOTTOM_PX = 140;
const REQUIRED_ASSET_PIXEL_DIFF_THRESHOLD = 8;
const REQUIRED_ASSET_MIN_CHANGED_PIXEL_RATIO = 0.05;
const REQUIRED_ASSET_PROBE_MAX_PIXELS = 4_000_000;
const IMAGE_MIME_BY_EXTENSION = Object.freeze({
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
});
const CANDIDATE_SELECTOR = [
  '[data-text-key]',
  '.headline',
  '.body-copy',
  '.card-title',
  '.big-number',
  '.valuation',
  '[data-role]',
  'h1',
  'h2',
  'h3',
  'p',
  'li',
  'span',
  'div',
].join(',');

function defaultSampleTimes(durationSec) {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration <= 0) return [0.1];
  if (duration < 1.2) return [Number(Math.max(0.1, duration * 0.5).toFixed(3))];
  return normalizeSampleTimes([
    duration < 2 ? 0.8 : 1.2,
    1.8,
    duration * 0.65,
    Math.max(0, duration - 0.3),
  ], duration);
}

function normalizeSampleTimes(sampleTimesSec, durationSec) {
  const duration = Number(durationSec);
  const hasDuration = Number.isFinite(duration) && duration >= 0;
  const sorted = (Array.isArray(sampleTimesSec) ? sampleTimesSec : [])
    .map(time => Number(time))
    .filter(time => Number.isFinite(time) && time >= 0)
    .filter(time => !hasDuration || time <= duration)
    .sort((a, b) => a - b);

  const normalized = [];
  for (const time of sorted) {
    const rounded = Number(time.toFixed(3));
    const previous = normalized[normalized.length - 1];
    if (previous !== undefined && rounded - previous < 0.05 - 1e-9) continue;
    normalized.push(rounded);
  }
  return normalized;
}

async function loadPlaywright(options = {}) {
  if (options.playwright) return options.playwright;
  try {
    if (typeof options.importPlaywright === 'function') {
      return await options.importPlaywright();
    }
    return await import('playwright-core');
  } catch (error) {
    return { error };
  }
}

function makeIssue({
  code,
  severity = 'error',
  frameId,
  sampleTimeSec,
  message,
  details = {},
}) {
  return {
    code,
    severity,
    frame_id: frameId || null,
    sample_time_sec: sampleTimeSec,
    message,
    details,
  };
}

function isBlockingIssue(issue) {
  return issue.severity !== 'warning' && issue.severity !== 'info';
}

function normalizeShotIds(values) {
  return Array.isArray(values)
    ? [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].sort()
    : [];
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const details = issue.details || {};
    const shotIds = normalizeShotIds(details.shot_ids).join(',');
    const inWindowShotIds = normalizeShotIds(details.in_window_shot_ids).join(',');
    const key = [
      issue.code,
      details.selector, details.text,
      details.first?.selector, details.first?.text,
      details.second?.selector, details.second?.text,
      shotIds, inWindowShotIds,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function intersects(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return { width, height, area: width * height };
}

function isPrimaryText(candidate) {
  const name = `${candidate.key || ''} ${candidate.selector || ''}`.toLowerCase();
  return name.includes('headline')
    || name.includes('body')
    || name.includes('subtitle');
}

function isDecorativeText(candidate) {
  const name = [
    candidate.key,
    candidate.role,
    candidate.selector,
    candidate.container?.role,
    candidate.container?.selector,
  ].filter(Boolean).join(' ').toLowerCase();
  return /section|scene|counter|number|decorative|ornament|background|watermark|brand|footer|kicker|eyebrow|label|badge|chip|meta|signal|engine|date|time|stamp|dim|tick/.test(name);
}

function inspectCandidates({ candidates, resolution, frameId, sampleTimeSec }) {
  const issues = [];
  const tolerance = 12;
  const blockingOverlapIndexes = new Set();

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.text === b.text) continue;
      if (
        (Array.isArray(a.ancestorIndexes) && a.ancestorIndexes.includes(b.index))
        || (Array.isArray(b.ancestorIndexes) && b.ancestorIndexes.includes(a.index))
      ) {
        continue;
      }

      const intersection = intersects(a.box, b.box);
      if (intersection.area <= 0) continue;

      const smallerArea = Math.min(a.box.width * a.box.height, b.box.width * b.box.height);
      if (smallerArea <= 0 || intersection.area / smallerArea <= 0.25) continue;

      const crossfadingBeats = a.beatScope && b.beatScope && a.beatScope !== b.beatScope
        && [a, b].some(candidate => (
          candidate.scopeEffectiveOpacity > 0.001 && candidate.scopeEffectiveOpacity < 0.999
          && candidate.opacityTransitionRunning
        ));
      if (!crossfadingBeats) {
        blockingOverlapIndexes.add(a.index);
        blockingOverlapIndexes.add(b.index);
      }
    }
  }

  for (const candidate of candidates) {
    const box = candidate.box;
    const decorative = isDecorativeText(candidate);
    if (!candidate.allowOverflow && (
      box.left < -tolerance
      || box.top < -tolerance
      || box.right > resolution.width + tolerance
      || box.bottom > resolution.height + tolerance
    )) {
      issues.push(makeIssue({
        code: 'text_out_of_viewport',
        severity: decorative ? 'warning' : 'error',
        frameId,
        sampleTimeSec,
        message: '文本超出画面边界。',
        details: {
          text: candidate.text,
          selector: candidate.selector,
          box,
          viewport: resolution,
        },
      }));
    }

    const container = candidate.container;
    if (!candidate.allowOverflow && container && container.box) {
      const cbox = container.box;
      const horizontalOverflow = box.left < cbox.left - tolerance || box.right > cbox.right + tolerance;
      const verticalOverflow = box.top < cbox.top - tolerance || box.bottom > cbox.bottom + tolerance;
      const settledBox = candidate.transientTransformDelta && {
        left: box.left - candidate.transientTransformDelta.x,
        right: box.right - candidate.transientTransformDelta.x,
        top: box.top - candidate.transientTransformDelta.y,
        bottom: box.bottom - candidate.transientTransformDelta.y,
      };
      const transformCausesOverflow = settledBox
        && settledBox.left >= cbox.left - tolerance && settledBox.right <= cbox.right + tolerance
        && settledBox.top >= cbox.top - tolerance && settledBox.bottom <= cbox.bottom + tolerance;
      const transientVisibleOverflow = transformCausesOverflow
        && (!horizontalOverflow || container.overflowX === 'visible')
        && (!verticalOverflow || container.overflowY === 'visible')
        && box.left >= 0 && box.top >= 0
        && box.right <= resolution.width && box.bottom <= resolution.height
        && !blockingOverlapIndexes.has(candidate.index);
      if ((horizontalOverflow || verticalOverflow) && !transientVisibleOverflow) {
        issues.push(makeIssue({
          code: 'text_out_of_container',
          severity: decorative ? 'warning' : 'error',
          frameId,
          sampleTimeSec,
          message: '文本超出语义容器边界。',
          details: {
            text: candidate.text,
            selector: candidate.selector,
            container: container.selector,
            box,
            container_box: cbox,
          },
        }));
      }
    }
  }

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.text === b.text) continue;
      if (
        (Array.isArray(a.ancestorIndexes) && a.ancestorIndexes.includes(b.index))
        || (Array.isArray(b.ancestorIndexes) && b.ancestorIndexes.includes(a.index))
      ) {
        continue;
      }

      const intersection = intersects(a.box, b.box);
      if (intersection.area <= 0) continue;

      const smallerArea = Math.min(a.box.width * a.box.height, b.box.width * b.box.height);
      if (smallerArea <= 0 || intersection.area / smallerArea <= 0.25) continue;

      const code = isPrimaryText(a) || isPrimaryText(b)
        ? 'decorative_overlay_text'
        : 'text_overlap';
      const crossfadingBeats = a.beatScope && b.beatScope && a.beatScope !== b.beatScope
        && [a, b].some(candidate => (
          candidate.scopeEffectiveOpacity > 0.001 && candidate.scopeEffectiveOpacity < 0.999
          && candidate.opacityTransitionRunning
        ));
      issues.push(makeIssue({
        code,
        severity: crossfadingBeats ? 'warning' : 'error',
        frameId,
        sampleTimeSec,
        message: '检测到文本元素互相重叠。',
        details: {
          first: {
            text: a.text, selector: a.selector, beat_scope: a.beatScope || null,
            effective_opacity: a.effectiveOpacity,
            scope_effective_opacity: a.scopeEffectiveOpacity,
            opacity_transition_running: a.opacityTransitionRunning,
            box: a.box,
          },
          second: {
            text: b.text, selector: b.selector, beat_scope: b.beatScope || null,
            effective_opacity: b.effectiveOpacity,
            scope_effective_opacity: b.scopeEffectiveOpacity,
            opacity_transition_running: b.opacityTransitionRunning,
            box: b.box,
          },
          intersection_area: Math.round(intersection.area),
          smaller_area: Math.round(smallerArea),
        },
      }));
    }
  }

  return issues;
}

async function collectCandidates(page, { sampleTimeSec, durationSec }) {
  return page.evaluate(({ selector, sampleTimeSec: sampleTime, durationSec: sceneDuration }) => {
    const semanticSelector = '[data-role]:not(section), .card, .panel, .tile, .module, article, main, section[data-role], section';
    const explicitTextSelector = [
      '[data-text-key]',
      '.headline',
      '.body-copy',
      '.card-title',
      '.big-number',
      '.valuation',
      'h1',
      'h2',
      'h3',
      'p',
      'li',
      'span',
    ].join(',');

    function directText(element) {
      return Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function effectiveOpacityFor(element) {
      let effectiveOpacity = 1;
      for (let current = element; current; current = current.parentElement) {
        const style = window.getComputedStyle(current);
        if (!style || style.display === 'none') return 0;
        const opacity = Number(style.opacity);
        if (Number.isFinite(opacity)) effectiveOpacity *= opacity;
      }
      return effectiveOpacity;
    }

    function isVisible(element, box, effectiveOpacity) {
      const elementStyle = window.getComputedStyle(element);
      if (!elementStyle || ['hidden', 'collapse'].includes(elementStyle.visibility)) return false;
      return effectiveOpacity > 0.001 && box.width >= 8 && box.height >= 8;
    }

    function serializeBox(rect) {
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }

    function selectorFor(element) {
      if (element.dataset && element.dataset.textKey) return `[data-text-key="${element.dataset.textKey}"]`;
      if (element.classList && element.classList.length) {
        return `${element.tagName.toLowerCase()}.${Array.from(element.classList).join('.')}`;
      }
      if (element.dataset && element.dataset.role) return `[data-role="${element.dataset.role}"]`;
      return element.tagName.toLowerCase();
    }

    function containerFor(element) {
      const container = element.parentElement ? element.parentElement.closest(semanticSelector) : null;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const style = window.getComputedStyle(container);
      return {
        selector: selectorFor(container),
        role: container.getAttribute('data-role') || null,
        box: serializeBox(rect),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      };
    }

    function hasLayoutFlag(element, selector) {
      return Boolean(element.closest(selector));
    }

    function translationFor(value) {
      try {
        const matrix = !value || value === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(value);
        if (Math.abs(matrix.a - 1) >= 1e-6 || Math.abs(matrix.b) >= 1e-6
          || Math.abs(matrix.c) >= 1e-6 || Math.abs(matrix.d - 1) >= 1e-6) return null;
        return { x: matrix.e, y: matrix.f };
      } catch (_) {
        return null;
      }
    }

    function contentBoxFor(element, rect) {
      for (let current = element; current; current = current.parentElement) {
        const style = window.getComputedStyle(current);
        const zoom = Number(style.zoom || 1);
        if (!translationFor(style.transform) || !Number.isFinite(zoom) || Math.abs(zoom - 1) >= 1e-6
          || !['none', '1'].includes(style.scale) || style.rotate !== 'none') return null;
      }
      const style = window.getComputedStyle(element);
      const inset = [
        style.borderLeftWidth, style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth,
        style.paddingLeft, style.paddingTop, style.paddingRight, style.paddingBottom,
      ].map(value => Number.parseFloat(value));
      if (inset.some(value => !Number.isFinite(value))) return null;
      const [borderLeft, borderTop, borderRight, borderBottom, paddingLeft, paddingTop, paddingRight, paddingBottom] = inset;
      const left = rect.left + borderLeft + paddingLeft;
      const top = rect.top + borderTop + paddingTop;
      const right = rect.right - borderRight - paddingRight;
      const bottom = rect.bottom - borderBottom - paddingBottom;
      if (right <= left || bottom <= top) return null;
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    }

    function transientTransformDeltaFor(element, container) {
      const sceneRemainingMs = (Number(sceneDuration) - Number(sampleTime)) * 1000;
      if (!Number.isFinite(sceneRemainingMs) || sceneRemainingMs < 0) return null;
      for (let current = element; current && current !== container; current = current.parentElement) {
        const animations = Array.from(current.getAnimations()).filter(animation => (
          animation.playState === 'running'
          && typeof animation.effect?.getKeyframes === 'function'
          && animation.effect.getKeyframes().some(frame => Object.prototype.hasOwnProperty.call(frame, 'transform'))
        ));
        if (animations.length !== 1) continue;

        const animation = animations[0];
        const timing = animation.effect.getTiming();
        const computedTiming = animation.effect.getComputedTiming();
        const frames = animation.effect.getKeyframes()
          .filter(frame => Object.prototype.hasOwnProperty.call(frame, 'transform'))
          .map(frame => ({ offset: Number(frame.computedOffset), translation: translationFor(frame.transform) }));
        const currentTranslation = translationFor(window.getComputedStyle(current).transform);
        if (frames.length < 2 || frames.some(frame => !Number.isFinite(frame.offset) || !frame.translation)
          || !currentTranslation || timing.iterations !== 1 || timing.direction !== 'normal'
          || !['forwards', 'both'].includes(timing.fill)
          || animation.playbackRate <= 0 || !Number.isFinite(computedTiming.endTime)
          || !Number.isFinite(Number(animation.currentTime)) || !Number.isFinite(Number(computedTiming.duration))) continue;

        const terminal = frames.at(-1).translation;
        const changesTranslation = frames.some(frame => (
          Math.abs(frame.translation.x - frames[0].translation.x) > 0.01
          || Math.abs(frame.translation.y - frames[0].translation.y) > 0.01
        ));
        if (!changesTranslation) continue;

        const settleIndex = frames.findIndex((frame, index) => frames.slice(index).every(later => (
          Math.abs(later.translation.x - terminal.x) <= 0.01
          && Math.abs(later.translation.y - terminal.y) <= 0.01
        )));
        const settleTime = Number(timing.delay) + Number(computedTiming.duration) * frames[settleIndex].offset;
        if (settleTime > computedTiming.endTime + 1e-6) continue;
        const msUntilSettled = Math.max(0, settleTime - Number(animation.currentTime)) / animation.playbackRate;
        if (!Number.isFinite(msUntilSettled) || msUntilSettled > sceneRemainingMs + 1) continue;

        return {
          x: currentTranslation.x - terminal.x,
          y: currentTranslation.y - terminal.y,
        };
      }
      return null;
    }

    const records = Array.from(document.querySelectorAll(selector))
      .map((element) => {
        if (hasLayoutFlag(element, '[data-layout-ignore]')) return null;
        const rect = element.getBoundingClientRect();
        const direct = directText(element);
        const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        const isExplicitText = element.matches(explicitTextSelector);
        const effectiveOpacity = effectiveOpacityFor(element);
        const beatScopeElement = element.closest('[data-mp-beat-scope]');
        const container = element.parentElement ? element.parentElement.closest(semanticSelector) : null;
        if (!text || (!direct && !isExplicitText)) return null;
        if (!isVisible(element, rect, effectiveOpacity)) return null;
        return {
          element,
          hasDirectText: Boolean(direct),
          candidate: {
            key: element.getAttribute('data-text-key') || null,
            role: element.getAttribute('data-role') || null,
            tag: element.tagName.toLowerCase(),
            selector: selectorFor(element),
            beatScope: beatScopeElement?.getAttribute('data-mp-beat-scope') || null,
            effectiveOpacity,
            scopeEffectiveOpacity: beatScopeElement ? effectiveOpacityFor(beatScopeElement) : null,
            opacityTransitionRunning: Boolean(beatScopeElement && Array.from(beatScopeElement.getAnimations()).some(animation => (
              typeof CSSTransition !== 'undefined'
              && animation instanceof CSSTransition
              && animation.playState === 'running'
              && animation.transitionProperty === 'opacity'
            ))),
            transientTransformDelta: transientTransformDeltaFor(element, container),
            text,
            box: isExplicitText ? (contentBoxFor(element, rect) || serializeBox(rect)) : serializeBox(rect),
            container: containerFor(element),
            allowOverflow: hasLayoutFlag(element, '[data-layout-allow-overflow]'),
          },
        };
      })
      .filter(Boolean);

    const textRecords = records.filter(record => (
      record.hasDirectText
      || !records.some(other => other !== record && record.element.contains(other.element))
    ));

    return textRecords.map((record, index) => ({
      ...record.candidate,
      index,
      ancestorIndexes: textRecords
        .map((other, otherIndex) => (
          otherIndex !== index && other.element.contains(record.element) ? otherIndex : null
        ))
        .filter(otherIndex => otherIndex !== null),
    }));
  }, { selector: CANDIDATE_SELECTOR, sampleTimeSec, durationSec });
}

async function collectCameraSample(page, resolution, sampleTimeSec, allowStaticCameraCues = false) {
  return page.evaluate(({ viewport, timeSec, safeBottomPx, staticPlanAllowed }) => {
    const sequence = document.querySelector('[data-hv-image-sequence]');
    if (!sequence) return null;

    function box(rect) {
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }

    function parseJson(value) {
      try { return JSON.parse(value || ''); } catch (_) { return null; }
    }

    function ready(image) {
      return Boolean(image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
    }

    const activeCaptions = Array.from(document.querySelectorAll('[data-caption-id][data-hv-active="true"]'))
      .map(element => box(element.getBoundingClientRect()));
    const activeShots = Array.from(sequence.querySelectorAll('[data-hv-shot][data-shot-active="true"]'));
    const shots = activeShots.map((shot) => {
      const foreground = shot.querySelector('img[data-shot-layer="foreground"]');
      const background = shot.querySelector('img[data-shot-layer="background"]');
      const shotRect = shot.getBoundingClientRect();
      const shotStyle = getComputedStyle(shot);
      const style = foreground ? getComputedStyle(foreground) : null;
      const matrix = style && style.transform && style.transform !== 'none'
        ? new DOMMatrixReadOnly(style.transform)
        : new DOMMatrixReadOnly();
      const scale = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b);
      const plannedCues = parseJson(shot.dataset.cameraCues) || [];
      const runtimeResolved = Object.prototype.hasOwnProperty.call(shot, '__hvResolvedCameraCues')
        && Array.isArray(shot.__hvResolvedCameraCues);
      const cues = runtimeResolved
        ? shot.__hvResolvedCameraCues
        : staticPlanAllowed ? plannedCues : [];
      let cue = null;
      let cueIndex = -1;
      let returningToOverview = false;
      for (let index = 0; index < cues.length; index += 1) {
        if (Number(cues[index]?.start_sec) <= timeSec) {
          cue = cues[index];
          cueIndex = index;
        }
      }
      if (cue && cueIndex === cues.length - 1) {
        const end = Number(cue.end_sec);
        const windowEnd = Number(shot.dataset.windowEndSec);
        const returnsToOverview = Number.isFinite(end) && Number.isFinite(windowEnd) && windowEnd - end >= 0.6 - 1e-6;
        if (returnsToOverview && timeSec > end + 0.6) cue = null;
        else if (returnsToOverview && timeSec > end) returningToOverview = true;
      }
      const cueStart = Number(cue?.start_sec);
      const cueEnd = Number(cue?.end_sec);
      const transitionDuration = Number.isFinite(cueStart) && Number.isFinite(cueEnd)
        ? Math.min(0.8, Math.max(0.45, (cueEnd - cueStart) * 0.4))
        : 0;
      const focusStable = Boolean(cue && !returningToOverview && timeSec >= cueStart + transitionDuration - 1e-6);
      const region = cue?.effective_region || cue?.region;
      let targetBox = null;
      if (ready(foreground) && region && [region.x, region.y, region.width, region.height].every(Number.isFinite)) {
        const baseScale = Math.min(shotRect.width / foreground.naturalWidth, shotRect.height / foreground.naturalHeight);
        const imageWidth = foreground.naturalWidth * baseScale;
        const imageHeight = foreground.naturalHeight * baseScale;
        const imageLeft = (shotRect.width - imageWidth) / 2;
        const imageTop = (shotRect.height - imageHeight) / 2;
        const left = shotRect.left + matrix.e + (imageLeft + region.x * imageWidth) * scale;
        const top = shotRect.top + matrix.f + (imageTop + region.y * imageHeight) * scale;
        targetBox = {
          left,
          top,
          right: left + region.width * imageWidth * scale,
          bottom: top + region.height * imageHeight * scale,
          width: region.width * imageWidth * scale,
          height: region.height * imageHeight * scale,
        };
      }
      const expectedRegion = parseJson(shot.dataset.layoutQaExpectedRegion);
      const backgroundRect = background ? background.getBoundingClientRect() : null;
      return {
        shot_id: shot.dataset.shotId || null,
        visible: shotStyle.display !== 'none' && shotStyle.visibility !== 'hidden'
          && Number(shotStyle.opacity) > 0 && shotRect.width > 0 && shotRect.height > 0,
        foreground_ready: ready(foreground),
        background_ready: ready(background),
        shot_box: box(shotRect),
        background_box: backgroundRect ? box(backgroundRect) : null,
        scale,
        tx: matrix.e,
        ty: matrix.f,
        has_transform: !(scale > 0.9999 && scale < 1.0001
          && matrix.e > -0.01 && matrix.e < 0.01
          && matrix.f > -0.01 && matrix.f < 0.01),
        camera_plan_present: plannedCues.length > 0,
        camera_runtime_resolved: runtimeResolved,
        camera_static_plan_allowed: staticPlanAllowed,
        cue,
        returning_to_overview: returningToOverview,
        focus_stable: focusStable,
        target_box: targetBox,
        expected_region: expectedRegion,
        caption_boxes: activeCaptions,
      };
    });
    return {
      mode: sequence.dataset.sequenceMode || '',
      viewport,
      safe_bottom: viewport.height - safeBottomPx,
      clock_time_sec: typeof window.__hvPlaybackClock?.timeSec === 'function'
        ? window.__hvPlaybackClock.timeSec()
        : null,
      clock_paused: typeof window.__hvPlaybackClock?.paused === 'function'
        ? window.__hvPlaybackClock.paused()
        : null,
      adapter_controlled: window.__mpAdapterControlled === true,
      active_shot_count: activeShots.length,
      visible_shot_count: shots.filter(shot => shot.visible).length,
      shots,
    };
  }, {
    viewport: resolution,
    timeSec: sampleTimeSec,
    safeBottomPx: CAMERA_SAFE_BOTTOM_PX,
    staticPlanAllowed: allowStaticCameraCues === true,
  });
}

async function cameraCueSampleTimes(page, durationSec) {
  const times = await page.evaluate(() => Array.from(document.querySelectorAll('[data-camera-cues]'))
    .flatMap((shot) => {
      let cues = [];
      try { cues = JSON.parse(shot.dataset.cameraCues || '[]'); } catch (_) {}
      const windowEnd = Number(shot.dataset.windowEndSec);
      return cues.flatMap((cue, index) => {
        const start = Number(cue?.start_sec);
        const end = Number(cue?.end_sec);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.4) return [];
        const transitionDuration = Math.min(0.8, Math.max(0.45, (end - start) * 0.4));
        const stable = Math.min(end - 0.05, start + transitionDuration);
        const returnsToOverview = index === cues.length - 1
          && Number.isFinite(windowEnd) && windowEnd - end >= 0.6 - 1e-6;
        return [
          ...(start >= 0.1 ? [start - 0.05] : []),
          ...[0.05, 0.15, 0.25, 0.35].map(offset => start + offset),
          ...(stable >= start + 0.45 - 1e-6 && stable < end ? [stable] : []),
          ...(returnsToOverview ? [end + 0.15, end + 0.45] : []),
        ];
      });
    }));
  return normalizeSampleTimes(times, durationSec);
}

async function requiredShotManifest(page, durationSec) {
  const rawShots = await page.evaluate(() => Array.from(document.querySelectorAll(
    '[data-hv-shot][data-shot-requirement="required"]',
  )).map((shot, index) => ({
    index,
    shot_id: shot.getAttribute('data-shot-id') || '',
    window_start_sec: shot.getAttribute('data-window-start-sec'),
    window_end_sec: shot.getAttribute('data-window-end-sec'),
  })));
  const seen = new Set();
  const shots = [];
  const errors = [];
  const duration = Number(durationSec);
  if (rawShots.length && (!Number.isFinite(duration) || duration <= 0)) {
    errors.push({ index: null, shot_id: '', invalid_fields: ['duration_sec'] });
  }
  for (const raw of rawShots) {
    const shotId = String(raw.shot_id || '').trim();
    const startText = String(raw.window_start_sec ?? '').trim();
    const endText = String(raw.window_end_sec ?? '').trim();
    const startSec = Number(startText);
    const endSec = Number(endText);
    const invalidFields = [];
    if (!shotId) invalidFields.push('data-shot-id');
    else if (seen.has(shotId)) invalidFields.push('data-shot-id:duplicate');
    if (!startText || !Number.isFinite(startSec) || startSec < 0) invalidFields.push('data-window-start-sec');
    if (!endText || !Number.isFinite(endSec) || endSec <= startSec
      || (Number.isFinite(duration) && endSec > duration + 1e-6)) invalidFields.push('data-window-end-sec');
    if (invalidFields.length) {
      errors.push({ index: raw.index, shot_id: shotId, invalid_fields: invalidFields });
    } else {
      shots.push({ shot_id: shotId, start_sec: startSec, end_sec: endSec });
    }
    if (shotId) seen.add(shotId);
  }
  return { shots, errors };
}

function cameraIssuesForSample(sample, { frameId, sampleTimeSec }) {
  if (!sample) return [];
  const issues = [];
  if (!sample.visible_shot_count) {
    return [makeIssue({
      code: 'camera_scene_blank', frameId, sampleTimeSec,
      message: 'Scene 采样时没有可见图片。',
    })];
  }
  for (const shot of sample.shots) {
    const details = { selector: shot.shot_id, shot_id: shot.shot_id };
    if (shot.camera_plan_present && !shot.camera_runtime_resolved && !shot.camera_static_plan_allowed) {
      issues.push(makeIssue({
        code: 'camera_runtime_unresolved', frameId, sampleTimeSec,
        message: '摄影机运行时未解析当前焦点计划。', details,
      }));
    }
    if (!shot.foreground_ready) {
      issues.push(makeIssue({
        code: 'camera_image_not_ready', frameId, sampleTimeSec,
        message: '摄影机前景图片尚未加载完成。', details,
      }));
    }
    if (sample.mode === 'fullscreen_relay') {
      const box = shot.background_box;
      if (!shot.background_ready || !box || box.left > 1 || box.top > 1
        || box.right < sample.viewport.width - 1 || box.bottom < sample.viewport.height - 1) {
        issues.push(makeIssue({
          code: 'camera_blank_edge', frameId, sampleTimeSec,
          message: '全屏图片边缘没有完整背景覆盖。', details: { ...details, background_box: box },
        }));
      }
    }
    const maxZoom = Number(shot.cue?.max_zoom);
    if ((!shot.cue || shot.focus_stable) && (shot.scale < 1 - 1e-4 || shot.scale > 3 + 1e-4
      || (Number.isFinite(maxZoom) && shot.scale > maxZoom + 1e-4))) {
      issues.push(makeIssue({
        code: 'camera_zoom_out_of_range', frameId, sampleTimeSec,
        message: '摄影机倍率超出当前焦点允许范围。', details: { ...details, scale: shot.scale, max_zoom: maxZoom },
      }));
    }
    if (shot.has_transform && !shot.cue) {
      issues.push(makeIssue({
        code: 'camera_untrusted_motion', frameId, sampleTimeSec,
        message: '图片发生了没有有效焦点 cue 支持的移动。', details: { ...details, scale: shot.scale, tx: shot.tx, ty: shot.ty },
      }));
    }
    if (shot.camera_runtime_resolved && shot.cue && shot.focus_stable && !shot.has_transform) {
      issues.push(makeIssue({
        code: 'camera_transform_missing', frameId, sampleTimeSec,
        message: '摄影机已接受焦点，但稳定时间窗内没有执行画面变换。',
        details: { ...details, scale: shot.scale, tx: shot.tx, ty: shot.ty },
      }));
    }
    if (shot.target_box && shot.focus_stable) {
      if (shot.target_box.left < -1 || shot.target_box.top < -1
        || shot.target_box.right > sample.viewport.width + 1
        || shot.target_box.bottom > sample.safe_bottom + 1) {
        issues.push(makeIssue({
          code: 'camera_target_out_of_safe_area', frameId, sampleTimeSec,
          message: '摄影机目标未完整停留在字幕外安全区。',
          details: { ...details, target_box: shot.target_box, safe_bottom: sample.safe_bottom },
        }));
      }
      if (shot.caption_boxes.some(caption => intersects(shot.target_box, caption).area > 0)) {
        issues.push(makeIssue({
          code: 'camera_caption_target_overlap', frameId, sampleTimeSec,
          message: '字幕遮挡了当前摄影机焦点目标。', details: { ...details, target_box: shot.target_box },
        }));
      }
    }
    const expected = shot.focus_stable ? shot.expected_region : null;
    const actual = shot.cue?.region;
    if (expected && actual
      && [expected.x, expected.y, expected.width, expected.height, actual.x, actual.y, actual.width, actual.height].every(Number.isFinite)) {
      const expectedBox = { left: expected.x, top: expected.y, right: expected.x + expected.width, bottom: expected.y + expected.height };
      const actualBox = { left: actual.x, top: actual.y, right: actual.x + actual.width, bottom: actual.y + actual.height };
      const overlap = intersects(expectedBox, actualBox).area;
      const expectedArea = expected.width * expected.height;
      if (expectedArea > 0 && overlap / expectedArea < 0.5) {
        issues.push(makeIssue({
          code: 'camera_wrong_focus', frameId, sampleTimeSec,
          message: '摄影机焦点与人工验收区域不一致。', details: { ...details, expected_region: expected, actual_region: actual },
        }));
      }
    }
  }
  return issues;
}

function cameraJitterIssues(samples, frameId) {
  const byShot = new Map();
  for (const sample of samples) {
    for (const shot of sample.shots || []) {
      if (!byShot.has(shot.shot_id)) byShot.set(shot.shot_id, []);
      byShot.get(shot.shot_id).push({ time: sample.sample_time_sec, ...shot });
    }
  }
  const issues = [];
  for (const [shotId, records] of byShot) {
    let reversals = 0;
    let previous = null;
    for (let index = 1; index < records.length; index += 1) {
      const current = {
        x: records[index].tx - records[index - 1].tx,
        y: records[index].ty - records[index - 1].ty,
        z: records[index].scale - records[index - 1].scale,
      };
      const magnitude = Math.hypot(current.x, current.y, current.z * 100);
      if (previous && magnitude > 1 && Math.hypot(previous.x, previous.y, previous.z * 100) > 1
        && current.x * previous.x + current.y * previous.y + current.z * previous.z * 10000 < 0
        && records[index].time - records[index - 2].time <= 0.5) reversals += 1;
      if (magnitude > 1) previous = current;
    }
    if (reversals >= 2) {
      issues.push(makeIssue({
        code: 'camera_jitter', frameId, sampleTimeSec: records.at(-1)?.time ?? null,
        message: '摄影机在短时间内反复改变移动方向。',
        details: { selector: shotId, shot_id: shotId, reversal_count: reversals },
      }));
    }
  }
  return issues;
}

async function waitForLayout(page) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
  });
}

async function projectAssetsRootForHtml(htmlPath, explicitAssetsRoot) {
  if (explicitAssetsRoot) return fs.realpath(explicitAssetsRoot);
  let current = path.dirname(await fs.realpath(htmlPath));
  while (true) {
    if (path.basename(current).toLowerCase() === 'frames') {
      return fs.realpath(path.join(path.dirname(current), 'assets')).catch(() => null);
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function controlledImageDataUrl(source, assetsRoot) {
  if (typeof source !== 'string' || !source) {
    throw new Error('required asset visibility source missing');
  }
  if (/^data:image\//i.test(source)) return source;

  let parsed;
  try { parsed = new URL(source); } catch (_) {
    throw new Error('required asset visibility source URL invalid');
  }
  if (parsed.protocol !== 'file:') {
    throw new Error(`required asset visibility source scheme denied: ${parsed.protocol || 'unknown'}`);
  }
  if (!assetsRoot) throw new Error('required asset visibility project assets root missing');

  const realSourcePath = await fs.realpath(fileURLToPath(parsed));
  const relative = path.relative(assetsRoot, realSourcePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('required asset visibility source escaped project assets');
  }
  const mime = IMAGE_MIME_BY_EXTENSION[path.extname(realSourcePath).toLowerCase()];
  if (!mime) throw new Error('required asset visibility source image type unsupported');
  const bytes = await fs.readFile(realSourcePath);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function inspectRequiredAssetVisibility(page, resolution, {
  assetsRoot = null,
  controlledSourceCache = new Map(),
  sourceIdentityCache = new Map(),
  injectedSourceKeys = new Set(),
} = {}) {
  const prepared = await page.evaluate(({ viewport, safeBottomPx }) => {
    const sequence = document.querySelector('[data-hv-image-sequence]');
    if (!sequence) return null;
    const requiredSelector = '[data-hv-shot][data-shot-requirement="required"]';
    if (!sequence.querySelector(requiredSelector)) return null;

    const clock = window.__hvPlaybackClock;
    const trustedClock = clock?.__hvOwner === 'musedock-playback-clock-v1'
      && typeof clock.pause === 'function' && typeof clock.play === 'function' && typeof clock.paused === 'function';
    const clockWasPaused = trustedClock ? clock.paused() : true;
    if (trustedClock) clock.pause();
    const rafController = window.__layoutQaRafController;
    const rafWasPaused = typeof rafController?.paused === 'function' ? rafController.paused() : true;
    if (!rafWasPaused && typeof rafController?.pause === 'function') rafController.pause();
    const animations = document.getAnimations().map(animation => ({
      animation,
      playState: animation.playState,
      currentTime: animation.currentTime,
      playbackRate: animation.playbackRate,
    }));
    for (const item of animations) {
      try { item.animation.pause(); } catch (_) {}
    }

    const requiredShots = Array.from(sequence.querySelectorAll(
      '[data-hv-shot][data-shot-active="true"][data-shot-requirement="required"]',
    )).filter((shot) => {
      const style = getComputedStyle(shot);
      const rect = shot.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    });
    const shotStates = requiredShots.map(shot => ({
      shot,
      layers: Array.from(shot.querySelectorAll('[data-shot-layer]')).map((layer) => {
        const naturalWidth = Number(layer.naturalWidth);
        const naturalHeight = Number(layer.naturalHeight);
        const rect = layer.getBoundingClientRect();
        return {
          layer,
          originalSrc: layer.getAttribute('src'),
          originalSrcset: layer.getAttribute('srcset'),
          originalCurrentSrc: layer.currentSrc,
          originalProbe: layer.getAttribute('data-layout-qa-required-layer-probe'),
          originalStyle: layer.getAttribute('style'),
          naturalWidth,
          naturalHeight,
          displayWidth: Number(rect.width),
          displayHeight: Number(rect.height),
        };
      }),
      layerStateRestored: true,
    }));

    window.__layoutQaRequiredAssetRestore = {
      trustedClock,
      clockWasPaused,
      rafController,
      rafWasPaused,
      animations,
      shots: shotStates,
    };
    return {
      targets: requiredShots.map((shot, index) => {
        const rect = shot.getBoundingClientRect();
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(viewport.width, rect.right);
        const bottom = Math.min(viewport.height - safeBottomPx, rect.bottom);
        return {
          index,
          shot_id: shot.dataset.shotId || '',
          asset_id: shot.dataset.assetId || '',
          layers: shotStates[index].layers.map(layer => ({
            current_src: layer.originalCurrentSrc,
            natural_width: layer.naturalWidth,
            natural_height: layer.naturalHeight,
            display_width: layer.displayWidth,
            display_height: layer.displayHeight,
          })),
          subject_region: {
            left: Math.floor(left),
            top: Math.floor(top),
            width: Math.max(0, Math.ceil(right) - Math.floor(left)),
            height: Math.max(0, Math.ceil(bottom) - Math.floor(top)),
          },
        };
      }),
    };
  }, { viewport: resolution, safeBottomPx: CAMERA_SAFE_BOTTOM_PX });
  if (!prepared) return null;

  const preparedShotIds = prepared.targets.map(target => String(target.shot_id || '').trim()).filter(Boolean);
  function attachPreparedShotIds(error) {
    const attached = error && typeof error === 'object' ? error : new Error(String(error));
    attached.required_asset_shot_ids = preparedShotIds;
    return attached;
  }
  try {
  const blackProbeScreenshots = [];
  const whiteProbeScreenshots = [];
  let restored = false;
  let restorationDetails = {};
  try {
    const sourceByKey = new Map();
    const sourceKeysByTarget = prepared.targets.map(target => target.layers.map((layer) => {
      if (!sourceIdentityCache.has(layer.current_src)) {
        sourceIdentityCache.set(layer.current_src, `source-${sourceIdentityCache.size}`);
      }
      const sourceKey = sourceIdentityCache.get(layer.current_src);
      sourceByKey.set(sourceKey, layer.current_src);
      return sourceKey;
    }));
    const uniqueSourceKeys = [...new Set(sourceKeysByTarget.flat())];
    const sourceEntries = await Promise.all(uniqueSourceKeys
      .filter(sourceKey => !injectedSourceKeys.has(sourceKey))
      .map(async (sourceKey) => {
        const source = sourceByKey.get(sourceKey);
        if (!controlledSourceCache.has(source)) {
          controlledSourceCache.set(source, controlledImageDataUrl(source, assetsRoot));
        }
        return [sourceKey, await controlledSourceCache.get(source)];
      }));
    await page.evaluate(async ({ sourceKeysByTarget: sourceKeys, sourceEntries: entries, maxProbePixels }) => {
      const state = window.__layoutQaRequiredAssetRestore;
      if (!state) throw new Error('required asset visibility state missing');
      const sourceCache = window.__layoutQaRequiredAssetSourceCache || new Map();
      window.__layoutQaRequiredAssetSourceCache = sourceCache;
      for (const [key, source] of entries) sourceCache.set(key, source);

      async function alphaProbeDataUrl(source, color, layer) {
        const { naturalWidth: width, naturalHeight: height, displayWidth, displayHeight } = layer;
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
          throw new Error('required asset visibility image state invalid');
        }
        const image = new Image();
        image.src = source;
        await image.decode();
        if (image.naturalWidth !== width || image.naturalHeight !== height) {
          throw new Error('required asset visibility controlled source dimensions changed');
        }
        const displayPixels = Math.max(1, Math.ceil(displayWidth) * Math.ceil(displayHeight));
        const pixelBudget = Math.max(1, Math.min(maxProbePixels, displayPixels * 4));
        const scale = Math.min(1, Math.sqrt(pixelBudget / (width * height)));
        const probeWidth = Math.max(1, Math.round(width * scale));
        const probeHeight = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = probeWidth;
        canvas.height = probeHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('required asset visibility canvas unavailable');
        context.drawImage(image, 0, 0, probeWidth, probeHeight);
        context.globalCompositeOperation = 'source-in';
        context.fillStyle = color;
        context.fillRect(0, 0, probeWidth, probeHeight);
        const dataUrl = canvas.toDataURL('image/png');
        if (!dataUrl.startsWith('data:image/png')) {
          throw new Error('required asset visibility alpha probe serialization failed');
        }
        const decodedProbe = new Image();
        decodedProbe.src = dataUrl;
        await decodedProbe.decode();
        return dataUrl;
      }

      for (let shotIndex = 0; shotIndex < state.shots.length; shotIndex += 1) {
        const item = state.shots[shotIndex];
        const keys = sourceKeys[shotIndex];
        if (!Array.isArray(keys) || keys.length !== item.layers.length) {
          throw new Error('required asset visibility controlled source state mismatch');
        }
        for (let layerIndex = 0; layerIndex < item.layers.length; layerIndex += 1) {
          const layer = item.layers[layerIndex];
          const source = sourceCache.get(keys[layerIndex]);
          if (!source) throw new Error('required asset visibility controlled source cache missing');
          layer.blackProbeToken = `probe-${shotIndex}-${layerIndex}-black`;
          layer.whiteProbeToken = `probe-${shotIndex}-${layerIndex}-white`;
          layer.blackProbeSrc = await alphaProbeDataUrl(
            source, 'black', layer,
          );
          layer.whiteProbeSrc = await alphaProbeDataUrl(
            source, 'white', layer,
          );
        }
      }
      const probeStyle = document.createElement('style');
      probeStyle.dataset.layoutQaRequiredAssetProbe = 'true';
      probeStyle.textContent = state.shots.flatMap(item => item.layers.flatMap(layer => [
        `[data-layout-qa-required-layer-probe="${layer.blackProbeToken}"]{content:url("${layer.blackProbeSrc}")!important}`,
        `[data-layout-qa-required-layer-probe="${layer.whiteProbeToken}"]{content:url("${layer.whiteProbeSrc}")!important}`,
      ])).join('');
      document.head.appendChild(probeStyle);
      state.probeStyle = probeStyle;
    }, {
      sourceKeysByTarget,
      sourceEntries,
      maxProbePixels: REQUIRED_ASSET_PROBE_MAX_PIXELS,
    });
    for (const [sourceKey] of sourceEntries) injectedSourceKeys.add(sourceKey);

    for (const target of prepared.targets) {
      try {
        await page.evaluate(async ({ index, probe }) => {
          const state = window.__layoutQaRequiredAssetRestore;
          const item = state?.shots?.[index];
          if (!item?.shot) throw new Error('required asset visibility shot state missing');
          for (const layer of item.layers) {
            const image = layer.layer;
            image.setAttribute(
              'data-layout-qa-required-layer-probe',
              probe === 'black' ? layer.blackProbeToken : layer.whiteProbeToken,
            );
          }
          if (item.layers.some(layer => ['none', 'normal'].includes(getComputedStyle(layer.layer).content))) {
            throw new Error('required asset visibility probe content not applied');
          }
          void item.shot.offsetWidth;
        }, { index: target.index, probe: 'black' });
        blackProbeScreenshots.push(await page.screenshot({ type: 'png' }));
        await page.evaluate(async ({ index, probe }) => {
          const item = window.__layoutQaRequiredAssetRestore?.shots?.[index];
          if (!item?.shot) throw new Error('required asset visibility shot state missing');
          for (const layer of item.layers) {
            const image = layer.layer;
            image.setAttribute(
              'data-layout-qa-required-layer-probe',
              probe === 'black' ? layer.blackProbeToken : layer.whiteProbeToken,
            );
          }
          if (item.layers.some(layer => ['none', 'normal'].includes(getComputedStyle(layer.layer).content))) {
            throw new Error('required asset visibility probe content not applied');
          }
          void item.shot.offsetWidth;
        }, { index: target.index, probe: 'white' });
        whiteProbeScreenshots.push(await page.screenshot({ type: 'png' }));
      } finally {
        await page.evaluate(async (index) => {
          const item = window.__layoutQaRequiredAssetRestore?.shots?.[index];
          if (!item?.shot) return;
          for (const layer of item.layers) {
            const image = layer.layer;
            if (layer.originalProbe === null) image.removeAttribute('data-layout-qa-required-layer-probe');
            else image.setAttribute('data-layout-qa-required-layer-probe', layer.originalProbe);
            item.layerStateRestored = item.layerStateRestored
              && layer.layer.getAttribute('src') === layer.originalSrc
              && layer.layer.getAttribute('srcset') === layer.originalSrcset
              && layer.layer.currentSrc === layer.originalCurrentSrc
              && layer.layer.getAttribute('data-layout-qa-required-layer-probe') === layer.originalProbe
              && layer.layer.getAttribute('style') === layer.originalStyle
              && layer.layer.naturalWidth === layer.naturalWidth
              && layer.layer.naturalHeight === layer.naturalHeight;
          }
          void item.shot.offsetWidth;
        }, target.index);
      }
    }
  } finally {
    const restoration = await page.evaluate(async () => {
      const state = window.__layoutQaRequiredAssetRestore;
      if (!state) return { restored: false, error: 'state missing' };
      state.probeStyle?.remove();
      let restoredStyles = !state.probeStyle?.isConnected;
      for (const item of state.shots || []) {
        for (const layer of item.layers) {
          const image = layer.layer;
          if (layer.originalProbe === null) image.removeAttribute('data-layout-qa-required-layer-probe');
          else image.setAttribute('data-layout-qa-required-layer-probe', layer.originalProbe);
        }
        item.layerStateRestored = item.layers.every(layer => (
          layer.layer.getAttribute('src') === layer.originalSrc
            && layer.layer.getAttribute('srcset') === layer.originalSrcset
            && layer.layer.currentSrc === layer.originalCurrentSrc
            && layer.layer.getAttribute('data-layout-qa-required-layer-probe') === layer.originalProbe
            && layer.layer.getAttribute('style') === layer.originalStyle
            && layer.layer.naturalWidth === layer.naturalWidth
            && layer.layer.naturalHeight === layer.naturalHeight
        ));
        void item.shot.offsetWidth;
      }
      for (const item of state.shots || []) {
        restoredStyles = restoredStyles && item.layerStateRestored;
      }
      let restoredAnimations = true;
      for (const item of state.animations || []) {
        try {
          item.animation.playbackRate = item.playbackRate;
          if (item.currentTime !== null) {
            item.animation.currentTime = item.currentTime;
          }
          if (item.playState === 'running' || item.playState === 'pending') item.animation.play();
          else if (item.playState === 'paused') item.animation.pause();
          else if (item.playState === 'finished') item.animation.finish();
          else if (item.playState === 'idle') item.animation.cancel();
          const playbackRateRestored = Math.abs(
            Number(item.animation.playbackRate) - Number(item.playbackRate),
          ) <= 1e-9;
          const currentTimeRestored = item.currentTime === null
            ? item.animation.currentTime === null
            : Math.abs(Number(item.animation.currentTime) - Number(item.currentTime)) <= 1;
          const playStateRestored = item.playState === 'running' || item.playState === 'pending'
            ? ['running', 'pending'].includes(item.animation.playState)
            : item.animation.playState === item.playState;
          item.restored = playbackRateRestored && currentTimeRestored && playStateRestored;
        } catch (_) { restoredAnimations = false; }
      }
      const originalAnimations = new Set((state.animations || []).map(item => item.animation));
      const newRunningTransitions = document.getAnimations().filter(animation => (
        typeof CSSTransition !== 'undefined' && animation instanceof CSSTransition
        && animation.playState === 'running' && !originalAnimations.has(animation)
      ));
      restoredAnimations = restoredAnimations
        && (state.animations || []).every(item => item.restored === true)
        && newRunningTransitions.length === 0;
      if (state.trustedClock && !state.clockWasPaused) window.__hvPlaybackClock.play();
      if (!state.rafWasPaused && typeof state.rafController?.resume === 'function') state.rafController.resume();
      const restoredClock = !state.trustedClock || window.__hvPlaybackClock.paused() === state.clockWasPaused;
      const restoredRaf = typeof state.rafController?.paused !== 'function'
        || state.rafController.paused() === state.rafWasPaused;
      delete window.__layoutQaRequiredAssetRestore;
      return {
        restored: restoredStyles && restoredAnimations && restoredClock && restoredRaf,
        restoredStyles,
        restoredAnimations,
        restoredClock,
        restoredRaf,
        newRunningTransitionCount: newRunningTransitions.length,
        shotStates: (state.shots || []).map(item => ({
          shotId: item.shot.dataset.shotId || '',
          layerStateRestored: item.layerStateRestored,
        })),
      };
    }).catch(error => ({ restored: false, error: error?.message || String(error) }));
    restorationDetails = restoration;
    restored = restoration.restored;
    if (!restored) throw new Error(`required asset visibility style restore failed: ${JSON.stringify(restoration)}`);
  }

  const comparisons = await page.evaluate(async ({ blackBase64List, whiteBase64List, targets, pixelThreshold }) => {
    async function pixels(base64) {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return context;
    }
    return Promise.all(targets.map(async (target, targetIndex) => {
      const region = target.subject_region;
      if (region.width <= 0 || region.height <= 0) return { compared_pixel_count: 0, changed_pixel_count: 0, changed_pixel_ratio: 0 };
      const blackContext = await pixels(blackBase64List[targetIndex]);
      const whiteContext = await pixels(whiteBase64List[targetIndex]);
      const black = blackContext.getImageData(region.left, region.top, region.width, region.height).data;
      const white = whiteContext.getImageData(region.left, region.top, region.width, region.height).data;
      let changed = 0;
      for (let index = 0; index < black.length; index += 4) {
        const average = (Math.abs(black[index] - white[index])
          + Math.abs(black[index + 1] - white[index + 1])
          + Math.abs(black[index + 2] - white[index + 2])) / 3;
        if (average >= pixelThreshold) changed += 1;
      }
      const compared = black.length / 4;
      return {
        compared_pixel_count: compared,
        changed_pixel_count: changed,
        changed_pixel_ratio: compared ? changed / compared : 0,
      };
    }));
  }, {
    blackBase64List: blackProbeScreenshots.map(screenshot => screenshot.toString('base64')),
    whiteBase64List: whiteProbeScreenshots.map(screenshot => screenshot.toString('base64')),
    targets: prepared.targets,
    pixelThreshold: REQUIRED_ASSET_PIXEL_DIFF_THRESHOLD,
  });

  return prepared.targets.map((target, index) => ({
    shot_id: target.shot_id,
    asset_id: target.asset_id,
    subject_region: target.subject_region,
    ...comparisons[index],
    minimum_changed_pixel_ratio: REQUIRED_ASSET_MIN_CHANGED_PIXEL_RATIO,
    pixel_diff_threshold: REQUIRED_ASSET_PIXEL_DIFF_THRESHOLD,
    style_restored: restored,
    animation_state_restored: restorationDetails.restoredAnimations === true,
    clock_state_restored: restorationDetails.restoredClock === true,
    raf_state_restored: restorationDetails.restoredRaf === true,
    layer_state_restored: restorationDetails.shotStates?.find(item => item.shotId === target.shot_id)?.layerStateRestored === true,
    new_running_transition_count: restorationDetails.newRunningTransitionCount ?? null,
    passed: comparisons[index].changed_pixel_ratio >= REQUIRED_ASSET_MIN_CHANGED_PIXEL_RATIO,
  }));
  } catch (error) {
    throw attachPreparedShotIds(error);
  }
}

async function inspectFrameHtmlLayout(options = {}) {
  const {
    frame = {},
    htmlPath,
    resolution = DEFAULT_RESOLUTION,
    sampleTimesSec,
    allowStaticCameraCues = false,
  } = options;
  const frameId = options.frameId
    || frame.id
    || frame.scene_id
    || frame.graph_node_id
    || frame.graphNodeId
    || '';
  const durationSec = options.durationSec ?? frame.duration_sec ?? frame.durationSec;

  const issues = [];
  const metrics = {
    skipped: false,
    samples: [],
    candidate_count: 0,
    camera_samples: [],
    image_sequence_visibility_samples: [],
    expected_required_shot_ids: [],
  };

  const playwright = await loadPlaywright(options);
  if (playwright.error || !playwright.chromium) {
    issues.push(makeIssue({
      code: 'LAYOUT_QA_ENVIRONMENT_NOT_CONFIGURED',
      severity: 'warning',
      frameId,
      sampleTimeSec: null,
      message: '布局 QA 环境未配置，已跳过 html-video 布局检查。',
      details: { error: playwright.error ? playwright.error.message : 'Playwright Chromium unavailable' },
    }));
    metrics.skipped = true;
    return { success: true, issues, metrics };
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  } catch (error) {
    issues.push(makeIssue({
      code: 'LAYOUT_QA_ENVIRONMENT_NOT_CONFIGURED',
      severity: 'warning',
      frameId,
      sampleTimeSec: null,
      message: '布局 QA 浏览器无法启动，已跳过 html-video 布局检查。',
      details: { error: error.message },
    }));
    metrics.skipped = true;
    return { success: true, issues, metrics };
  }

  try {
    const page = await browser.newPage({
      viewport: {
        width: resolution.width || DEFAULT_RESOLUTION.width,
        height: resolution.height || DEFAULT_RESOLUTION.height,
      },
      deviceScaleFactor: 1,
    });

    await page.addInitScript(() => {
      window.__mpAdapterControlled = true;
      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
      let nextRafId = 1;
      let rafPaused = false;
      const rafRecords = new Map();
      function schedule(id, callback) {
        const nativeId = nativeRequestAnimationFrame((timestamp) => {
          const record = rafRecords.get(id);
          if (!record) return;
          if (rafPaused) {
            record.nativeId = null;
            return;
          }
          rafRecords.delete(id);
          callback(timestamp);
        });
        rafRecords.set(id, { callback, nativeId });
      }
      window.requestAnimationFrame = (callback) => {
        const id = nextRafId++;
        if (rafPaused) rafRecords.set(id, { callback, nativeId: null });
        else schedule(id, callback);
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        const record = rafRecords.get(id);
        if (record && record.nativeId !== null) nativeCancelAnimationFrame(record.nativeId);
        rafRecords.delete(id);
      };
      window.__layoutQaRafController = {
        paused: () => rafPaused,
        pause() {
          if (rafPaused) return;
          rafPaused = true;
        },
        resume() {
          if (!rafPaused) return;
          rafPaused = false;
          for (const [id, record] of [...rafRecords]) {
            if (record.nativeId === null) schedule(id, record.callback);
          }
        },
      };
      window.__layoutQaVisibilityState = {
        initial: document.visibilityState,
        changes: [],
      };
      document.addEventListener('visibilitychange', () => {
        window.__layoutQaVisibilityState.changes.push({
          state: document.visibilityState,
          at: Date.now(),
        });
      });
    });

    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await waitForLayout(page);
    const assetsRoot = await projectAssetsRootForHtml(htmlPath, options.projectAssetsRoot).catch(() => null);
    const controlledSourceCache = new Map();
    const sourceIdentityCache = new Map();
    const injectedSourceKeys = new Set();
    const playbackStartup = await page.evaluate(() => {
      const clock = window.__hvPlaybackClock;
      const trusted = clock?.__hvOwner === 'musedock-playback-clock-v1'
        && ['subscribe', 'play', 'pause', 'timeSec', 'paused', 'setTime']
          .every(name => typeof clock[name] === 'function');
      if (trusted) {
        clock.pause();
        clock.setTime(0);
      }
      if (typeof window.__hvPlayAll === 'function') {
        window.__hvPlayed = true;
        window.__hvPlayAll();
      }
      if (!trusted) return { continuous: false, reset: true };
      const resetTime = Number(clock.timeSec());
      if (!Number.isFinite(resetTime) || Math.abs(resetTime) > 0.005) return { continuous: false, reset: false };
      if (typeof window.__hvUnfreeze === 'function') window.__hvUnfreeze();
      clock.play();
      return { continuous: true, reset: true };
    }).catch(error => ({ continuous: false, reset: false, error: error?.message || String(error) }));
    if (!playbackStartup.reset) {
      const issue = makeIssue({
        code: 'LAYOUT_QA_PLAYBACK_CLOCK_UNRESPONSIVE',
        frameId,
        sampleTimeSec: null,
        message: '布局 QA 检测到共享播放时钟无法归零。',
        details: { error: playbackStartup.error || 'setTime(0) did not reset timeSec()' },
      });
      return { success: false, issues: [issue], metrics };
    }
    let continuousPlayback = playbackStartup.continuous;

    const requiredManifest = await requiredShotManifest(page, durationSec);
    metrics.expected_required_shot_ids = requiredManifest.shots.map(shot => shot.shot_id);
    if (requiredManifest.errors.length) {
      const issue = makeIssue({
        code: 'required_asset_visibility_manifest_invalid',
        frameId,
        sampleTimeSec: null,
        message: '必需图片 Shot 的标识或活动时间窗无效。',
        details: { errors: requiredManifest.errors },
      });
      return { success: false, issues: [issue], metrics };
    }
    const requiredManifestById = new Map(requiredManifest.shots.map(shot => [shot.shot_id, shot]));
    const cueSamples = Array.isArray(sampleTimesSec) && sampleTimesSec.length
      ? []
      : await cameraCueSampleTimes(page, durationSec);
    const requiredShotMidpoints = requiredManifest.shots
      .map(shot => shot.start_sec + (shot.end_sec - shot.start_sec) / 2);
    // ponytail: sorting is O(n log n); dedupe and browser samples grow linearly with cues. Tier only after measured cost; never truncate later cues.
    const baseSamples = normalizeSampleTimes(
      Array.isArray(sampleTimesSec) && sampleTimesSec.length
        ? sampleTimesSec
        : [...defaultSampleTimes(durationSec), ...cueSamples],
      durationSec,
    );
    const samples = [...new Set([...baseSamples, ...requiredShotMidpoints])].sort((a, b) => a - b);

    let elapsedSec = 0;
    const failedInWindowRequiredShotIds = new Set();
    let unscopedRequiredAssetProbeFailed = false;
    for (const sampleTimeSec of samples) {
      if (continuousPlayback) {
        const currentTime = await page.evaluate(() => Number(window.__hvPlaybackClock.timeSec())).catch(() => NaN);
        if (!Number.isFinite(currentTime) || currentTime < 0) {
          const issue = makeIssue({
            code: 'LAYOUT_QA_PLAYBACK_CLOCK_UNRESPONSIVE',
            frameId,
            sampleTimeSec,
            message: '布局 QA 检测到共享播放时钟返回了无效时间。',
          });
          return { success: false, issues: dedupeIssues([...issues, issue]), metrics };
        }
        const remainingMs = Math.max(0, sampleTimeSec - currentTime) * 1000;
        try {
          await page.waitForFunction(
            (time) => {
              const current = Number(window.__hvPlaybackClock.timeSec());
              return !Number.isFinite(current) || current >= time;
            },
            sampleTimeSec,
            { timeout: Math.max(500, Math.ceil(remainingMs + 750)) },
          );
        } catch (error) {
          const seeked = await page.evaluate((time) => {
            const clock = window.__hvPlaybackClock;
            try {
              clock.pause();
              clock.setTime(time);
              const reached = Number(clock.timeSec());
              return Number.isFinite(reached) && Math.abs(reached - time) <= 0.005;
            } catch (_) {
              return false;
            }
          }, sampleTimeSec).catch(() => false);
          if (!seeked) {
            const issue = makeIssue({
              code: 'LAYOUT_QA_PLAYBACK_CLOCK_UNRESPONSIVE',
              frameId,
              sampleTimeSec,
              message: '布局 QA 检测到共享播放时钟中途停止，且无法定位当前采样时间。',
              details: { error: error?.message || String(error) },
            });
            return { success: false, issues: dedupeIssues([...issues, issue]), metrics };
          }
          continuousPlayback = false;
        }
        if (continuousPlayback) {
          const reachedTime = await page.evaluate(() => Number(window.__hvPlaybackClock.timeSec())).catch(() => NaN);
          if (
            !Number.isFinite(reachedTime)
            || reachedTime < sampleTimeSec
            || reachedTime - sampleTimeSec >= 0.2
          ) {
            const issue = makeIssue({
              code: 'LAYOUT_QA_PLAYBACK_CLOCK_UNRESPONSIVE',
              frameId,
              sampleTimeSec,
              message: '布局 QA 检测到共享播放时钟未停留在当前采样时间附近。',
              details: { reached_time_sec: reachedTime },
            });
            return { success: false, issues: dedupeIssues([...issues, issue]), metrics };
          }
        }
      } else {
        const timelinePosition = await page.evaluate((time) => {
          const clock = window.__hvPlaybackClock;
          const ownedClock = clock?.__hvOwner === 'musedock-playback-clock-v1'
            && typeof clock.setTime === 'function' && typeof clock.timeSec === 'function';
          const setter = typeof window.__mpSetTimelineTime === 'function' ? window.__mpSetTimelineTime : null;
          if (!setter && !ownedClock) return { available: false, positioned: false };
          try {
            if (setter) setter(time);
            else clock.setTime(time);
            if (!ownedClock) return { available: true, positioned: true };
            let reached = Number(clock.timeSec());
            if (!Number.isFinite(reached) || Math.abs(reached - time) > 0.005) {
              clock.setTime(time);
              reached = Number(clock.timeSec());
            }
            return {
              available: true,
              positioned: Number.isFinite(reached) && Math.abs(reached - time) <= 0.005,
              reached,
            };
          } catch (error) {
            return { available: true, positioned: false, error: error?.message || String(error) };
          }
        }, sampleTimeSec).catch(error => ({ available: true, positioned: false, error: error?.message || String(error) }));
        if (timelinePosition.available && !timelinePosition.positioned) {
          const issue = makeIssue({
            code: 'LAYOUT_QA_PLAYBACK_CLOCK_UNRESPONSIVE',
            frameId,
            sampleTimeSec,
            message: '布局 QA 无法将共享播放时钟定位到当前采样时间。',
            details: { error: timelinePosition.error || `reached ${timelinePosition.reached}` },
          });
          return { success: false, issues: dedupeIssues([...issues, issue]), metrics };
        }
        const waitSec = timelinePosition.available ? 0 : Math.max(0, sampleTimeSec - elapsedSec);
        if (waitSec > 0) {
          await page.waitForTimeout(Math.round(waitSec * 1000));
          elapsedSec += waitSec;
        }
      }
      await waitForLayout(page);
      const candidates = await collectCandidates(page, { sampleTimeSec, durationSec });
      metrics.samples.push({
        sample_time_sec: sampleTimeSec,
        candidate_count: candidates.length,
      });
      metrics.candidate_count += candidates.length;
      issues.push(...inspectCandidates({
        candidates,
        resolution: {
          width: resolution.width || DEFAULT_RESOLUTION.width,
          height: resolution.height || DEFAULT_RESOLUTION.height,
        },
        frameId,
        sampleTimeSec,
      }));
      const camera = await collectCameraSample(page, {
        width: resolution.width || DEFAULT_RESOLUTION.width,
        height: resolution.height || DEFAULT_RESOLUTION.height,
      }, sampleTimeSec, allowStaticCameraCues);
      if (camera) {
        const cameraSample = { sample_time_sec: sampleTimeSec, ...camera };
        metrics.camera_samples.push(cameraSample);
        issues.push(...cameraIssuesForSample(camera, { frameId, sampleTimeSec }));
      }
      let requiredAssetVisibility;
      try {
        requiredAssetVisibility = await inspectRequiredAssetVisibility(page, {
          width: resolution.width || DEFAULT_RESOLUTION.width,
          height: resolution.height || DEFAULT_RESOLUTION.height,
        }, {
          assetsRoot,
          controlledSourceCache,
          sourceIdentityCache,
          injectedSourceKeys,
        });
      } catch (error) {
        const failedShotIds = normalizeShotIds(error?.required_asset_shot_ids);
        const inWindowShotIds = failedShotIds.filter((shotId) => {
          const shot = requiredManifestById.get(shotId);
          return shot && sampleTimeSec >= shot.start_sec && sampleTimeSec < shot.end_sec;
        });
        if (failedShotIds.length) {
          for (const shotId of inWindowShotIds) failedInWindowRequiredShotIds.add(shotId);
        } else {
          unscopedRequiredAssetProbeFailed = true;
        }
        issues.push(makeIssue({
          code: 'required_asset_visibility_probe_failed',
          frameId,
          sampleTimeSec,
          message: '必需图片可见性探针执行失败。',
          details: {
            error: error?.message || String(error),
            ...(failedShotIds?.length ? { shot_ids: failedShotIds } : {}),
            in_window_shot_ids: inWindowShotIds,
          },
        }));
        continue;
      }
      for (const visibility of requiredAssetVisibility || []) {
        const visibilitySample = { sample_time_sec: sampleTimeSec, ...visibility };
        metrics.image_sequence_visibility_samples.push(visibilitySample);
        if (!visibility.passed) {
          issues.push(makeIssue({
            code: 'required_asset_occluded',
            frameId,
            sampleTimeSec,
            message: '必需图片没有对最终画面产生足够的可见像素贡献。',
            details: {
              selector: visibility.shot_id,
              ...visibilitySample,
            },
          }));
        }
      }
    }
    issues.push(...cameraJitterIssues(metrics.camera_samples, frameId));
    const evidenced = requiredManifest.shots.filter(shot => (
      metrics.image_sequence_visibility_samples.some(sample => (
        sample.shot_id === shot.shot_id
        && sample.sample_time_sec >= shot.start_sec
        && sample.sample_time_sec < shot.end_sec
      ))
    )).map(shot => shot.shot_id);
    const evidencedSet = new Set(evidenced);
    const missing = metrics.expected_required_shot_ids.filter(shotId => (
      !evidencedSet.has(shotId) && !failedInWindowRequiredShotIds.has(shotId)
    ));
    if (missing.length && !unscopedRequiredAssetProbeFailed) {
      issues.push(makeIssue({
        code: 'required_asset_visibility_evidence_missing',
        frameId,
        sampleTimeSec: null,
        message: '必需图片 Shot 缺少活动时间窗内的可见性证据。',
        details: {
          expected: metrics.expected_required_shot_ids,
          evidenced,
          missing,
          sample_times: samples,
        },
      }));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const dedupedIssues = dedupeIssues(issues);
  return {
    success: !dedupedIssues.some(isBlockingIssue),
    issues: dedupedIssues,
    metrics,
  };
}

module.exports = {
  defaultSampleTimes,
  inspectFrameHtmlLayout,
};
