const assert = require('assert');
const {
  resolveRetryContinuityMode,
  defaultRetryFrameHtmlAction,
} = require('../server/services/creative/creativeWorkflows');

async function run() {
  // workflow 显式 continuity_mode 优先
  assert.deepStrictEqual(
    resolveRetryContinuityMode(
      { creative_context: { continuity_mode: 'scene_html' } },
      { continuity_mode: 'beat_mp4' },
    ),
    { continuity_mode: 'scene_html' },
  );

  // workflow 缺失时回填落盘 project 的 continuity_mode
  assert.deepStrictEqual(
    resolveRetryContinuityMode({}, { continuity_mode: 'scene_html' }),
    { continuity_mode: 'scene_html' },
  );

  // 两边都没有时为 null，交由下游默认 beat_mp4
  assert.deepStrictEqual(resolveRetryContinuityMode({}, {}), { continuity_mode: null });

  // 空白字符串视同缺失
  assert.deepStrictEqual(
    resolveRetryContinuityMode({ creative_context: { continuity_mode: '  ' } }, {}),
    { continuity_mode: null },
  );

  // retry 透传：continuity_mode 与 asset_context 必须进入 generateHtmlVideo 的 creativeContext
  let capturedCreativeContext = null;
  const retryResult = await defaultRetryFrameHtmlAction({
    workflow: {
      workflow_id: '12345',
      target: {},
      creative_context: {
        continuity_mode: 'scene_html',
        asset_context: { assets: [{ id: 'gen_scene_01', source: 'generated' }] },
      },
      result: {
        hyperframes_freeform: {
          scene_spec: { scenes: [{ id: 'scene_01' }] },
          frame_specs: [],
        },
      },
    },
    project: { run_id: 'run-test' },
    projectDir: 'D:\\tmp\\wf-test\\agent_runs\\run-test-html-video',
    services: {
      htmlVideoWorkflow: {
        generateHtmlVideo: async args => {
          capturedCreativeContext = args.creativeContext;
          return { success: true };
        },
      },
    },
  });
  assert.strictEqual(retryResult.success, true);
  assert.strictEqual(capturedCreativeContext.continuity_mode, 'scene_html');
  assert.strictEqual(capturedCreativeContext.asset_context.assets[0].id, 'gen_scene_01');

  console.log('test-creative-visual-strategy passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
