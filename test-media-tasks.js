const assert = require('assert');

const mediaTasks = require('./server/services/mediaTasks');

async function run() {
  mediaTasks.clearTasks();

  const task = mediaTasks.createTask({
    awemeId: '12345678901',
    type: 'prepare',
    label: '准备 AI 素材',
  });

  assert.match(task.task_id, /^media-/);
  assert.equal(task.status, 'queued');
  assert.equal(task.progress, 0);
  assert.equal(task.aweme_id, '12345678901');
  assert.equal(task.label, '准备 AI 素材');

  const running = mediaTasks.updateTask(task.task_id, {
    status: 'running',
    progress: 35,
    message: '正在下载视频...',
    step: 'video',
  });
  assert.equal(running.status, 'running');
  assert.equal(running.progress, 35);
  assert.equal(running.step, 'video');
  assert.equal(running.message, '正在下载视频...');
  assert.ok(running.updated_at >= running.created_at);

  const done = mediaTasks.completeTask(task.task_id, {
    message: '素材准备完成',
    result: { success: true },
  });
  assert.equal(done.status, 'done');
  assert.equal(done.progress, 100);
  assert.equal(done.success, true);
  assert.deepEqual(done.result, { success: true });

  const failedTask = mediaTasks.createTask({
    awemeId: '12345678901',
    type: 'transcribe',
    label: '音频转写',
  });
  const failed = mediaTasks.failTask(failedTask.task_id, new Error('ASR 未配置'));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.success, false);
  assert.equal(failed.error, 'ASR 未配置');

  const list = mediaTasks.listTasks({ awemeId: '12345678901' });
  assert.equal(list.length, 2);
  assert.equal(list[0].task_id, failedTask.task_id);
  assert.equal(mediaTasks.getTask(task.task_id).task_id, task.task_id);
}

run().then(() => {
  console.log('media tasks tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
