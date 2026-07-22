const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { inspectFrameHtmlLayout } = require('../server/services/creative-video/html-video/layoutQaService');

const resolution = { width: 640, height: 360 };

function html({ overflow = 'visible', animation = true, overlap = false, viewport = false, baseOffset = 0 }) {
  const top = viewport ? 330 : 100;
  return `<!doctype html><html><head><style>
    html,body{width:640px;height:360px;margin:0;overflow:hidden}
    .card{position:absolute;left:100px;top:${top}px;width:300px;height:40px;overflow:${overflow}}
    .moving{position:relative;top:${baseOffset}px;margin:0;width:280px;height:32px;${animation ? 'animation:keywordRise 10s linear both' : 'transform:translateY(30px)'}}
    .overlap{position:absolute;left:0;top:28px;margin:0;width:280px;height:32px}
    @keyframes keywordRise{from{transform:translateY(30px)}to{transform:translateY(0)}}
  </style></head><body><div class="card" data-role="copy">
    <p class="moving">运行中的关键词</p>
    ${overlap ? '<p class="overlap">真实重叠文字</p>' : ''}
  </div></body></html>`;
}

async function inspect(dir, name, source) {
  const htmlPath = path.join(dir, `${name}.html`);
  await fs.writeFile(htmlPath, source, 'utf8');
  return inspectFrameHtmlLayout({
    htmlPath,
    frame: { id: name, duration_sec: 1 },
    resolution,
    sampleTimesSec: [0.1],
  });
}

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'layout-qa-transient-transform-'));
  try {
    const visible = await inspect(dir, 'visible-running', html({}));
    assert.equal(visible.metrics.skipped, false, '必须运行真实 Chromium 布局检查');
    assert.equal(visible.success, true, JSON.stringify(visible.issues));
    assert.equal(visible.issues.some(issue => issue.code === 'text_out_of_container'), false);

    for (const overflow of ['hidden', 'clip']) {
      const clipped = await inspect(dir, `${overflow}-running`, html({ overflow }));
      assert.equal(clipped.success, false, `${overflow} 容器不得豁免动画瞬态越界：${JSON.stringify(clipped)}`);
      assert.ok(clipped.issues.some(issue => issue.code === 'text_out_of_container'));
    }

    const stable = await inspect(dir, 'visible-stable', html({ animation: false }));
    assert.equal(stable.success, false, '稳定态容器越界必须继续阻断');
    assert.ok(stable.issues.some(issue => issue.code === 'text_out_of_container'));

    const unrelatedAnimation = await inspect(dir, 'visible-unrelated-animation', html({ baseOffset: 30 }));
    assert.equal(unrelatedAnimation.success, false, '动画以外的稳定态越界不得借运行中 transform 获得豁免');
    assert.ok(unrelatedAnimation.issues.some(issue => issue.code === 'text_out_of_container'));

    const overlapping = await inspect(dir, 'visible-overlap', html({ overlap: true }));
    assert.equal(overlapping.success, false, '真实文字重叠必须继续阻断');
    assert.ok(overlapping.issues.some(issue => /overlap/.test(issue.code)));
    assert.ok(overlapping.issues.some(issue => issue.code === 'text_out_of_container'));

    const outsideViewport = await inspect(dir, 'visible-viewport', html({ viewport: true }));
    assert.equal(outsideViewport.success, false, '动画文字越出 viewport 必须继续阻断');
    assert.ok(outsideViewport.issues.some(issue => issue.code === 'text_out_of_viewport'));

    console.log('html-video transient transform layout QA tests passed');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
})();
