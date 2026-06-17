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
const encoder = new TextEncoder();

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const waitFor = async (predicate, message = 'condition', timeoutMs = 500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await settle();
  }
  throw new Error(`Timed out waiting for ${message}`);
};

const settleTicks = async (count = 3) => {
  for (let index = 0; index < count; index += 1) await settle();
};

function createManualResponse() {
  const pendingReads = [];
  const queuedResults = [];

  const deliver = result => {
    const pending = pendingReads.shift();
    if (pending) pending.resolve(result);
    else queuedResults.push(result);
  };

  return {
    response: {
      ok: true,
      status: 200,
      body: {
        getReader() {
          return {
            read() {
              const queued = queuedResults.shift();
              if (queued) return Promise.resolve(queued);
              return new Promise((resolve, reject) => pendingReads.push({ resolve, reject }));
            },
            cancel() {
              deliver({ done: true });
              return Promise.resolve();
            },
          };
        },
      },
    },
    push(chunk) {
      deliver({ done: false, value: encoder.encode(chunk) });
    },
    done() {
      deliver({ done: true });
    },
  };
}

const withUnhandledRejectionCapture = async action => {
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await action(unhandled);
    await settleTicks(5);
    assert.equal(unhandled.length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
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
    await settleTicks();
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
    await waitFor(() => errors.length === 1, 'fetch error handler');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'network down');
  }

  {
    const errors = [];
    globalThis.fetch = async () => ({ ok: false, status: 500, body: {} });

    api.streamCreativeWorkflowEvents('wf-3', {}, {
      onError: error => errors.push(error),
    });

    await waitFor(() => errors.length === 1, 'HTTP error handler');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /任务事件流连接失败：HTTP 500/);
  }

  {
    const errors = [];
    globalThis.fetch = async () => ({ ok: true, status: 200 });

    api.streamCreativeWorkflowEvents('wf-4', {}, {
      onError: error => errors.push(error),
    });

    await waitFor(() => errors.length === 1, 'missing body error handler');
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

    await waitFor(() => errors.length === 1, 'reader error handler');
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

    await waitFor(() => readerCreated, 'reader creation');
    stream.abort();
    await settleTicks();
    assert.equal(closes.length, 0);
  }

  {
    const stream = createManualResponse();
    const events = [];
    globalThis.fetch = async () => stream.response;

    api.streamCreativeWorkflowEvents('wf-events-1', {}, {
      onEvent: event => events.push(event),
    });

    await settleTicks();
    stream.push('data: {"type":"ready","seq":1}\n\n');
    await waitFor(() => events.length === 1, 'single SSE event');
    assert.deepEqual(events[0], { type: 'ready', seq: 1 });
  }

  {
    const stream = createManualResponse();
    const events = [];
    globalThis.fetch = async () => stream.response;

    api.streamCreativeWorkflowEvents('wf-events-2', {}, {
      onEvent: event => events.push(event),
    });

    await settleTicks();
    stream.push('data: {"type":"partial"');
    await settleTicks();
    assert.equal(events.length, 0);
    stream.push(',"seq":2}\n\n');
    await waitFor(() => events.length === 1, 'partial SSE event');
    assert.deepEqual(events[0], { type: 'partial', seq: 2 });
  }

  {
    const stream = createManualResponse();
    const events = [];
    globalThis.fetch = async () => stream.response;

    api.streamCreativeWorkflowEvents('wf-events-3', {}, {
      onEvent: event => events.push(event),
    });

    await settleTicks();
    stream.push('data: {"seq":1}\n\ndata: {"seq":2}\n\n');
    await waitFor(() => events.length === 2, 'multiple SSE events');
    assert.deepEqual(events, [{ seq: 1 }, { seq: 2 }]);
  }

  {
    const stream = createManualResponse();
    const events = [];
    let subscription = null;
    globalThis.fetch = async () => stream.response;

    subscription = api.streamCreativeWorkflowEvents('wf-events-abort', {}, {
      onEvent: event => {
        events.push(event);
        if (event.seq === 1) subscription.abort();
      },
    });

    await settleTicks();
    stream.push('data: {"seq":1}\n\ndata: {"seq":2}\n\n');
    await waitFor(() => events.length > 0, 'first event before abort');
    await settleTicks();
    assert.deepEqual(events, [{ seq: 1 }]);
  }

  {
    const stream = createManualResponse();
    const events = [];
    globalThis.fetch = async () => stream.response;

    api.streamCreativeWorkflowEvents('wf-events-4', {}, {
      onEvent: event => events.push(event),
    });

    await settleTicks();
    stream.push('data: {"type":"crlf"}\r\n\r\n');
    await waitFor(() => events.length === 1, 'CRLF SSE event');
    assert.deepEqual(events[0], { type: 'crlf' });
  }

  {
    const stream = createManualResponse();
    const events = [];
    globalThis.fetch = async () => stream.response;

    api.streamCreativeWorkflowEvents('wf-events-5', {}, {
      onEvent: event => events.push(event),
    });

    await settleTicks();
    stream.push('data:{"type":"no-space"}\n\n');
    await waitFor(() => events.length === 1, 'SSE data without space');
    assert.deepEqual(events[0], { type: 'no-space' });
  }

  {
    const stream = createManualResponse();
    const events = [];
    globalThis.fetch = async () => stream.response;

    api.streamCreativeWorkflowEvents('wf-events-6', {}, {
      onEvent: event => events.push(event),
    });

    await settleTicks();
    stream.push('data: {"lines":["first",\ndata: "second"]}\n\n');
    await waitFor(() => events.length === 1, 'multi-line data SSE event');
    assert.deepEqual(events[0], { lines: ['first', 'second'] });
  }

  {
    const stream = createManualResponse();
    const events = [];
    globalThis.fetch = async () => stream.response;

    api.streamCreativeWorkflowEvents('wf-events-7', {}, {
      onEvent: event => events.push(event),
    });

    await settleTicks();
    stream.push('data: {"type":"flush"}');
    await settleTicks();
    assert.equal(events.length, 0);
    stream.done();
    await waitFor(() => events.length === 1, 'flushed SSE event');
    assert.deepEqual(events[0], { type: 'flush' });
  }

  {
    const stream = createManualResponse();
    const events = [];
    globalThis.fetch = async () => stream.response;

    api.streamCreativeWorkflowEvents('wf-events-8', {}, {
      onEvent: event => events.push(event),
    });

    await settleTicks();
    stream.push('data: not-json\n\n');
    await waitFor(() => events.length === 1, 'invalid JSON fallback event');
    assert.deepEqual(events[0], { type: 'task_stream_parse_failed', message: '任务事件解析失败。' });
  }

  await withUnhandledRejectionCapture(async () => {
    const stream = createManualResponse();
    const events = [];
    globalThis.fetch = async () => stream.response;

    api.streamCreativeWorkflowEvents('wf-events-9', {}, {
      onEvent: event => {
        events.push(event);
        throw new Error('handler failed');
      },
    });

    await settleTicks();
    stream.push('data: {"type":"handler-throws"}\n\n');
    await waitFor(() => events.length === 1, 'throwing onEvent handler');
    await settleTicks();
    assert.deepEqual(events, [{ type: 'handler-throws' }]);
  });

  await withUnhandledRejectionCapture(async () => {
    globalThis.fetch = async () => {
      throw new Error('network down while onError throws');
    };

    api.streamCreativeWorkflowEvents('wf-events-10', {}, {
      onError: () => {
        throw new Error('onError failed');
      },
    });

    await settleTicks();
  });

  await withUnhandledRejectionCapture(async () => {
    const stream = createManualResponse();
    globalThis.fetch = async () => stream.response;

    api.streamCreativeWorkflowEvents('wf-events-11', {}, {
      onClose: () => {
        throw new Error('onClose failed');
      },
    });

    await settleTicks();
    stream.done();
    await settleTicks();
  });
} finally {
  globalThis.fetch = originalFetch;
}

console.log('creative task api client tests passed');
