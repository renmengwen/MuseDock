const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { renderFrame } = require('../server/services/creative-video/html-video/frameRenderer');

(async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-frame-renderer-'));
  const htmlPath = path.join(projectDir, 'frames', '01-scene_01.html');
  await fs.mkdir(path.dirname(htmlPath), { recursive: true });
  await fs.writeFile(htmlPath, '<html><body>帧</body></html>', 'utf8');

  let receivedSourcePath = '';
  const state = {};
  const result = await renderFrame(
    {
      id: 'scene_01',
      html_path: 'frames/01-scene_01.html',
      duration_sec: 4,
    },
    {
      projectDir,
      outputPath: path.join(projectDir, 'frames', 'scene_01.mp4'),
      state,
      adapter: {
        render: async input => {
          receivedSourcePath = input.template.sourcePath;
          return {
            output_path: input.config.outputPath,
            meta: { durationSec: input.config.duration },
            diagnostics: [],
          };
        },
      },
    },
  );

  assert.equal(result.success, true);
  assert.equal(receivedSourcePath, htmlPath);
  assert.equal(state.status, 'done');

  console.log('html-video frame renderer tests passed');
})();
