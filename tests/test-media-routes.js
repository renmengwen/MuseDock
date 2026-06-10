const assert = require('assert');
const fs = require('fs/promises');

const mediaTasks = require('../server/services/mediaTasks');
const mediaPipeline = require('../server/services/mediaPipeline');

async function waitForTask(baseUrl, awemeId, taskId) {
  for (let index = 0; index < 20; index += 1) {
    const response = await fetch(`${baseUrl}/api/media/douyin/${awemeId}/tasks/${taskId}`);
    const json = await response.json();
    if (json.task?.status === 'done' || json.task?.status === 'failed') return json.task;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Task ${taskId} did not settle`);
}

async function run() {
  const awemeId = '12345678901';
  const paths = mediaPipeline.getMediaPaths(awemeId);
  mediaTasks.clearTasks();
  await fs.rm(paths.dir, { recursive: true, force: true });
  await fs.mkdir(paths.framesDir, { recursive: true });
  await fs.writeFile(paths.metadata, JSON.stringify({
    aweme_id: awemeId,
    title: 'route test',
    aweme_url: `https://www.douyin.com/video/${awemeId}`,
    video_download_url: '',
  }));
  await fs.writeFile(paths.video, 'video');
  await fs.writeFile(paths.audio, 'audio');
  await fs.writeFile(`${paths.framesDir}/frame-0001.jpg`, 'frame');

  const app = require('../server/app');
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const prepareResponse = await fetch(`${baseUrl}/api/media/douyin/${awemeId}/prepare?async=true`, {
      method: 'POST',
    });
    assert.equal(prepareResponse.status, 202);
    const prepareJson = await prepareResponse.json();
    assert.equal(prepareJson.success, true);
    assert.equal(prepareJson.task.type, 'prepare');
    assert.equal(prepareJson.task.aweme_id, awemeId);

    const taskResponse = await fetch(`${baseUrl}/api/media/douyin/${awemeId}/tasks/${prepareJson.task.task_id}`);
    assert.equal(taskResponse.status, 200);
    const taskJson = await taskResponse.json();
    assert.equal(taskJson.success, true);
    assert.equal(taskJson.task.task_id, prepareJson.task.task_id);
    const settledPrepare = await waitForTask(baseUrl, awemeId, prepareJson.task.task_id);
    assert.equal(settledPrepare.status, 'done');

    const transcribeResponse = await fetch(`${baseUrl}/api/media/douyin/${awemeId}/transcribe?async=true`, {
      method: 'POST',
    });
    assert.equal(transcribeResponse.status, 202);
    const transcribeJson = await transcribeResponse.json();
    assert.equal(transcribeJson.task.type, 'transcribe');
    const settledTranscribe = await waitForTask(baseUrl, awemeId, transcribeJson.task.task_id);
    assert.equal(settledTranscribe.status, 'failed');

    const listResponse = await fetch(`${baseUrl}/api/media/douyin/${awemeId}/tasks`);
    assert.equal(listResponse.status, 200);
    const listJson = await listResponse.json();
    assert.equal(listJson.success, true);
    assert.ok(listJson.data.length >= 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(paths.dir, { recursive: true, force: true });
  }
}

run().then(() => {
  console.log('media routes tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
