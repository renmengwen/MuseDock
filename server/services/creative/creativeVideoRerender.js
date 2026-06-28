const sceneSpecService = require('../sceneSpec');
const defaultTtsService = require('../creative-video/ttsService');

function hasSceneSpecRerenderPipeline(services = {}) {
  return !!(
    services.composer
    && typeof services.composer.composeHyperframesProjectFiles === 'function'
    && typeof services.projectWriter === 'function'
  );
}

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
  const fps = composed.scene_spec.fps || sceneSpec?.fps || 30;
  try {
    const rendered = await renderAdapter.render({
      projectDir,
      outputPath,
      fps,
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
  projectDir,
  outputPath,
  previousOutputPath,
  services = {},
} = {}) {
  const ttsService = services.ttsService || defaultTtsService;
  if (
    !ttsService
    || (typeof ttsService.synthesizeScene !== 'function' && typeof ttsService.synthesizeSceneNarration !== 'function')
  ) {
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

  let ttsResult;
  try {
    if (typeof ttsService.synthesizeScene === 'function') {
      ttsResult = await ttsService.synthesizeScene(scene, { workflowId, sceneSpec });
    } else {
      ttsResult = await ttsService.synthesizeSceneNarration({
        projectDir,
        sceneSpec,
        sceneId,
        services,
      });
      const audioScene = Array.isArray(ttsResult.audio_manifest?.scenes)
        ? ttsResult.audio_manifest.scenes[0]
        : null;
      ttsResult = {
        ...ttsResult,
        audio_path: audioScene?.relative_path || audioScene?.path || '',
        duration: audioScene?.duration,
      };
    }
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

  // Merge TTS results back into scene spec before rerendering
  const updatedSpec = JSON.parse(JSON.stringify(sceneSpec));
  const updatedScene = updatedSpec.scenes.find(s => s.id === sceneId);
  let sceneUpdated = false;
  if (updatedScene) {
    if (ttsResult.audio_path) {
      updatedScene.audio_path = ttsResult.audio_path;
      sceneUpdated = true;
    }
    if (typeof ttsResult.duration === 'number' && ttsResult.duration > 0) {
      updatedScene.duration = Math.round(ttsResult.duration * 100) / 100;
      updatedSpec.scenes = sceneSpecService.retimeScenes(updatedSpec.scenes);
      sceneUpdated = true;
    }
  }

  if (!sceneUpdated) {
    return {
      success: true,
      scene_spec: updatedSpec,
      output_path: outputPath || previousOutputPath,
      previous_output_path: previousOutputPath,
      requires_render: false,
      message: ttsResult.message || '场景配音没有产生新的音频。',
      diagnostics: ttsResult.diagnostics || [],
    };
  }

  if (!hasSceneSpecRerenderPipeline(services)) {
    return {
      success: true,
      scene_spec: updatedSpec,
      output_path: outputPath || previousOutputPath,
      previous_output_path: previousOutputPath,
      requires_render: true,
      message: '场景配音已更新，需要重新导出成片。',
      diagnostics: ttsResult.diagnostics || [],
    };
  }

  const rerendered = await rerenderSceneSpecProject({
    workflowId,
    sceneSpec: updatedSpec,
    outputPath,
    previousOutputPath,
    services,
  });
  if (rerendered.success && !services.renderAdapter?.render) {
    return {
      ...rerendered,
      requires_render: true,
    };
  }
  return rerendered;
}

module.exports = {
  rerenderSceneSpecProject,
  rerenderSceneWithLocalTts,
};
