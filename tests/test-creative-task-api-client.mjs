import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(__dirname, '../frontend-react/src/api/client.js');
const source = fs.readFileSync(clientPath, 'utf8');

assert.match(source, /streamCreativeWorkflowEvents\(workflowId,\s*payload,\s*handlers\s*=\s*\{\}\)/);
assert.match(source, /Accept['"]?\s*:\s*['"]text\/event-stream['"]/);
assert.match(source, /method:\s*'POST'/);
assert.match(source, /response\.body\.getReader\(\)/);
assert.match(source, /since_seq/);
assert.match(source, /onEvent/);
assert.match(source, /AbortController/);

const testModuleSource = `${source.replace('export const api =', 'const api =')}\nexport { api };\n`;
const testModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(testModuleSource)}#${Date.now()}`;
const { api } = await import(testModuleUrl);
const originalFetch = globalThis.fetch;

const waitFor = async predicate => {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

try {
  {
    let request = null;
    const errors = [];
    globalThis.fetch = (url, options) => {
      request = { url, options };
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    };

    const stream = api.streamCreativeWorkflowEvents('wf-1', { taskId: 'task-1', sinceSeq: 7 }, {
      onError: error => errors.push(error),
    });

    assert.equal(typeof stream.abort, 'function');
    assert.equal(request.url, '/api/creative-workflows/wf-1/events');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Accept, 'text/event-stream');
    assert.deepEqual(JSON.parse(request.options.body), { task_id: 'task-1', since_seq: 7 });

    stream.abort();
    assert.equal(request.options.signal.aborted, true);
    await waitFor(() => errors.length > 0);
    assert.equal(errors.length, 0);
  }

  {
    const errors = [];
    globalThis.fetch = async () => {
      throw new Error('network down');
    };

    const stream = api.streamCreativeWorkflowEvents('wf-2', {}, {
      onError: error => errors.push(error),
    });

    assert.equal(typeof stream.abort, 'function');
    await waitFor(() => errors.length === 1);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'network down');
  }

  {
    const errors = [];
    globalThis.fetch = async () => ({ ok: false, status: 500, body: {} });

    api.streamCreativeWorkflowEvents('wf-3', {}, {
      onError: error => errors.push(error),
    });

    await waitFor(() => errors.length === 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /任务事件流连接失败：HTTP 500/);
  }

  {
    const errors = [];
    globalThis.fetch = async () => ({ ok: true, status: 200 });

    api.streamCreativeWorkflowEvents('wf-4', {}, {
      onError: error => errors.push(error),
    });

    await waitFor(() => errors.length === 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /任务事件流连接失败：HTTP 200/);
  }

  {
    const errors = [];
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      body: {
        getReader() {
          return {
            async read() {
              throw new Error('reader failed');
            },
            cancel() {
              return Promise.resolve();
            },
          };
        },
      },
    });

    api.streamCreativeWorkflowEvents('wf-5', {}, {
      onError: error => errors.push(error),
    });

    await waitFor(() => errors.length === 1);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'reader failed');
  }

  {
    let readerCreated = false;
    let resolveRead = null;
    const closes = [];
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      body: {
        getReader() {
          readerCreated = true;
          return {
            read() {
              return new Promise(resolve => {
                resolveRead = resolve;
              });
            },
            cancel() {
              resolveRead?.({ done: true });
              return Promise.resolve();
            },
          };
        },
      },
    });

    const stream = api.streamCreativeWorkflowEvents('wf-6', {}, {
      onClose: () => closes.push('closed'),
    });

    await waitFor(() => readerCreated);
    stream.abort();
    await waitFor(() => closes.length > 0);
    assert.equal(closes.length, 0);
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log('creative task api client tests passed');
