const path = require('path');
const { normalizeCaptionsForFrame } = require('./captionLayer');

const SCHEMA_VERSION = 1;
const DEFAULT_ENGINE = 'hyperframes-playwright';
const DEFAULT_OUTPUT_RESOLUTION = { width: 1920, height: 1080 };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
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
    source: null,
    scene_spec_hash: null,
    scene_count: 0,
    scene_ids: [],
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

function defaultGenerationCheckpoint(project = {}) {
  return {
    version: 1,
    workflow_id: project.workflow_id || null,
    run_id: project.run_id || null,
    scene_spec_hash: '',
    target: {
      duration_sec: null,
      aspect_ratio: '',
    },
    stages: {
      validate_project: { status: 'pending', diagnostic_code: '' },
      content_graph: { status: 'pending', path: '', input_hash: '', output_hash: '', diagnostic_code: '' },
      frame_html: { status: 'pending', frames: {} },
      render: { status: 'pending', frames: {} },
      compose: { status: 'pending', output_path: '', output_audio_path: '' },
      duration_verify: { status: 'pending', expected_duration_sec: null, actual_duration_sec: null },
      visual_inspect: { status: 'pending', report_path: null },
    },
    updated_at: '',
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
  const defaultId = `frame_${String(index + 1).padStart(2, '0')}`;
  const id = firstNonEmptyString(input.id, input.scene_id, input.sceneId, input.graph_node_id, input.graphNodeId, defaultId);
  const sceneId = firstNonEmptyString(input.scene_id, input.sceneId, id);
  const graphNodeId = firstNonEmptyString(input.graph_node_id, input.graphNodeId, id);
  const sourceMode = firstNonEmptyString(input.source_mode, input.sourceMode);
  const duration = Number(input.duration_sec ?? input.durationSec ?? input.duration);
  const durationSec = Number.isFinite(duration) && duration > 0 ? duration : 3;
  const narrationText = String(input.narration_text ?? input.narrationText ?? '');
  const metadata = objectOrEmpty(input.metadata);
  const generateCaptions = input.generate_captions === false || input.generateCaptions === false ? false : true;
  const captions = normalizeCaptionsForFrame({
    id,
    duration_sec: durationSec,
    narration_text: narrationText,
    captions: input.captions,
    generate_captions: generateCaptions,
  });
  return {
    ...input,
    id,
    scene_id: sceneId,
    graph_node_id: graphNodeId,
    order: Number.isFinite(Number(input.order)) && Number(input.order) > 0 ? Number(input.order) : index + 1,
    template_id: input.template_id || input.templateId || null,
    source_mode: sourceMode === 'raw_html' ? 'raw_html' : 'template_inputs',
    inputs: objectOrEmpty(input.inputs),
    html_path: input.html_path || input.htmlPath || null,
    preview_mp4_path: input.preview_mp4_path || input.previewMp4Path || null,
    duration_sec: durationSec,
    engine: input.engine || DEFAULT_ENGINE,
    narration_text: narrationText,
    captions,
    ...(generateCaptions === false ? { generate_captions: false } : {}),
    drafts: arrayOrEmpty(input.drafts),
    active_draft_id: firstNonEmptyString(input.active_draft_id, input.activeDraftId),
    metadata: {
      ...metadata,
      visual_text: objectOrEmpty(metadata.visual_text),
    },
    transition_in: input.transition_in ? normalizeTransition(input.transition_in) : defaultTransition(),
    transition_out: input.transition_out ? normalizeTransition(input.transition_out) : defaultTransition(),
    trim: input.trim ? normalizeTrim(input.trim) : defaultTrim(),
    speed: Number.isFinite(Number(input.speed)) && Number(input.speed) > 0 ? Number(input.speed) : 1,
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
    scene_ids: arrayOrEmpty(input.scene_ids || input.sceneIds),
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
      width: Number.isFinite(width) && width > 0 ? width : DEFAULT_OUTPUT_RESOLUTION.width,
      height: Number.isFinite(height) && height > 0 ? height : DEFAULT_OUTPUT_RESOLUTION.height,
    },
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
  };
  if (Number.isFinite(duration) && duration > 0) {
    output.duration = duration;
  }
  if (input.duration_locked === true || input.durationLocked === true) {
    output.duration_locked = true;
  }
  if (input.lock_duration === true || input.lockDuration === true) {
    output.lock_duration = true;
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

function stringField(value) {
  return String(value ?? '');
}

function nullableNumberField(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCheckpointFrames(value, type) {
  const frames = objectOrEmpty(value);
  return Object.fromEntries(Object.entries(frames).map(([sceneId, frame]) => {
    const input = objectOrEmpty(frame);
    const status = stringField(input.status || 'pending');
    const failed = status === 'failed';
    const normalized = {
      status,
      ...(type === 'render'
        ? { mp4_path: failed ? '' : stringField(input.mp4_path) }
        : { html_path: failed ? '' : stringField(input.html_path) }),
      ...(type === 'render' ? {} : { input_hash: failed ? '' : stringField(input.input_hash) }),
      output_hash: failed ? '' : stringField(input.output_hash),
      diagnostic_code: stringField(input.diagnostic_code),
    };
    return [sceneId, normalized];
  }));
}

function normalizeGenerationCheckpoint(input = {}, project = {}) {
  const source = objectOrEmpty(input);
  const defaults = defaultGenerationCheckpoint(project);
  const stages = objectOrEmpty(source.stages);
  const target = objectOrEmpty(source.target);
  return {
    version: 1,
    workflow_id: source.workflow_id || project.workflow_id || defaults.workflow_id,
    run_id: source.run_id || project.run_id || defaults.run_id,
    scene_spec_hash: stringField(source.scene_spec_hash),
    target: {
      duration_sec: nullableNumberField(target.duration_sec),
      aspect_ratio: stringField(target.aspect_ratio),
    },
    stages: {
      validate_project: {
        status: stringField(objectOrEmpty(stages.validate_project).status || 'pending'),
        diagnostic_code: stringField(objectOrEmpty(stages.validate_project).diagnostic_code),
      },
      content_graph: {
        status: stringField(objectOrEmpty(stages.content_graph).status || 'pending'),
        path: stringField(objectOrEmpty(stages.content_graph).path),
        input_hash: stringField(objectOrEmpty(stages.content_graph).input_hash),
        output_hash: stringField(objectOrEmpty(stages.content_graph).output_hash),
        diagnostic_code: stringField(objectOrEmpty(stages.content_graph).diagnostic_code),
      },
      frame_html: {
        status: stringField(objectOrEmpty(stages.frame_html).status || 'pending'),
        frames: normalizeCheckpointFrames(objectOrEmpty(stages.frame_html).frames, 'html'),
      },
      render: {
        status: stringField(objectOrEmpty(stages.render).status || 'pending'),
        frames: normalizeCheckpointFrames(objectOrEmpty(stages.render).frames, 'render'),
      },
      compose: {
        status: stringField(objectOrEmpty(stages.compose).status || 'pending'),
        output_path: stringField(objectOrEmpty(stages.compose).output_path),
        output_audio_path: stringField(objectOrEmpty(stages.compose).output_audio_path),
      },
      duration_verify: {
        status: stringField(objectOrEmpty(stages.duration_verify).status || 'pending'),
        expected_duration_sec: nullableNumberField(objectOrEmpty(stages.duration_verify).expected_duration_sec),
        actual_duration_sec: nullableNumberField(objectOrEmpty(stages.duration_verify).actual_duration_sec),
      },
      visual_inspect: {
        status: stringField(objectOrEmpty(stages.visual_inspect).status || 'pending'),
        report_path: objectOrEmpty(stages.visual_inspect).report_path == null
          ? null
          : stringField(objectOrEmpty(stages.visual_inspect).report_path),
      },
    },
    updated_at: stringField(source.updated_at),
  };
}

function createEmptyGenerationCheckpoint(project = {}) {
  return normalizeGenerationCheckpoint({}, project);
}

function ensureGenerationCheckpoint(project) {
  project.generation_checkpoint = normalizeGenerationCheckpoint(project.generation_checkpoint, project);
  return project.generation_checkpoint;
}

function markCheckpointStage(project, stageId, patch = {}) {
  const checkpoint = ensureGenerationCheckpoint(project);
  const stages = checkpoint.stages;
  if (!stages[stageId]) return project;
  const updatedAt = new Date().toISOString();
  stages[stageId] = normalizeGenerationCheckpoint({
    ...checkpoint,
    stages: {
      ...stages,
      [stageId]: {
        ...stages[stageId],
        ...objectOrEmpty(patch),
      },
    },
    updated_at: updatedAt,
  }, project).stages[stageId];
  checkpoint.updated_at = updatedAt;
  return project;
}

function markCheckpointFrame(project, stageId, sceneId, patch = {}) {
  const checkpoint = ensureGenerationCheckpoint(project);
  const stage = checkpoint.stages[stageId];
  if (!stage || !stage.frames) return project;
  const id = String(sceneId || '').trim();
  if (!id) return project;
  stage.frames[id] = {
    ...(stage.frames[id] || { status: 'pending' }),
    ...objectOrEmpty(patch),
  };
  project.generation_checkpoint = normalizeGenerationCheckpoint({
    ...checkpoint,
    updated_at: new Date().toISOString(),
  }, project);
  return project;
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
    edit_sessions: arrayOrEmpty(input.edit_sessions || input.editSessions),
    layout_qa_reports: arrayOrEmpty(input.layout_qa_reports || input.layoutQaReports),
    exports: arrayOrEmpty(input.exports).map(item => ({ ...objectOrEmpty(item) })),
    status: input.status || 'draft',
    generation_checkpoint: normalizeGenerationCheckpoint(input.generation_checkpoint, input),
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
  normalizeGenerationCheckpoint,
  createEmptyGenerationCheckpoint,
  markCheckpointStage,
  markCheckpointFrame,
  validateProject,
  DEFAULT_OUTPUT_RESOLUTION,
  defaultTimeline,
  defaultEnhancement,
  clone,
};
