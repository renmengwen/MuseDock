import assert from 'node:assert/strict';
import {
  createIndexColumn,
  getTitleText,
} from '../frontend-react/src/utils/tableColumns.js';

const column = createIndexColumn();

assert.equal(column.id, 'index');
assert.equal(column.label, '序号');
assert.equal(column.alwaysVisible, true);
assert.equal(column.render({}, 0), 1);
assert.equal(column.render({}, 9), 10);

assert.equal(getTitleText({ title: '标题' }), '标题');
assert.equal(getTitleText({ description: '描述' }), '描述');
assert.equal(getTitleText({}), '-');

console.log('table utils tests passed');
