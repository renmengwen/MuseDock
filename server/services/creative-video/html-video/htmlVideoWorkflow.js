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
const editPatchService = require('./editPatchService');
const { parseJsonOnlyResponse } = require('./templateInputAgent');
const defaultVisualQaService = require('../visualQaService');
const { createDiagnostic, normalizeDiagnostics, failureFromDiagnostics } = require('./diagnostics');
const { mapSceneSpecToContentGraph, buildFramesFromGraph } = require('./sceneSpecMapper');

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

async function requestTemplateSelection({ model, compactIndex, creativeContext, target, sceneSpec }) {
  const prompt = templateSelectorAgent.buildTemplateSelectionPrompt({
    sceneSpec: sceneSpec || {
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

async function requestTemplateInputs({ model, template, creativeContext, sceneSpec }) {
  const prompt = templateInputAgent.buildTemplateInputPrompt({
    sceneSpec: sceneSpec || {
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

function buildInitialProject({ workflowId, runId, sceneSpec, template, templateInputs, target }) {
  const duration = durationFromTarget(target, template);
  const output = objectOrEmpty(template.output);
  const templateSchema = objectOrEmpty(objectOrEmpty(template.inputs).schema);
  const contentGraph = mapSceneSpecToContentGraph(sceneSpec || {});
  const mappedFrames = buildFramesFromGraph({
    sceneSpec: sceneSpec || {},
    contentGraph,
    templateId: template.id,
    templateInputs,
  });
  const frames = mappedFrames.length ? mappedFrames : [{
    id: 'frame_01',
    scene_id: 'scene_01',
    order: 1,
    template_id: template.id,
    inputs: templateInputs,
    duration_sec: duration,
  }];
  let cursor = 0;
  const items = frames.map(frame => {
    const durationSec = Number(frame.duration_sec || duration);
    const item = {
      id: `item_${frame.id}`,
      kind: 'frame',
      frame_id: frame.id,
      start_sec: cursor,
      duration_sec: durationSec,
    };
    cursor += durationSec;
    return item;
  });
  return normalizeProject({
    project_id: `${workflowId}_${runId}`,
    workflow_id: workflowId,
    run_id: runId,
    template_id: template.id,
    template_inputs: templateInputs,
    output,
    template_schema: templateSchema,
    content_graph: contentGraph,
    frames,
    timeline: {
      tracks: [
        { id: 'main', type: 'video', items },
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
  sceneSpec = null,
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

  const selection = await requestTemplateSelection({ model, compactIndex, creativeContext, target, sceneSpec });
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
    sceneSpec,
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
    sceneSpec,
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
  if (services.ttsService && sceneSpec) {
    const tts = await services.ttsService.synthesizeSceneNarration({
      projectDir,
      sceneSpec,
    });
    if (!tts.success) {
      return failure(tts.message || '旁白音频生成失败。', diagnostics, {
        html_video_project_path: projectDir,
        project_dir: projectDir,
        project,
      });
    }
    project.audio = objectOrEmpty(project.audio);
    project.audio.tts_manifest_path = 'tts/audio_manifest.json';
    project.audio.narration_path = tts.audio_manifest?.combined_path || project.audio.narration_path || null;
  }
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
    scene_spec: sceneSpec,
    visual_report: visualReport,
    html_video_diagnostics: diagnostics,
    diagnostics,
  };
}

async function loadProjectForWorkflow({ workflowId, projectDir, rootDir }) {
  if (projectDir) {
    return { projectDir, project: await projectStore.loadProject(projectDir) };
  }
  throw new Error(`缺少 html-video 工程目录，无法加载工作流 ${workflowId || ''}。`);
}

async function parseEditInstruction({ model, project, instruction }) {
  const response = await model.callTextModel({
    messages: [{
      role: 'user',
      content: [
        '你是 html-video 可编辑工程的编辑补丁生成器。',
        '只能返回 JSON，不要返回 Markdown、HTML、CSS 或 JS。',
        'JSON 必须是 edit_patch，type 只能是 template_inputs_patch、frame_inputs_patch、narration_patch、caption_patch、duration_patch、replace_frame_template。',
        '当前 project 摘要：',
        JSON.stringify({
          template_id: project.template_id,
          template_inputs: project.template_inputs,
          frames: (project.frames || []).map(frame => ({
            id: frame.id,
            scene_id: frame.scene_id,
            template_id: frame.template_id,
            inputs: frame.inputs,
            duration_sec: frame.duration_sec,
          })),
        }),
        `用户编辑意图：${instruction}`,
      ].join('\n'),
    }],
  });
  if (!response || response.success === false) {
    return { success: false, message: response?.message || '解析编辑意图失败。' };
  }
  const parsed = parseJsonOnlyResponse(response.text || response.content || '');
  if (!parsed.success) {
    return { success: false, message: parsed.user_message || parsed.message || 'AI 返回的 edit_patch JSON 无效。' };
  }
  return { success: true, edit_patch: parsed.data.edit_patch || parsed.data };
}

async function applyEdit({
  workflowId,
  rootDir,
  projectDir,
  project,
  payload = {},
  services = {},
} = {}) {
  const loaded = project
    ? { projectDir, project }
    : await loadProjectForWorkflow({ workflowId, rootDir, projectDir });
  let editPatch = payload.edit_patch || (payload.type ? payload : null);
  if (!editPatch && payload.instruction) {
    const parsed = await parseEditInstruction({
      model: getModel(services),
      project: loaded.project,
      instruction: payload.instruction,
    });
    if (!parsed.success) {
      return { success: false, code: 'EDIT_PATCH_INVALID', workflow_id: workflowId, message: parsed.message };
    }
    editPatch = parsed.edit_patch;
  }
  if (!editPatch) {
    return {
      success: false,
      code: 'EDIT_PATCH_REQUIRED',
      workflow_id: workflowId,
      message: '自然语言编辑需要先解析为 edit_patch JSON，首版不接受直接写 HTML 或自由文本改工程。',
    };
  }
  const result = editPatchService.applyEditPatch(loaded.project, editPatch);
  if (!result.success) return result;
  if (loaded.projectDir) await projectStore.saveProject(loaded.projectDir, result.project);
  return {
    ...result,
    workflow_id: workflowId,
    html_video_project_path: loaded.projectDir,
  };
}

async function renderOrExport(options = {}) {
  return projectOrchestrator.renderHtmlVideoProject(options);
}

async function rerender(options = {}) {
  return renderOrExport(options);
}

module.exports = {
  generateHtmlVideo,
  generateProject: generateHtmlVideo,
  renderOrExport,
  rerender,
  applyEdit,
  requestTemplateSelection,
  requestTemplateInputs,
  buildInitialProject,
};
