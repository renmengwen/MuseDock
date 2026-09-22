import assert from 'node:assert/strict';
import { createJsonPreview, PREVIEW_CHARACTERS } from '../frontend-react/src/lib/json-response-preview.mjs';

const body = '{"id":7123456789012345678,"ratio":1.2300e+4,"zero":-0,"choices":[{"content":"正文","enabled":true,"extra":null}],"empty":{},"list":[]}';
const preview = createJsonPreview(body);
assert.equal(preview.truncated, false);
assert.deepEqual(preview.root.children.slice(0, 3).map(node => node.text), ['7123456789012345678', '1.2300e+4', '-0']);
const choices = preview.root.children[3];
assert.equal(choices.type, 'array');
assert.deepEqual(choices.children[0].children.map(node => [node.key, node.type, node.text]), [
  ['"content"', 'string', '"正文"'], ['"enabled"', 'boolean', 'true'], ['"extra"', 'null', 'null'],
]);
assert.deepEqual(preview.root.children.slice(4).map(node => [node.type, node.children.length]), [['object', 0], ['array', 0]]);

const duplicate = createJsonPreview('{"2":"先出现","1":"后出现","2":"重复字段"}');
assert.deepEqual(duplicate.root.children.map(node => node.key), ['"2"', '"1"', '"2"']);
assert.equal(duplicate.root.children[2].text, '"重复字段"');

const stringValue = '换行\n带引号 "以及反斜杠 \\ 和标点 {}[],: <script>文本</script>';
const escaped = createJsonPreview(JSON.stringify({ '复杂"键': stringValue }));
assert.equal(escaped.root.children[0].key, JSON.stringify('复杂"键'));
assert.equal(escaped.root.children[0].text, JSON.stringify(stringValue));
assert.equal(createJsonPreview('"{\\"nested\\":true}"').root.type, 'string');
for (const [text, type] of [['null', 'null'], ['false', 'boolean'], ['42', 'number'], ['"文本"', 'string']]) {
  assert.equal(createJsonPreview(text).root.type, type);
}
for (const text of ['', '普通错误文本', '<html>服务错误</html>', '{"incomplete":', '{"a":1}后续文本', 'data: {"a":1}\n\n']) {
  assert.equal(createJsonPreview(text), null);
}

const longBody = JSON.stringify({ text: '字'.repeat(PREVIEW_CHARACTERS), after: '未预览' });
const longPreview = createJsonPreview(longBody);
assert.equal(longPreview.truncated, true);
assert.equal(longPreview.root.children.length, 1);
assert.equal(longPreview.root.children[0].truncated, true);
assert.ok(longPreview.root.children[0].text.length <= PREVIEW_CHARACTERS);
assert.equal(longPreview.root.truncated, true);

const widePreview = createJsonPreview(JSON.stringify(Array.from({ length: 2500 }, (_, index) => index)));
assert.equal(widePreview.truncated, true);
assert.ok(widePreview.root.children.length < 2500);
assert.equal(widePreview.root.truncated, true);
const deepPreview = createJsonPreview('['.repeat(40) + '0' + ']'.repeat(40));
assert.equal(deepPreview.truncated, true);
assert.equal(deepPreview.root.truncated, true);

console.log('JSON 正文预览验证通过：嵌套类型、原始数值、字段顺序、重复字段、转义字符串、文本回退和预览上限。');
