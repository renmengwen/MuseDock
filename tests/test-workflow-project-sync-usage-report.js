const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { syncProjectStageSummariesFromProjectDir } = require('../server/services/creative/workflowProjectSync');

async function run() {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'musedock-usage-sync-'));
  const workflowId = 'workflow_pending_frame_html';
  const projectDir = path.join(mediaRoot, workflowId, 'agent_runs', 'run-1');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    workflow_id: workflowId,
    assets: [{ id: 'gen_scene_01', path: 'assets/generated.jpg', source: 'generated' }],
    frames: [],
    generation_checkpoint: { stages: { frame_html: { status: 'pending', frames: {} } } },
  }), 'utf8');

  const staleReport = { status: 'ready', assets: [{ asset_id: 'gen_scene_01', used: false }], required_asset_ids: [] };
  const record = {
    workflow_id: workflowId,
    asset_context: { assets: [], asset_usage_report: staleReport },
    creative_context: { asset_context: { assets: [], asset_usage_report: staleReport } },
    result: { hyperframes_freeform: { project: { asset_usage_report: staleReport } } },
  };

  await syncProjectStageSummariesFromProjectDir(record, projectDir, { mediaRoot });

  assert.equal(record.asset_context.asset_usage_report, undefined);
  assert.equal(record.creative_context.asset_context.asset_usage_report, undefined);
  assert.equal(record.result.hyperframes_freeform.project.asset_usage_report, undefined);
  fs.rmSync(mediaRoot, { recursive: true, force: true });
  console.log('workflow project sync usage report tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
