const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const assetUsagePhase = require('../server/services/creative-video/html-video/assetUsagePhase');
const { materializeSceneImageSequenceDom } = require('../server/services/creative-video/html-video/sceneImageSequenceDom');
const { normalizeProject } = require('../server/services/creative-video/html-video/projectSchema');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { createCreativeWorkflowRetryPlan } = require('../server/services/creative-video/retryPlanner');

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
fs.writeFileSync(
  path.join(projectDir, 'frames', '05.html'),
  '<!doctype html><html><head><style>.hero{background-image:url(../assets/unregistered-bg.png)} @font-face{font-family:x;src:url(../assets/local.woff2)}</style></head><body><a href="../assets/not-an-image.png">链接</a><a href="#section">锚点</a><svg><use href="#icon"></use></svg><img src="../assets/a.png"><img src="../assets/unregistered-img.png"><video poster="blob:unregistered-poster"></video><div style="background:url(data:image/png;base64,AAAA)"></div><div style="background:url(#gradient)"></div><div style="font-family:x;background:url(data:font/woff2;base64,AAAA)"></div></body></html>',
  'utf8',
);
fs.writeFileSync(
  path.join(projectDir, 'frames', '06.html'),
  '<!doctype html><html><body><img src=../assets/unquoted.png><img src = "../assets/spaced.png"><img src="../assets/disguised.woff2"><img src="data:font/woff2;base64,AAAA"><img src="./../assets/a.png"></body></html>',
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
assert.equal(report.assets.find(asset => asset.asset_id === 'article_01').usage_count, 0, 'legacy HTML fallback 不冒充 canonical Shot usage');
assert.deepEqual(report.assets.find(asset => asset.asset_id === 'article_01').used_in_frames, ['scene_01']);
assert.equal(report.assets.find(asset => asset.asset_id === 'article_02').used, false);
assert.equal(report.assets.find(asset => asset.asset_id === 'article_03').used, true);
assert.deepEqual(report.assets.find(asset => asset.asset_id === 'article_03').used_in_frames, ['scene_03']);
assert.deepEqual(report.used_asset_ids, ['article_01', 'article_03']);
assert.deepEqual(report.unused_asset_ids, ['article_02']);
assert.match(report.summary, /最终 HTML 使用了 2 张视觉素材/);

fs.writeFileSync(
  path.join(projectDir, 'frames', 'required-path-only.html'),
  '<!doctype html><html><body><img src="../assets/required-path-only.png"></body></html>',
  'utf8',
);
const requiredPathOnlyReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{ id: 'frame_required_path_only', scene_id: 'scene_required_path_only', html_path: 'frames/required-path-only.html' }],
    content_graph: { nodes: [{ id: 'frame_required_path_only', scene_id: 'scene_required_path_only' }] },
  },
  creativeContext: {
    asset_context: {
      assets: [{
        id: 'required_path_only',
        media_type: 'image',
        status: 'ready',
        requirement: 'required',
        path: 'assets/required-path-only.png',
        frame_src: '../assets/required-path-only.png',
      }],
    },
  },
});
assert.equal(requiredPathOnlyReport.assets[0].used, false, 'required 素材仅在普通 HTML 出现路径不得算作已使用');
assert.deepEqual(requiredPathOnlyReport.assets[0].shot_usages, []);
assert.deepEqual(requiredPathOnlyReport.used_asset_ids, []);
assert.deepEqual(requiredPathOnlyReport.unused_asset_ids, ['required_path_only']);
assert.deepEqual(requiredPathOnlyReport.missing_required_asset_ids, ['required_path_only']);

const repeatedShotAsset = {
  id: 'required_repeated_shot',
  media_type: 'image',
  status: 'ready',
  requirement: 'required',
  path: 'assets/repeated-shot.png',
  frame_src: '../assets/repeated-shot.png',
};
const repeatedShotSequence = {
  type: 'image_sequence',
  sequence_mode: 'fullscreen_relay',
  shots: [
    {
      id: 'shot_overview',
      asset_id: repeatedShotAsset.id,
      role: 'overview',
      requirement: 'required',
      caption_ids: ['cap_01'],
      minimum_visible_duration_sec: 1,
      active_window: { time_base: 'scene_local', start_sec: 0, end_sec: 4 },
    },
    {
      id: 'shot_detail',
      asset_id: repeatedShotAsset.id,
      role: 'detail',
      requirement: 'required',
      caption_ids: ['cap_02', 'cap_03'],
      minimum_visible_duration_sec: 0.2,
      active_window: { time_base: 'scene_local', start_sec: 0.1, end_sec: 0.3 },
    },
  ],
};
const repeatedShotNode = {
  id: 'graph_scene_usage',
  scene_id: 'scene_usage',
  duration_sec: 4,
  metadata: { visual_beat: { visual_base: repeatedShotSequence } },
};
const repeatedShotContext = { asset_context: { assets: [repeatedShotAsset] } };
const repeatedShotMaterialized = materializeSceneImageSequenceDom({
  html: '<!doctype html><html><body><main>受管画面</main></body></html>',
  node: repeatedShotNode,
  creativeContext: repeatedShotContext,
});
assert.equal(repeatedShotMaterialized.success, true);
fs.writeFileSync(path.join(projectDir, 'frames', 'repeated-shot.html'), repeatedShotMaterialized.html, 'utf8');
const rawLegacyProject = {
  frames: [{
    id: 'frame_normalized_legacy',
    scene_id: repeatedShotNode.scene_id,
    html_path: 'frames/repeated-shot.html',
  }],
  content_graph: { nodes: [repeatedShotNode] },
};
const normalizedLegacyProject = normalizeProject(rawLegacyProject);
assert.equal(normalizedLegacyProject.frames[0].graph_node_id, rawLegacyProject.frames[0].id);
for (const project of [rawLegacyProject, normalizedLegacyProject]) {
  const legacyReport = workflow.buildAssetUsageReport({ projectDir, project, creativeContext: repeatedShotContext });
  assert.equal(legacyReport.assets[0].used, true, 'raw 与 normalizeProject 后的 legacy frame 应保持相同素材绑定');
  assert.deepEqual(legacyReport.assets[0].used_in_frames, ['frame_normalized_legacy']);
  assert.equal(legacyReport.assets[0].usage_count, 2);
  assert.deepEqual(legacyReport.used_asset_ids, [repeatedShotAsset.id]);
  assert.deepEqual(legacyReport.unused_asset_ids, []);
  assert.deepEqual(legacyReport.missing_required_asset_ids, []);
}

const explicitMissingGraphReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{
      id: 'frame_explicit_missing_graph',
      scene_id: repeatedShotNode.scene_id,
      graph_node_id: 'graph_node_does_not_exist',
      graphNodeId: repeatedShotNode.id,
      html_path: 'frames/repeated-shot.html',
    }],
    content_graph: { nodes: [repeatedShotNode] },
  },
  creativeContext: repeatedShotContext,
});
assert.equal(explicitMissingGraphReport.assets[0].used, false, '显式 graph_node_id 未命中时不得回退同 Scene node');
assert.deepEqual(explicitMissingGraphReport.assets[0].shot_usages, []);
assert.deepEqual(explicitMissingGraphReport.used_asset_ids, []);
assert.deepEqual(explicitMissingGraphReport.unused_asset_ids, [repeatedShotAsset.id]);
assert.deepEqual(explicitMissingGraphReport.missing_required_asset_ids, [repeatedShotAsset.id]);

const camelMissingGraphReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{
      id: 'frame_camel_missing_graph',
      scene_id: repeatedShotNode.scene_id,
      graphNodeId: 'camel_graph_node_does_not_exist',
      html_path: 'frames/repeated-shot.html',
    }],
    content_graph: { nodes: [repeatedShotNode] },
  },
  creativeContext: repeatedShotContext,
});
assert.equal(camelMissingGraphReport.assets[0].used, false, '显式 graphNodeId 未命中时不得回退同 Scene node');
assert.deepEqual(camelMissingGraphReport.assets[0].shot_usages, []);
assert.deepEqual(camelMissingGraphReport.used_asset_ids, []);
assert.deepEqual(camelMissingGraphReport.unused_asset_ids, [repeatedShotAsset.id]);
assert.deepEqual(camelMissingGraphReport.missing_required_asset_ids, [repeatedShotAsset.id]);

const camelExactGraphReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{
      id: 'frame_camel_exact_graph',
      scene_id: 'scene_alias_must_not_win',
      graphNodeId: repeatedShotNode.id,
      html_path: 'frames/repeated-shot.html',
    }],
    content_graph: { nodes: [repeatedShotNode] },
  },
  creativeContext: repeatedShotContext,
});
assert.equal(camelExactGraphReport.assets[0].used, true, '合法 graphNodeId exact 应绑定对应 node');
assert.deepEqual(camelExactGraphReport.assets[0].used_in_frames, ['frame_camel_exact_graph']);
assert.equal(camelExactGraphReport.assets[0].usage_count, 2);
assert.deepEqual(camelExactGraphReport.used_asset_ids, [repeatedShotAsset.id]);
assert.deepEqual(camelExactGraphReport.unused_asset_ids, []);
assert.deepEqual(camelExactGraphReport.missing_required_asset_ids, []);

const duplicateExactGraphReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{
      id: 'frame_duplicate_exact_graph',
      graph_node_id: repeatedShotNode.id,
      html_path: 'frames/repeated-shot.html',
    }],
    content_graph: { nodes: [repeatedShotNode, { ...repeatedShotNode }] },
  },
  creativeContext: repeatedShotContext,
});
assert.equal(duplicateExactGraphReport.assets[0].used, false, '显式 graph identity exact 多于一个时必须 fail-closed');
assert.deepEqual(duplicateExactGraphReport.assets[0].shot_usages, []);
assert.deepEqual(duplicateExactGraphReport.used_asset_ids, []);
assert.deepEqual(duplicateExactGraphReport.unused_asset_ids, [repeatedShotAsset.id]);
assert.deepEqual(duplicateExactGraphReport.missing_required_asset_ids, [repeatedShotAsset.id]);

for (const frame of [
  { id: 'scene_usage', scene_id: repeatedShotNode.scene_id },
  { id: 'beat_legacy', beat_id: 'beat_legacy', scene_id: repeatedShotNode.scene_id },
]) {
  const legacyIdentityReport = workflow.buildAssetUsageReport({
    projectDir,
    project: {
      frames: [{ ...frame, html_path: 'frames/repeated-shot.html' }],
      content_graph: { nodes: [repeatedShotNode] },
    },
    creativeContext: repeatedShotContext,
  });
  assert.equal(legacyIdentityReport.assets[0].used, true, '缺少 graph_node_id 的 scene_html/beat legacy identity 仍应绑定唯一 Scene node');
  assert.deepEqual(legacyIdentityReport.assets[0].used_in_frames, [frame.id]);
  assert.equal(legacyIdentityReport.assets[0].usage_count, 2);
  assert.deepEqual(legacyIdentityReport.used_asset_ids, [repeatedShotAsset.id]);
  assert.deepEqual(legacyIdentityReport.unused_asset_ids, []);
  assert.deepEqual(legacyIdentityReport.missing_required_asset_ids, []);
}
const firstFrameNode = {
  id: 'graph_scene_usage_first',
  scene_id: 'scene_usage_first',
  duration_sec: 1,
  metadata: { visual_beat: { visual_base: {
    type: 'image_sequence',
    sequence_mode: 'fullscreen_relay',
    shots: [{
      id: 'shot_first_frame',
      asset_id: repeatedShotAsset.id,
      role: 'subject',
      requirement: 'required',
      caption_ids: [],
      minimum_visible_duration_sec: 1,
      active_window: { time_base: 'scene_local', start_sec: 0, end_sec: 1 },
    }],
  } } },
};
const firstFrameMaterialized = materializeSceneImageSequenceDom({
  html: '<!doctype html><html><body><main>第一帧受管画面</main></body></html>',
  node: firstFrameNode,
  creativeContext: repeatedShotContext,
});
assert.equal(firstFrameMaterialized.success, true);
fs.writeFileSync(path.join(projectDir, 'frames', 'first-frame-shot.html'), firstFrameMaterialized.html, 'utf8');
const repeatedShotReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [
      {
        id: 'frame_usage_first',
        scene_id: 'scene_usage_first',
        graph_node_id: firstFrameNode.id,
        html_path: 'frames/first-frame-shot.html',
      },
      {
        id: 'frame_usage',
        scene_id: 'scene_usage',
        graph_node_id: repeatedShotNode.id,
        html_path: 'frames/repeated-shot.html',
      },
    ],
    content_graph: {
      nodes: [
        { id: 'frame_usage', scene_id: 'scene_usage' },
        repeatedShotNode,
        firstFrameNode,
      ],
    },
  },
  creativeContext: repeatedShotContext,
});
assert.deepEqual(repeatedShotReport.assets[0].shot_usages, [
  {
    frame_id: 'frame_usage_first',
    scene_id: 'scene_usage_first',
    shot_id: 'shot_first_frame',
    caption_ids: [],
    role: 'subject',
    sequence_mode: 'fullscreen_relay',
    visible_duration_sec: 1,
  },
  {
    frame_id: 'frame_usage',
    scene_id: 'scene_usage',
    shot_id: 'shot_overview',
    caption_ids: ['cap_01'],
    role: 'overview',
    sequence_mode: 'fullscreen_relay',
    visible_duration_sec: 4,
  },
  {
    frame_id: 'frame_usage',
    scene_id: 'scene_usage',
    shot_id: 'shot_detail',
    caption_ids: ['cap_02', 'cap_03'],
    role: 'detail',
    sequence_mode: 'fullscreen_relay',
    visible_duration_sec: 0.2,
  },
], '同素材多 Shot 与 overlap 必须按 project.frames 和 contract.shots 顺序保留逐 Shot canonical usage');
assert.deepEqual(repeatedShotReport.assets[0].used_in_frames, ['frame_usage_first', 'frame_usage']);
assert.equal(repeatedShotReport.assets[0].usage_count, 3);
assert.equal(repeatedShotReport.assets[0].used, true);
assert.deepEqual(repeatedShotReport.used_asset_ids, [repeatedShotAsset.id]);
assert.deepEqual(repeatedShotReport.unused_asset_ids, []);
assert.deepEqual(repeatedShotReport.missing_required_asset_ids, []);

const ambiguousFrameReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{ id: 'ambiguous_frame', scene_id: 'scene_usage', html_path: 'frames/repeated-shot.html' }],
    content_graph: {
      nodes: [repeatedShotNode, { ...repeatedShotNode, id: 'graph_scene_usage_duplicate' }],
    },
  },
  creativeContext: repeatedShotContext,
});
assert.equal(ambiguousFrameReport.assets[0].used, false, '兼容 identity 同时匹配多个 node 时不得猜 required usage');
assert.deepEqual(ambiguousFrameReport.assets[0].shot_usages, []);
assert.deepEqual(ambiguousFrameReport.missing_required_asset_ids, [repeatedShotAsset.id]);

const finalRegistryReport = workflow.buildAssetUsageReport({
  projectDir,
  project: {
    frames: [{ id: 'scene_final_edit', html_path: 'frames/05.html' }],
  },
  creativeContext: {
    asset_context: {
      assets: [{ id: 'article_01', path: 'assets/a.png', frame_src: '../assets/a.png' }],
    },
  },
});
assert.deepEqual(finalRegistryReport.unregistered_image_references, [
  { frame_id: 'scene_final_edit', reference: '../assets/unregistered-img.png' },
  { frame_id: 'scene_final_edit', reference: 'blob:unregistered-poster' },
  { frame_id: 'scene_final_edit', reference: 'data:image/png;base64,AAAA' },
  { frame_id: 'scene_final_edit', reference: 'data:font/woff2;base64,AAAA' },
  { frame_id: 'scene_final_edit', reference: '../assets/unregistered-bg.png' },
]);
assert.equal(finalRegistryReport.assets.find(asset => asset.asset_id === 'article_01').used, true);
assert.doesNotMatch(
  JSON.stringify(finalRegistryReport.unregistered_image_references),
  /not-an-image|#section|#icon|#gradient|local\.woff2/,
  '普通 href、fragment 和 @font-face 字体文件不进入视觉资产差集',
);

const remoteVisualReport = workflow.buildAssetUsageReport({
  projectDir,
  project: { frames: [{ id: 'scene_remote', html_path: 'frames/04.html' }] },
  creativeContext: {
    asset_context: {
      assets: [{
        id: 'remote_registered_by_url',
        path: 'assets/generated-image-01.jpg',
        url: 'https://cdn.example.com/assets/generated-image-01.jpg',
      }],
    },
  },
});
assert.deepEqual(remoteVisualReport.unregistered_image_references, [{
  frame_id: 'scene_remote',
  reference: 'https://cdn.example.com/assets/generated-image-01.jpg',
}], 'http(s) 图片即使碰巧出现在 asset url 字段中也必须 fail-closed');

const syntaxBoundaryReport = workflow.buildAssetUsageReport({
  projectDir,
  project: { frames: [{ id: 'scene_syntax', html_path: 'frames/06.html' }] },
  creativeContext: {
    asset_context: {
      assets: [{ id: 'article_01', path: 'assets/a.png', frame_src: '../assets/a.png' }],
    },
  },
});
assert.deepEqual(syntaxBoundaryReport.unregistered_image_references, [
  { frame_id: 'scene_syntax', reference: '../assets/unquoted.png' },
  { frame_id: 'scene_syntax', reference: '../assets/spaced.png' },
  { frame_id: 'scene_syntax', reference: '../assets/disguised.woff2' },
  { frame_id: 'scene_syntax', reference: 'data:font/woff2;base64,AAAA' },
]);

fs.writeFileSync(path.join(projectDir, 'frames', 'beat.html'), '<img src="../assets/beat-evil.png">', 'utf8');
const beatReport = workflow.buildAssetUsageReport({
  projectDir,
  project: { frames: [{ id: 'beat_01', beat_id: 'beat_fallback', scene_id: 'scene_01', html_path: 'frames/beat.html' }] },
  creativeContext: { asset_context: { assets: [] } },
});
assert.deepEqual(beatReport.unregistered_image_references, [
  { frame_id: 'beat_01', reference: '../assets/beat-evil.png' },
], 'beat_mp4 报告必须优先使用真实 frame.id');
const beatRetryPlan = createCreativeWorkflowRetryPlan({
  project: { frames: [{ id: 'beat_01', scene_id: 'scene_01' }] },
  diagnostics: [{
    code: 'unregistered_visual_asset_reference',
    sub_stage: 'asset_usage',
    severity: 'error',
    details: { unregistered_image_references: beatReport.unregistered_image_references },
  }],
});
assert.deepEqual(beatRetryPlan.executor_options.frame_ids, ['beat_01']);

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
assert.deepEqual(requiredReport.missing_required_asset_ids, ['article_01', 'gen_scene_02']);
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
assert.deepEqual(emptyReport.unregistered_image_references, []);

async function runFrameNodeIdentityClosureMatrix() {
  for (const frameKind of ['scene_html', 'beat_legacy']) {
    for (const identityKind of ['graph_node_id', 'graphNodeId', 'missing']) {
      for (const exactCount of [1, 0, 2]) {
        const frameId = identityKind === 'missing' && exactCount !== 0
          ? repeatedShotNode.id
          : `matrix_${frameKind}_${identityKind}_${exactCount}`;
        const graphIdentity = exactCount === 0 ? `missing_${frameId}` : repeatedShotNode.id;
        const frame = {
          id: frameId,
          scene_id: repeatedShotNode.scene_id,
          html_path: 'frames/repeated-shot.html',
          ...(frameKind === 'beat_legacy' ? { beat_id: `beat_${frameId}` } : {}),
          ...(identityKind === 'graph_node_id' ? { graph_node_id: graphIdentity } : {}),
          ...(identityKind === 'graphNodeId' ? { graphNodeId: graphIdentity } : {}),
        };
        const nodes = exactCount === 2
          ? [repeatedShotNode, { ...repeatedShotNode }]
          : [repeatedShotNode];
        const rawProject = { frames: [frame], content_graph: { nodes } };
        const normalizedProject = normalizeProject(rawProject);
        await projectStore.saveProject(projectDir, rawProject);
        const loadedProject = await projectStore.loadProject(projectDir);
        const expectedUsed = exactCount === 1 || (identityKind === 'missing' && exactCount === 0);

        for (const [layer, project] of [
          ['raw', rawProject],
          ['normalizeProject', normalizedProject],
          ['save-load', loadedProject],
        ]) {
          const descriptor = `${layer}/${frameKind}/${identityKind}/exact=${exactCount}`;
          if (identityKind === 'missing' && layer !== 'raw') {
            assert.equal(project.frames[0].graph_node_id, project.frames[0].id, `${descriptor} 应保留 normalize 自动 legacy 别名`);
          }
          const matrixReport = workflow.buildAssetUsageReport({
            projectDir,
            project,
            creativeContext: repeatedShotContext,
          });
          assert.equal(matrixReport.assets[0].used, expectedUsed, descriptor);
          assert.deepEqual(matrixReport.assets[0].used_in_frames, expectedUsed ? [frameId] : [], descriptor);
          assert.equal(matrixReport.assets[0].usage_count, expectedUsed ? 2 : 0, descriptor);
          assert.deepEqual(matrixReport.used_asset_ids, expectedUsed ? [repeatedShotAsset.id] : [], descriptor);
          assert.deepEqual(matrixReport.unused_asset_ids, expectedUsed ? [] : [repeatedShotAsset.id], descriptor);
          assert.deepEqual(matrixReport.missing_required_asset_ids, expectedUsed ? [] : [repeatedShotAsset.id], descriptor);
        }
      }
    }
  }
}

runFrameNodeIdentityClosureMatrix()
  .then(() => console.log('html-video asset usage tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
