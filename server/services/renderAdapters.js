class HyperFramesCliAdapter {
  constructor({ renderer } = {}) {
    this.renderer = renderer || (async () => ({ success: false, message: '未配置渲染器' }));
  }

  async render({ projectDir, outputPath, fps, duration, audio, onProgress } = {}) {
    try {
      const result = await this.renderer(projectDir, {
        outputPath,
        fps,
        duration,
        audio,
        onProgress,
      });

      return {
        success: result.success,
        outputPath: result.outputPath || outputPath,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        diagnostics: result.diagnostics || [],
        meta: result.meta || {},
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        outputPath,
        stdout: '',
        stderr: error.message,
        diagnostics: [error.message],
      };
    }
  }
}

function createRenderAdapter({ type, renderer } = {}) {
  if (type === 'hyperframes-cli') {
    return new HyperFramesCliAdapter({ renderer });
  }
  throw new Error(`不支持的渲染器类型 ${type}`);
}

module.exports = {
  HyperFramesCliAdapter,
  createRenderAdapter,
};
