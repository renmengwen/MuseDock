import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const modulePath = path.join(root, 'frontend-react/src/components/creative/creativeVisualWarnings.js');
const componentPath = path.join(root, 'frontend-react/src/components/creative/CreativeVisualWarnings.jsx');
const detailPath = path.join(root, 'frontend-react/src/components/creative/CreativeTaskDetail.jsx');
const retryPlanPath = path.join(root, 'frontend-react/src/components/creative/CreativeRetryPlan.jsx');

const {
  collectVisualWarnings,
  shouldShowVisualWarnings,
  visibleWarnings,
  visualWarningsSignature,
  VISUAL_WARNINGS_COLLAPSED_LIMIT,
} = await import(pathToFileURL(modulePath));

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

// 4) 折叠/展开纯函数：6 条内全显、超 6 折叠、展开全显
const eightWarnings = Array.from({ length: 8 }, (_, i) => ({ code: `w${i}`, message: `告警 ${i}` }));
assert.equal(VISUAL_WARNINGS_COLLAPSED_LIMIT, 6);
assert.equal(visibleWarnings(eightWarnings.slice(0, 6), false).length, 6);
assert.equal(visibleWarnings(eightWarnings, false).length, 6);
assert.deepEqual(visibleWarnings(eightWarnings, false), eightWarnings.slice(0, 6));
assert.equal(visibleWarnings(eightWarnings, true).length, 8);
assert.deepEqual(visibleWarnings(null, false), []);
assert.equal(typeof visualWarningsSignature, 'function', '必须导出无歧义告警签名函数');
assert.notEqual(
  visualWarningsSignature([{ code: 'a|b', message: 'c' }]),
  visualWarningsSignature([{ code: 'a', message: 'b|c' }]),
  'code/message 变化不得因分隔符碰撞得到相同签名',
);
assert.equal(visualWarningsSignature([]), '', '空告警必须保留 falsy 签名，避免播报“0 条”');
assert.equal(visualWarningsSignature(null), '', '缺失告警必须与空告警使用同一 falsy 签名');

// 5) 组件与挂载点接线（字符串断言，随 tests/test-html-video-sfx-panel.mjs 模式）
const [component, detail, retryPlan] = await Promise.all([
  readFile(componentPath, 'utf8'),
  readFile(detailPath, 'utf8'),
  readFile(retryPlanPath, 'utf8'),
]);

assert.match(component, /collectVisualWarnings/);
// aria-live 容器始终挂载且为 sr-only（absolute 定位脱离布局流，空态不占父级 grid 间距）
assert.doesNotMatch(component, /return null;/);
assert.match(component, /role="status" aria-live="polite" className="sr-only"/);
// sr-only 区域只播报摘要文案，不放完整列表
assert.match(component, /视觉观察告警 \$\{visualWarnings\.length\} 条/);
// 可见内容（标题+列表+按钮）整体条件渲染：无告警时不渲染任何参与布局的元素
assert.match(component, /\{visualWarnings\.length \? \(/);
assert.match(component, /视觉观察告警 \{visualWarnings\.length\} 条（不影响成片，仅供参考）/);
// 告警集合变化时重置展开态，并让 live region 先清空、下一任务再写回摘要；
// 即使条数不变，code/message 变化也会产生可播报的 DOM 文本变化。
assert.match(component, /const \[announcement, setAnnouncement\] = useState\(''\)/);
assert.match(component, /setExpanded\(false\)/);
assert.match(component, /\[warningsSignature\]/);
assert.match(component, /\{announcement\}/);
assert.match(component, /visualWarningsSignature/);
const effectStart = component.indexOf('useEffect(() => {');
const effectEnd = component.indexOf('}, [warningsSignature]);', effectStart);
const announcementEffect = component.slice(effectStart, effectEnd + '}, [warningsSignature]);'.length);
assert.match(
  announcementEffect,
  /setAnnouncement\(''\);[\s\S]*const timer = window\.setTimeout\(\(\) => \{[\s\S]*setAnnouncement\(`视觉观察告警 \$\{visualWarnings\.length\} 条`\);[\s\S]*return \(\) => window\.clearTimeout\(timer\)/,
  'effect 必须先清空、异步写回摘要，并返回 timer cleanup',
);
// 展开/收起按钮位于 sr-only aria-live 容器之外（在可见 wrapper 内），避免点击展开触发整段重播
const liveRegionEnd = component.indexOf('</div>', component.indexOf('aria-live'));
const buttonStart = component.indexOf('<button');
assert.ok(buttonStart > liveRegionEnd, '展开/收起按钮应在 aria-live 容器之外');
// 按钮携带 aria-expanded 表达展开态
assert.match(component, /aria-expanded=\{expanded\}/);
// token 类，不新增 hex
assert.match(component, /text-fg-1/);
assert.match(component, /border-line-2/);
assert.doesNotMatch(component, /#[0-9a-fA-F]{3,6}/);
// 折叠/展开按钮取代死提示文案，且带屏幕阅读器语义
assert.doesNotMatch(component, /视觉报告中查看/);
assert.match(component, /useState\(false\)/);
assert.match(component, /visibleWarnings/);
assert.match(component, /展开其余/);
assert.match(component, /'收起'/);
assert.match(component, /role="status"/);
assert.match(component, /aria-live="polite"/);

// 成功（非失败）路径由 CreativeTaskDetail 挂载
assert.match(detail, /CreativeVisualWarnings/);
assert.match(detail, /workflow\?\.status !== 'failed'/);
// 失败路径复用同一组件，且不再保留本地 collectVisualWarnings 副本
assert.match(retryPlan, /<CreativeVisualWarnings workflow=\{workflow\} \/>/);
assert.doesNotMatch(retryPlan, /function collectVisualWarnings/);

// 6) esbuild 转译语法校验组件（仓库未装 esbuild 时跳过，不新增依赖）
try {
  const { transform } = await import('esbuild');
  await transform(component, { loader: 'jsx', jsx: 'automatic' });
  console.log('esbuild jsx transform passed');
} catch (error) {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') {
    console.log('esbuild 未安装，跳过 JSX 转译校验');
  } else {
    throw error;
  }
}

console.log('creative visual warnings tests passed');
