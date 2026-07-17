const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const RENDER_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "manifest-src 'none'",
  'img-src file:',
  "style-src 'unsafe-inline' file:",
  "script-src 'unsafe-inline' file:",
  'font-src file:',
  'media-src file:',
].join('; ');

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`;

function markupEnd(source, start) {
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return null;
}

function startTagAt(source, index, tagName) {
  if (source[index] !== '<' || source.slice(index + 1, index + 1 + tagName.length).toLowerCase() !== tagName) return undefined;
  const boundary = source[index + 1 + tagName.length];
  if (boundary !== '>' && boundary !== '/' && !/[\t\n\f\r ]/.test(boundary || '')) return undefined;
  const end = markupEnd(source, index + 1 + tagName.length);
  return end ? { index, end } : null;
}

function documentStartTags(html) {
  const source = String(html);
  let cursor = source.charCodeAt(0) === 0xFEFF ? 1 : 0;
  const skipWhitespace = () => {
    while (/[\t\n\f\r ]/.test(source[cursor] || '')) cursor += 1;
  };
  while (true) {
    skipWhitespace();
    if (source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4);
      if (end < 0) return null;
      cursor = end + 3;
      continue;
    }
    if (source.startsWith('<!', cursor)) {
      const end = markupEnd(source, cursor + 2);
      if (!end) return null;
      cursor = end;
      continue;
    }
    break;
  }
  const htmlTag = startTagAt(source, cursor, 'html');
  if (!htmlTag) return null;
  cursor = htmlTag.end;
  while (true) {
    skipWhitespace();
    if (!source.startsWith('<!--', cursor)) break;
    const end = source.indexOf('-->', cursor + 4);
    if (end < 0) return null;
    cursor = end + 3;
  }
  const headTag = startTagAt(source, cursor, 'head');
  if (headTag === null) return null;
  if (!headTag && source[cursor] === '<' && !markupEnd(source, cursor + 1)) return null;
  return { html: htmlTag, head: headTag || null };
}

function injectRenderCsp(html) {
  let output = String(html).replace(
    /<meta\b[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>\s*/gi,
    '',
  );
  const documentTags = documentStartTags(output);
  if (!documentTags) throw new Error('html-video HTML 缺少可安全注入 CSP 的 html/head 结构，或 head 之前包含资源节点。');
  if (!documentTags.head) {
    const insertAt = documentTags.html.end;
    output = `${output.slice(0, insertAt)}<head>${CSP_META}</head>${output.slice(insertAt)}`;
    return output;
  }
  const insertAt = documentTags.head.end;
  return `${output.slice(0, insertAt)}${CSP_META}${output.slice(insertAt)}`;
}

/**
 * Resolve the HTML Chromium should load.
 *
 * 对应 html-video `packages/adapter-hyperframes/src/render.ts` 的
 * `prepareSourceHtml()` 段：单文件模板直接加载；带
 * `data-composition-src` 的入口文件在 Node 侧内联 composition HTML，
 * 避免 Chromium 通过 file:// fetch 组合片段时失败。
 */
function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function prepareSourceHtml(sourcePath, { projectDir } = {}) {
  const projectRoot = await fsp.realpath(projectDir || '').catch(() => '');
  const sourceRealPath = await fsp.realpath(sourcePath).catch(() => '');
  if (!projectRoot || !sourceRealPath || !contained(projectRoot, sourceRealPath)) {
    throw new Error('html-video 源 HTML 必须位于工程目录内。');
  }
  const raw = await fsp.readFile(sourceRealPath, 'utf8');
  const srcMatches = Array.from(raw.matchAll(/data-composition-src=["']([^"']+)["']/g));

  const sourceDir = path.dirname(sourceRealPath);
  const compositions = {};
  for (const match of srcMatches) {
    const rel = match[1];
    if (!rel || compositions[rel] !== undefined) continue;
    if (path.isAbsolute(rel)) throw new Error('html-video composition 路径不能是绝对路径。');
    const compositionPath = path.resolve(sourceDir, rel);
    const compositionRealPath = await fsp.realpath(compositionPath).catch(() => '');
    if (!compositionRealPath || !contained(projectRoot, compositionRealPath)) {
      throw new Error('html-video composition 缺失或逃逸工程目录。');
    }
    compositions[rel] = await fsp.readFile(compositionRealPath, 'utf8');
  }

  const safeJson = JSON.stringify(compositions)
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '<\\!--');

  let output = raw
    .replace(/__VIDEO_DURATION__/g, '15')
    .replace(/__VIDEO_SRC__/g, '');

  if (Object.keys(compositions).length > 0) {
    const seedScript = `<script>window.__timelines=window.__timelines||{};window.__COMPOSITIONS__=${safeJson};</script>`;
    const documentTags = documentStartTags(output);
    if (!documentTags) throw new Error('html-video HTML 缺少可安全注入 composition seed 的 html/head 结构。');
    const insertAt = documentTags.head?.end || documentTags.html.end;
    output = `${output.slice(0, insertAt)}\n${seedScript}${output.slice(insertAt)}`;

  const playerScript = `
<script>
(function () {
  function reexec(root) {
    root.querySelectorAll('script').forEach(function (old) {
      if (old.src) { old.parentNode.removeChild(old); return; }
      var s = document.createElement('script');
      s.textContent = '{\\n' + old.textContent + '\\n}';
      old.parentNode.replaceChild(s, old);
    });
  }
  function mountOne(host) {
    var src = host.getAttribute('data-composition-src');
    var text = (window.__COMPOSITIONS__ || {})[src];
    if (!text) return;
    var holder = document.createElement('div');
    holder.innerHTML = text;
    var tpl = holder.querySelector('template');
    host.appendChild(tpl ? tpl.content.cloneNode(true) : holder);
    reexec(host);
  }
  window.__hvPlayAll = function () {
    var timelines = window.__timelines || {};
    Object.keys(timelines).forEach(function (key) {
      var timeline = timelines[key];
      if (timeline && typeof timeline.play === 'function') timeline.play(0);
    });
  };
  function boot() {
    window.__timelines = window.__timelines || {};
    Array.prototype.slice
      .call(document.querySelectorAll('[data-composition-src]'))
      .forEach(mountOne);
    setTimeout(function () {
      if (!window.__mpAdapterControlled && !window.__hvPlayed) window.__hvPlayAll();
    }, 250);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
</script>`;

    output = output.includes('</body>')
      ? output.replace('</body>', `${playerScript}\n</body>`)
      : `${output}\n${playerScript}`;
  }

  output = injectRenderCsp(output);

  const loadPath = path.join(sourceDir, `.hv-render-${process.pid}-${crypto.randomUUID()}.html`);
  await fsp.writeFile(loadPath, output, 'utf8');
  return {
    loadPath,
    cleanup: async () => {
      await fsp.rm(loadPath, { force: true }).catch(() => {});
    },
  };
}

module.exports = {
  prepareSourceHtml,
  injectRenderCsp,
  RENDER_CSP,
};
