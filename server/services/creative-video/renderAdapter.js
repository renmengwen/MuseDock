const defaultRenderer = require('../hyperframes/hyperframesRenderer');

class HyperFramesRenderAdapter {
  constructor({ renderer = defaultRenderer } = {}) {
    this.renderer = renderer;
  }

  async render(input = {}) {
    const projectDir = input.project_dir || input.projectDir;
    const audioManifest = input.audio_manifest || input.audioManifest || null;
    const renderOptions = {
      outputPath: input.output_path || input.outputPath,
      fps: input.fps,
      duration: input.duration,
      audio: input.audio || null,
      audioManifest,
    };
    try {
      const result = await this.renderer.renderHyperframesProject({
        projectDir,
        renderOptions,
      });
      return {
        success: Boolean(result && result.success),
        output_path: (result && (result.output_path || result.outputPath)) || renderOptions.outputPath || '',
        stdout: (result && result.stdout) || '',
        stderr: (result && result.stderr) || '',
        diagnostics: (result && result.diagnostics) || [],
        meta: {
          ...((result && result.meta) || {}),
          ...(audioManifest ? { audio_manifest: audioManifest } : {}),
        },
        message: (result && result.message) || (result && result.success ? '视频渲染完成。' : '视频渲染失败。'),
      };
    } catch (error) {
      return {
        success: false,
        output_path: renderOptions.outputPath || '',
        stdout: '',
        stderr: '',
        diagnostics: [error.message],
        meta: audioManifest ? { audio_manifest: audioManifest } : {},
        message: `视频渲染失败：${error.message}`,
      };
    }
  }
}

function createRenderAdapter(options = {}) {
  const type = options.type || 'hyperframes';
  if (type !== 'hyperframes') {
    throw new Error(`未知渲染适配器：${type}`);
  }
  return new HyperFramesRenderAdapter(options);
}

module.exports = {
  HyperFramesRenderAdapter,
  createRenderAdapter,
};
