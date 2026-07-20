const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { runFocusRegionPhase } = require('../server/services/creative-video/html-video/focusRegionPhase');

function selectedPlan(...assetIds) {
  return {
    beats: [{
      visual_base: {
        shots: assetIds.map(asset_id => ({ asset_id })),
      },
    }],
  };
}

function asset(id, overrides = {}) {
  return {
    id,
    media_type: 'image',
    origin: 'source_extract',
    path: `assets/${id}.png`,
    ...overrides,
  };
}

async function testDomWinsAndUnselectedIsUntouched() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'focus-region-dom-'));
  await fs.mkdir(path.join(projectDir, 'assets'));
  const domBytes = Buffer.from('dom-capture-bytes');
  await fs.writeFile(path.join(projectDir, 'assets', 'dom.png'), domBytes);
  let modelCalls = 0;
  const unselected = asset('unselected');
  Object.defineProperty(unselected, 'local_path', {
    enumerable: true,
    get() { throw new Error('未选中素材不得读取属性'); },
  });
  const context = {
    keep: { nested: true },
    asset_context: {
      keep: 'asset-context-field',
      diagnostics: [{ code: 'existing' }],
      assets: [
        asset('dom', {
          page_capture_evidence: {
            version: 1,
            image_sha256: crypto.createHash('sha256').update(domBytes).digest('hex'),
            elements: [
              { text: ' Stars   Count ', region: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 }, trust_level: 'D' },
              { text: 'Forks  Count', region: { x: 0.5, y: 0.2, width: 0.2, height: 0.2 } },
              { text: ' forks count ', region: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 } },
            ],
          },
        }),
        unselected,
      ],
    },
  };
  const result = await runFocusRegionPhase({
    visualPlan: selectedPlan('dom'),
    creativeContext: context,
    projectDir,
    target: { sourceImageAnalysisEnabled: true },
    services: { aiTextModel: { callTextModel: async () => { modelCalls += 1; } } },
  });

  assert.notEqual(result.creativeContext, context);
  assert.deepEqual(result.creativeContext.keep, context.keep);
  assert.equal(result.creativeContext.asset_context.keep, 'asset-context-field');
  assert.equal(result.creativeContext.asset_context.assets[1], unselected);
  assert.equal(modelCalls, 0);
  const regions = result.creativeContext.asset_context.assets[0].focus_regions;
  assert.equal(regions.length, 1, '重复 label 必须全部丢弃');
  assert.equal(regions[0].label, 'Stars Count');
  assert.equal(regions[0].method, 'dom');
  assert.equal(regions[0].trust_level, 'A');
  assert.equal(regions[0].verification.method, 'dom_capture');
  assert.equal(regions[0].verification.semantic.status, 'verified');
  assert.equal(regions[0].verification.geometry.status, 'verified');
  await fs.rm(projectDir, { recursive: true, force: true });
}

function domEvidence(imageSha256) {
  return {
    version: 1,
    ...(imageSha256 === undefined ? {} : { image_sha256: imageSha256 }),
    elements: [{ text: '主体', region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } }],
  };
}

async function testDomRequiresActualProjectBytesBinding() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'focus-region-dom-binding-'));
  await fs.mkdir(path.join(projectDir, 'assets'));
  const originalBytes = Buffer.from('original-capture');
  const replacementBytes = Buffer.from('replacement-project-image');
  const replacementPath = path.join(projectDir, 'assets', 'replacement.png');
  await fs.writeFile(replacementPath, replacementBytes);
  const originalHash = crypto.createHash('sha256').update(originalBytes).digest('hex');
  let reads = 0;
  let request = null;
  const originalReadFile = fs.readFile;
  fs.readFile = async (...args) => {
    if (path.resolve(args[0]) === path.resolve(replacementPath)) reads += 1;
    return originalReadFile(...args);
  };
  let downgraded;
  try {
    downgraded = await runFocusRegionPhase({
      projectDir,
      visualPlan: selectedPlan('replacement'),
      creativeContext: { asset_context: { assets: [asset('replacement', {
        path: 'assets/replacement.png',
        page_capture_evidence: domEvidence(originalHash),
      })] } },
      target: { sourceImageAnalysisEnabled: true },
      services: { aiTextModel: { callTextModel: async input => {
        request = input;
        return {
          success: true,
          text: JSON.stringify({ regions: [{
            label: '替换后主体', region: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
          }] }),
        };
      } } },
    });
  } finally {
    fs.readFile = originalReadFile;
  }
  const downgradedRegion = downgraded.creativeContext.asset_context.assets[0].focus_regions[0];
  assert.equal(reads, 1, 'DOM 校验与 vision 降级必须共享同一次最终工程文件读取');
  assert.equal(downgradedRegion.method, 'vision');
  assert.equal(downgradedRegion.trust_level, 'C');
  assert.match(request.messages[0].content[1].image_url.url, new RegExp(replacementBytes.toString('base64')));

  const actualBytes = Buffer.from('disabled-dom-image');
  await Promise.all(['missing', 'bad', 'mismatch'].map(id => (
    fs.writeFile(path.join(projectDir, 'assets', `${id}.png`), actualBytes)
  )));
  const disabled = await runFocusRegionPhase({
    projectDir,
    visualPlan: selectedPlan('missing', 'bad', 'mismatch'),
    creativeContext: { asset_context: { assets: [
      asset('missing', { page_capture_evidence: domEvidence(undefined) }),
      asset('bad', { page_capture_evidence: domEvidence('not-a-sha256') }),
      asset('mismatch', { page_capture_evidence: domEvidence('0'.repeat(64)) }),
    ] } },
    target: { sourceImageAnalysisEnabled: false },
    services: { aiTextModel: { callTextModel: async () => { throw new Error('vision 已关闭'); } } },
  });
  assert.ok(disabled.creativeContext.asset_context.assets.every(item => (
    Array.isArray(item.focus_regions) && item.focus_regions.length === 0
  )));
  assert.equal(disabled.diagnostics.length, 3);
  assert.ok(disabled.diagnostics.every(item => item.severity === 'warning' && /焦点区域/.test(item.user_message)));
  await fs.rm(projectDir, { recursive: true, force: true });
}

async function testVisionDedupesByBytesAndFailsClosed() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'focus-region-phase-'));
  await fs.mkdir(path.join(projectDir, 'assets'));
  await fs.writeFile(path.join(projectDir, 'assets', 'same-a.png'), 'same-bytes');
  await fs.writeFile(path.join(projectDir, 'assets', 'same-b.png'), 'same-bytes');
  await fs.writeFile(path.join(projectDir, 'assets', 'bad.png'), 'bad-bytes');
  const externalA = path.join(projectDir, '..', `external-a-${path.basename(projectDir)}.png`);
  const externalB = path.join(projectDir, '..', `external-b-${path.basename(projectDir)}.png`);
  await fs.writeFile(externalA, 'external-a-must-not-be-read');
  await fs.writeFile(externalB, 'external-b-must-not-be-read');
  let calls = 0;
  const requests = [];
  const result = await runFocusRegionPhase({
    projectDir,
    visualPlan: selectedPlan('same-a', 'same-a', 'same-b', 'bad', 'missing', 'no-path', 'escape', 'video'),
    creativeContext: {
      other: true,
      asset_context: {
        diagnostics: [],
        assets: [
          asset('same-a', { path: 'assets/same-a.png', local_path: externalA }),
          asset('same-b', { path: 'assets/same-b.png', local_path: externalB }),
          asset('bad', { path: 'assets/bad.png' }),
          asset('missing', { path: 'assets/missing.png' }),
          asset('no-path', { path: '', local_path: externalA }),
          asset('escape', { path: '../outside.png', local_path: externalB }),
          asset('video', { media_type: 'video', path: 'assets/video.mp4' }),
        ],
      },
    },
    target: { sourceImageAnalysisEnabled: true },
    services: {
      aiTextModel: {
        callTextModel: async request => {
          calls += 1;
          requests.push(request);
          const dataUrl = request.messages[0].content[1].image_url.url;
          if (dataUrl.includes(Buffer.from('bad-bytes').toString('base64'))) {
            return { success: true, text: 'not-json' };
          }
          return {
            success: true,
            text: JSON.stringify({
              regions: [
                { id: 'raw-id', label: ' Hero ', aliases: ['Main'], region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, method: 'manual', trust_level: 'A' },
                { label: 'duplicate', region: { x: 0, y: 0, width: 0.2, height: 0.2 } },
                { label: ' Duplicate ', region: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 } },
                { label: 'Hero  Main', region: { x: 0, y: 0, width: 0.2, height: 0.2 } },
                { label: ' hero main ', region: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 } },
              ],
            }),
          };
        },
      },
    },
  });

  assert.equal(calls, 2, '相同 bytes 只调用一次；不同 bytes 单独调用');
  assert.equal(requests[0].response_format.type, 'json_object');
  assert.match(requests[0].messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.match(requests[0].messages[0].content[1].image_url.url, new RegExp(Buffer.from('same-bytes').toString('base64')));
  assert.ok(!requests.some(request => ['external-a-must-not-be-read', 'external-b-must-not-be-read']
    .some(content => request.messages[0].content[1].image_url.url.includes(Buffer.from(content).toString('base64')))));
  assert.deepEqual(requests[0].audit, {
    agent: 'FocusRegionAgent', stage: 'focus_region', sub_stage: 'vision', asset_id: 'same-a',
  });
  for (const id of ['same-a', 'same-b']) {
    const region = result.creativeContext.asset_context.assets.find(item => item.id === id).focus_regions[0];
    assert.equal(region.label, 'Hero');
    assert.equal(region.method, 'vision');
    assert.equal(region.trust_level, 'C');
    assert.equal(region.verification.status, 'candidate');
    assert.equal(region.verification.semantic.status, 'candidate');
    assert.equal(region.verification.geometry.status, 'candidate');
  }
  const sameARegions = result.creativeContext.asset_context.assets.find(item => item.id === 'same-a').focus_regions;
  const sameBRegions = result.creativeContext.asset_context.assets.find(item => item.id === 'same-b').focus_regions;
  assert.equal(sameARegions.length, 1, '内部空白不同的同名 vision label 必须全部丢弃');
  assert.notEqual(sameARegions, sameBRegions);
  assert.notEqual(sameARegions[0], sameBRegions[0]);
  sameARegions[0].region.x = 0.9;
  assert.equal(sameBRegions[0].region.x, 0.1, '相同 bytes 的不同 asset 不得共享 region 对象');
  assert.deepEqual(result.creativeContext.asset_context.assets.find(item => item.id === 'bad').focus_regions, []);
  assert.deepEqual(result.creativeContext.asset_context.assets.find(item => item.id === 'missing').focus_regions, []);
  assert.deepEqual(result.creativeContext.asset_context.assets.find(item => item.id === 'no-path').focus_regions, []);
  assert.deepEqual(result.creativeContext.asset_context.assets.find(item => item.id === 'escape').focus_regions, []);
  assert.equal(Object.hasOwn(result.creativeContext.asset_context.assets.find(item => item.id === 'video'), 'focus_regions'), false);
  assert.equal(result.diagnostics.length, 4);
  assert.ok(result.diagnostics.every(item => item.severity === 'warning' && /焦点区域/.test(item.user_message)));
  assert.deepEqual(result.creativeContext.asset_context.diagnostics, result.diagnostics);
  await fs.rm(projectDir, { recursive: true, force: true });
  await Promise.all([fs.rm(externalA, { force: true }), fs.rm(externalB, { force: true })]);
}

async function testDisabledVisionAndExistingCanonicalSkip() {
  const existing = asset('existing', {
    focus_regions: [{
      id: 'manual', label: '手工区域', aliases: [],
      region: { x: 0, y: 0, width: 0.5, height: 0.5 },
      method: 'manual', confidence_level: 'high',
      verification: { status: 'verified', method: 'user_review', evidence: '用户确认' },
    }],
  });
  const empty = asset('disabled', { local_path: 'does-not-exist.png' });
  const result = await runFocusRegionPhase({
    visualPlan: selectedPlan('existing', 'disabled'),
    creativeContext: { asset_context: { assets: [existing, empty] } },
    target: { sourceImageAnalysisEnabled: false },
    services: { aiTextModel: { callTextModel: async () => { throw new Error('不得调用'); } } },
  });
  assert.equal(result.creativeContext.asset_context.assets[0], existing);
  assert.equal(result.creativeContext.asset_context.assets[1], empty);
  assert.deepEqual(result.diagnostics, []);
}

(async () => {
  await testDomWinsAndUnselectedIsUntouched();
  await testDomRequiresActualProjectBytesBinding();
  await testVisionDedupesByBytesAndFailsClosed();
  await testDisabledVisionAndExistingCanonicalSkip();
  console.log('html-video focus region phase tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
