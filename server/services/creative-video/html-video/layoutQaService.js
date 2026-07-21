const { pathToFileURL } = require('url');

const DEFAULT_RESOLUTION = { width: 1920, height: 1080 };
const CAMERA_SAFE_BOTTOM_PX = 140;
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

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const details = issue.details || {};
    const key = [
      issue.code,
      details.selector, details.text,
      details.first?.selector, details.first?.text,
      details.second?.selector, details.second?.text,
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
      if (
        box.left < cbox.left - tolerance
        || box.top < cbox.top - tolerance
        || box.right > cbox.right + tolerance
        || box.bottom > cbox.bottom + tolerance
      ) {
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
      issues.push(makeIssue({
        code,
        severity: isDecorativeText(a) || isDecorativeText(b) ? 'warning' : 'error',
        frameId,
        sampleTimeSec,
        message: '检测到文本元素互相重叠。',
        details: {
          first: { text: a.text, selector: a.selector, box: a.box },
          second: { text: b.text, selector: b.selector, box: b.box },
          intersection_area: Math.round(intersection.area),
          smaller_area: Math.round(smallerArea),
        },
      }));
    }
  }

  return issues;
}

async function collectCandidates(page) {
  return page.evaluate((selector) => {
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

    function isVisible(element, box) {
      const elementStyle = window.getComputedStyle(element);
      if (!elementStyle || ['hidden', 'collapse'].includes(elementStyle.visibility)) return false;
      let effectiveOpacity = 1;
      for (let current = element; current; current = current.parentElement) {
        const style = window.getComputedStyle(current);
        if (!style || style.display === 'none') return false;
        const opacity = Number(style.opacity);
        if (Number.isFinite(opacity)) effectiveOpacity *= opacity;
        if (effectiveOpacity <= 0.001) return false;
      }
      return box.width >= 8 && box.height >= 8;
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
      return {
        selector: selectorFor(container),
        role: container.getAttribute('data-role') || null,
        box: serializeBox(rect),
      };
    }

    function hasLayoutFlag(element, selector) {
      return Boolean(element.closest(selector));
    }

    const records = Array.from(document.querySelectorAll(selector))
      .map((element) => {
        if (hasLayoutFlag(element, '[data-layout-ignore], [aria-hidden="true"]')) return null;
        const rect = element.getBoundingClientRect();
        const direct = directText(element);
        const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        const isExplicitText = element.matches(explicitTextSelector);
        if (!text || (!direct && !isExplicitText)) return null;
        if (!isVisible(element, rect)) return null;
        return {
          element,
          hasDirectText: Boolean(direct),
          candidate: {
            key: element.getAttribute('data-text-key') || null,
            role: element.getAttribute('data-role') || null,
            tag: element.tagName.toLowerCase(),
            selector: selectorFor(element),
            text,
            box: serializeBox(rect),
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
  }, CANDIDATE_SELECTOR);
}

async function collectCameraSample(page, resolution, sampleTimeSec) {
  return page.evaluate(({ viewport, timeSec, safeBottomPx }) => {
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
      const cues = parseJson(shot.dataset.cameraCues) || [];
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
      const region = cue?.region;
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
        has_transform: Math.abs(scale - 1) > 1e-4 || Math.abs(matrix.e) > 0.01 || Math.abs(matrix.f) > 0.01,
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
  }, { viewport: resolution, timeSec: sampleTimeSec, safeBottomPx: CAMERA_SAFE_BOTTOM_PX });
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

async function inspectFrameHtmlLayout(options = {}) {
  const {
    frame = {},
    htmlPath,
    resolution = DEFAULT_RESOLUTION,
    sampleTimesSec,
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

    const cueSamples = Array.isArray(sampleTimesSec) && sampleTimesSec.length
      ? []
      : await cameraCueSampleTimes(page, durationSec);
    // ponytail: sorting is O(n log n); dedupe and browser samples grow linearly with cues. Tier only after measured cost; never truncate later cues.
    const samples = Array.isArray(sampleTimesSec) && sampleTimesSec.length
      ? normalizeSampleTimes(sampleTimesSec, durationSec)
      : normalizeSampleTimes([...defaultSampleTimes(durationSec), ...cueSamples], durationSec);

    let elapsedSec = 0;
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
      const candidates = await collectCandidates(page);
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
      }, sampleTimeSec);
      if (camera) {
        const cameraSample = { sample_time_sec: sampleTimeSec, ...camera };
        metrics.camera_samples.push(cameraSample);
        issues.push(...cameraIssuesForSample(camera, { frameId, sampleTimeSec }));
      }
    }
    issues.push(...cameraJitterIssues(metrics.camera_samples, frameId));
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
