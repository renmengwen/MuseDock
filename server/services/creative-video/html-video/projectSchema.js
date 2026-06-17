const path = require('path');

const SCHEMA_VERSION = 1;
const DEFAULT_ENGINE = 'hyperframes-playwright';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function defaultContentGraph() {
  return {
    schemaVersion: 1,
    intent: 'promo',
    synopsis: '',
    nodes: [],
    edges: [],
  };
}

function defaultTimeline() {
  return {
    tracks: [
      { id: 'main', type: 'video', items: [] },
      { id: 'voice', type: 'audio', items: [] },
      { id: 'music', type: 'audio', items: [] },
    ],
  };
}

function defaultAudio() {
  return {
    tts_manifest_path: null,
    narration_path: null,
    music_path: null,
    mix: {
      music_volume_db: -18,
      narration_volume_db: 0,
      fade_in_sec: 0,
      fade_out_sec: 1.5,
    },
  };
}

function defaultOverrides() {
  return {
    html: {
      enabled: false,
      frames: {},
    },
    elements: {},
    transitions: {},
  };
}

function defaultEnhancement() {
  return {
    enabled: false,
    engine: null,
    template_id: null,
    data: null,
    preview_mp4_path: null,
  };
}

function defaultTransition() {
  return {
    type: 'cut',
    duration_sec: 0,
    params: {},
  };
}

function defaultTrim() {
  return {
    in_sec: 0,
    out_sec: null,
  };
}

function normalizeTransition(value) {
  const input = objectOrEmpty(value);
  return {
    type: input.type || 'cut',
    duration_sec: Number.isFinite(input.duration_sec) ? input.duration_sec : 0,
    params: objectOrEmpty(input.params),
  };
}

function normalizeTrim(value) {
  const input = objectOrEmpty(value);
  return {
    in_sec: Number.isFinite(input.in_sec) ? input.in_sec : 0,
    out_sec: input.out_sec == null ? null : input.out_sec,
  };
}

function normalizeEnhancement(value) {
  const input = objectOrEmpty(value);
  return {
    ...defaultEnhancement(),
    ...input,
    enabled: input.enabled === true,
  };
}

function normalizeFrame(frame, index) {
  const input = objectOrEmpty(frame);
  return {
    ...input,
    id: input.id || `frame_${String(index + 1).padStart(2, '0')}`,
    scene_id: input.scene_id || null,
    graph_node_id: input.graph_node_id || null,
    order: Number.isFinite(input.order) ? input.order : index + 1,
    template_id: input.template_id || null,
    inputs: objectOrEmpty(input.inputs),
    html_path: input.html_path || null,
    duration_sec: Number.isFinite(input.duration_sec) ? input.duration_sec : 3,
    engine: input.engine || DEFAULT_ENGINE,
    transition_in: input.transition_in ? normalizeTransition(input.transition_in) : defaultTransition(),
    transition_out: input.transition_out ? normalizeTransition(input.transition_out) : defaultTransition(),
    trim: input.trim ? normalizeTrim(input.trim) : defaultTrim(),
    speed: Number.isFinite(input.speed) ? input.speed : 1,
    loop: input.loop === true,
    enhancement: normalizeEnhancement(input.enhancement),
  };
}

function normalizeContentGraph(value) {
  const input = objectOrEmpty(value);
  return {
    ...defaultContentGraph(),
    ...input,
    nodes: arrayOrEmpty(input.nodes),
    edges: arrayOrEmpty(input.edges),
  };
}

function normalizeTimeline(value) {
  const input = objectOrEmpty(value);
  if (!Array.isArray(input.tracks)) {
    return defaultTimeline();
  }
  return {
    tracks: input.tracks.map(track => {
      const normalized = objectOrEmpty(track);
      return {
        id: normalized.id || '',
        type: normalized.type || normalized.kind || '',
        items: arrayOrEmpty(normalized.items),
      };
    }),
  };
}

function normalizeAudio(value) {
  const input = objectOrEmpty(value);
  const mix = objectOrEmpty(input.mix);
  const defaults = defaultAudio();
  return {
    ...defaults,
    ...input,
    mix: {
      ...defaults.mix,
      ...mix,
    },
  };
}

function normalizeOutput(value) {
  const input = objectOrEmpty(value);
  const resolution = objectOrEmpty(input.resolution);
  const width = Number(resolution.width);
  const height = Number(resolution.height);
  const fps = Number(input.fps);
  const duration = Number(input.duration ?? input.duration_sec);
  const output = {
    resolution: {
      width: Number.isFinite(width) && width > 0 ? width : 1280,
      height: Number.isFinite(height) && height > 0 ? height : 720,
    },
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
  };
  if (Number.isFinite(duration) && duration > 0) {
    output.duration = duration;
  }
  return output;
}

function normalizeOverrides(value) {
  const input = objectOrEmpty(value);
  const html = objectOrEmpty(input.html);
  return {
    ...defaultOverrides(),
    ...input,
    html: {
      ...defaultOverrides().html,
      ...html,
      enabled: html.enabled === true,
      frames: objectOrEmpty(html.frames),
    },
    elements: objectOrEmpty(input.elements),
    transitions: objectOrEmpty(input.transitions),
  };
}

function createEmptyProject(input = {}) {
  return normalizeProject({
    project_id: input.projectId || input.project_id || null,
    workflow_id: input.workflowId || input.workflow_id || null,
    run_id: input.runId || input.run_id || null,
    template_id: input.templateId || input.template_id || null,
    template_inputs: input.templateInputs || input.template_inputs || {},
    content_graph: input.contentGraph || input.content_graph || defaultContentGraph(),
  });
}

function normalizeProject(project = {}) {
  const input = objectOrEmpty(project);
  return {
    project_id: input.project_id || null,
    workflow_id: input.workflow_id || null,
    run_id: input.run_id || null,
    schema_version: SCHEMA_VERSION,
    template_id: input.template_id || null,
    template_inputs: objectOrEmpty(input.template_inputs),
    output: normalizeOutput(input.output),
    template_schema: objectOrEmpty(input.template_schema),
    content_graph: normalizeContentGraph(input.content_graph),
    frames: arrayOrEmpty(input.frames).map(normalizeFrame),
    timeline: normalizeTimeline(input.timeline),
    assets: arrayOrEmpty(input.assets).map(asset => ({ ...objectOrEmpty(asset) })),
    audio: normalizeAudio(input.audio),
    overrides: normalizeOverrides(input.overrides),
    revisions: arrayOrEmpty(input.revisions).map(revision => ({ ...objectOrEmpty(revision) })),
    exports: arrayOrEmpty(input.exports).map(item => ({ ...objectOrEmpty(item) })),
    status: input.status || 'draft',
  };
}

function isRelativePathSafe(value) {
  const text = String(value || '').replace(/\\/g, '/');
  if (!text || path.isAbsolute(text)) return false;
  return !text.split('/').some(part => part === '..');
}

function validateProject(project = {}) {
  const errors = [];
  const warnings = [];
  const input = objectOrEmpty(project);

  arrayOrEmpty(input.assets).forEach((asset, index) => {
    const id = asset && asset.id ? asset.id : `asset_${index + 1}`;
    const assetPath = asset && asset.path;
    const text = String(assetPath || '').replace(/\\/g, '/');
    if (!text) return;
    if (path.isAbsolute(text)) {
      errors.push({
        code: 'asset-path-absolute',
        message: '素材路径不能是绝对路径。',
        ref: id,
      });
      return;
    }
    if (!isRelativePathSafe(text)) {
      errors.push({
        code: 'asset-path-escape',
        message: '素材路径不能包含 ..。',
        ref: id,
      });
    }
  });

  arrayOrEmpty(input.timeline && input.timeline.tracks).forEach(track => {
    arrayOrEmpty(track && track.items).forEach((item, index) => {
      const kind = item && item.kind;
      if (kind !== 'frame') {
        errors.push({
          code: 'timeline-item-kind-unsupported',
          message: '首版 timeline item 只支持 frame。',
          ref: `${(track && track.id) || ''}/${(item && item.id) || index}`,
        });
      }
    });
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_ENGINE,
  createEmptyProject,
  normalizeProject,
  validateProject,
  defaultTimeline,
  defaultEnhancement,
  clone,
};
