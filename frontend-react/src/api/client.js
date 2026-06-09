async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || data.error || `Request failed: ${response.status}`;
    const error = new Error(message);
    error.data = data;
    throw error;
  }
  return data;
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
  getHistory(platform) {
    return requestJson(`/api/history/${platform}`);
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
  createDouyinAgentRun(awemeId, template = 'viral_rewrite', promptOptions = {}, agentConfigOverride = null) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, promptOptions, agentConfigOverride }),
    });
  },
  listDouyinAgentRuns(awemeId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs`);
  },
  getDouyinAgentRun(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}`);
  },
  synthesizeDouyinRunTts(awemeId, runId, payload = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  createDouyinRunStoryboard(awemeId, runId, storyboardOptions = {}, storyboardConfigOverride = null) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/storyboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyboardOptions, storyboardConfigOverride }),
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
};
