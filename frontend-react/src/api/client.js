async function requestJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (cause) {
    throw new Error('无法连接服务，请检查网络或确认 MuseDock 服务已启动。', { cause });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = data.message || data.error || '';
    if (!message) {
      if (response.status === 502) {
        message = '服务暂时不可用（502 Bad Gateway），请稍后重试';
      } else if (response.status === 503) {
        message = '服务暂时不可用（503 Service Unavailable），请稍后重试';
      } else if (response.status === 504) {
        message = '请求超时（504 Gateway Timeout），请稍后重试';
      } else if (response.status === 429) {
        message = '请求过于频繁，请稍后重试';
      } else {
        message = `请求失败：${response.status}`;
      }
    }
    const error = new Error(message);
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

function parseSseChunk(buffer, onEvent) {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() || '';
  for (const part of parts) {
    const dataLines = part
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => {
        const data = line.slice(5);
        return data.startsWith(' ') ? data.slice(1) : data;
      });
    if (!dataLines.length) continue;
    try {
      if (onEvent(JSON.parse(dataLines.join('\n'))) === false) return '';
    } catch {
      if (onEvent({ type: 'task_stream_parse_failed', message: '任务事件解析失败。' }) === false) return '';
    }
  }
  return rest;
}

function safeCall(handler, arg) {
  if (typeof handler !== 'function') return;
  try {
    const result = handler(arg);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // 外部回调异常不应打断事件流读取。
  }
}

function streamJsonSse(url, payload, handlers = {}) {
  const controller = new AbortController();
  const decoder = new TextDecoder();
  let reader = null;
  let buffer = '';
  let closed = false;
  const pump = async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload || {}),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        // 服务端在进入流式前失败的响应是 JSON，尽量透出其中的中文原因。
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || `任务事件流连接失败：HTTP ${response.status}`);
      }
      reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseChunk(buffer, event => {
          if (closed) return false;
          safeCall(handlers.onEvent, event);
          return !closed;
        });
        if (closed) return;
      }
      if (closed) return;
      buffer += decoder.decode();
      if (buffer.trim()) {
        parseSseChunk(`${buffer}\n\n`, event => {
          if (closed) return false;
          safeCall(handlers.onEvent, event);
          return !closed;
        });
      }
      if (closed) return;
      closed = true;
      safeCall(handlers.onClose);
    } catch (error) {
      if (!closed) safeCall(handlers.onError, error);
    }
  };
  pump();
  return {
    abort: () => {
      closed = true;
      controller.abort();
      if (reader) reader.cancel().catch(() => {});
    },
  };
}

export function resolveLocalFileUrl(value, origin = globalThis.location?.origin || 'http://localhost') {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password) return '';
    return /^\/api\/(?:transcriptions\/[^/]+\/files\/[^/]+|creative-workflows\/[^/]+\/(?:whiteboard\/media\/[^/]+|html-video-project\/(?:files\/.+|exports\/[^/]+\/file)))$/.test(url.pathname)
      ? url.pathname : '';
  } catch { return ''; }
}

export const api = {
  listApiCallLogs({ workflowId = '', state = '', before, signal } = {}) {
    const query = new URLSearchParams();
    if (workflowId) query.set('workflow_id', workflowId);
    if (state) query.set('state', state);
    if (before) query.set('before', String(before));
    return requestJson(`/api/api-call-logs?${query}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  },
  getApiCallLog(id, signal) {
    return requestJson(`/api/api-call-logs/${encodeURIComponent(id)}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  },
  openLocalFile(fileUrl, target = 'file') {
    const url = resolveLocalFileUrl(fileUrl);
    if (!url) return Promise.reject(new Error('没有可打开的本地文件，请重新加载这条记录。'));
    return requestJson(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }),
      signal: AbortSignal.timeout(20000),
    });
  },
  getTranscriptionCapabilities() {
    return requestJson('/api/transcriptions/capabilities', { signal: AbortSignal.timeout(15000) });
  },
  listTranscriptions() {
    return requestJson('/api/transcriptions', { signal: AbortSignal.timeout(15000) });
  },
  createTranscription(payload) {
    return requestJson('/api/transcriptions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
  },
  getTranscription(id) {
    return requestJson(`/api/transcriptions/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15000) });
  },
  deleteTranscription(id) {
    return requestJson(`/api/transcriptions/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
      signal: AbortSignal.timeout(60000),
    });
  },
  retryTranscriptionCorrection(id) {
    return requestJson(`/api/transcriptions/${encodeURIComponent(id)}/corrections/retry`, {
      method: 'POST', signal: AbortSignal.timeout(20000),
    });
  },
  startTranscriptionLogin() {
    return requestJson('/api/transcriptions/douyin/login', { method: 'POST', signal: AbortSignal.timeout(90000) });
  },
  checkTranscriptionLogin() {
    return requestJson('/api/transcriptions/douyin/login/status', { method: 'POST', signal: AbortSignal.timeout(30000) });
  },
  getCreationModes() {
    return requestJson('/api/creative-workflows/modes');
  },
  actOnWhiteboardWorkflow(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/whiteboard/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
  },
  // 白板自然语言对话：SSE 流式返回 chat_intent / chat_message_delta / chat_result 事件。
  chatOnWhiteboardWorkflow(workflowId, payload, handlers = {}) {
    return streamJsonSse(`/api/creative-workflows/${encodeURIComponent(workflowId)}/whiteboard/chat`, payload, handlers);
  },
  getWhiteboardArtifact(workflowId, attemptId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/whiteboard/attempts/${encodeURIComponent(attemptId)}`);
  },
  getAiModels() {
    return requestJson('/api/config/ai-models');
  },
  saveAiModels(payload) {
    return requestJson('/api/config/ai-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  getAppSettings() {
    return requestJson('/api/config/app-settings');
  },
  saveAppSettings(payload) {
    return requestJson('/api/config/app-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  getSystemHealth(refresh = false) {
    return requestJson(`/api/config/system-health${refresh ? '?refresh=1' : ''}`);
  },
  cleanupSystemData(targets) {
    return requestJson('/api/config/maintenance/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets }),
    });
  },
  createCreativeWorkflow(payload) {
    return requestJson('/api/creative-workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  uploadCreativeVisualAsset(file, requirement = 'preferred') {
    return requestJson('/api/creative-workflows/assets/uploads', {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'X-File-Name': encodeURIComponent(file.name),
        'X-Asset-Requirement': requirement,
      },
      body: file,
    });
  },
  updateCreativeVisualAssetRequirement(uploadId, requirement) {
    return requestJson(`/api/creative-workflows/assets/uploads/${encodeURIComponent(uploadId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirement }),
    });
  },
  deleteCreativeVisualAsset(uploadId) {
    return requestJson(`/api/creative-workflows/assets/uploads/${encodeURIComponent(uploadId)}`, {
      method: 'DELETE',
    });
  },
  listCreativeWorkflows() {
    return requestJson('/api/creative-workflows');
  },
  getCreativeWorkflow(workflowId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}`);
  },
  getCreativeWorkflowRetryPlan(workflowId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/retry-plan`);
  },
  retryCreativeWorkflow(workflowId, payload = {}) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  streamCreativeWorkflowEvents(workflowId, payload, handlers = {}) {
    return streamJsonSse(`/api/creative-workflows/${encodeURIComponent(workflowId)}/events`, {
      task_id: payload?.task_id || payload?.taskId || '',
      since_seq: payload?.since_seq ?? payload?.sinceSeq ?? 0,
    }, handlers);
  },
  deleteCreativeWorkflow(workflowId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}`, {
      method: 'DELETE',
    });
  },
  getHtmlVideoProject(workflowId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project`);
  },
  patchHtmlVideoProjectFrame(workflowId, frameId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/frames/${encodeURIComponent(frameId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  patchHtmlVideoProjectSfxEvent(workflowId, eventId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/sfx/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  getHtmlVideoProjectFrameHtml(workflowId, frameId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/frames/${encodeURIComponent(frameId)}/html`);
  },
  saveHtmlVideoProjectFrameHtml(workflowId, frameId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/frames/${encodeURIComponent(frameId)}/html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  acceptHtmlVideoProjectFrameDraft(workflowId, frameId, draftId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/frames/${encodeURIComponent(frameId)}/drafts/${encodeURIComponent(draftId)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  discardHtmlVideoProjectFrameDraft(workflowId, frameId, draftId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/frames/${encodeURIComponent(frameId)}/drafts/${encodeURIComponent(draftId)}/discard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  inspectHtmlVideoProjectLayout(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/layout-qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  iterateHtmlVideoProjectFrame(workflowId, frameId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/frames/${encodeURIComponent(frameId)}/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  editHtmlVideoProject(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  createHtmlVideoProjectEditPlan(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/edit-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  runHtmlVideoProjectEditPlan(workflowId, planId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/edit-plan/${encodeURIComponent(planId)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  acceptHtmlVideoProjectEditPlan(workflowId, planId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/edit-plan/${encodeURIComponent(planId)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  discardHtmlVideoProjectEditPlan(workflowId, planId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/edit-plan/${encodeURIComponent(planId)}/discard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  renderHtmlVideoProject(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  exportHtmlVideoProject(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  listHtmlVideoProjectExports(workflowId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/exports`);
  },
  getHtmlVideoProjectExportFileUrl(workflowId, exportId) {
    return `/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/exports/${encodeURIComponent(exportId)}/file`;
  },
};
