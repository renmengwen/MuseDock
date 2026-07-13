const assert = require('assert');
const {
  buildCreativeDefaultsSnapshot,
  buildWorkflowTarget,
  applyVisualStrategyToCreativeContext,
  defaultRetryFrameHtmlAction,
} = require('../server/services/creative/creativeWorkflows');

async function run() {
  const defaultSnapshot = buildCreativeDefaultsSnapshot({}, {}, {});
  assert.strictEqual(defaultSnapshot.visualStrategy, 'asset_first');

  const overridden = buildCreativeDefaultsSnapshot(
    { visualStrategy: 'hf_first' },
    { visualStrategy: 'asset_first' },
    {},
  );
  assert.strictEqual(overridden.visualStrategy, 'asset_first');

  const fromDefaults = buildCreativeDefaultsSnapshot({ visualStrategy: 'asset_first' }, {}, {});
  assert.strictEqual(fromDefaults.visualStrategy, 'asset_first');

  const invalid = buildCreativeDefaultsSnapshot({}, { visualStrategy: 'banana' }, {});
  assert.strictEqual(invalid.visualStrategy, 'asset_first');

  const target = buildWorkflowTarget({ visualStrategy: 'asset_first' });
  assert.strictEqual(target.visual_strategy, 'asset_first');
  const targetDefault = buildWorkflowTarget({});
  assert.strictEqual(targetDefault.visual_strategy, 'asset_first');

  const record = { creative_context: { source_context: { kind: 'text' } } };
  applyVisualStrategyToCreativeContext(record, { visualStrategy: 'asset_first' });
  assert.strictEqual(record.creative_context.visual_strategy, 'asset_first');
  assert.strictEqual(record.creative_context.source_context.kind, 'text');

  const emptyRecord = {};
  applyVisualStrategyToCreativeContext(emptyRecord, { visualStrategy: 'hf_first' });
  assert.strictEqual(emptyRecord.creative_context.visual_strategy, 'hf_first');

  let capturedCreativeContext = null;
  const retryResult = await defaultRetryFrameHtmlAction({
    workflow: {
      workflow_id: '12345',
      target: {},
      creative_context: {
        visual_strategy: 'asset_first',
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
  assert.strictEqual(capturedCreativeContext.visual_strategy, 'asset_first');
  assert.strictEqual(capturedCreativeContext.asset_context.assets[0].id, 'gen_scene_01');

  console.log('test-creative-visual-strategy passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
