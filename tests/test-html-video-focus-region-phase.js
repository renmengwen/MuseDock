const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  FOCUS_ANALYSIS_CONTRACT_VERSION,
  FOCUS_ANALYSIS_PROMPT_VERSION,
  runFocusRegionPhase,
} = require('../server/services/creative-video/html-video/focusRegionPhase');
const { projectAssetsFromCreativeContext } = require('../server/services/creative-video/html-video/assetUsagePhase');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { mergeVisualAssets } = require('../server/services/creative/visualAssetContract');

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

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function focusAnalysisRecord(bytes, overrides = {}) {
  return {
    version: 1,
    content_sha256: sha256Hex(bytes),
    contract_version: FOCUS_ANALYSIS_CONTRACT_VERSION,
    provider: 'mock-ai',
    model: 'vision-mock-1',
    prompt_version: FOCUS_ANALYSIS_PROMPT_VERSION,
    status: 'empty',
    ...overrides,
  };
}

function visionModel(respond) {
  const calls = [];
  return {
    provider: 'mock-ai',
    modelId: 'vision-mock-1',
    calls,
    callTextModel: async request => {
      calls.push(request);
      return respond(request);
    },
  };
}

function regionsResponse(label) {
  return {
    success: true,
    text: JSON.stringify({ regions: [{
      label, region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, confidence_level: 'high',
    }] }),
  };
}

function respondByBytes(rules) {
  return request => {
    const dataUrl = request.messages[0].content[1].image_url.url;
    for (const [bytes, response] of rules) {
      if (dataUrl.includes(bytes.toString('base64'))) return response();
    }
    throw new Error(`意外的 vision 调用：${dataUrl.slice(0, 64)}`);
  };
}

async function createDurableProject(prefix, entries) {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(projectDir, 'assets'));
  for (const { id, bytes } of entries) {
    await fs.writeFile(path.join(projectDir, 'assets', `${id}.png`), bytes);
  }
  await projectStore.saveProject(projectDir, {
    assets: entries.map(({ id, overrides }) => asset(id, overrides)),
  });
  return projectDir;
}

// 复刻 htmlVideoWorkflow focus phase 之后的正式持久化写入（mergeVisualAssets + 白名单投影）。
async function persistLikeWorkflow(projectDir, creativeContext) {
  await projectStore.writeProjectJson(projectDir, current => {
    current.assets = mergeVisualAssets(
      Array.isArray(current.assets) ? current.assets : [],
      projectAssetsFromCreativeContext(creativeContext),
    );
    return current;
  });
}

// 复刻 resume 水合：进程重启后 creativeContext 只能从 project.assets 恢复。
async function hydrateLikeWorkflow(projectDir) {
  const project = await projectStore.loadProject(projectDir);
  return { asset_context: { assets: mergeVisualAssets([], project.assets) } };
}

async function testDurableCacheSkipsAnalyzedAssetsAcrossRuns() {
  const successBytes = Buffer.from('durable-success-bytes');
  const emptyBytes = Buffer.from('durable-empty-bytes');
  const failBytes = Buffer.from('durable-fail-bytes');
  const projectDir = await createDurableProject('focus-region-durable-', [
    { id: 'success', bytes: successBytes },
    { id: 'empty', bytes: emptyBytes },
    { id: 'fail', bytes: failBytes },
  ]);
  const plan = selectedPlan('success', 'empty', 'fail');
  const target = { sourceImageAnalysisEnabled: true };

  const model1 = visionModel(respondByBytes([
    [successBytes, () => regionsResponse('主体')],
    [emptyBytes, () => ({ success: true, text: JSON.stringify({ regions: [] }) })],
    [failBytes, () => ({ success: true, text: 'not-json' })],
  ]));
  const run1 = await runFocusRegionPhase({
    visualPlan: plan,
    creativeContext: { asset_context: { assets: [asset('success'), asset('empty'), asset('fail')] } },
    projectDir,
    target,
    services: { aiTextModel: model1 },
  });
  assert.equal(model1.calls.length, 3);
  const run1Assets = new Map(run1.creativeContext.asset_context.assets.map(item => [item.id, item]));
  assert.equal(run1Assets.get('success').focus_regions.length, 1);
  assert.deepEqual(
    run1Assets.get('success').focus_analysis,
    focusAnalysisRecord(successBytes, { status: 'success' }),
  );
  assert.deepEqual(run1Assets.get('empty').focus_regions, []);
  assert.deepEqual(run1Assets.get('empty').focus_analysis, focusAnalysisRecord(emptyBytes));
  assert.deepEqual(run1Assets.get('fail').focus_regions, []);
  assert.equal(
    Object.hasOwn(run1Assets.get('fail'), 'focus_analysis'),
    false,
    'vision 失败不得写 focus_analysis，跨 run 必须允许重试',
  );
  assert.equal(run1.diagnostics.length, 1, 'vision 成功但空结果不再是失败告警');
  assert.match(run1.diagnostics[0].user_message, /fail/);

  // durable 记录必须在 phase 内落盘，且能扛住 workflow 白名单投影写入。
  const persistedBefore = await projectStore.loadProject(projectDir);
  assert.deepEqual(
    persistedBefore.assets.find(item => item.id === 'empty').focus_analysis,
    focusAnalysisRecord(emptyBytes),
  );
  await persistLikeWorkflow(projectDir, run1.creativeContext);
  const persisted = await projectStore.loadProject(projectDir);
  assert.deepEqual(
    persisted.assets.find(item => item.id === 'success').focus_analysis,
    focusAnalysisRecord(successBytes, { status: 'success' }),
  );
  assert.equal(persisted.assets.find(item => item.id === 'success').focus_regions.length, 1);
  assert.deepEqual(
    persisted.assets.find(item => item.id === 'empty').focus_analysis,
    focusAnalysisRecord(emptyBytes),
  );
  assert.equal(Object.hasOwn(persisted.assets.find(item => item.id === 'fail'), 'focus_analysis'), false);

  // 第二次 run：success 靠非空 canonical focus_regions 跳过；empty 靠 durable 记录跳过（核心修复）；
  // fail 没有记录，必须重试。
  const model2 = visionModel(respondByBytes([
    [failBytes, () => regionsResponse('重试主体')],
  ]));
  const run2 = await runFocusRegionPhase({
    visualPlan: plan,
    creativeContext: await hydrateLikeWorkflow(projectDir),
    projectDir,
    target,
    services: { aiTextModel: model2 },
  });
  assert.equal(model2.calls.length, 1, '第二次 run 只允许失败素材重试一次 vision');
  const run2Assets = new Map(run2.creativeContext.asset_context.assets.map(item => [item.id, item]));
  assert.equal(run2Assets.get('success').focus_regions.length, 1);
  assert.deepEqual(run2Assets.get('empty').focus_regions, []);
  assert.deepEqual(run2Assets.get('empty').focus_analysis, focusAnalysisRecord(emptyBytes));
  assert.equal(run2Assets.get('fail').focus_regions.length, 1);
  assert.deepEqual(
    run2Assets.get('fail').focus_analysis,
    focusAnalysisRecord(failBytes, { status: 'success' }),
  );
  assert.deepEqual(run2.diagnostics, [], '缓存命中与重试成功都不得产生告警');

  // 第三次 run：全部命中（fail 已成功），零调用零告警。
  const model3 = visionModel(() => { throw new Error('第三次 run 不得调用 vision'); });
  await persistLikeWorkflow(projectDir, run2.creativeContext);
  const run3 = await runFocusRegionPhase({
    visualPlan: plan,
    creativeContext: await hydrateLikeWorkflow(projectDir),
    projectDir,
    target,
    services: { aiTextModel: model3 },
  });
  assert.equal(model3.calls.length, 0);
  assert.deepEqual(run3.diagnostics, []);
  await fs.rm(projectDir, { recursive: true, force: true });
}

async function testDurableCacheInvalidationTriggersReanalysis() {
  const matchedBytes = Buffer.from('cache-matched-bytes');
  const changedBytes = Buffer.from('cache-changed-new-bytes');
  const staleBytes = {
    prompt: Buffer.from('cache-stale-prompt-bytes'),
    contract: Buffer.from('cache-stale-contract-bytes'),
    model: Buffer.from('cache-stale-model-bytes'),
    provider: Buffer.from('cache-stale-provider-bytes'),
    injected: Buffer.from('cache-injected-bytes'),
    inconsistent: Buffer.from('cache-inconsistent-bytes'),
  };
  const manualRegion = {
    id: 'manual_region', label: '手工锁定', aliases: [],
    region: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
    method: 'manual', confidence_level: 'high',
    verification: { status: 'verified', method: 'user_review', evidence: '用户框选' },
  };
  const entries = [
    { id: 'matched', bytes: matchedBytes, overrides: { focus_regions: [], focus_analysis: focusAnalysisRecord(matchedBytes) } },
    { id: 'changed', bytes: changedBytes, overrides: { focus_regions: [], focus_analysis: focusAnalysisRecord(Buffer.from('cache-changed-old-bytes')) } },
    { id: 'stale_prompt', bytes: staleBytes.prompt, overrides: { focus_regions: [], focus_analysis: focusAnalysisRecord(staleBytes.prompt, { prompt_version: 'stale-prompt-v0' }) } },
    { id: 'stale_contract', bytes: staleBytes.contract, overrides: { focus_regions: [], focus_analysis: focusAnalysisRecord(staleBytes.contract, { contract_version: 'stale-contract-v0' }) } },
    { id: 'stale_model', bytes: staleBytes.model, overrides: { focus_regions: [], focus_analysis: focusAnalysisRecord(staleBytes.model, { model: 'vision-mock-0' }) } },
    { id: 'stale_provider', bytes: staleBytes.provider, overrides: { focus_regions: [], focus_analysis: focusAnalysisRecord(staleBytes.provider, { provider: 'other-ai' }) } },
    { id: 'injected', bytes: staleBytes.injected, overrides: { focus_regions: [], focus_analysis: { ...focusAnalysisRecord(staleBytes.injected), injected: '模型注入字段' } } },
    { id: 'inconsistent', bytes: staleBytes.inconsistent, overrides: { focus_regions: [], focus_analysis: focusAnalysisRecord(staleBytes.inconsistent, { status: 'success' }) } },
    { id: 'manual_locked', bytes: Buffer.from('cache-manual-bytes'), overrides: { focus_regions: [manualRegion], focus_analysis: focusAnalysisRecord(Buffer.from('cache-manual-bytes')) } },
  ];
  const projectDir = await createDurableProject('focus-region-invalidation-', entries);
  const model = visionModel(regionsRequest => {
    const dataUrl = regionsRequest.messages[0].content[1].image_url.url;
    assert.ok(
      !dataUrl.includes(matchedBytes.toString('base64')),
      '四元组完全匹配的 empty 记录不得再调用 vision',
    );
    return regionsResponse('重析主体');
  });
  const result = await runFocusRegionPhase({
    visualPlan: selectedPlan(...entries.map(entry => entry.id)),
    // 不经水合直接传原始 ctx：非法 injected 记录必须由 phase 自身 normalize 丢弃并安全重析。
    creativeContext: { asset_context: { assets: entries.map(({ id, overrides }) => asset(id, overrides)) } },
    projectDir,
    target: { sourceImageAnalysisEnabled: true },
    services: { aiTextModel: model },
  });
  assert.equal(model.calls.length, 7, '除 matched 与 manual_locked 外全部重析');
  const resultAssets = new Map(result.creativeContext.asset_context.assets.map(item => [item.id, item]));
  assert.deepEqual(resultAssets.get('matched').focus_regions, []);
  assert.deepEqual(resultAssets.get('matched').focus_analysis, focusAnalysisRecord(matchedBytes));
  for (const id of ['changed', 'stale_prompt', 'stale_contract', 'stale_model', 'stale_provider', 'injected', 'inconsistent']) {
    const item = resultAssets.get(id);
    assert.equal(item.focus_regions.length, 1, `${id} 应重析出新 focus_regions`);
    assert.deepEqual(
      item.focus_analysis,
      focusAnalysisRecord(await fs.readFile(path.join(projectDir, 'assets', `${id}.png`)), { status: 'success' }),
      `${id} 重析成功后应覆盖为当前四元组记录`,
    );
  }
  assert.deepEqual(
    resultAssets.get('manual_locked').focus_regions.map(region => region.id),
    ['manual_region'],
    '手工 region 永不被缓存或重析覆盖',
  );
  assert.deepEqual(result.diagnostics, []);
  await fs.rm(projectDir, { recursive: true, force: true });
}

async function testMissingModelWritesNoRecord() {
  const bytes = Buffer.from('no-model-bytes');
  const projectDir = await createDurableProject('focus-region-no-model-', [{ id: 'plain', bytes }]);
  const result = await runFocusRegionPhase({
    visualPlan: selectedPlan('plain'),
    creativeContext: await hydrateLikeWorkflow(projectDir),
    projectDir,
    target: { sourceImageAnalysisEnabled: true },
    services: {},
  });
  const item = result.creativeContext.asset_context.assets[0];
  assert.deepEqual(item.focus_regions, []);
  assert.equal(Object.hasOwn(item, 'focus_analysis'), false, '缺模型配置时不得写 focus_analysis');
  assert.equal(result.diagnostics.length, 1);
  const persisted = await projectStore.loadProject(projectDir);
  assert.equal(Object.hasOwn(persisted.assets[0], 'focus_analysis'), false);
  await fs.rm(projectDir, { recursive: true, force: true });
}

(async () => {
  await testDomWinsAndUnselectedIsUntouched();
  await testDomRequiresActualProjectBytesBinding();
  await testVisionDedupesByBytesAndFailsClosed();
  await testDisabledVisionAndExistingCanonicalSkip();
  await testDurableCacheSkipsAnalyzedAssetsAcrossRuns();
  await testDurableCacheInvalidationTriggersReanalysis();
  await testMissingModelWritesNoRecord();
  console.log('html-video focus region phase tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
