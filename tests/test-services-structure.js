const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function run() {
  const creativeWorkflows = read('server/services/creative/creativeWorkflows.js');
  assert.doesNotMatch(
    creativeWorkflows,
    /require\(['"]\.\.\/creative-video\/html-video\//,
    'creativeWorkflows should not require html-video internals directly',
  );

  const agentRuns = read('server/services/agent/agentRuns.js');
  assert.match(agentRuns, /createAgentRunsFreeformWorkflow/);
  assert.doesNotMatch(
    agentRuns,
    /async function generateDouyinRunHyperframesFreeformBrief/,
    'freeform workflow body should live outside agentRuns.js',
  );

  assert.equal(fs.existsSync(path.join(root, 'tests/test-module-load.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'tests/check-module-load.js')), false);
}

run();
console.log('services structure tests passed');
