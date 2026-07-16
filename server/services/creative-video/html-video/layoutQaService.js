const { pathToFileURL } = require('url');

const DEFAULT_RESOLUTION = { width: 1920, height: 1080 };
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
  ], duration).slice(0, 5);
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
    if (normalized.some(existing => Math.abs(existing - time) <= 0.05)) continue;
    normalized.push(Number(time.toFixed(3)));
    if (normalized.length >= 5) break;
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
      const style = window.getComputedStyle(element);
      return style
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && Number(style.opacity) !== 0
        && box.width >= 8
        && box.height >= 8;
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
    await page.evaluate(() => {
      if (typeof window.__hvPlayAll === 'function') {
        window.__hvPlayed = true;
        window.__hvPlayAll();
        return true;
      }
      return false;
    }).catch(() => false);

    const samples = normalizeSampleTimes(
      Array.isArray(sampleTimesSec) && sampleTimesSec.length
        ? sampleTimesSec
        : defaultSampleTimes(durationSec),
      durationSec,
    );

    let elapsedSec = 0;
    for (const sampleTimeSec of samples) {
      const waitSec = Math.max(0, sampleTimeSec - elapsedSec);
      if (waitSec > 0) {
        await page.waitForTimeout(Math.round(waitSec * 1000));
        elapsedSec += waitSec;
        await waitForLayout(page);
      }
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
