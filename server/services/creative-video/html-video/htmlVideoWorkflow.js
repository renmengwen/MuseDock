const path = require('path');

const aiTextModel = require('../../aiTextModel');
const { createTemplateRegistry, DEFAULT_ROOT_DIR } = require('./templateRegistry');
const templateSelectorAgent = require('./templateSelectorAgent');
const templateInputAgent = require('./templateInputAgent');
const environmentDoctor = require('./environmentDoctor');
const projectStore = require('./projectStore');
const { normalizeProject } = require('./projectSchema');
const { validateHtmlVideoProject } = require('./validationGate');
const projectOrchestrator = require('./projectOrchestrator');
const defaultVisualQaService = require('../visualQaService');
const { createDiagnostic, normalizeDiagnostics, failureFromDiagnostics } = require('./diagnostics');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function failure(message, diagnostics, extra = {}) {
  return failureFromDiagnostics(message, diagnostics, {
    render_mode: 'html-video',
    ...extra,
  });
}

function getModel(services = {}) {
  return services.aiTextModel || aiTextModel;
}

async function callTextModel(model, prompt) {
  const response = await model.callTextModel({
    messages: [{ role: 'user', content: prompt }],
  });
  if (!response || response.success === false) {
    return {
      success: false,
      message: response?.message || 'AI 调用失败。',
      text: '',
    };
  }
  return { success: true, text: response.text || response.content || '' };
}

async function requestTemplateSelection({ model, compactIndex, creativeContext, target }) {
  const prompt = templateSelectorAgent.buildTemplateSelectionPrompt({
    sceneSpec: {
      title: creativeContext?.brief?.title || creativeContext?.input?.raw_text || creativeContext?.input?.title || 'html-video',
      creative_context_summary: creativeContext?.brief?.summary || creativeContext?.source_context?.summary || '',
    },
    compactIndex,
    target,
  });
  const ai = await callTextModel(model, prompt);
  if (!ai.success) return ai;
  return templateSelectorAgent.parseTemplateSelectionResponse(ai.text, { compactIndex });
}

async function requestTemplateInputs({ model, template, creativeContext }) {
  const prompt = templateInputAgent.buildTemplateInputPrompt({
    sceneSpec: {
      title: creativeContext?.brief?.title || creativeContext?.input?.raw_text || creativeContext?.input?.title || 'html-video',
      brief: creativeContext?.brief || {},
    },
    template,
    creativeContext,
  });
  const ai = await callTextModel(model, prompt);
  if (!ai.success) return ai;
  return templateInputAgent.parseTemplateInputResponse(ai.text, { template });
}

function durationFromTarget(target, template) {
  const output = objectOrEmpty(template.output);
  const value = target.duration_sec ?? target.durationSec ?? target.duration ?? output.duration_sec ?? output.duration ?? 6;
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : 6;
}

function buildInitialProject({ workflowId, runId, template, templateInputs, target }) {
  const duration = durationFromTarget(target, template);
  const output = objectOrEmpty(template.output);
  return normalizeProject({
    project_id: `${workflowId}_${runId}`,
    workflow_id: workflowId,
    run_id: runId,
    template_id: template.id,
    template_inputs: templateInputs,
    output,
    frames: [
      {
        id: 'frame_01',
        scene_id: 'scene_01',
        order: 1,
        template_id: template.id,
        inputs: templateInputs,
        duration_sec: duration,
      },
    ],
    timeline: {
      tracks: [
        { id: 'main', type: 'video', items: [{ id: 'frame_01', kind: 'frame', frame_id: 'frame_01', start_sec: 0, duration_sec: duration }] },
        { id: 'voice', type: 'audio', items: [] },
        { id: 'music', type: 'audio', items: [] },
      ],
    },
  });
}

function resolveRegistry(input) {
  if (input) return input;
  return createTemplateRegistry({ rootDir: DEFAULT_ROOT_DIR });
}

async function runEnvironmentDoctor(services) {
  const doctor = services.environmentDoctor || environmentDoctor.diagnoseEnvironment;
  return doctor();
}

async function generateHtmlVideo({
  workflowId,
  runId,
  rootDir,
  creativeContext = {},
  target = {},
  templateRegistry,
  services = {},
  skipValidation = false,
} = {}) {
  const registry = resolveRegistry(templateRegistry);
  const diagnostics = [];
  const model = getModel(services);
  const compactIndex = registry.buildCompactIndex({
    durationSec: target.duration_sec || target.durationSec || target.duration,
    aspectRatio: target.aspect_ratio || target.aspectRatio,
  });

  if (!compactIndex.length) {
    return failure('没有可用的 html-video 模板。', [
      createDiagnostic({ code: 'template_missing', stage: 'template', user_message: '没有可用的 html-video 模板。' }),
    ]);
  }

  const selection = await requestTemplateSelection({ model, compactIndex, creativeContext, target });
  if (!selection.success) {
    const selectionDiagnostics = selection.diagnostics || [];
    const code = selectionDiagnostics.some(item => String(item).includes('unknown_template_id'))
      ? 'template_missing'
      : 'ai_response_invalid';
    const message = selection.user_message || selection.message || '模板选择失败。';
    return failure(`html-video ${message}`, [
      createDiagnostic({
        code,
        stage: 'ai-template-selection',
        user_message: `html-video ${message}`,
        details: { diagnostics: selectionDiagnostics },
      }),
    ]);
  }

  const template = registry.getTemplate(selection.template_id);
  if (!template) {
    return failure(`未找到 html-video 模板：${selection.template_id}。`, [
      createDiagnostic({
        code: 'template_missing',
        stage: 'template',
        user_message: `未找到 html-video 模板：${selection.template_id}。`,
        details: { template_id: selection.template_id },
      }),
    ]);
  }

  const inputResult = await requestTemplateInputs({
    model,
    template,
    creativeContext,
  });
  if (!inputResult.success) {
    return failure(inputResult.user_message || inputResult.message || 'html-video 模板字段填写失败。', [
      createDiagnostic({
        code: 'template_inputs_invalid',
        stage: 'ai-template-inputs',
        user_message: inputResult.user_message || inputResult.message || 'html-video 模板字段填写失败。',
        details: { diagnostics: inputResult.diagnostics || [] },
      }),
    ]);
  }

  const project = buildInitialProject({
    workflowId,
    runId,
    template,
    templateInputs: inputResult.inputs,
    target,
  });

  const env = skipValidation ? { ok: true, diagnostics: [] } : await runEnvironmentDoctor(services);
  const validation = await validateHtmlVideoProject({
    project,
    templateRegistry: registry,
    environment: env,
  });
  diagnostics.push(...validation.diagnostics);
  if (!validation.ok) {
    return failure('html-video 工程未通过生成前校验。', diagnostics);
  }

  const projectDir = await projectStore.createProjectDir({ rootDir, workflowId, runId });
  await projectStore.saveProject(projectDir, project);
  const rendered = await projectOrchestrator.renderHtmlVideoProject({
    rootDir,
    workflowId,
    runId,
    projectDir,
    project,
    templateRegistry: registry,
    services,
  });
  diagnostics.push(...normalizeDiagnostics(rendered.diagnostics));
  if (!rendered.success) {
    return failure(rendered.message || 'html-video 工程渲染失败。', diagnostics, {
      html_video_project_path: rendered.html_video_project_path || projectDir,
      project_dir: rendered.project_dir || projectDir,
      project: rendered.project || project,
    });
  }

  let visualReport = { success: true, issues: [], metrics: {} };
  if (!skipValidation) {
    const visualQaService = services.visualQaService || defaultVisualQaService;
    visualReport = await visualQaService.inspectRenderedVideo({
      projectDir,
      outputPath: rendered.output_path,
    });
    if (!visualReport.success) {
      diagnostics.push(createDiagnostic({
        code: 'render_failed',
        stage: 'inspect',
        user_message: visualReport.message || 'html-video 视觉质检失败。',
        details: { issues: visualReport.issues || [], metrics: visualReport.metrics || {} },
      }));
      return failure(visualReport.message || 'html-video 视觉质检失败。', diagnostics, {
        html_video_project_path: projectDir,
        project_dir: projectDir,
        project: rendered.project,
        output_path: rendered.output_path,
        visual_report: visualReport,
      });
    }
  }

  return {
    success: true,
    message: 'html-video 成片完成。',
    render_mode: 'html-video',
    template_id: template.id,
    template_reason: selection.reason,
    template_inputs: inputResult.inputs,
    project: rendered.project,
    project_dir: projectDir,
    html_video_project_path: projectDir,
    output_path: rendered.output_path,
    files: ['project.json', 'content-graph.json'],
    audio_manifest: rendered.project.audio?.tts_manifest_path || null,
    visual_report: visualReport,
    html_video_diagnostics: diagnostics,
    diagnostics,
  };
}

module.exports = {
  generateHtmlVideo,
  requestTemplateSelection,
  requestTemplateInputs,
  buildInitialProject,
};
