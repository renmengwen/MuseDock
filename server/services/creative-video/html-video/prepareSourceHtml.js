const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/**
 * Resolve the HTML Chromium should load.
 *
 * 对应 html-video `packages/adapter-hyperframes/src/render.ts` 的
 * `prepareSourceHtml()` 段：单文件模板直接加载；带
 * `data-composition-src` 的入口文件在 Node 侧内联 composition HTML，
 * 避免 Chromium 通过 file:// fetch 组合片段时失败。
 */
async function prepareSourceHtml(sourcePath) {
  const raw = await fsp.readFile(sourcePath, 'utf8');
  const srcMatches = Array.from(raw.matchAll(/data-composition-src=["']([^"']+)["']/g));
  if (srcMatches.length === 0) return { loadPath: sourcePath };

  const sourceDir = path.dirname(sourcePath);
  const compositions = {};
  for (const match of srcMatches) {
    const rel = match[1];
    if (!rel || compositions[rel] !== undefined) continue;
    const compositionPath = path.join(sourceDir, rel);
    if (!fs.existsSync(compositionPath)) continue;
    compositions[rel] = await fsp.readFile(compositionPath, 'utf8');
  }

  if (Object.keys(compositions).length === 0) return { loadPath: sourcePath };

  const safeJson = JSON.stringify(compositions)
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '<\\!--');

  let output = raw
    .replace(/__VIDEO_DURATION__/g, '15')
    .replace(/__VIDEO_SRC__/g, 'data:video/mp4;base64,');

  const seedScript = `<script>window.__timelines=window.__timelines||{};window.__COMPOSITIONS__=${safeJson};</script>`;
  output = /<head[^>]*>/i.test(output)
    ? output.replace(/<head[^>]*>/i, match => `${match}\n${seedScript}`)
    : `${seedScript}\n${output}`;

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
      if (!window.__hvPlayed) window.__hvPlayAll();
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

  const loadPath = path.join(sourceDir, `.hv-render-${Date.now()}-${process.pid}.html`);
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
};
