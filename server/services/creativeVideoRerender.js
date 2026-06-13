async function rerenderSceneSpecProject({
  workflowId,
  sceneSpec,
  outputPath,
  previousOutputPath,
  services = {},
} = {}) {
  const { composer, projectWriter, checker, renderAdapter } = services;

  if (!composer || typeof composer.composeHyperframesProjectFiles !== 'function') {
    return {
      success: false,
      message: '缺少 composer 服务',
      previous_output_path: previousOutputPath,
      diagnostics: [],
    };
  }

  const composed = composer.composeHyperframesProjectFiles(sceneSpec);
  if (!composed.success) {
    return {
      success: false,
      message: `工程生成失败：${composed.message || '规格验证失败'}`,
      previous_output_path: previousOutputPath,
      diagnostics: composed.diagnostics || [],
    };
  }

  if (!projectWriter || typeof projectWriter !== 'function') {
    return {
      success: false,
      message: '缺少 projectWriter 服务',
      previous_output_path: previousOutputPath,
      diagnostics: [],
    };
  }

  let projectDir;
  try {
    const written = await projectWriter(composed.files, { workflowId, sceneSpec });
    if (!written.success) {
      return {
        success: false,
        message: `工程写入失败：${written.message || '写入失败'}`,
        previous_output_path: previousOutputPath,
        diagnostics: written.diagnostics || [],
      };
    }
    projectDir = written.projectDir || written.project_dir;
  } catch (error) {
    return {
      success: false,
      message: `工程写入失败：${error.message}`,
      previous_output_path: previousOutputPath,
      diagnostics: [error.message],
    };
  }

  if (checker && typeof checker === 'function') {
    try {
      const checked = await checker(projectDir, { workflowId });
      if (!checked.success) {
        return {
          success: false,
          message: `工程校验失败：${checked.message || '校验失败'}`,
          project_dir: projectDir,
          previous_output_path: previousOutputPath,
          diagnostics: checked.diagnostics || [],
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `工程校验失败：${error.message}`,
        project_dir: projectDir,
        previous_output_path: previousOutputPath,
        diagnostics: [error.message],
      };
    }
  }

  if (!renderAdapter || typeof renderAdapter.render !== 'function') {
    return {
      success: true,
      output_path: outputPath,
      project_dir: projectDir,
      scene_spec: composed.scene_spec,
      message: '工程已生成，未配置渲染适配器',
      diagnostics: [],
    };
  }

  const totalDuration = (composed.scene_spec.scenes || []).reduce((sum, s) => sum + s.duration, 0);
  try {
    const rendered = await renderAdapter.render({
      projectDir,
      outputPath,
      fps: 30,
      duration: totalDuration,
    });
    if (!rendered.success) {
      return {
        success: false,
        message: `渲染失败：${rendered.message || '渲染失败'}`,
        project_dir: projectDir,
        previous_output_path: previousOutputPath,
        diagnostics: rendered.diagnostics || [],
      };
    }
    return {
      success: true,
      output_path: rendered.outputPath || outputPath,
      project_dir: projectDir,
      scene_spec: composed.scene_spec,
      message: '成片已重新渲染',
      diagnostics: rendered.diagnostics || [],
    };
  } catch (error) {
    return {
      success: false,
      message: `渲染失败：${error.message}`,
      project_dir: projectDir,
      previous_output_path: previousOutputPath,
      diagnostics: [error.message],
    };
  }
}

async function rerenderSceneWithLocalTts({
  workflowId,
  sceneSpec,
  sceneId,
  outputPath,
  previousOutputPath,
  services = {},
} = {}) {
  const { ttsService } = services;
  if (!ttsService || typeof ttsService.synthesizeScene !== 'function') {
    return {
      success: false,
      message: '缺少 TTS 服务',
      previous_output_path: previousOutputPath,
      diagnostics: [],
    };
  }

  const scene = (sceneSpec.scenes || []).find(s => s.id === sceneId);
  if (!scene) {
    return {
      success: false,
      message: `未找到场景 ${sceneId}`,
      previous_output_path: previousOutputPath,
      diagnostics: [],
    };
  }

  try {
    const ttsResult = await ttsService.synthesizeScene(scene, { workflowId, sceneSpec });
    if (!ttsResult.success) {
      return {
        success: false,
        message: `TTS 合成失败：${ttsResult.message || '合成失败'}`,
        previous_output_path: previousOutputPath,
        diagnostics: ttsResult.diagnostics || [],
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `TTS 合成失败：${error.message}`,
      previous_output_path: previousOutputPath,
      diagnostics: [error.message],
    };
  }

  return rerenderSceneSpecProject({
    workflowId,
    sceneSpec,
    outputPath,
    previousOutputPath,
    services,
  });
}

module.exports = {
  rerenderSceneSpecProject,
  rerenderSceneWithLocalTts,
};
