const assert = require('assert');
const fs = require('fs');

const pkg = require('./package.json');

assert.ok(fs.existsSync('.nvmrc'), '.nvmrc should pin the recommended Node major version');
assert.match(fs.readFileSync('.nvmrc', 'utf-8').trim(), /^22(\.|$)/);
assert.ok(pkg.engines, 'package.json should declare engines');
assert.match(pkg.engines.node, /22/);

console.log('runtime env tests passed');
