import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const modulePath = path.join(root, 'frontend-react/src/components/creative/creativeVisualWarnings.js');
const componentPath = path.join(root, 'frontend-react/src/components/creative/CreativeVisualWarnings.jsx');
const detailPath = path.join(root, 'frontend-react/src/components/creative/CreativeTaskDetail.jsx');
const retryPlanPath = path.join(root, 'frontend-react/src/components/creative/CreativeRetryPlan.jsx');

const { collectVisualWarnings, shouldShowVisualWarnings } = await import(pathToFileURL(modulePath));

// 1) 读取链：visual_inspect.warnings 直读
const doneWorkflow = {
  status: 'done',
  result: {
    hyperframes_freeform: {
      visual_inspect: {
        status: 'passed_with_warnings',
        warnings: [
          { code: 'subtitle_low_contrast', message: '字幕对比度偏低' },
          { code: 'subtitle_low_contrast', message: '字幕对比度偏低' }, // 重复应去重
        ],
      },
    },
  },
};
assert.equal(collectVisualWarnings(doneWorkflow).length, 1);
assert.equal(shouldShowVisualWarnings(doneWorkflow), true);

// 2) 兜底链：warnings 缺失时读 report.warnings
const reportWorkflow = {
  status: 'done',
  workflow: {
    result: {
      hyperframes_freeform: {
        visual_inspect: {
          report: { warnings: [{ code: 'overlay_edge', message: '叠加贴边' }] },
        },
      },
    },
  },
};
assert.equal(collectVisualWarnings(reportWorkflow).length, 1);
assert.equal(collectVisualWarnings(reportWorkflow)[0].message, '叠加贴边');

// 3) 无 warnings → 不展示
assert.equal(shouldShowVisualWarnings({ status: 'done', result: {} }), false);
assert.equal(shouldShowVisualWarnings(null), false);
assert.equal(shouldShowVisualWarnings({ result: { hyperframes_freeform: { visual_inspect: { warnings: ['bad-string'] } } } }), false);

// 4) 组件与挂载点接线（字符串断言，随 tests/test-html-video-sfx-panel.mjs 模式）
const [component, detail, retryPlan] = await Promise.all([
  readFile(componentPath, 'utf8'),
  readFile(detailPath, 'utf8'),
  readFile(retryPlanPath, 'utf8'),
]);

assert.match(component, /collectVisualWarnings/);
assert.match(component, /if \(!visualWarnings\.length\) return null;/);
assert.match(component, /视觉观察告警 \{visualWarnings\.length\} 条（不影响成片，仅供参考）/);
// token 类，不新增 hex
assert.match(component, /text-fg-1/);
assert.match(component, /border-line-2/);
assert.doesNotMatch(component, /#[0-9a-fA-F]{3,6}/);

// 成功（非失败）路径由 CreativeTaskDetail 挂载
assert.match(detail, /CreativeVisualWarnings/);
assert.match(detail, /workflow\?\.status !== 'failed'/);
// 失败路径复用同一组件，且不再保留本地 collectVisualWarnings 副本
assert.match(retryPlan, /<CreativeVisualWarnings workflow=\{workflow\} \/>/);
assert.doesNotMatch(retryPlan, /function collectVisualWarnings/);

console.log('creative visual warnings tests passed');
