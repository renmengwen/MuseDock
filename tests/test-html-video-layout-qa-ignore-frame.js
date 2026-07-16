const assert = require('assert/strict');
const path = require('path');

const { inspectProjectLayoutBeforeRender } = require('../server/services/creative-video/html-video/timelineGuards');

(async () => {
  const inspectedFrameIds = [];
  const result = await inspectProjectLayoutBeforeRender({
    projectDir: path.join(__dirname, 'fixtures'),
    project: {
      output: { resolution: { width: 1920, height: 1080 } },
      frames: [
        { id: 'scene_01', html_path: 'ignored.html', duration_sec: 1 },
        { id: 'scene_02', html_path: 'checked.html', duration_sec: 1 },
      ],
    },
    ignoreFrameIds: ['scene_01'],
    services: {
      layoutQaService: {
        async inspectFrameHtmlLayout({ frame }) {
          inspectedFrameIds.push(frame.id);
          return { success: true, issues: [], metrics: {} };
        },
      },
    },
  });

  assert.equal(result.success, true);
  assert.deepEqual(inspectedFrameIds, ['scene_02']);
  assert.deepEqual(result.reports.map(report => report.frame_id), ['scene_02']);
  console.log('html-video scoped layout QA ignore tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
