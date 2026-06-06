import assert from 'node:assert/strict';
import { getAwemeIdFromSearch } from './frontend-react/src/utils/workspaceParams.js';

assert.equal(getAwemeIdFromSearch('?aweme_id=7420001'), '7420001');
assert.equal(getAwemeIdFromSearch('?awemeId=7420002'), '7420002');
assert.equal(getAwemeIdFromSearch('?aweme_id=%207420003%20'), '7420003');
assert.equal(getAwemeIdFromSearch('?foo=bar'), '');

console.log('workspace params tests passed');
