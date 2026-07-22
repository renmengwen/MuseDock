const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { inspectFrameHtmlLayout } = require('../server/services/creative-video/html-video/layoutQaService');

const resolution = { width: 640, height: 360 };

function html({ overflow = 'visible', animation = 'self', overlap = false, viewport = false, baseOffset = 0 }) {
  const top = viewport ? 330 : 100;
  const selfAnimation = animation === 'self' ? 'animation:safeRise 4s linear both' : animation === 'none' ? 'transform:translateY(30px)' : '';
  const wrapperAnimation = animation === 'ancestor' ? 'animation:safeRise 11.95s linear both'
    : animation === 'constant' ? 'animation:constantRise 4s linear both'
      : animation === 'infinite' ? 'animation:safeRise 4s linear infinite alternate both'
        : animation === 'long' ? 'animation:longRise 10s linear both' : '';
  const outerAnimation = animation === 'outer' ? 'animation:safeRise 11.95s linear both' : '';
  return `<!doctype html><html><head><style>
    html,body{width:640px;height:360px;margin:0;overflow:hidden}
    .card{position:absolute;left:100px;top:${top}px;width:300px;height:40px;overflow:${overflow}}
    .outer{${outerAnimation}}
    .wrapper{${wrapperAnimation}}
    .moving{position:relative;top:${baseOffset}px;margin:0;width:280px;height:32px;${selfAnimation}}
    .overlap{position:absolute;left:0;top:28px;margin:0;width:280px;height:32px}
    @keyframes safeRise{0%{transform:translateY(30px)}20%,100%{transform:translateY(0)}}
    @keyframes constantRise{from{transform:translateY(30px)}to{transform:translateY(30px)}}
    @keyframes longRise{from{transform:translateY(30px)}to{transform:translateY(0)}}
  </style></head><body><div class="outer"><div class="card" data-role="copy">
    <div class="wrapper"><p class="moving">运行中的关键词</p></div>
    ${overlap ? '<p class="overlap">真实重叠文字</p>' : ''}
  </div></div></body></html>`;
}

async function inspect(dir, name, source, durationSec = 1) {
  const htmlPath = path.join(dir, `${name}.html`);
  await fs.writeFile(htmlPath, source, 'utf8');
  return inspectFrameHtmlLayout({
    htmlPath,
    frame: { id: name, duration_sec: durationSec },
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

    const ancestor = await inspect(dir, 'visible-ancestor-running', html({ animation: 'ancestor' }), 11.95);
    assert.equal(ancestor.success, true, `语义容器内祖先的合法瞬态平移应被识别：${JSON.stringify(ancestor.issues)}`);
    assert.equal(ancestor.issues.some(issue => issue.code === 'text_out_of_container'), false);

    const outsideContainer = await inspect(
      dir,
      'outside-container-animation',
      html({ animation: 'outer', baseOffset: 30 }),
      11.95,
    );
    assert.equal(outsideContainer.success, false, '语义容器外祖先的动画不得替容器内稳定越界背书');
    assert.ok(outsideContainer.issues.some(issue => issue.code === 'text_out_of_container'));

    for (const overflow of ['hidden', 'clip']) {
      const clipped = await inspect(dir, `${overflow}-running`, html({ overflow }));
      assert.equal(clipped.success, false, `${overflow} 容器不得豁免动画瞬态越界：${JSON.stringify(clipped)}`);
      assert.ok(clipped.issues.some(issue => issue.code === 'text_out_of_container'));
    }

    const stable = await inspect(dir, 'visible-stable', html({ animation: 'none' }));
    assert.equal(stable.success, false, '稳定态容器越界必须继续阻断');
    assert.ok(stable.issues.some(issue => issue.code === 'text_out_of_container'));

    const unrelatedAnimation = await inspect(dir, 'visible-unrelated-animation', html({ baseOffset: 30 }));
    assert.equal(unrelatedAnimation.success, false, '动画以外的稳定态越界不得借运行中 transform 获得豁免');
    assert.ok(unrelatedAnimation.issues.some(issue => issue.code === 'text_out_of_container'));

    for (const animation of ['constant', 'infinite', 'long']) {
      const unsafe = await inspect(dir, `visible-${animation}`, html({ animation }));
      assert.equal(unsafe.success, false, `${animation} 动画不得豁免容器越界`);
      assert.ok(unsafe.issues.some(issue => issue.code === 'text_out_of_container'));
    }

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
