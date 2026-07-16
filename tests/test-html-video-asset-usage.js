const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const assetUsagePhase = require('../server/services/creative-video/html-video/assetUsagePhase');

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-video-asset-usage-'));
fs.mkdirSync(path.join(projectDir, 'frames'), { recursive: true });
fs.writeFileSync(
  path.join(projectDir, 'frames', '01.html'),
  '<!doctype html><html><body><img src="../assets/a.png"></body></html>',
  'utf8',
);
fs.writeFileSync(
  path.join(projectDir, 'frames', '02.html'),
  '<!doctype html><html><body><!-- ../assets/b.png --><script>const unused="../assets/b.png"</script><main>无图片</main></body></html>',
  'utf8',
);
fs.writeFileSync(
  path.join(projectDir, 'frames', '03.html'),
  '<!doctype html><html><body><div style="background-image:url(../assets/c.png)"></div></body></html>',
  'utf8',
);
fs.writeFileSync(
  path.join(projectDir, 'frames', '04.html'),
  '<!doctype html><html><body><img src="https://cdn.example.com/assets/generated-image-01.jpg"></body></html>',
  'utf8',
);

const report = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [
      { id: 'scene_01', html_path: 'frames/01.html' },
      { id: 'scene_02', html_path: 'frames/02.html' },
      { id: 'scene_03', html_path: 'frames/03.html' },
    ],
  },
  creativeContext: {
    asset_context: {
      assets: [
        { id: 'article_01', path: 'assets/a.png', frame_src: '../assets/a.png' },
        { id: 'article_02', path: 'assets/b.png', frame_src: '../assets/b.png' },
        { id: 'article_03', path: 'assets/c.png', frame_src: '../assets/c.png' },
      ],
    },
  },
});

assert.equal(report.status, 'ready');
assert.equal(report.assets.find(asset => asset.asset_id === 'article_01').used, true);
assert.equal(report.assets.find(asset => asset.asset_id === 'article_01').usage_count, 1);
assert.deepEqual(report.assets.find(asset => asset.asset_id === 'article_01').used_in_frames, ['scene_01']);
assert.equal(report.assets.find(asset => asset.asset_id === 'article_02').used, false);
assert.equal(report.assets.find(asset => asset.asset_id === 'article_03').used, true);
assert.deepEqual(report.assets.find(asset => asset.asset_id === 'article_03').used_in_frames, ['scene_03']);
assert.deepEqual(report.used_asset_ids, ['article_01', 'article_03']);
assert.deepEqual(report.unused_asset_ids, ['article_02']);
assert.match(report.summary, /最终 HTML 使用了 2 张视觉素材/);

const projectAssets = assetUsagePhase.projectAssetsFromCreativeContext({
  asset_context: {
    assets: [{
      id: 'upload_01',
      type: 'image',
      media_type: 'image',
      source: 'upload',
      origin: 'user_upload',
      origin_detail: 'creative_input',
      provider: 'local',
      requirement: 'preferred',
      evidence_class: 'user_supplied',
      status: 'ready',
      parent_asset_id: 'source_upload_batch',
      path: 'assets/upload.png',
      mime: 'image/png',
      bytes: 123,
      width: 1080,
      height: 1920,
      created_at: '2026-07-16T00:00:00.000Z',
    }],
  },
});
assert.equal(projectAssets[0].origin, 'user_upload');
assert.equal(projectAssets[0].requirement, 'preferred');
assert.equal(projectAssets[0].evidence_class, 'user_supplied');
assert.equal(projectAssets[0].parent_asset_id, 'source_upload_batch');
assert.equal(projectAssets[0].bytes, 123);

const requiredReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [
      { id: 'scene_01', scene_id: 'scene_01', html_path: 'frames/01.html' },
      { id: 'scene_02', scene_id: 'scene_02', html_path: 'frames/02.html' },
    ],
    assets: [{ id: 'gen_scene_02', source: 'generated', requirement: 'required', path: 'assets/b.png', frame_src: '../assets/b.png' }],
    content_graph: {
      nodes: [
        { id: 'scene_01', asset_refs: [{ asset_id: 'article_01', usage: 'showcase' }] },
        { id: 'scene_02', asset_refs: [{ asset_id: 'gen_scene_02', usage: 'subject' }] },
      ],
    },
  },
  creativeContext: {
    asset_context: {
      assets: [
        { id: 'article_01', source: 'article', requirement: 'required', path: 'assets/a.png', frame_src: '../assets/a.png' },
      ],
    },
  },
});
assert.deepEqual(requiredReport.required_asset_ids, ['article_01', 'gen_scene_02']);
assert.deepEqual(requiredReport.missing_required_asset_ids, ['gen_scene_02']);
assert.deepEqual(requiredReport.assets.find(asset => asset.asset_id === 'article_01').expected_in_frames, ['scene_01']);
assert.equal(requiredReport.assets.find(asset => asset.asset_id === 'gen_scene_02').source, 'generated');
assert.match(requiredReport.summary, /必用视觉素材未进入/);

const generatedRequiredReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{ id: 'scene_04', scene_id: 'scene_04', html_path: 'frames/02.html' }],
    assets: [{ id: 'gen_scene_04', source: 'generated', requirement: 'required', path: 'assets/b.png', frame_src: '../assets/b.png', generation: { scene_id: 'scene_04' } }],
    content_graph: { nodes: [{ id: 'scene_04' }] },
  },
  creativeContext: { asset_context: { assets: [] } },
});
assert.deepEqual(generatedRequiredReport.required_asset_ids, ['gen_scene_04']);
assert.deepEqual(generatedRequiredReport.missing_required_asset_ids, ['gen_scene_04']);
assert.deepEqual(generatedRequiredReport.assets[0].usage, ['generated']);

const remoteSuffixReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{ id: 'scene_remote', scene_id: 'scene_remote', html_path: 'frames/04.html' }],
    assets: [{
      id: 'gen_remote',
      source: 'generated',
      requirement: 'required',
      path: 'assets/generated-image-01.jpg',
      frame_src: '../assets/generated-image-01.jpg',
      generation: { scene_id: 'scene_remote' },
    }],
  },
  creativeContext: { asset_context: { assets: [] } },
});
assert.deepEqual(remoteSuffixReport.used_asset_ids, []);
assert.deepEqual(remoteSuffixReport.missing_required_asset_ids, ['gen_remote']);

const requirementClassificationReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{ id: 'scene_classification', scene_id: 'scene_classification', html_path: 'frames/02.html' }],
    assets: [
      {
        id: 'required_generated',
        source: 'generated',
        requirement: 'required',
        path: 'assets/required-generated.png',
        frame_src: '../assets/required-generated.png',
        generation: { scene_id: 'scene_generation' },
      },
      {
        id: 'required_no_graph',
        source: 'article',
        requirement: 'required',
        path: 'assets/required-no-graph.png',
        frame_src: '../assets/required-no-graph.png',
      },
      {
        id: 'preferred_generated',
        source: 'generated',
        requirement: 'preferred',
        path: 'assets/preferred-generated.png',
        frame_src: '../assets/preferred-generated.png',
        generation: { scene_id: 'scene_preferred_generation' },
      },
      {
        id: 'optional_asset',
        source: 'article',
        requirement: 'optional',
        path: 'assets/optional.png',
        frame_src: '../assets/optional.png',
      },
      {
        id: 'legacy_generated',
        source: 'generated',
        path: 'assets/legacy-generated.png',
        frame_src: '../assets/legacy-generated.png',
        generation: { scene_id: 'scene_legacy_generation' },
      },
    ],
    content_graph: {
      nodes: [{
        id: 'scene_graph',
        asset_refs: [
          { asset_id: 'required_generated', usage: 'subject' },
          { asset_id: 'preferred_generated', usage: 'background' },
          { asset_id: 'optional_asset', usage: 'showcase' },
          { asset_id: 'legacy_generated', usage: 'subject' },
        ],
      }],
    },
  },
  creativeContext: { asset_context: { assets: [] } },
});
assert.deepEqual(requirementClassificationReport.required_asset_ids, ['required_generated', 'required_no_graph']);
assert.deepEqual(requirementClassificationReport.missing_required_asset_ids, ['required_generated', 'required_no_graph']);
const requiredGenerated = requirementClassificationReport.assets.find(asset => asset.asset_id === 'required_generated');
assert.equal(requiredGenerated.required, true);
assert.deepEqual(requiredGenerated.expected_in_frames, ['scene_generation', 'scene_graph']);
assert.deepEqual(requiredGenerated.usage, ['generated', 'subject']);
for (const assetId of ['preferred_generated', 'optional_asset', 'legacy_generated']) {
  const asset = requirementClassificationReport.assets.find(item => item.asset_id === assetId);
  assert.equal(asset.required, false, `${assetId} 不得升级为必用素材`);
  assert.equal(asset.used, false, `${assetId} 的 HTML 未引用时应保持未使用`);
  assert.deepEqual(asset.expected_in_frames, []);
  assert.deepEqual(asset.usage, []);
}

const formalFieldReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{ id: 'scene_formal', scene_id: 'scene_formal', html_path: 'frames/02.html' }],
    assets: [
      {
        id: 'formal_required',
        type: 'image',
        media_type: 'image',
        source: 'generated',
        origin: 'ai_generated',
        origin_detail: 'scene_main_visual',
        provider: 'openai',
        requirement: 'required',
        evidence_class: 'synthetic',
        status: 'ready',
        parent_asset_id: 'source_01',
        path: 'assets/formal-required.png',
      },
      {
        id: 'formal_preferred',
        media_type: 'image',
        origin: 'user_upload',
        origin_detail: 'creative_input',
        provider: 'local',
        requirement: 'preferred',
        evidence_class: 'user_supplied',
        status: 'ready',
        path: 'assets/formal-preferred.png',
      },
      {
        id: 'formal_optional',
        media_type: 'image',
        origin: 'source_extract',
        origin_detail: 'github_readme',
        provider: 'github',
        requirement: 'optional',
        evidence_class: 'direct_source',
        status: 'ready',
        path: 'assets/formal-optional.png',
      },
      {
        id: 'legacy_asset',
        type: 'image',
        source: 'generated',
        path: 'assets/legacy.png',
      },
    ],
  },
  creativeContext: { asset_context: { assets: [] } },
});
assert.deepEqual(formalFieldReport.required_asset_ids, ['formal_required']);
assert.deepEqual(formalFieldReport.missing_required_asset_ids, ['formal_required']);
assert.deepEqual(
  formalFieldReport.assets.map(asset => ({
    asset_id: asset.asset_id,
    media_type: asset.media_type,
    origin: asset.origin,
    origin_detail: asset.origin_detail,
    provider: asset.provider,
    requirement: asset.requirement,
    evidence_class: asset.evidence_class,
    status: asset.status,
    parent_asset_id: asset.parent_asset_id,
    required: asset.required,
  })),
  [
    {
      asset_id: 'formal_required',
      media_type: 'image',
      origin: 'ai_generated',
      origin_detail: 'scene_main_visual',
      provider: 'openai',
      requirement: 'required',
      evidence_class: 'synthetic',
      status: 'ready',
      parent_asset_id: 'source_01',
      required: true,
    },
    {
      asset_id: 'formal_preferred',
      media_type: 'image',
      origin: 'user_upload',
      origin_detail: 'creative_input',
      provider: 'local',
      requirement: 'preferred',
      evidence_class: 'user_supplied',
      status: 'ready',
      parent_asset_id: '',
      required: false,
    },
    {
      asset_id: 'formal_optional',
      media_type: 'image',
      origin: 'source_extract',
      origin_detail: 'github_readme',
      provider: 'github',
      requirement: 'optional',
      evidence_class: 'direct_source',
      status: 'ready',
      parent_asset_id: '',
      required: false,
    },
    {
      asset_id: 'legacy_asset',
      media_type: 'image',
      origin: '',
      origin_detail: '',
      provider: '',
      requirement: '',
      evidence_class: '',
      status: '',
      parent_asset_id: '',
      required: false,
    },
  ],
);

const generatedSceneSpec = assetUsagePhase.bindGeneratedAssetsToSceneSpec({
  scenes: [{ id: 'scene_generated', asset_refs: [] }],
}, {
  asset_context: {
    assets: [
      { id: 'formal_generated', origin: 'ai_generated', generation: { scene_id: 'scene_generated' } },
      { id: 'legacy_generated_only', source: 'generated', generation: { scene_id: 'scene_generated' } },
      { id: 'formal_conflict', origin: 'source_extract', source: 'generated', generation: { scene_id: 'scene_generated' } },
    ],
  },
});
assert.deepEqual(
  generatedSceneSpec.scenes[0].asset_refs.map(ref => ref.asset_id),
  ['formal_generated', 'legacy_generated_only'],
  '正式 origin 存在时必须覆盖冲突的 legacy source；仅 origin 缺失时回退 source=generated',
);

const generatedIdentityReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{ id: 'scene_generated', scene_id: 'scene_generated', html_path: 'frames/02.html' }],
    assets: [
      { id: 'formal_generated', origin: 'ai_generated', requirement: 'required', generation: { scene_id: 'formal_scene' }, path: 'assets/formal-generated.png' },
      { id: 'legacy_generated_only', source: 'generated', requirement: 'required', generation: { scene_id: 'legacy_scene' }, path: 'assets/legacy-generated-only.png' },
      { id: 'formal_conflict', origin: 'source_extract', source: 'generated', requirement: 'required', generation: { scene_id: 'conflict_scene' }, path: 'assets/formal-conflict.png' },
    ],
  },
  creativeContext: { asset_context: { assets: [] } },
});
assert.deepEqual(generatedIdentityReport.assets.find(asset => asset.asset_id === 'formal_generated').usage, ['generated']);
assert.deepEqual(generatedIdentityReport.assets.find(asset => asset.asset_id === 'formal_generated').expected_in_frames, ['formal_scene']);
assert.deepEqual(generatedIdentityReport.assets.find(asset => asset.asset_id === 'legacy_generated_only').usage, ['generated']);
assert.deepEqual(generatedIdentityReport.assets.find(asset => asset.asset_id === 'legacy_generated_only').expected_in_frames, ['legacy_scene']);
assert.deepEqual(generatedIdentityReport.assets.find(asset => asset.asset_id === 'formal_conflict').usage, []);
assert.deepEqual(generatedIdentityReport.assets.find(asset => asset.asset_id === 'formal_conflict').expected_in_frames, []);

const mergedIdentityReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{ id: 'scene_merged', scene_id: 'scene_merged', html_path: 'frames/02.html' }],
    assets: [{
      id: 'merged_required',
      media_type: 'image',
      origin: 'ai_generated',
      origin_detail: 'scene_main_visual',
      provider: 'openai',
      requirement: 'required',
      evidence_class: 'synthetic',
      status: 'ready',
      parent_asset_id: 'source_merged',
      path: 'assets/project-copy.png',
      generation: { scene_id: 'scene_merged' },
    }],
  },
  creativeContext: {
    asset_context: {
      assets: [{
        id: 'merged_required',
        source: 'generated',
        path: 'assets/runtime-copy.png',
        frame_src: '../assets/runtime-copy.png',
        local_path: 'C:/runtime-copy.png',
        generation: { scene_id: 'scene_merged' },
      }],
    },
  },
});
const mergedRequired = mergedIdentityReport.assets.find(asset => asset.asset_id === 'merged_required');
assert.equal(mergedRequired.path, 'assets/runtime-copy.png');
assert.equal(mergedRequired.origin, 'ai_generated');
assert.equal(mergedRequired.requirement, 'required');
assert.equal(mergedRequired.evidence_class, 'synthetic');
assert.equal(mergedRequired.status, 'ready');
assert.equal(mergedRequired.parent_asset_id, 'source_merged');
assert.deepEqual(mergedIdentityReport.required_asset_ids, ['merged_required']);
assert.deepEqual(mergedIdentityReport.missing_required_asset_ids, ['merged_required']);

const invalidFormalOverrideReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [],
    assets: [
      { id: 'required_null_override', requirement: null, parent_asset_id: {}, path: 'assets/null-project.png' },
      { id: 'required_object_override', requirement: {}, evidence_class: false, path: 'assets/object-project.png' },
      {
        id: 'required_bogus_override',
        media_type: 'bogus',
        origin: 'bogus',
        requirement: 'bogus',
        evidence_class: 'bogus',
        status: 'bogus',
        path: 'assets/bogus-project.png',
      },
    ],
  },
  creativeContext: {
    asset_context: {
      assets: [
        {
          id: 'required_null_override',
          requirement: 'required',
          parent_asset_id: 'runtime_parent',
          path: 'assets/null-runtime.png',
        },
        {
          id: 'required_object_override',
          requirement: 'required',
          evidence_class: 'user_supplied',
          path: 'assets/object-runtime.png',
        },
        {
          id: 'required_bogus_override',
          media_type: 'image',
          origin: 'user_upload',
          requirement: 'required',
          evidence_class: 'user_supplied',
          status: 'ready',
          path: 'assets/bogus-runtime.png',
        },
      ],
    },
  },
});
assert.deepEqual(
  invalidFormalOverrideReport.required_asset_ids,
  ['required_null_override', 'required_object_override', 'required_bogus_override'],
);
assert.equal(
  invalidFormalOverrideReport.assets.find(asset => asset.asset_id === 'required_null_override').parent_asset_id,
  'runtime_parent',
);
assert.equal(
  invalidFormalOverrideReport.assets.find(asset => asset.asset_id === 'required_object_override').evidence_class,
  'user_supplied',
);
assert.deepEqual(
  (() => {
    const asset = invalidFormalOverrideReport.assets.find(item => item.asset_id === 'required_bogus_override');
    return [asset.media_type, asset.origin, asset.requirement, asset.evidence_class, asset.status];
  })(),
  ['image', 'user_upload', 'required', 'user_supplied', 'ready'],
);

const emptyReport = workflow.buildAssetUsageReport({
  project: { frames: [] },
  projectDir,
  creativeContext: { asset_context: { assets: [] } },
});
assert.equal(emptyReport.status, 'empty');
assert.deepEqual(emptyReport.used_asset_ids, []);
assert.deepEqual(emptyReport.unused_asset_ids, []);
assert.deepEqual(emptyReport.missing_required_asset_ids, []);

console.log('html-video asset usage tests passed');
