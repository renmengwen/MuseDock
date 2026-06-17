const path = require('path');

const aiTextModel = require('../../aiTextModel');
const { createTemplateRegistry, DEFAULT_ROOT_DIR } = require('./templateRegistry');
const templateSelectorAgent = require('./templateSelectorAgent');
const templateInputAgent = require('./templateInputAgent');
const contentGraphAgent = require('./contentGraphAgent');
const frameHtmlAgent = require('./frameHtmlAgent');
const { buildRawHtmlFrameProject } = require('./rawHtmlFrameBuilder');
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

function resolveExistingNarrationPath(creativeContext = {}) {
  const audio = objectOrEmpty(creativeContext.audio);
  const audioPath = String(audio.path || audio.narration_path || audio.narrationPath || '').trim();
  if (!audioPath) return null;
  const status = String(audio.status || '').trim().toLowerCase();
  if (status && !['ready', 'done', 'rendered'].includes(status)) return null;
  return audioPath;
}

function failure(message, diagnostics, extra = {}) {
  return failureFromDiagnostics(message, diagnostics, {
    render_mode: 'html-video',
    ...extra,
  });
}

function report(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(event);
  } catch (_) {
    // 进度回调不能影响主生成流程。
  }
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

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function resolveRenderTarget(target = {}, sceneSpec = {}) {
  const aspectRatio = target.aspect_ratio
    || target.aspectRatio
    || sceneSpec.aspect_ratio
    || sceneSpec.aspectRatio
    || '';
  const durationSec = firstPositiveNumber(
    target.duration_sec,
    target.durationSec,
    target.duration,
    target.target_duration_sec,
    target.targetDurationSec,
    sceneSpec.target_duration_sec,
    sceneSpec.targetDurationSec,
  );
  return {
    ...target,
    aspect_ratio: aspectRatio,
    aspectRatio,
    duration_sec: durationSec || target.duration_sec || target.durationSec || target.duration,
  };
}

function buildTemplateIndexOptions(renderTarget = {}, sceneSpec = {}) {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const isMultiScene = scenes.length > 1;
  return {
    aspectRatio: renderTarget.aspect_ratio || renderTarget.aspectRatio,
    durationSec: isMultiScene
      ? undefined
      : (renderTarget.duration_sec || renderTarget.durationSec || renderTarget.duration),
  };
}

function resolveGenerationMode(target = {}) {
  return target.html_video_generation_mode
    || target.htmlVideoGenerationMode
    || target.generation_mode
    || 'raw_html';
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
    templateSchema,
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
  onProgress = null,
} = {}) {
  const registry = resolveRegistry(templateRegistry);
  const diagnostics = [];
  const model = getModel(services);
  const renderTarget = resolveRenderTarget(target, sceneSpec || {});
  const compactIndex = registry.buildCompactIndex(buildTemplateIndexOptions(renderTarget, sceneSpec || {}));

  if (!compactIndex.length) {
    return failure('没有可用的 html-video 模板。', [
      createDiagnostic({ code: 'template_missing', stage: 'template', user_message: '没有可用的 html-video 模板。' }),
    ]);
  }

  const selection = await requestTemplateSelection({ model, compactIndex, creativeContext, target: renderTarget, sceneSpec });
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
  report(onProgress, {
    type: 'html_video_template_selected',
    stage: 'project',
    message: `已选择 html-video 模板：${template.name || template.id}。`,
    data: {
      template_id: template.id,
      template_name: template.name || '',
      reason: selection.reason || '',
    },
  });

  const env = skipValidation ? { ok: true, diagnostics: [] } : await runEnvironmentDoctor(services);
  const projectDir = await projectStore.createProjectDir({ rootDir, workflowId, runId });
  const generationMode = resolveGenerationMode(renderTarget);
  let project;
  let templateInputs = {};

  if (generationMode === 'template_inputs') {
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
      ], {
        html_video_project_path: projectDir,
        project_dir: projectDir,
      });
    }
    templateInputs = inputResult.inputs;
    project = buildInitialProject({
      workflowId,
      runId,
      sceneSpec,
      template,
      templateInputs,
      target: renderTarget,
    });
  } else {
    const graphPrompt = contentGraphAgent.buildContentGraphPrompt({
      sceneSpec,
      creativeContext,
      target: renderTarget,
    });
    report(onProgress, {
      type: 'html_video_graph_started',
      stage: 'project',
      message: '正在生成 html-video 内容图...',
      data: {},
    });
    const graphAi = await callTextModel(model, graphPrompt);
    if (!graphAi.success) {
      return failure(graphAi.message || 'content graph 生成失败。', [
        createDiagnostic({
          code: 'content_graph_failed',
          stage: 'ai-content-graph',
          user_message: graphAi.message || 'content graph 生成失败。',
        }),
      ], {
        html_video_project_path: projectDir,
        project_dir: projectDir,
      });
    }
    const graphParsed = contentGraphAgent.parseContentGraphResponse(graphAi.text, sceneSpec);
    if (!graphParsed.success) {
      return failure(graphParsed.message || 'content graph 解析失败。', [
        createDiagnostic({
          code: 'content_graph_invalid',
          stage: 'ai-content-graph',
          user_message: graphParsed.message || 'content graph 解析失败。',
          details: { errors: graphParsed.errors || [] },
        }),
      ], {
        html_video_project_path: projectDir,
        project_dir: projectDir,
      });
    }
    report(onProgress, {
      type: 'html_video_graph_done',
      stage: 'project',
      message: 'html-video 内容图已生成。',
      data: {
        node_count: graphParsed.graph.nodes?.length || 0,
        edge_count: graphParsed.graph.edges?.length || 0,
      },
    });
    const frameHtmlByNodeId = {};
    const nodes = graphParsed.graph.nodes || [];
    for (let index = 0; index < nodes.length; index += 1) {
      report(onProgress, {
        type: 'html_video_frame_html_started',
        stage: 'project',
        message: `正在生成第 ${index + 1}/${nodes.length} 帧 HTML...`,
        data: {
          frame_id: nodes[index].id,
          index,
          total: nodes.length,
        },
      });
      const htmlResult = await frameHtmlAgent.generateFrameHtml({
        model,
        graph: graphParsed.graph,
        node: nodes[index],
        index,
        total: nodes.length,
        sceneSpec,
        creativeContext,
        target: renderTarget,
        template,
      });
      if (!htmlResult.success) {
        return failure(htmlResult.message || '单帧 HTML 生成失败。', [
          createDiagnostic({
            code: 'frame_html_invalid',
            stage: 'ai-frame-html',
            user_message: htmlResult.message || '单帧 HTML 生成失败。',
            details: { frame_id: nodes[index].id, diagnostics: htmlResult.diagnostics || [] },
          }),
        ], {
          html_video_project_path: projectDir,
          project_dir: projectDir,
        });
      }
      frameHtmlByNodeId[nodes[index].id] = htmlResult.html;
      report(onProgress, {
        type: 'html_video_frame_html_done',
        stage: 'project',
        message: `第 ${index + 1}/${nodes.length} 帧 HTML 已生成。`,
        data: {
          frame_id: nodes[index].id,
          index,
          total: nodes.length,
        },
      });
    }
    project = await buildRawHtmlFrameProject({
      projectDir,
      workflowId,
      runId,
      graph: graphParsed.graph,
      frameHtmlByNodeId,
      sceneSpec,
      target: renderTarget,
      template,
    });
  }

  const validation = await validateHtmlVideoProject({
    project,
    templateRegistry: registry,
    environment: env,
  });
  diagnostics.push(...validation.diagnostics);
  if (!validation.ok) {
    return failure('html-video 工程未通过生成前校验。', diagnostics, {
      html_video_project_path: projectDir,
      project_dir: projectDir,
      project,
    });
  }

  const existingNarrationPath = resolveExistingNarrationPath(creativeContext);
  if (existingNarrationPath) {
    project.audio = objectOrEmpty(project.audio);
    project.audio.narration_path = existingNarrationPath;
    project.audio.tts_manifest_path = project.audio.tts_manifest_path || null;
  } else if (services.ttsService && sceneSpec) {
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
    onProgress,
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
      expectedAspectRatio: renderTarget.aspect_ratio || sceneSpec?.aspect_ratio,
    });
    if (!visualReport.success) {
      diagnostics.push(createDiagnostic({
        code: 'visual_qa_warning',
        stage: 'inspect',
        user_message: visualReport.message || 'html-video 视觉质检未通过，仅记录为参考报告。',
        details: { issues: visualReport.issues || [], metrics: visualReport.metrics || {} },
        severity: 'warning',
      }));
    }
  }

  return {
    success: true,
    message: 'html-video 成片完成。',
    render_mode: 'html-video',
    template_id: template.id,
    template_reason: selection.reason,
    template_inputs: templateInputs,
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
  resolveRenderTarget,
  buildTemplateIndexOptions,
};
