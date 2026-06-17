async function requestJson(url, options) {
  const response = await fetch(url, options);
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
        message = `Request failed: ${response.status}`;
      }
    }
    const error = new Error(message);
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function requestRaw(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const data = await response.clone().json().catch(() => ({}));
    const text = data.message || data.error ? '' : await response.text().catch(() => '');
    const message = data.message || data.error || text || `Request failed: ${response.status}`;
    const error = new Error(message);
    error.data = data;
    throw error;
  }
  return response;
}

function parseSseChunk(buffer, onEvent) {
  const parts = buffer.split(/\n\n/);
  const rest = parts.pop() || '';
  for (const part of parts) {
    const dataLine = part.split(/\n/).find(line => line.startsWith('data: '));
    if (!dataLine) continue;
    try {
      onEvent(JSON.parse(dataLine.slice(6)));
    } catch {
      onEvent({ type: 'task_stream_parse_failed', message: '任务事件解析失败。' });
    }
  }
  return rest;
}

async function streamJsonSse(url, payload, handlers = {}) {
  const controller = new AbortController();
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
    throw new Error(`任务事件流连接失败：HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let closed = false;
  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseChunk(buffer, event => handlers.onEvent?.(event));
      }
      if (buffer.trim()) parseSseChunk(`${buffer}\n\n`, event => handlers.onEvent?.(event));
      closed = true;
      handlers.onClose?.();
    } catch (error) {
      if (!closed) handlers.onError?.(error);
    }
  };
  pump();
  return {
    abort: () => {
      closed = true;
      controller.abort();
      reader.cancel().catch(() => {});
    },
  };
}

export const api = {
  getCookies() {
    return requestJson('/api/config/cookies');
  },
  saveCookies(payload) {
    return requestJson('/api/config/cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
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
  startDouyinLogin() {
    return requestJson('/api/douyin/qrcode-login', { method: 'POST' });
  },
  getDouyinLoginStatus() {
    return requestJson('/api/douyin/login-status');
  },
  searchDouyin(keyword, max) {
    return requestJson(`/api/douyin/search?keyword=${encodeURIComponent(keyword)}&max=${encodeURIComponent(max)}`);
  },
  crawlDouyinAweme(ids) {
    return requestJson(`/api/douyin/aweme?ids=${encodeURIComponent(ids)}`);
  },
  crawlDouyinCreator(input, max) {
    return requestJson(`/api/douyin/creator?sec_uid=${encodeURIComponent(input)}&max=${encodeURIComponent(max)}`);
  },
  searchXhs(keyword, max) {
    return requestJson(`/api/xhs/search?keyword=${encodeURIComponent(keyword)}&max=${encodeURIComponent(max)}`);
  },
  getDouyinComments(awemeId, max = 50, includeReplies = true, maxReplies = 20) {
    const params = new URLSearchParams({
      aweme_id: awemeId,
      max: String(max),
      includeReplies: String(includeReplies),
      maxReplies: String(maxReplies),
    });
    return requestJson(`/api/douyin/comments?${params.toString()}`);
  },
  getLocalDouyinComments(awemeId, max = 50, maxReplies = 20) {
    const params = new URLSearchParams({
      aweme_id: awemeId,
      max: String(max),
      maxReplies: String(maxReplies),
    });
    return requestJson(`/api/douyin/comments/local?${params.toString()}`);
  },
  getHistory(platform, keyword = '') {
    const suffix = keyword ? `?keyword=${encodeURIComponent(keyword)}` : '';
    return requestJson(`/api/history/${platform}${suffix}`);
  },
  getCrawlKeywords(platform) {
    return requestJson(`/api/history/${platform}/keywords`);
  },
  deleteHistory(platform, ids) {
    return requestJson(`/api/history/${platform}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  },
  prepareDouyinMedia(awemeId, force = false) {
    const params = force ? '?force=true' : '';
    return requestJson(`/api/media/douyin/${encodeURIComponent(awemeId)}/prepare${params}`, { method: 'POST' });
  },
  startDouyinMediaPrepareTask(awemeId, force = false) {
    const params = new URLSearchParams({ async: 'true' });
    if (force) params.set('force', 'true');
    return requestJson(`/api/media/douyin/${encodeURIComponent(awemeId)}/prepare?${params.toString()}`, { method: 'POST' });
  },
  getDouyinMediaStatus(awemeId) {
    return requestJson(`/api/media/douyin/${encodeURIComponent(awemeId)}/status`);
  },
  transcribeDouyinMedia(awemeId) {
    return requestJson(`/api/media/douyin/${encodeURIComponent(awemeId)}/transcribe`, { method: 'POST' });
  },
  startDouyinTranscribeTask(awemeId) {
    return requestJson(`/api/media/douyin/${encodeURIComponent(awemeId)}/transcribe?async=true`, { method: 'POST' });
  },
  getDouyinMediaTask(awemeId, taskId) {
    return requestJson(`/api/media/douyin/${encodeURIComponent(awemeId)}/tasks/${encodeURIComponent(taskId)}`);
  },
  listDouyinMediaTasks(awemeId, type = '') {
    const suffix = type ? `?type=${encodeURIComponent(type)}` : '';
    return requestJson(`/api/media/douyin/${encodeURIComponent(awemeId)}/tasks${suffix}`);
  },
  openDouyinMediaTarget(awemeId, target = 'dir') {
    return requestJson(`/api/media/douyin/${encodeURIComponent(awemeId)}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    });
  },
  listAgentTemplates() {
    return requestJson('/api/agents/templates');
  },
  getAgentTemplate(id) {
    return requestJson(`/api/agents/templates/${encodeURIComponent(id)}`);
  },
  saveAgentTemplate(id, payload) {
    return requestJson(`/api/agents/templates/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  restoreAgentTemplate(id) {
    return requestJson(`/api/agents/templates/${encodeURIComponent(id)}/override`, { method: 'DELETE' });
  },
  getStoryboardTemplate() {
    return requestJson('/api/agents/storyboard-template');
  },
  saveStoryboardTemplate(payload) {
    return requestJson('/api/agents/storyboard-template', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  restoreStoryboardTemplate() {
    return requestJson('/api/agents/storyboard-template/override', { method: 'DELETE' });
  },
  previewAgentMessages(config, values = {}) {
    return requestJson('/api/agents/messages/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, values }),
    });
  },
  previewStoryboardMessages(config, values = {}) {
    return requestJson('/api/agents/storyboard-messages/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, values }),
    });
  },
  createCreativeWorkflow(payload) {
    return requestJson('/api/creative-workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  getCreativeWorkflow(workflowId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}`);
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
  getCreativeWorkflowSceneSpec(workflowId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/scene-spec`);
  },
  patchCreativeWorkflowSceneSpec(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/scene-spec`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  rewriteCreativeWorkflowScene(workflowId, sceneId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/scenes/${encodeURIComponent(sceneId)}/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  ttsCreativeWorkflowScene(workflowId, sceneId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/scenes/${encodeURIComponent(sceneId)}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  rerenderCreativeWorkflow(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/rerender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  getCreativeVideoSpec(workflowId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/video-spec`);
  },
  patchCreativeVideoSpec(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/video-spec`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  rerenderCreativeVideo(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/rerender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  remixCreativeVideo(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/remix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  getHtmlVideoProject(workflowId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project`);
  },
  patchHtmlVideoProjectInputs(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/inputs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  patchHtmlVideoProjectFrame(workflowId, frameId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/frames/${encodeURIComponent(frameId)}`, {
      method: 'PATCH',
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
  createDouyinAgentRun(awemeId, template = 'viral_rewrite', promptOptions = {}, agentConfigOverride = null) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, promptOptions, agentConfigOverride }),
    });
  },
  createDouyinStoryboardPlanRun(awemeId, promptOptions = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/storyboard-plan-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptOptions }),
    });
  },
  createDouyinHyperframesFreeformRun(awemeId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/hyperframes-freeform-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  listDouyinAgentRuns(awemeId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs`);
  },
  getDouyinAgentRun(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}`);
  },
  getDouyinRunNextAction(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/next-action`);
  },
  synthesizeDouyinRunTts(awemeId, runId, payload = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  synthesizeDouyinRunSceneTts(awemeId, runId, payload = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/scene-tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  compressDouyinRunSceneNarration(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/compress-narration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  createDouyinRunStoryboard(awemeId, runId, storyboardOptions = {}, storyboardConfigOverride = null, frameProfileId = '', qualityFeedback = null) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/storyboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyboardOptions, storyboardConfigOverride, frameProfileId, qualityFeedback }),
    });
  },
  createDouyinRunVisualStoryboard(awemeId, runId, storyboardOptions = {}, storyboardConfigOverride = null, frameProfileId = '', qualityFeedback = null) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/visual-storyboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyboardOptions, storyboardConfigOverride, frameProfileId, qualityFeedback }),
    });
  },
  saveDouyinRunStoryboard(awemeId, runId, storyboard = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/storyboard`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyboard }),
    });
  },
  createDouyinRunHyperframesProject(awemeId, runId, renderOptions = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ renderOptions }),
    });
  },
  renderDouyinRunHyperframesVideo(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  generateHyperframesFreeformBrief(awemeId, runId, payload = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  generateHyperframesFreeformAudio(awemeId, runId, payload = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  generateHyperframesFreeformProject(awemeId, runId, payload = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  checkHyperframesFreeformProject(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  renderHyperframesFreeformProject(awemeId, runId, payload = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  inspectHyperframesFreeformVideo(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  getHyperframesFreeformFile(awemeId, runId, fileName) {
    return requestRaw(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/files/${encodeURIComponent(fileName)}`, {
      method: 'GET',
    });
  },
  saveHyperframesFreeformFile(awemeId, runId, fileName, content) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/files/${encodeURIComponent(fileName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  },
};
